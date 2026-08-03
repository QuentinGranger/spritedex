// ── Daily digest queue (Étape 50) ─────────────────────────────────────────
// Defers non-immediate frequency notifications until the user's next local
// digest slot (default 09:00). Friend acquisitions use their own batch table;
// this queue covers alert types that opt into daily_digest.

const catalog = require("./notification-catalog");
const { nextDailyDigestAt, normalizeTimeZone } = require("./timezone");

let sweepStarted = false;

async function ensureDigestQueueTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_digest_queue (
      id SERIAL PRIMARY KEY,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(80) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      flush_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notif_digest_flush
      ON notification_digest_queue (flush_at);
    CREATE INDEX IF NOT EXISTS idx_notif_digest_recipient
      ON notification_digest_queue (recipient_id, type);
  `);
}

async function getUserTimeZone(pool, userId) {
  const res = await pool.query("SELECT timezone FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
  return normalizeTimeZone(res.rows[0]?.timezone);
}

async function enqueueDigestItem(pool, { recipientId, type, payload = {}, flushAt = null }) {
  if (!recipientId || !type) return null;
  await ensureDigestQueueTable(pool);
  const timeZone = await getUserTimeZone(pool, recipientId);
  const when = flushAt || nextDailyDigestAt(new Date(), timeZone);
  if (!when) return null;
  const res = await pool.query(
    `INSERT INTO notification_digest_queue (recipient_id, type, payload, flush_at)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id`,
    [recipientId, type, JSON.stringify(payload || {}), when]
  );
  return res.rows[0]?.id || null;
}

async function flushDueDigestItems(pool, { limit = 50 } = {}) {
  await ensureDigestQueueTable(pool);
  const pushService = require("../push-service");
  const due = await pool.query(
    `DELETE FROM notification_digest_queue
     WHERE id IN (
       SELECT id FROM notification_digest_queue
       WHERE flush_at <= NOW()
       ORDER BY flush_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, recipient_id, type, payload`,
    [Math.max(1, Math.min(200, limit))]
  );

  let flushed = 0;
  for (const row of due.rows) {
    const payload = row.payload || {};
    try {
      if (payload.kind === "wanted_event_ending_soon" && payload.createArgs) {
        const created = await pushService.createNotification(pool, payload.createArgs);
        const ending = require("./notification-event-ending");
        if (created && payload.finalizeArgs) {
          await ending.finalizeQueuedWantedEventNotification(created, payload.finalizeArgs);
        }
      } else {
        await pushService.createNotification(pool, {
          recipientId: row.recipient_id,
          actorId: payload.actorId || null,
          type: row.type,
          entityType: payload.entityType || null,
          entityId: payload.entityId || null,
          context: payload.context || {},
          allowPush: payload.allowPush !== false,
          deferDelivery: !!payload.deferDelivery
        });
      }
      flushed++;
    } catch (err) {
      console.error("[notification-digest] flush failed:", err.message);
    }
  }
  return flushed;
}

/**
 * Create now, or enqueue for the daily digest, according to frequency.
 * Returns { mode: 'immediate'|'daily_digest'|'disabled'|'skipped', id? }.
 */
async function deliverOrEnqueue(pool, { recipientId, type, frequency, createArgs }) {
  const freq = catalog.normalizeFrequency(frequency, type);
  if (freq === catalog.NOTIFICATION_FREQUENCIES.DISABLED) {
    return { mode: "disabled" };
  }
  if (freq === catalog.NOTIFICATION_FREQUENCIES.DAILY_DIGEST) {
    const id = await enqueueDigestItem(pool, {
      recipientId,
      type,
      payload: {
        actorId: createArgs.actorId || null,
        entityType: createArgs.entityType || null,
        entityId: createArgs.entityId || null,
        context: createArgs.context || {},
        allowPush: createArgs.allowPush !== false,
        deferDelivery: !!createArgs.deferDelivery
      }
    });
    return { mode: "daily_digest", id };
  }

  const pushService = require("../push-service");
  const created = await pushService.createNotification(pool, createArgs);
  return { mode: "immediate", id: created?.id || created };
}

function startDigestSweep(pool) {
  if (sweepStarted) return;
  sweepStarted = true;
  flushDueDigestItems(pool).catch(() => {});
  const interval = setInterval(() => {
    flushDueDigestItems(pool).catch(() => {});
  }, 60_000);
  if (typeof interval.unref === "function") interval.unref();
}

module.exports = {
  ensureDigestQueueTable,
  enqueueDigestItem,
  flushDueDigestItems,
  deliverOrEnqueue,
  startDigestSweep,
  getUserTimeZone
};
