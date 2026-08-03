// ── Squad completion increased (Étapes 22–27) ─────────────────────────────
// Detects real collective coverage gains, selects recipients, applies milestone
// vs ordinary thresholds, batches rapid progress (15–30 min), and creates
// squad_completion_increased notifications.

const { pool } = require("./db");
const { canViewCollection } = require("./auth");
const pushService = require("../push-service");
const catalog = require("./notification-catalog");
const notifPrefs = require("./notification-preferences");
const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
const { claimDedupeKey } = require("./event-idempotency");
const grouping = require("./notification-grouping");
const {
  SQUAD_BATCH_WINDOW_MS,
  crossedSquadMilestone,
  isSquadImmediatePush,
  buildSquadCompletionDedupeKey
} = require("./notification-gates");

const TYPE = catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED;
const CATEGORY = catalog.NOTIFICATION_CATEGORIES.COLLECTION;

const flushTimers = new Map();
let sweepStarted = false;
let notificationHiddenColumnEnsured = false;

async function ensureSquadCompletionTables(poolRef = pool) {
  await poolRef.query(`
    ALTER TABLE squad_members
      ADD COLUMN IF NOT EXISTS notifications_muted BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE squad_stats
      ADD COLUMN IF NOT EXISTS covered_count INTEGER,
      ADD COLUMN IF NOT EXISTS total_variants INTEGER;

    CREATE TABLE IF NOT EXISTS notification_squad_batches (
      squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      flush_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (squad_id, recipient_id)
    );
    CREATE INDEX IF NOT EXISTS idx_squad_batches_flush_at
      ON notification_squad_batches (flush_at);
  `);
}

async function getSquadRow(squadId) {
  const res = await pool.query("SELECT id, code, name FROM squads WHERE id = $1", [squadId]);
  return res.rows[0] || null;
}

async function username(userId) {
  if (!userId) return null;
  const res = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
  return res.rows[0]?.username || null;
}

async function lookupVariantName(variantId) {
  if (!variantId) return null;
  const res = await pool.query(
    `SELECT COALESCE(v.official_name, v.name) AS name
     FROM sprite_variants v WHERE v.id = $1`,
    [variantId]
  );
  return res.rows[0]?.name || String(variantId);
}

async function readPreviousStats(squadId) {
  const res = await pool.query(
    `SELECT collective_completion_rate, covered_count, total_variants
     FROM squad_stats WHERE squad_id = $1`,
    [squadId]
  );
  if (!res.rows.length) {
    return { previousRate: null, previousCoveredCount: null, previousTotal: null };
  }
  const row = res.rows[0];
  return {
    previousRate: row.collective_completion_rate != null ? parseFloat(row.collective_completion_rate) : null,
    previousCoveredCount: row.covered_count != null ? Number(row.covered_count) : null,
    previousTotal: row.total_variants != null ? Number(row.total_variants) : null
  };
}

function normalizeUserIds(value) {
  const raw = Array.isArray(value) ? value : [value];
  return [...new Set(raw.filter((id) => id !== null && id !== undefined && id !== "").map((id) => String(id)))];
}

async function getActiveSquadMembers(squadId, poolRef = pool) {
  const members = await poolRef.query(
    `SELECT sm.user_id, sm.notifications_muted, u.push_pref_squad_activity
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active' AND u.deleted_at IS NULL`,
    [squadId]
  );
  return members.rows;
}

// A completion payload exposes the collective rate, counts and often a
// variant.  It is safe only when the recipient may view every active collection
// used by that aggregate, not merely the latest contributor's collection.
async function canReceiveSquadCompletion(squadId, recipientId, contributingUserIds = [], members = null) {
  if (!squadId || recipientId == null) return false;
  const activeMembers = members || (await getActiveSquadMembers(squadId));
  const memberIds = activeMembers.map((row) => String(row.user_id));
  const recipientKey = String(recipientId);
  if (!memberIds.includes(recipientKey)) return false;

  const sourceIds = normalizeUserIds(contributingUserIds);
  for (const sourceId of sourceIds) {
    if (!(await canViewCollection(recipientId, sourceId))) return false;
  }
  for (const memberId of memberIds) {
    if (!(await canViewCollection(recipientId, memberId))) return false;
  }
  return true;
}

