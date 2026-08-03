"use strict";

const { isBlocked } = require("./shared");
const {
  compareServerClassify,
  compareServerDefaultEntry,
  compareServerIsPriority,
  compareServerIsRecommend,
  isVariantReleasedAndActiveServer
} = require("./engine");
const { loadServerCompareCollection } = require("./catalog");
const { getServerCompareCatalogItemsCached } = require("./cache");

const SQUAD_MATRIX_STATUS = {
  OWNED_BY_EVERYONE: "owned_by_everyone",
  HIGHLY_SHARED: "highly_shared",
  SHARED: "shared",
  SINGLE_OWNER: "single_owner",
  MISSING_ALL: "missing_all",
  UNKNOWN: "unknown"
};

async function buildSquadCollectionMatrix(members, catalogue) {
  if (!members || members.length === 0) return [];
  const memberList = members.map((m) => {
    if (m && typeof m === "object" && m.userId !== undefined) {
      return {
        userId: m.userId,
        username: m.username || String(m.userId),
        visible: m.visible !== false,
        // A squad analysis can use a member's collection without necessarily
        // being allowed to disclose their granular priority level.  Keep the
        // collection visibility and priority visibility distinct so callers
        // can safely reuse the matrix for both kinds of analysis.
        prioritiesVisible: m.prioritiesVisible !== false
      };
    }
    return { userId: m, username: String(m), visible: true, prioritiesVisible: true };
  });

  const activeCatalogue = (catalogue || (await getServerCompareCatalogItemsCached())).filter(
    isVariantReleasedAndActiveServer
  );
  const collections = await Promise.all(
    memberList.map(async (m) => {
      if (!m.visible) return {};
      return loadServerCompareCollection(m.userId);
    })
  );

  const matrix = [];
  for (const item of activeCatalogue) {
    const owners = [];
    const missingMembers = [];
    const unknownMembers = [];
    const memberDetails = [];

    for (let i = 0; i < memberList.length; i++) {
      const m = memberList[i];
      const rawEntry = m.visible
        ? collections[i][item.id] || compareServerDefaultEntry()
        : { status: "unknown", priority: "none", note: "" };
      // Do not mutate the cached collection object.  It may be reused by a
      // later request that is authorized to see priority levels.
      const entry = m.visible && !m.prioritiesVisible ? { ...rawEntry, priority: "none" } : rawEntry;
      const classification = m.visible ? compareServerClassify(entry) : "unknown";

      memberDetails.push({
        userId: m.userId,
        username: m.username,
        status: entry.status || "new",
        priority: entry.priority || "none",
        classification,
        visible: m.visible !== false
      });

      if (classification === "owned") {
        owners.push(m.username);
      } else if (classification === "missing") {
        missingMembers.push(m.username);
      } else {
        unknownMembers.push(m.username);
      }
    }

    const ownerCount = owners.length;
    const memberCount = memberList.length;
    const half = Math.ceil(memberCount / 2);
    let status;
    if (ownerCount === 0) {
      status = unknownMembers.length === 0 ? SQUAD_MATRIX_STATUS.MISSING_ALL : SQUAD_MATRIX_STATUS.UNKNOWN;
    } else if (ownerCount === memberCount) {
      status = SQUAD_MATRIX_STATUS.OWNED_BY_EVERYONE;
    } else if (ownerCount >= half) {
      status = SQUAD_MATRIX_STATUS.HIGHLY_SHARED;
    } else if (ownerCount >= 2) {
      status = SQUAD_MATRIX_STATUS.SHARED;
    } else {
      status = SQUAD_MATRIX_STATUS.SINGLE_OWNER;
    }

    matrix.push({
      variantId: item.id,
      spriteId: item.spriteId,
      spriteName: item.spriteName,
      variantName: item.variantName,
      variantType: item.variantType || "Base",
      img: item.img,
      rarity: item.rarity,
      seasonId: item.seasonId,
      eventId: item.eventId,
      availabilityStatus: item.availabilityStatus,
      availability: item.availability,
      availabilityRecurrenceStatus: item.availabilityRecurrenceStatus,
      endDate: item.endDate || null,
      owners,
      missingMembers,
      unknownMembers,
      ownerCount,
      missingCount: missingMembers.length,
      unknownCount: unknownMembers.length,
      memberCount,
      status,
      members: memberDetails
    });
  }

  return matrix;
}

