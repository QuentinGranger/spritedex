// ── Étape 57 — Respect user blocks in notifications ────────────────────────
// When A blocks B:
//   1. Delete pending social notifications between them
//   2. Block future pairwise social / collection notifications
//   3. Hide older notifications that reveal private collection data
//   4. Keep only technical stubs / delivery logs (no private payload)

const catalog = require("./notification-catalog");

// Pending social inbox rows to remove entirely on block.
const PENDING_SOCIAL_TYPES = Object.freeze([
  catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
  "friend_request_received",
  "friend_removed",
  "friend_request_declined"
]);

// Types whose payload can reveal another user's collection / ownership.
const PRIVATE_PAIRWISE_TYPES = Object.freeze([
  catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
  "friend_collection_updated",
  "friend_priority_match"
]);

// Types that must never be created while a block exists between actor & recipient.
const BLOCKED_PAIRWISE_TYPES = Object.freeze([...PENDING_SOCIAL_TYPES, ...PRIVATE_PAIRWISE_TYPES]);

function isBlockedPairwiseType(type) {
  return BLOCKED_PAIRWISE_TYPES.includes(String(type || ""));
}

function isPendingSocialType(type) {
  const t = String(type || "");
  return PENDING_SOCIAL_TYPES.includes(t) || t.startsWith("friend_request_");
}

function isPrivatePairwiseType(type) {
  return PRIVATE_PAIRWISE_TYPES.includes(String(type || ""));
}

async function ensureNotificationHiddenColumn(pool) {
  await pool.query(`
    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ
  `);
  await pool
    .query(
      `
    CREATE INDEX IF NOT EXISTS idx_notifications_hidden
      ON notifications (recipient_id, created_at DESC)
      WHERE hidden_at IS NULL AND archived_at IS NULL
  `
    )
    .catch(() => {});
}

function technicalStubData(row = {}) {
  return {
    hiddenDueToBlock: true,
    technical: {
      type: row.type || null,
      category: row.category || null,
      entityType: row.entity_type || row.entityType || null,
      entityId: row.entity_id != null ? String(row.entity_id) : null,
      actorId: row.actor_id != null ? String(row.actor_id) : null,
      recipientId: row.recipient_id != null ? String(row.recipient_id) : null
    }
  };
}

/**
 * Cancel pending delivery-queue jobs for the given notification ids.
 * Deliveries / queue history for hidden rows are left as technical logs.
 */
async function cancelPendingJobsForNotifications(pool, notificationIds) {
  const ids = (Array.isArray(notificationIds) ? notificationIds : []).map(Number).filter((id) => Number.isFinite(id));
  if (!ids.length) return 0;
  const res = await pool.query(
    `UPDATE notification_delivery_queue
     SET status = 'cancelled', processed_at = COALESCE(processed_at, NOW()),
         updated_at = NOW(), last_error = 'blocked'
     WHERE notification_id = ANY($1::int[])
       AND status IN ('pending', 'processing')
     RETURNING id`,
    [ids]
  );
  return res.rowCount || 0;
}

/**
 * Étape 57 — apply notification consequences of a block between two users.
 * Idempotent: safe to call more than once for the same pair.
 */
