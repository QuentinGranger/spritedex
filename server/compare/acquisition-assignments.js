"use strict";

const { isBlocked } = require("./shared");
const { compareServerIsPriority } = require("./engine");
const { getSquadAcquisitionPriority, computeSquadMemberStats, isVariantAssignableForAcquisition } = require("./acquisition-priority");

async function getSquadAcquisitionAssignments(matrix, priorities, activeGoalCounts = {}, lastActiveByUser = {}, options = {}) {
  const {
    excludedSeasonIds = new Set(),
    activeGoalVariantCounts = new Map(),
    memberGoalVariantSet = new Set(),
    maxGoalAssignments = 2
  } = options;

  const stats = computeSquadMemberStats(matrix);
  const assignments = [];
  const assignedCounts = {};
  const now = Date.now();

  const firstRow = matrix[0];
  const matrixMemberIds = (firstRow && firstRow.members || []).map(m => m.userId).filter(Boolean);
  const blockedPairs = new Set();
  for (let i = 0; i < matrixMemberIds.length; i++) {
    for (let j = i + 1; j < matrixMemberIds.length; j++) {
      const a = matrixMemberIds[i];
      const b = matrixMemberIds[j];
      if (await isBlocked(a, b)) {
        blockedPairs.add(`${a}:${b}`);
        blockedPairs.add(`${b}:${a}`);
      }
    }
  }

  for (const variant of priorities) {
    const row = matrix.find(r => r.variantId === variant.variantId);
    if (!row) continue;

    if (!isVariantAssignableForAcquisition(row, variant, excludedSeasonIds, activeGoalVariantCounts, memberGoalVariantSet, maxGoalAssignments)) {
      assignments.push({
        ...variant,
        responsible: null,
        secondary: null,
        assignmentScore: null,
        assignmentReason: "Variante non assignable",
        secondaryScore: null,
        secondaryReason: null,
        recommendedMember: null,
        notAssignable: true
      });
      continue;
    }

    const candidates = [];

    for (const m of row.members || []) {
      if (m.classification === "owned") continue;
      if (m.visible === false) continue;
      if (memberGoalVariantSet.has(`${m.userId}:${variant.variantId}`)) continue;

      const s = stats[String(m.userId)];
      if (!s) continue;

      const isPriority = compareServerIsPriority({ status: m.status, priority: m.priority });
      const spriteOwned = s.ownedBySprite[row.spriteId] || 0;
      const rarityOwned = s.ownedByRarity[row.rarity || "_none"] || 0;
      const typeOwned = s.ownedByVariantType[row.variantType || "Base"] || 0;
      const activeGoals = activeGoalCounts[String(m.userId)] || 0;
      const lastActive = lastActiveByUser[String(m.userId)];
      const daysSince = lastActive ? Math.floor((now - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24)) : 999;
      const assignedCount = assignedCounts[String(m.userId)] || 0;

      let score = 0;
      const reasons = [];

      if (isPriority) {
        score += 100;
        reasons.push("a marqué cette variante en priorité");
      }

      score -= spriteOwned * 8;
      if (spriteOwned > 1) {
        score += 8;
        reasons.push("complète une série personnelle");
      } else if (spriteOwned === 1) {
        score += 4;
      }

      score -= rarityOwned * 2;
      score -= typeOwned * 2;

      score += s.reliabilityRate * 0.3;
      if (s.reliabilityRate < 25) {
        score -= 20;
      }

      if (daysSince < 7) {
        score += 10;
        reasons.push("actif récemment");
      } else if (daysSince < 30) {
        score += 5;
      }

      score -= activeGoals * 5;
      score -= assignedCount * 15;

      candidates.push({
        userId: m.userId,
        username: m.username,
        score,
        reasons: reasons.length ? reasons : ["meilleur candidat"]
      });
    }

    candidates.sort((a, b) => b.score - a.score);

    let primary = null;
    let secondary = null;
    for (const c of candidates) {
      if (!primary) {
        primary = c;
        continue;
      }
      if (!secondary && !blockedPairs.has(`${primary.userId}:${c.userId}`)) {
        secondary = c;
      }
    }

    if (primary) {
      assignedCounts[String(primary.userId)] = (assignedCounts[String(primary.userId)] || 0) + 1;
    }

    assignments.push({
      ...variant,
      responsible: primary ? { userId: primary.userId, username: primary.username } : null,
      secondary: secondary ? { userId: secondary.userId, username: secondary.username } : null,
      assignmentScore: primary ? Math.round(primary.score) : null,
      assignmentReason: primary ? primary.reasons.join(", ") : "Aucun membre éligible",
      secondaryScore: secondary ? Math.round(secondary.score) : null,
      secondaryReason: secondary ? secondary.reasons.join(", ") : null,
      // legacy alias for compatibility
      recommendedMember: primary ? { userId: primary.userId, username: primary.username } : null
    });
  }

  return assignments;
}

