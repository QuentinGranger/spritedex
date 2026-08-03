const ctx = require("./context");
const {
  APP_URL,
  MAX_SQUAD_SIMULATION_CHANGES,
  MAX_SQUAD_SIMULATION_TEXT_LENGTH,
  MAX_SQUAD_SIMULATION_VARIANTS,
  MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH,
  MAX_USER_ID,
  QRCode,
  SQUAD_SIMULATION_TYPES,
  analytics,
  app,
  areFriends,
  canViewCollection,
  compare,
  computeCatalogueVersion,
  crypto,
  generateSquadCode,
  getCachedOrComputeSquadAnalysis,
  getRelationship,
  getRequestingUser,
  getSquadByIdOrCode,
  getViewerSafeSquadMembers,
  getVisibleSquadMemberIds,
  invalidateSquadAnalysisCache,
  isBlocked,
  isPlainObject,
  loadViewerSafeCollection,
  normalizeSimulationChange,
  normalizeSimulationChanges,
  normalizeSimulationMemberId,
  normalizeSimulationText,
  normalizeSimulationVariantIds,
  parsePositiveUserId,
  pool,
  redactCollectionPriorities,
  refreshSquadStats,
  requireNotSuspended,
  requireSquadMember,
  resolveAddressee,
  security,
  shareSquad,
  squadSimulationLimiter
} = ctx;
const friends = require("./logic-friends");
const { getSquadComplementaryPairs } = friends;

async function getSquadBestPair(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const memberIds = membersRes.rows.map((r) => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const allowed = (await getViewerSafeSquadMembers(usersRes.rows, reqUser)).filter((member) => member.visible);
  if (allowed.length < 2) return null;

  const collections = await Promise.all(allowed.map(loadViewerSafeCollection));

  const blockedPairs = new Set();
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      if (await isBlocked(allowed[i].id, allowed[j].id)) blockedPairs.add(`${i}:${j}`);
    }
  }

  const pairs = [];
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      if (blockedPairs.has(`${i}:${j}`)) continue;
      const a = allowed[i];
      const b = allowed[j];
      const userA = { id: a.id, displayName: a.display_name || a.username, collection: collections[i] };
      const userB = { id: b.id, displayName: b.display_name || b.username, collection: collections[j] };

      // See getSquadComplementaryPairs: this result is scoped to the
      // requesting viewer's granular priority permissions.
      const result = compare.compareCollectionsServer(userA, userB, catalogue);

      const s = result.summary;
      pairs.push({
        userAId: a.id,
        userAName: a.display_name || a.username,
        userAAvatar: a.avatar_url || "",
        userBId: b.id,
        userBName: b.display_name || b.username,
        userBAvatar: b.avatar_url || "",
        display: `${a.display_name || a.username} × ${b.display_name || b.username}`,
        coveredVariantCount: s.collectiveOwnedCount,
        totalVariantCount: s.catalogueVariantCount,
        coverageRate: s.collectiveCompletionRate,
        uniqueVariantCount: s.onlyUserACount + s.onlyUserBCount,
        duplicateVariantCount: s.bothOwnedCount,
        complementarityRate: s.complementarityRate,
        complementarityScore: s.complementarityScore
      });
    }
  }

  pairs.sort((a, b) => b.coverageRate - a.coverageRate || b.complementarityScore - a.complementarityScore);
  return pairs[0] || null;
}

