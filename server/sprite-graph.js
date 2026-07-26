"use strict";

// ── Sprite Graph — append-only event store (Étapes 1–35) ────────────────────
// Historical memory of SpriteDex. PostgreSQL only; no graph DB in v1.
// Stable event type IDs must not change when UI copy changes.
// graph_events rows are never updated/deleted — corrections are new rows.
// Important events are emitted server-side after authorized, deduped writes
// (Étape 29); critical collection writes share a DB transaction (Étape 30).
// Outbox → simple worker → aggregates (Étapes 31–32). Privacy + levels (33–35).

const crypto = require("crypto");
const { pool } = require("./db");
const {
  GRAPH_DATA_LEVELS,
  GRAPH_DATA_LEVEL_SET,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  GRAPH_CONTEXT_PII_KEYS,
  sanitizeGraphContext,
  classifyGraphDataLevel,
  applyPublicAnonymizationGate
} = require("./sprite-graph-privacy");

const GRAPH_EVENT_TYPES = Object.freeze({
  COLLECTION_SPRITE_ADDED: "collection.sprite_added",
  COLLECTION_STATUS_CHANGED: "collection.status_changed",
  COLLECTION_PRIORITY_ADDED: "collection.priority_added",
  COMPARISON_COMPLETED: "comparison.completed",
  FRIEND_INVITATION_SENT: "friend_invitation.sent",
  SQUAD_JOINED: "squad.joined",
  GOAL_COMPLETED: "goal.completed",
  NOTIFICATION_OPENED: "notification.opened"
});

/**
 * Étape 28 — reserved for later (not emitted in v1).
 * Opened ≠ recommended action taken ≠ conversion.
 */
const FUTURE_GRAPH_EVENT_TYPES = Object.freeze({
  NOTIFICATION_ACTION_CLICKED: "notification.action_clicked",
  NOTIFICATION_CONVERTED: "notification.converted",
  // Étapes 46–47 — real attention signals (not emitted in v1).
  COMPARISON_SPRITE_VIEWED: "comparison.sprite_viewed",
  COMPARISON_FILTER_APPLIED: "comparison.filter_applied",
  COMPARISON_VARIANT_OPENED: "comparison.variant_opened",
  COMPARISON_SPRITE_OPENED: "comparison.sprite_opened"
});

const GRAPH_EVENT_TYPE_SET = new Set(Object.values(GRAPH_EVENT_TYPES));
// V1 keeps its eight business events stable. Interaction signals are an
// additive extension: they are useful for internal product analysis but do
// not alter completion, ownership or public community calculations.
const GRAPH_INTERACTION_EVENT_TYPES = Object.freeze({
  RECOMMENDATION_CLICKED: "recommendation.clicked",
  COMPARISON_FILTER_APPLIED: FUTURE_GRAPH_EVENT_TYPES.COMPARISON_FILTER_APPLIED,
  NOTIFICATION_ACTION_CLICKED: FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED,
  NOTIFICATION_CONVERTED: FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_CONVERTED
});
const GRAPH_INTERACTION_EVENT_TYPE_SET = new Set(Object.values(GRAPH_INTERACTION_EVENT_TYPES));
const GRAPH_RECORDABLE_EVENT_TYPE_SET = new Set([
  ...GRAPH_EVENT_TYPE_SET,
  ...GRAPH_INTERACTION_EVENT_TYPE_SET
]);

/** Étape 26 — goal scope for completion analytics. */
const GOAL_SCOPES = Object.freeze(["personal", "friends", "squad"]);
const GOAL_SCOPE_SET = new Set(GOAL_SCOPES);

/** Étape 9 — canonical interaction sources. */
const GRAPH_SOURCES = Object.freeze([
  "web",
  "ios",
  "android",
  "api",
  "import",
  "admin",
  "system",
  "migration"
]);

const GRAPH_SOURCE_SET = new Set(GRAPH_SOURCES);

/**
 * Étape 10 — current schema version per event type.
 * Bump when the meaning/shape of `context` (or required fields) changes.
 * Old rows keep their recorded event_version.
 */
const GRAPH_EVENT_VERSIONS = Object.freeze({
  [GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED]: 1,
  [GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED]: 1,
  [GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED]: 1,
  [GRAPH_EVENT_TYPES.COMPARISON_COMPLETED]: 2,
  [GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT]: 2,
  [GRAPH_EVENT_TYPES.SQUAD_JOINED]: 2,
  [GRAPH_EVENT_TYPES.GOAL_COMPLETED]: 3,
  [GRAPH_EVENT_TYPES.NOTIFICATION_OPENED]: 2,
  [GRAPH_INTERACTION_EVENT_TYPES.RECOMMENDATION_CLICKED]: 1,
  [GRAPH_INTERACTION_EVENT_TYPES.COMPARISON_FILTER_APPLIED]: 1,
  [GRAPH_INTERACTION_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED]: 1,
  [GRAPH_INTERACTION_EVENT_TYPES.NOTIFICATION_CONVERTED]: 1
});

