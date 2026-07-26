"use strict";

// ── Sprite Graph Outbox (Étapes 31–32) ───────────────────────────────────────
// Simple polling worker — no Kafka. Flow:
//   business TX → graph_events → event_outbox → async aggregates

const { pool } = require("./db");
const {
  GRAPH_DATA_LEVELS,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  applyPublicAnonymizationGate
} = require("./sprite-graph-privacy");

const OUTBOX_STATUSES = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed"
});

const DEFAULT_POLL_MS = 10_000;
const DEFAULT_BATCH = 50;
const MAX_ATTEMPTS = 8;

let workerStarted = false;
let workerInterval = null;

async function ensureEventOutboxTables(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS event_outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      graph_event_id UUID NOT NULL REFERENCES graph_events(id),
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      error_message TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_outbox_graph_event
      ON event_outbox (graph_event_id);
    CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
      ON event_outbox (available_at ASC)
      WHERE status = 'pending';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_aggregates (
      id VARCHAR(160) PRIMARY KEY,
      level VARCHAR(40) NOT NULL,
      metric_key VARCHAR(120) NOT NULL,
      window_key VARCHAR(80) NOT NULL DEFAULT 'all',
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      unique_user_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_graph_aggregates_level_metric
      ON graph_aggregates (level, metric_key);
  `);
}

/**
 * Étape 31 — enqueue outbox row in the same connection/TX as the graph event.
 */
async function enqueueGraphEventOutbox(db, graphEventId, { throwOnError = false } = {}) {
  if (!graphEventId) return null;
  const client = db && typeof db.query === "function" ? db : pool;
  try {
    const result = await client.query(
      `INSERT INTO event_outbox (id, graph_event_id, status, available_at)
       VALUES (gen_random_uuid(), $1::uuid, 'pending', NOW())
       ON CONFLICT (graph_event_id) DO NOTHING
       RETURNING *`,
      [graphEventId]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("[sprite-graph-outbox] enqueue failed:", err.message);
    if (throwOnError) throw err;
    return null;
  }
}

function aggregateId(level, metricKey, windowKey = "all") {
  return `${level}:${metricKey}:${windowKey}`.slice(0, 160);
}

async function bumpEventTypeAggregate(db, eventRow) {
  const eventType = eventRow.event_type;
  const windowKey = "all";
  const metricKey = `events.${eventType}`;
  const internalId = aggregateId(GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL, metricKey, windowKey);
  const publicId = aggregateId(GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC, metricKey, windowKey);

  const stats = await db.query(
    `SELECT COUNT(*)::int AS count,
            COUNT(DISTINCT actor_user_id)::int AS users
     FROM graph_events
     WHERE event_type = $1
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )`,
    [eventType]
  );
  const count = stats.rows[0]?.count || 0;
  const uniqueUsers = stats.rows[0]?.users || 0;

  await db.query(
    `INSERT INTO graph_aggregates (id, level, metric_key, window_key, value, unique_user_count, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       value = EXCLUDED.value,
       unique_user_count = EXCLUDED.unique_user_count,
       updated_at = NOW()`,
    [
      internalId,
      GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL,
      metricKey,
      windowKey,
      JSON.stringify({ count, eventType, uniqueUserCount: uniqueUsers }),
      uniqueUsers
    ]
  );

  // Étape 34–35 — public mirror is gated; raw identities never leave internal level.
  const gated = applyPublicAnonymizationGate({
    uniqueUserCount: uniqueUsers,
    payload: { count, eventType, uniqueUserCount: uniqueUsers }
  });
  await db.query(
    `INSERT INTO graph_aggregates (id, level, metric_key, window_key, value, unique_user_count, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       value = EXCLUDED.value,
       unique_user_count = EXCLUDED.unique_user_count,
       updated_at = NOW()`,
    [
      publicId,
      GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC,
      metricKey,
      windowKey,
      JSON.stringify(gated.ok
        ? { count, eventType, uniqueUserCount: uniqueUsers }
        : { insufficient: true, message: gated.message }),
      uniqueUsers
    ]
  );
}

async function processOneOutboxRow(db, outboxRow) {
  const eventRes = await db.query(
    `SELECT id, event_type, actor_user_id, sprite_id, variant_id, context, occurred_at
     FROM graph_events WHERE id = $1::uuid`,
    [outboxRow.graph_event_id]
  );
  if (!eventRes.rows.length) {
    throw new Error("graph_event_missing");
  }
  const eventRow = eventRes.rows[0];
  // Étape 32 — lightweight type aggregates.
  await bumpEventTypeAggregate(db, eventRow);
  // Étape 61–62 / 69 — incremental counters only when eligible for community.
  const ctx = eventRow.context && typeof eventRow.context === "object" ? eventRow.context : {};
  if (ctx.graphEligibility === "excluded") {
    return;
  }
  await require("./sprite-graph-counters").applyRealtimeCountersFromEvent(db, eventRow);
}

/**
 * Étape 32 — claim pending outbox rows and update aggregates.
 */
async function processGraphEventOutbox(db = pool, { limit = DEFAULT_BATCH } = {}) {
  const batchLimit = Math.max(1, Math.min(200, Number(limit) || DEFAULT_BATCH));
  const client = await db.connect();
  const summary = { claimed: 0, processed: 0, failed: 0, retried: 0 };
  let claimedRows = [];
  try {
    await client.query("BEGIN");
    const claimed = await client.query(
      `SELECT id, graph_event_id, attempt_count
       FROM event_outbox
       WHERE status = 'pending'
         AND available_at <= NOW()
       ORDER BY available_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [batchLimit]
    );
    claimedRows = claimed.rows;
    summary.claimed = claimedRows.length;
    if (!claimedRows.length) {
      await client.query("COMMIT");
      return summary;
    }

    await client.query(
      `UPDATE event_outbox
       SET status = 'processing', attempt_count = attempt_count + 1
       WHERE id = ANY($1::uuid[])`,
      [claimedRows.map((r) => r.id)]
    );
    // Refresh attempt_count after increment.
    const refreshed = await client.query(
      `SELECT id, graph_event_id, attempt_count
       FROM event_outbox WHERE id = ANY($1::uuid[])`,
      [claimedRows.map((r) => r.id)]
    );
    claimedRows = refreshed.rows;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Process outside the claim lock so a slow aggregate does not block writers.
  for (const row of claimedRows) {
    try {
      await processOneOutboxRow(db, row);
      await db.query(
        `UPDATE event_outbox
         SET status = 'processed', processed_at = NOW(), error_message = NULL
         WHERE id = $1::uuid`,
        [row.id]
      );
      summary.processed += 1;
    } catch (err) {
      const attempts = Number(row.attempt_count) || 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db.query(
          `UPDATE event_outbox
           SET status = 'failed', failed_at = NOW(), error_message = $2
           WHERE id = $1::uuid`,
          [row.id, String(err.message || err).slice(0, 2000)]
        );
        summary.failed += 1;
      } else {
        const delaySec = Math.min(3600, 2 ** Math.min(attempts, 8));
        await db.query(
          `UPDATE event_outbox
           SET status = 'pending',
               available_at = NOW() + ($2::int * INTERVAL '1 second'),
               error_message = $3
           WHERE id = $1::uuid`,
          [row.id, delaySec, String(err.message || err).slice(0, 2000)]
        );
        summary.retried += 1;
      }
    }
  }
  return summary;
}

