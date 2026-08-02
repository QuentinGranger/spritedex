const ctx = require("./context");
const { APP_URL, MAX_SQUAD_SIMULATION_CHANGES, MAX_SQUAD_SIMULATION_TEXT_LENGTH, MAX_SQUAD_SIMULATION_VARIANTS, MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH, MAX_USER_ID, QRCode, SQUAD_SIMULATION_TYPES, analytics, app, areFriends, canViewCollection, compare, computeCatalogueVersion, crypto, generateSquadCode, getCachedOrComputeSquadAnalysis, getRelationship, getRequestingUser, getSquadByIdOrCode, getViewerSafeSquadMembers, getVisibleSquadMemberIds, invalidateSquadAnalysisCache, isBlocked, isPlainObject, loadViewerSafeCollection, normalizeSimulationChange, normalizeSimulationChanges, normalizeSimulationMemberId, normalizeSimulationText, normalizeSimulationVariantIds, parsePositiveUserId, pool, redactCollectionPriorities, refreshSquadStats, requireNotSuspended, requireSquadMember, resolveAddressee, security, shareSquad, squadSimulationLimiter } = ctx;


async function simulateSquadAcquisition(squad, reqUser, memberId, acquireVariantIds) {
  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const total = catalogue.length;
  const validIds = new Set(catalogue.map(i => i.id));

  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const targetRow = membersResult.rows.find(r => String(r.user_id) === String(memberId));
  if (!targetRow) throw new Error("Membre introuvable dans l'escouade");
  if (!(await canViewCollection(reqUser, memberId))) {
    throw new Error("La collection de ce membre n'est pas visible");
  }

  const members = [];
  for (const r of membersResult.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    if (!visible) continue;
    const collection = await compare.loadServerCompareCollection(r.user_id);
    const owned = new Set();
    for (const [variantId, entry] of Object.entries(collection)) {
      if (compare.compareServerIsOwned(entry.status) && validIds.has(variantId)) owned.add(variantId);
    }
    members.push({ userId: r.user_id, username: r.username, owned });
  }

  const rawIds = Array.isArray(acquireVariantIds)
    ? acquireVariantIds
    : String(acquireVariantIds || "").split(",").map(s => s.trim()).filter(Boolean);
  const newVariantIds = rawIds.filter(id => validIds.has(id));
  const extraSet = new Set(newVariantIds);

  function computeCoverage(extraByUser = null) {
    const union = new Set();
    for (const m of members) {
      const isTarget = String(m.userId) === String(memberId);
      const set = extraByUser && isTarget ? new Set([...m.owned, ...extraByUser]) : m.owned;
      for (const vid of set) union.add(vid);
    }
    const coveredCount = union.size;
    const completionRate = total ? Math.round((coveredCount / total) * 10000) / 100 : 0;
    return { coveredCount, completionRate, totalVariantCount: total };
  }

  const before = computeCoverage();
  const after = computeCoverage(extraSet);

  return {
    memberId,
    acquireVariantIds: newVariantIds,
    before,
    after,
    difference: {
      coveredCount: after.coveredCount - before.coveredCount,
      completionRate: Math.round((after.completionRate - before.completionRate) * 100) / 100,
      totalVariantCount: 0
    }
  };
}

function toVariantIdList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean);
}