/** Étape 21 — how a friend invitation was initiated. */
const FRIEND_INVITATION_METHODS = Object.freeze([
  "username",
  "invite_link",
  "qr_code",
  "squad_member",
  "passport"
]);

const FRIEND_INVITATION_METHOD_SET = new Set(FRIEND_INVITATION_METHODS);

/**
 * Étape 22 — public surfaces may only consume these aggregate keys.
 * Never expose actor/target, pending/declined, or individual social history.
 */
const FRIEND_INVITATION_PUBLIC_METRIC_KEYS = Object.freeze([
  "totalInvitationsSent",
  "invitationsByMethod",
  "acceptedCount",
  "acceptanceRate"
]);

/** Common envelope field names (Étape 8) — camelCase API / snake_case DB. */
const GRAPH_EVENT_COMMON_FIELDS = Object.freeze([
  "id",
  "eventType",
  "eventVersion",
  "occurredAt",
  "recordedAt",
  "actorUserId",
  "source",
  "context",
  "deduplicationKey"
]);

const GRAPH_EVENT_SPECIFIC_FIELDS = Object.freeze([
  "targetUserId",
  "spriteId",
  "variantId",
  "squadId",
  "comparisonId",
  "friendshipId",
  "goalId",
  "notificationId"
]);

function isActivePriority(value) {
  const p = String(value || "none").toLowerCase();
  if (!p || p === "none" || p === "ignored") return false;
  return true;
}

function normalizeIntId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function normalizeContext(context) {
  // Étape 33 — strip PII / sensitive profile content before any persistence.
  return sanitizeGraphContext(context);
}

/**
 * Étape 9 — map free-form origins to canonical sources.
 * Detailed origin (e.g. collection.setEntry) is preserved in context.origin.
 */
function normalizeGraphSource(source, { defaultSource = "api" } = {}) {
  const raw = String(source == null ? "" : source).trim().toLowerCase();
  if (GRAPH_SOURCE_SET.has(raw)) return raw;
  if (!raw) return GRAPH_SOURCE_SET.has(defaultSource) ? defaultSource : "system";
  if (raw.includes("import")) return "import";
  if (raw.includes("migration")) return "migration";
  if (raw.includes("admin")) return "admin";
  if (raw === "ios" || raw.startsWith("ios.")) return "ios";
  if (raw === "android" || raw.startsWith("android.")) return "android";
  if (raw === "web" || raw.startsWith("web.")) return "web";
  if (raw.includes("system") || raw.includes("scheduler") || raw.includes("cron")) return "system";
  return GRAPH_SOURCE_SET.has(defaultSource) ? defaultSource : "api";
}

function resolveEventVersion(eventType, explicit) {
  if (Number.isFinite(Number(explicit))) {
    return Math.max(1, Math.floor(Number(explicit)));
  }
  return GRAPH_EVENT_VERSIONS[eventType] || 1;
}

/**
 * Étape 8 — normalize input into the common event structure (+ specific ids).
 */
function buildGraphEventEnvelope(input = {}) {
  const eventType = String(input.eventType || input.event_type || "");
  const origin = input.origin || input.sourceOrigin || null;
  const rawSource = input.source || "api";
  const source = normalizeGraphSource(rawSource, {
    defaultSource: input.defaultSource || "api"
  });
  const context = normalizeContext(input.context);
  if (origin && !context.origin) context.origin = String(origin).slice(0, 120);
  else if (rawSource && !GRAPH_SOURCE_SET.has(String(rawSource).toLowerCase()) && !context.origin) {
    context.origin = String(rawSource).slice(0, 120);
  }

  return {
    id: input.id || crypto.randomUUID(),
    eventType,
    eventVersion: resolveEventVersion(eventType, input.eventVersion ?? input.event_version),
    occurredAt: input.occurredAt || input.occurred_at || new Date().toISOString(),
    recordedAt: input.recordedAt || input.recorded_at || null,
    actorUserId: normalizeIntId(input.actorUserId ?? input.actor_user_id),
    source,
    context,
    deduplicationKey: input.deduplicationKey || input.deduplication_key || null,
    targetUserId: normalizeIntId(input.targetUserId ?? input.target_user_id),
    spriteId: input.spriteId || input.sprite_id || null,
    variantId: input.variantId || input.variant_id || null,
    squadId: normalizeIntId(input.squadId ?? input.squad_id),
    comparisonId: input.comparisonId || input.comparison_id || null,
    friendshipId: input.friendshipId || input.friendship_id || null,
    goalId: input.goalId || input.goal_id || null,
    notificationId: (() => {
      const n = Number(input.notificationId ?? input.notification_id);
      return Number.isSafeInteger(n) && n > 0 ? n : null;
    })()
  };
}

