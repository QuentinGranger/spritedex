// ── SPRITE-INDEX notification channels ────────────────────────────────────────
// Étape 7: three delivery channels (in_app, push, email). Resolution combines:
//   • the type's default target channels (catalog.getTypeChannels)
//   • the étape 6 subject gates (category + type enabled)
//   • the per-channel user toggles
//   • channel-specific runtime constraints (push: consent, quiet hours,
//     frequency limits, token state)
//
// in_app is the sprite-index notification center — it maps to the stored row and is
// therefore always "delivered" locally when permitted. push and email are the
// external channels handled by the caller (push dispatch / mailer).

const catalog = require("./notification-catalog");
const { getLocalHour, normalizeTimeZone, DEFAULT_TIMEZONE, getZonedParts, zonedLocalToUtc } = require("./timezone");
const {
  isPushUrgent,
  resolvePushDeadline,
  resolveQuietHoursDeferral,
  computeQuietHoursEnd
} = require("./notification-quiet-hours");

// Pure: which channels are permitted before push runtime constraints. Applies
// the subject gates and per-channel toggles to the type's target channels.
function resolvePermittedChannels({
  typeChannels = [],
  channelPrefs = {},
  categoryEnabled = true,
  typeEnabled = true
} = {}) {
  if (categoryEnabled === false || typeEnabled === false) return [];
  return typeChannels.filter((ch) => channelPrefs[ch] !== false);
}

// Pure: quiet-hours test. start/end are integer hours in [0..23] in the user's
// timezone (Étape 40); null disables the window. Supports ranges that wrap
// midnight (e.g. 22 → 08). Pass `timeZone` (IANA, e.g. Europe/Paris).
function isInQuietHours(start, end, date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  if (start == null || end == null) return false;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s === e) return false;
  const tz = normalizeTimeZone(timeZone);
  const h = getLocalHour(date, tz);
  if (h == null) return false;
  return s < e ? h >= s && h < e : h >= s || h < e;
}

/** Start of the user's local calendar day as a UTC Date. */
function startOfLocalDay(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const tz = normalizeTimeZone(timeZone);
  const parts = getZonedParts(now, tz);
  if (!parts) return null;
  return zonedLocalToUtc(parts.year, parts.month, parts.day, 0, 0, tz);
}

/**
 * Étape 52 — count push deliveries for the user's local calendar day.
 * Prefers notification_deliveries (channel=push); falls back to notifications
 * that recorded a successful pushSent flag.
 */
