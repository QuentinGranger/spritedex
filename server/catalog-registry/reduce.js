"use strict";

const {
  GENESIS_EVENT_TYPES,
  ARCHIVE_EVENT_TYPES,
  UPDATE_EVENT_TYPES,
  REGISTRY_STATUSES,
  EVENT_TYPES,
  payloadColumns
} = require("./types");

function emptyState(entityType, entityId, parentSpriteId = null) {
  return {
    entityType,
    entityId,
    parentSpriteId: parentSpriteId || null,
    status: REGISTRY_STATUSES.ACTIVE,
    fields: {}
  };
}

function applyEvent(state, event) {
  const next = state
    ? {
        entityType: state.entityType,
        entityId: state.entityId,
        parentSpriteId: state.parentSpriteId,
        status: state.status,
        fields: { ...state.fields }
      }
    : emptyState(event.entityType || event.entity_type, event.entityId || event.entity_id, event.parentSpriteId);

  const eventType = event.eventType || event.event_type;
  const payload = event.payload || {};

  if (GENESIS_EVENT_TYPES.has(eventType)) {
    const snapshot = payload.snapshot || {};
    next.fields = { ...snapshot };
    next.status = REGISTRY_STATUSES.ACTIVE;
    if (next.entityType === "variant") {
      next.parentSpriteId = event.parentSpriteId || event.parent_sprite_id || snapshot.sprite_id || null;
      if (snapshot.sprite_id) next.fields.sprite_id = snapshot.sprite_id;
    }
    return next;
  }

  if (UPDATE_EVENT_TYPES.has(eventType)) {
    const patch = payload.patch || {};
    for (const [key, value] of Object.entries(patch)) {
      next.fields[key] = value;
    }
    return next;
  }

  if (ARCHIVE_EVENT_TYPES.has(eventType)) {
    if (eventType === EVENT_TYPES.VARIANT_WITHDRAWN) {
      next.status = REGISTRY_STATUSES.WITHDRAWN;
    } else {
      next.status = REGISTRY_STATUSES.ARCHIVED;
    }
    return next;
  }

  throw new Error(`Unknown catalog registry event type: ${eventType}`);
}

function reduceEvents(events, { entityType, entityId, parentSpriteId = null } = {}) {
  let state = null;
  for (const event of events) {
    if (!state) {
      state = emptyState(
        entityType || event.entity_type || event.entityType,
        entityId || event.entity_id || event.entityId,
        parentSpriteId || event.parent_sprite_id || event.parentSpriteId
      );
    }
    state = applyEvent(state, event);
  }
  return state;
}

/** Pick only known projection columns from a DB row or object. */
function snapshotFromRow(entityType, row) {
  const columns = payloadColumns(entityType);
  const snapshot = {};
  for (const column of columns) {
    if (row[column] !== undefined) snapshot[column] = row[column];
  }
  return snapshot;
}

module.exports = { emptyState, applyEvent, reduceEvents, snapshotFromRow };