async function getSquadBestTeams(squad, reqUser, teamSize, mode = "global", filterValue = null) {
  const size = Math.max(2, Math.min(4, parseInt(teamSize, 10) || 3));
  const validModes = new Set(["global", "mythic", "event", "duplicates", "complementarity"]);
  const rankingMode = validModes.has(mode) ? mode : "global";

  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const memberIds = membersRes.rows.map((r) => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const members = [];
  for (const u of usersRes.rows) {
    if (await canViewCollection(reqUser, u.id)) {
      const collection = await compare.loadServerCompareCollection(u.id);
      const owned = new Set();
      for (const [variantId, entry] of Object.entries(collection)) {
        if (compare.compareServerIsOwned(entry.status)) owned.add(variantId);
      }
      members.push({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarUrl: u.avatar_url || "",
        owned
      });
    }
  }

  if (members.length < size) return { teamSize: size, mode: rankingMode, teams: [] };

  const blockedPairs = new Set();
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (await isBlocked(members[i].id, members[j].id)) {
        blockedPairs.add(`${i}:${j}`);
        blockedPairs.add(`${j}:${i}`);
      }
    }
  }

  const total = catalogue.length;
  const rarityTotals = {};
  const eventTotals = {};
  for (const item of catalogue) {
    const r = item.rarity || "_none";
    const e = item.eventId || "_none";
    rarityTotals[r] = (rarityTotals[r] || 0) + 1;
    eventTotals[e] = (eventTotals[e] || 0) + 1;
  }

  const teams = [];

  function evaluate(indices) {
    const union = new Set();
    let totalOwned = 0;
    const variantOwnerCount = new Map();

    for (const idx of indices) {
      const owned = members[idx].owned;
      totalOwned += owned.size;
      for (const vid of owned) {
        union.add(vid);
        variantOwnerCount.set(vid, (variantOwnerCount.get(vid) || 0) + 1);
      }
    }

    let uniqueVariantCount = 0;
    let sharedVariantCount = 0;
    for (const count of variantOwnerCount.values()) {
      if (count === 1) uniqueVariantCount++;
      else sharedVariantCount++;
    }

    const coveredVariantCount = union.size;
    const coverageRate = total ? Math.round((coveredVariantCount / total) * 10000) / 100 : 0;
    const duplicatePossessionCount = totalOwned - coveredVariantCount;

    const coverageByRarity = {};
    const coverageByEvent = {};
    for (const item of catalogue) {
      if (!union.has(item.id)) continue;
      const rarity = item.rarity || "_none";
      const eventId = item.eventId || "_none";
      coverageByRarity[rarity] = (coverageByRarity[rarity] || 0) + 1;
      coverageByEvent[eventId] = (coverageByEvent[eventId] || 0) + 1;
    }

    const mythicTotal = rarityTotals["mythic"] || 0;
    const mythicCovered = coverageByRarity["mythic"] || 0;
    const mythicCoverageRate = mythicTotal ? Math.round((mythicCovered / mythicTotal) * 10000) / 100 : 0;

    const eventId = filterValue || "_none";
    const eventTotal = eventTotals[eventId] || 0;
    const eventCovered = coverageByEvent[eventId] || 0;
    const eventCoverageRate = eventTotal ? Math.round((eventCovered / eventTotal) * 10000) / 100 : 0;

    let pairCompSum = 0;
    let pairCount = 0;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const a = members[indices[i]].owned;
        const b = members[indices[j]].owned;
        const inter = new Set([...a].filter((x) => b.has(x))).size;
        const pairUnionSize = new Set([...a, ...b]).size;
        const uniqueInPair = pairUnionSize - inter;
        const rate = pairUnionSize ? Math.round((uniqueInPair / pairUnionSize) * 10000) / 100 : 0;
        pairCompSum += rate;
        pairCount++;
      }
    }
    const averageComplementarityRate = pairCount ? Math.round((pairCompSum / pairCount) * 100) / 100 : 0;

    teams.push({
      members: indices.map((idx) => ({
        userId: members[idx].id,
        username: members[idx].username,
        displayName: members[idx].displayName,
        avatarUrl: members[idx].avatarUrl
      })),
      coveredVariantCount,
      totalVariantCount: total,
      coverageRate,
      mythicCoverageRate,
      eventCoverageRate,
      uniqueVariantCount,
      sharedVariantCount,
      duplicatePossessionCount,
      averageComplementarityRate,
      coverageByRarity,
      coverageByEvent
    });
  }

  function generate(start, current) {
    if (current.length === size) {
      evaluate(current);
      return;
    }
    for (let i = start; i < members.length; i++) {
      let blocked = false;
      for (const idx of current) {
        if (blockedPairs.has(`${idx}:${i}`)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      current.push(i);
      generate(i + 1, current);
      current.pop();
    }
  }

  generate(0, []);

  switch (rankingMode) {
    case "mythic":
      teams.sort((a, b) => b.mythicCoverageRate - a.mythicCoverageRate || b.coverageRate - a.coverageRate);
      break;
    case "event":
      teams.sort((a, b) => b.eventCoverageRate - a.eventCoverageRate || b.coverageRate - a.coverageRate);
      break;
    case "duplicates":
      teams.sort((a, b) => a.duplicatePossessionCount - b.duplicatePossessionCount || b.coverageRate - a.coverageRate);
      break;
    case "complementarity":
      teams.sort(
        (a, b) => b.averageComplementarityRate - a.averageComplementarityRate || b.coverageRate - a.coverageRate
      );
      break;
    default:
      teams.sort(
        (a, b) =>
          b.coverageRate - a.coverageRate ||
          b.averageComplementarityRate - a.averageComplementarityRate ||
          b.uniqueVariantCount - a.uniqueVariantCount
      );
  }

  const ranked = teams.slice(0, 10).map((t, i) => ({ rank: i + 1, ...t }));
  return { teamSize: size, mode: rankingMode, filterValue, teams: ranked };
}

async function getSquadMinimumTeam(squad, reqUser, targetType, options = {}, method = "auto") {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const total = catalogue.length;
  const memberIds = membersRes.rows.map((r) => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const members = [];
  for (const u of usersRes.rows) {
    if (await canViewCollection(reqUser, u.id)) {
      const collection = await compare.loadServerCompareCollection(u.id);
      const owned = new Set();
      for (const [variantId, entry] of Object.entries(collection)) {
        if (compare.compareServerIsOwned(entry.status)) owned.add(variantId);
      }
      members.push({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarUrl: u.avatar_url || "",
        owned
      });
    }
  }

  let targetVariantIds = [];
  let minRequiredCount = 0;
  let targetLabel = "";

  if (targetType === "coverage") {
    const targetPercent = Math.max(1, Math.min(100, parseFloat(options.target) || 80));
    minRequiredCount = Math.ceil((total * targetPercent) / 100);
    targetVariantIds = catalogue.map((i) => i.id);
    targetLabel = `${targetPercent}% du catalogue`;
  } else if (targetType === "event") {
    if (!options.eventId) throw new Error("eventId requis");
    targetVariantIds = catalogue.filter((i) => i.eventId === options.eventId).map((i) => i.id);
    targetLabel = `toutes les variantes de l'événement ${options.eventId}`;
  } else if (targetType === "rarity") {
    const rarity = options.rarity || "mythic";
    targetVariantIds = catalogue.filter((i) => i.rarity === rarity).map((i) => i.id);
    targetLabel = `toutes les variantes ${rarity}`;
  } else if (targetType === "custom") {
    const ids = String(options.variantIds || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const validSet = new Set(catalogue.map((i) => i.id));
    targetVariantIds = ids.filter((id) => validSet.has(id));
    targetLabel = "liste personnalisée";
  } else {
    throw new Error("targetType invalide");
  }

  const targetSet = new Set(targetVariantIds);
  const targetTotal = targetSet.size;
  if (targetTotal === 0) return null;
  if (minRequiredCount === 0) minRequiredCount = targetTotal;

  const useGreedy =
    method === "greedy" ||
    (method === "auto" && members.length > 8) ||
    (method === "exhaustive" && members.length > 10);

  if (useGreedy) {
    const remaining = new Set(targetSet);
    const selected = [];
    const used = new Set();

    while (selected.length < members.length && remaining.size > targetTotal - minRequiredCount) {
      let bestIdx = -1;
      let bestNew = 0;

      for (let idx = 0; idx < members.length; idx++) {
        if (used.has(idx)) continue;
        let newCovered = 0;
        for (const vid of members[idx].owned) {
          if (remaining.has(vid)) newCovered++;
        }
        if (newCovered > bestNew) {
          bestNew = newCovered;
          bestIdx = idx;
        }
      }

      if (bestIdx === -1 || bestNew === 0) break;

      used.add(bestIdx);
      selected.push(bestIdx);
      for (const vid of members[bestIdx].owned) remaining.delete(vid);
    }

    const coveredTargetCount = targetTotal - remaining.size;
    const union = new Set();
    let totalOwned = 0;
    for (const idx of selected) {
      totalOwned += members[idx].owned.size;
      for (const vid of members[idx].owned) union.add(vid);
    }

    return {
      minPlayers: selected.length,
      calculationMethod: "greedy_approximation",
      targetType,
      targetLabel,
      targetTotal,
      minRequiredCount,
      coveredTargetCount,
      targetCoverageRate: targetTotal ? Math.round((coveredTargetCount / targetTotal) * 10000) / 100 : 0,
      globalCoveredVariantCount: union.size,
      globalTotalVariantCount: total,
      globalCoverageRate: total ? Math.round((union.size / total) * 10000) / 100 : 0,
      duplicatePossessionCount: totalOwned - union.size,
      members: selected.map((idx) => ({
        userId: members[idx].id,
        username: members[idx].username,
        displayName: members[idx].displayName,
        avatarUrl: members[idx].avatarUrl
      }))
    };
  }

  const maxK = members.length;
  for (let k = 1; k <= maxK; k++) {
    const current = [];
    function generate(start) {
      if (current.length === k) {
        evaluate([...current]);
        return;
      }
      for (let i = start; i < members.length; i++) {
        current.push(i);
        generate(i + 1);
        current.pop();
      }
    }

    let found = null;
    function evaluate(indices) {
      if (found) return;
      const union = new Set();
      for (const idx of indices) {
        for (const vid of members[idx].owned) union.add(vid);
      }

      let coveredTargetCount = 0;
      for (const vid of union) {
        if (targetSet.has(vid)) coveredTargetCount++;
      }

      if (coveredTargetCount >= minRequiredCount) {
        let totalOwned = 0;
        for (const idx of indices) totalOwned += members[idx].owned.size;

        found = {
          minPlayers: k,
          calculationMethod: "exhaustive",
          targetType,
          targetLabel,
          targetTotal,
          minRequiredCount,
          coveredTargetCount,
          targetCoverageRate: targetTotal ? Math.round((coveredTargetCount / targetTotal) * 10000) / 100 : 0,
          globalCoveredVariantCount: union.size,
          globalTotalVariantCount: total,
          globalCoverageRate: total ? Math.round((union.size / total) * 10000) / 100 : 0,
          duplicatePossessionCount: totalOwned - union.size,
          members: indices.map((idx) => ({
            userId: members[idx].id,
            username: members[idx].username,
            displayName: members[idx].displayName,
            avatarUrl: members[idx].avatarUrl
          }))
        };
      }
    }

    generate(0);
    if (found) return found;
  }

  return null;
}

module.exports = { getSquadBestPair, getSquadBestTeams, getSquadMinimumTeam };
