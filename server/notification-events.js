// ── SPRITNEX notification service (Étape 8) ────────────────────────────────
// Subscribes to domain events emitted on the central event bus and turns them
// into notifications. For each event it determines:
//   • the recipients        (who should be told)
//   • the notification type  (stable catalog id)
//   • the preferences        (delegated to createNotification → étapes 6/7)
//   • the content            (delegated to the catalog → étape 1)
//   • the channels           (delegated to createNotification → étape 7)
//   • the anti-spam rules    (dedupe recent duplicates)
//
// Controllers only `emitDomainEvent(...)`; they never build notifications.

const { pool } = require("./db");
const pushService = require("../push-service");
const catalog = require("./notification-catalog");
const notifPrefs = require("./notification-preferences");
const { isBlocked } = require("./auth");
const { DOMAIN_EVENTS, onDomainEvent } = require("./event-bus");
const { claimNotification, claimDedupeKey } = require("./event-idempotency");
const {
  evaluateFriendshipAcceptedConditions,
  buildFriendRequestAcceptedDedupeKey
} = require("./notification-gates");

const TYPES = catalog.NOTIFICATION_TYPES;
const CATEGORIES = catalog.NOTIFICATION_CATEGORIES;

// Anti-spam windows (hours) per notification type.
const DEDUPE_HOURS = {
  [TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: 24,
  [TYPES.SQUAD_COMPLETION_INCREASED]: 12,
  [TYPES.PRIORITY_VARIANT_AVAILABLE]: 24,
  [TYPES.WANTED_EVENT_ENDING_SOON]: 48
};

async function username(userId) {
  const res = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
  return res.rows[0]?.username || null;
}

// Skip if a similar notification was created recently (anti-spam).
async function shouldSkip(recipientId, type, entityId) {
  const hours = DEDUPE_HOURS[type];
  if (!hours) return false;
  return pushService.recentNotificationExists(pool, { recipientId, type, entityId, withinHours: hours });
}

// Loads DB state and applies Étape 12 conditions for friendship.accepted.
async function checkFriendshipAcceptedConditions(event) {
  const ctx = event.context || {};
  const accepterId = event.actorId || ctx.accepterId;
  const requesterId = event.entityId || ctx.requesterId;
  const previousStatus = ctx.previousStatus;
  const friendshipId = ctx.friendshipId || null;

  if (!requesterId || !accepterId) {
    return { ok: false, reason: "missing_parties", requesterId, accepterId };
  }

  // Invitation existed + friendship is now active (accepted).
  let friendship = null;
  if (friendshipId) {
    const byId = await pool.query(
      `SELECT id, status, requester_id, addressee_id FROM friendships WHERE id = $1`,
      [friendshipId]
    );
    friendship = byId.rows[0] || null;
  }
  if (!friendship) {
    const byPair = await pool.query(
      `SELECT id, status, requester_id, addressee_id FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2)
           OR (requester_id = $2 AND addressee_id = $1))
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [requesterId, accepterId]
    );
    friendship = byPair.rows[0] || null;
  }

  // The invitation row must still identify the original requester.
  if (friendship && Number(friendship.requester_id) !== Number(requesterId)) {
    return { ok: false, reason: "invitation_mismatch", requesterId, accepterId };
  }

  const blocked = await isBlocked(requesterId, accepterId);

  // Recipient must accept social notifications (category + type, opt-out).
  const { categoryEnabled, typeEnabled } = await notifPrefs.resolveChannelPreferences(
    pool, requesterId, TYPES.FRIEND_REQUEST_ACCEPTED, { category: CATEGORIES.SOCIAL }
  );

  const gate = evaluateFriendshipAcceptedConditions({
    requesterId,
    accepterId,
    previousStatus,
    friendshipExists: !!friendship,
    friendshipStatus: friendship?.status || null,
    blocked,
    socialEnabled: categoryEnabled,
    typeEnabled
  });
  return { ...gate, requesterId, accepterId, friendship };
}

// ── friendship.accepted → friend_request_accepted (Étapes 11–12) ──
// Trigger: relation pending → accepted.
// Recipient: the user who sent the initial request (requester).
// The accepter is never notified of their own action.
async function onFriendshipAccepted(event) {
  const check = await checkFriendshipAcceptedConditions(event);
  if (!check.ok) return;
  const { requesterId, accepterId, friendship } = check;

  const friendshipId = friendship?.id || event.context?.friendshipId || null;
  if (!friendshipId) return;

  // Étape 14 — one accepted invitation → one notification, keyed by friendship
  // rather than eventId so re-emits with a new eventId still collapse.
  const dedupeKey = buildFriendRequestAcceptedDedupeKey(friendshipId, requesterId);
  if (!(await claimDedupeKey(pool, dedupeKey, TYPES.FRIEND_REQUEST_ACCEPTED, requesterId))) return;

  const actorName = await username(accepterId);
  // Étape 13 — catalog builds title/body/actions; context supplies the data ids.
  await pushService.createNotification(pool, {
    recipientId: requesterId,
    actorId: accepterId,
    type: TYPES.FRIEND_REQUEST_ACCEPTED,
    entityType: "user",
    entityId: accepterId,
    context: {
      actorName,
      actorId: accepterId,
      friendId: accepterId,
      friendshipId,
      dedupeKey
    }
  });
}

// ── collection.variant_acquired → friend_acquired_missing_variant ──
// Étapes 15–21: trigger filtering, eligible friends, priority levels, privacy,
// 10-minute batching and per-friend daily push cap — all in notification-acquisition.
async function onCollectionVariantAcquired(event) {
  const acquisition = require("./notification-acquisition");
  await acquisition.handleVariantAcquired(event);
}

// ── squad.completion_changed → squad_completion_increased ──
// Étapes 22–27: real coverage gains, recipients, milestones, batching.
async function onSquadCompletionChanged(event) {
  const squadCompletion = require("./notification-squad-completion");
  await squadCompletion.handleSquadCompletionChanged(event);
}

// ── catalogue.variant_available → priority_variant_available ──
// Étapes 28–33: trusted availability transitions, priority recipients, period checks.
async function onCatalogueVariantAvailable(event) {
  const variantAvailable = require("./notification-variant-available");
  await variantAvailable.handleCatalogueVariantAvailable(event);
}

// ── catalogue.event_ending_soon → wanted_event_ending_soon ──
// Étape 34: users with at least one still-available priority variant in the event.
async function onCatalogueEventEndingSoon(event) {
  const eventEnding = require("./notification-event-ending");
  await eventEnding.handleCatalogueEventEndingSoon(event);
}

// Idempotency (Étape 10) is applied per recipient inside each handler via
// claimNotification(eventId, notificationType, recipientId), so a single event
// that fans out to many users never double-notifies any of them, and partial
// re-processing only fills in the recipients not yet notified.
let registered = false;
function registerNotificationEventHandlers() {
  if (registered) return;
  registered = true;
  onDomainEvent(DOMAIN_EVENTS.FRIENDSHIP_ACCEPTED, onFriendshipAccepted);
  onDomainEvent(DOMAIN_EVENTS.COLLECTION_VARIANT_ACQUIRED, onCollectionVariantAcquired);
  onDomainEvent(DOMAIN_EVENTS.SQUAD_COMPLETION_CHANGED, onSquadCompletionChanged);
  onDomainEvent(DOMAIN_EVENTS.CATALOGUE_VARIANT_AVAILABLE, onCatalogueVariantAvailable);
  onDomainEvent(DOMAIN_EVENTS.CATALOGUE_EVENT_ENDING_SOON, onCatalogueEventEndingSoon);
}

// Self-register on require.
registerNotificationEventHandlers();

module.exports = {
  registerNotificationEventHandlers,
  evaluateFriendshipAcceptedConditions,
  checkFriendshipAcceptedConditions,
  handlers: {
    onFriendshipAccepted,
    onCollectionVariantAcquired,
    onSquadCompletionChanged,
    onCatalogueVariantAvailable,
    onCatalogueEventEndingSoon
  }
};
