"use strict";

const { computeContentHash } = require("./hash");
const {
  ENTITY_TYPES,
  GENESIS_EVENT_TYPES,
  UPDATE_EVENT_TYPES,
  ARCHIVE_EVENT_TYPES,
  isVariantEntity
} = require("./types");
const { applyEvent, reduceEvents, snapshotFromRow } = require("./reduce");
const { applyProjection } = require("./project");

class CatalogRegistryError extends Error {
  constructor(message, code = "registry_error") {
    super(message);
    this.name = "CatalogRegistryError";
    this.code = code;
  }
}

async function lockEntity(client, entityType, entityId) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`catalog-registry:${entityType}:${entityId}`]);
}

async function latestEvent(client, entityType, entityId) {
  const result = await client.query(
    `SELECT id, entity_type, entity_id, parent_sprite_id, seq, event_type, occurred_at,
            source, actor_user_id, actor_label, payload, content_hash, prev_content_hash
     FROM catalog_registry_events
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY seq DESC
     LIMIT 1`,
    [entityType, entityId]
  );
  return result.rows[0] || null;
}

async function loadEvents(client, entityType, entityId) {
  const result = await client.query(
    `SELECT id, entity_type, entity_id, parent_sprite_id, seq, event_type, occurred_at,
            recorded_at, source, actor_user_id, actor_label, payload, content_hash, prev_content_hash
     FROM catalog_registry_events
     WHERE entity_type = $1 AND entity_id = $2
     ORDER BY seq ASC`,
    [entityType, entityId]
  );
  return result.rows;
}

/**
 * Append an immutable catalog registry event and update the projection.
 * Pass an existing client to participate in a larger transaction.
 */
