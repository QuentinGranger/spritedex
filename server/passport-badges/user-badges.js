"use strict";

const { pool } = require("../db");
const { getBadgeIconUrl } = require("./content");
const { resolveBadgeCopy } = require("./rules");

async function listUserBadges(userId, db = pool) {
  const result = await db.query(
    `SELECT
       ub.id AS user_badge_id,
       ub.unlocked_at,
       ub.catalogue_version,
       ub.progress_value,
       ub.target_value,
       ub.verification_status,
       ub.evidence,
       ub.revoked_at,
       ub.context_type,
       ub.context_id,
       d.id AS badge_id,
       d.code,
       d.name_key,
       d.description_key,
       d.category,
       d.icon_key,
       d.rule_type,
       d.rule_config
     FROM user_badges ub
     JOIN badge_definitions d ON d.id = ub.badge_id
     WHERE ub.user_id = $1
       AND d.is_active = TRUE
       AND ub.revoked_at IS NULL
       AND d.is_hidden = FALSE
     ORDER BY ub.unlocked_at ASC`,
    [userId]
  );
  return result.rows.map((row) => {
    const evidence = row.evidence || {};
    const threshold =
      evidence.threshold != null
        ? Number(evidence.threshold)
        : row.target_value != null
          ? Number(row.target_value)
          : null;
    const releasedAtUnlock = evidence.releasedVariantCount != null ? Number(evidence.releasedVariantCount) : null;
    const isProgression = row.rule_type === "completion_threshold" || /^collection_\d+$/.test(row.code);
    const baseLabel = resolveBadgeCopy(row.name_key);
    const eventName = evidence.eventName || null;
    const label = row.code === "event_completed" && eventName ? `${baseLabel} · ${eventName}` : baseLabel;
    return {
      id: row.context_id ? `${row.code}:${row.context_id}` : row.code,
      code: row.code,
      badgeId: row.badge_id,
      userBadgeId: row.user_badge_id,
      label,
      description: resolveBadgeCopy(row.description_key),
      category: row.category,
      iconKey: row.icon_key,
      iconUrl: getBadgeIconUrl(row.code),
      ruleType: row.rule_type,
      ruleConfig: row.rule_config || {},
      unlockedAt: row.unlocked_at,
      catalogueVersion: row.catalogue_version,
      progressValue: row.progress_value != null ? Number(row.progress_value) : null,
      targetValue: row.target_value != null ? Number(row.target_value) : null,
      verificationStatus: row.verification_status,
      contextType: row.context_type,
      contextId: row.context_id,
      eventName,
      evidence,
      meta: evidence,
      isHistoricalProgression: isProgression,
      threshold,
      releasedVariantCountAtUnlock: releasedAtUnlock,
      completionRatePreciseAtUnlock:
        evidence.completionRatePrecise != null ? Number(evidence.completionRatePrecise) : null
    };
  });
}

module.exports = { listUserBadges };
