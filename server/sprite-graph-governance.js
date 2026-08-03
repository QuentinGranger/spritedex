"use strict";

// ── Sprite Graph governance (Étapes 66–70) ───────────────────────────────────
// Retention policy, account-deletion anonymization, consent layers,
// anti-manipulation gates, and legitimate-import differentiation.

const { pool } = require("./db");

/** Étape 68 — consent / data purpose layers (not interchangeable). */
const GRAPH_CONSENT_LAYERS = Object.freeze({
  NECESSARY: "necessary", // product function — never optional
  ANALYTICS_INTERNAL: "analytics_internal", // product analytics (cookieConsent.analytics)
  COMMUNITY_PUBLIC: "community_public" // anonymized community stats opt-in
});

/**
 * Étape 66 — conservation policy (privacy + account-deletion aware).
 */
const GRAPH_RETENTION_POLICY = Object.freeze({
  businessEvents: Object.freeze({
    label: "événements métier principaux",
    retention: "long_term",
    note: "Conservés longtemps ; anonymisés à la suppression de compte"
  }),
  technicalLogs: Object.freeze({
    label: "journaux techniques détaillés",
    retentionDaysMin: 30,
    retentionDaysMax: 90,
    retentionDays: (() => {
      const n = Number(process.env.GRAPH_TECHNICAL_LOG_RETENTION_DAYS);
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 90;
    })()
  }),
  deliveryData: Object.freeze({
    label: "données de livraison (outbox traité)",
    retentionDays: (() => {
      const n = Number(process.env.GRAPH_OUTBOX_RETENTION_DAYS);
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 90;
    })()
  }),
  dailyAggregates: Object.freeze({
    label: "agrégats journaliers",
    retention: "permanent",
    note: "Agrégats anonymes — conservation permanente"
  }),
  respectsAccountDeletion: true,
  respectsPrivacyObligations: true
});

/** Étape 70 — how a collection mutation was produced. */
const GRAPH_UPDATE_METHODS = Object.freeze({
  INITIAL_IMPORT: "initial_import",
  BULK_IMPORT: "bulk_import",
  MANUAL_UPDATE: "manual_update",
  SYNC_BATCH: "sync_batch",
  AUTOMATED_SUSPECT: "automated_suspect"
});

const GRAPH_UPDATE_METHOD_SET = new Set(Object.values(GRAPH_UPDATE_METHODS));

/** Context keys stripped on account deletion (personal / reconstructive). */
const PERSONAL_CONTEXT_KEYS = Object.freeze([
  "note",
  "notes",
  "personalNote",
  "username",
  "displayName",
  "email",
  "targetUsername",
  "actorUsername",
  "message",
  "privateMessage",
  "requestId",
  "deviceId",
  "sessionId",
  "userAgent",
  "ipHash",
  "rawPayload",
  "debug"
]);

/** Context keys kept after anonymization (non-identifying analytics). */
const ANONYMOUS_SAFE_CONTEXT_KEYS = Object.freeze([
  "pairKey",
  "catalogueVersion",
  "topDifferenceSpriteIds",
  "goalScope",
  "fromStatus",
  "toStatus",
  "previousStatus",
  "newStatus",
  "oldStatus",
  "method",
  "updateMethod",
  "notificationType",
  "complementarityRate",
  "impact",
  "priorityLevel",
  "origin",
  "graphEligibility"
]);

/** Étape 69 — anti-manipulation knobs. */
const GRAPH_ABUSE_LIMITS = Object.freeze({
  maxEventsPerSecond: (() => {
    const n = Number(process.env.GRAPH_MAX_EVENTS_PER_SEC);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
  })(),
  maxEventsPerSecondImport: (() => {
    const n = Number(process.env.GRAPH_MAX_EVENTS_PER_SEC_IMPORT);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
  })(),
  massChangeWindowSec: 60,
  massChangeThreshold: (() => {
    const n = Number(process.env.GRAPH_MASS_CHANGE_THRESHOLD);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40;
  })(),
  newAccountHours: (() => {
    const n = Number(process.env.GRAPH_NEW_ACCOUNT_HOURS);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 24;
  })(),
  /** Prefer unique users over raw action counts in public metrics. */
  preferUniqueUsers: true
});