async function getGraphAggregate(db, {
  level = GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL,
  metricKey,
  windowKey = "all"
} = {}) {
  if (!metricKey) return null;
  const id = aggregateId(level, metricKey, windowKey);
  const result = await db.query(
    `SELECT id, level, metric_key, window_key, value, unique_user_count, updated_at
     FROM graph_aggregates WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;

  if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
    const gated = applyPublicAnonymizationGate({
      uniqueUserCount: row.unique_user_count,
      payload: row.value
    });
    if (!gated.ok) {
      return {
        level,
        metricKey: row.metric_key,
        windowKey: row.window_key,
        insufficient: true,
        message: gated.message || INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
        uniqueUserCount: row.unique_user_count,
        minUsers: PUBLIC_ANONYMIZATION_MIN_USERS
      };
    }
  }

  return {
    level: row.level,
    metricKey: row.metric_key,
    windowKey: row.window_key,
    value: row.value,
    uniqueUserCount: row.unique_user_count,
    updatedAt: row.updated_at
  };
}

function startGraphOutboxWorker(db = pool) {
  if (workerStarted) return;
  workerStarted = true;

  const pollMs = Number(process.env.GRAPH_OUTBOX_POLL_MS);
  const intervalMs = Number.isFinite(pollMs) ? pollMs : DEFAULT_POLL_MS;

  const tick = () => {
    processGraphEventOutbox(db).catch((err) =>
      console.error("[sprite-graph-outbox] tick failed:", err.message)
    );
  };
  tick();

  if (intervalMs <= 0) {
    console.log("[sprite-graph-outbox] interval disabled (GRAPH_OUTBOX_POLL_MS=0)");
    return;
  }
  workerInterval = setInterval(tick, intervalMs);
  if (typeof workerInterval.unref === "function") workerInterval.unref();
  console.log(`[sprite-graph-outbox] worker started (every ${intervalMs}ms)`);
}

function stopGraphOutboxWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  workerStarted = false;
}

module.exports = {
  OUTBOX_STATUSES,
  DEFAULT_POLL_MS,
  ensureEventOutboxTables,
  enqueueGraphEventOutbox,
  processGraphEventOutbox,
  getGraphAggregate,
  startGraphOutboxWorker,
  stopGraphOutboxWorker,
  aggregateId
};
