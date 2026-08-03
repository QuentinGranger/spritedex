"use strict";

// ── Sprite Graph realtime counters + rebuild + retention (Étapes 61–65) ───────
// Flow: event → incremental counter → nightly consolidation → official daily agg.
// entity_id is VARCHAR (variant/sprite/ids), not UUID — matches live schema.

const { pool } = require("./db");

// Event type strings duplicated to avoid circular require with sprite-graph.js.
const EVENT = Object.freeze({
  COLLECTION_SPRITE_ADDED: "collection.sprite_added",
  COLLECTION_PRIORITY_ADDED: "collection.priority_added",
  COMPARISON_COMPLETED: "comparison.completed",
  FRIEND_INVITATION_SENT: "friend_invitation.sent",
  GOAL_COMPLETED: "goal.completed",
  NOTIFICATION_OPENED: "notification.opened"
});

/** Étape 63 — realtime counter metric types. */
const GRAPH_COUNTER_METRICS = Object.freeze({
  PRIORITY_ADDED: "priority_added",
  COLLECTION_ADDED: "collection_added",
  COMPARISON_COMPLETED: "comparison_completed",
  COMPARISON_DIFFERENCE: "comparison_difference",
  INVITATION_SENT: "invitation_sent",
  GOAL_COMPLETED: "goal_completed",
  NOTIFICATION_OPENED: "notification_opened"
});

const GRAPH_COUNTER_METRIC_SET = new Set(Object.values(GRAPH_COUNTER_METRICS));

/** Sentinel entity for day-level totals (not a real domain id). */
const COUNTER_TOTAL_ENTITY = "_total";

/**
 * Étape 65 — retention policy.
 * Raw historical fields are kept; only technical satellite / bulky context may age out.
 */
const GRAPH_RETENTION = Object.freeze({
  /** Never delete raw graph_events rows in v1 (append-only historical advantage). */
  keepRawEventsForever: true,
  /** Minimum fields always preserved on an event. */
  rawEventKeepFields: Object.freeze([
    "id",
    "event_type",
    "event_version",
    "actor_user_id",
    "target_user_id",
    "sprite_id",
    "variant_id",
    "squad_id",
    "comparison_id",
    "friendship_id",
    "goal_id",
    "notification_id",
    "source",
    "occurred_at",
    "recorded_at",
    "deduplication_key"
  ]),
  /** Context keys considered useful long-term (kept when compacting). */
  usefulContextKeys: Object.freeze([
    "pairKey",
    "catalogueVersion",
    "topDifferenceSpriteIds",
    "goalScope",
    "fromStatus",
    "toStatus",
    "method",
    "notificationType",
    "complementarityRate",
    "impact",
    "updateMethod",
    "graphEligibility"
  ]),
  /** Context keys safe to drop after technicalRetentionDays. */
  technicalContextKeys: Object.freeze([
    "requestId",
    "traceId",
    "spanId",
    "clientBuild",
    "userAgent",
    "deviceId",
    "sessionId",
    "debug",
    "timingMs",
    "latencyMs",
    "ipHash",
    "rawPayload"
  ]),
  /** Days before processed outbox rows may be purged (env override). */
  outboxRetentionDays: (() => {
    const n = Number(process.env.GRAPH_OUTBOX_RETENTION_DAYS);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
  })(),
  /** Days before technical context keys may be stripped (env override). */
  technicalContextRetentionDays: (() => {
    const n = Number(process.env.GRAPH_TECHNICAL_CONTEXT_RETENTION_DAYS);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 90;
  })(),
  /** Days before consolidated counter rows may be pruned (env override). */
  counterRetentionDays: (() => {
    const n = Number(process.env.GRAPH_COUNTER_RETENTION_DAYS);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 180;
  })()
});

