"use strict";

const { compareServerIsMissing, compareServerIsPriority, compareServerIsRecommend } = require("./engine");
const { getSquadCollectiveCompletion } = require("./matrix");

function getSquadHelpScores(matrix, targetUserId, options = {}) {
  const priorityWeight = options.priorityWeight || 3;
  const normalWeight = options.normalWeight || 1;
  const helpers = {};

  for (const row of matrix) {
    const target = row.members.find(m => String(m.userId) === String(targetUserId));
    if (!target || target.visible === false) continue;

    const wantsHelp = compareServerIsMissing(target.status) || compareServerIsRecommend(target.status);
    if (!wantsHelp) continue;
    const isPriority = compareServerIsPriority(target);

    for (const m of row.members) {
      if (String(m.userId) === String(targetUserId)) continue;
      if (m.visible === false) continue;
      if (m.classification !== "owned") continue;

      const key = String(m.userId);
      if (!helpers[key]) {
        helpers[key] = {
          userId: m.userId,
          username: m.username,
          normalHelpCount: 0,
          priorityHelpCount: 0,
          helpScore: 0
        };
      }

      const h = helpers[key];
      if (isPriority) {
        h.priorityHelpCount += 1;
        h.helpScore += priorityWeight;
      } else {
        h.normalHelpCount += 1;
        h.helpScore += normalWeight;
      }
    }
  }

  const result = Object.values(helpers);
  result.sort((a, b) => b.helpScore - a.helpScore || b.priorityHelpCount - a.priorityHelpCount || String(a.username).localeCompare(String(b.username)));

  for (const h of result) {
    const total = h.normalHelpCount + h.priorityHelpCount;
    const priorityPart = h.priorityHelpCount > 0 ? `, dont ${h.priorityHelpCount} prioritaire${h.priorityHelpCount > 1 ? 's' : ''}` : "";
    h.display = `${h.username} peut aider avec ${total} variante${total > 1 ? 's' : ''} manquante${total > 1 ? 's' : ''}${priorityPart}.`;
  }

  return result;
}

function classifySquadMissing(row) {
  if (row.ownerCount !== 0) return null;
  if (row.missingCount === 0) return null;

  if (row.unknownCount === 0 && row.missingCount === row.memberCount) {
    return "confirmed_missing";
  }

  if (row.unknownCount > 0 && row.missingCount >= row.unknownCount) {
    return "possibly_missing";
  }

  return null;
}

function getSquadMissingVariants(matrix, squadName) {
  const missing = [];
  for (const row of matrix) {
    const classification = classifySquadMissing(row);
    if (!classification) continue;

    let display;
    if (classification === "confirmed_missing") {
      display = `Aucun membre de ${squadName} ne possède ${row.spriteName} ${row.variantName}.`;
    } else {
      display = `Cette variante semble manquer à la squad, mais ${row.unknownCount} collection${row.unknownCount > 1 ? 's' : ''} ne ${row.unknownCount > 1 ? 'sont' : 'est'} pas à jour.`;
    }

    missing.push({
      variantId: row.variantId,
      spriteId: row.spriteId,
      spriteName: row.spriteName,
      variantName: row.variantName,
      variantType: row.variantType,
      img: row.img,
      rarity: row.rarity,
      eventId: row.eventId,
      availabilityStatus: row.availabilityStatus,
      ownerCount: row.ownerCount,
      missingMemberCount: row.missingCount,
      unknownMemberCount: row.unknownCount,
      classification,
      display
    });
  }

  const groupBy = (key, labelFn) => {
    const groups = {};
    for (const v of missing) {
      const k = (v[key] === null || v[key] === undefined || v[key] === "") ? "_none" : v[key];
      if (!groups[k]) groups[k] = { key: k, label: labelFn(v, k), count: 0, variants: [] };
      groups[k].variants.push(v);
      groups[k].count++;
    }
    return Object.values(groups).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  };

  const bySprite = groupBy("spriteId", (v) => v.spriteName || v.spriteId);
  const byRarity = groupBy("rarity", (v, k) => k === "_none" ? "Rareté inconnue" : `Rareté ${k}`);
  const byEvent = groupBy("eventId", (v, k) => k === "_none" ? "Hors événement" : `Événement ${k}`);
  const byAvailability = groupBy("availabilityStatus", (v, k) => k === "_none" ? "Disponibilité inconnue" : `Disponibilité ${k}`);
  const byVariantType = groupBy("variantType", (v, k) => k);

  const confirmedMissingCount = missing.filter(v => v.classification === "confirmed_missing").length;
  const possiblyMissingCount = missing.length - confirmedMissingCount;

  return {
    totalMissing: missing.length,
    confirmedMissingCount,
    possiblyMissingCount,
    variants: missing,
    bySprite,
    byRarity,
    byEvent,
    byAvailability,
    byVariantType
  };
}

function classifySquadShared(row) {
  if (row.ownerCount < 2) return null;
  const half = Math.ceil(row.memberCount / 2);
  if (row.ownerCount === row.memberCount) return "owned_by_everyone";
  if (row.ownerCount >= half) return "highly_shared";
  return "shared";
}

