// ── Friend acquired a missing variant (Étapes 15–21) ──────────────────────
// Handles recipient selection, priority levels, privacy, 10-minute batching
// and the per-friend daily push cap for friend_acquired_missing_variant.

const { pool } = require("./db");
const pushService = require("../push-service");
const catalog = require("./notification-catalog");
const notifPrefs = require("./notification-preferences");
const { canViewCollection, isBlocked } = require("./auth");
const { claimDedupeKey } = require("./event-idempotency");
const grouping = require("./notification-grouping");
const {
  ACQUIRED_FROM_STATUSES,
  RECIPIENT_INTEREST_STATUSES,
  BATCH_WINDOW_MS,
  MAX_PUSH_PER_FRIEND_PER_DAY,
  buildFriendAcquiredDedupeKey,
  normalizeCollectionVersion,
  resolveAcquisitionPriority
} = require("./notification-gates");

const TYPE = catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT;
const CATEGORY = catalog.NOTIFICATION_CATEGORIES.COLLECTION;

// In-process timers keyed by `${actorId}:${recipientId}`.
const flushTimers = new Map();
let sweepStarted = false;

async function ensureAcquisitionBatchTable(poolRef = pool) {
  await poolRef.query(`
    CREATE TABLE IF NOT EXISTS notification_acquisition_batches (
      actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      variants JSONB NOT NULL DEFAULT '[]'::jsonb,
      flush_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (actor_id, recipient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_acq_batches_flush_at
      ON notification_acquisition_batches (flush_at);
  `);
}

async function resolveActorCollectionVersion(actorId, variantId, fallback) {
  const fromCtx = normalizeCollectionVersion(fallback);
  if (fromCtx) return fromCtx;
  if (!actorId || !variantId) return null;
  const res = await pool.query(
    `SELECT updated_at FROM sprite_entries
     WHERE user_id = $1 AND variant_id = $2`,
    [actorId, variantId]
  );
  return normalizeCollectionVersion(res.rows[0]?.updated_at);
}

async function lookupVariantNames(variantId, lang = "fr") {
  if (!variantId) return { variantName: null, spriteName: null };
  // Étape 62 — names from the localized catalog (FR: name, EN: official_name).
  const i18n = require("./notification-i18n");
  const names = await i18n.lookupLocalizedCatalogNames(pool, { variantId }, lang);
  return {
    variantName: names.variantName || String(variantId),
    spriteName: names.spriteName || null
  };
}

async function username(userId) {
  const res = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
  return res.rows[0]?.username || null;
}

// Étapes 16–18: friends who still need the variant (missing/priority only),
// accept the notification topic, can see the actor's collection, and are not blocked.
async function findEligibleFriends(actorId, variantId) {
  const friends = await pool.query(
    `SELECT u.id AS friend_id, se.status AS recipient_status
     FROM friendships f
     JOIN users u ON u.id = CASE
       WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     JOIN sprite_entries se ON se.user_id = u.id AND se.variant_id = $2
     WHERE f.status = 'accepted'
       AND (f.requester_id = $1 OR f.addressee_id = $1)
       AND u.deleted_at IS NULL
       AND se.status = ANY($3::text[])
       AND se.status <> 'owned'`,
    [actorId, variantId, RECIPIENT_INTEREST_STATUSES]
  );

  const eligible = [];
  for (const row of friends.rows) {
    const friendId = row.friend_id;
    if (await isBlocked(friendId, actorId)) continue;
    // Étape 18 — privacy: actor collection must be visible to the recipient.
    if (!(await canViewCollection(friendId, actorId))) continue;

    const resolved = await notifPrefs.resolveChannelPreferences(pool, friendId, TYPE, { category: CATEGORY });
    if (resolved.categoryEnabled === false || !notifPrefs.evaluateTypeActive(resolved)) continue;

    const level = resolveAcquisitionPriority(row.recipient_status);
    if (!level) continue; // unknown / other → no automatic notification (Étape 17)

    eligible.push({
      friendId,
      recipientStatus: row.recipient_status,
      priorityLevel: level,
      frequency: resolved.frequency || catalog.getDefaultFrequency(TYPE)
    });
  }
  return eligible;
}

