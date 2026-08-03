"use strict";

const { pool } = require("../db");
const { VERIFICATION_STATUSES, getBadgeIconUrl } = require("./content");
const { resolveBadgeCopy } = require("./rules");

async function listBadgeDefinitions(db = pool) {
  const result = await db.query(
    `SELECT id, code, name_key, description_key, category, icon_key,
            rule_type, rule_config, is_active, is_hidden, is_revocable
     FROM badge_definitions
     WHERE is_active = TRUE
     ORDER BY category ASC, code ASC`
  );
  return result.rows.map((row) => ({
    ...row,
    ruleType: row.rule_type,
    ruleConfig: row.rule_config || {},
    nameKey: row.name_key,
    descriptionKey: row.description_key,
    iconKey: row.icon_key,
    iconUrl: getBadgeIconUrl(row.code),
    label: resolveBadgeCopy(row.name_key),
    description: resolveBadgeCopy(row.description_key),
    // Back-compat for evaluateBadgeCondition callers.
    conditions: {
      type: row.rule_type,
      ...(row.rule_config || {})
    }
  }));
}

function defaultVerificationForCode(code, seedStatus) {
  if (seedStatus && VERIFICATION_STATUSES.includes(seedStatus)) return seedStatus;
  if (
    [
      "first_collection",
      "squad_member",
      "squad_founder",
      "social",
      "complementary_collection",
      "early_collector"
    ].includes(code)
  ) {
    return "system_confirmed";
  }
  return "declared";
}

function progressFieldsForRule(ruleType, ruleConfig, ctx) {
  if (ruleType === "completion_threshold") {
    return {
      progressValue: Number(ctx.completionRatePrecise) || 0,
      targetValue: Number(ruleConfig.threshold) || null
    };
  }
  if (ruleType === "discovered_sprite_count") {
    return {
      progressValue: Number(ctx.discoveredSpriteCount) || 0,
      targetValue: Number(ruleConfig.min) || null
    };
  }
  if (ruleType === "first_owned_transition") {
    return {
      progressValue: Number(ctx.ownedVariantCount) || 0,
      targetValue: 1
    };
  }
  return { progressValue: null, targetValue: null };
}

module.exports = { listBadgeDefinitions, defaultVerificationForCode, progressFieldsForRule };
