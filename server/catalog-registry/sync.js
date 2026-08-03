"use strict";

const { createCatalogEntity, updateCatalogEntity, latestEvent, CatalogRegistryError } = require("./append");
const { reconstructEntity } = require("./reconstruct");
const { snapshotFromRow } = require("./reduce");
const { SOURCES } = require("./types");

function valuesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function diffPatch(currentFields, nextSnapshot) {
  const patch = {};
  for (const [key, value] of Object.entries(nextSnapshot)) {
    if (value === undefined) continue;
    if (!valuesEqual(currentFields[key], value)) patch[key] = value;
  }
  return patch;
}

async function syncSpriteSnapshot(
  db,
  { spriteId, snapshot, source, actorLabel = null, actorUserId = null, reason = null, client = null }
) {
  const tip = await latestEvent(client || db, "sprite", spriteId);
  if (!tip) {
    return createCatalogEntity(db, {
      entityType: "sprite",
      entityId: spriteId,
      snapshot,
      source,
      actorLabel,
      actorUserId,
      client
    });
  }
  const { state } = await reconstructEntity(client || db, "sprite", spriteId, client || undefined);
  const patch = diffPatch(state?.fields || {}, snapshot);
  if (!Object.keys(patch).length) return { event: tip, state, skipped: true };
  return updateCatalogEntity(db, {
    entityType: "sprite",
    entityId: spriteId,
    patch,
    previous: Object.fromEntries(Object.keys(patch).map((key) => [key, state.fields[key] ?? null])),
    reason,
    source,
    actorLabel,
    actorUserId,
    client
  });
}

async function syncVariantSnapshot(
  db,
  { variantId, parentSpriteId, snapshot, source, actorLabel = null, actorUserId = null, reason = null, client = null }
) {
  const tip = await latestEvent(client || db, "variant", variantId);
  if (!tip) {
    return createCatalogEntity(db, {
      entityType: "variant",
      entityId: variantId,
      parentSpriteId: parentSpriteId || snapshot.sprite_id,
      snapshot: { ...snapshot, sprite_id: parentSpriteId || snapshot.sprite_id },
      source,
      actorLabel,
      actorUserId,
      client
    });
  }
  const { state } = await reconstructEntity(client || db, "variant", variantId, client || undefined);
  const patch = diffPatch(state?.fields || {}, snapshot);
  if (patch.sprite_id && state.parentSpriteId && patch.sprite_id !== state.parentSpriteId) {
    throw new CatalogRegistryError("variant parent_sprite_id is immutable", "parent_immutable");
  }
  delete patch.sprite_id;
  if (!Object.keys(patch).length) return { event: tip, state, skipped: true };
  return updateCatalogEntity(db, {
    entityType: "variant",
    entityId: variantId,
    parentSpriteId: tip.parent_sprite_id,
    patch,
    previous: Object.fromEntries(Object.keys(patch).map((key) => [key, state.fields[key] ?? null])),
    reason,
    source,
    actorLabel,
    actorUserId,
    client
  });
}

async function patchEntity(
  db,
  {
    entityType,
    entityId,
    parentSpriteId = null,
    patch,
    source,
    actorLabel = null,
    actorUserId = null,
    reason = null,
    client = null
  }
) {
  const runner = client || db;
  let tip = await latestEvent(runner, entityType, entityId);
  if (!tip) {
    const table = entityType === "variant" ? "sprite_variants" : "sprites";
    const row = await runner.query(`SELECT * FROM ${table} WHERE id = $1`, [entityId]);
    if (!row.rows.length) {
      throw new CatalogRegistryError(`${entityType} ${entityId} not found`, "not_found");
    }
    await createCatalogEntity(db, {
      entityType,
      entityId,
      parentSpriteId: entityType === "variant" ? row.rows[0].sprite_id : null,
      snapshot: snapshotFromRow(entityType, row.rows[0]),
      source: SOURCES.BOOTSTRAP,
      actorLabel: actorLabel || "lazy-bootstrap",
      client
    });
    tip = await latestEvent(runner, entityType, entityId);
  }
  if (!patch || !Object.keys(patch).length) {
    throw new CatalogRegistryError("patch must not be empty", "empty_patch");
  }
  const { state } = await reconstructEntity(runner, entityType, entityId, client || undefined);
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, state?.fields?.[key] ?? null]));
  return updateCatalogEntity(db, {
    entityType,
    entityId,
    parentSpriteId: tip.parent_sprite_id || parentSpriteId,
    patch,
    previous,
    reason,
    source,
    actorLabel,
    actorUserId,
    client
  });
}

module.exports = {
  valuesEqual,
  diffPatch,
  syncSpriteSnapshot,
  syncVariantSnapshot,
  patchEntity
};
