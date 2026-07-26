// ── Notification deliveries (Étape 43) ─────────────────────────────────────
// One notification can have several delivery rows — one per channel:
//   in_app | push | email
//
// The inbox row (`notifications`) stays the product entity; this table tracks
// per-channel provider attempts and outcomes. `notification_id` is INTEGER to
// match the existing `notifications.id SERIAL` primary key (spec used UUID).

const crypto = require("crypto");
const catalog = require("./notification-catalog");
const { toUtcIso } = require("./timezone");

const DELIVERY_STATUSES = Object.freeze({
  QUEUED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

const DELIVERY_CHANNELS = catalog.NOTIFICATION_CHANNEL_LIST;

let tableReady = false;

async function ensureDeliveriesTable(pool) {
  if (tableReady) return;
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
      channel VARCHAR(30) NOT NULL,
      provider VARCHAR(50),
      provider_message_id TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'queued',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      scheduled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      error_code TEXT,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (notification_id, channel)
    );
    CREATE INDEX IF NOT EXISTS idx_notif_deliveries_notification
      ON notification_deliveries (notification_id);
    CREATE INDEX IF NOT EXISTS idx_notif_deliveries_status
      ON notification_deliveries (status, scheduled_at)
      WHERE status = 'queued';
  `);
  tableReady = true;
}

function newDeliveryId() {
  return crypto.randomUUID();
}

/**
 * Upsert a delivery row for one channel. Returns the delivery id.
 */
async function ensureDelivery(pool, {
  notificationId,
  channel,
  status = DELIVERY_STATUSES.QUEUED,
  provider = null,
  scheduledAt = null,
  id = null
} = {}) {
  if (!notificationId || !DELIVERY_CHANNELS.includes(channel)) return null;
  await ensureDeliveriesTable(pool);

  const deliveryId = id || newDeliveryId();
  const scheduledIso = scheduledAt ? toUtcIso(scheduledAt) : null;

  const res = await pool.query(
    `INSERT INTO notification_deliveries
       (id, notification_id, channel, provider, status, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     ON CONFLICT (notification_id, channel) DO UPDATE SET
       provider = COALESCE(EXCLUDED.provider, notification_deliveries.provider),
       status = CASE
         WHEN notification_deliveries.status IN ('delivered', 'cancelled')
           THEN notification_deliveries.status
         ELSE EXCLUDED.status
       END,
       scheduled_at = COALESCE(EXCLUDED.scheduled_at, notification_deliveries.scheduled_at),
       updated_at = NOW()
     RETURNING id`,
    [deliveryId, notificationId, channel, provider, status, scheduledIso]
  );
  return res.rows[0]?.id || null;
}

/** In-app is delivered as soon as the notifications row exists. */
async function recordInAppDelivery(pool, notificationId) {
  await ensureDeliveriesTable(pool);
  const id = newDeliveryId();
  const res = await pool.query(
    `INSERT INTO notification_deliveries
       (id, notification_id, channel, provider, status, attempt_count,
        scheduled_at, sent_at, delivered_at)
     VALUES ($1, $2, 'in_app', 'sprite-index', 'delivered', 1, NOW(), NOW(), NOW())
     ON CONFLICT (notification_id, channel) DO UPDATE SET
       status = 'delivered',
       delivered_at = COALESCE(notification_deliveries.delivered_at, NOW()),
       updated_at = NOW()
     RETURNING id`,
    [id, notificationId]
  );
  return res.rows[0]?.id || null;
}

async function markDeliveryAttempt(pool, notificationId, channel, {
  provider = null,
  providerMessageId = null
} = {}) {
  await ensureDeliveriesTable(pool);
  await ensureDelivery(pool, { notificationId, channel, provider, status: DELIVERY_STATUSES.QUEUED });
  const res = await pool.query(
    `UPDATE notification_deliveries
     SET attempt_count = attempt_count + 1,
         provider = COALESCE($3, provider),
         provider_message_id = COALESCE($4, provider_message_id),
         status = 'sent',
         sent_at = COALESCE(sent_at, NOW()),
         updated_at = NOW()
     WHERE notification_id = $1 AND channel = $2
     RETURNING id, attempt_count`,
    [notificationId, channel, provider, providerMessageId]
  );
  return res.rows[0] || null;
}

async function markDeliveryDelivered(pool, notificationId, channel, {
  provider = null,
  providerMessageId = null
} = {}) {
  await ensureDeliveriesTable(pool);
  await ensureDelivery(pool, { notificationId, channel, provider, status: DELIVERY_STATUSES.QUEUED });
  const res = await pool.query(
    `UPDATE notification_deliveries
     SET status = 'delivered',
         provider = COALESCE($3, provider),
         provider_message_id = COALESCE($4, provider_message_id),
         attempt_count = GREATEST(attempt_count, 1),
         sent_at = COALESCE(sent_at, NOW()),
         delivered_at = COALESCE(delivered_at, NOW()),
         failed_at = NULL,
         error_code = NULL,
         error_message = NULL,
         updated_at = NOW()
     WHERE notification_id = $1 AND channel = $2
     RETURNING id`,
    [notificationId, channel, provider, providerMessageId]
  );
  return res.rows[0]?.id || null;
}

async function markDeliveryFailed(pool, notificationId, channel, {
  errorCode = null,
  errorMessage = null,
  provider = null
} = {}) {
  await ensureDeliveriesTable(pool);
  await ensureDelivery(pool, { notificationId, channel, provider, status: DELIVERY_STATUSES.QUEUED });
  const res = await pool.query(
    `UPDATE notification_deliveries
     SET status = 'failed',
         provider = COALESCE($3, provider),
         attempt_count = GREATEST(attempt_count, 1),
         failed_at = NOW(),
         error_code = $4,
         error_message = $5,
         updated_at = NOW()
     WHERE notification_id = $1 AND channel = $2
     RETURNING id`,
    [notificationId, channel, provider, errorCode, errorMessage]
  );
  return res.rows[0]?.id || null;
}

async function markDeliveryCancelled(pool, notificationId, channel, {
  errorCode = null,
  errorMessage = null
} = {}) {
  await ensureDeliveriesTable(pool);
  const res = await pool.query(
    `UPDATE notification_deliveries
     SET status = 'cancelled',
         failed_at = COALESCE(failed_at, NOW()),
         error_code = COALESCE($3, error_code),
         error_message = COALESCE($4, error_message),
         updated_at = NOW()
     WHERE notification_id = $1 AND channel = $2
     RETURNING id`,
    [notificationId, channel, errorCode, errorMessage]
  );
  return res.rows[0]?.id || null;
}

async function listDeliveriesForNotification(pool, notificationId) {
  await ensureDeliveriesTable(pool);
  const res = await pool.query(
    `SELECT id, notification_id, channel, provider, provider_message_id, status,
            attempt_count, scheduled_at, sent_at, delivered_at, failed_at,
            error_code, error_message, created_at, updated_at
     FROM notification_deliveries
     WHERE notification_id = $1
     ORDER BY created_at ASC`,
    [notificationId]
  );
  return res.rows;
}

module.exports = {
  DELIVERY_STATUSES,
  DELIVERY_CHANNELS,
  ensureDeliveriesTable,
  ensureDelivery,
  recordInAppDelivery,
  markDeliveryAttempt,
  markDeliveryDelivered,
  markDeliveryFailed,
  markDeliveryCancelled,
  listDeliveriesForNotification,
  newDeliveryId
};