// In-memory sliding windows (per process). Sufficient for soft abuse gates.
const recentEventTimestamps = new Map(); // userId -> number[]
const recentChangeBuckets = new Map(); // userId -> { windowStart, count }

function resolveUpdateMethod({
  source = "api",
  origin = null,
  updateMethod = null,
  previousCollectionCount = null,
  changeCount = 1
} = {}) {
  if (updateMethod && GRAPH_UPDATE_METHOD_SET.has(String(updateMethod))) {
    return String(updateMethod);
  }
  const src = String(source || "").toLowerCase();
  const org = String(origin || "").toLowerCase();
  const isImport = src === "import" || org.includes("import");
  if (isImport) {
    const prev = Number(previousCollectionCount);
    if (!Number.isFinite(prev) || prev <= 5) return GRAPH_UPDATE_METHODS.INITIAL_IMPORT;
    return GRAPH_UPDATE_METHODS.BULK_IMPORT;
  }
  if (org.includes("sync") || (Number(changeCount) || 0) > 10) {
    return GRAPH_UPDATE_METHODS.SYNC_BATCH;
  }
  return GRAPH_UPDATE_METHODS.MANUAL_UPDATE;
}

function isImportUpdateMethod(method) {
  return method === GRAPH_UPDATE_METHODS.INITIAL_IMPORT || method === GRAPH_UPDATE_METHODS.BULK_IMPORT;
}

function touchRateWindow(userId, { now = Date.now(), maxPerSec } = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id)) return { ok: true, count: 0 };
  const limit = Math.max(1, Number(maxPerSec) || GRAPH_ABUSE_LIMITS.maxEventsPerSecond);
  const cutoff = now - 1000;
  let arr = recentEventTimestamps.get(id) || [];
  arr = arr.filter((t) => t >= cutoff);
  arr.push(now);
  recentEventTimestamps.set(id, arr);
  return { ok: arr.length <= limit, count: arr.length, limit };
}

function touchMassChangeWindow(userId, delta = 1, { now = Date.now() } = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id)) return { ok: true, count: 0 };
  const windowMs = GRAPH_ABUSE_LIMITS.massChangeWindowSec * 1000;
  let bucket = recentChangeBuckets.get(id);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { windowStart: now, count: 0 };
  }
  bucket.count += Math.max(1, Math.floor(Number(delta) || 1));
  recentChangeBuckets.set(id, bucket);
  const threshold = GRAPH_ABUSE_LIMITS.massChangeThreshold;
  return {
    ok: bucket.count <= threshold,
    count: bucket.count,
    threshold
  };
}

/**
 * Étape 69–70 — decide whether an event may be recorded / counted.
 * Legitimate imports are not treated as abuse.
 */
