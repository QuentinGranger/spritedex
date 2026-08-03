"use strict";

const { computeContentHash } = require("./hash");
const { reconstructEntity } = require("./reconstruct");
const { canonicalJson } = require("./hash");

async function verifyEntityChain(db, entityType, entityId, client = null) {
  const runner = client || db;
  const { events, state } = await reconstructEntity(runner, entityType, entityId);
  const errors = [];
  if (!events.length) {
    return { ok: false, entityType, entityId, errors: ["no_events"], events: [], state: null };
  }

  let expectedPrev = null;
  for (const event of events) {
    if (Number(event.seq) === 1 && event.prev_content_hash != null) {
      errors.push(`seq_1_has_prev:${event.seq}`);
    }
    if (Number(event.seq) > 1 && event.prev_content_hash !== expectedPrev) {
      errors.push(`prev_mismatch:seq=${event.seq}`);
    }
    const expectedHash = computeContentHash({
      entityType: event.entity_type,
      entityId: event.entity_id,
      parentSpriteId: event.parent_sprite_id,
      seq: Number(event.seq),
      eventType: event.event_type,
      occurredAt: new Date(event.occurred_at).toISOString(),
      source: event.source,
      payload: event.payload,
      prevContentHash: event.prev_content_hash
    });
    if (expectedHash !== event.content_hash) {
      errors.push(`content_hash_mismatch:seq=${event.seq}`);
    }
    expectedPrev = event.content_hash;
  }

  const table = entityType === "variant" ? "sprite_variants" : "sprites";
  const projection = await runner.query(
    `SELECT id, registry_seq, registry_hash, registry_status FROM ${table} WHERE id = $1`,
    [entityId]
  );
  if (!projection.rows.length) {
    errors.push("missing_projection");
  } else {
    const row = projection.rows[0];
    const tip = events[events.length - 1];
    if (Number(row.registry_seq) !== Number(tip.seq)) errors.push("projection_seq_desync");
    if (row.registry_hash !== tip.content_hash) errors.push("projection_hash_desync");
    if (state && row.registry_status !== state.status) errors.push("projection_status_desync");
  }

  return {
    ok: errors.length === 0,
    entityType,
    entityId,
    errors,
    tipHash: events[events.length - 1]?.content_hash || null,
    tipSeq: events[events.length - 1]?.seq || null,
    state
  };
}

async function verifyAllCatalogRegistry(db, { limit = null } = {}) {
  const entities = await db.query(
    `SELECT DISTINCT entity_type, entity_id
     FROM catalog_registry_events
     ORDER BY entity_type, entity_id
     ${limit ? `LIMIT ${Number(limit)}` : ""}`
  );
  const results = [];
  let failed = 0;
  for (const row of entities.rows) {
    const result = await verifyEntityChain(db, row.entity_type, row.entity_id);
    results.push(result);
    if (!result.ok) failed += 1;
  }

  // Projections with registry_hash but no events are also failures.
  const orphanSprites = await db.query(
    `SELECT id FROM sprites
     WHERE registry_hash IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM catalog_registry_events e
         WHERE e.entity_type = 'sprite' AND e.entity_id = sprites.id
       )`
  );
  const orphanVariants = await db.query(
    `SELECT id FROM sprite_variants
     WHERE registry_hash IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM catalog_registry_events e
         WHERE e.entity_type = 'variant' AND e.entity_id = sprite_variants.id
       )`
  );
  for (const row of orphanSprites.rows) {
    failed += 1;
    results.push({
      ok: false,
      entityType: "sprite",
      entityId: row.id,
      errors: ["projection_without_events"]
    });
  }
  for (const row of orphanVariants.rows) {
    failed += 1;
    results.push({
      ok: false,
      entityType: "variant",
      entityId: row.id,
      errors: ["projection_without_events"]
    });
  }

  return {
    ok: failed === 0,
    checked: results.length,
    failed,
    results: results.filter((r) => !r.ok),
    digest: canonicalJson({ checked: results.length, failed })
  };
}

module.exports = { verifyEntityChain, verifyAllCatalogRegistry };