async function countPushDeliveriesToday(pool, userId, { timeZone = DEFAULT_TIMEZONE, now = new Date() } = {}) {
  const dayStart = startOfLocalDay(now, timeZone);
  if (!dayStart) return 0;

  try {
    const deliveries = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM notification_deliveries
       WHERE channel = 'push'
         AND status = 'delivered'
         AND delivered_at >= $2
         AND notification_id IN (
           SELECT id FROM notifications WHERE recipient_id = $1
         )`,
      [userId, dayStart]
    );
    if (deliveries.rows[0]) return deliveries.rows[0].c || 0;
  } catch {
    // Table may not exist yet in older envs — fall through.
  }

  const fallback = await pool.query(
    `SELECT COUNT(*)::int AS c FROM notifications
     WHERE recipient_id = $1
       AND created_at >= $2
       AND (
         COALESCE((data->>'pushSent')::boolean, false) = true
         OR (
           status = 'delivered'
           AND COALESCE(data->'channels', '[]'::jsonb) ? 'push'
         )
       )`,
    [userId, dayStart]
  );
  return fallback.rows[0]?.c || 0;
}

/**
 * Étape 52/53 — global push safety limit (default 8/day).
 * When the cap is reached:
 *   • lower-priority notifications stay in-app (no push)
 *   • high send-priority (≥ 90) and critical/legal/security types may still push
 *
 * `maxPerDay` semantics:
 *   undefined/null → DEFAULT_PUSH_MAX_PER_DAY (8)
 *   0              → unlimited
 *   n > 0          → hard cap
 */
async function isPushFrequencyExceeded(
  pool,
  userId,
  maxPerDay,
  { timeZone = DEFAULT_TIMEZONE, type = null, context = {}, now = new Date() } = {}
) {
  // Étape 53 — score / exempt types bypass the cap; others drop push only.
  if (catalog.isExemptFromPushDailyLimit(type, context)) return false;
  const limit = catalog.resolvePushDailyLimit(maxPerDay);
  if (limit <= 0) return false;
  const count = await countPushDeliveriesToday(pool, userId, { timeZone, now });
  return count >= limit;
}

// Evaluates the push channel runtime constraints. Returns { allowed, reason }.
// Quiet hours are NOT a hard deny here when deferral is possible (Étape 41) —
// use resolveDeliveryChannels for that. This helper still reports quiet_hours
// for callers that only need a boolean gate.
async function evaluatePushConstraints(pool, userId, user = {}, now = new Date(), { type = null, context = {} } = {}) {
  // Consent: push requires explicit authorization (push_enabled).
  if (user.push_enabled === false) return { allowed: false, reason: "no_consent" };
  // Quiet hours — evaluated in the user's timezone (Étape 40).
  const timeZone = normalizeTimeZone(user.timezone || user.timeZone);
  if (isInQuietHours(user.push_quiet_start, user.push_quiet_end, now, timeZone)) {
    return { allowed: false, reason: "quiet_hours" };
  }
  // Étape 52 — global daily push cap (ordinary notifications only).
  if (
    await isPushFrequencyExceeded(pool, userId, user.push_max_per_day, {
      timeZone,
      type,
      context,
      now
    })
  ) {
    return { allowed: false, reason: "frequency_limit" };
  }
  return { allowed: true, reason: null };
}

// Full resolution for one notification: returns the channels to actually use
// plus the reasons push/email were dropped (for observability/debugging).
// Étape 41 — non-urgent push during quiet hours is deferred (not dropped),
// unless the quiet window ends after the event deadline.
async function resolveDeliveryChannels(
  pool,
  userId,
  type,
  { category, user = {}, now = new Date(), prefs, context = {}, urgent = null, deadline = null } = {}
) {
  const preferences = require("./notification-preferences");
  const resolved = prefs || (await preferences.resolveChannelPreferences(pool, userId, type, { category }));
  const { categoryEnabled, typeEnabled, channelPrefs, pushMode } = resolved;

  const permitted = resolvePermittedChannels({
    typeChannels: catalog.getTypeChannels(type),
    channelPrefs,
    categoryEnabled,
    typeEnabled
  });

  const channels = [];
  const dropped = {};
  let deferral = null;

  if (permitted.includes(catalog.NOTIFICATION_CHANNELS.IN_APP)) {
    channels.push(catalog.NOTIFICATION_CHANNELS.IN_APP);
  }

  if (permitted.includes(catalog.NOTIFICATION_CHANNELS.PUSH)) {
    // Étape 51 — per-type push mode (e.g. priorities_only, milestones_only).
    const mode = pushMode || catalog.getDefaultTypeDelivery(type).push;
    const timeZone = normalizeTimeZone(user.timezone || user.timeZone);
    if (!catalog.shouldAllowPushForDelivery(mode, context)) {
      dropped.push = `push_mode_${mode}`;
    } else if (user.push_enabled === false) {
      dropped.push = "no_consent";
    } else if (
      await isPushFrequencyExceeded(pool, userId, user.push_max_per_day, {
        timeZone,
        type,
        context,
        now
      })
    ) {
      dropped.push = "frequency_limit";
    } else {
      const isUrgent = urgent != null ? !!urgent : isPushUrgent(type, context);
      const pushDeadline = deadline || resolvePushDeadline(context);
      const quiet = resolveQuietHoursDeferral({
        start: user.push_quiet_start,
        end: user.push_quiet_end,
        timeZone,
        now,
        urgent: isUrgent,
        deadline: pushDeadline
      });

      if (quiet.drop) {
        dropped.push = quiet.reason || "quiet_hours_past_deadline";
      } else if (quiet.defer) {
        // In-app stays; push is scheduled for after the quiet window.
        dropped.push = "quiet_hours_deferred";
        deferral = {
          channel: "push",
          deliverAt: quiet.deliverAt,
          deadline: quiet.deadline
        };
      } else {
        channels.push(catalog.NOTIFICATION_CHANNELS.PUSH);
      }
    }
  }

  if (permitted.includes(catalog.NOTIFICATION_CHANNELS.EMAIL)) {
    channels.push(catalog.NOTIFICATION_CHANNELS.EMAIL);
  }

  return { channels, dropped, deferral };
}

module.exports = {
  resolvePermittedChannels,
  isInQuietHours,
  isPushFrequencyExceeded,
  countPushDeliveriesToday,
  startOfLocalDay,
  evaluatePushConstraints,
  resolveDeliveryChannels,
  computeQuietHoursEnd,
  isPushUrgent,
  resolvePushDeadline,
  resolveQuietHoursDeferral
};
