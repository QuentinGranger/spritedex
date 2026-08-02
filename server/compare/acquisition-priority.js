"use strict";

const { isBlocked } = require("./shared");
const { compareServerIsPriority } = require("./engine");
const { classifyRecommendationAvailability } = require("./matrix");

const RARITY_ACQUISITION_SCORES = {
  mythic: 10,
  legendary: 8,
  epic: 6,
  rare: 4,
  uncommon: 2,
  common: 1
};

function getAcquisitionRarityScore(rarity) {
  const r = String(rarity || "").toLowerCase();
  return RARITY_ACQUISITION_SCORES[r] || 0;
}

function getAcquisitionAvailabilityScore(availability) {
  switch (availability) {
    case "available_now": return 15;
    case "upcoming": return 12;
    case "unknown": return 6;
    case "not_observed": return 4;
    case "ended": return 0;
    default: return 5;
  }
}

function getDeadlineScore(endDate, availability) {
  if (!endDate || (availability !== "available_now" && availability !== "upcoming")) return 0;
  const end = new Date(endDate);
  const now = new Date();
  const diffMs = end - now;
  if (diffMs <= 0) return 0;
  const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysUntil > 7) return 0;
  return Math.max(0, 10 - daysUntil);
}

function classifyEventUrgency(endDate, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const endingTodayHours = Number(options.endingTodayHours) || 24;
  const urgentDays = Number(options.urgentDays) || 7;
  const soonDays = Number(options.soonDays) || 14;

  if (!endDate) return { level: "unknown", daysRemaining: null, hoursRemaining: null };
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return { level: "unknown", daysRemaining: null, hoursRemaining: null };

  const diffMs = end.getTime() - now.getTime();
  const diffHrs = diffMs / (1000 * 60 * 60);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffMs <= 0) {
    return { level: "ended", daysRemaining: Math.floor(diffDays), hoursRemaining: Math.floor(diffHrs) };
  }
  if (diffMs <= endingTodayHours * 60 * 60 * 1000) {
    return { level: "ending_today", daysRemaining: Math.ceil(diffDays), hoursRemaining: Math.floor(diffHrs) };
  }
  if (diffDays <= urgentDays) {
    return { level: "urgent", daysRemaining: Math.ceil(diffDays), hoursRemaining: Math.floor(diffHrs) };
  }
  if (diffDays <= soonDays) {
    return { level: "soon", daysRemaining: Math.ceil(diffDays), hoursRemaining: Math.floor(diffHrs) };
  }
  return { level: "normal", daysRemaining: Math.ceil(diffDays), hoursRemaining: Math.floor(diffHrs) };
}

function getAcquisitionPriorityLevel(score) {
  if (score >= 70) return "haute";
  if (score >= 40) return "moyenne";
  return "à surveiller";
}

function buildAcquisitionPriorityDisplay(item) {
  const level = getAcquisitionPriorityLevel(item.score);
  const reasons = [];

  if (item.ownerCount === 0) {
    reasons.push("personne dans la squad ne possède cette variante");
  } else if (item.missingCount > 0) {
    reasons.push(`${item.missingCount} membre${item.missingCount > 1 ? 's' : ''} de la squad ${item.missingCount > 1 ? 'la recherchent' : 'la recherche'}`);
  }

  if (item.priorityCount > 0) {
    reasons.push(`${item.priorityCount} membre${item.priorityCount > 1 ? 's l\'ont marquée prioritaire' : ' l\'a marquée prioritaire'}`);
  }

  if (item.availability === "available_now") {
    reasons.push("elle est disponible actuellement");
  } else if (item.availability === "upcoming") {
    reasons.push("elle sera disponible prochainement");
  }

  if (item.deadlineScore > 0) {
    reasons.push("l'événement se termine bientôt");
  }

  if (item.isObjectiveTarget) {
    reasons.push("elle est ciblée par un objectif actif");
  }

  let impactSentence = "";
  if (item.impactType === "collective") {
    const delta = item.collectiveCoverageDelta;
    impactSentence = ` Obtenir ${item.spriteName} ${item.variantName} ferait passer la couverture collective de ${item.collectiveCoverageBefore}% à ${item.collectiveCoverageAfter}% (gain de ${delta >= 0 ? '+' : ''}${delta} point${delta === 1 || delta === -1 ? '' : 's'}).`;
  } else if (item.impactType === "individual") {
    impactSentence = ` Obtenir ${item.spriteName} ${item.variantName} n'augmenterait pas la couverture collective (déjà possédée par ${item.ownerCount} membre${item.ownerCount > 1 ? 's' : ''}).`;
  }

  if (reasons.length === 0) {
    return `Priorité ${level} pour ${item.spriteName} ${item.variantName}.${impactSentence}`;
  }
  return `Priorité ${level} : ${reasons.join(", ")}.${impactSentence}`;
}

