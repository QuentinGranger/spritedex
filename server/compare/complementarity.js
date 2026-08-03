"use strict";

const crypto = require("crypto");
const {
  compareServerClassify,
  compareServerDefaultEntry,
  compareServerIsPriority,
  countServerExplicitCollectionEntries
} = require("./engine");
const { isVariantReleasedAndActiveServer } = require("./catalog");

const DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS = {
  mythic: 1.5,
  legendary: 1.2,
  epic: 1,
  rare: 0.7,
  uncommon: 0.4,
  common: 0.1
};

function isServerItemAvailable(item) {
  if (item.available === false) return false;
  const status = (item.availabilityStatus || "").toLowerCase();
  return status !== "unavailable";
}

function computeComplementarityScore(baseRate, records, options = {}) {
  const rarityWeights = options.rarityWeights || DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS;
  const objectiveVariantIds = options.objectiveVariantIds ? new Set(options.objectiveVariantIds) : null;
  const activeEventIds = options.activeEventIds ? new Set(options.activeEventIds) : null;

  const isOwned = (entry) => compareServerClassify(entry) === "owned";
  const isMissing = (entry) => compareServerClassify(entry) === "missing";
  const isPriority = (entry) => compareServerIsPriority(entry);

  let commonPriorities = 0;
  let availableComplements = 0;
  let objectiveMatches = 0;
  let soughtRarities = 0;
  let activeEvents = 0;

  for (const rec of records) {
    const aOwned = isOwned(rec.userA);
    const bOwned = isOwned(rec.userB);
    const aPrio = isPriority(rec.userA);
    const bPrio = isPriority(rec.userB);
    const aMissing = isMissing(rec.userA);
    const bMissing = isMissing(rec.userB);
    const onlyOne = (aOwned && !bOwned) || (bOwned && !aOwned);

    if (aPrio && bPrio) commonPriorities++;
    if (onlyOne && isServerItemAvailable(rec)) availableComplements++;

    if (objectiveVariantIds && objectiveVariantIds.has(rec.id) && onlyOne) {
      if ((aOwned && (bMissing || bPrio)) || (bOwned && (aMissing || aPrio))) objectiveMatches++;
    }

    if (onlyOne && ((aOwned && bPrio) || (bOwned && aPrio))) {
      const weight = rarityWeights[(rec.rarity || "").toLowerCase()] || 0;
      if (weight > 0) soughtRarities += weight;
    }

    if (rec.eventId && onlyOne) {
      const isActiveEvent = activeEventIds
        ? activeEventIds.has(rec.eventId)
        : isServerItemAvailable(rec) && (rec.availabilityStatus || "").toLowerCase() === "event";
      if (isActiveEvent) activeEvents++;
    }
  }

  const bonus =
    commonPriorities * 0.5 +
    availableComplements * 0.3 +
    objectiveMatches * 0.7 +
    soughtRarities * 0.4 +
    activeEvents * 0.5;
  return Math.min(100, Math.round((baseRate + bonus) * 100) / 100);
}

function compareCollectionsServer(userA, userB, catalogue) {
  const activeCatalogue = catalogue.filter(isVariantReleasedAndActiveServer);
  const groups = { bothOwned: [], onlyUserA: [], onlyUserB: [], bothMissing: [], unknown: [] };
  const records = [];

  for (const item of activeCatalogue) {
    const a = userA.collection[item.variantId] || compareServerDefaultEntry();
    const b = userB.collection[item.variantId] || compareServerDefaultEntry();
    const sa = compareServerClassify(a);
    const sb = compareServerClassify(b);

    const record = {
      ...item,
      userA: { status: a.status, priority: a.priority, note: a.note },
      userB: { status: b.status, priority: b.priority, note: b.note }
    };

    if (sa === "unknown" || sb === "unknown") {
      groups.unknown.push(record);
    } else if (sa === "owned" && sb === "owned") {
      groups.bothOwned.push(record);
    } else if (sa === "owned" && sb !== "owned") {
      groups.onlyUserA.push(record);
    } else if (sb === "owned" && sa !== "owned") {
      groups.onlyUserB.push(record);
    } else if (sa === "missing" && sb === "missing") {
      groups.bothMissing.push(record);
    } else {
      groups.unknown.push(record);
    }
    records.push(record);
  }

  const total = activeCatalogue.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;

  const toRate = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : 0);
  const aEnteredCount = countServerExplicitCollectionEntries(userA.collection);
  const bEnteredCount = countServerExplicitCollectionEntries(userB.collection);
  const insufficientData = aEnteredCount === 0 || bEnteredCount === 0;
  const comparisonId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `comparison_${crypto.randomBytes(16).toString("hex")}`;
  const complementarityRate = toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount);
  const complementarityScore = computeComplementarityScore(complementarityRate, records);

  return {
    comparisonId,
    generatedAt: new Date().toISOString(),
    users: {
      userA: { id: userA.id, displayName: userA.displayName, enteredCount: aEnteredCount },
      userB: { id: userB.id, displayName: userB.displayName, enteredCount: bEnteredCount }
    },
    summary: {
      catalogueVariantCount: total,
      bothOwnedCount,
      onlyUserACount,
      onlyUserBCount,
      bothMissingCount,
      unknownCount,
      aOwnedCount,
      bOwnedCount,
      aPossessionRate: toRate(aOwnedCount, total),
      bPossessionRate: toRate(bOwnedCount, total),
      collectiveOwnedCount,
      collectiveCompletionRate: toRate(collectiveOwnedCount, total),
      complementarityRate,
      complementarityScore,
      aEnteredCount,
      bEnteredCount,
      insufficientData
    },
    groups,
    records
  };
}

module.exports = {
  isServerItemAvailable,
  computeComplementarityScore,
  compareCollectionsServer,
  DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS
};