async function simulateSquadChanges(squad, reqUser, changes = []) {
  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const catalogueById = new Map(activeCatalogue.map(i => [i.id, i]));
  const validIds = new Set(activeCatalogue.map(i => i.id));

  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = [];
  for (const r of membersResult.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    if (!visible) continue;
    const collection = await compare.loadServerCompareCollection(r.user_id);
    const owned = new Set();
    for (const [variantId, entry] of Object.entries(collection)) {
      if (compare.compareServerIsOwned(entry.status) && validIds.has(variantId)) owned.add(variantId);
    }
    members.push({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name || r.username,
      owned
    });
  }

  let activeIds = new Set(validIds);

  function computeCoverage(memberList, idSet) {
    const union = new Set();
    for (const m of memberList) {
      for (const vid of m.owned) {
        if (idSet.has(vid)) union.add(vid);
      }
    }
    const coveredCount = union.size;
    const total = idSet.size;
    const completionRate = total ? Math.round((coveredCount / total) * 10000) / 100 : 0;
    return { coveredCount, completionRate, totalVariantCount: total };
  }

  const before = computeCoverage(members, activeIds);

  const simulatedMembers = members.map(m => ({ ...m, owned: new Set(m.owned) }));

  for (const change of changes) {
    if (!change || !change.type) continue;
    switch (change.type) {
      case "acquire": {
        const targetId = String(change.memberId);
        const variantIds = toVariantIdList(change.variantIds);
        const m = simulatedMembers.find(x => String(x.userId) === targetId);
        if (m) {
          for (const vid of variantIds) {
            if (activeIds.has(vid)) m.owned.add(vid);
          }
        }
        break;
      }
      case "join": {
        const variantIds = toVariantIdList(change.ownedVariantIds);
        const owned = new Set();
        for (const vid of variantIds) {
          if (activeIds.has(vid)) owned.add(vid);
        }
        const userId = change.memberId || `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        simulatedMembers.push({
          userId,
          username: change.username || "Nouveau membre",
          displayName: change.displayName || change.username || "Nouveau membre",
          owned
        });
        break;
      }
      case "leave": {
        const leaveId = String(change.memberId);
        const idx = simulatedMembers.findIndex(x => String(x.userId) === leaveId);
        if (idx >= 0) simulatedMembers.splice(idx, 1);
        break;
      }
      case "unavailable": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) activeIds.delete(vid);
        break;
      }
      case "add_event": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) {
          if (validIds.has(vid)) activeIds.add(vid);
        }
        break;
      }
      default:
        break;
    }
  }

  const after = computeCoverage(simulatedMembers, activeIds);

  return {
    before,
    after,
    difference: {
      coveredCount: after.coveredCount - before.coveredCount,
      completionRate: Math.round((after.completionRate - before.completionRate) * 100) / 100,
      totalVariantCount: after.totalVariantCount - before.totalVariantCount
    },
    appliedChanges: changes.length
  };
}

async function getSquadWhatIfImpact(squad, reqUser, change) {
  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const validIds = new Set(activeCatalogue.map(i => i.id));

  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = [];
  const memberIds = [];
  for (const r of membersResult.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    if (!visible) continue;
    const collection = await compare.loadServerCompareCollection(r.user_id);
    const owned = new Set();
    for (const [variantId, entry] of Object.entries(collection)) {
      if (compare.compareServerIsOwned(entry.status) && validIds.has(variantId)) owned.add(variantId);
    }
    members.push({ userId: r.user_id, username: r.username, displayName: r.display_name || r.username, owned });
    memberIds.push(r.user_id);
  }

  const memberSet = new Set(members.map(m => String(m.userId)));
  const activeGoals = await pool.query(
    `SELECT id, user_id, squad_id, title, variant_id
     FROM collection_goals
     WHERE status = 'active'
       AND (squad_id = $1 OR user_id = ANY($2))`,
    [squad.id, memberIds]
  );

  function computeSnapshot(memberList, idSet) {
    const variantOwnerCount = new Map();
    for (const m of memberList) {
      for (const vid of m.owned) {
        if (!idSet.has(vid)) continue;
        variantOwnerCount.set(vid, (variantOwnerCount.get(vid) || 0) + 1);
      }
    }

    let coveredCount = 0;
    let uniqueVariantCount = 0;
    let sharedVariantCount = 0;
    let duplicatePossessionCount = 0;
    for (const count of variantOwnerCount.values()) {
      coveredCount++;
      if (count === 1) uniqueVariantCount++;
      else sharedVariantCount++;
      duplicatePossessionCount += count - 1;
    }

    const total = idSet.size;
    const completionRate = total ? Math.round((coveredCount / total) * 10000) / 100 : 0;

    let mostComplementary = null;
    const uniqueByMember = new Map();
    for (const m of memberList) {
      let unique = 0;
      for (const vid of m.owned) {
        if (idSet.has(vid) && variantOwnerCount.get(vid) === 1) unique++;
      }
      if (!mostComplementary || unique > mostComplementary.uniqueVariantCount) {
        mostComplementary = { userId: m.userId, username: m.username, displayName: m.displayName, uniqueVariantCount: unique };
      }
    }

    let bestPair = null;
    let bestCoverage = -1;
    for (let i = 0; i < memberList.length; i++) {
      for (let j = i + 1; j < memberList.length; j++) {
        const union = new Set(memberList[i].owned);
        for (const vid of memberList[j].owned) union.add(vid);
        let covered = 0;
        for (const vid of union) if (idSet.has(vid)) covered++;
        if (covered > bestCoverage) {
          bestCoverage = covered;
          bestPair = {
            members: [
              { userId: memberList[i].userId, username: memberList[i].username, displayName: memberList[i].displayName },
              { userId: memberList[j].userId, username: memberList[j].username, displayName: memberList[j].displayName }
            ],
            coveredVariantCount: covered,
            coverageRate: total ? Math.round((covered / total) * 10000) / 100 : 0
          };
        }
      }
    }

    function isGoalCompleted(goal, list) {
      if (goal.squad_id) {
        return list.some(m => m.owned.has(goal.variant_id));
      }
      const m = list.find(x => String(x.userId) === String(goal.user_id));
      return m ? m.owned.has(goal.variant_id) : false;
    }

    const goals = activeGoals.rows.map(goal => ({
      goalId: goal.id,
      title: goal.title,
      variantId: goal.variant_id,
      completed: isGoalCompleted(goal, memberList)
    }));

    return {
      coveredCount,
      totalVariantCount: total,
      completionRate,
      uniqueVariantCount,
      sharedVariantCount,
      duplicatePossessionCount,
      mostComplementaryMember: mostComplementary,
      bestPair,
      goals
    };
  }

  let activeIds = new Set(validIds);
  const simulatedMembers = members.map(m => ({ ...m, owned: new Set(m.owned) }));

  if (change && change.type) {
    switch (change.type) {
      case "acquire": {
        const targetId = String(change.memberId);
        const variantIds = toVariantIdList(change.variantIds);
        const m = simulatedMembers.find(x => String(x.userId) === targetId);
        if (m) {
          for (const vid of variantIds) if (activeIds.has(vid)) m.owned.add(vid);
        }
        break;
      }
      case "join": {
        const variantIds = toVariantIdList(change.ownedVariantIds);
        const owned = new Set();
        for (const vid of variantIds) if (activeIds.has(vid)) owned.add(vid);
        const userId = change.memberId || `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        simulatedMembers.push({
          userId,
          username: change.username || "Nouveau membre",
          displayName: change.displayName || change.username || "Nouveau membre",
          owned
        });
        break;
      }
      case "leave": {
        const leaveId = String(change.memberId);
        const idx = simulatedMembers.findIndex(x => String(x.userId) === leaveId);
        if (idx >= 0) simulatedMembers.splice(idx, 1);
        break;
      }
      case "unavailable": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) activeIds.delete(vid);
        break;
      }
      case "add_event": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) {
          if (validIds.has(vid)) activeIds.add(vid);
        }
        break;
      }
    }
  }

  const before = computeSnapshot(members, activeIds);
  const after = computeSnapshot(simulatedMembers, activeIds);

  const affectedGoals = after.goals
    .map((g, i) => ({ ...g, beforeCompleted: before.goals[i].completed }))
    .filter(g => g.completed !== g.beforeCompleted);

  function diff(key) {
    return Math.round((after[key] - before[key]) * 100) / 100;
  }

  return {
    change,
    before,
    after,
    difference: {
      coveredCount: after.coveredCount - before.coveredCount,
      completionRate: Math.round((after.completionRate - before.completionRate) * 100) / 100,
      totalVariantCount: after.totalVariantCount - before.totalVariantCount,
      uniqueVariantCount: after.uniqueVariantCount - before.uniqueVariantCount,
      sharedVariantCount: after.sharedVariantCount - before.sharedVariantCount,
      duplicatePossessionCount: after.duplicatePossessionCount - before.duplicatePossessionCount
    },
    affectedGoals,
    mostComplementaryMember: {
      before: before.mostComplementaryMember,
      after: after.mostComplementaryMember
    },
    bestPair: {
      before: before.bestPair,
      after: after.bestPair
    }
  };
}

module.exports = { simulateSquadAcquisition, simulateSquadChanges, getSquadWhatIfImpact };
