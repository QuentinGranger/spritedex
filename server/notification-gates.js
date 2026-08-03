// ── Pure pre-create gates for contextual notifications ─────────────────────
// Kept free of DB / I/O so unit tests can assert the rules without a server.

const {
  normalizeCollectionVersion,
  buildFriendAcceptDedupeKey,
  buildFriendVariantDedupeKey,
  buildSquadCompletionDedupeKey,
  buildPriorityAvailableDedupeKey,
  buildEventEndingDedupeKey
} = require("./notification-dedupe");

// Étape 12 — conditions before creating friend_request_accepted.
function evaluateFriendshipAcceptedConditions({
  requesterId,
  accepterId,
  previousStatus,
  friendshipExists,
  friendshipStatus,
  blocked,
  socialEnabled,
  typeEnabled
} = {}) {
  if (!requesterId || !accepterId) return { ok: false, reason: "missing_parties" };
  if (String(requesterId) === String(accepterId)) return { ok: false, reason: "self_action" };
  if (!friendshipExists) return { ok: false, reason: "invitation_missing" };
  if (previousStatus !== "pending") return { ok: false, reason: "previous_not_pending" };
  if (friendshipStatus !== "accepted") return { ok: false, reason: "friendship_not_active" };
  if (blocked) return { ok: false, reason: "blocked" };
  if (socialEnabled === false) return { ok: false, reason: "social_disabled" };
  if (typeEnabled === false) return { ok: false, reason: "type_disabled" };
  return { ok: true };
}

// Étape 14/54 — stable dedupe key for friend accept.
// One accepted invitation → at most one notification per recipient, even if the
// domain event is re-emitted with a different eventId.
function buildFriendRequestAcceptedDedupeKey(friendshipId, recipientId) {
  return buildFriendAcceptDedupeKey(friendshipId, recipientId);
}

// ── Friend acquired missing variant (Étapes 15–21) ──

// Étape 15 — previous statuses that may transition into `owned` and fire the event.
const ACQUIRED_FROM_STATUSES = Object.freeze(["missing", "priority", "spotted", "unavailable", "unknown"]);

// Étape 16/17 — only these recipient statuses create a notification.
// `unknown` is intentionally excluded.
const RECIPIENT_INTEREST_STATUSES = Object.freeze(["missing", "priority"]);

// Étape 20 — default 10 minutes. Override with NOTIFICATION_BATCH_MS (ms); 0 = flush now.
const BATCH_WINDOW_MS = Math.max(0, Number(process.env.NOTIFICATION_BATCH_MS ?? 10 * 60 * 1000));
const MAX_PUSH_PER_FRIEND_PER_DAY = 3; // Étape 21

function isAcquiredFromStatus(previousStatus) {
  return ACQUIRED_FROM_STATUSES.includes(previousStatus);
}

// Étape 17 — strong when the recipient marked the variant as `priority`,
// normal when `missing`. Anything else → no notification.
function resolveAcquisitionPriority(recipientStatus) {
  if (recipientStatus === "priority") return "strong";
  if (recipientStatus === "missing") return "normal";
  return null;
}

function buildFriendAcquiredDedupeKey(actorId, recipientId, variantId, collectionVersion) {
  return buildFriendVariantDedupeKey(actorId, recipientId, variantId, collectionVersion);
}

// ── Squad completion increased (Étapes 22–27) ──

const SQUAD_MILESTONES = Object.freeze([25, 50, 75, 80, 90, 95, 100]);

// Étape 27 — default 20 minutes (within the recommended 15–30 window).
const SQUAD_BATCH_WINDOW_MS = Math.max(0, Number(process.env.NOTIFICATION_SQUAD_BATCH_MS ?? 20 * 60 * 1000));

// Highest newly crossed milestone, or null.
function crossedSquadMilestone(previousRate, newRate) {
  const prev = Number(previousRate) || 0;
  const next = Number(newRate) || 0;
  let crossed = null;
  for (const m of SQUAD_MILESTONES) {
    if (prev < m && next >= m) crossed = m;
  }
  return crossed;
}

