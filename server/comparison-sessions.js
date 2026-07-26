"use strict";

// Étapes 27–30 — counted comparison sessions (not page-reload analytics).
// Keep this module free of top-level requires into compare.js / squad-analysis-cache
// (those create a circular dependency that breaks catalogue helpers at load time).
const { pool } = require("./db");

const COMPARISON_SESSION_SOURCES = Object.freeze([
  "friends_list",
  "squad",
  "shared_link",
  "passport",
  "direct"
]);

const SOURCE_ALIASES = Object.freeze({
  friends_list: "friends_list",
  friends: "friends_list",
  quick_compare: "friends_list",
  friend: "friends_list",
  squad: "squad",
  api: "squad",
  shared_link: "shared_link",
  share: "shared_link",
  shared_profile: "shared_link",
  passport: "passport",
  direct: "direct",
  user_compare: "direct",
  quick_action: "direct"
});

const DEDUPE_WINDOW_MINUTES = (() => {
  const raw = parseInt(process.env.COMPARISON_SESSION_WINDOW_MINUTES, 10);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(1, Math.min(24 * 60, raw));
})();

async function ensureComparisonSessionsTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS comparison_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      initiator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      compared_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source VARCHAR(30) NOT NULL,
      catalogue_version VARCHAR(80) NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (initiator_id <> compared_user_id),
      CHECK (source IN ('friends_list', 'squad', 'shared_link', 'passport', 'direct'))
    );
    CREATE INDEX IF NOT EXISTS idx_comparison_sessions_initiator
      ON comparison_sessions (initiator_id, generated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comparison_sessions_compared
      ON comparison_sessions (compared_user_id, generated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comparison_sessions_pair_time
      ON comparison_sessions (
        LEAST(initiator_id, compared_user_id),
        GREATEST(initiator_id, compared_user_id),
        generated_at DESC
      );
  `);
}

function normalizeSource(raw) {
  const key = String(raw || "").trim().toLowerCase();
  return SOURCE_ALIASES[key] || null;
}

function resolveCompareSource(raw, fallback = "direct") {
  return normalizeSource(raw) || normalizeSource(fallback) || "direct";
}

function isCountableCompareResult(result) {
  if (!result || !result.summary) return false;
  // Engine flag: both collections must have enough explicit entries.
  if (result.summary.insufficientData) return false;
  return (Number(result.summary.catalogueVariantCount) || 0) > 0;
}

function toUserId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Record a counted comparison session when Étape 27 conditions hold.
 * Étape 29 — same unordered pair within the window is not counted again.
 * Returns { counted, skippedReason?, session? }.
 */
async function recordComparisonSession({
  initiatorId,
  comparedUserId,
  source,
  catalogueVersion,
  result,
  db = pool
} = {}) {
  const initiator = toUserId(initiatorId);
  const compared = toUserId(comparedUserId);
  if (!initiator || !compared || initiator === compared) {
    return { counted: false, skippedReason: "same_or_invalid_users" };
  }
  if (!isCountableCompareResult(result)) {
    return { counted: false, skippedReason: "insufficient_result" };
  }
  const normalizedSource = resolveCompareSource(source);
  const version = String(catalogueVersion || "unknown").slice(0, 80);

  const existing = await db.query(
    `SELECT id, generated_at FROM comparison_sessions
     WHERE LEAST(initiator_id, compared_user_id) = LEAST($1::int, $2::int)
       AND GREATEST(initiator_id, compared_user_id) = GREATEST($1::int, $2::int)
       AND generated_at > NOW() - ($3::int * INTERVAL '1 minute')
     ORDER BY generated_at DESC
     LIMIT 1`,
    [initiator, compared, DEDUPE_WINDOW_MINUTES]
  );
  if (existing.rows.length) {
    return {
      counted: false,
      skippedReason: "deduped",
      session: existing.rows[0]
    };
  }

  const inserted = await db.query(
    `INSERT INTO comparison_sessions (initiator_id, compared_user_id, source, catalogue_version)
     VALUES ($1, $2, $3, $4)
     RETURNING id, initiator_id, compared_user_id, source, catalogue_version, generated_at`,
    [initiator, compared, normalizedSource, version]
  );
  return { counted: true, session: inserted.rows[0] };
}

/**
 * When the requester is one side of the pair, attribute the session to them.
 * Third-party viewers do not inflate passport counters.
 */
async function recordParticipantComparisonSession({
  requesterId,
  userAId,
  userBId,
  source,
  catalogueVersion,
  result,
  db = pool
} = {}) {
  const me = toUserId(requesterId);
  const a = toUserId(userAId);
  const b = toUserId(userBId);
  if (!me || !a || !b || a === b) {
    return { counted: false, skippedReason: "same_or_invalid_users" };
  }
  let initiator;
  let compared;
  if (me === a) {
    initiator = a;
    compared = b;
  } else if (me === b) {
    initiator = b;
    compared = a;
  } else {
    return { counted: false, skippedReason: "third_party" };
  }
  return recordComparisonSession({
    initiatorId: initiator,
    comparedUserId: compared,
    source,
    catalogueVersion,
    result,
    db
  }).then((out) => {
    if (out && out.counted) {
      try {
        const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
        emitDomainEvent(DOMAIN_EVENTS.COMPARISON_GENERATED, {
          actorId: initiator,
          entityType: "user",
          entityId: String(compared),
          context: { source, catalogueVersion }
        }).catch(() => {});
      } catch (_) { /* optional */ }
      try {
        // Étapes 18–20 — product event only when the session was counted
        // (30‑minute pair window already applied above; reloads are skipped).
        const {
          recordGraphEventSafe,
          GRAPH_EVENT_TYPES,
          buildComparisonCompletedContext,
          normalizeComparisonPair,
          buildDeduplicationKey
        } = require("./sprite-graph");
        const sessionId = out.session && out.session.id;
        const pair = normalizeComparisonPair(initiator, compared);
        const context = buildComparisonCompletedContext({
          actorUserId: initiator,
          targetUserId: compared,
          userAId: a,
          userBId: b,
          result,
          catalogueVersion
        });
        recordGraphEventSafe({
          eventType: GRAPH_EVENT_TYPES.COMPARISON_COMPLETED,
          actorUserId: initiator,
          targetUserId: compared,
          comparisonId: sessionId || null,
          source: "api",
          origin: String(source || "direct").slice(0, 80),
          context,
          // Prefer session id; fall back to normalized pair + session time bucket.
          deduplicationKey: sessionId
            ? buildDeduplicationKey(GRAPH_EVENT_TYPES.COMPARISON_COMPLETED, sessionId)
            : (pair
              ? buildDeduplicationKey(
                GRAPH_EVENT_TYPES.COMPARISON_COMPLETED,
                pair.pairKey,
                new Date().toISOString().slice(0, 16)
              )
              : null)
        });
      } catch (_) { /* optional */ }
      require("./passport-summary").schedulePassportRecalc(initiator, {
        mode: "queue",
        reason: "comparison.generated",
        triggerEvent: "comparison.generated",
        collectionChanged: false,
        notify: false
      }).catch(() => {});
    }
    return out;
  });
}

function catalogueVersionFromItems(catalogue) {
  if (!Array.isArray(catalogue)) return "unknown";
  // Lazy require avoids compare ↔ comparison-sessions ↔ squad-analysis-cache cycles.
  const { computeCatalogueVersion } = require("./squad-analysis-cache");
  return computeCatalogueVersion(catalogue) || "unknown";
}

async function getComparisonStatsForUser(userId, db = pool) {
  const id = toUserId(userId);
  if (!id) {
    return { comparisonCount: 0, distinctCollectorsCompared: 0 };
  }
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS comparison_count,
       COUNT(DISTINCT compared_user_id)::int AS distinct_collectors
     FROM comparison_sessions
     WHERE initiator_id = $1`,
    [id]
  );
  const row = result.rows[0] || {};
  return {
    comparisonCount: row.comparison_count || 0,
    distinctCollectorsCompared: row.distinct_collectors || 0
  };
}

module.exports = {
  COMPARISON_SESSION_SOURCES,
  DEDUPE_WINDOW_MINUTES,
  ensureComparisonSessionsTable,
  normalizeSource,
  resolveCompareSource,
  isCountableCompareResult,
  recordComparisonSession,
  recordParticipantComparisonSession,
  catalogueVersionFromItems,
  getComparisonStatsForUser
};
