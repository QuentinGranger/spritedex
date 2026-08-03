"use strict";

const { BADGE_COPY, BADGE_COPY_EN, BADGE_COPY_NL } = require("./content");

function resolveBadgeCopy(key, fallback = "", lang = "fr") {
  const locale = String(lang || "fr")
    .toLowerCase()
    .slice(0, 2);
  if (locale === "en" && BADGE_COPY_EN[key]) return BADGE_COPY_EN[key];
  if (locale === "nl" && BADGE_COPY_NL[key]) return BADGE_COPY_NL[key];
  return BADGE_COPY[key] || BADGE_COPY_EN[key] || fallback || key;
}

function labelForBadgeCode(code, lang = "fr") {
  if (!code) return null;
  const key = `badge.${code}.name`;
  return resolveBadgeCopy(key, code, lang);
}

/**
 * Étape 41 — compare the full precise rate to the threshold (no display rounding).
 * 74.999 → false for 75; 75.000 → true.
 */
function meetsCompletionThreshold(preciseRate, threshold) {
  const precise = Number(preciseRate);
  const target = Number(threshold);
  if (!Number.isFinite(precise) || !Number.isFinite(target)) return false;
  return precise >= target;
}

function evaluateRule(ruleType, ruleConfig, ctx) {
  const cfg = ruleConfig || {};
  switch (String(ruleType || "")) {
    case "first_owned_transition":
      return (ctx.ownedVariantCount || 0) >= 1;
    case "completion_threshold": {
      // Étape 41 — always use completionRatePrecise, never the rounded display.
      return meetsCompletionThreshold(ctx.completionRatePrecise, cfg.threshold);
    }
    case "discovered_sprite_count":
      return (ctx.discoveredSpriteCount || 0) >= (Number(cfg.min) || 0);
    case "reliability_level":
      return String(ctx.reliabilityLevel || "") === String(cfg.equals || "");
    case "squad_count":
      return (ctx.squadCount || 0) >= (Number(cfg.min) || 0);
    case "squad_founder_qualified":
      return ctx.squadFounderQualified === true;
    case "complementary_collection":
    case "event_completed_family":
      // Awarded via dedicated evaluators (compare / event completions).
      return false;
    case "archivist":
      return ctx.archivistQualified === true;
    case "early_collector":
      return ctx.earlyCollectorQualified === true;
    case "all_rarities":
      return ctx.allRaritiesQualified === true;
    case "friend_count":
      return (ctx.friendCount || 0) >= (Number(cfg.min) || 0);
    case "events_completed_count":
      return (ctx.eventsCompletedCount || 0) >= (Number(cfg.min) || 0);
    default:
      return false;
  }
}

/** Back-compat helper used by older tests. */
function evaluateBadgeCondition(conditions, ctx) {
  if (!conditions) return false;
  if (conditions.type === "owned_variant_count") {
    return evaluateRule("first_owned_transition", {}, ctx) && (ctx.ownedVariantCount || 0) >= (conditions.min || 0);
  }
  if (conditions.type === "completion_rate") {
    return evaluateRule("completion_threshold", { threshold: conditions.min }, ctx);
  }
  return evaluateRule(conditions.type, conditions, ctx);
}

module.exports = {
  resolveBadgeCopy,
  labelForBadgeCode,
  meetsCompletionThreshold,
  evaluateRule,
  evaluateBadgeCondition
};