// Étape 25 — milestones push immediately; ordinary gains are batched.
function isSquadImmediatePush({ milestone } = {}) {
  return milestone != null;
}

function buildSquadCompletionKey(squadId, newCoveredCount) {
  return buildSquadCompletionDedupeKey(squadId, newCoveredCount);
}

// ── Priority variant available (Étapes 28–33) ──

// Étape 28 — previous statuses that may transition into available_now.
const VARIANT_AVAILABLE_FROM_STATUSES = Object.freeze(["upcoming", "not_observed", "ended", "unknown"]);

// Étape 29 — confidence levels that may generate an automatic push alert.
const TRUSTED_AVAILABILITY_CONFIDENCE = Object.freeze(["official", "observed", "confirmed"]);

const UNTRUSTED_AVAILABILITY_CONFIDENCE = Object.freeze(["estimated", "unverified", "unknown"]);

// Normalize raw DB / news statuses into the étape 28 vocabulary.
function classifyAvailabilityStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "available" || s === "available_now" || s === "active" || s === "live") {
    return "available_now";
  }
  if (s === "upcoming" || s === "coming_soon" || s === "soon" || s === "unreleased") {
    return "upcoming";
  }
  if (s === "ended" || s === "expired" || s === "over") return "ended";
  if (s === "not_observed" || s === "not_seen" || s === "missing" || s === "unavailable" || s === "removed") {
    return "not_observed";
  }
  return "unknown";
}

function isTrustedAvailabilityConfidence(confidence) {
  return TRUSTED_AVAILABILITY_CONFIDENCE.includes(String(confidence || "").toLowerCase());
}

function isVariantAvailableTransition(previousStatus, newStatus) {
  const from = classifyAvailabilityStatus(previousStatus);
  const to = classifyAvailabilityStatus(newStatus);
  return VARIANT_AVAILABLE_FROM_STATUSES.includes(from) && to === "available_now";
}

// Étape 33/54 — one alert per user / variant / availability period.
function buildPriorityVariantAvailableDedupeKey(recipientId, variantId, availabilityPeriodId) {
  return buildPriorityAvailableDedupeKey(recipientId, variantId, availabilityPeriodId);
}

// Étape 31 — pure date/status gate (source validity checked separately with DB).
function evaluateVariantStillAvailable({ status, availableFrom, availableUntil, now = new Date() } = {}) {
  if (classifyAvailabilityStatus(status) !== "available_now") {
    return { ok: false, reason: "not_available" };
  }
  const t = now instanceof Date ? now : new Date(now);
  if (availableFrom) {
    const start = new Date(availableFrom);
    if (!Number.isNaN(start.getTime()) && start > t) {
      return { ok: false, reason: "not_started" };
    }
  }
  if (availableUntil) {
    const end = new Date(availableUntil);
    if (!Number.isNaN(end.getTime()) && end < t) {
      return { ok: false, reason: "ended" };
    }
  }
  return { ok: true };
}

// ── Wanted event ending soon (Étape 34+) ──

// Étape 34 — v1 notifies only users who marked a variant as `priority`.
// `missing` may be included later via an explicit preference.
const WANTED_EVENT_DEFAULT_STATUSES = Object.freeze(["priority"]);
const WANTED_EVENT_OPTIONAL_STATUSES = Object.freeze(["missing"]);

function resolveWantedEventInterestStatuses({ includeMissing = false } = {}) {
  if (includeMissing) {
    return [...WANTED_EVENT_DEFAULT_STATUSES, ...WANTED_EVENT_OPTIONAL_STATUSES];
  }
  return [...WANTED_EVENT_DEFAULT_STATUSES];
}