async function countPushToday(actorId, recipientId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM notifications
     WHERE recipient_id = $1 AND actor_id = $2 AND type = $3
       AND created_at >= date_trunc('day', NOW())
       AND COALESCE((data->>'pushSent')::boolean, false) = true`,
    [recipientId, actorId, TYPE]
  );
  return res.rows[0]?.c || 0;
}

function scheduleFlush(actorId, recipientId, flushAt) {
  const key = `${actorId}:${recipientId}`;
  const existing = flushTimers.get(key);
  if (existing) clearTimeout(existing);

  const delay = Math.max(0, new Date(flushAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    flushTimers.delete(key);
    flushAcquisitionBatch(actorId, recipientId).catch((err) =>
      console.error("[notification-acquisition] flush failed:", err.message)
    );
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
  flushTimers.set(key, timer);
}

async function resolveAcquisitionFlushAt(recipientId, frequency) {
  const { nextDailyDigestAt, normalizeTimeZone } = require("./timezone");
  if (frequency === catalog.NOTIFICATION_FREQUENCIES.DAILY_DIGEST) {
    const tzRes = await pool.query("SELECT timezone FROM users WHERE id = $1 AND deleted_at IS NULL", [recipientId]);
    const timeZone = normalizeTimeZone(tzRes.rows[0]?.timezone);
    return nextDailyDigestAt(new Date(), timeZone);
  }
  return new Date(Date.now() + BATCH_WINDOW_MS);
}

async function enqueueAcquisition(actorId, recipientId, item, { frequency = null } = {}) {
  await ensureAcquisitionBatchTable();
  const freq = frequency || (await notifPrefs.getTypeFrequency(pool, recipientId, TYPE));
  if (freq === catalog.NOTIFICATION_FREQUENCIES.DISABLED) return;

  const flushAt = await resolveAcquisitionFlushAt(recipientId, freq);

  // Fixed window from the first acquisition; later ones only append variants.
  // Étape 50 — daily_digest keeps the first scheduled digest slot.
  const existing = await pool.query(
    `SELECT variants, flush_at FROM notification_acquisition_batches
     WHERE actor_id = $1 AND recipient_id = $2`,
    [actorId, recipientId]
  );

  let variants = [];
  let finalFlushAt = flushAt;
  if (existing.rows.length) {
    variants = Array.isArray(existing.rows[0].variants) ? [...existing.rows[0].variants] : [];
    finalFlushAt = existing.rows[0].flush_at;
  }
  if (!variants.some((v) => String(v.variantId) === String(item.variantId))) {
    variants.push(item);
  }

  await pool.query(
    `INSERT INTO notification_acquisition_batches (actor_id, recipient_id, variants, flush_at)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (actor_id, recipient_id) DO UPDATE SET
       variants = EXCLUDED.variants,
       updated_at = NOW()`,
    [actorId, recipientId, JSON.stringify(variants), finalFlushAt]
  );

  if (freq === catalog.NOTIFICATION_FREQUENCIES.IMMEDIATE && BATCH_WINDOW_MS <= 0) {
    await flushAcquisitionBatch(actorId, recipientId);
    return;
  }
  scheduleFlush(actorId, recipientId, finalFlushAt);
}

async function flushAcquisitionBatch(actorId, recipientId) {
  await ensureAcquisitionBatchTable();
  const client = await pool.connect();
  let batch;
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `DELETE FROM notification_acquisition_batches
       WHERE actor_id = $1 AND recipient_id = $2
       RETURNING variants`,
      [actorId, recipientId]
    );
    await client.query("COMMIT");
    batch = res.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const key = `${actorId}:${recipientId}`;
  const timer = flushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(key);
  }

  if (!batch) return;
  const variants = Array.isArray(batch.variants) ? batch.variants : [];
  if (!variants.length) return;

  // Re-check privacy at flush time (Étape 18).
  if (await isBlocked(recipientId, actorId)) return;
  if (!(await canViewCollection(recipientId, actorId))) return;

  const resolved = await notifPrefs.resolveChannelPreferences(pool, recipientId, TYPE, { category: CATEGORY });
  if (resolved.categoryEnabled === false || !notifPrefs.evaluateTypeActive(resolved)) return;

  // Prefer a priority-level variant as the highlight (Étape 17).
  const highlight = variants.find((v) => v.priorityLevel === "strong") || variants[0];
  const actorName = await username(actorId);
  const count = variants.length;
  const pushCount = await countPushToday(actorId, recipientId);
  const allowPush = pushCount < MAX_PUSH_PER_FRIEND_PER_DAY;

  const contextBase = {
    actorName,
    actorId,
    friendId: actorId,
    variantId: highlight.variantId,
    variantName: highlight.variantName,
    spriteName: highlight.spriteName,
    recipientCollectionStatus: highlight.recipientStatus,
    priorityLevel: highlight.priorityLevel,
    count,
    variantIds: variants.map((v) => v.variantId),
    highlightName: highlight.variantName
  };
  const destination = catalog.buildFriendCompareActionUrl(contextBase, { withVariant: true });
  // Étape 55 — group acquisitions from the same friend within the batch window.
  const context = grouping.attachGroup(
    contextBase,
    grouping.buildFriendAcquisitionsGroup({
      actorId,
      recipientId,
      variants,
      destination
    })
  );

  await pushService.createNotification(pool, {
    recipientId,
    actorId,
    type: TYPE,
    entityType: "variant",
    entityId: highlight.variantId,
    context,
    allowPush
  });
}

async function flushDueBatches() {
  await ensureAcquisitionBatchTable();
  const due = await pool.query(
    `SELECT actor_id, recipient_id FROM notification_acquisition_batches
     WHERE flush_at <= NOW()
     LIMIT 100`
  );
  for (const row of due.rows) {
    await flushAcquisitionBatch(row.actor_id, row.recipient_id).catch((err) =>
      console.error("[notification-acquisition] due flush failed:", err.message)
    );
  }
}

function startAcquisitionBatchSweep() {
  if (sweepStarted) return;
  sweepStarted = true;
  // Catch batches whose timers were lost (restart).
  flushDueBatches().catch(() => {});
  const interval = setInterval(() => {
    flushDueBatches().catch(() => {});
  }, 30_000);
  if (typeof interval.unref === "function") interval.unref();
}

// Entry point for the domain-event handler (Étapes 15–21).
async function handleVariantAcquired(event) {
  const actorId = event.actorId;
  const variantId = event.entityId || event.context?.variantId;
  const previousStatus = event.context?.previousStatus;
  if (!actorId || !variantId) return;

  // Étape 15 — only non-owned → owned from the allowed previous statuses.
  if (event.context?.newStatus && event.context.newStatus !== "owned") return;
  if (previousStatus != null && !ACQUIRED_FROM_STATUSES.includes(previousStatus)) return;

  const names = await lookupVariantNames(variantId);
  const variantName = event.context?.variantName || names.variantName;
  const spriteName = event.context?.spriteName || names.spriteName;
  const collectionVersion = await resolveActorCollectionVersion(
    actorId,
    variantId,
    event.context?.collectionVersion || event.occurredAt || event.eventId
  );
  if (!collectionVersion) return;

  const eligible = await findEligibleFriends(actorId, variantId);
  for (const friend of eligible) {
    const dedupeKey = buildFriendAcquiredDedupeKey(actorId, friend.friendId, variantId, collectionVersion);
    if (!dedupeKey) continue;
    if (!(await claimDedupeKey(pool, dedupeKey, TYPE, friend.friendId))) continue;

    await enqueueAcquisition(
      actorId,
      friend.friendId,
      {
        variantId: String(variantId),
        variantName,
        spriteName,
        recipientStatus: friend.recipientStatus,
        priorityLevel: friend.priorityLevel,
        eventId: event.eventId || null,
        acquiredAt: event.occurredAt || new Date().toISOString()
      },
      { frequency: friend.frequency }
    );
  }
}

// Test helper: flush immediately without waiting for the window.
async function flushNow(actorId, recipientId) {
  return flushAcquisitionBatch(actorId, recipientId);
}

module.exports = {
  ensureAcquisitionBatchTable,
  lookupVariantNames,
  findEligibleFriends,
  handleVariantAcquired,
  enqueueAcquisition,
  flushAcquisitionBatch,
  flushDueBatches,
  flushNow,
  startAcquisitionBatchSweep,
  countPushToday,
  BATCH_WINDOW_MS,
  MAX_PUSH_PER_FRIEND_PER_DAY
};
