// ── Notification delivery queue (Étape 42) ────────────────────────────────
// External sends (push / email) never run inside the domain request path.
//
//   domain event
//     → create notification (in-app row)
//     → resolve preferences / channels
//     → enqueue delivery job
//     → worker sends push/email
//     → update notification status
//
// Push provider failures therefore cannot block friend accepts, collection
// updates, squad stats, or catalogue publishes.

const { toUtcIso } = require("./timezone");

const QUEUE_STATUSES = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

// Default worker tick. Override with NOTIFICATION_DELIVERY_QUEUE_MS (ms); 0 = disable interval.
const QUEUE_POLL_MS = Math.max(0, Number(process.env.NOTIFICATION_DELIVERY_QUEUE_MS ?? 5_000));
const DEFAULT_MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

let tableReady = false;
let workerStarted = false;
let workerInterval = null;

async function ensureDeliveryQueueTable(pool) {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_delivery_queue (
      id BIGSERIAL PRIMARY KEY,
      notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channels TEXT[] NOT NULL DEFAULT '{}',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      not_before TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      available_at TIMESTAMPTZ,
      deadline TIMESTAMPTZ,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_notif_delivery_queue_due
      ON notification_delivery_queue (not_before, id)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_notif_delivery_queue_notification
      ON notification_delivery_queue (notification_id);
  `);
  tableReady = true;
}

function externalChannelsOnly(channels = []) {
  return (channels || []).filter((c) => c === "push" || c === "email");
}

/**
 * Enqueue an external delivery job. Returns the job id, or null if nothing to send.
 * `notBefore` delays the send (quiet hours). `deadline` cancels the job if crossed.
 */
async function enqueueDelivery(
  pool,
  {
    notificationId,
    recipientId,
    channels = [],
    notBefore = new Date(),
    deadline = null,
    title = null,
    body = null,
    url = null,
    maxAttempts = DEFAULT_MAX_ATTEMPTS
  } = {}
) {
  const external = externalChannelsOnly(channels);
  if (!notificationId || recipientId == null || !external.length) return null;

  await ensureDeliveryQueueTable(pool);
  const notBeforeIso = toUtcIso(notBefore) || new Date().toISOString();
  const deadlineIso = deadline ? toUtcIso(deadline) : null;
  const payload = {
    title: title || null,
    body: body || null,
    url: url || "/"
  };

  const res = await pool.query(
    `INSERT INTO notification_delivery_queue
       (notification_id, recipient_id, channels, not_before, deadline, payload, max_attempts, status)
     VALUES ($1, $2, $3::text[], $4::timestamptz, $5::timestamptz, $6::jsonb, $7, $8)
     RETURNING id`,
    [
      notificationId,
      recipientId,
      external,
      notBeforeIso,
      deadlineIso,
      JSON.stringify(payload),
      Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS),
      QUEUE_STATUSES.PENDING
    ]
  );

  // Étape 43 — mirror each channel as a queued delivery row.
  const deliveries = require("./notification-deliveries");
  for (const ch of external) {
    await deliveries
      .ensureDelivery(pool, {
        notificationId,
        channel: ch,
        status: "queued",
        provider: ch === "push" ? "web_push" : "email",
        scheduledAt: notBeforeIso
      })
      .catch(() => {});
  }

  // Mark the inbox row as queued while external channels are pending.
  await pool
    .query(
      `UPDATE notifications SET status = 'queued'
     WHERE id = $1 AND status IN ('created', 'queued')`,
      [notificationId]
    )
    .catch(() => {});

  return res.rows[0]?.id || null;
}

async function claimNextJobs(pool, limit = BATCH_SIZE) {
  const res = await pool.query(
    `WITH due AS (
       SELECT id
       FROM notification_delivery_queue
       WHERE status = $1
         AND not_before <= NOW()
         AND (available_at IS NULL OR available_at <= NOW())
       ORDER BY not_before ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE notification_delivery_queue q
     SET status = $3,
         attempts = q.attempts + 1,
         updated_at = NOW()
     FROM due
     WHERE q.id = due.id
     RETURNING q.*`,
    [QUEUE_STATUSES.PENDING, Math.max(1, Math.min(100, limit)), QUEUE_STATUSES.PROCESSING]
  );
  return res.rows;
}

async function markJobDone(pool, jobId) {
  await pool.query(
    `UPDATE notification_delivery_queue
     SET status = $2, processed_at = NOW(), updated_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [jobId, QUEUE_STATUSES.DONE]
  );
}

async function markJobCancelled(pool, jobId, reason) {
  await pool.query(
    `UPDATE notification_delivery_queue
     SET status = $2, processed_at = NOW(), updated_at = NOW(), last_error = $3
     WHERE id = $1`,
    [jobId, QUEUE_STATUSES.CANCELLED, reason || null]
  );
}

async function markJobRetryOrFail(pool, job, errorMessage) {
  const attempts = Number(job.attempts) || 1;
  const maxAttempts = Number(job.max_attempts) || DEFAULT_MAX_ATTEMPTS;
  if (attempts >= maxAttempts) {
    await pool.query(
      `UPDATE notification_delivery_queue
       SET status = $2, processed_at = NOW(), updated_at = NOW(), last_error = $3
       WHERE id = $1`,
      [job.id, QUEUE_STATUSES.FAILED, errorMessage || "max_attempts"]
    );
    return "failed";
  }
  // Exponential backoff: 30s, 60s, 120s, …
  const delaySec = Math.min(30 * 2 ** Math.max(0, attempts - 1), 30 * 60);
  await pool.query(
    `UPDATE notification_delivery_queue
     SET status = $2, available_at = NOW() + ($3::int * INTERVAL '1 second'),
         updated_at = NOW(), last_error = $4
     WHERE id = $1`,
    [job.id, QUEUE_STATUSES.PENDING, delaySec, errorMessage || "retry"]
  );
  return "retry";
}

async function loadNotificationForJob(pool, job) {
  const res = await pool.query(
    `SELECT id, recipient_id, actor_id, title, body, data, status, type,
            entity_type, entity_id
     FROM notifications WHERE id = $1`,
    [job.notification_id]
  );
  return res.rows[0] || null;
}

async function cancelJobAsObsolete(pool, pushService, job, notif, reason) {
  const data = notif.data && typeof notif.data === "object" ? notif.data : {};
  await pool
    .query(`UPDATE notifications SET data = $1::jsonb WHERE id = $2`, [
      JSON.stringify({
        ...data,
        pushDeferred: false,
        pushCancelled: true,
        obsoleteReason: reason || "obsolete",
        channelsDropped: {
          ...(data.channelsDropped || {}),
          push: reason || "obsolete"
        }
      }),
      notif.id
    ])
    .catch(() => {});

  await pushService.cancelNotification(pool, notif.id).catch(() => {});

  const deliveries = require("./notification-deliveries");
  for (const ch of externalChannelsOnly(job.channels)) {
    await deliveries
      .markDeliveryCancelled(pool, notif.id, ch, {
        errorCode: reason || "obsolete",
        errorMessage: `Delivery cancelled: ${reason || "obsolete"}`
      })
      .catch(() => {});
  }
  await markJobCancelled(pool, job.id, reason || "obsolete");
}

/**
 * Process due queue jobs. Safe to call from a timer; uses SKIP LOCKED.
 */
async function processDeliveryQueue(pool, { limit = BATCH_SIZE } = {}) {
  await ensureDeliveryQueueTable(pool);
  const pushService = require("../push-service");
  const jobs = await claimNextJobs(pool, limit);
  const summary = { claimed: jobs.length, done: 0, failed: 0, cancelled: 0, retried: 0 };

  for (const job of jobs) {
    try {
      const notif = await loadNotificationForJob(pool, job);
      if (!notif || notif.status === "cancelled" || notif.status === "archived") {
        await markJobCancelled(pool, job.id, "notification_cancelled");
        summary.cancelled++;
        continue;
      }

      // Étape 41 — never send after the event / availability deadline.
      if (job.deadline && new Date(job.deadline).getTime() <= Date.now()) {
        const data = notif.data || {};
        await pool
          .query(`UPDATE notifications SET data = $1::jsonb WHERE id = $2`, [
            JSON.stringify({
              ...data,
              pushDeferred: false,
              pushCancelled: true,
              channelsDropped: {
                ...(data.channelsDropped || {}),
                push: "quiet_hours_past_deadline"
              }
            }),
            notif.id
          ])
          .catch(() => {});
        const deliveries = require("./notification-deliveries");
        for (const ch of externalChannelsOnly(job.channels)) {
          await deliveries
            .markDeliveryCancelled(pool, notif.id, ch, {
              errorCode: "past_deadline",
              errorMessage: "Delivery cancelled: past event deadline"
            })
            .catch(() => {});
        }
        await markJobCancelled(pool, job.id, "past_deadline");
        summary.cancelled++;
        continue;
      }

      const userRes = await pool.query(
        `SELECT email, push_enabled, push_quiet_start, push_quiet_end, push_max_per_day, timezone
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [job.recipient_id]
      );
      const user = userRes.rows[0];
      if (!user) {
        await markJobCancelled(pool, job.id, "user_missing");
        summary.cancelled++;
        continue;
      }

      // Étape 56 — final live check before every scheduled external send.
      // Cancels when friendship/squad/privacy/availability/ownership changed.
      const presend = require("./notification-presend");
      const freshness = await presend.revalidateBeforeScheduledPush(pool, notif);
      if (!freshness.ok) {
        await cancelJobAsObsolete(pool, pushService, job, notif, freshness.reason || "obsolete");
        summary.cancelled++;
        continue;
      }

      const payload = job.payload || {};
      const title = payload.title || notif.title;
      const body = payload.body || notif.body;
      const url = payload.url || (notif.data && notif.data.actionUrl) || "/";
      const channels = externalChannelsOnly(job.channels);

      await pushService.deliverExternalChannels(pool, {
        notificationId: notif.id,
        recipientId: job.recipient_id,
        user,
        targetChannels: channels,
        title,
        body,
        url
      });

      // Reflect push send on the notification data blob.
      if (channels.includes("push")) {
        const data = notif.data || {};
        await pool
          .query(`UPDATE notifications SET data = $1::jsonb WHERE id = $2`, [
            JSON.stringify({
              ...data,
              pushDeferred: false,
              pushSent: true,
              channels: Array.from(new Set([...(data.channels || []), "push"]))
            }),
            notif.id
          ])
          .catch(() => {});
      }

      await markJobDone(pool, job.id);
      summary.done++;
    } catch (err) {
      const outcome = await markJobRetryOrFail(pool, job, err.message);
      if (outcome === "failed") {
        summary.failed++;
        await pool
          .query(`UPDATE notifications SET status = 'failed' WHERE id = $1 AND status IN ('created', 'queued')`, [
            job.notification_id
          ])
          .catch(() => {});
      } else {
        summary.retried++;
      }
    }
  }
  return summary;
}

function startDeliveryQueueWorker(pool) {
  if (workerStarted) return;
  workerStarted = true;

  const tick = () => {
    processDeliveryQueue(pool).catch((err) => console.error("[delivery-queue] process failed:", err.message));
  };
  tick();

  if (QUEUE_POLL_MS <= 0) {
    console.log("[delivery-queue] interval disabled (NOTIFICATION_DELIVERY_QUEUE_MS=0)");
    return;
  }
  workerInterval = setInterval(tick, QUEUE_POLL_MS);
  if (typeof workerInterval.unref === "function") workerInterval.unref();
  console.log(`[delivery-queue] worker started (every ${QUEUE_POLL_MS}ms)`);
}

function stopDeliveryQueueWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  workerStarted = false;
}

module.exports = {
  QUEUE_STATUSES,
  QUEUE_POLL_MS,
  DEFAULT_MAX_ATTEMPTS,
  ensureDeliveryQueueTable,
  enqueueDelivery,
  claimNextJobs,
  markJobDone,
  markJobCancelled,
  markJobRetryOrFail,
  processDeliveryQueue,
  startDeliveryQueueWorker,
  stopDeliveryQueueWorker,
  externalChannelsOnly
};