async function ensureMetricCounterTables(db = pool) {
  // Étape 63 — temporary / incremental counters (consolidated nightly).
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_metric_counters (
      metric_date DATE NOT NULL,
      metric_type VARCHAR(100) NOT NULL,
      entity_id VARCHAR(120) NOT NULL,
      count_value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, metric_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_graph_metric_counters_type_date
      ON graph_metric_counters (metric_type, metric_date DESC);
    CREATE INDEX IF NOT EXISTS idx_graph_metric_counters_entity
      ON graph_metric_counters (entity_id, metric_date DESC);
  `);
}

function metricDateFromOccurredAt(occurredAt) {
  if (!occurredAt) return new Date().toISOString().slice(0, 10);
  const d = new Date(occurredAt);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function normalizeEntityId(value) {
  if (value == null || value === "") return COUNTER_TOTAL_ENTITY;
  return String(value).slice(0, 120);
}

/**
 * Étape 61–62 — atomic increment (no community % recalculation).
 */
async function incrementMetricCounter(
  db = pool,
  { metricDate, metricType, entityId = COUNTER_TOTAL_ENTITY, delta = 1 } = {}
) {
  if (!GRAPH_COUNTER_METRIC_SET.has(metricType)) return null;
  await ensureMetricCounterTables(db);
  const day = String(metricDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const entity = normalizeEntityId(entityId);
  const n = Number(delta);
  const bump = Number.isFinite(n) ? Math.trunc(n) : 1;
  if (bump === 0) return null;

  const result = await db.query(
    `INSERT INTO graph_metric_counters (
       metric_date, metric_type, entity_id, count_value, updated_at
     ) VALUES ($1::date, $2, $3, $4, NOW())
     ON CONFLICT (metric_date, metric_type, entity_id) DO UPDATE SET
       count_value = graph_metric_counters.count_value + EXCLUDED.count_value,
       updated_at = NOW()
     RETURNING *`,
    [day, metricType, entity, bump]
  );
  return result.rows[0] || null;
}

/**
 * Map a raw graph event → counter bumps (Étape 61).
 * Returns list of { metricType, entityId, delta }.
 */
function counterBumpsForEvent(eventRow) {
  if (!eventRow) return [];
  const type = eventRow.event_type || eventRow.eventType;
  const variantId = eventRow.variant_id || eventRow.variantId || null;
  const spriteId = eventRow.sprite_id || eventRow.spriteId || null;
  const context = eventRow.context && typeof eventRow.context === "object" ? eventRow.context : {};
  const bumps = [];

  if (type === EVENT.COLLECTION_PRIORITY_ADDED) {
    const entity = variantId || spriteId || null;
    bumps.push({
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: entity || COUNTER_TOTAL_ENTITY,
      delta: 1
    });
    if (entity) {
      bumps.push({
        metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
        entityId: COUNTER_TOTAL_ENTITY,
        delta: 1
      });
    }
  } else if (type === EVENT.COLLECTION_SPRITE_ADDED) {
    const entity = variantId || spriteId || null;
    bumps.push({
      metricType: GRAPH_COUNTER_METRICS.COLLECTION_ADDED,
      entityId: entity || COUNTER_TOTAL_ENTITY,
      delta: 1
    });
    if (entity) {
      bumps.push({
        metricType: GRAPH_COUNTER_METRICS.COLLECTION_ADDED,
        entityId: COUNTER_TOTAL_ENTITY,
        delta: 1
      });
    }
  } else if (type === EVENT.COMPARISON_COMPLETED) {
    bumps.push({
      metricType: GRAPH_COUNTER_METRICS.COMPARISON_COMPLETED,
      entityId: COUNTER_TOTAL_ENTITY,
      delta: 1
    });
    const diffs = Array.isArray(context.topDifferenceSpriteIds) ? context.topDifferenceSpriteIds : [];
    const unique = new Set(diffs.map(String).filter(Boolean));
    for (const sid of unique) {
      bumps.push({
        metricType: GRAPH_COUNTER_METRICS.COMPARISON_DIFFERENCE,
        entityId: sid,
        delta: 1
      });
    }
  } else if (type === EVENT.FRIEND_INVITATION_SENT) {
    bumps.push({
      metricType: GRAPH_COUNTER_METRICS.INVITATION_SENT,
      entityId: COUNTER_TOTAL_ENTITY,
      delta: 1
    });
  } else if (type === EVENT.GOAL_COMPLETED) {
    bumps.push({
      metricType: GRAPH_COUNTER_METRICS.GOAL_COMPLETED,
      entityId: COUNTER_TOTAL_ENTITY,
      delta: 1
    });
  } else if (type === EVENT.NOTIFICATION_OPENED) {
    const notifType = context.notificationType || context.type || null;
    bumps.push({
      metricType: GRAPH_COUNTER_METRICS.NOTIFICATION_OPENED,
      entityId: notifType || COUNTER_TOTAL_ENTITY,
      delta: 1
    });
    if (notifType) {
      bumps.push({
        metricType: GRAPH_COUNTER_METRICS.NOTIFICATION_OPENED,
        entityId: COUNTER_TOTAL_ENTITY,
        delta: 1
      });
    }
  }

  return bumps;
}

/**
 * Étape 61–62 — apply realtime increments from one event.
 * Explicitly does NOT recalculate community percentages.
 */
async function applyRealtimeCountersFromEvent(db = pool, eventRow) {
  const day = metricDateFromOccurredAt(eventRow.occurred_at || eventRow.occurredAt);
  const bumps = counterBumpsForEvent(eventRow);
  let applied = 0;
  for (const bump of bumps) {
    await incrementMetricCounter(db, {
      metricDate: day,
      metricType: bump.metricType,
      entityId: bump.entityId,
      delta: bump.delta
    });
    applied += 1;
  }
  return { metricDate: day, applied, recalculatedCommunity: false };
}

async function getMetricCounter(db = pool, { metricDate, metricType, entityId = COUNTER_TOTAL_ENTITY } = {}) {
  await ensureMetricCounterTables(db);
  const result = await db.query(
    `SELECT * FROM graph_metric_counters
     WHERE metric_date = $1::date
       AND metric_type = $2
       AND entity_id = $3`,
    [String(metricDate).slice(0, 10), metricType, normalizeEntityId(entityId)]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    metricDate: row.metric_date,
    metricType: row.metric_type,
    entityId: row.entity_id,
    countValue: Number(row.count_value) || 0,
    updatedAt: row.updated_at
  };
}

function eachDateInclusive(startDate, endDate) {
  const start = new Date(`${String(startDate).slice(0, 10)}T00:00:00.000Z`);
  const end = new Date(`${String(endDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Rebuild counters for [startDate, endDate] from effective raw events.
 */
async function rebuildMetricCountersFromEvents(db = pool, startDate, endDate) {
  await ensureMetricCounterTables(db);
  const start = String(startDate).slice(0, 10);
  const end = String(endDate).slice(0, 10);

  await db.query(
    `DELETE FROM graph_metric_counters
     WHERE metric_date >= $1::date AND metric_date <= $2::date`,
    [start, end]
  );

  const events = await db.query(
    `SELECT e.id, e.event_type, e.sprite_id, e.variant_id, e.context, e.occurred_at
     FROM graph_events e
     LEFT JOIN graph_event_corrections c ON c.cancelled_event_id = e.id
     WHERE c.id IS NULL
       AND e.occurred_at::date >= $1::date
       AND e.occurred_at::date <= $2::date
     ORDER BY e.occurred_at ASC, e.id ASC`,
    [start, end]
  );

  let applied = 0;
  for (const row of events.rows) {
    const result = await applyRealtimeCountersFromEvent(db, row);
    applied += result.applied;
  }
  return {
    startDate: start,
    endDate: end,
    events: events.rows.length,
    counterBumps: applied
  };
}

/**
 * Étape 64 — full rebuild from raw events for a date range.
 * Corrects formula / eligibility / catalogue version mistakes by replaying history.
 */
async function rebuildGraphMetrics(
  db = pool,
  startDate,
  endDate,
  { runDailyPipeline = true, rebuildCounters = true } = {}
) {
  const startedAt = new Date();
  const start = String(startDate).slice(0, 10);
  const end = String(endDate).slice(0, 10);
  const days = eachDateInclusive(start, end);
  if (!days.length) {
    throw new Error("rebuildGraphMetrics: invalid date range");
  }

  const summary = {
    startDate: start,
    endDate: end,
    days: days.length,
    counters: null,
    daily: []
  };

  if (rebuildCounters) {
    summary.counters = await rebuildMetricCountersFromEvents(db, start, end);
  }

  if (runDailyPipeline) {
    const { runSpriteGraphDailyPipeline } = require("./sprite-graph-daily");
    for (const day of days) {
      const result = await runSpriteGraphDailyPipeline(db, { metricDate: day });
      summary.daily.push({
        metricDate: day,
        catalogueVersion: result.catalogueVersion,
        eligibleUsers: result.eligibleUsers,
        variants: result.community?.variants ?? 0
      });
    }
  }

  try {
    await require("./sprite-graph-metrics").recordOpsRun(db, {
      runType: "rebuild",
      startedAt,
      finishedAt: new Date(),
      ok: true,
      details: { startDate: start, endDate: end, days: days.length }
    });
  } catch (_) {
    /* ops best-effort */
  }

  return summary;
}

/**
 * Étape 65 — prune technical artifacts only (never raw event rows by default).
 */
async function pruneGraphTechnicalArtifacts(
  db = pool,
  {
    outboxRetentionDays = GRAPH_RETENTION.outboxRetentionDays,
    counterRetentionDays = GRAPH_RETENTION.counterRetentionDays,
    compactTechnicalContext = false,
    technicalContextRetentionDays = GRAPH_RETENTION.technicalContextRetentionDays
  } = {}
) {
  await ensureMetricCounterTables(db);

  const outbox = await db.query(
    `DELETE FROM event_outbox
     WHERE status = 'processed'
       AND processed_at IS NOT NULL
       AND processed_at < NOW() - ($1::int * INTERVAL '1 day')
     RETURNING id`,
    [Math.max(1, Math.floor(outboxRetentionDays))]
  );

  // Counters older than retention — only if already consolidated into daily aggs.
  const counters = await db.query(
    `DELETE FROM graph_metric_counters
     WHERE metric_date < (CURRENT_DATE - ($1::int * INTERVAL '1 day'))
     RETURNING metric_date`,
    [Math.max(1, Math.floor(counterRetentionDays))]
  );

  let compactedContexts = 0;
  if (compactTechnicalContext) {
    compactedContexts = await compactGraphEventTechnicalContext(db, {
      olderThanDays: technicalContextRetentionDays
    });
  }

  return {
    keepRawEventsForever: GRAPH_RETENTION.keepRawEventsForever,
    deletedOutboxRows: outbox.rows.length,
    deletedCounterRows: counters.rows.length,
    compactedContexts,
    rawEventKeepFields: GRAPH_RETENTION.rawEventKeepFields
  };
}

/**
 * Strip bulky technical keys from old event contexts (Étape 65).
 * Temporarily disables append-only trigger for context-only UPDATEs.
 * Never deletes rows; never removes useful analytics keys.
 */
async function compactGraphEventTechnicalContext(
  db = pool,
  { olderThanDays = GRAPH_RETENTION.technicalContextRetentionDays, limit = 500 } = {}
) {
  const days = Math.max(1, Math.floor(Number(olderThanDays) || 90));
  const batch = Math.max(1, Math.min(2000, Number(limit) || 500));
  const techKeys = GRAPH_RETENTION.technicalContextKeys;
  const client = await db.connect();
  let compacted = 0;
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE graph_events DISABLE TRIGGER trg_graph_events_append_only");

    const rows = await client.query(
      `SELECT id, context
       FROM graph_events
       WHERE occurred_at < NOW() - ($1::int * INTERVAL '1 day')
         AND context ?| $2::text[]
       ORDER BY occurred_at ASC
       LIMIT $3
       FOR UPDATE`,
      [days, techKeys, batch]
    );

    for (const row of rows.rows) {
      const ctx = row.context && typeof row.context === "object" ? { ...row.context } : {};
      let changed = false;
      for (const key of techKeys) {
        if (Object.prototype.hasOwnProperty.call(ctx, key)) {
          delete ctx[key];
          changed = true;
        }
      }
      if (!changed) continue;
      await client.query(`UPDATE graph_events SET context = $2::jsonb WHERE id = $1::uuid`, [
        row.id,
        JSON.stringify(ctx)
      ]);
      compacted += 1;
    }

    await client.query("ALTER TABLE graph_events ENABLE TRIGGER trg_graph_events_append_only");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    try {
      await client.query("ALTER TABLE graph_events ENABLE TRIGGER trg_graph_events_append_only");
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
  return compacted;
}

module.exports = {
  GRAPH_COUNTER_METRICS,
  GRAPH_COUNTER_METRIC_SET,
  COUNTER_TOTAL_ENTITY,
  GRAPH_RETENTION,
  ensureMetricCounterTables,
  incrementMetricCounter,
  counterBumpsForEvent,
  applyRealtimeCountersFromEvent,
  getMetricCounter,
  rebuildMetricCountersFromEvents,
  rebuildGraphMetrics,
  pruneGraphTechnicalArtifacts,
  compactGraphEventTechnicalContext,
  eachDateInclusive
};