// Pure Étape 34 gate for one user × one event variant.
function evaluateWantedEventVariantInterest({
  status,
  owned = false,
  stillAvailable = false,
  includeMissing = false
} = {}) {
  if (owned || status === "owned") {
    return { ok: false, reason: "already_owned" };
  }
  if (!stillAvailable) {
    return { ok: false, reason: "not_available" };
  }
  const allowed = resolveWantedEventInterestStatuses({ includeMissing });
  if (!allowed.includes(status)) {
    return { ok: false, reason: "status_not_wanted" };
  }
  return { ok: true };
}

// Étape 35 — temporal thresholds before event end.
const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

const WANTED_EVENT_THRESHOLDS = Object.freeze({
  SEVEN_DAYS: Object.freeze({ id: "7d", ms: 7 * MS_DAY, label: "7_days" }),
  THREE_DAYS: Object.freeze({ id: "3d", ms: 3 * MS_DAY, label: "3_days" }),
  TWENTY_FOUR_HOURS: Object.freeze({ id: "24h", ms: 24 * MS_HOUR, label: "24_hours" })
});

const WANTED_EVENT_THRESHOLD_LIST = Object.freeze([
  WANTED_EVENT_THRESHOLDS.SEVEN_DAYS,
  WANTED_EVENT_THRESHOLDS.THREE_DAYS,
  WANTED_EVENT_THRESHOLDS.TWENTY_FOUR_HOURS
]);

// Default anti-spam setting: only the 3-day alert for everyone.
const WANTED_EVENT_DEFAULT_THRESHOLD_ID = WANTED_EVENT_THRESHOLDS.THREE_DAYS.id;

// Extra last-chance alert, reserved for strong priorities.
const WANTED_EVENT_STRONG_THRESHOLD_ID = WANTED_EVENT_THRESHOLDS.TWENTY_FOUR_HOURS.id;

// sprite_entries.priority values treated as "priorités fortes".
const WANTED_EVENT_STRONG_PRIORITIES = Object.freeze(["urgent", "important"]);

function normalizeWantedEventThresholdId(thresholdId) {
  const raw = String(thresholdId || "")
    .toLowerCase()
    .trim();
  if (!raw) return null;
  if (raw === "7d" || raw === "7_days" || raw === "7days" || raw === "seven_days") {
    return WANTED_EVENT_THRESHOLDS.SEVEN_DAYS.id;
  }
  if (raw === "3d" || raw === "3_days" || raw === "3days" || raw === "three_days") {
    return WANTED_EVENT_THRESHOLDS.THREE_DAYS.id;
  }
  if (raw === "24h" || raw === "24_hours" || raw === "24hours" || raw === "one_day" || raw === "1d") {
    return WANTED_EVENT_THRESHOLDS.TWENTY_FOUR_HOURS.id;
  }
  return null;
}

function getWantedEventThreshold(thresholdId) {
  const id = normalizeWantedEventThresholdId(thresholdId);
  if (!id) return null;
  return WANTED_EVENT_THRESHOLD_LIST.find((t) => t.id === id) || null;
}

function isStrongWantedPriority(priority) {
  return WANTED_EVENT_STRONG_PRIORITIES.includes(String(priority || "").toLowerCase());
}

/**
 * Thresholds that may fire for a recipient.
 * Default (anti-spam): 3d for everyone; 24h only as an extra for strong
 * priorities; 7d off unless explicitly enabled later via prefs.
 */
function resolveWantedEventActiveThresholds({ enabledThresholdIds = null, hasStrongPriority = false } = {}) {
  let ids;
  if (Array.isArray(enabledThresholdIds) && enabledThresholdIds.length) {
    ids = enabledThresholdIds.map(normalizeWantedEventThresholdId).filter(Boolean);
  } else {
    ids = [WANTED_EVENT_DEFAULT_THRESHOLD_ID];
    if (hasStrongPriority) ids.push(WANTED_EVENT_STRONG_THRESHOLD_ID);
  }

  const allowed = new Set(ids);
  return WANTED_EVENT_THRESHOLD_LIST.filter((t) => {
    if (!allowed.has(t.id)) return false;
    if (t.id === WANTED_EVENT_STRONG_THRESHOLD_ID && !hasStrongPriority) return false;
    return true;
  });
}

