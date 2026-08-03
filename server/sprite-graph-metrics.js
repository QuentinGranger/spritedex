"use strict";

// ── Sprite Graph technical / ops metrics (Étape 97) ──────────────────────────
// Internal only — never surface these in the public product UI or public APIs.

const { pool } = require("./db");

const GRAPH_ADMIN_IDS = new Set(
  String(process.env.SPRITE_GRAPH_ADMIN_USER_IDS || process.env.ANALYTICS_ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
);

function isSpriteGraphAdmin(userId) {
  return !!userId && GRAPH_ADMIN_IDS.has(String(userId));
}

const GRAPH_OPS_COUNTERS = Object.freeze({
  DEDUP_SKIPS: "dedup_skips",
  RECORD_ERRORS: "record_errors",
  AGGREGATE_CALC_MS: "aggregate_calc_ms_last",
  REBUILD_MS: "rebuild_ms_last"
});

async function ensureGraphOpsTables(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_ops_counters (
      counter_key VARCHAR(80) PRIMARY KEY,
      counter_value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_feature_flags (
      flag_key VARCHAR(80) PRIMARY KEY,
      disabled BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by INTEGER
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_ops_runs (
      id BIGSERIAL PRIMARY KEY,
      run_type VARCHAR(40) NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      ok BOOLEAN,
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_graph_ops_runs_type_started
      ON graph_ops_runs (run_type, started_at DESC);
  `);
}

async function bumpOpsCounter(db = pool, key, by = 1) {
  await ensureGraphOpsTables(db);
  const k = String(key).slice(0, 80);
  const n = Math.floor(Number(by) || 0);
  if (!k || !n) return;
  await db.query(
    `INSERT INTO graph_ops_counters (counter_key, counter_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (counter_key) DO UPDATE SET
       counter_value = graph_ops_counters.counter_value + EXCLUDED.counter_value,
       updated_at = NOW()`,
    [k, n]
  );
}

async function setOpsCounter(db = pool, key, value) {
  await ensureGraphOpsTables(db);
  await db.query(
    `INSERT INTO graph_ops_counters (counter_key, counter_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (counter_key) DO UPDATE SET
       counter_value = EXCLUDED.counter_value,
       updated_at = NOW()`,
    [String(key).slice(0, 80), Math.floor(Number(value) || 0)]
  );
}

async function getOpsCounter(db = pool, key) {
  await ensureGraphOpsTables(db);
  const r = await db.query(`SELECT counter_value FROM graph_ops_counters WHERE counter_key = $1`, [String(key)]);
  return r.rows[0] ? Number(r.rows[0].counter_value) : 0;
}

async function recordOpsRun(db = pool, { runType, startedAt, finishedAt = new Date(), ok = true, details = {} } = {}) {
  await ensureGraphOpsTables(db);
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt || Date.now());
  const end = finishedAt instanceof Date ? finishedAt : new Date(finishedAt);
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  await db.query(
    `INSERT INTO graph_ops_runs (run_type, started_at, finished_at, duration_ms, ok, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      String(runType || "unknown").slice(0, 40),
      start.toISOString(),
      end.toISOString(),
      durationMs,
      ok !== false,
      JSON.stringify(details && typeof details === "object" ? details : {})
    ]
  );
  if (runType === "aggregate_calc") {
    await setOpsCounter(db, GRAPH_OPS_COUNTERS.AGGREGATE_CALC_MS, durationMs);
  }
  if (runType === "rebuild") {
    await setOpsCounter(db, GRAPH_OPS_COUNTERS.REBUILD_MS, durationMs);
  }
  return { durationMs, ok: ok !== false };
}

/**
 * Étape 97 — technical metrics (admin / ops only).
 */
async function getSpriteGraphTechnicalMetrics(db = pool, { windowMinutes = 60 } = {}) {
  await ensureGraphOpsTables(db);
  const minutes = Math.max(1, Math.min(24 * 60, Math.floor(Number(windowMinutes) || 60)));

  const events = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM graph_events
     WHERE recorded_at >= NOW() - ($1::int * INTERVAL '1 minute')`,
    [minutes]
  );
  const eventCount = events.rows[0]?.n || 0;

  let workerLagSeconds = 0;
  let pendingOutbox = 0;
  let failedOutbox = 0;
  try {
    const lag = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         EXTRACT(EPOCH FROM (NOW() - MIN(available_at) FILTER (WHERE status = 'pending')))::int AS lag_s
       FROM event_outbox`
    );
    pendingOutbox = lag.rows[0]?.pending || 0;
    failedOutbox = lag.rows[0]?.failed || 0;
    workerLagSeconds = lag.rows[0]?.lag_s != null ? Number(lag.rows[0].lag_s) : 0;
  } catch (_) {
    /* outbox may be empty / missing */
  }

  const tableSize = await db
    .query(
      `SELECT pg_total_relation_size('graph_events')::bigint AS bytes,
            (SELECT COUNT(*)::bigint FROM graph_events) AS row_count`
    )
    .catch(() => ({ rows: [{ bytes: 0, row_count: 0 }] }));

  const dedupSkips = await getOpsCounter(db, GRAPH_OPS_COUNTERS.DEDUP_SKIPS);
  const recordErrors = await getOpsCounter(db, GRAPH_OPS_COUNTERS.RECORD_ERRORS);
  const aggregateCalcMs = await getOpsCounter(db, GRAPH_OPS_COUNTERS.AGGREGATE_CALC_MS);
  const rebuildMs = await getOpsCounter(db, GRAPH_OPS_COUNTERS.REBUILD_MS);

  return {
    scope: "internal_technical",
    publicProduct: false,
    windowMinutes: minutes,
    eventsPerMinute: Math.round((eventCount / minutes) * 1000) / 1000,
    eventsInWindow: eventCount,
    workerLagSeconds,
    pendingOutbox,
    failedOutbox,
    aggregateCalcMsLast: aggregateCalcMs,
    rebuildDurationMsLast: rebuildMs,
    errorCount: recordErrors + failedOutbox,
    duplicateSkipCount: dedupSkips,
    table: {
      name: "graph_events",
      rowCount: Number(tableSize.rows[0]?.row_count || 0),
      sizeBytes: Number(tableSize.rows[0]?.bytes || 0)
    }
  };
}

async function isPublicMetricDisabled(db = pool, metricKey) {
  await ensureGraphOpsTables(db);
  const r = await db.query(`SELECT disabled FROM graph_feature_flags WHERE flag_key = $1`, [String(metricKey)]);
  return !!(r.rows[0] && r.rows[0].disabled === true);
}

async function setPublicMetricDisabled(
  db = pool,
  metricKey,
  { disabled = true, reason = null, updatedBy = null } = {}
) {
  await ensureGraphOpsTables(db);
  const key = String(metricKey || "").slice(0, 80);
  if (!key) return null;
  const result = await db.query(
    `INSERT INTO graph_feature_flags (flag_key, disabled, reason, updated_at, updated_by)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (flag_key) DO UPDATE SET
       disabled = EXCLUDED.disabled,
       reason = EXCLUDED.reason,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [key, disabled === true, reason ? String(reason).slice(0, 500) : null, updatedBy]
  );
  return result.rows[0];
}

async function listPublicMetricFlags(db = pool) {
  await ensureGraphOpsTables(db);
  const r = await db.query(
    `SELECT flag_key, disabled, reason, updated_at, updated_by
     FROM graph_feature_flags
     ORDER BY flag_key`
  );
  return r.rows.map((row) => ({
    key: row.flag_key,
    disabled: row.disabled === true,
    reason: row.reason,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  }));
}

/**
 * Étape 98 — control-board payload (admin only).
 */
async function getSpriteGraphControlBoard(db = pool) {
  const technical = await getSpriteGraphTechnicalMetrics(db, { windowMinutes: 60 });

  const last24h = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM graph_events
     WHERE recorded_at >= NOW() - INTERVAL '24 hours'`
  );
  const byType = await db.query(
    `SELECT event_type, COUNT(*)::int AS n
     FROM graph_events
     WHERE recorded_at >= NOW() - INTERVAL '24 hours'
     GROUP BY event_type
     ORDER BY n DESC
     LIMIT 40`
  );

  let rejected = 0;
  try {
    const rej = await db.query(
      `SELECT COUNT(*)::int AS n FROM event_outbox
       WHERE status = 'failed'
         AND COALESCE(failed_at, processed_at, available_at) >= NOW() - INTERVAL '24 hours'`
    );
    rejected = rej.rows[0]?.n || 0;
  } catch (_) {
    /* ignore */
  }

  let lastConsolidation = null;
  try {
    const pub = await db.query(
      `SELECT metric_date, published_at, catalogue_version
       FROM graph_daily_publish
       ORDER BY metric_date DESC
       LIMIT 1`
    );
    if (pub.rows[0]) {
      lastConsolidation = {
        metricDate: pub.rows[0].metric_date,
        publishedAt: pub.rows[0].published_at,
        catalogueVersion: pub.rows[0].catalogue_version
      };
    }
  } catch (_) {
    /* table may be missing */
  }

  let sampleSizes = { avg: null, min: null, max: null, rows: 0 };
  try {
    const day = new Date().toISOString().slice(0, 10);
    const s = await db.query(
      `SELECT COUNT(*)::int AS rows,
              AVG(sample_size)::float AS avg,
              MIN(sample_size)::int AS min,
              MAX(sample_size)::int AS max
       FROM community_variant_stats
       WHERE metric_date = $1::date`,
      [day]
    );
    if (s.rows[0]) {
      sampleSizes = {
        rows: s.rows[0].rows || 0,
        avg: s.rows[0].avg != null ? Math.round(s.rows[0].avg * 10) / 10 : null,
        min: s.rows[0].min,
        max: s.rows[0].max
      };
    }
  } catch (_) {
    /* ignore */
  }

  const flags = await listPublicMetricFlags(db);
  const suspendedPublic = flags.filter((f) => f.disabled).map((f) => f.key);

  const { getGraphFormulaRegistry } = require("./sprite-graph-formula");

  return {
    scope: "internal_control_board",
    publicProduct: false,
    asOf: new Date().toISOString(),
    eventsLast24h: last24h.rows[0]?.n || 0,
    eventsByType: byType.rows.map((r) => ({ eventType: r.event_type, count: r.n })),
    rejectedEventsLast24h: rejected,
    processingLagSeconds: technical.workerLagSeconds,
    lastConsolidation,
    sampleSizes,
    publicMetricsSuspended: suspendedPublic,
    metricFlags: flags,
    technical,
    formulas: getGraphFormulaRegistry()
  };
}

/** Safe admin export — aggregates only, never raw private events. */
async function getAdminAggregateExport(db = pool, { metricDate = null, limit = 200 } = {}) {
  try {
    await require("./sprite-graph-formula").ensureFormulaVersionColumns(db);
  } catch (_) {
    /* ignore */
  }
  const day = metricDate ? String(metricDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const lim = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 200)));
  const rows = await db.query(
    `SELECT metric_date, variant_id, sample_size, ownership_rate, priority_rate,
            catalogue_version, formula_version, calculated_at
     FROM community_variant_stats
     WHERE metric_date = $1::date
     ORDER BY sample_size DESC NULLS LAST
     LIMIT $2`,
    [day, lim]
  );
  return {
    scope: "admin_aggregate_export",
    includesRawEvents: false,
    includesPersonalData: false,
    metricDate: day,
    rows: rows.rows.map((r) => ({
      metricDate: r.metric_date,
      variantId: r.variant_id,
      sampleSize: r.sample_size,
      ownershipRate: r.ownership_rate != null ? Number(r.ownership_rate) : null,
      priorityRate: r.priority_rate != null ? Number(r.priority_rate) : null,
      catalogueVersion: r.catalogue_version,
      formulaVersion: r.formula_version,
      calculatedAt: r.calculated_at
    }))
  };
}

module.exports = {
  GRAPH_ADMIN_IDS,
  isSpriteGraphAdmin,
  GRAPH_OPS_COUNTERS,
  ensureGraphOpsTables,
  bumpOpsCounter,
  setOpsCounter,
  getOpsCounter,
  recordOpsRun,
  getSpriteGraphTechnicalMetrics,
  isPublicMetricDisabled,
  setPublicMetricDisabled,
  listPublicMetricFlags,
  getSpriteGraphControlBoard,
  getAdminAggregateExport
};
