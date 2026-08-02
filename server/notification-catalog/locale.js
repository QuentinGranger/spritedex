"use strict";

const { DEFAULT_LANGUAGE } = require("./constants");

// ── Small locale helpers (kept per-language on purpose) ──
const FALLBACK_NAME = { fr: "Quelqu'un", en: "Someone", nl: "Iemand" };
const FALLBACK_SPRITE = { fr: "une variante", en: "a variant", nl: "een variant" };
const FALLBACK_SQUAD = { fr: "Une escouade", en: "A squad", nl: "Een squad" };
const FALLBACK_EVENT = { fr: "un événement", en: "an event", nl: "een evenement" };

function str(value, fallback = "") {
  const s = value === undefined || value === null ? "" : String(value).trim();
  return s || fallback;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Round a percentage to at most one decimal, dropping a trailing ".0".
function pct(value) {
  const n = num(value);
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function pluralFr(count, singular, plural) {
  return num(count) <= 1 ? singular : plural;
}

function pluralEn(count, singular, plural) {
  return num(count) === 1 ? singular : plural;
}

// Format a variant with its sprite for readability: "Nom (Sprite)".
function variantLabel(context, lang) {
  const variant = str(context.variantName, FALLBACK_SPRITE[lang]);
  const sprite = str(context.spriteName);
  return sprite ? `${variant} (${sprite})` : variant;
}

const {
  normalizeTimeZone,
  calendarDaysUntil,
  formatDateInTimeZone,
  DEFAULT_TIMEZONE
} = require("../timezone");

function formatEndDate(value, lang = DEFAULT_LANGUAGE, timeZone = DEFAULT_TIMEZONE) {
  if (!value) return null;
  return formatDateInTimeZone(value, lang, timeZone);
}

// Étape 48 — contextual destinations (never the home page).
function buildPriorityVariantActionUrl(ctx = {}) {
  const spriteId = ctx.spriteId != null ? String(ctx.spriteId) : null;
  const variantType = ctx.variantType != null ? String(ctx.variantType) : null;
  if (spriteId && variantType) {
    return `/sprites/${encodeURIComponent(spriteId)}?variant=${encodeURIComponent(String(variantType))}`;
  }
  if (ctx.variantId) return `/variant/${encodeURIComponent(String(ctx.variantId))}`;
  if (spriteId) return `/sprites/${encodeURIComponent(spriteId)}`;
  return null;
}

// Étape 37/48 — event screen filtered on missing priority variants.
function buildWantedEventActionUrl(ctx = {}) {
  const eventId = ctx.eventId != null ? String(ctx.eventId) : null;
  if (!eventId) return null;
  return `/events/${encodeURIComponent(eventId)}?filter=priority`;
}

function buildSquadEngineActionUrl(ctx = {}) {
  if (ctx.squadCode) return `/squad/${encodeURIComponent(String(ctx.squadCode))}/engine`;
  if (ctx.squadId) return `/squads/${encodeURIComponent(String(ctx.squadId))}/completion`;
  return null;
}

function buildFriendCompareActionUrl(ctx = {}, { withVariant = false } = {}) {
  const friendId = ctx.friendId != null
    ? String(ctx.friendId)
    : (ctx.actorId != null ? String(ctx.actorId) : null);
  if (!friendId) return null;
  const base = `/compare/${encodeURIComponent(friendId)}`;
  if (!withVariant) return base;
  const variantId = ctx.variantId != null ? String(ctx.variantId) : null;
  return variantId ? `${base}?variantId=${encodeURIComponent(variantId)}` : base;
}

// Human phrasing for Étape 35 thresholds ("dans 3 jours", "in 24 hours").
function formatThresholdRemaining(thresholdId, lang = DEFAULT_LANGUAGE) {
  const id = String(thresholdId || "").toLowerCase();
  if (lang === "en") {
    if (id === "24h") return "in 24 hours";
    if (id === "7d") return "in 7 days";
    return "in 3 days";
  }
  if (lang === "nl") {
    if (id === "24h") return "over 24 uur";
    if (id === "7d") return "over 7 dagen";
    return "over 3 dagen";
  }
  if (id === "24h") return "dans 24 heures";
  if (id === "7d") return "dans 7 jours";
  return "dans 3 jours";
}

/**
 * Étape 40 — relative end wording in the user's timezone.
 * Prefers calendar labels ("demain" / "tomorrow") when endingAt is known;
 * falls back to the threshold phrase otherwise.
 */
function formatEventEndingWhen(ctx = {}, lang = DEFAULT_LANGUAGE) {
  const endingAt = ctx.endingAt || ctx.endDate;
  const timeZone = normalizeTimeZone(ctx.timeZone || ctx.timezone);
  const now = ctx.now ? new Date(ctx.now) : new Date();
  if (endingAt) {
    const days = calendarDaysUntil(endingAt, now, timeZone);
    if (days === 0) {
      if (lang === "en") return "today";
      if (lang === "nl") return "vandaag";
      return "aujourd'hui";
    }
    if (days === 1) {
      if (lang === "en") return "tomorrow";
      if (lang === "nl") return "morgen";
      return "demain";
    }
    if (Number.isInteger(days) && days > 1 && days <= 7) {
      if (lang === "en") return `in ${days} days`;
      if (lang === "nl") return `over ${days} dagen`;
      return `dans ${days} jours`;
    }
  }
  return formatThresholdRemaining(ctx.threshold, lang);
}


module.exports = { str, num, pct, pluralFr, pluralEn, variantLabel, formatEndDate, buildPriorityVariantActionUrl, buildWantedEventActionUrl, buildSquadEngineActionUrl, buildFriendCompareActionUrl, formatThresholdRemaining, formatEventEndingWhen, FALLBACK_NAME, FALLBACK_SPRITE, FALLBACK_SQUAD, FALLBACK_EVENT, DEFAULT_TIMEZONE };
