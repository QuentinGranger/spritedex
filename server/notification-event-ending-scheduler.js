// ── Wanted event ending-soon scheduler (Étape 39) ─────────────────────────
// Hourly process that scans active catalogue events, detects crossed temporal
// thresholds (7d / 3d / 24h), emits catalogue.event_ending_soon, and cancels
// queued alerts that are no longer relevant.

const { pool } = require("./db");
const catalog = require("./notification-catalog");
const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
const pushService = require("../push-service");
const {
  classifyWantedEventThreshold,
  isTrustedEndDateConfidence,
  normalizeEndDateKey,
  buildWantedEventEndingDomainEventId,
  WANTED_EVENT_THRESHOLDS
} = require("./notification-gates");
const {
  revalidateWantedEventBeforeSend
} = require("./notification-event-ending");

const TYPE = catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON;

// Default: once per hour. Override with NOTIFICATION_EVENT_ENDING_CRON_MS (ms).
// Set to 0 to disable the interval (manual runWantedEventEndingScheduler still works).
const CRON_MS = Math.max(0, Number(process.env.NOTIFICATION_EVENT_ENDING_CRON_MS ?? 60 * 60 * 1000));

let cronStarted = false;
let cronInterval = null;

async function loadActiveEvents(now = new Date()) {
  // Only events still running and within the widest threshold window (7 days).
  const horizon = new Date(now.getTime() + WANTED_EVENT_THRESHOLDS.SEVEN_DAYS.ms);
  const res = await pool.query(
    `SELECT e.id, e.name, e.end_date, e.data_status, e.sources,
            (
              SELECT ap.confidence
              FROM availability_periods ap
              WHERE ap.event_id = e.id AND ap.end_date IS NOT NULL
              ORDER BY ap.updated_at DESC NULLS LAST
              LIMIT 1
            ) AS period_confidence
     FROM events e
     WHERE e.end_date IS NOT NULL
       AND e.end_date > $1::timestamptz
       AND e.end_date <= $2::timestamptz
       AND COALESCE(e.data_status, '') <> 'invalid'
     ORDER BY e.end_date ASC`,
    [now.toISOString(), horizon.toISOString()]
  );
  return res.rows.map(row => ({
    id: row.id,
    name: row.name,
    endDate: row.end_date,
    dataStatus: row.data_status,
    confidence: String(row.period_confidence || "unknown").toLowerCase()
  }));
}

async function loadEventVariantIds(eventId) {
  const res = await pool.query(
    `SELECT DISTINCT v.id
     FROM sprite_variants v
     JOIN sprites s ON s.id = v.sprite_id
     WHERE s.event_id = $1
     UNION
     SELECT DISTINCT v.id
     FROM sprite_variants v
     JOIN sprites s ON s.id = v.sprite_id
     JOIN availability_periods ap ON ap.sprite_id = s.id
     WHERE ap.event_id = $1`,
    [eventId]
  );
  return res.rows.map(r => r.id);
}

/**
 * Étape 39 — for one event, decide whether a threshold was crossed and emit.
 * Returns { emitted: boolean, thresholdId, skippedReason? }.
 */
async function processEventEndingAlert(eventRow, now = new Date()) {
  const eventId = eventRow.id;
  const endDate = eventRow.endDate;
  const thresholdId = classifyWantedEventThreshold(endDate, now);
  if (!thresholdId) {
    return { emitted: false, thresholdId: null, skippedReason: "outside_thresholds" };
  }

  // Étape 36 — skip uncertain end dates before emitting.
  if (!isTrustedEndDateConfidence(eventRow.confidence)) {
    return { emitted: false, thresholdId, skippedReason: "end_date_untrusted" };
  }

  const variantIds = await loadEventVariantIds(eventId);
  if (!variantIds.length) {
    return { emitted: false, thresholdId, skippedReason: "no_variants" };
  }

  const domainEventId = buildWantedEventEndingDomainEventId(eventId, thresholdId, endDate);
  await emitDomainEvent(DOMAIN_EVENTS.CATALOGUE_EVENT_ENDING_SOON, {
    eventId: domainEventId,
    entityType: "event",
    entityId: eventId,
    context: {
      eventId,
      eventName: eventRow.name,
      variantIds,
      endDate,
      endingAt: endDate,
      endDateConfidence: eventRow.confidence,
      confidence: eventRow.confidence,
      threshold: thresholdId,
      remainingMs: new Date(endDate).getTime() - now.getTime(),
      endDateKey: normalizeEndDateKey(endDate)
    }
  });

  return { emitted: true, thresholdId, domainEventId };
}

