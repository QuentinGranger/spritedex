// ── Étape 54 — Unique business dedupe keys for contextual notifications ────
// Each notification claim uses one of these stable keys (instead of a fresh
// eventId) so re-emits and scheduler ticks collapse to a single row per
// (key, notification_type, recipient_id) in notification_event_processing.

function normalizeDedupePart(value) {
  if (value == null || value === "") return null;
  return String(value);
}

/** Normalize collection version stamps (Date, ISO string, number) for keys. */
function normalizeCollectionVersion(version) {
  if (version == null || version === "") return null;
  if (version instanceof Date) {
    if (Number.isNaN(version.getTime())) return null;
    return version.toISOString();
  }
  if (typeof version === "number" && Number.isFinite(version)) {
    return String(Math.trunc(version));
  }
  const s = String(version).trim();
  return s || null;
}

// friend_accept:{friendshipId}:{recipientId}
function buildFriendAcceptDedupeKey(friendshipId, recipientId) {
  const friendship = normalizeDedupePart(friendshipId);
  const recipient = normalizeDedupePart(recipientId);
  if (!friendship || !recipient) return null;
  return `friend_accept:${friendship}:${recipient}`;
}

// friend_variant:{actorId}:{recipientId}:{variantId}:{collectionVersion}
function buildFriendVariantDedupeKey(actorId, recipientId, variantId, collectionVersion) {
  const actor = normalizeDedupePart(actorId);
  const recipient = normalizeDedupePart(recipientId);
  const variant = normalizeDedupePart(variantId);
  const version = normalizeCollectionVersion(collectionVersion);
  if (!actor || !recipient || !variant || !version) return null;
  return `friend_variant:${actor}:${recipient}:${variant}:${version}`;
}

// squad_completion:{squadId}:{newCoveredCount}
function buildSquadCompletionDedupeKey(squadId, newCoveredCount) {
  const squad = normalizeDedupePart(squadId);
  if (!squad || newCoveredCount == null || newCoveredCount === "") return null;
  const covered = Number(newCoveredCount);
  if (!Number.isFinite(covered)) return null;
  return `squad_completion:${squad}:${Math.trunc(covered)}`;
}

// priority_available:{recipientId}:{variantId}:{availabilityPeriodId}
function buildPriorityAvailableDedupeKey(recipientId, variantId, availabilityPeriodId) {
  const recipient = normalizeDedupePart(recipientId);
  const variant = normalizeDedupePart(variantId);
  const period = normalizeDedupePart(availabilityPeriodId);
  if (!recipient || !variant || !period) return null;
  return `priority_available:${recipient}:${variant}:${period}`;
}

// event_ending:{recipientId}:{eventId}:{threshold}
function buildEventEndingDedupeKey(recipientId, eventId, threshold) {
  const recipient = normalizeDedupePart(recipientId);
  const event = normalizeDedupePart(eventId);
  const th = normalizeDedupePart(threshold);
  if (!recipient || !event || !th) return null;
  return `event_ending:${recipient}:${event}:${th}`;
}

module.exports = {
  normalizeCollectionVersion,
  buildFriendAcceptDedupeKey,
  buildFriendVariantDedupeKey,
  buildSquadCompletionDedupeKey,
  buildPriorityAvailableDedupeKey,
  buildEventEndingDedupeKey,
  // Aliases matching historical gate export names (Étapes 14–39).
  buildFriendRequestAcceptedDedupeKey: buildFriendAcceptDedupeKey,
  buildFriendAcquiredDedupeKey: buildFriendVariantDedupeKey,
  buildPriorityVariantAvailableDedupeKey: buildPriorityAvailableDedupeKey,
  buildWantedEventEndingDedupeKey: buildEventEndingDedupeKey
};
