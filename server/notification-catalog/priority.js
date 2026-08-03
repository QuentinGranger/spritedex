"use strict";

const { NOTIFICATION_TYPES, DEFAULT_LANGUAGE, normalizeLang } = require("./constants");

// Étape 52 — global safety cap for ordinary sprite-index push notifications.
// Counted per local calendar day in the user's timezone. 0 disables the cap.
const DEFAULT_PUSH_MAX_PER_DAY = 8;

// Critical / legal / account-security pushes may bypass the daily cap.
const PUSH_DAILY_LIMIT_EXEMPT_TYPES = Object.freeze(["account_security", "legal_notice", "service_critical"]);

function isExemptFromPushDailyLimit(type, context = {}) {
  const id = String(type || "").toLowerCase();
  if (PUSH_DAILY_LIMIT_EXEMPT_TYPES.includes(id)) return true;
  // Explicit context flag for system callers that don't use a stable type id yet.
  if (context && (context.bypassPushDailyLimit === true || context.critical === true)) {
    return true;
  }
  // Étape 53 — high send-priority scores may still push when the daily cap is hit.
  if (resolveSendPriority(type, context) >= PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE) {
    return true;
  }
  return false;
}

function resolvePushDailyLimit(maxPerDay) {
  if (maxPerDay === null || maxPerDay === undefined) return DEFAULT_PUSH_MAX_PER_DAY;
  const n = Number(maxPerDay);
  if (!Number.isFinite(n)) return DEFAULT_PUSH_MAX_PER_DAY;
  // 0 = unlimited (explicit opt-out of the safety cap).
  if (n <= 0) return 0;
  return Math.min(1000, Math.floor(n));
}

// Étape 53 — send priority score (higher = more important for push under the daily cap).
const SEND_PRIORITY_LEVELS = Object.freeze({
  CRITICAL: 100,
  HIGH: 75,
  NORMAL: 50,
  LOW: 25
});

// When the daily push limit is reached, only scores >= this still send push.
// Lower-priority notifications stay in-app only.
const PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE = 90;

const SEND_PRIORITY_BY_TYPE = Object.freeze({
  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: 90,
  [NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED]: 70,
  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: 50
});

function clampSendPriority(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return SEND_PRIORITY_LEVELS.NORMAL;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Resolve the send-priority score for a notification (Étape 53).
 * Context can refine the score (24h event ending, squad milestone, etc.).
 */
function resolveSendPriority(type, context = {}) {
  if (context && context.sendPriority != null) {
    return clampSendPriority(context.sendPriority);
  }

  const id = String(type || "");

  if (id === NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON) {
    // Last-chance 24h alerts are top-tier; earlier thresholds are high but below the bypass bar.
    return String(context.threshold || "").toLowerCase() === "24h" ? 90 : 75;
  }

  if (id === NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED) {
    if (context.milestone != null || context.kind === "milestone") return 65;
    return 35;
  }

  if (Object.prototype.hasOwnProperty.call(SEND_PRIORITY_BY_TYPE, id)) {
    return SEND_PRIORITY_BY_TYPE[id];
  }

  if (PUSH_DAILY_LIMIT_EXEMPT_TYPES.includes(id.toLowerCase())) {
    return SEND_PRIORITY_LEVELS.CRITICAL;
  }

  return SEND_PRIORITY_LEVELS.NORMAL;
}

/** Map a numeric score to the named band (critique / élevée / normale / faible). */
function classifySendPriority(score) {
  const n = clampSendPriority(score);
  if (n >= SEND_PRIORITY_LEVELS.CRITICAL) return "critical";
  if (n >= SEND_PRIORITY_LEVELS.HIGH) return "high";
  if (n >= SEND_PRIORITY_LEVELS.NORMAL) return "normal";
  return "low";
}

function getSendPriorityLabel(scoreOrLevel, lang = DEFAULT_LANGUAGE) {
  const level = typeof scoreOrLevel === "string" ? scoreOrLevel : classifySendPriority(scoreOrLevel);
  const locale = normalizeLang(lang);
  const labels = {
    critical: { fr: "Critique", en: "Critical", nl: "Kritiek" },
    high: { fr: "Élevée", en: "High", nl: "Hoog" },
    normal: { fr: "Normale", en: "Normal", nl: "Normaal" },
    low: { fr: "Faible", en: "Low", nl: "Laag" }
  };
  const row = labels[level];
  return (row && (row[locale] || row.en || row.fr)) || level;
}

module.exports = {
  isExemptFromPushDailyLimit,
  resolvePushDailyLimit,
  clampSendPriority,
  resolveSendPriority,
  classifySendPriority,
  getSendPriorityLabel,
  DEFAULT_PUSH_MAX_PER_DAY,
  PUSH_DAILY_LIMIT_EXEMPT_TYPES,
  SEND_PRIORITY_LEVELS,
  PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE,
  SEND_PRIORITY_BY_TYPE
};