// Étape 24 — active members who can see the full collective scope, have squad
// notifs on, have not muted the squad, and accept the collection topic.
async function findEligibleRecipients(squadId, contributingUserId) {
  const memberRows = await getActiveSquadMembers(squadId);
  const contributorIds = normalizeUserIds(contributingUserId);

  const eligible = [];
  for (const row of memberRows) {
    const recipientId = row.user_id;
    if (row.notifications_muted === true) continue;
    if (row.push_pref_squad_activity === false) continue;

    const { categoryEnabled, typeEnabled } = await notifPrefs.resolveChannelPreferences(pool, recipientId, TYPE, {
      category: CATEGORY
    });
    if (categoryEnabled === false || typeEnabled === false) continue;

    if (!(await canReceiveSquadCompletion(squadId, recipientId, contributorIds, memberRows))) {
      continue;
    }

    const isContributor = contributorIds.includes(String(recipientId));
    eligible.push({ recipientId, isContributor });
  }
  return eligible;
}

function scheduleFlush(squadId, recipientId, flushAt) {
  const key = `${squadId}:${recipientId}`;
  const existing = flushTimers.get(key);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, new Date(flushAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    flushTimers.delete(key);
    flushSquadBatch(squadId, recipientId).catch((err) =>
      console.error("[notification-squad-completion] flush failed:", err.message)
    );
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
  flushTimers.set(key, timer);
}

function clearSquadFlushTimer(squadId, recipientId) {
  const key = `${squadId}:${recipientId}`;
  const existing = flushTimers.get(key);
  if (existing) clearTimeout(existing);
  flushTimers.delete(key);
}

/** Étape 58 — strip private squad destinations from a notification data blob. */
function revokeSquadPrivateDestination(data) {
  const base = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
  delete base.actionUrl;
  if (base.group && typeof base.group === "object") {
    base.group = { ...base.group, destination: null };
  }
  if (base.actions && typeof base.actions === "object") {
    const actions = { ...base.actions };
    if (actions.primary && typeof actions.primary === "object") {
      actions.primary = { ...actions.primary, url: null };
    }
    if (actions.secondary && typeof actions.secondary === "object") {
      actions.secondary = { ...actions.secondary, url: null };
    }
    base.actions = actions;
  }
  base.accessRevoked = true;
  base.accessRevokedReason = "squad_left";
  return base;
}

/**
 * Étape 58 — when a user leaves (or is removed from) a squad:
 *   • stop future progression batches for them
 *   • cancel scheduled / pending squad notifications
 *   • keep already-read history, but revoke private destinations
 */
async function applySquadLeaveNotificationCleanup(poolRef, squadId, userId) {
  if (squadId == null || userId == null) {
    return { clearedBatches: 0, cancelledPending: 0, revokedJobs: 0, revokedDestinations: 0 };
  }
  const db = poolRef || pool;
  clearSquadFlushTimer(squadId, userId);

  let clearedBatches = 0;
  try {
    await ensureSquadCompletionTables(db);
    const batchRes = await db.query(
      `DELETE FROM notification_squad_batches
       WHERE squad_id = $1 AND recipient_id = $2
       RETURNING squad_id`,
      [squadId, userId]
    );
    clearedBatches = batchRes.rowCount || 0;
  } catch (_) {
    // Table may not exist yet.
  }

  // Pending / scheduled squad progression alerts → cancel (not kept in inbox).
  const pending = await db.query(
    `SELECT id FROM notifications
     WHERE recipient_id = $1
       AND status IN ('created', 'queued')
       AND (
         type = $2
         OR type LIKE 'squad_%'
       )
       AND (
         entity_id = $3::text
         OR data->>'squadId' = $3::text
       )`,
    [userId, TYPE, String(squadId)]
  );
  const pendingIds = pending.rows.map((r) => r.id);
  const { cancelPendingJobsForNotifications } = require("./notification-blocks");
  let cancelledJobs = await cancelPendingJobsForNotifications(db, pendingIds);
  let cancelledPending = 0;
  for (const id of pendingIds) {
    if (await pushService.cancelNotification(db, id)) cancelledPending++;
  }

  // Keep history (incl. already-read); revoke private destinations on leftovers.
  const remaining = await db.query(
    `SELECT id, data FROM notifications
     WHERE recipient_id = $1
       AND status NOT IN ('cancelled', 'created', 'queued')
       AND (
         type = $2
         OR type LIKE 'squad_%'
       )
       AND (
         entity_id = $3::text
         OR data->>'squadId' = $3::text
       )`,
    [userId, TYPE, String(squadId)]
  );

  let revokedDestinations = 0;
  for (const row of remaining.rows) {
    const next = revokeSquadPrivateDestination(row.data || {});
    await db.query(`UPDATE notifications SET data = $1::jsonb WHERE id = $2`, [JSON.stringify(next), row.id]);
    revokedDestinations++;
  }

  return {
    clearedBatches,
    cancelledPending,
    cancelledJobs,
    revokedDestinations
  };
}

// A visibility or block change can happen after a notification was persisted.
// Re-checking at inbox-read time prevents historical completion payloads from
// continuing to disclose an actor's variant or a rate built from a now-private
// collection.  The row remains only as a non-displayable technical record.
async function hideInaccessibleSquadCompletionNotifications(poolRef, recipientId) {
  if (recipientId == null) return { hidden: 0, cancelledJobs: 0 };
  const db = poolRef || pool;
  const blocks = require("./notification-blocks");
  if (!notificationHiddenColumnEnsured) {
    await blocks.ensureNotificationHiddenColumn(db);
    notificationHiddenColumnEnsured = true;
  }
  const result = await db.query(
    `SELECT id, actor_id, entity_id, data
     FROM notifications
     WHERE recipient_id = $1
       AND type = $2
       AND hidden_at IS NULL
       AND status <> 'cancelled'`,
    [recipientId, TYPE]
  );

  const visibilityCache = new Map();
  const hiddenIds = [];
  for (const row of result.rows) {
    const data = row.data && typeof row.data === "object" ? row.data : {};
    const squadId = data.squadId || row.entity_id;
    const contributorId = data.contributingUserId || row.actor_id;
    const key = `${squadId || "none"}:${contributorId || "none"}`;
    let allowed = visibilityCache.get(key);
    if (allowed === undefined) {
      try {
        allowed = await canReceiveSquadCompletion(squadId, recipientId, contributorId);
      } catch (_) {
        // A failed authorization check must never expose an existing private
        // payload. It can be retried after the transient failure is resolved.
        allowed = false;
      }
      visibilityCache.set(key, allowed);
    }
    if (!allowed) hiddenIds.push(row.id);
  }

  if (!hiddenIds.length) return { hidden: 0, cancelledJobs: 0 };

  const cancelledJobs = await blocks.cancelPendingJobsForNotifications(db, hiddenIds).catch(() => 0);
  const technicalData = JSON.stringify({
    accessRevoked: true,
    accessRevokedReason: "collection_private",
    translationKey: "notifications.hidden",
    technical: { type: TYPE }
  });
  const hidden = await db.query(
    `UPDATE notifications
     SET hidden_at = COALESCE(hidden_at, NOW()),
         title = 'Notification masquée',
         body = '',
         data = $2::jsonb
     WHERE id = ANY($1::int[])
       AND hidden_at IS NULL`,
    [hiddenIds, technicalData]
  );
  return { hidden: hidden.rowCount || 0, cancelledJobs };
}

async function enqueueSquadProgress(squadId, recipientId, item, { immediate = false } = {}) {
  await ensureSquadCompletionTables();

  if (immediate || SQUAD_BATCH_WINDOW_MS <= 0) {
    // Merge with any pending batch items so nothing is lost, then flush now.
    const existing = await pool.query(
      `SELECT items FROM notification_squad_batches
       WHERE squad_id = $1 AND recipient_id = $2`,
      [squadId, recipientId]
    );
    let items = existing.rows.length && Array.isArray(existing.rows[0].items) ? [...existing.rows[0].items] : [];
    items.push(item);
    await pool.query(
      `INSERT INTO notification_squad_batches (squad_id, recipient_id, items, flush_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (squad_id, recipient_id) DO UPDATE SET
         items = EXCLUDED.items, flush_at = NOW(), updated_at = NOW()`,
      [squadId, recipientId, JSON.stringify(items)]
    );
    await flushSquadBatch(squadId, recipientId);
    return;
  }

  const flushAt = new Date(Date.now() + SQUAD_BATCH_WINDOW_MS);
  const existing = await pool.query(
    `SELECT items, flush_at FROM notification_squad_batches
     WHERE squad_id = $1 AND recipient_id = $2`,
    [squadId, recipientId]
  );

  let items = [];
  let finalFlushAt = flushAt;
  if (existing.rows.length) {
    items = Array.isArray(existing.rows[0].items) ? [...existing.rows[0].items] : [];
    finalFlushAt = existing.rows[0].flush_at;
  }
  items.push(item);

  await pool.query(
    `INSERT INTO notification_squad_batches (squad_id, recipient_id, items, flush_at)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (squad_id, recipient_id) DO UPDATE SET
       items = EXCLUDED.items, updated_at = NOW()`,
    [squadId, recipientId, JSON.stringify(items), finalFlushAt]
  );
  scheduleFlush(squadId, recipientId, finalFlushAt);
}

async function flushSquadBatch(squadId, recipientId) {
  await ensureSquadCompletionTables();
  const client = await pool.connect();
  let batch;
  try {
    await client.query("BEGIN");
    const res = await client.query(
      `DELETE FROM notification_squad_batches
       WHERE squad_id = $1 AND recipient_id = $2
       RETURNING items`,
      [squadId, recipientId]
    );
    await client.query("COMMIT");
    batch = res.rows[0] || null;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const key = `${squadId}:${recipientId}`;
  const timer = flushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    flushTimers.delete(key);
  }
  if (!batch) return;

  const items = Array.isArray(batch.items) ? batch.items : [];
  if (!items.length) return;

  // Re-check mute, preferences and collection visibility at flush time. A
  // batch can contain more than one contributor, so every source must remain
  // visible to the recipient before its shared aggregate is exposed.
  const contributingUserIds = normalizeUserIds(items.map((item) => item?.contributingUserId));
  const still = await findEligibleRecipients(squadId, contributingUserIds);
  const me = still.find((r) => String(r.recipientId) === String(recipientId));
  if (!me) return;

  const squad = await getSquadRow(squadId);
  if (!squad) return;

  const latest = items[items.length - 1];
  const allVariantIds = [];
  const seen = new Set();
  for (const it of items) {
    for (const v of it.newVariantIds || []) {
      if (!seen.has(v)) {
        seen.add(v);
        allVariantIds.push(v);
      }
    }
  }

  const milestone = items.reduce((best, it) => {
    if (it.milestone == null) return best;
    return best == null || it.milestone > best ? it.milestone : best;
  }, null);

  const first = items[0];
  const previousRate = first.previousRate;
  const newRate = latest.newRate;
  const previousCoveredCount = first.previousCoveredCount;
  const newCoveredCount = latest.newCoveredCount;
  const totalVariants = latest.totalVariants;
  const contributingUserId = latest.contributingUserId;
  const actorName = latest.actorName || (await username(contributingUserId));
  const variantName = latest.variantName || (allVariantIds[0] ? await lookupVariantName(allVariantIds[0]) : null);

  const isContributor = contributingUserIds.includes(String(recipientId));

  const contextBase = {
    squadId: String(squadId),
    squadName: squad.name,
    squadCode: squad.code,
    contributingUserId: contributingUserId != null ? String(contributingUserId) : null,
    actorName,
    variantName,
    newVariantIds: allVariantIds,
    previousRate,
    newRate,
    previousCoveredCount,
    newCoveredCount,
    totalVariants,
    coveredCount: newCoveredCount,
    completionRate: newRate,
    delta: Math.round((Number(newRate) - Number(previousRate)) * 100) / 100,
    milestone,
    count: allVariantIds.length,
    kind: milestone != null ? "milestone" : allVariantIds.length > 1 ? "batch" : "progress"
  };
  const destination = catalog.buildSquadEngineActionUrl(contextBase);
  // Étape 55 — group rapid coverage gains under squad_progress:{squadId}.
  const context = grouping.attachGroup(
    contextBase,
    grouping.buildSquadProgressGroup({
      squadId,
      items,
      destination
    })
  );

  // Étape 24 — contributor gets in-app only (no push).
  // Étape 51 — default push is milestones_only (enforced in channel resolution).
  await pushService.createNotification(pool, {
    recipientId,
    actorId: contributingUserId || null,
    type: TYPE,
    entityType: "squad",
    entityId: squadId,
    context,
    allowPush: !isContributor
  });
}

async function flushDueSquadBatches() {
  await ensureSquadCompletionTables();
  const due = await pool.query(
    `SELECT squad_id, recipient_id FROM notification_squad_batches
     WHERE flush_at <= NOW()
     LIMIT 100`
  );
  for (const row of due.rows) {
    await flushSquadBatch(row.squad_id, row.recipient_id).catch((err) =>
      console.error("[notification-squad-completion] due flush failed:", err.message)
    );
  }
}

function startSquadCompletionBatchSweep() {
  if (sweepStarted) return;
  sweepStarted = true;
  flushDueSquadBatches().catch(() => {});
  const interval = setInterval(() => {
    flushDueSquadBatches().catch(() => {});
  }, 30_000);
  if (typeof interval.unref === "function") interval.unref();
}

// Domain-event handler (Étapes 22–27).
async function handleSquadCompletionChanged(event) {
  const ctx = event.context || {};
  const squadId = event.entityId || ctx.squadId;
  if (!squadId) return;

  const previousCoveredCount = Number(ctx.previousCoveredCount);
  const newCoveredCount = Number(ctx.newCoveredCount);
  const previousRate = Number(ctx.previousRate);
  const newRate = Number(ctx.newRate);

  // Étapes 22–23 — only real collective gains (coverage count must rise).
  if (!(newCoveredCount > previousCoveredCount)) return;
  if (!(newRate > previousRate)) return;

  const newVariantIds = Array.isArray(ctx.newVariantIds) ? ctx.newVariantIds.map(String) : [];
  const contributingUserId = ctx.contributingUserId || event.actorId || null;
  const milestone = crossedSquadMilestone(previousRate, newRate);
  const immediate = isSquadImmediatePush({ milestone });

  const actorName = ctx.actorName || (await username(contributingUserId));
  const variantName = ctx.variantName || (newVariantIds[0] ? await lookupVariantName(newVariantIds[0]) : null);

  const recipients = await findEligibleRecipients(squadId, contributingUserId);
  const item = {
    eventId: event.eventId,
    previousCoveredCount,
    newCoveredCount,
    previousRate,
    newRate,
    totalVariants: ctx.totalVariants != null ? Number(ctx.totalVariants) : null,
    contributingUserId,
    actorName,
    variantName,
    newVariantIds,
    milestone,
    occurredAt: event.occurredAt || new Date().toISOString()
  };

  // Étape 54 — one claim per squad coverage level; PK still scopes by recipient.
  const squadDedupeKey = buildSquadCompletionDedupeKey(squadId, newCoveredCount);
  if (!squadDedupeKey) return;

  for (const { recipientId } of recipients) {
    if (!(await claimDedupeKey(pool, squadDedupeKey, TYPE, recipientId))) continue;

    // Milestones: flush immediately. Ordinary gains: batch (Étape 27).
    // Contributor still receives the flushed/batched in-app row, without push.
    await enqueueSquadProgress(squadId, recipientId, item, { immediate });
  }
}

/**
 * Étape 22 — called after squad_stats has been refreshed with the new coverage.
 * Emits squad.completion_changed only when covered count actually increased.
 */
async function emitIfCoverageIncreased(
  squadId,
  {
    contributingUserId,
    newVariantIds = [],
    previousRate,
    previousCoveredCount,
    newRate,
    newCoveredCount,
    totalVariants
  } = {}
) {
  if (!squadId) return false;
  if (previousCoveredCount == null || previousRate == null) return false;

  // Étape 23 — already owned by someone else → covered count unchanged → no event.
  if (!(Number(newCoveredCount) > Number(previousCoveredCount))) return false;
  if (!(Number(newRate) > Number(previousRate))) return false;

  const squad = await getSquadRow(squadId);
  const actorName = await username(contributingUserId);
  const variantIds = (newVariantIds || []).map(String);
  const variantName = variantIds[0] ? await lookupVariantName(variantIds[0]) : null;

  await emitDomainEvent(DOMAIN_EVENTS.SQUAD_COMPLETION_CHANGED, {
    actorId: contributingUserId || null,
    entityType: "squad",
    entityId: squadId,
    context: {
      squadId: String(squadId),
      squadName: squad?.name || null,
      squadCode: squad?.code || null,
      previousCoveredCount: Number(previousCoveredCount),
      newCoveredCount: Number(newCoveredCount),
      previousRate: Number(previousRate),
      newRate: Number(newRate),
      totalVariants: totalVariants != null ? Number(totalVariants) : null,
      contributingUserId: contributingUserId != null ? String(contributingUserId) : null,
      actorName,
      variantName,
      newVariantIds: variantIds
    }
  });
  return true;
}

module.exports = {
  ensureSquadCompletionTables,
  emitIfCoverageIncreased,
  handleSquadCompletionChanged,
  findEligibleRecipients,
  canReceiveSquadCompletion,
  flushSquadBatch,
  flushDueSquadBatches,
  startSquadCompletionBatchSweep,
  readPreviousStats,
  clearSquadFlushTimer,
  revokeSquadPrivateDestination,
  applySquadLeaveNotificationCleanup,
  hideInaccessibleSquadCompletionNotifications
};