/**
 * Étape 35 — may this threshold produce a notification for this recipient?
 * Default: 3d yes; 24h only with strong priority; 7d only if explicitly enabled.
 */
function isWantedEventThresholdAllowed({ thresholdId, hasStrongPriority = false, enabledThresholdIds = null } = {}) {
  const id = normalizeWantedEventThresholdId(thresholdId);
  if (!id) return { ok: false, reason: "unknown_threshold" };

  if (id === WANTED_EVENT_STRONG_THRESHOLD_ID && !hasStrongPriority) {
    return { ok: false, reason: "strong_priority_required" };
  }

  const active = resolveWantedEventActiveThresholds({
    enabledThresholdIds,
    hasStrongPriority
  });
  if (!active.some((t) => t.id === id)) {
    return { ok: false, reason: "threshold_disabled" };
  }
  return { ok: true, thresholdId: id };
}

/**
 * Which threshold window does `now` fall into relative to `endDate`?
 * Returns the tightest crossed threshold id (24h > 3d > 7d), or null if
 * outside all windows / already ended / too early.
 */
function classifyWantedEventThreshold(endDate, now = new Date()) {
  if (!endDate) return null;
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  const t = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(end.getTime()) || Number.isNaN(t.getTime())) return null;
  const remaining = end.getTime() - t.getTime();
  if (remaining <= 0) return null; // already ended
  // Prefer the tightest threshold that has been entered.
  if (remaining <= WANTED_EVENT_THRESHOLDS.TWENTY_FOUR_HOURS.ms) {
    return WANTED_EVENT_THRESHOLDS.TWENTY_FOUR_HOURS.id;
  }
  if (remaining <= WANTED_EVENT_THRESHOLDS.THREE_DAYS.ms) {
    return WANTED_EVENT_THRESHOLDS.THREE_DAYS.id;
  }
  if (remaining <= WANTED_EVENT_THRESHOLDS.SEVEN_DAYS.ms) {
    return WANTED_EVENT_THRESHOLDS.SEVEN_DAYS.id;
  }
  return null;
}

// Étape 36 — ending-soon alerts require a reliably known end date.
// Unlike availability alerts (Étape 29), `observed` is NOT enough here:
// an affirmative "ends soon" push needs official/confirmed certainty.
const TRUSTED_END_DATE_CONFIDENCE = Object.freeze(["official", "confirmed"]);

const UNTRUSTED_END_DATE_CONFIDENCE = Object.freeze([
  "estimated",
  "observed",
  "unverified",
  "unknown",
  "community",
  "community_database"
]);

function isTrustedEndDateConfidence(confidence) {
  return TRUSTED_END_DATE_CONFIDENCE.includes(String(confidence || "").toLowerCase());
}

function evaluateWantedEventEndDateReliability({ endDate = null, confidence = null } = {}) {
  if (endDate == null || endDate === "") {
    return { ok: false, reason: "missing_end_date" };
  }
  const end = endDate instanceof Date ? endDate : new Date(endDate);
  if (Number.isNaN(end.getTime())) {
    return { ok: false, reason: "invalid_end_date" };
  }
  if (!isTrustedEndDateConfidence(confidence)) {
    return { ok: false, reason: "end_date_untrusted" };
  }
  return { ok: true };
}

// Normalize end dates for equality checks (DATE vs timestamptz / ISO).
// node-pg returns DATE columns as local-midnight Date objects; using
// toISOString() alone shifts the calendar day behind UTC+ timezones
// (e.g. Paris) and falsely trips "end_date_changed" for unchanged events.
function normalizeEndDateKey(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const isUtcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0;
    const isLocalMidnight =
      value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0;
    if (isLocalMidnight && !isUtcMidnight) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    return value.toISOString().slice(0, 10);
  }
  return normalizeEndDateKey(String(value));
}

/**
 * Étape 38 — pre-send revalidation between scheduling and delivery.
 * If no priority variant remains missing → cancel (reason: no_remaining_priority).
 */