function getSquadCollectiveCompletion(matrix, squadName = "La squad") {
  const total = matrix.length;
  const covered = matrix.filter((r) => r.ownerCount > 0).length;
  const rate = total ? Math.round((covered / total) * 10000) / 100 : 0;
  const formattedRate = rate.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const display = `${squadName} couvre ${formattedRate} % du catalogue.`;
  return {
    collectiveCompletionRate: rate,
    coveredVariantCount: covered,
    totalVariantCount: total,
    display
  };
}

function getSquadAverageOwnership(matrix, squadName = "La squad") {
  if (!matrix || matrix.length === 0) {
    return { averageOwnershipRate: 0, ownedVariantsSum: 0, averageVariantCount: 0, display: "" };
  }

  const totalVariants = matrix.length;
  const memberCount = matrix[0].memberCount;
  let ownedVariantsSum = 0;

  for (const row of matrix) {
    for (const member of row.members) {
      if (member.classification === "owned") ownedVariantsSum++;
    }
  }

  const averageVariantCount = memberCount ? ownedVariantsSum / memberCount : 0;
  const rate =
    totalVariants && memberCount ? Math.round((ownedVariantsSum / (memberCount * totalVariants)) * 10000) / 100 : 0;
  const formattedRate = rate.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const display = `Le membre moyen de ${squadName} possède ${formattedRate} % du catalogue.`;

  return {
    averageOwnershipRate: rate,
    ownedVariantsSum,
    averageVariantCount,
    display
  };
}

async function getSquadCollectiveCompletionSummary(memberIds, catalogue) {
  if (!memberIds || memberIds.length === 0) {
    return { collectiveCompletionRate: 0, totalVariants: 0, ownedCount: 0 };
  }
  const members = memberIds.map((id) => ({ userId: id, username: String(id), visible: true }));
  const matrix = await buildSquadCollectionMatrix(members, catalogue);
  const result = getSquadCollectiveCompletion(matrix, "");
  return {
    collectiveCompletionRate: result.collectiveCompletionRate,
    totalVariants: result.totalVariantCount,
    ownedCount: result.coveredVariantCount
  };
}

function classifyRecommendationAvailability(availabilityStatus) {
  const s = (availabilityStatus || "").toLowerCase();
  if (s === "available" || s === "active" || s === "live") return "available_now";
  if (s === "upcoming" || s === "coming_soon" || s === "soon") return "upcoming";
  if (s === "ended" || s === "expired" || s === "over") return "ended";
  if (s === "not_observed" || s === "not_seen" || s === "missing") return "not_observed";
  return "unknown";
}

async function getSquadRecommendations(memberIds, catalogue) {
  if (!memberIds || memberIds.length < 2) return { immediate: [], watchList: [], immediateCount: 0, watchListCount: 0 };
  // Callers that know the viewer's granular permissions can pass the member
  // descriptors built for their matrix.  Keep accepting a plain list of IDs
  // for internal, system-wide computations (for example squad stat refreshes).
  const members = memberIds.map((member) => {
    if (member && typeof member === "object" && member.userId !== undefined) return member;
    return { userId: member, username: String(member), visible: true, prioritiesVisible: true };
  });
  const matrix = await buildSquadCollectionMatrix(members, catalogue);
  const recs = [];
  for (const row of matrix) {
    let wantedBy = 0;
    for (const m of row.members) {
      if (m.classification === "owned") continue;
      const entry = { status: m.status, priority: m.priority };
      if (compareServerIsRecommend(m.status) || compareServerIsPriority(entry)) wantedBy++;
    }
    if (row.ownerCount > 0 && wantedBy > 0) {
      const availability = classifyRecommendationAvailability(row.availabilityStatus);
      recs.push({
        variantId: row.variantId,
        spriteId: row.spriteId,
        spriteName: row.spriteName,
        variantName: row.variantName,
        img: row.img,
        availability,
        availabilityStatus: row.availabilityStatus,
        ownedByCount: row.ownerCount,
        wantedByCount: wantedBy,
        score: wantedBy * 100 + row.ownerCount
      });
    }
  }
  recs.sort((a, b) => b.score - a.score);
  const immediate = recs.filter((r) => r.availability === "available_now" || r.availability === "upcoming");
  const watchList = recs.filter(
    (r) => r.availability === "ended" || r.availability === "not_observed" || r.availability === "unknown"
  );

  return {
    immediate: immediate.slice(0, 50),
    watchList: watchList.slice(0, 50),
    immediateCount: immediate.length,
    watchListCount: watchList.length
  };
}

module.exports = {
  buildSquadCollectionMatrix,
  getSquadCollectiveCompletion,
  getSquadAverageOwnership,
  getSquadCollectiveCompletionSummary,
  classifyRecommendationAvailability,
  getSquadRecommendations,
  SQUAD_MATRIX_STATUS
};