function formatSquadMemberRecommendation(assignment, memberEntry = null) {
  const codes = [];
  const explanation = [];

  if (assignment.ownerCount === 0) {
    codes.push("missing_from_entire_squad");
    explanation.push("Personne dans la squad ne possède cette variante.");
  } else {
    codes.push("partially_missing");
    explanation.push(`Cette variante est déjà possédée par ${assignment.ownerCount} membre${assignment.ownerCount > 1 ? 's' : ''} de la squad.`);
  }

  if (assignment.availability === "available_now") {
    codes.push("available_now");
    explanation.push("Elle est disponible actuellement.");
  } else if (assignment.availability === "upcoming") {
    codes.push("upcoming");
    explanation.push("Elle sera disponible prochainement.");
  }

  if (assignment.deadlineScore > 0 && assignment.endDate) {
    codes.push("event_ending_soon");
    const days = Math.max(1, Math.ceil((new Date(assignment.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    explanation.push(`Son événement se termine dans ${days} jour${days > 1 ? 's' : ''}.`);
  }

  if (assignment.isObjectiveTarget) {
    codes.push("active_goal_target");
    explanation.push("Elle est ciblée par un objectif actif.");
  }

  if (assignment.priorityCount > 0) {
    codes.push("priority_by_members");
    explanation.push(`${assignment.priorityCount} membre${assignment.priorityCount > 1 ? 's' : ''} ${assignment.priorityCount > 1 ? 'l\'ont' : 'l\'a'} marquée prioritaire.`);
  }

  if (memberEntry && compareServerIsPriority(memberEntry)) {
    codes.push("member_marked_priority");
    explanation.push("Cette variante est prioritaire pour toi.");
  }

  if (assignment.rarityScore >= 7) {
    codes.push("rare_variant");
    explanation.push("C'est une variante rare.");
  }

  if (assignment.collectiveCoverageDelta > 0) {
    explanation.push(`Cette acquisition ferait progresser la squad de ${assignment.collectiveCoverageDelta} point${assignment.collectiveCoverageDelta === 1 ? '' : 's'}.`);
  }

  if (assignment.assignmentReason && assignment.assignmentReason !== "Aucun membre éligible") {
    const cleanReason = assignment.assignmentReason.replace(/^a marqué cette variante en priorité,?\s*/, "");
    if (cleanReason) explanation.push(`Critère d'assignation : ${cleanReason}.`);
  }

  return {
    variantId: assignment.variantId,
    spriteId: assignment.spriteId,
    spriteName: assignment.spriteName,
    variantName: assignment.variantName,
    img: assignment.img,
    rarity: assignment.rarity,
    priorityScore: assignment.score,
    collectiveGain: assignment.collectiveCoverageGain,
    projectedCompletionGain: assignment.collectiveCoverageDelta,
    impactType: assignment.impactType,
    reasonCodes: codes,
    explanation
  };
}

function getSquadMemberRecommendations(matrix, assignments, memberId) {
  const result = [];
  for (const assignment of assignments) {
    if (!assignment.responsible || String(assignment.responsible.userId) !== String(memberId)) continue;
    const row = matrix.find(r => r.variantId === assignment.variantId);
    const memberEntry = row ? (row.members || []).find(m => String(m.userId) === String(memberId)) : null;
    result.push(formatSquadMemberRecommendation(assignment, memberEntry));
  }
  return result;
}

function getSquadCollectivePlan(matrix, assignments) {
  const byMember = {};
  let totalCollectiveGain = 0;

  for (const assignment of assignments) {
    if (!assignment.responsible) continue;
    totalCollectiveGain += assignment.collectiveCoverageGain || 0;
    const key = String(assignment.responsible.userId);
    if (!byMember[key]) {
      byMember[key] = {
        userId: assignment.responsible.userId,
        username: assignment.responsible.username,
        recommendations: []
      };
    }
    const row = matrix.find(r => r.variantId === assignment.variantId);
    const memberEntry = row ? (row.members || []).find(m => String(m.userId) === key) : null;
    byMember[key].recommendations.push(formatSquadMemberRecommendation(assignment, memberEntry));
  }

  const members = Object.values(byMember).sort((a, b) => String(a.username).localeCompare(String(b.username)));
  return { members, totalCollectiveGain };
}


module.exports = { getSquadAcquisitionAssignments, formatSquadMemberRecommendation, getSquadMemberRecommendations, getSquadCollectivePlan };