async function appendCatalogEvent(db, input) {
  const {
    entityType,
    entityId,
    parentSpriteId = null,
    eventType,
    payload = {},
    source,
    actorUserId = null,
    actorLabel = null,
    occurredAt = new Date().toISOString(),
    client: externalClient = null
  } = input;

  if (!ENTITY_TYPES.includes(entityType)) {
    throw new CatalogRegistryError(`Invalid entityType: ${entityType}`, "invalid_entity_type");
  }
  if (!entityId || typeof entityId !== "string") {
    throw new CatalogRegistryError("entityId is required", "invalid_entity_id");
  }
  if (!source) throw new CatalogRegistryError("source is required", "invalid_source");
  if (!eventType) throw new CatalogRegistryError("eventType is required", "invalid_event_type");

  if (isVariantEntity(entityType) && !parentSpriteId && !GENESIS_EVENT_TYPES.has(eventType)) {
    // parent required for variants; genesis may carry it in payload.snapshot.sprite_id
  }
  if (isVariantEntity(entityType) && GENESIS_EVENT_TYPES.has(eventType)) {
    const parent = parentSpriteId || payload?.snapshot?.sprite_id;
    if (!parent) throw new CatalogRegistryError("variant genesis requires parentSpriteId", "missing_parent");
  }
  if (!isVariantEntity(entityType) && parentSpriteId) {
    throw new CatalogRegistryError("sprites cannot have parentSpriteId", "invalid_parent");
  }

  const { isPgPool } = require("./bootstrap");
  let client = externalClient || null;
  let ownClient = false;
  if (!client) {
    if (isPgPool(db)) {
      client = await db.connect();
      ownClient = true;
    } else {
      client = db;
    }
  }
  try {
    if (ownClient) await client.query("BEGIN");
    await lockEntity(client, entityType, entityId);

    const previous = await latestEvent(client, entityType, entityId);
    const seq = previous ? Number(previous.seq) + 1 : 1;
    const prevContentHash = previous ? previous.content_hash : null;

    if (GENESIS_EVENT_TYPES.has(eventType) && previous) {
      throw new CatalogRegistryError(
        `Entity ${entityType}:${entityId} already has a registry identity`,
        "identity_exists"
      );
    }
    if (!GENESIS_EVENT_TYPES.has(eventType) && !previous) {
      throw new CatalogRegistryError(
        `Entity ${entityType}:${entityId} has no genesis event; create or bootstrap first`,
        "missing_genesis"
      );
    }

    let resolvedParent = parentSpriteId;
    if (isVariantEntity(entityType)) {
      if (previous) {
        resolvedParent = previous.parent_sprite_id;
        if (parentSpriteId && parentSpriteId !== resolvedParent) {
          throw new CatalogRegistryError("variant parent_sprite_id is immutable", "parent_immutable");
        }
      } else {
        resolvedParent = parentSpriteId || payload?.snapshot?.sprite_id;
      }
    }

    const occurredIso = new Date(occurredAt).toISOString();
    const contentHash = computeContentHash({
      entityType,
      entityId,
      parentSpriteId: resolvedParent,
      seq,
      eventType,
      occurredAt: occurredIso,
      source,
      payload,
      prevContentHash
    });

    if (previous && prevContentHash !== previous.content_hash) {
      throw new CatalogRegistryError("Previous content hash mismatch", "chain_break");
    }

    const inserted = await client.query(
      `INSERT INTO catalog_registry_events (
         entity_type, entity_id, parent_sprite_id, seq, event_type,
         occurred_at, source, actor_user_id, actor_label, payload,
         content_hash, prev_content_hash
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::timestamptz, $7, $8, $9, $10::jsonb,
         $11, $12
       )
       RETURNING id, entity_type, entity_id, parent_sprite_id, seq, event_type,
                 occurred_at, recorded_at, source, actor_user_id, actor_label,
                 payload, content_hash, prev_content_hash`,
      [
        entityType,
        entityId,
        resolvedParent,
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

    const row = inserted.rows[0];
    const history = await loadEvents(client, entityType, entityId);
    const state = reduceEvents(history, {
      entityType,
      entityId,
      parentSpriteId: resolvedParent
    });
    await applyProjection(client, state, { seq, contentHash });

    if (ownClient) await client.query("COMMIT");
    return { event: row, state };
  } catch (err) {
    if (ownClient) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (ownClient) client.release();
  }
}

/**
 * Create entity (genesis) from a snapshot of projection fields.
 */
async function createCatalogEntity(db, { entityType, entityId, parentSpriteId, snapshot, source, ...rest }) {
  const { genesisEventType } = require("./types");
  return appendCatalogEvent(db, {
    entityType,
    entityId,
    parentSpriteId,
    eventType: genesisEventType(entityType),
    payload: { snapshot },
    source,
    ...rest
  });
}

/**
 * Append a field patch update and refresh projection.
 */
async function updateCatalogEntity(
  db,
  { entityType, entityId, parentSpriteId, patch, previous, reason, source, ...rest }
) {
  const { updateEventType } = require("./types");
  if (!patch || !Object.keys(patch).length) {
    throw new CatalogRegistryError("patch must not be empty", "empty_patch");
  }
  return appendCatalogEvent(db, {
    entityType,
    entityId,
    parentSpriteId,
    eventType: updateEventType(entityType),
    payload: { patch, previous: previous || null, reason: reason || null },
    source,
    ...rest
  });
}

/**
 * Soft-delete via archive / withdraw event (never physical delete).
 */
async function archiveCatalogEntity(
  db,
  { entityType, entityId, parentSpriteId, reason, withdrawn = false, source, ...rest }
) {
  const { archiveEventType, EVENT_TYPES } = require("./types");
  const eventType =
    entityType === "variant" && withdrawn ? EVENT_TYPES.VARIANT_WITHDRAWN : archiveEventType(entityType);
  return appendCatalogEvent(db, {
    entityType,
    entityId,
    parentSpriteId,
    eventType,
    payload: { reason: reason || null },
    source,
    ...rest
  });
}

module.exports = {
  CatalogRegistryError,
  lockEntity,
  latestEvent,
  loadEvents,
  appendCatalogEvent,
  createCatalogEntity,
  updateCatalogEntity,
  archiveCatalogEntity,
  snapshotFromRow,
  applyEvent
};
