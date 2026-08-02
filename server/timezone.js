// ── User timezone helpers (Étape 40) ───────────────────────────────────────
// Instants are stored in UTC (TIMESTAMPTZ / ISO-8601 with Z). Display, quiet
// hours and calendar-relative labels ("demain" / "tomorrow") use the user's
// IANA timezone (e.g. Europe/Paris).

const DEFAULT_TIMEZONE = "Europe/Paris";

function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeTimeZone(timeZone, fallback = DEFAULT_TIMEZONE) {
  const tz = String(timeZone || "").trim();
  if (tz && isValidTimeZone(tz)) return tz;
  return isValidTimeZone(fallback) ? fallback : "UTC";
}

/** Convert any Date/ISO value to a UTC ISO string for storage. */
function toUtcIso(value) {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function getZonedParts(date, timeZone = DEFAULT_TIMEZONE) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const tz = normalizeTimeZone(timeZone);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = {};
  for (const p of dtf.formatToParts(d)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    timeZone: tz
  };
}

function getLocalHour(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = getZonedParts(date, timeZone);
  return parts ? parts.hour : null;
}

/** Calendar date key YYYY-MM-DD in the given timezone. */
function localDateKey(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = getZonedParts(date, timeZone);
  if (!parts) return null;
  const m = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${m}-${day}`;
}

/**
 * Whole calendar days from `from` to `to` in `timeZone`
 * (0 = same local day, 1 = tomorrow, …).
 */
function calendarDaysBetween(from, to, timeZone = DEFAULT_TIMEZONE) {
  const a = getZonedParts(from, timeZone);
  const b = getZonedParts(to, timeZone);
  if (!a || !b) return null;
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86400000);
}

function calendarDaysUntil(endDate, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return calendarDaysBetween(now, endDate, timeZone);
}

/**
 * Format a UTC instant for display in the user's timezone.
 * Returns e.g. "20 août" (fr) or "20 August" (en).
 */
function formatDateInTimeZone(value, lang = "fr", timeZone = DEFAULT_TIMEZONE) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const language = String(lang || "fr").toLowerCase().slice(0, 2);
  const locale = language === "en" ? "en-GB" : language === "nl" ? "nl-NL" : "fr-FR";
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    timeZone: normalizeTimeZone(timeZone)
  });
}

/** Shift a zoned Y-M-D by `delta` calendar days. */
function addLocalDays(parts, delta) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + delta));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate()
  };
}

/**
 * Convert a wall-clock local time in `timeZone` to a UTC Date.
 * Iteratively corrects for DST offsets.
 */
function zonedLocalToUtc(year, month, day, hour = 0, minute = 0, timeZone = DEFAULT_TIMEZONE) {
  const tz = normalizeTimeZone(timeZone);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 4; i++) {
    const parts = getZonedParts(guess, tz);
    if (!parts) return null;
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    const next = new Date(guess.getTime() + (want - asUtc));
    if (Math.abs(next.getTime() - guess.getTime()) < 1000) {
      guess = next;
      break;
    }
    guess = next;
  }
  return guess;
}

/**
 * Étape 50 — next daily digest instant in the user's timezone.
 * Default hour is 09:00 local; override with NOTIFICATION_DIGEST_HOUR.
 */
function nextDailyDigestAt(now = new Date(), timeZone = DEFAULT_TIMEZONE, hour = null) {
  const digestHour = hour == null
    ? Math.max(0, Math.min(23, Number(process.env.NOTIFICATION_DIGEST_HOUR ?? 9) || 9))
    : Math.max(0, Math.min(23, Number(hour) || 0));
  const tz = normalizeTimeZone(timeZone);
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return null;
  const parts = getZonedParts(d, tz);
  if (!parts) return null;
  let target = zonedLocalToUtc(parts.year, parts.month, parts.day, digestHour, 0, tz);
  if (!target) return null;
  if (target.getTime() <= d.getTime()) {
    const next = addLocalDays(parts, 1);
    target = zonedLocalToUtc(next.year, next.month, next.day, digestHour, 0, tz);
  }
  return target;
}

module.exports = {
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  normalizeTimeZone,
  toUtcIso,
  getZonedParts,
  getLocalHour,
  localDateKey,
  calendarDaysBetween,
  calendarDaysUntil,
  formatDateInTimeZone,
  addLocalDays,
  zonedLocalToUtc,
  nextDailyDigestAt
};
