// ── SPRITNEX notification idempotency (Étapes 9, 10 & 14) ─────────────────
// Each domain event carries a unique eventId. A single event can fan out into
// several notifications (e.g. one acquisition → many friends). To guarantee that
// the SAME event never produces the SAME notification twice for the SAME user,
// we record each produced notification keyed by (event_id, notification_type,
// recipient_id) and skip anything already recorded.
//
// Étape 14/54 also allow a stable business dedupe key in place of event_id
// (e.g. friend_accept:{friendshipId}:{recipientId}) so re-emits with a new
// eventId still collapse to one notification.
//
// event_id is stored as VARCHAR to accept UUIDs and deterministic dedupe keys;
// recipient_id is INTEGER to match users.id (SERIAL).

async function ensureProcessedEventsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_event_processing (
      event_id VARCHAR(200) NOT NULL,
      notification_type VARCHAR(80) NOT NULL,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, notification_type, recipient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_notif_event_processing_processed_at
      ON notification_event_processing (processed_at);
  `);
  // Widen event_id if an older install created VARCHAR(120).
  await pool.query(`
    ALTER TABLE notification_event_processing
      ALTER COLUMN event_id TYPE VARCHAR(200)
  `).catch(() => {});
  // Étape 9 used a coarser per-event table; the per-recipient table supersedes it.
  await pool.query(`DROP TABLE IF EXISTS processed_domain_events`);
}

// Atomically records that `notificationType` was produced for `recipientId` from
// `eventId` (or a business dedupe key). Returns true if this is the first time
// (caller should create the notification), false if it was already produced.
// A missing eventId/key cannot be deduped → always allowed.
async function claimNotification(pool, eventId, notificationType, recipientId) {
  if (!eventId || !notificationType || recipientId == null) return true;
  const res = await pool.query(
    `INSERT INTO notification_event_processing (event_id, notification_type, recipient_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (event_id, notification_type, recipient_id) DO NOTHING
     RETURNING event_id`,
    [String(eventId), notificationType, recipientId]
  );
  return res.rows.length > 0;
}

// Étape 14 — claim by an explicit business dedupe key.
async function claimDedupeKey(pool, dedupeKey, notificationType, recipientId) {
  return claimNotification(pool, dedupeKey, notificationType, recipientId);
}

// Housekeeping: drop old idempotency records (default 30 days).
async function purgeProcessedEvents(pool, olderThanDays = 30) {
  try {
    await pool.query(
      `DELETE FROM notification_event_processing WHERE processed_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [Number(olderThanDays) || 30]
    );
  } catch (err) {
    console.error("[purgeProcessedEvents]", err.message);
  }
}

module.exports = {
  ensureProcessedEventsTable,
  claimNotification,
  claimDedupeKey,
  purgeProcessedEvents
};