function getSquadAcquisitionPriority(matrix, activeGoalVariantIds = new Set()) {
  const results = [];
  const totalVariants = matrix.length;
  const coveredVariants = totalVariants ? matrix.filter(r => r.ownerCount > 0).length : 0;

  for (const row of matrix) {
    if (row.ownerCount >= row.memberCount) continue;

    let priorityCount = 0;
    for (const m of row.members) {
      if (compareServerIsPriority({ status: m.status, priority: m.priority })) priorityCount++;
    }

    const availability = classifyRecommendationAvailability(row.availabilityStatus);
    const impactScore = Math.round((row.missingCount / row.memberCount) * 35);
    const priorityScore = Math.round((priorityCount / row.memberCount) * 20);
    const availabilityScore = getAcquisitionAvailabilityScore(availability);
    const rarityScore = getAcquisitionRarityScore(row.rarity);
    const deadlineScore = getDeadlineScore(row.endDate, availability);
    const objectiveScore = activeGoalVariantIds.has(row.variantId) ? 10 : 0;

    const score = Math.min(100, impactScore + priorityScore + availabilityScore + rarityScore + deadlineScore + objectiveScore);
    const scoreDetails = {
      collectiveImpact: impactScore,
      personalPriority: priorityScore,
      availability: availabilityScore,
      rarity: rarityScore,
      eventUrgency: deadlineScore,
      activeGoal: objectiveScore
    };

    const impactType = row.ownerCount === 0 ? "collective" : "individual";
    const collectiveCoverageBefore = totalVariants ? Math.round((coveredVariants / totalVariants) * 10000) / 100 : 0;
    const collectiveCoverageAfter = impactType === "collective" && totalVariants
      ? Math.round(((coveredVariants + 1) / totalVariants) * 10000) / 100
      : collectiveCoverageBefore;
    const collectiveCoverageGain = impactType === "collective" ? 1 : 0;
    const collectiveCoverageDelta = Math.round((collectiveCoverageAfter - collectiveCoverageBefore) * 100) / 100;

    const item = {
      variantId: row.variantId,
      spriteId: row.spriteId,
      spriteName: row.spriteName,
      variantName: row.variantName,
      img: row.img,
      rarity: row.rarity,
      availability,
      availabilityStatus: row.availabilityStatus,
      endDate: row.endDate,
      ownerCount: row.ownerCount,
      missingCount: row.missingCount,
      missingMemberNames: row.missingMembers,
      priorityCount,
      isObjectiveTarget: objectiveScore > 0,
      score,
      scoreDetails,
      impactScore,
      priorityScore,
      availabilityScore,
      rarityScore,
      deadlineScore,
      objectiveScore,
      impactType,
      collectiveCoverageBefore,
      collectiveCoverageAfter,
      collectiveCoverageGain,
      collectiveCoverageDelta
    };

    item.display = buildAcquisitionPriorityDisplay(item);
    results.push(item);
  }

  results.sort((a, b) => b.score - a.score || getAcquisitionRarityScore(b.rarity) - getAcquisitionRarityScore(a.rarity) || String(a.spriteName).localeCompare(String(b.spriteName)));
  return results.slice(0, 50);
}

function computeSquadMemberStats(matrix) {
  const stats = {};
  if (!matrix || matrix.length === 0) return stats;

  const firstRow = matrix[0];
  const totalVariants = matrix.length;

  for (const member of firstRow.members || []) {
    stats[String(member.userId)] = {
      userId: member.userId,
      username: member.username,
      ownedBySprite: {},
      ownedByRarity: {},
      ownedByVariantType: {},
      ownedTotal: 0,
      knownTotal: 0
    };
  }

  for (const row of matrix) {
    for (const m of row.members || []) {
      const s = stats[String(m.userId)];
      if (!s) continue;

      if (m.classification === "owned") {
        s.ownedTotal++;
        s.ownedBySprite[row.spriteId] = (s.ownedBySprite[row.spriteId] || 0) + 1;
        s.ownedByRarity[row.rarity || "_none"] = (s.ownedByRarity[row.rarity || "_none"] || 0) + 1;
        s.ownedByVariantType[row.variantType || "Base"] = (s.ownedByVariantType[row.variantType || "Base"] || 0) + 1;
      }

      if (m.classification !== "unknown") {
        s.knownTotal++;
      }
    }
  }

  for (const s of Object.values(stats)) {
    s.reliabilityRate = totalVariants ? Math.round((s.knownTotal / totalVariants) * 10000) / 100 : 0;
  }

  return stats;
}

function isVariantAssignableForAcquisition(row, variant, excludedSeasonIds, activeGoalVariantCounts, memberGoalVariantSet, maxGoalAssignments) {
  const availability = classifyRecommendationAvailability(row.availabilityStatus);
  if (availability === "ended" || availability === "not_observed") {
    const recurrence = row.availability?.recurrence?.status || "unknown";
    if (!["confirmed_recurring", "possible_return"].includes(recurrence)) {
      return false;
    }
  }

  if (row.seasonId && excludedSeasonIds.has(String(row.seasonId))) return false;

  const variantGoalCount = activeGoalVariantCounts.get(variant.variantId) || 0;
  if (variantGoalCount >= maxGoalAssignments) return false;

  return true;
}


module.exports = { getAcquisitionRarityScore, getAcquisitionAvailabilityScore, getDeadlineScore, classifyEventUrgency, getAcquisitionPriorityLevel, buildAcquisitionPriorityDisplay, getSquadAcquisitionPriority, computeSquadMemberStats, isVariantAssignableForAcquisition, RARITY_ACQUISITION_SCORES };
