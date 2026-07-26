// ── Étape 56 — Final pre-send checks for changing data ─────────────────────
// A notification may become obsolete between create/enqueue and the scheduled
// push (quiet hours, digest, batch flush). Before every external send, re-check
// live state and cancel when the alert is no longer relevant.
//
// Examples:
//   • friendship deleted / no longer accepted
//   • variant no longer available
//   • recipient obtained the variant
//   • event end date extended / changed
//   • recipient left the squad
//   • collection became private

const catalog = require("./notification-catalog");

const TYPES = catalog.NOTIFICATION_TYPES;

// Lazy-load auth (pulls Express core / env validation) only for live checks.
function auth() {
  return require("./auth");
}

// ── Pure gates (unit-testable) ──

function evaluateFriendshipStillRelevant({
  friendshipAccepted = false,
  blocked = false
} = {}) {
  if (blocked) return { ok: false, reason: "blocked", cancel: true };
  if (!friendshipAccepted) return { ok: false, reason: "friendship_gone", cancel: true };
  return { ok: true };
}

function evaluateFriendAcquisitionStillRelevant({
  friendshipAccepted = false,
  blocked = false,
  collectionVisible = false,
  remainingVariantCount = 0
} = {}) {
  const friendship = evaluateFriendshipStillRelevant({ friendshipAccepted, blocked });
  if (!friendship.ok) return friendship;
  if (!collectionVisible) {
    return { ok: false, reason: "collection_private", cancel: true };
  }
  if (!(Number(remainingVariantCount) > 0)) {
    return { ok: false, reason: "already_owned", cancel: true };
  }
  return { ok: true };
}

function evaluateSquadMembershipStillRelevant({ isActiveMember = false } = {}) {
  if (!isActiveMember) return { ok: false, reason: "squad_left", cancel: true };
  return { ok: true };
}

function evaluatePriorityVariantStillRelevant({
  stillAvailable = false,
  alreadyOwned = false,
  availabilityReason = null
} = {}) {
  if (alreadyOwned) return { ok: false, reason: "already_owned", cancel: true };
  if (!stillAvailable) {
    return {
      ok: false,
      reason: availabilityReason || "variant_unavailable",
      cancel: true
    };
  }
  return { ok: true };
}

// ── Live checks ──

async function countUnownedVariants(pool, recipientId, variantIds) {
  const ids = (Array.isArray(variantIds) ? variantIds : [])
    .map(String)
    .filter(Boolean);
  if (!recipientId || !ids.length) return 0;
  const owned = await pool.query(
    `SELECT variant_id FROM sprite_entries
     WHERE user_id = $1 AND variant_id = ANY($2::text[]) AND status = 'owned'`,
    [recipientId, ids]
  );
  const ownedSet = new Set(owned.rows.map((r) => String(r.variant_id)));
  return ids.filter((id) => !ownedSet.has(id)).length;
}

async function isActiveSquadMember(pool, squadId, userId) {
  if (!squadId || userId == null) return false;
  const res = await pool.query(
    `SELECT 1 FROM squad_members
     WHERE squad_id = $1 AND user_id = $2 AND status = 'active'
     LIMIT 1`,
    [squadId, userId]
  );
  return res.rows.length > 0;
}

async function revalidateFriendRequestAccepted(pool, notif) {
  const recipientId = notif.recipient_id;
  const data = notif.data || {};
  const friendId = data.friendId || data.actorId || notif.actor_id;
  if (!friendId) return { ok: false, reason: "friend_missing", cancel: true };
  const { areFriends, isBlocked } = auth();
  const blocked = await isBlocked(recipientId, friendId);
  const friendshipAccepted = await areFriends(recipientId, friendId);
  return evaluateFriendshipStillRelevant({ friendshipAccepted, blocked });
}

async function revalidateFriendAcquisition(pool, notif) {
  const recipientId = notif.recipient_id;
  const data = notif.data || {};
  const actorId = data.friendId || data.actorId || notif.actor_id;
  if (!actorId) return { ok: false, reason: "friend_missing", cancel: true };

  const { areFriends, canViewCollection, isBlocked } = auth();
  const blocked = await isBlocked(recipientId, actorId);
  const friendshipAccepted = await areFriends(recipientId, actorId);
  const collectionVisible = friendshipAccepted && !blocked
    ? await canViewCollection(recipientId, actorId)
    : false;

  const variantIds = Array.isArray(data.variantIds) && data.variantIds.length
    ? data.variantIds
    : (data.variantId != null ? [data.variantId] : []);
  const remainingVariantCount = await countUnownedVariants(pool, recipientId, variantIds);

  return evaluateFriendAcquisitionStillRelevant({
    friendshipAccepted,
    blocked,
    collectionVisible,
    remainingVariantCount
  });
}

