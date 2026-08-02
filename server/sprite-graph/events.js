"use strict";

const crypto = require("crypto");
const { pool } = require("../db");
const { GRAPH_RECORDABLE_EVENT_TYPE_SET } = require("./constants");
const { buildGraphEventEnvelope, rowToGraphEventEnvelope, normalizeIntId, normalizeContext } = require("./normalization");

/**
 * Append one structured graph event. Silent no-op on unknown types.
 * Dedup via unique `deduplication_key` (NULL allowed many times).
 * Never updates existing rows (Étape 6).
 * @returns {Promise<object|null>} camelCase envelope or null if skipped/deduped
 */
async function recordGraphEvent(db, input = {}, {
  throwOnError = false,
  enqueueOutbox = true,
  governanceAcceptance = null,
  skipGovernance = false
} = {}) {
  const client = db && typeof db.query === "function" ? db : pool;
  const envelope = buildGraphEventEnvelope(input);
  if (!GRAPH_RECORDABLE_EVENT_TYPE_SET.has(envelope.eventType)) return null;

  // Étape 69–70 — abuse / import gates (imports are not penalized).
  if (!skipGovernance) {
    const gov = require("../sprite-graph-governance");
    const acceptance = governanceAcceptance || await gov.evaluateGraphEventAcceptance(client, {
      actorUserId: envelope.actorUserId,
      source: envelope.source,
      origin: envelope.context?.origin || input.origin || null,
      updateMethod: envelope.context?.updateMethod || input.updateMethod || null,
      changeCount: 1,
      previousCollectionCount: input.previousCollectionCount
    });
    if (!acceptance.accept) return null;
    if (acceptance.updateMethod && !envelope.context.updateMethod) {
      envelope.context.updateMethod = acceptance.updateMethod;
    }
    if (!gov.shouldCountEventTowardCommunity(acceptance)) {
      envelope.context.graphEligibility = "excluded";
      envelope.context.excludeReason = acceptance.reason || "excluded";
    }
    if (acceptance.isNewAccount) {
      envelope.context.accountAgeBucket = "new";
    }
  }

  try {
    const result = await client.query(
      `INSERT INTO graph_events (
         id, event_type, event_version,
         actor_user_id, target_user_id,
         sprite_id, variant_id,
         squad_id, comparison_id, friendship_id, goal_id, notification_id,
         source, context, occurred_at, deduplication_key
       ) VALUES (
         $1::uuid, $2, $3,
         $4, $5,
         $6, $7,
         $8, $9::uuid, $10::uuid, $11::uuid, $12,
         $13, $14::jsonb, $15::timestamptz, $16
       )
       ON CONFLICT (deduplication_key) DO NOTHING
       RETURNING *`,
      [
        envelope.id,
        envelope.eventType,
        envelope.eventVersion,
        envelope.actorUserId,
        envelope.targetUserId,
        envelope.spriteId,
        envelope.variantId,
        envelope.squadId,
        envelope.comparisonId,
        envelope.friendshipId,
        envelope.goalId,
        envelope.notificationId,
        envelope.source,
        JSON.stringify(envelope.context),
        envelope.occurredAt,
        envelope.deduplicationKey ? String(envelope.deduplicationKey).slice(0, 255) : null
      ]
    );
    const row = result.rows[0] || null;
    // Étape 97 — ops: count dedup skips (insert conflict → no row).
    if (!row && envelope.deduplicationKey) {
      try {
        await require("../sprite-graph-metrics").bumpOpsCounter(
          client,
          require("../sprite-graph-metrics").GRAPH_OPS_COUNTERS.DEDUP_SKIPS,
          1
        );
      } catch (_) { /* ops best-effort */ }
    }
    // Étape 31 — same connection/TX: graph event → outbox entry.
    if (row && enqueueOutbox) {
      await require("../sprite-graph-outbox").enqueueGraphEventOutbox(client, row.id, {
        throwOnError
      });
    }
    return rowToGraphEventEnvelope(row);
  } catch (err) {
    console.error("[sprite-graph] recordGraphEvent failed:", err.message);
    try {
      await require("../sprite-graph-metrics").bumpOpsCounter(
        client,
        require("../sprite-graph-metrics").GRAPH_OPS_COUNTERS.RECORD_ERRORS,
        1
      );
    } catch (_) { /* ops best-effort */ }
    if (throwOnError) throw err;
    return null;
  }
}

function recordGraphEventSafe(input) {
  return recordGraphEvent(pool, input).catch((err) => {
    console.error("[sprite-graph] recordGraphEventSafe failed:", err.message);
    return null;
  });
}

async function isGraphEventCancelled(eventId, db = pool) {
  if (!eventId) return false;
  const result = await db.query(
    `SELECT 1 FROM graph_event_corrections WHERE cancelled_event_id = $1::uuid LIMIT 1`,
    [eventId]
  );
  return result.rows.length > 0;
}

/**
 * Étape 6 — cancel a bad event without mutating it.
 * Optionally insert a corrective event, then link both in graph_event_corrections.
 *
 * @param {object} opts
 * @param {string} opts.cancelledEventId
 * @param {string} opts.reason
 * @param {number} [opts.correctedBy]
 * @param {object} [opts.correctiveEvent] — same shape as recordGraphEvent input
 * @param {object} [opts.context]
 */
async function correctGraphEvent(db, opts = {}) {
  const client = db && typeof db.query === "function" ? db : pool;
  const cancelledEventId = opts.cancelledEventId || opts.cancelled_event_id;
  const reason = String(opts.reason || "").trim();
  if (!cancelledEventId || !reason) {
    return { ok: false, error: "cancelledEventId and reason are required" };
  }

  const existing = await client.query(
    `SELECT id, event_type FROM graph_events WHERE id = $1::uuid`,
    [cancelledEventId]
  );
  if (!existing.rows.length) {
    return { ok: false, error: "event_not_found" };
  }
  if (await isGraphEventCancelled(cancelledEventId, client)) {
    return { ok: false, error: "already_cancelled" };
  }

  let corrective = null;
  if (opts.correctiveEvent && typeof opts.correctiveEvent === "object") {
    corrective = await recordGraphEvent(client, {
      ...opts.correctiveEvent,
      source: opts.correctiveEvent.source || "admin",
      defaultSource: "admin",
      origin: opts.correctiveEvent.origin || "graph.correction"
    });
    if (!corrective) {
      return { ok: false, error: "corrective_insert_failed" };
    }
  }

  const correctionId = crypto.randomUUID();
  try {
    const result = await client.query(
      `INSERT INTO graph_event_corrections (
         id, cancelled_event_id, corrective_event_id, reason, corrected_by, context
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
       RETURNING *`,
      [
        correctionId,
        cancelledEventId,
        corrective ? corrective.id : null,
        reason.slice(0, 2000),
        normalizeIntId(opts.correctedBy ?? opts.corrected_by),
        JSON.stringify(normalizeContext(opts.context))
      ]
    );
    return {
      ok: true,
      correction: result.rows[0],
      cancelledEventId,
      correctiveEvent: corrective
    };
  } catch (err) {
    console.error("[sprite-graph] correctGraphEvent failed:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { recordGraphEvent, recordGraphEventSafe, isGraphEventCancelled, correctGraphEvent };