/**
 * Étape 38/39 — cancel queued/created alerts that became useless.
 */
async function cancelStaleWantedEventNotifications() {
  const pending = await pool.query(
    `SELECT id, recipient_id, entity_id, data
     FROM notifications
     WHERE type = $1 AND status IN ('created', 'queued')
     ORDER BY created_at ASC
     LIMIT 200`,
    [TYPE]
  );

  let cancelled = 0;
  for (const row of pending.rows) {
    const data = row.data || {};
    const eventId = row.entity_id || data.eventId;
    if (!eventId) {
      if (await pushService.cancelNotification(pool, row.id)) cancelled++;
      continue;
    }
    const candidateVariantIds = Array.isArray(data.remainingPriorityVariantIds)
      ? data.remainingPriorityVariantIds
      : (Array.isArray(data.variantIds) ? data.variantIds : []);

    const check = await revalidateWantedEventBeforeSend({
      recipientId: row.recipient_id,
      eventId,
      scheduledEndingAt: data.endingAt || data.endDate || null,
      candidateVariantIds,
      includeMissing: false
    });

    if (!check.ok) {
      if (await pushService.cancelNotification(pool, row.id)) cancelled++;
    }
  }
  return cancelled;
}

/**
 * Full scheduler tick: load active events → thresholds → emit → cancel stale.
 */
async function runWantedEventEndingScheduler({ now = new Date() } = {}) {
  const summary = {
    eventsScanned: 0,
    emitted: 0,
    skipped: 0,
    cancelled: 0,
    byThreshold: { "7d": 0, "3d": 0, "24h": 0 }
  };

  const events = await loadActiveEvents(now);
  summary.eventsScanned = events.length;

  for (const eventRow of events) {
    try {
      const result = await processEventEndingAlert(eventRow, now);
      if (result.emitted) {
        summary.emitted++;
        if (result.thresholdId && summary.byThreshold[result.thresholdId] != null) {
          summary.byThreshold[result.thresholdId]++;
        }
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.skipped++;
      console.error(
        `[wanted-event-scheduler] event ${eventRow.id} failed:`,
        err.message
      );
    }
  }

  try {
    summary.cancelled = await cancelStaleWantedEventNotifications();
  } catch (err) {
    console.error("[wanted-event-scheduler] cancel sweep failed:", err.message);
  }

  return summary;
}

function startWantedEventEndingScheduler() {
  if (cronStarted) return;
  cronStarted = true;

  runWantedEventEndingScheduler().then(summary => {
    console.log(
      `[wanted-event-scheduler] initial run: scanned=${summary.eventsScanned} emitted=${summary.emitted} cancelled=${summary.cancelled}`
    );
  }).catch(err => console.error("[wanted-event-scheduler] initial run failed:", err.message));

  if (CRON_MS <= 0) {
    console.log("[wanted-event-scheduler] interval disabled (NOTIFICATION_EVENT_ENDING_CRON_MS=0)");
    return;
  }

  cronInterval = setInterval(() => {
    runWantedEventEndingScheduler()
      .then(summary => {
        if (summary.emitted || summary.cancelled) {
          console.log(
            `[wanted-event-scheduler] scanned=${summary.eventsScanned} emitted=${summary.emitted} cancelled=${summary.cancelled}`
          );
        }
      })
      .catch(err => console.error("[wanted-event-scheduler] cron failed:", err.message));
  }, CRON_MS);
  if (typeof cronInterval.unref === "function") cronInterval.unref();
  console.log(`[wanted-event-scheduler] started (every ${Math.round(CRON_MS / 60000)} min)`);
}

function stopWantedEventEndingScheduler() {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
  cronStarted = false;
}

module.exports = {
  CRON_MS,
  loadActiveEvents,
  loadEventVariantIds,
  processEventEndingAlert,
  cancelStaleWantedEventNotifications,
  runWantedEventEndingScheduler,
  startWantedEventEndingScheduler,
  stopWantedEventEndingScheduler
};
