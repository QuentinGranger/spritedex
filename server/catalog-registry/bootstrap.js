"use strict";

const { computeContentHash } = require("./hash");
const { EVENT_TYPES, SOURCES, REGISTRY_STATUSES } = require("./types");
const { snapshotFromRow } = require("./reduce");
const { ensureCatalogRegistrySchema } = require("./schema");

/** pg.Pool exposes totalCount; a connected Client also has .connect() and must not be reconnected. */
function isPgPool(db) {
  return Boolean(db && typeof db.connect === "function" && typeof db.query === "function" && "totalCount" in db);
}

/**
 * Emit genesis bootstrap events for every existing sprite/variant that lacks a registry chain.
 * Idempotent: entities that already have events are skipped.
 *
 * Accepts a Pool or an open client. When given a client, the caller owns the transaction.
 */
async function bootstrapCatalogRegistry(db, { source = SOURCES.BOOTSTRAP, actorLabel = "bootstrap" } = {}) {
  await ensureCatalogRegistrySchema(db);

  const fromPool = isPgPool(db);
  const client = fromPool ? await db.connect() : db;
  let spritesBootstrapped = 0;
  let variantsBootstrapped = 0;
  try {
    if (fromPool) await client.query("BEGIN");

    const sprites = await client.query(`SELECT * FROM sprites ORDER BY id`);
    for (const row of sprites.rows) {
      const existing = await client.query(
        `SELECT 1 FROM catalog_registry_events WHERE entity_type = 'sprite' AND entity_id = $1 LIMIT 1`,
        [row.id]
      );
      if (existing.rows.length) continue;
      await insertBootstrapEvent(client, {
        entityType: "sprite",
        entityId: row.id,
        parentSpriteId: null,
        eventType: EVENT_TYPES.SPRITE_BOOTSTRAP,
        snapshot: snapshotFromRow("sprite", row),
        source,
        actorLabel,
        occurredAt: row.created_at || new Date().toISOString()
      });
      spritesBootstrapped += 1;
    }

    const variants = await client.query(`SELECT * FROM sprite_variants ORDER BY id`);
    for (const row of variants.rows) {
      const existing = await client.query(
        `SELECT 1 FROM catalog_registry_events WHERE entity_type = 'variant' AND entity_id = $1 LIMIT 1`,
        [row.id]
      );
      if (existing.rows.length) continue;
      await insertBootstrapEvent(client, {
        entityType: "variant",
        entityId: row.id,
        parentSpriteId: row.sprite_id,
        eventType: EVENT_TYPES.VARIANT_BOOTSTRAP,
        snapshot: snapshotFromRow("variant", row),
        source,
        actorLabel,
        occurredAt: row.created_at || new Date().toISOString()
      });
      variantsBootstrapped += 1;
    }

    if (fromPool) await client.query("COMMIT");
  } catch (err) {
    if (fromPool) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (fromPool) client.release();
  }

  return { spritesBootstrapped, variantsBootstrapped };
}

async function insertBootstrapEvent(
  client,
  { entityType, entityId, parentSpriteId, eventType, snapshot, source, actorLabel, occurredAt }
) {
  const occurredIso = new Date(occurredAt).toISOString();
  const payload = { snapshot };
  const contentHash = computeContentHash({
    entityType,
    entityId,
    parentSpriteId,
    seq: 1,
    eventType,
    occurredAt: occurredIso,
    source,
    payload,
    prevContentHash: null
  });

  await client.query(
    `INSERT INTO catalog_registry_events (
       entity_type, entity_id, parent_sprite_id, seq, event_type,
       occurred_at, source, actor_label, payload, content_hash, prev_content_hash
     ) VALUES (
       $1, $2, $3, 1, $4,
       $5::timestamptz, $6, $7, $8::jsonb, $9, NULL
     )`,
    [
      entityType,
      entityId,
      parentSpriteId,
      eventType,
      occurredIso,
      source,
      actorLabel,
      JSON.stringify(payload),
      contentHash
    ]
  );

  const table = entityType === "variant" ? "sprite_variants" : "sprites";
  await client.query(
    `UPDATE ${table}
     SET registry_seq = 1,
         registry_hash = $2,
         registry_status = $3
     WHERE id = $1`,
    [entityId, contentHash, REGISTRY_STATUSES.ACTIVE]
  );
}

module.exports = { bootstrapCatalogRegistry, isPgPool };
