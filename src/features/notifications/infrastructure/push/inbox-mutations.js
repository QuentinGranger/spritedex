"use strict";

/**
 * Étape 47 — mark a notification as read.
 * When `clicked` is true (user opened the notification), also set clicked_at
 * (first click only). Already-read rows can still receive clicked_at.
 */
async function markNotificationRead(pool, userId, notificationId, { clicked = false, channel = null } = {}) {
  const serialize = require("../../../../../server/notification-serialize");
  const id = serialize.fromPublicNotificationId(notificationId);
  if (!Number.isFinite(id)) return null;

  // Étape 27–30 — server-side open: authorize recipient, know prior clicked_at,
  // update + graph event in one transaction (no browser-only trust).
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prev = await client.query(
      `SELECT id, type, category, data, status, created_at, delivered_at, clicked_at, read_at
       FROM notifications
       WHERE id = $1 AND recipient_id = $2
         AND archived_at IS NULL
         AND hidden_at IS NULL
         AND status <> 'cancelled'
       FOR UPDATE`,
      [id, userId]
    );
    if (!prev.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }
    const before = prev.rows[0];
    const alreadyClicked = !!before.clicked_at;

    const result = await client.query(
      `UPDATE notifications SET
         read_at = COALESCE(read_at, NOW()),
         status = CASE
           WHEN status IN ('archived', 'cancelled') THEN status
           ELSE 'read'
         END,
         clicked_at = CASE
           WHEN $3::boolean THEN COALESCE(clicked_at, NOW())
           ELSE clicked_at
         END
       WHERE id = $1
         AND recipient_id = $2
       RETURNING id, read_at, clicked_at, status, type, category, data,
                 created_at, delivered_at`,
      [id, userId, !!clicked]
    );
    const row = result.rows[0] || null;

    // Étape 28 — opened = consulted. action_clicked / converted come later.
    if (row && clicked && !alreadyClicked) {
      const {
        recordGraphEvent,
        GRAPH_EVENT_TYPES,
        buildNotificationOpenedContext
      } = require("../../../../../server/sprite-graph");
      await recordGraphEvent(
        client,
        {
          eventType: GRAPH_EVENT_TYPES.NOTIFICATION_OPENED,
          actorUserId: userId,
          notificationId: row.id,
          source: "api",
          origin: "notifications.open",
          context: {
            ...buildNotificationOpenedContext(row, {
              channel,
              openedAt: row.clicked_at || new Date().toISOString()
            }),
            status: row.status
          },
          deduplicationKey: `${GRAPH_EVENT_TYPES.NOTIFICATION_OPENED}:${row.id}`
        },
        { throwOnError: true }
      );
    }

    await client.query("COMMIT");
    return row ? { id: row.id, read_at: row.read_at, clicked_at: row.clicked_at, status: row.status } : null;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[markNotificationRead]", err.message || err);
    return null;
  } finally {
    client.release();
  }
}

async function markAllNotificationsRead(pool, userId) {
  const result = await pool.query(
    `UPDATE notifications SET read_at = NOW(), status = 'read'
     WHERE recipient_id = $1 AND read_at IS NULL AND archived_at IS NULL
       AND hidden_at IS NULL AND status <> 'cancelled'
     RETURNING id`,
    [userId]
  );
  return result.rowCount || 0;
}

// Soft-removes a notification from the main inbox (status='archived').
async function archiveNotification(pool, userId, notificationId) {
  const serialize = require("../../../../../server/notification-serialize");
  const id = serialize.fromPublicNotificationId(notificationId);
  if (!Number.isFinite(id)) return false;
  const result = await pool.query(
    `UPDATE notifications SET status = 'archived', archived_at = COALESCE(archived_at, NOW())
     WHERE id = $1 AND recipient_id = $2 AND archived_at IS NULL
     RETURNING id`,
    [id, userId]
  );
  return result.rows.length > 0;
}

// Cancels notifications that became irrelevant before they were ever sent.
// Only affects still-pending rows (created/queued). Used by triggers, e.g. when
// an invitation is withdrawn or a priority variant is no longer wanted.
async function cancelNotification(pool, notificationId) {
  const result = await pool.query(
    `UPDATE notifications SET status = 'cancelled'
     WHERE id = $1 AND status IN ('created', 'queued')
     RETURNING id`,
    [notificationId]
  );
  return result.rows.length > 0;
}

/**
 * Étape 41/42 — legacy helper: enqueue any pushDeferred rows that have no queue
 * job yet, then let the delivery worker send them. Prefer enqueueing at create
 * time; this recovers rows created before the queue existed.
 */
async function flushDeferredPushes(pool) {
  const deliveryQueue = require("../../../../../server/notification-delivery-queue");
  await deliveryQueue.ensureDeliveryQueueTable(pool);

  const res = await pool.query(
    `SELECT n.id, n.recipient_id, n.title, n.body, n.data
     FROM notifications n
     WHERE n.status NOT IN ('cancelled', 'archived')
       AND COALESCE(n.data->>'pushDeferred', 'false') = 'true'
       AND COALESCE(n.data->>'pushSent', 'false') <> 'true'
       AND (n.data->>'pushDeliverAt') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM notification_delivery_queue q
         WHERE q.notification_id = n.id
           AND q.status IN ('pending', 'processing')
           AND 'push' = ANY (q.channels)
       )
     ORDER BY (n.data->>'pushDeliverAt')::timestamptz ASC
     LIMIT 50`
  );

  let enqueued = 0;
  for (const row of res.rows) {
    const data = row.data || {};
    const id = await deliveryQueue
      .enqueueDelivery(pool, {
        notificationId: row.id,
        recipientId: row.recipient_id,
        channels: ["push"],
        notBefore: data.pushDeliverAt,
        deadline: data.pushDeadline || data.endingAt || data.endDate || null,
        title: row.title,
        body: row.body,
        url: data.actionUrl || "/"
      })
      .catch(() => null);
    if (id) enqueued++;
  }

  const processed = await deliveryQueue.processDeliveryQueue(pool);
  return { enqueued, ...processed, examined: res.rows.length };
}

function startQuietHoursFlushSweep() {
  // Étape 42 — quiet-hours deferrals are regular queue jobs (not_before).
  // The delivery-queue worker is the single flusher.
  const { pool } = require("../../../../../server/db");
  const deliveryQueue = require("../../../../../server/notification-delivery-queue");
  deliveryQueue.startDeliveryQueueWorker(pool);
}

async function deleteNotification(pool, userId, notificationId) {
  const serialize = require("../../../../../server/notification-serialize");
  const id = serialize.fromPublicNotificationId(notificationId);
  if (!Number.isFinite(id)) return false;
  const result = await pool.query("DELETE FROM notifications WHERE id = $1 AND recipient_id = $2 RETURNING id", [
    id,
    userId
  ]);
  return result.rows.length > 0;
}

module.exports = {
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
  cancelNotification,
  deleteNotification,
  flushDeferredPushes,
  startQuietHoursFlushSweep
};
