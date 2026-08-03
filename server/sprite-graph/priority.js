"use strict";

const { pool } = require("../db");
const { GRAPH_EVENT_TYPES, GRAPH_EVENT_VERSIONS } = require("./constants");
const { normalizeIntId } = require("./normalization");
const { recordGraphEvent } = require("./events");

/**
 * Étape 11 — stable deduplication key.
 * Example: collection.sprite_added:42:sprite_water_gold:create
 */
function buildDeduplicationKey(eventType, ...parts) {
  const clean = [eventType, ...parts]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/:/g, "_"));
  return clean.join(":").slice(0, 255);
}

function resolvePriorityLevel(change, newPriority) {
  if (change.priorityLevel != null) return String(change.priorityLevel);
  if (newPriority && newPriority !== "none") return String(newPriority);
  return "high";
}

/**
 * Étape 16 — emit when collection status becomes `priority`.
 * May be recorded in addition to collection.status_changed.
 */
async function recordPriorityAddedEvent(
  actor,
  {
    spriteId,
    variantId,
    previousStatus,
    newPriority,
    priorityLevel,
    eventId = null,
    catalogueVersion = null,
    changeId = null,
    source,
    origin,
    occurredAt,
    updateMethod = null,
    db = pool,
    throwOnError = false,
    governanceAcceptance = null
  }
) {
  const level = priorityLevel || resolvePriorityLevel({ priorityLevel }, newPriority);
  const dedupePart = changeId || `${previousStatus == null ? "absent" : previousStatus}->priority`;
  return recordGraphEvent(
    db,
    {
      eventType: GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
      eventVersion: GRAPH_EVENT_VERSIONS[GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED],
      actorUserId: actor,
      spriteId,
      variantId,
      source,
      origin,
      occurredAt,
      updateMethod,
      context: {
        previousStatus: previousStatus == null ? "absent" : previousStatus,
        priorityLevel: level,
        eventId: eventId || null,
        catalogueVersion: catalogueVersion || null,
        ...(updateMethod ? { updateMethod } : {})
      },
      deduplicationKey: buildDeduplicationKey(GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED, actor, variantId, dedupePart)
    },
    { throwOnError, governanceAcceptance }
  );
}

/**
 * Étape 17 — distinguish current priorities vs historical interest.
 * - currentPriorities: état métier (sprite_entries.status = priority)
 * - historicalPriorityAdds: tous les events priority_added (effectifs)
 * - uniqueUsersWhoPrioritized: acteurs distincts de ces events
 */
async function getPriorityInterestMetrics(db = pool, { days = 30 } = {}) {
  const windowDays = Math.max(1, Math.min(365, Number(days) || 30));
  const current = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(DISTINCT user_id)::int AS users
     FROM sprite_entries
     WHERE status = 'priority'`
  );
  const historical = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(DISTINCT actor_user_id)::int AS users
     FROM graph_events_effective
     WHERE event_type = $1
       AND occurred_at > NOW() - ($2::int * INTERVAL '1 day')`,
    [GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED, windowDays]
  );
  return {
    days: windowDays,
    currentPriorities: current.rows[0].total || 0,
    currentUsersWithPriority: current.rows[0].users || 0,
    historicalPriorityAdds: historical.rows[0].total || 0,
    uniqueUsersWhoPrioritized: historical.rows[0].users || 0
  };
}

module.exports = { buildDeduplicationKey, resolvePriorityLevel, recordPriorityAddedEvent, getPriorityInterestMetrics };
