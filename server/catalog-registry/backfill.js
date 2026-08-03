"use strict";

const { computeContentHash } = require("./hash");
const { EVENT_TYPES, SOURCES, REGISTRY_STATUSES, payloadColumns } = require("./types");
const { snapshotFromRow } = require("./reduce");
const { reverseToInitialSnapshot, forwardPatchesFromHistory, diffPatch } = require("./history-map");

async function withAppendOnlyDisabled(client, fn) {
  await client.query("ALTER TABLE catalog_registry_events DISABLE TRIGGER trg_catalog_registry_append_only");
  try {
    return await fn();
  } finally {
    await client.query("ALTER TABLE catalog_registry_events ENABLE TRIGGER trg_catalog_registry_append_only");
  }
}

function pickSnapshot(entityType, fields) {
  const allowed = new Set(payloadColumns(entityType));
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

function snapshotFromCatalogSprite(sprite, { version = null, generatedAt = null, isReleased = true } = {}) {
  const abilityDesc = sprite.ability?.descriptionFr || sprite.ability?.descriptionEn || "";
  const variantsArr = Array.isArray(sprite.variants)
    ? sprite.variants.map((v) => {
        const t = v.variantType || "";
        return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
      })
    : [];
  const baseVariant = Array.isArray(sprite.variants)
    ? sprite.variants.find((v) => v.variantType === "base") || sprite.variants[0]
    : null;
  const rarity = sprite.rarity ? sprite.rarity.charAt(0).toUpperCase() + sprite.rarity.slice(1) : null;
  return pickSnapshot("sprite", {
    name: sprite.name,
    rarity,
    color: sprite.color || null,
    effect: abilityDesc,
    variants: variantsArr,
    available: sprite.availability?.status || null,
    added_date: sprite.firstObservedAt || null,
    catalog_id: sprite.id,
    slug: sprite.slug || null,
    official_name: sprite.officialName || null,
    season_id: sprite.seasonId || null,
    event_id: sprite.eventId || null,
    image: sprite.image || baseVariant?.imagePath || baseVariant?.suggestedImagePath || null,
    introduced_in_update: sprite.introducedInUpdate || null,
    first_observed_at: sprite.firstObservedAt || null,
    last_verified_at: sprite.lastVerifiedAt || null,
    officially_announced_at: sprite.officiallyAnnouncedAt || null,
    ability: sprite.ability || null,
    acquisition: sprite.acquisition || null,
    availability: sprite.availability || null,
    recurrence:
      typeof sprite.recurrence === "object"
        ? sprite.recurrence
        : sprite.availability?.recurrence
          ? { status: sprite.availability.recurrence }
          : null,
    dates: sprite.dates || null,
    base_summon_cost: sprite.baseSummonCostSpriteDust ?? null,
    data_status: sprite.dataStatus || null,
    notes: sprite.notes || null,
    sources: sprite.sourceIds || null,
    catalog_version: version,
    catalog_generated_at: generatedAt,
    is_released: isReleased
  });
}

function snapshotFromCatalogVariant(variant, sprite) {
  const variantType = variant.variantType
    ? variant.variantType.charAt(0).toUpperCase() + variant.variantType.slice(1)
    : "Base";
  const spriteRarity = sprite?.rarity ? sprite.rarity.charAt(0).toUpperCase() + sprite.rarity.slice(1) : null;
  return pickSnapshot("variant", {
    sprite_id: variant.spriteId || sprite?.id,
    variant_type: variantType,
    name: variant.name,
    official_name: variant.officialName || variant.name,
    slug: variant.slug || null,
    rarity: spriteRarity,
    release_status: variant.releaseStatus || null,
    first_observed_at: variant.firstObservedAt || null,
    summon_cost: variant.summonCostSpriteDust ?? null,
    sprite_chest_drop_chance_pct: variant.spriteChestDropChancePct ?? null,
    extra_effect_ref: variant.extraEffectRef || null,
    effect: variant.effect || null,
    acquisition: variant.acquisition || sprite?.acquisition || null,
    image_path: variant.imagePath || null,
    suggested_image_path: variant.suggestedImagePath || null,
    availability: variant.availability || null,
    recurrence:
      typeof variant.recurrence === "object"
        ? variant.recurrence
        : variant.availability?.recurrence
          ? { status: variant.availability.recurrence }
          : null,
    dates: variant.dates || null,
    data_status: variant.dataStatus || null,
    sources: variant.sourceIds || null
  });
}

async function loadHistory(client, entityType, entityId) {
  const result = await client.query(
    `SELECT field, previous_value, new_value, changed_at, changed_by, reason, source_id
     FROM catalog_change_history
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY changed_at ASC, id ASC`,
    [entityType, entityId]
  );
  return result.rows;
}

async function deleteEntityEvents(client, entityType, entityId) {
  await client.query(`DELETE FROM catalog_registry_events WHERE entity_type = $1 AND entity_id = $2`, [
    entityType,
    entityId
  ]);
}

async function insertChainedEvent(client, event) {
  const {
    entityType,
    entityId,
    parentSpriteId,
    seq,
    eventType,
    occurredAt,
    source,
    actorLabel,
    actorUserId = null,
    payload,
    prevContentHash
  } = event;
  const occurredIso = new Date(occurredAt).toISOString();
  const contentHash = computeContentHash({
    entityType,
    entityId,
    parentSpriteId,
    seq,
    eventType,
    occurredAt: occurredIso,
    source,
    payload,
    prevContentHash
  });
  await client.query(
    `INSERT INTO catalog_registry_events (
       entity_type, entity_id, parent_sprite_id, seq, event_type,
       occurred_at, source, actor_user_id, actor_label, payload,
       content_hash, prev_content_hash
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6::timestamptz, $7, $8, $9, $10::jsonb,
       $11, $12
     )`,
    [
      entityType,
      entityId,
      parentSpriteId,
      seq,
      eventType,
      occurredIso,
      source,
      actorUserId,
      actorLabel,
      JSON.stringify(payload),
      contentHash,
      prevContentHash
    ]
  );
  return { contentHash, occurredIso, seq };
}

async function setProjectionTip(client, entityType, entityId, seq, contentHash, status = REGISTRY_STATUSES.ACTIVE) {
  const table = entityType === "variant" ? "sprite_variants" : "sprites";
  await client.query(
    `UPDATE ${table}
     SET registry_seq = $2, registry_hash = $3, registry_status = $4
     WHERE id = $1`,
    [entityId, seq, contentHash, status]
  );
}

function foldState(initial, steps) {
  let fields = { ...initial };
  for (const step of steps) {
    fields = { ...fields, ...step.patch };
  }
  return fields;
}

async function rebuildEntityChain(
  client,
  {
    entityType,
    entityId,
    parentSpriteId = null,
    currentSnapshot,
    catalogSnapshot = null,
    catalogOccurredAt = null,
    genesisOccurredAt = null
  }
) {
  const history = await loadHistory(client, entityType, entityId);
  const current = pickSnapshot(entityType, currentSnapshot);
  let initial;
  let forwardSteps = [];
  let genesisSource = SOURCES.SYSTEM;
  const genesisType = entityType === "variant" ? EVENT_TYPES.VARIANT_CREATED : EVENT_TYPES.SPRITE_CREATED;
  let genesisAt = genesisOccurredAt || new Date().toISOString();

  if (history.length) {
    initial = pickSnapshot(entityType, reverseToInitialSnapshot(current, history));
    forwardSteps = forwardPatchesFromHistory(history).map((step) => ({
      ...step,
      source: SOURCES.SYSTEM,
      eventType: entityType === "variant" ? EVENT_TYPES.VARIANT_UPDATED : EVENT_TYPES.SPRITE_UPDATED
    }));
    genesisAt = history[0].changed_at || genesisAt;
  } else if (catalogSnapshot) {
    initial = pickSnapshot(entityType, catalogSnapshot);
    genesisSource = SOURCES.IMPORT;
    genesisAt = catalogOccurredAt || genesisAt;
    const patch = diffPatch(initial, current);
    if (Object.keys(patch).length) {
      forwardSteps = [
        {
          patch,
          occurredAt: genesisOccurredAt || new Date().toISOString(),
          actorLabel: "backfill-diff",
          reason: "Diff between dated catalog snapshot and current projection",
          source: SOURCES.SYSTEM,
          eventType: entityType === "variant" ? EVENT_TYPES.VARIANT_UPDATED : EVENT_TYPES.SPRITE_UPDATED
        }
      ];
    }
  } else {
    initial = current;
    genesisSource = SOURCES.SEED;
  }

  // Ensure the folded chain ends on the live projection (history may be incomplete).
  const folded = pickSnapshot(entityType, foldState(initial, forwardSteps));
  const reconcile = diffPatch(folded, current);
  if (Object.keys(reconcile).length) {
    forwardSteps.push({
      patch: reconcile,
      occurredAt: genesisOccurredAt || new Date().toISOString(),
      actorLabel: "backfill-reconcile",
      reason: "Reconcile reconstructed history with current projection",
      source: SOURCES.SYSTEM,
      eventType: entityType === "variant" ? EVENT_TYPES.VARIANT_UPDATED : EVENT_TYPES.SPRITE_UPDATED
    });
  }

  await deleteEntityEvents(client, entityType, entityId);

  let prevHash = null;
  let seq = 1;
  const created = await insertChainedEvent(client, {
    entityType,
    entityId,
    parentSpriteId,
    seq,
    eventType: genesisType,
    occurredAt: genesisAt,
    source: genesisSource,
    actorLabel: "history-backfill",
    payload: { snapshot: initial, backfilled: true },
    prevContentHash: null
  });
  prevHash = created.contentHash;

  for (const step of forwardSteps) {
    seq += 1;
    const inserted = await insertChainedEvent(client, {
      entityType,
      entityId,
      parentSpriteId,
      seq,
      eventType: step.eventType,
      occurredAt: step.occurredAt || genesisAt,
      source: step.source || SOURCES.SYSTEM,
      actorLabel: step.actorLabel || "history-backfill",
      payload: {
        patch: step.patch,
        reason: step.reason || null,
        field: step.field || null,
        backfilled: true
      },
      prevContentHash: prevHash
    });
    prevHash = inserted.contentHash;
  }

  await setProjectionTip(client, entityType, entityId, seq, prevHash);

  // Create projection row when materializing catalog-only variants.
  const table = entityType === "variant" ? "sprite_variants" : "sprites";
  const exists = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [entityId]);
  if (!exists.rows.length) {
    const { applyProjection } = require("./project");
    const { reduceEvents } = require("./reduce");
    const events = await client.query(
      `SELECT * FROM catalog_registry_events WHERE entity_type = $1 AND entity_id = $2 ORDER BY seq ASC`,
      [entityType, entityId]
    );
    const state = reduceEvents(events.rows, { entityType, entityId, parentSpriteId });
    await applyProjection(client, state, { seq, contentHash: prevHash });
  }

  return { entityType, entityId, seq, tipHash: prevHash, historyEvents: history.length, steps: forwardSteps.length };
}