async function applyBlockNotificationCleanup(pool, userA, userB) {
  if (userA == null || userB == null || String(userA) === String(userB)) {
    return {
      deletedPending: 0,
      cancelledSocial: 0,
      hiddenPrivate: 0,
      clearedBatches: 0,
      cancelledJobs: 0
    };
  }
  await ensureNotificationHiddenColumn(pool);

  // Drop in-flight acquisition batches so nothing flushes after the block.
  let clearedBatches = 0;
  try {
    const batchRes = await pool.query(
      `DELETE FROM notification_acquisition_batches
       WHERE (actor_id = $1 AND recipient_id = $2)
          OR (actor_id = $2 AND recipient_id = $1)
       RETURNING actor_id`,
      [userA, userB]
    );
    clearedBatches = batchRes.rowCount || 0;
  } catch (_) {
    // Table may not exist yet in very early installs.
  }

  // 1) Delete pending social notifications between them.
  const pending = await pool.query(
    `SELECT id FROM notifications
     WHERE status IN ('created', 'queued')
       AND (
         (recipient_id = $1 AND actor_id = $2)
         OR (recipient_id = $2 AND actor_id = $1)
       )
       AND (
         category = 'social'
         OR type = ANY($3::text[])
         OR type LIKE 'friend_request_%'
       )`,
    [userA, userB, PENDING_SOCIAL_TYPES]
  );
  const pendingIds = pending.rows.map((r) => r.id);
  let cancelledJobs = await cancelPendingJobsForNotifications(pool, pendingIds);

  let deletedPending = 0;
  if (pendingIds.length) {
    const del = await pool.query(`DELETE FROM notifications WHERE id = ANY($1::int[]) RETURNING id`, [pendingIds]);
    deletedPending = del.rowCount || 0;
  }

  // Étape 63 — also cancel social pairwise rows already past created/queued
  // (e.g. delivered in-app) so an immediate block after accept removes them
  // from the inbox. Jobs are cancelled; row kept as cancelled technical log.
  const socialLeft = await pool.query(
    `SELECT id FROM notifications
     WHERE status NOT IN ('cancelled', 'archived')
       AND (
         (recipient_id = $1 AND actor_id = $2)
         OR (recipient_id = $2 AND actor_id = $1)
       )
       AND (
         category = 'social'
         OR type = ANY($3::text[])
         OR type LIKE 'friend_request_%'
       )`,
    [userA, userB, PENDING_SOCIAL_TYPES]
  );
  const socialLeftIds = socialLeft.rows.map((r) => r.id);
  cancelledJobs += await cancelPendingJobsForNotifications(pool, socialLeftIds);
  let cancelledSocial = 0;
  if (socialLeftIds.length) {
    const cancelRes = await pool.query(
      `UPDATE notifications
       SET status = 'cancelled',
           hidden_at = COALESCE(hidden_at, NOW())
       WHERE id = ANY($1::int[])
       RETURNING id`,
      [socialLeftIds]
    );
    cancelledSocial = cancelRes.rowCount || 0;
  }

  // Also drop pending pairwise collection alerts (must not push after block).
  const pendingPrivate = await pool.query(
    `SELECT id FROM notifications
     WHERE status IN ('created', 'queued')
       AND (
         (recipient_id = $1 AND actor_id = $2)
         OR (recipient_id = $2 AND actor_id = $1)
       )
       AND type = ANY($3::text[])`,
    [userA, userB, PRIVATE_PAIRWISE_TYPES]
  );
  const pendingPrivateIds = pendingPrivate.rows.map((r) => r.id);
  cancelledJobs += await cancelPendingJobsForNotifications(pool, pendingPrivateIds);
  if (pendingPrivateIds.length) {
    const delPriv = await pool.query(`DELETE FROM notifications WHERE id = ANY($1::int[]) RETURNING id`, [
      pendingPrivateIds
    ]);
    deletedPending += delPriv.rowCount || 0;
  }

  // 3) Hide older notifications that still reveal private collection data.
  // Keep the row as a technical stub (ids / type) — strip title/body/payload.
  const hideRes = await pool.query(
    `UPDATE notifications
     SET hidden_at = COALESCE(hidden_at, NOW()),
         title = 'Notification masquée',
         body = '',
         data = jsonb_build_object(
           'hiddenDueToBlock', true,
           'translationKey', 'notifications.hidden',
           'technical', jsonb_build_object(
             'type', type,
             'category', category,
             'entityType', entity_type,
             'entityId', entity_id,
             'actorId', actor_id::text,
             'recipientId', recipient_id::text
           )
         )
     WHERE hidden_at IS NULL
       AND (
         (recipient_id = $1 AND actor_id = $2)
         OR (recipient_id = $2 AND actor_id = $1)
       )
       AND type = ANY($3::text[])
     RETURNING id`,
    [userA, userB, PRIVATE_PAIRWISE_TYPES]
  );

  // Cancel any still-pending external jobs for hidden rows.
  cancelledJobs += await cancelPendingJobsForNotifications(
    pool,
    hideRes.rows.map((r) => r.id)
  );

  return {
    deletedPending,
    cancelledSocial,
    hiddenPrivate: hideRes.rowCount || 0,
    clearedBatches,
    cancelledJobs
  };
}

module.exports = {
  PENDING_SOCIAL_TYPES,
  PRIVATE_PAIRWISE_TYPES,
  BLOCKED_PAIRWISE_TYPES,
  isBlockedPairwiseType,
  isPendingSocialType,
  isPrivatePairwiseType,
  ensureNotificationHiddenColumn,
  technicalStubData,
  applyBlockNotificationCleanup,
  cancelPendingJobsForNotifications
};