async function revalidateSquadCompletion(pool, notif) {
  const recipientId = notif.recipient_id;
  const data = notif.data || {};
  const squadId = data.squadId || notif.entity_id;
  const isActiveMember = await isActiveSquadMember(pool, squadId, recipientId);
  const membership = evaluateSquadMembershipStillRelevant({ isActiveMember });
  if (!membership.ok) return membership;

  // Completion rows contain rates/counts based on the squad aggregate and may
  // name the contributing variant. Re-check all active source collections at
  // delivery time so a privacy change or block while queued cannot leak them.
  const { canViewCollection } = auth();
  const contributorId = data.contributingUserId || notif.actor_id;
  if (contributorId && !(await canViewCollection(recipientId, contributorId))) {
    return { ok: false, reason: "collection_private", cancel: true };
  }
  const members = await pool.query(
    `SELECT sm.user_id
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND u.deleted_at IS NULL`,
    [squadId]
  );
  for (const row of members.rows) {
    if (!(await canViewCollection(recipientId, row.user_id))) {
      return { ok: false, reason: "collection_private", cancel: true };
    }
  }
  return { ok: true };
}

async function revalidatePriorityVariant(pool, notif) {
  const recipientId = notif.recipient_id;
  const data = notif.data || {};
  const variantId = data.variantId || notif.entity_id;
  if (!variantId) return { ok: false, reason: "variant_missing", cancel: true };

  const variantAvailable = require("./notification-variant-available");
  const check = await variantAvailable.verifyAvailabilityForRecipient(
    variantId,
    recipientId,
    {
      availabilityPeriodId: data.availabilityPeriodId || null,
      availableFrom: data.availableFrom || null,
      availableUntil: data.availableUntil || null,
      confidence: data.confidence || null,
      eventId: data.eventId || null
    }
  );
  if (check.ok) return { ok: true };
  if (check.reason === "already_owned") {
    return evaluatePriorityVariantStillRelevant({
      stillAvailable: true,
      alreadyOwned: true
    });
  }
  return evaluatePriorityVariantStillRelevant({
    stillAvailable: false,
    alreadyOwned: false,
    availabilityReason: check.reason || "variant_unavailable"
  });
}

async function revalidateWantedEvent(pool, notif) {
  const data = notif.data || {};
  const eventId = data.eventId || notif.entity_id;
  const candidateVariantIds = Array.isArray(data.remainingPriorityVariantIds)
    ? data.remainingPriorityVariantIds
    : (Array.isArray(data.variantIds) ? data.variantIds : []);
  const ending = require("./notification-event-ending");
  return ending.revalidateWantedEventBeforeSend({
    recipientId: notif.recipient_id,
    eventId,
    scheduledEndingAt: data.endingAt || data.endDate || null,
    candidateVariantIds,
    includeMissing: false
  });
}

/**
 * Étape 56 — final check before a scheduled push/email job runs.
 * Unknown / non-contextual types pass through (ok).
 */
async function revalidateBeforeScheduledPush(pool, notif) {
  if (!notif || !notif.type) return { ok: true };
  switch (notif.type) {
    case TYPES.FRIEND_REQUEST_ACCEPTED:
      return revalidateFriendRequestAccepted(pool, notif);
    case TYPES.FRIEND_ACQUIRED_MISSING_VARIANT:
      return revalidateFriendAcquisition(pool, notif);
    case TYPES.SQUAD_COMPLETION_INCREASED:
      return revalidateSquadCompletion(pool, notif);
    case TYPES.PRIORITY_VARIANT_AVAILABLE:
      return revalidatePriorityVariant(pool, notif);
    case TYPES.WANTED_EVENT_ENDING_SOON:
      return revalidateWantedEvent(pool, notif);
    default:
      return { ok: true };
  }
}

module.exports = {
  evaluateFriendshipStillRelevant,
  evaluateFriendAcquisitionStillRelevant,
  evaluateSquadMembershipStillRelevant,
  evaluatePriorityVariantStillRelevant,
  revalidateBeforeScheduledPush,
  countUnownedVariants,
  isActiveSquadMember
};
