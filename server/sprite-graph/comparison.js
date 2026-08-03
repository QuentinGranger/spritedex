"use strict";

const { normalizeIntId } = require("./normalization");
const { normalizeComparisonPair } = require("./social");

/**
 * Étape 46–47 — sprites present in ownership differences (onlyA ∪ onlyB).
 * These are difference appearances, NOT "views".
 */
function extractTopDifferenceSpriteIds(result, { limit = 15 } = {}) {
  const groups = (result && result.groups) || {};
  const diffs = [].concat(groups.onlyUserA || []).concat(groups.onlyUserB || []);
  const counts = new Map();
  for (const rec of diffs) {
    if (!rec) continue;
    const sid = rec.spriteId || rec.sprite_id;
    if (!sid) continue;
    const key = String(sid);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const max = Math.max(1, Math.min(40, Number(limit) || 15));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, max)
    .map(([id]) => id);
}

/**
 * Build comparison.completed context from engine summary (Étape 18 / 46–49).
 * Counts are oriented from the actor's point of view.
 */
function buildComparisonCompletedContext({
  actorUserId,
  targetUserId,
  userAId,
  userBId,
  result,
  catalogueVersion = null
} = {}) {
  const summary = (result && result.summary) || {};
  const actor = normalizeIntId(actorUserId);
  const a = normalizeIntId(userAId) || actor;
  const b = normalizeIntId(userBId) || normalizeIntId(targetUserId);
  const actorIsA = actor != null && a != null && actor === a;
  const onlyA = Number(summary.onlyUserACount) || 0;
  const onlyB = Number(summary.onlyUserBCount) || 0;
  const pair = normalizeComparisonPair(actor, targetUserId) || normalizeComparisonPair(a, b);
  const topDifferenceSpriteIds = extractTopDifferenceSpriteIds(result);
  const aRate = summary.aPossessionRate != null ? Number(summary.aPossessionRate) : null;
  const bRate = summary.bPossessionRate != null ? Number(summary.bPossessionRate) : null;

  return {
    catalogueVersion: catalogueVersion || summary.catalogueVersion || null,
    collectiveCompletionRate:
      summary.collectiveCompletionRate != null ? Number(summary.collectiveCompletionRate) : null,
    complementarityRate: summary.complementarityRate != null ? Number(summary.complementarityRate) : null,
    onlyActorCount: actorIsA ? onlyA : onlyB,
    onlyTargetCount: actorIsA ? onlyB : onlyA,
    bothOwnedCount: Number(summary.bothOwnedCount) || 0,
    bothMissingCount: Number(summary.bothMissingCount) || 0,
    pairUserLowId: pair ? pair.pairUserLowId : null,
    pairUserHighId: pair ? pair.pairUserHighId : null,
    pairKey: pair ? pair.pairKey : null,
    // Étape 46–47 — difference appearances (never labeled as views).
    topDifferenceSpriteIds,
    differenceSpriteCount: topDifferenceSpriteIds.length,
    actorCollectionRate: actorIsA ? aRate : bRate,
    targetCollectionRate: actorIsA ? bRate : aRate,
    pairCollectionRate: aRate != null && bRate != null ? Math.round(((aRate + bRate) / 2) * 100) / 100 : null
  };
}

module.exports = { extractTopDifferenceSpriteIds, buildComparisonCompletedContext };
