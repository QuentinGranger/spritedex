// ── Quiet hours deferral (Étape 41) ───────────────────────────────────────
// Users pick a no-push window (e.g. 22:00 → 08:00) in their timezone.
// During that window:
//   • the in-app notification is still created immediately
//   • push is deferred until the window ends
//   • non-urgent alerts flush after the quiet period
//   • a deferred push is never delivered after the related event has ended

const catalog = require("./notification-catalog");
const {
  normalizeTimeZone,
  getZonedParts,
  addLocalDays,
  zonedLocalToUtc,
  toUtcIso,
  DEFAULT_TIMEZONE
} = require("./timezone");

/**
 * Urgent pushes may bypass quiet hours (last-chance 24h event alerts).
 */
function isPushUrgent(type, context = {}) {
  if (type === catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON) {
    return String(context.threshold || "").toLowerCase() === "24h";
  }
  return false;
}

/** Soft deadline after which a deferred push must not be sent. */
function resolvePushDeadline(context = {}) {
  return toUtcIso(context.endingAt || context.endDate || context.availableUntil || context.pushDeadline);
}

/**
 * When does the current quiet window end (UTC Date), or null if not in quiet hours?
 * Supports same-day (09→17) and midnight-wrapping (22→08) ranges.
 */
function computeQuietHoursEnd(start, end, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  if (start == null || end == null) return null;
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || s === e) return null;

  const tz = normalizeTimeZone(timeZone);
  const parts = getZonedParts(now, tz);
  if (!parts) return null;

  const inWindow = s < e ? parts.hour >= s && parts.hour < e : parts.hour >= s || parts.hour < e;
  if (!inWindow) return null;

  if (s < e) {
    // Same-day window → ends today at `e`:00 local.
    return zonedLocalToUtc(parts.year, parts.month, parts.day, e, 0, tz);
  }

  // Wraps midnight (e.g. 22→08).
  if (parts.hour >= s) {
    const next = addLocalDays(parts, 1);
    return zonedLocalToUtc(next.year, next.month, next.day, e, 0, tz);
  }
  // Early morning before `e` → ends today at `e`:00 local.
  return zonedLocalToUtc(parts.year, parts.month, parts.day, e, 0, tz);
}

/**
 * Decide whether push should be deferred for quiet hours.
 * @returns {{ defer: false } | { defer: true, deliverAt: string, deadline: string|null } | { defer: false, drop: true, reason: string }}
 */
function resolveQuietHoursDeferral({
  start,
  end,
  timeZone = DEFAULT_TIMEZONE,
  now = new Date(),
  urgent = false,
  deadline = null
} = {}) {
  const deliverAtDate = computeQuietHoursEnd(start, end, now, timeZone);
  if (!deliverAtDate) return { defer: false };

  // Urgent alerts (e.g. 24h event ending) bypass quiet hours.
  if (urgent) return { defer: false, bypass: true };

  const deliverAt = deliverAtDate.toISOString();
  const deadlineIso = deadline ? toUtcIso(deadline) : null;

  // Never schedule a push after the event (or availability) has ended.
  if (deadlineIso) {
    const deadlineMs = new Date(deadlineIso).getTime();
    if (!Number.isNaN(deadlineMs) && deliverAtDate.getTime() >= deadlineMs) {
      return { defer: false, drop: true, reason: "quiet_hours_past_deadline" };
    }
  }

  return { defer: true, deliverAt, deadline: deadlineIso };
}

module.exports = {
  isPushUrgent,
  resolvePushDeadline,
  computeQuietHoursEnd,
  resolveQuietHoursDeferral
};