async function evaluateGraphEventAcceptance(
  db = pool,
  {
    actorUserId,
    source = "api",
    origin = null,
    updateMethod = null,
    changeCount = 1,
    previousCollectionCount = null
  } = {}
) {
  const method = resolveUpdateMethod({
    source,
    origin,
    updateMethod,
    previousCollectionCount,
    changeCount
  });
  const actor = Number(actorUserId);
  if (!Number.isFinite(actor) || actor <= 0) {
    return {
      accept: true,
      countTowardCommunity: false,
      updateMethod: method,
      reason: "no_actor"
    };
  }

  const userRes = await db.query(
    `SELECT id, is_test_account, deleted_at, suspended_until, created_at,
            community_stats_opt_in, cookie_consent
     FROM users WHERE id = $1`,
    [actor]
  );
  const user = userRes.rows[0];
  if (!user) {
    return { accept: false, countTowardCommunity: false, updateMethod: method, reason: "user_missing" };
  }
  if (user.deleted_at) {
    return { accept: false, countTowardCommunity: false, updateMethod: method, reason: "account_deleted" };
  }
  if (user.is_test_account === true) {
    return {
      accept: true,
      countTowardCommunity: false,
      updateMethod: method,
      reason: "test_account"
    };
  }
  if (user.suspended_until && new Date(user.suspended_until) > new Date()) {
    return {
      accept: true,
      countTowardCommunity: false,
      updateMethod: method,
      reason: "suspended"
    };
  }

  const importLike = isImportUpdateMethod(method);
  const rate = touchRateWindow(actor, {
    maxPerSec: importLike ? GRAPH_ABUSE_LIMITS.maxEventsPerSecondImport : GRAPH_ABUSE_LIMITS.maxEventsPerSecond
  });
  if (!rate.ok && !importLike) {
    return {
      accept: false,
      countTowardCommunity: false,
      updateMethod: GRAPH_UPDATE_METHODS.AUTOMATED_SUSPECT,
      reason: "rate_limited",
      rate
    };
  }

  // Mass repeated changes — imports/sync exempt; manual floods flagged.
  const mass = touchMassChangeWindow(actor, changeCount);
  let finalMethod = method;
  let countTowardCommunity = true;
  let reason = "ok";
  if (!mass.ok && !importLike && method === GRAPH_UPDATE_METHODS.MANUAL_UPDATE) {
    finalMethod = GRAPH_UPDATE_METHODS.AUTOMATED_SUSPECT;
    countTowardCommunity = false;
    reason = "mass_changes";
  }

  const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
  const ageHours = createdAt ? (Date.now() - createdAt) / (3600 * 1000) : Infinity;
  const isNewAccount = ageHours < GRAPH_ABUSE_LIMITS.newAccountHours;

  // New accounts still count via unique-user denominators; flag for monitoring.
  return {
    accept: true,
    countTowardCommunity,
    updateMethod: finalMethod,
    reason,
    isNewAccount,
    isTestAccount: false,
    preferUniqueUsers: GRAPH_ABUSE_LIMITS.preferUniqueUsers,
    mass,
    rate
  };
}

function scrubPersonalContext(context) {
  const src = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  const out = {};
  for (const key of ANONYMOUS_SAFE_CONTEXT_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  // Drop any leftover personal keys explicitly.
  for (const key of PERSONAL_CONTEXT_KEYS) {
    if (out[key] !== undefined) delete out[key];
  }
  out.anonymized = true;
  return out;
}

/**
 * Étape 67 — anonymize a deleted user's graph footprint.
 * actor/target → NULL, personal context removed, future eligibility excluded.
 * Anonymous aggregates remain; personal history cannot be reconstructed.
 */
async function anonymizeUserGraphData(db = pool, userId, { recalculateSensitive = false } = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, reason: "invalid_user" };
  }

  const client = await db.connect();
  const summary = {
    ok: true,
    userId: id,
    eventsAnonymized: 0,
    correctionsScrubbed: 0,
    optOutSet: false,
    recalculated: null
  };

  try {
    await client.query("BEGIN");
    // Opt out of future community aggregates.
    await client.query(
      `UPDATE users
       SET community_stats_opt_in = FALSE
       WHERE id = $1`,
      [id]
    );
    summary.optOutSet = true;

    await client.query("ALTER TABLE graph_events DISABLE TRIGGER trg_graph_events_append_only");

    const events = await client.query(
      `SELECT id, context
       FROM graph_events
       WHERE actor_user_id = $1 OR target_user_id = $1
       FOR UPDATE`,
      [id]
    );

    for (const row of events.rows) {
      const scrubbed = scrubPersonalContext(row.context);
      await client.query(
        `UPDATE graph_events
         SET actor_user_id = CASE WHEN actor_user_id = $1 THEN NULL ELSE actor_user_id END,
             target_user_id = CASE WHEN target_user_id = $1 THEN NULL ELSE target_user_id END,
             context = $2::jsonb,
             deduplication_key = CASE
               WHEN deduplication_key IS NULL THEN NULL
               ELSE left('anon:' || id::text, 255)
             END
         WHERE id = $3::uuid`,
        [id, JSON.stringify(scrubbed), row.id]
      );
      summary.eventsAnonymized += 1;
    }

    await client.query("ALTER TABLE graph_events ENABLE TRIGGER trg_graph_events_append_only");

    const corrections = await client.query(
      `UPDATE graph_event_corrections
       SET corrected_by = NULL,
           context = COALESCE(context, '{}'::jsonb) - 'username' - 'email' - 'note'
       WHERE corrected_by = $1
       RETURNING id`,
      [id]
    );
    summary.correctionsScrubbed = corrections.rows.length;

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    try {
      await client.query("ALTER TABLE graph_events ENABLE TRIGGER trg_graph_events_append_only");
    } catch (_) {
      /* ignore */
    }
    client.release();
    throw err;
  }
  client.release();

  if (recalculateSensitive) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      summary.recalculated = await require("./sprite-graph-counters").rebuildGraphMetrics(db, day, day, {
        runDailyPipeline: true,
        rebuildCounters: true
      });
    } catch (err) {
      summary.recalculated = { error: err.message };
    }
  }

  return summary;
}