function getSquadSharedVariants(matrix) {
  const shared = [];
  for (const row of matrix) {
    const classification = classifySquadShared(row);
    if (!classification) continue;

    const display = `${row.spriteName} ${row.variantName} est possédé par ${row.ownerCount} membre${row.ownerCount > 1 ? 's' : ''} sur ${row.memberCount}.`;
    shared.push({
      variantId: row.variantId,
      spriteId: row.spriteId,
      spriteName: row.spriteName,
      variantName: row.variantName,
      variantType: row.variantType,
      img: row.img,
      rarity: row.rarity,
      eventId: row.eventId,
      availabilityStatus: row.availabilityStatus,
      owners: row.owners,
      ownerCount: row.ownerCount,
      memberCount: row.memberCount,
      classification,
      display
    });
  }

  const groupBy = (key, labelFn) => {
    const groups = {};
    for (const v of shared) {
      const k = (v[key] === null || v[key] === undefined || v[key] === "") ? "_none" : v[key];
      if (!groups[k]) groups[k] = { key: k, label: labelFn(v, k), count: 0, variants: [] };
      groups[k].variants.push(v);
      groups[k].count++;
    }
    return Object.values(groups).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  };

  const bySprite = groupBy("spriteId", (v) => v.spriteName || v.spriteId);
  const byRarity = groupBy("rarity", (v, k) => k === "_none" ? "Rareté inconnue" : `Rareté ${k}`);
  const byEvent = groupBy("eventId", (v, k) => k === "_none" ? "Hors événement" : `Événement ${k}`);
  const byAvailability = groupBy("availabilityStatus", (v, k) => k === "_none" ? "Disponibilité inconnue" : `Disponibilité ${k}`);
  const byVariantType = groupBy("variantType", (v, k) => k);
  const byClassification = groupBy("classification", (v, k) => k);

  const sharedCount = shared.filter(v => v.classification === "shared").length;
  const highlySharedCount = shared.filter(v => v.classification === "highly_shared").length;
  const ownedByEveryoneCount = shared.filter(v => v.classification === "owned_by_everyone").length;

  return {
    totalShared: shared.length,
    sharedCount,
    highlySharedCount,
    ownedByEveryoneCount,
    variants: shared,
    byClassification,
    bySprite,
    byRarity,
    byEvent,
    byAvailability,
    byVariantType
  };
}

function getSquadMostComplementaryMember(matrix, squadName = "La squad") {
  const uniqueOwners = getSquadUniqueOwners(matrix);
  const sorted = uniqueOwners.byMember;
  if (!sorted || sorted.length === 0) {
    return null;
  }

  const top = sorted[0];
  return {
    userId: top.userId,
    username: top.username,
    uniqueVariantCount: top.count,
    display: `${top.username} est actuellement le membre le plus complémentaire de ${squadName}.`,
    contributionDisplay: `${top.username} apporte ${top.count} variante${top.count > 1 ? 's' : ''} absentes des autres collections.`
  };
}

function getSquadLevel1Analysis(matrix, squadName, pairComplementarity = []) {
  const completion = getSquadCollectiveCompletion(matrix, squadName);
  const missing = getSquadMissingVariants(matrix, squadName);
  const uniqueOwners = getSquadUniqueOwners(matrix);
  const sharedVariants = getSquadSharedVariants(matrix);

  const memberList = (matrix && matrix[0] && matrix[0].members) || [];
  const uniqueCountByUser = new Map(uniqueOwners.byMember.map(m => [String(m.userId), m.count]));
  const members = [];

  for (const member of memberList) {
    const userKey = String(member.userId);
    let ownedCount = 0;
    let knownCount = 0;
    for (const row of matrix) {
      const m = row.members.find(x => String(x.userId) === userKey);
      if (!m) continue;
      if (m.classification === "owned") ownedCount++;
      if (m.classification !== "unknown") knownCount++;
    }
    members.push({
      userId: member.userId,
      username: member.username,
      ownedCount,
      uniqueContributionCount: uniqueCountByUser.get(userKey) || 0,
      collectionReliabilityRate: completion.totalVariantCount ? Math.round((knownCount / completion.totalVariantCount) * 10000) / 100 : 0
    });
  }

  return {
    summary: {
      catalogueVariantCount: completion.totalVariantCount,
      coveredVariantCount: completion.coveredVariantCount,
      collectiveCompletionRate: completion.collectiveCompletionRate,
      confirmedMissingCount: missing.confirmedMissingCount,
      possiblyMissingCount: missing.possiblyMissingCount,
      singleOwnerVariantCount: uniqueOwners.totalUnique,
      sharedVariantCount: sharedVariants.totalShared
    },
    members,
    missingVariants: missing.variants,
    singleOwnerVariants: uniqueOwners.uniqueVariants,
    sharedVariants: sharedVariants.variants,
    pairComplementarity
  };
}

function getSquadUniqueOwners(matrix) {
  const unique = [];
  const byMember = {};

  for (const row of matrix) {
    if (row.ownerCount !== 1) continue;
    const owner = row.members.find(m => m.classification === "owned");
    if (!owner) continue;

    const display = `${owner.username} est le seul membre à posséder ${row.spriteName} ${row.variantName}.`;
    const item = {
      variantId: row.variantId,
      spriteId: row.spriteId,
      spriteName: row.spriteName,
      variantName: row.variantName,
      variantType: row.variantType,
      img: row.img,
      rarity: row.rarity,
      eventId: row.eventId,
      availabilityStatus: row.availabilityStatus,
      uniqueOwnerId: owner.userId,
      uniqueOwnerUsername: owner.username,
      classification: "single_owner",
      display
    };

    unique.push(item);

    if (!byMember[owner.userId]) {
      byMember[owner.userId] = { userId: owner.userId, username: owner.username, count: 0, variants: [] };
    }
    byMember[owner.userId].variants.push(item);
    byMember[owner.userId].count++;
  }

  return {
    totalUnique: unique.length,
    uniqueVariants: unique,
    byMember: Object.values(byMember).sort((a, b) => b.count - a.count || String(a.username).localeCompare(String(b.username)))
  };
}


module.exports = { getSquadHelpScores, classifySquadMissing, getSquadMissingVariants, classifySquadShared, getSquadSharedVariants, getSquadMostComplementaryMember, getSquadLevel1Analysis, getSquadUniqueOwners };