function evaluateWantedEventPreSend({
  remainingCount = 0,
  eventActive = false,
  endDateUnchanged = false,
  prefsAccepted = false
} = {}) {
  const remaining = Number(remainingCount) || 0;
  if (remaining <= 0) {
    return { ok: false, reason: "no_remaining_priority", cancel: true };
  }
  if (!eventActive) {
    return { ok: false, reason: "event_inactive", cancel: true };
  }
  if (!endDateUnchanged) {
    return { ok: false, reason: "end_date_changed", cancel: true };
  }
  if (!prefsAccepted) {
    return { ok: false, reason: "prefs_disabled", cancel: true };
  }
  return { ok: true };
}

// Étape 39/54 — one alert per user / event / threshold.
function buildWantedEventEndingDedupeKey(recipientId, eventId, thresholdId) {
  const threshold = normalizeWantedEventThresholdId(thresholdId);
  if (!threshold) return null;
  return buildEventEndingDedupeKey(recipientId, eventId, threshold);
}

function buildWantedEventEndingDomainEventId(eventId, thresholdId, endingAt) {
  if (eventId == null || thresholdId == null) return null;
  const endKey = normalizeEndDateKey(endingAt) || "unknown";
  const threshold = normalizeWantedEventThresholdId(thresholdId);
  if (!threshold) return null;
  return `catalogue.event_ending_soon:${eventId}:${threshold}:${endKey}`;
}

module.exports = {
  evaluateFriendshipAcceptedConditions,
  buildFriendRequestAcceptedDedupeKey,
  buildFriendAcceptDedupeKey,
  ACQUIRED_FROM_STATUSES,
  RECIPIENT_INTEREST_STATUSES,
  BATCH_WINDOW_MS,
  MAX_PUSH_PER_FRIEND_PER_DAY,
  isAcquiredFromStatus,
  resolveAcquisitionPriority,
  buildFriendAcquiredDedupeKey,
  buildFriendVariantDedupeKey,
  normalizeCollectionVersion,
  SQUAD_MILESTONES,
  SQUAD_BATCH_WINDOW_MS,
  crossedSquadMilestone,
  isSquadImmediatePush,
  buildSquadCompletionDedupeKey: buildSquadCompletionKey,
  VARIANT_AVAILABLE_FROM_STATUSES,
  TRUSTED_AVAILABILITY_CONFIDENCE,
  UNTRUSTED_AVAILABILITY_CONFIDENCE,
  classifyAvailabilityStatus,
  isTrustedAvailabilityConfidence,
  isVariantAvailableTransition,
  buildPriorityVariantAvailableDedupeKey,
  buildPriorityAvailableDedupeKey,
  evaluateVariantStillAvailable,
  WANTED_EVENT_DEFAULT_STATUSES,
  WANTED_EVENT_OPTIONAL_STATUSES,
  resolveWantedEventInterestStatuses,
  evaluateWantedEventVariantInterest,
  WANTED_EVENT_THRESHOLDS,
  WANTED_EVENT_THRESHOLD_LIST,
  WANTED_EVENT_DEFAULT_THRESHOLD_ID,
  WANTED_EVENT_STRONG_THRESHOLD_ID,
  WANTED_EVENT_STRONG_PRIORITIES,
  normalizeWantedEventThresholdId,
  getWantedEventThreshold,
  isStrongWantedPriority,
  resolveWantedEventActiveThresholds,
  isWantedEventThresholdAllowed,
  classifyWantedEventThreshold,
  TRUSTED_END_DATE_CONFIDENCE,
  UNTRUSTED_END_DATE_CONFIDENCE,
  isTrustedEndDateConfidence,
  evaluateWantedEventEndDateReliability,
  normalizeEndDateKey,
  evaluateWantedEventPreSend,
  buildWantedEventEndingDedupeKey,
  buildEventEndingDedupeKey,
  buildWantedEventEndingDomainEventId
};
