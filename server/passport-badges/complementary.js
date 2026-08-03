"use strict";

const { pool } = require("../db");
const { awardBadgeByCode } = require("./unlocking");
const { precisePercent } = require("./rarities-events");

/**
 * Étapes 44–45 — complementary_collection from a real compare engine result.
 * Awards both users when eligible. Returns { awarded: [], skippedReason }.
 */
async function evaluateAndAwardComplementaryBadge(
  userAId,
  userBId,
  compareResult,
  { catalogueVersion = null, db = pool } = {}
) {
  const aId = Number(userAId);
  const bId = Number(userBId);
  if (!Number.isSafeInteger(aId) || !Number.isSafeInteger(bId) || aId === bId) {
    return { awarded: [], skippedReason: "same_or_invalid_users" };
  }
  const summary = compareResult && compareResult.summary;
  if (!summary) return { awarded: [], skippedReason: "no_result" };
  if (summary.insufficientData) return { awarded: [], skippedReason: "insufficient_data" };

  const { areFriends, shareActiveSquad, isAccountSuspended } = require("../auth");
  const { passportReliability } = require("../passport-math");

  if ((await isAccountSuspended(aId)) || (await isAccountSuspended(bId))) {
    return { awarded: [], skippedReason: "suspended" };
  }

  const socialOk = (await areFriends(aId, bId)) || (await shareActiveSquad(aId, bId));
  if (!socialOk) return { awarded: [], skippedReason: "no_social_link" };

  const users = await db.query(
    `SELECT id, created_at, deleted_at, suspended_until
     FROM users WHERE id = ANY($1::int[])`,
    [[aId, bId]]
  );
  if (users.rows.length < 2) return { awarded: [], skippedReason: "user_missing" };
  const now = Date.now();
  const minAgeMs = 24 * 60 * 60 * 1000;
  for (const row of users.rows) {
    if (row.deleted_at) return { awarded: [], skippedReason: "deleted" };
    if (row.suspended_until && new Date(row.suspended_until).getTime() > now) {
      return { awarded: [], skippedReason: "suspended" };
    }
    if (now - new Date(row.created_at).getTime() < minAgeMs) {
      return { awarded: [], skippedReason: "account_too_recent" };
    }
  }

  const total = Number(summary.catalogueVariantCount) || 0;
  if (total < 1) return { awarded: [], skippedReason: "empty_catalogue" };

  const aEntered = Number(summary.aEnteredCount) || 0;
  const bEntered = Number(summary.bEnteredCount) || 0;
  const aReliability = passportReliability(aEntered, total);
  const bReliability = passportReliability(bEntered, total);
  if (aReliability.rate < 80 || bReliability.rate < 80) {
    return { awarded: [], skippedReason: "reliability_below_80" };
  }

  // Exclusive owned variants (unknown pairs are already excluded from these groups).
  const exclusive = (Number(summary.onlyUserACount) || 0) + (Number(summary.onlyUserBCount) || 0);
  if (exclusive < 10) return { awarded: [], skippedReason: "exclusive_below_10" };

  const aRate = precisePercent(summary.aOwnedCount, total);
  const bRate = precisePercent(summary.bOwnedCount, total);
  const unionRate = precisePercent(summary.collectiveOwnedCount, total);
  const bestSolo = Math.max(aRate, bRate);
  const gain = unionRate - bestSolo;
  if (gain < 5 - 1e-12) return { awarded: [], skippedReason: "union_gain_below_5" };

  const evidenceBase = {
    ruleType: "complementary_collection",
    peerUserId: null,
    aOwnedRatePrecise: aRate,
    bOwnedRatePrecise: bRate,
    unionRatePrecise: unionRate,
    unionGainPoints: gain,
    exclusiveOwnedCount: exclusive,
    aReliabilityRate: aReliability.rate,
    bReliabilityRate: bReliability.rate,
    releasedVariantCount: total,
    catalogueVersion
  };

  const awarded = [];
  for (const [selfId, peerId, selfRate] of [
    [aId, bId, aRate],
    [bId, aId, bRate]
  ]) {
    const row = await awardBadgeByCode(selfId, "complementary_collection", {
      catalogueVersion,
      progressValue: gain,
      targetValue: 5,
      evidence: {
        ...evidenceBase,
        peerUserId: peerId,
        selfOwnedRatePrecise: selfRate
      },
      db,
      notify: true
    });
    if (row) awarded.push({ userId: selfId, badge: row });
  }
  return {
    awarded,
    skippedReason: awarded.length ? null : "already_unlocked",
    metrics: { aRate, bRate, unionRate, gain, exclusive }
  };
}

module.exports = { evaluateAndAwardComplementaryBadge };