/**
 * Étape 68 — community stats participation (separate from essential features).
 */
async function setCommunityStatsOptIn(db = pool, userId, optIn) {
  const id = Number(userId);
  if (!Number.isFinite(id)) return null;
  const value = optIn === true ? true : optIn === false ? false : null;
  const result = await db.query(
    `UPDATE users
     SET community_stats_opt_in = $2
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, community_stats_opt_in`,
    [id, value]
  );
  return result.rows[0] || null;
}

async function getCommunityStatsOptIn(db = pool, userId) {
  const result = await db.query(
    `SELECT community_stats_opt_in, cookie_consent
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const analytics = !!(row.cookie_consent && row.cookie_consent.analytics === true);
  return {
    communityStatsOptIn: row.community_stats_opt_in,
    // Explicit column wins; else analytics cookie is soft signal.
    participates: row.community_stats_opt_in === true || (row.community_stats_opt_in == null && analytics),
    layers: {
      necessary: true,
      analyticsInternal: analytics,
      communityPublic: row.community_stats_opt_in === true || (row.community_stats_opt_in == null && analytics)
    },
    essentialFeaturesRequireCommunityConsent: false
  };
}

/**
 * Étape 66 — apply retention policy (technical / delivery only; aggregates permanent).
 */
async function applyGraphRetentionPolicy(db = pool) {
  const counters = require("./sprite-graph-counters");
  const result = await counters.pruneGraphTechnicalArtifacts(db, {
    outboxRetentionDays: GRAPH_RETENTION_POLICY.deliveryData.retentionDays,
    counterRetentionDays: Math.max(GRAPH_RETENTION_POLICY.technicalLogs.retentionDays, 90),
    compactTechnicalContext: true,
    technicalContextRetentionDays: GRAPH_RETENTION_POLICY.technicalLogs.retentionDays
  });
  return {
    policy: GRAPH_RETENTION_POLICY,
    result,
    dailyAggregatesPreserved: true
  };
}

/** Whether realtime counters should ignore this event (Étape 69). */
function shouldCountEventTowardCommunity(acceptance) {
  if (!acceptance) return false;
  return acceptance.accept !== false && acceptance.countTowardCommunity === true;
}

module.exports = {
  GRAPH_CONSENT_LAYERS,
  GRAPH_RETENTION_POLICY,
  GRAPH_UPDATE_METHODS,
  GRAPH_UPDATE_METHOD_SET,
  GRAPH_ABUSE_LIMITS,
  PERSONAL_CONTEXT_KEYS,
  ANONYMOUS_SAFE_CONTEXT_KEYS,
  resolveUpdateMethod,
  isImportUpdateMethod,
  evaluateGraphEventAcceptance,
  scrubPersonalContext,
  anonymizeUserGraphData,
  setCommunityStatsOptIn,
  getCommunityStatsOptIn,
  applyGraphRetentionPolicy,
  shouldCountEventTowardCommunity
};