/** Map a DB row → camelCase envelope (Étape 8). */
function rowToGraphEventEnvelope(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorUserId: row.actor_user_id,
    source: row.source,
    context: row.context || {},
    deduplicationKey: row.deduplication_key,
    targetUserId: row.target_user_id,
    spriteId: row.sprite_id,
    variantId: row.variant_id,
    squadId: row.squad_id,
    comparisonId: row.comparison_id,
    friendshipId: row.friendship_id,
    goalId: row.goal_id,
    notificationId: row.notification_id
  };
}

/**
 * Étape 5–6 — central append-only event table + corrections ledger.
 */
async function ensureGraphEventsTable(db = pool) {
  await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      event_type VARCHAR(100) NOT NULL,
      event_version INTEGER NOT NULL DEFAULT 1,

      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

      sprite_id VARCHAR(50),
      variant_id VARCHAR(100),

      squad_id INTEGER REFERENCES squads(id) ON DELETE SET NULL,
      comparison_id UUID,
      friendship_id UUID,
      goal_id UUID,
      notification_id INTEGER,

      source VARCHAR(50) NOT NULL,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,

      occurred_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      deduplication_key VARCHAR(255) UNIQUE
    );

    CREATE INDEX IF NOT EXISTS idx_graph_events_type_occurred
      ON graph_events (event_type, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_events_actor_occurred
      ON graph_events (actor_user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_events_variant_occurred
      ON graph_events (variant_id, occurred_at DESC)
      WHERE variant_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_graph_events_squad_occurred
      ON graph_events (squad_id, occurred_at DESC)
      WHERE squad_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_graph_events_recorded
      ON graph_events (recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_events_source
      ON graph_events (source, occurred_at DESC);
  `);

  // Étape 6 — corrections ledger (never mutate the cancelled row).
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_event_corrections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cancelled_event_id UUID NOT NULL REFERENCES graph_events(id),
      corrective_event_id UUID REFERENCES graph_events(id),
      reason TEXT NOT NULL,
      corrected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      corrected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (cancelled_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_graph_event_corrections_corrective
      ON graph_event_corrections (corrective_event_id)
      WHERE corrective_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_graph_event_corrections_at
      ON graph_event_corrections (corrected_at DESC);
  `);

  // Append-only enforcement: refuse UPDATE/DELETE on graph_events.
  await db.query(`
    CREATE OR REPLACE FUNCTION graph_events_reject_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'graph_events is append-only; use graph_event_corrections';
    END;
    $$;
  `);
  await db.query(`DROP TRIGGER IF EXISTS trg_graph_events_append_only ON graph_events`);
  await db.query(`
    CREATE TRIGGER trg_graph_events_append_only
      BEFORE UPDATE OR DELETE ON graph_events
      FOR EACH ROW
      EXECUTE PROCEDURE graph_events_reject_mutation()
  `);

  // Effective history view (Étape 6–7): raw events minus cancelled ones.
  await db.query(`
    CREATE OR REPLACE VIEW graph_events_effective AS
    SELECT e.*
    FROM graph_events e
    LEFT JOIN graph_event_corrections c ON c.cancelled_event_id = e.id
    WHERE c.id IS NULL
  `);

  // Étape 31–32 — outbox + aggregate tables.
  await require("./sprite-graph-outbox").ensureEventOutboxTables(db);
  // Étape 36–40 — daily / community specialized aggregates.
  await require("./sprite-graph-community").ensureCommunityStatsTables(db);
  // Étape 46–60 — comparison / interest / trends / squad stats / daily pipeline.
  await require("./sprite-graph-comparison-stats").ensureComparisonStatsTables(db);
  await require("./sprite-graph-trends").ensureTrendTables(db);
  await require("./sprite-graph-squad-stats").ensureSquadDailyStatsTables(db);
  await require("./sprite-graph-catalogue").ensureCatalogueVersionColumns(db);
  await require("./sprite-graph-daily").ensureDailyPipelineTables(db);
  // Étape 61–65 — realtime counters + retention tables.
  await require("./sprite-graph-counters").ensureMetricCounterTables(db);
  // Étape 66–70 — governance (consent column already on users via community module).
  await require("./sprite-graph-community").ensureCommunityStatsTables(db);
}

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
    const gov = require("./sprite-graph-governance");
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
        await require("./sprite-graph-metrics").bumpOpsCounter(
          client,
          require("./sprite-graph-metrics").GRAPH_OPS_COUNTERS.DEDUP_SKIPS,
          1
        );
      } catch (_) { /* ops best-effort */ }
    }
    // Étape 31 — same connection/TX: graph event → outbox entry.
    if (row && enqueueOutbox) {
      await require("./sprite-graph-outbox").enqueueGraphEventOutbox(client, row.id, {
        throwOnError
      });
    }
    return rowToGraphEventEnvelope(row);
  } catch (err) {
    console.error("[sprite-graph] recordGraphEvent failed:", err.message);
    try {
      await require("./sprite-graph-metrics").bumpOpsCounter(
        client,
        require("./sprite-graph-metrics").GRAPH_OPS_COUNTERS.RECORD_ERRORS,
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
async function recordPriorityAddedEvent(actor, {
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
}) {
  const level = priorityLevel || resolvePriorityLevel({ priorityLevel }, newPriority);
  const dedupePart = changeId
    || `${previousStatus == null ? "absent" : previousStatus}->priority`;
  return recordGraphEvent(db, {
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
    deduplicationKey: buildDeduplicationKey(
      GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
      actor,
      variantId,
      dedupePart
    )
  }, { throwOnError, governanceAcceptance });
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

/**
 * Étape 20 — unordered social pair (Quentin×Lucy === Lucy×Quentin).
 */
function normalizeComparisonPair(userAId, userBId) {
  const a = normalizeIntId(userAId);
  const b = normalizeIntId(userBId);
  if (!a || !b || a === b) return null;
  const pairUserLowId = Math.min(a, b);
  const pairUserHighId = Math.max(a, b);
  return {
    pairUserLowId,
    pairUserHighId,
    pairKey: `comparison_pair:${pairUserLowId}:${pairUserHighId}`
  };
}

function normalizeInvitationMethod(value, { fallback = "username" } = {}) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (FRIEND_INVITATION_METHOD_SET.has(raw)) return raw;
  if (raw === "username_search" || raw === "search") return "username";
  if (raw === "link" || raw === "invite" || raw === "invite-link") return "invite_link";
  if (raw === "qr" || raw === "qrcode") return "qr_code";
  if (raw === "squad" || raw === "mutual_squad") return "squad_member";
  return FRIEND_INVITATION_METHOD_SET.has(fallback) ? fallback : "username";
}

/**
 * Étape 21 — friend_invitation.sent context.
 * Canonical envelope `source` stays web|ios|android|api|…;
 * social discovery path lives in context.invitationSource.
 */
function buildFriendInvitationSentContext({
  invitationMethod = "username",
  invitationSource = null,
  status = "pending"
} = {}) {
  const method = normalizeInvitationMethod(invitationMethod);
  const sourceHint = invitationSource
    || (method === "username" ? "username_search"
      : method === "invite_link" ? "invite_link"
        : method === "qr_code" ? "qr_code"
          : method === "squad_member" ? "squad_member"
            : method === "passport" ? "passport"
              : "username_search");
  return {
    invitationMethod: method,
    invitationSource: String(sourceHint).slice(0, 80),
    status: status || "pending"
  };
}

/**
 * Étape 22 — aggregate-only public metrics for friend invitations.
 * Does not return who invited whom, pending/declined rows, or social history.
 */
async function getFriendInvitationPublicMetrics(db = pool, { windowDays = null } = {}) {
  const params = [];
  let timeFilter = "";
  if (Number.isFinite(Number(windowDays)) && Number(windowDays) > 0) {
    params.push(Math.floor(Number(windowDays)));
    timeFilter = `AND occurred_at >= NOW() - ($1::int * INTERVAL '1 day')`;
  }

  const sent = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COALESCE(context->>'invitationMethod', 'unknown') AS method
     FROM graph_events
     WHERE event_type = $1
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )
       ${timeFilter}
     GROUP BY 2`,
    [GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT, ...params]
  );

  const invitationsByMethod = {};
  let totalInvitationsSent = 0;
  for (const row of sent.rows) {
    const n = row.total || 0;
    invitationsByMethod[row.method || "unknown"] = n;
    totalInvitationsSent += n;
  }

  // Acceptance rate from friendships that originated as graph-tracked invites.
  // Aggregate counts only — no requester/addressee identifiers.
  const acceptedParams = [GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT];
  let acceptedTime = "";
  if (params.length) {
    acceptedParams.push(params[0]);
    acceptedTime = `AND ge.occurred_at >= NOW() - ($2::int * INTERVAL '1 day')`;
  }
  const accepted = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM graph_events ge
     JOIN friendships f ON f.id = ge.friendship_id
     WHERE ge.event_type = $1
       AND f.status = 'accepted'
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = ge.id
       )
       ${acceptedTime}`,
    acceptedParams
  );
  const acceptedCount = accepted.rows[0]?.n || 0;
  const acceptanceRate = totalInvitationsSent > 0
    ? Math.round((acceptedCount / totalInvitationsSent) * 1000) / 1000
    : 0;

  return {
    totalInvitationsSent,
    invitationsByMethod,
    acceptedCount,
    acceptanceRate
  };
}

/** Étape 22 — individual invitation edges are never public. */
function isFriendInvitationPubliclyExposable() {
  return false;
}

/**
 * Étape 23–24 — coverage + complementarity impact of a new squad member.
 * Call after the member row is active. previousMemberIds = active members minus joiner.
 */
async function computeSquadJoinImpact(squadId, joinerUserId, {
  previousMemberIds = null,
  db = pool
} = {}) {
  const squad = normalizeIntId(squadId);
  const joiner = normalizeIntId(joinerUserId);
  if (!squad || !joiner) {
    return {
      memberCountAfterJoin: null,
      collectiveCompletionBefore: null,
      collectiveCompletionAfter: null,
      newVariantsAddedToSquad: 0,
      sharedVariantsAdded: 0
    };
  }

  let previous = Array.isArray(previousMemberIds)
    ? previousMemberIds.map(normalizeIntId).filter(Boolean).filter((id) => id !== joiner)
    : null;
  if (!previous) {
    const membersRes = await db.query(
      `SELECT user_id FROM squad_members
       WHERE squad_id = $1 AND status = 'active' AND user_id <> $2`,
      [squad, joiner]
    );
    previous = membersRes.rows.map((r) => Number(r.user_id));
  }

  const compare = require("./compare");
  const beforeSummary = await compare.getSquadCollectiveCompletionSummary(previous);
  const afterMemberIds = previous.concat([joiner]);
  const afterSummary = await compare.getSquadCollectiveCompletionSummary(afterMemberIds);

  const previousOwned = previous.length
    ? await db.query(
      `SELECT DISTINCT variant_id FROM sprite_entries
       WHERE user_id = ANY($1::int[]) AND status = 'owned'`,
      [previous]
    )
    : { rows: [] };
  const joinerOwned = await db.query(
    `SELECT DISTINCT variant_id FROM sprite_entries
     WHERE user_id = $1 AND status = 'owned'`,
    [joiner]
  );
  const previousSet = new Set(previousOwned.rows.map((r) => String(r.variant_id)));
  let newVariantsAddedToSquad = 0;
  let sharedVariantsAdded = 0;
  for (const row of joinerOwned.rows) {
    const vid = String(row.variant_id);
    if (previousSet.has(vid)) sharedVariantsAdded += 1;
    else newVariantsAddedToSquad += 1;
  }

  const memberCountRes = await db.query(
    `SELECT COUNT(*)::int AS n FROM squad_members
     WHERE squad_id = $1 AND status = 'active'`,
    [squad]
  );

  return {
    memberCountAfterJoin: memberCountRes.rows[0]?.n || afterMemberIds.length,
    collectiveCompletionBefore: beforeSummary.collectiveCompletionRate != null
      ? Number(beforeSummary.collectiveCompletionRate)
      : 0,
    collectiveCompletionAfter: afterSummary.collectiveCompletionRate != null
      ? Number(afterSummary.collectiveCompletionRate)
      : 0,
    newVariantsAddedToSquad,
    sharedVariantsAdded
  };
}

/**
 * Étape 23–24 — squad.joined context.
 */
function buildSquadJoinedContext({
  inviterId = null,
  memberRole = "member",
  memberCountAfterJoin = null,
  collectiveCompletionBefore = null,
  collectiveCompletionAfter = null,
  newVariantsAddedToSquad = 0,
  sharedVariantsAdded = 0,
  joinSource = null,
  squadName = null,
  squadCode = null,
  invitationId = null
} = {}) {
  const ctx = {
    inviterId: normalizeIntId(inviterId),
    memberRole: String(memberRole || "member").slice(0, 40),
    memberCountAfterJoin: Number.isFinite(Number(memberCountAfterJoin))
      ? Number(memberCountAfterJoin)
      : null,
    collectiveCompletionBefore: collectiveCompletionBefore != null
      ? Number(collectiveCompletionBefore)
      : null,
    collectiveCompletionAfter: collectiveCompletionAfter != null
      ? Number(collectiveCompletionAfter)
      : null,
    newVariantsAddedToSquad: Number(newVariantsAddedToSquad) || 0,
    sharedVariantsAdded: Number(sharedVariantsAdded) || 0
  };
  if (joinSource) ctx.joinSource = String(joinSource).slice(0, 80);
  if (squadName) ctx.squadName = String(squadName).slice(0, 120);
  if (squadCode) ctx.squadCode = String(squadCode).slice(0, 40);
  if (invitationId != null) ctx.invitationId = invitationId;
  return ctx;
}

/**
 * Étape 26 — personal | friends | squad.
 * Explicit goal.goalScope / goal.scope wins; else squad_id ⇒ squad, else personal.
 */
function resolveGoalScope(goal = null) {
  const explicit = String(
    (goal && (goal.goalScope || goal.goal_scope || goal.scope)) || ""
  ).trim().toLowerCase();
  if (GOAL_SCOPE_SET.has(explicit)) return explicit;
  if (goal && goal.squad_id) return "squad";
  return "personal";
}

/**
 * Étape 25–26 — goal.completed context.
 */
function buildGoalCompletedContext({
  goal = null,
  actorUserId = null,
  targetVariantIds = null,
  participantCount = null,
  completedAt = null,
  goalScope = null
} = {}) {
  const targetIds = Array.isArray(targetVariantIds) && targetVariantIds.length
    ? targetVariantIds.map(String)
    : (goal && Array.isArray(goal.target_variant_ids) && goal.target_variant_ids.length
      ? goal.target_variant_ids.map(String)
      : (goal && goal.variant_id ? [String(goal.variant_id)] : []));
  const createdAt = goal && goal.created_at ? new Date(goal.created_at) : null;
  const doneAt = completedAt ? new Date(completedAt) : new Date();
  let durationDays = null;
  if (createdAt && !Number.isNaN(createdAt.getTime()) && !Number.isNaN(doneAt.getTime())) {
    durationDays = Math.max(0, Math.round((doneAt - createdAt) / (24 * 60 * 60 * 1000)));
  }
  const scope = GOAL_SCOPE_SET.has(String(goalScope || "").toLowerCase())
    ? String(goalScope).toLowerCase()
    : resolveGoalScope(goal);
  const isSquad = scope === "squad";
  return {
    goalScope: scope,
    goalType: isSquad ? "event_completion"
      : (scope === "friends" ? "friends_completion" : "personal_completion"),
    participantCount: Number.isFinite(Number(participantCount))
      ? Number(participantCount)
      : (isSquad || scope === "friends" ? null : 1),
    targetVariantCount: targetIds.length,
    completedVariantCount: targetIds.length,
    durationDays,
    title: goal && goal.title ? String(goal.title).slice(0, 200) : null,
    shared: isSquad || scope === "friends",
    actorUserId: normalizeIntId(actorUserId)
  };
}

/**
 * Étape 27 — notification.opened context.
 * Étape 28 — this means the notification was consulted, not that a CTA ran.
 */
function buildNotificationOpenedContext(notification = {}, {
  channel = null,
  openedAt = null
} = {}) {
  const data = (notification && notification.data && typeof notification.data === "object")
    ? notification.data
    : {};
  const deliveredRaw = notification.delivered_at || notification.created_at || null;
  const opened = openedAt ? new Date(openedAt) : new Date();
  let delaySinceDeliverySeconds = null;
  if (deliveredRaw) {
    const delivered = new Date(deliveredRaw);
    if (!Number.isNaN(delivered.getTime()) && !Number.isNaN(opened.getTime())) {
      delaySinceDeliverySeconds = Math.max(0, Math.round((opened - delivered) / 1000));
    }
  }
  const channels = Array.isArray(data.channels) ? data.channels.map(String) : [];
  const resolvedChannel = channel
    || (channels.includes("push") ? "push"
      : (channels[0] || "in_app"));
  const destination = data.url || notification.url || data.destination || null;
  return {
    notificationType: notification.type ? String(notification.type) : null,
    category: notification.category ? String(notification.category) : null,
    channel: String(resolvedChannel).slice(0, 40),
    destination: destination ? String(destination).slice(0, 500) : null,
    delaySinceDeliverySeconds
  };
}

/**
 * Étape 46–47 — sprites present in ownership differences (onlyA ∪ onlyB).
 * These are difference appearances, NOT "views".
 */
function extractTopDifferenceSpriteIds(result, { limit = 15 } = {}) {
  const groups = (result && result.groups) || {};
  const diffs = []
    .concat(groups.onlyUserA || [])
    .concat(groups.onlyUserB || []);
  const counts = new Map();
  for (const rec of diffs) {
    if (!rec) continue;
    const sid = rec.spriteId || rec.sprite_id;
    if (!sid) continue;
    const key = String(sid);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const max = Math.max(1, Math.min(40, Number(limit) || 15));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, max)
    .map(([id]) => id);
}

/**
 * Build comparison.completed context from engine summary (Étape 18 / 46–49).
 * Counts are oriented from the actor's point of view.
 */
function buildComparisonCompletedContext({
  actorUserId,
  targetUserId,
  userAId,
  userBId,
  result,
  catalogueVersion = null
} = {}) {
  const summary = (result && result.summary) || {};
  const actor = normalizeIntId(actorUserId);
  const a = normalizeIntId(userAId) || actor;
  const b = normalizeIntId(userBId) || normalizeIntId(targetUserId);
  const actorIsA = actor != null && a != null && actor === a;
  const onlyA = Number(summary.onlyUserACount) || 0;
  const onlyB = Number(summary.onlyUserBCount) || 0;
  const pair = normalizeComparisonPair(actor, targetUserId)
    || normalizeComparisonPair(a, b);
  const topDifferenceSpriteIds = extractTopDifferenceSpriteIds(result);
  const aRate = summary.aPossessionRate != null ? Number(summary.aPossessionRate) : null;
  const bRate = summary.bPossessionRate != null ? Number(summary.bPossessionRate) : null;

  return {
    catalogueVersion: catalogueVersion || summary.catalogueVersion || null,
    collectiveCompletionRate: summary.collectiveCompletionRate != null
      ? Number(summary.collectiveCompletionRate)
      : null,
    complementarityRate: summary.complementarityRate != null
      ? Number(summary.complementarityRate)
      : null,
    onlyActorCount: actorIsA ? onlyA : onlyB,
    onlyTargetCount: actorIsA ? onlyB : onlyA,
    bothOwnedCount: Number(summary.bothOwnedCount) || 0,
    bothMissingCount: Number(summary.bothMissingCount) || 0,
    pairUserLowId: pair ? pair.pairUserLowId : null,
    pairUserHighId: pair ? pair.pairUserHighId : null,
    pairKey: pair ? pair.pairKey : null,
    // Étape 46–47 — difference appearances (never labeled as views).
    topDifferenceSpriteIds,
    differenceSpriteCount: topDifferenceSpriteIds.length,
    actorCollectionRate: actorIsA ? aRate : bRate,
    targetCollectionRate: actorIsA ? bRate : aRate,
    pairCollectionRate: (aRate != null && bRate != null)
      ? Math.round(((aRate + bRate) / 2) * 100) / 100
      : null
  };
}

/**
 * Map collection mutations → graph events (Étapes 12–16).
 *
 * - collection.sprite_added : first creation of a collection row only
 * - collection.status_changed : subsequent real status changes only
 * - collection.priority_added : status becomes `priority` (may accompany status_changed)
 * - no event when previous === new (Étape 15)
 */
async function recordCollectionGraphEvents(userId, changes, {
  source = "api",
  origin = null,
  occurredAt = null,
  catalogueVersion = null,
  updateMethod = null,
  previousCollectionCount = null,
  db = pool,
  throwOnError = false
} = {}) {
  const actor = normalizeIntId(userId);
  if (!actor || !Array.isArray(changes) || !changes.length) return [];
  const when = occurredAt || new Date().toISOString();
  const client = db && typeof db.query === "function" ? db : pool;
  const canonicalSource = normalizeGraphSource(source, {
    defaultSource: String(source).toLowerCase().includes("import") ? "import" : "api"
  });
  const gov = require("./sprite-graph-governance");
  const resolvedMethod = gov.resolveUpdateMethod({
    source: canonicalSource,
    origin,
    updateMethod,
    previousCollectionCount,
    changeCount: changes.length
  });
  // One gate for the whole batch so legitimate imports are not rate-limited per row.
  const acceptance = await gov.evaluateGraphEventAcceptance(client, {
    actorUserId: actor,
    source: canonicalSource,
    origin,
    updateMethod: resolvedMethod,
    changeCount: changes.length,
    previousCollectionCount
  });
  if (!acceptance.accept) {
    const hardBlock = acceptance.reason === "account_deleted"
      || acceptance.reason === "user_missing";
    if (hardBlock || !gov.isImportUpdateMethod(resolvedMethod)) return [];
  }
  if (gov.isImportUpdateMethod(resolvedMethod)) {
    acceptance.accept = true;
    // Étape 70 — imports count via unique users, not as abuse.
    if (
      acceptance.reason === "rate_limited"
      || acceptance.reason === "mass_changes"
      || acceptance.reason === "ok"
    ) {
      if (acceptance.reason !== "test_account" && acceptance.reason !== "suspended") {
        acceptance.countTowardCommunity = true;
        acceptance.reason = "ok_import";
      }
    }
    acceptance.updateMethod = resolvedMethod;
  }
  const inserted = [];

  for (const change of changes) {
    if (!change || !change.variantId) continue;
    const variantId = String(change.variantId);
    const spriteId = change.spriteId ? String(change.spriteId) : null;
    const created = change.isNewEntry === true
      || change.created === true
      || change.hadEntry === false;

    const previousStatus = created
      ? null
      : String(
        change.previousStatus != null
          ? change.previousStatus
          : (change.oldStatus != null ? change.oldStatus : "new")
      );
    const newStatus = String(
      change.newStatus != null
        ? change.newStatus
        : (previousStatus != null ? previousStatus : "new")
    );
    const previousPriority = String(
      change.previousPriority != null
        ? change.previousPriority
        : (change.oldPriority != null ? change.oldPriority : "none")
    );
    const newPriority = String(
      change.newPriority != null ? change.newPriority : previousPriority
    );

    const statusChanged = !created && previousStatus !== newStatus;
    const becamePriority = newStatus === "priority"
      && (created || previousStatus !== "priority");
    // Étape 15 — skip no-op updates entirely.
    if (!created && !statusChanged && !becamePriority) continue;

    const catVersion = change.catalogueVersion || catalogueVersion || null;
    const entryId = change.entryId != null ? String(change.entryId) : null;
    const changeId = change.changeId != null
      ? String(change.changeId)
      : (entryId || (created ? "create" : null));
    const fortniteEventId = change.eventId || change.fortniteEventId || null;

    if (created) {
      const row = await recordGraphEvent(client, {
        eventType: GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED,
        eventVersion: GRAPH_EVENT_VERSIONS[GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED],
        actorUserId: actor,
        spriteId,
        variantId,
        source: canonicalSource,
        origin: origin || source,
        occurredAt: when,
        context: {
          newStatus,
          newPriority,
          catalogueVersion: catVersion,
          updateMethod: resolvedMethod
        },
        deduplicationKey: buildDeduplicationKey(
          GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED,
          actor,
          variantId,
          changeId || "create"
        )
      }, { throwOnError, governanceAcceptance: acceptance });
      if (row) inserted.push(row);

      // Étape 16 — first row created directly as priority.
      if (becamePriority) {
        const pr = await recordPriorityAddedEvent(actor, {
          spriteId,
          variantId,
          previousStatus: "absent",
          newPriority,
          priorityLevel: resolvePriorityLevel(change, newPriority),
          eventId: fortniteEventId,
          catalogueVersion: catVersion,
          changeId: `${changeId || "create"}:absent->priority`,
          source: canonicalSource,
          origin: origin || source,
          occurredAt: when,
          updateMethod: resolvedMethod,
          db: client,
          throwOnError,
          governanceAcceptance: acceptance
        });
        if (pr) inserted.push(pr);
      }
      continue;
    }

    if (statusChanged) {
      const statusChangeId = change.historyId != null
        ? `history_${change.historyId}`
        : (changeId
          ? `${changeId}:${previousStatus}->${newStatus}`
          : `${previousStatus}->${newStatus}:${when}`);
      const row = await recordGraphEvent(client, {
        eventType: GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED,
        eventVersion: GRAPH_EVENT_VERSIONS[GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED],
        actorUserId: actor,
        spriteId,
        variantId,
        source: canonicalSource,
        origin: origin || source,
        occurredAt: when,
        context: {
          previousStatus,
          newStatus,
          catalogueVersion: catVersion,
          oldStatus: previousStatus,
          updateMethod: resolvedMethod
        },
        deduplicationKey: buildDeduplicationKey(
          GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED,
          actor,
          variantId,
          statusChangeId
        )
      }, { throwOnError, governanceAcceptance: acceptance });
      if (row) inserted.push(row);
    }

    // Étape 16 — intentional "priority" status (in addition to status_changed).
    if (becamePriority) {
      const pr = await recordPriorityAddedEvent(actor, {
        spriteId,
        variantId,
        previousStatus,
        newPriority,
        priorityLevel: resolvePriorityLevel(change, newPriority),
        eventId: fortniteEventId,
        catalogueVersion: catVersion,
        changeId: change.historyId != null
          ? `history_${change.historyId}:priority`
          : (changeId ? `${changeId}:${previousStatus}->priority` : null),
        source: canonicalSource,
        origin: origin || source,
        occurredAt: when,
        updateMethod: resolvedMethod,
        db: client,
        throwOnError,
        governanceAcceptance: acceptance
      });
      if (pr) inserted.push(pr);
    }
  }

  return inserted;
}

module.exports = {
  GRAPH_EVENT_TYPES,
  FUTURE_GRAPH_EVENT_TYPES,
  GRAPH_EVENT_TYPE_SET,
  GRAPH_INTERACTION_EVENT_TYPES,
  GRAPH_INTERACTION_EVENT_TYPE_SET,
  GRAPH_RECORDABLE_EVENT_TYPE_SET,
  GRAPH_SOURCES,
  GRAPH_SOURCE_SET,
  GRAPH_EVENT_VERSIONS,
  GRAPH_EVENT_COMMON_FIELDS,
  GRAPH_EVENT_SPECIFIC_FIELDS,
  GOAL_SCOPES,
  GOAL_SCOPE_SET,
  FRIEND_INVITATION_METHODS,
  FRIEND_INVITATION_METHOD_SET,
  FRIEND_INVITATION_PUBLIC_METRIC_KEYS,
  GRAPH_DATA_LEVELS,
  GRAPH_DATA_LEVEL_SET,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  GRAPH_CONTEXT_PII_KEYS,
  ensureGraphEventsTable,
  buildGraphEventEnvelope,
  rowToGraphEventEnvelope,
  normalizeGraphSource,
  resolveEventVersion,
  buildDeduplicationKey,
  sanitizeGraphContext,
  classifyGraphDataLevel,
  applyPublicAnonymizationGate,
  normalizeComparisonPair,
  normalizeInvitationMethod,
  buildFriendInvitationSentContext,
  getFriendInvitationPublicMetrics,
  isFriendInvitationPubliclyExposable,
  computeSquadJoinImpact,
  buildSquadJoinedContext,
  resolveGoalScope,
  buildGoalCompletedContext,
  buildNotificationOpenedContext,
  buildComparisonCompletedContext,
  extractTopDifferenceSpriteIds,
  getPriorityInterestMetrics,
  recordGraphEvent,
  recordGraphEventSafe,
  recordCollectionGraphEvents,
  correctGraphEvent,
  isGraphEventCancelled,
  isActivePriority
};