async function backfillCatalogRegistryFromHistory(db, { catalogPath = null } = {}) {
  const { ensureCatalogRegistrySchema } = require("./schema");
  const { isPgPool } = require("./bootstrap");
  await ensureCatalogRegistrySchema(db);

  let catalog = null;
  let catalogOccurredAt = null;
  let catalogVersion = null;
  if (catalogPath !== false) {
    try {
      const { loadCatalog, DEFAULT_CATALOG_PATH } = require("../../scripts/catalog-loader");
      catalog = loadCatalog(catalogPath || DEFAULT_CATALOG_PATH);
      catalogOccurredAt = catalog.generatedAt || (catalog.asOf ? `${catalog.asOf}T00:00:00.000Z` : null);
      catalogVersion = catalog.catalogueVersion || null;
    } catch (err) {
      console.warn(`[catalog-backfill] catalog snapshot unavailable: ${err.message}`);
    }
  }

  const catalogSprites = new Map();
  const catalogVariants = new Map();
  if (catalog) {
    for (const sprite of catalog.sprites || []) {
      catalogSprites.set(
        sprite.id,
        snapshotFromCatalogSprite(sprite, { version: catalogVersion, generatedAt: catalogOccurredAt })
      );
      for (const variant of sprite.variants || []) {
        catalogVariants.set(variant.id, {
          parentSpriteId: variant.spriteId || sprite.id,
          snapshot: snapshotFromCatalogVariant(variant, sprite)
        });
      }
    }
    for (const sprite of catalog.unreleasedContent?.baseSprites || []) {
      catalogSprites.set(
        sprite.id,
        snapshotFromCatalogSprite(sprite, {
          version: catalogVersion,
          generatedAt: catalogOccurredAt,
          isReleased: false
        })
      );
    }
  }

  const fromPool = isPgPool(db);
  const client = fromPool ? await db.connect() : db;
  const report = { sprites: 0, variants: 0, variantsCreated: 0 };
  try {
    if (fromPool) await client.query("BEGIN");
    await withAppendOnlyDisabled(client, async () => {
      const sprites = await client.query(`SELECT * FROM sprites ORDER BY id`);
      for (const row of sprites.rows) {
        await rebuildEntityChain(client, {
          entityType: "sprite",
          entityId: row.id,
          currentSnapshot: snapshotFromRow("sprite", row),
          catalogSnapshot: catalogSprites.get(row.id) || null,
          catalogOccurredAt,
          genesisOccurredAt: row.created_at || catalogOccurredAt
        });
        report.sprites += 1;
      }

      const variants = await client.query(`SELECT * FROM sprite_variants ORDER BY id`);
      const existingVariantIds = new Set(variants.rows.map((row) => row.id));
      for (const row of variants.rows) {
        await rebuildEntityChain(client, {
          entityType: "variant",
          entityId: row.id,
          parentSpriteId: row.sprite_id,
          currentSnapshot: snapshotFromRow("variant", row),
          catalogSnapshot: catalogVariants.get(row.id)?.snapshot || null,
          catalogOccurredAt,
          genesisOccurredAt: row.created_at || catalogOccurredAt
        });
        report.variants += 1;
      }

      for (const [variantId, info] of catalogVariants.entries()) {
        if (existingVariantIds.has(variantId)) continue;
        const parentExists = await client.query(`SELECT 1 FROM sprites WHERE id = $1`, [info.parentSpriteId]);
        if (!parentExists.rows.length) continue;
        await rebuildEntityChain(client, {
          entityType: "variant",
          entityId: variantId,
          parentSpriteId: info.parentSpriteId,
          currentSnapshot: info.snapshot,
          catalogSnapshot: info.snapshot,
          catalogOccurredAt,
          genesisOccurredAt: catalogOccurredAt
        });
        report.variantsCreated += 1;
      }
    });
    if (fromPool) await client.query("COMMIT");
  } catch (err) {
    if (fromPool) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (fromPool) client.release();
  }
  return report;
}

module.exports = {
  withAppendOnlyDisabled,
  snapshotFromCatalogSprite,
  snapshotFromCatalogVariant,
  rebuildEntityChain,
  backfillCatalogRegistryFromHistory,
  pickSnapshot
};
