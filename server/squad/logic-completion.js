const ctx = require("./context");
const { APP_URL, MAX_SQUAD_SIMULATION_CHANGES, MAX_SQUAD_SIMULATION_TEXT_LENGTH, MAX_SQUAD_SIMULATION_VARIANTS, MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH, MAX_USER_ID, QRCode, SQUAD_SIMULATION_TYPES, analytics, app, areFriends, canViewCollection, compare, computeCatalogueVersion, crypto, generateSquadCode, getCachedOrComputeSquadAnalysis, getRelationship, getRequestingUser, getSquadByIdOrCode, getViewerSafeSquadMembers, getVisibleSquadMemberIds, invalidateSquadAnalysisCache, isBlocked, isPlainObject, loadViewerSafeCollection, normalizeSimulationChange, normalizeSimulationChanges, normalizeSimulationMemberId, normalizeSimulationText, normalizeSimulationVariantIds, parsePositiveUserId, pool, redactCollectionPriorities, refreshSquadStats, requireNotSuspended, requireSquadMember, resolveAddressee, security, shareSquad, squadSimulationLimiter } = ctx;
const friends = require("./logic-friends");
const teams = require("./logic-teams");
const { getSquadComplementaryPairs } = friends;
const { getSquadBestTeams } = teams;

async function getSquadRecommendedGoals(squad, reqUser) {
  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);

  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const matrix = await compare.buildSquadCollectionMatrix(members, catalogueAll);
  if (matrix.length === 0) return { goals: [] };

  const visibleMembers = members.filter(m => m.visible);

  const totalVariants = matrix.length;
  const coveredVariants = matrix.filter(r => r.ownerCount > 0).length;
  const completionRate = totalVariants ? Math.round((coveredVariants / totalVariants) * 10000) / 100 : 0;

  const priorities = compare.getSquadAcquisitionPriority(matrix);
  const assignments = await compare.getSquadAcquisitionAssignments(matrix, priorities);

  const goals = [];

  // 1. Completion milestone goal
  const nextMilestone = Math.min(100, Math.ceil((completionRate + 0.01) / 5) * 5);
  if (nextMilestone > completionRate) {
    const targetCovered = Math.ceil((nextMilestone / 100) * totalVariants);
    const missingForMilestone = Math.max(0, targetCovered - coveredVariants);
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    goals.push({
      type: "completion_milestone",
      title: `Atteindre ${nextMilestone} % de complétion collective cette semaine`,
      target: { kind: "completion_rate", value: nextMilestone, missingVariants: missingForMilestone },
      participants: visibleMembers.map(m => ({ userId: m.userId, username: m.username })),
      deadline,
      currentProgress: completionRate,
      reason: `La squad est actuellement à ${completionRate} % de complétion. ${missingForMilestone} variante${missingForMilestone > 1 ? 's' : ''} supplémentaire${missingForMilestone > 1 ? 's' : ''} atteindraient l'objectif.`,
      expectedCollectiveGain: missingForMilestone
    });
  }

  // 2. Event-based goals
  const eventsResult = await pool.query(
    `SELECT id, name, end_date FROM events
     WHERE end_date IS NULL OR end_date > NOW() - INTERVAL '1 day'
     ORDER BY end_date NULLS LAST`
  );
  const eventGoals = [];
  for (const event of eventsResult.rows) {
    const eventVariants = matrix.filter(r => r.eventId === event.id);
    if (eventVariants.length === 0) continue;
    const missing = eventVariants.filter(r => r.ownerCount === 0 && r.unknownCount === 0);
    if (missing.length === 0) continue;
    const covered = eventVariants.filter(r => r.ownerCount > 0).length;
    const urgency = compare.classifyEventUrgency(event.end_date);
    const displayNames = missing.slice(0, 5).map(r => `${r.spriteName} ${r.variantName}`).join(", ");
    const suffix = missing.length > 5 ? ` et ${missing.length - 5} autres` : "";
    eventGoals.push({
      type: "event_variants",
      title: `Obtenir ${missing.length} variante${missing.length > 1 ? 's' : ''} encore manquante${missing.length > 1 ? 's' : ''} avant la fin de ${event.name}`,
      target: { kind: "event_variants", eventId: event.id, eventName: event.name, variantIds: missing.map(r => r.variantId), names: displayNames + suffix },
      participants: visibleMembers.map(m => ({ userId: m.userId, username: m.username })),
      deadline: event.end_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      currentProgress: eventVariants.length ? Math.round((covered / eventVariants.length) * 10000) / 100 : 0,
      urgency,
      reason: `L'événement ${event.name} est classé "${urgency.level}"${urgency.daysRemaining !== null ? ` et se termine dans ${urgency.daysRemaining} jour(s)` : ""}.`,
      expectedCollectiveGain: missing.length
    });
  }
  const levelOrder = { ending_today: 0, urgent: 1, soon: 2, normal: 3, unknown: 4, ended: 5 };
  eventGoals.sort((a, b) => (levelOrder[a.urgency.level] ?? 4) - (levelOrder[b.urgency.level] ?? 4) || b.expectedCollectiveGain - a.expectedCollectiveGain);
  goals.push(...eventGoals.slice(0, 3));

  // 3. Rarity goals for currently available variants missing from the squad
  const byRarity = new Map();
  for (const row of matrix) {
    if (row.ownerCount === 0 && row.unknownCount === 0 && compare.classifyRecommendationAvailability(row.availabilityStatus) === "available_now") {
      const rarity = row.rarity || "_none";
      if (!byRarity.has(rarity)) byRarity.set(rarity, []);
      byRarity.get(rarity).push(row);
    }
  }
  for (const [rarity, rows] of byRarity) {
    if (!rows.length) continue;
    const totalRarity = matrix.filter(r => (r.rarity || "_none") === rarity).length;
    const coveredRarity = matrix.filter(r => (r.rarity || "_none") === rarity && r.ownerCount > 0).length;
    const ends = rows.map(r => r.endDate).filter(Boolean).sort();
    const deadline = ends.length ? ends[0] : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const names = rows.slice(0, 5).map(r => `${r.spriteName} ${r.variantName}`).join(", ");
    const suffix = rows.length > 5 ? ` et ${rows.length - 5} autres` : "";
    goals.push({
      type: "rarity_completion",
      title: `Compléter toutes les variantes ${rarity} actuellement disponibles`,
      target: { kind: "rarity", rarity, variantIds: rows.map(r => r.variantId), names: names + suffix },
      participants: visibleMembers.map(m => ({ userId: m.userId, username: m.username })),
      deadline,
      currentProgress: totalRarity ? Math.round((coveredRarity / totalRarity) * 10000) / 100 : 0,
      reason: `${rows.length} variante${rows.length > 1 ? 's' : ''} ${rarity} disponible${rows.length > 1 ? 's' : ''} ne sont pas encore dans la collection collective.`,
      expectedCollectiveGain: rows.length
    });
  }

  // 4. Distributed assignment among top complementary members
  const topAssignments = assignments.filter(a => a.impactType === "collective" && a.responsible).slice(0, 5);
  if (topAssignments.length >= 1) {
    const variantIds = topAssignments.map(a => a.variantId);
    const names = topAssignments.slice(0, 5).map(a => `${a.spriteName} ${a.variantName}`).join(", ");
    const suffix = topAssignments.length > 5 ? ` et ${topAssignments.length - 5} autres` : "";
    const participants = [...new Map(topAssignments.map(a => [a.responsible.userId, a.responsible])).values()];
    const ends = topAssignments.map(a => a.endDate).filter(Boolean).sort();
    const deadline = ends.length ? ends[0] : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    goals.push({
      type: "distributed_assignment",
      title: `Répartir ${topAssignments.length} variantes manquantes entre ${participants.map(p => p.username).join(", ")}`,
      target: { kind: "variants_assignment", variantIds, names: names + suffix },
      participants,
      deadline,
      currentProgress: 0,
      reason: "Ces variantes sont manquantes de toute la squad et les membres sélectionnés sont les mieux placés pour les obtenir.",
      expectedCollectiveGain: topAssignments.length
    });
  }

  return { goals };
}

async function buildSquadCompletionMembers(squad, reqUser) {
  const membersRes = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  return getViewerSafeSquadMembers(membersRes.rows, reqUser);
}

async function getSquadCompletionScope(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);

  const allVariantCount = catalogueAll.length;
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);

  const totalActiveMembers = [];
  const includedMembers = [];
  let excludedPrivateCollections = 0;
  let excludedInsufficientCollections = 0;

  const MIN_EXPLICIT_ENTRIES = 0;

  const viewerMembers = await getViewerSafeSquadMembers(membersRes.rows, reqUser);
  for (const member of viewerMembers) {
    const memberId = member.userId;
    totalActiveMembers.push(memberId);

    if (!member.visible) {
      excludedPrivateCollections++;
      continue;
    }

    if (MIN_EXPLICIT_ENTRIES > 0) {
      const collection = await compare.loadServerCompareCollection(memberId);
      const explicitCount = compare.countServerExplicitCollectionEntries(collection);
      if (explicitCount < MIN_EXPLICIT_ENTRIES) {
        excludedInsufficientCollections++;
        continue;
      }
    }

    includedMembers.push(memberId);
  }

  const includedIds = new Set(includedMembers.map(id => String(id)));
  const membersForMatrix = viewerMembers.map(member => ({
    userId: member.userId,
    username: member.username || String(member.userId),
    visible: includedIds.has(String(member.userId)),
    prioritiesVisible: member.prioritiesVisible
  }));
  const matrix = await compare.buildSquadCollectionMatrix(membersForMatrix, activeCatalogue);
  const completion = compare.getSquadCollectiveCompletion(matrix, squad.name);
  const averageOwnership = compare.getSquadAverageOwnership(matrix, squad.name);

  return {
    squadCode: squad.code,
    squadName: squad.name,
    catalogueVariantCount: activeCatalogue.length,
    totalActiveMembers: totalActiveMembers.length,
    activeMemberCount: totalActiveMembers.length,
    includedMemberCount: includedMembers.length,
    excludedUnreleasedVariants: allVariantCount - activeCatalogue.length,
    excludedPrivateCollections,
    excludedInsufficientCollections,
    ...completion,
    collectiveCompletionDisplay: completion.display,
    averageOwnershipRate: averageOwnership.averageOwnershipRate,
    ownedVariantsSum: averageOwnership.ownedVariantsSum,
    averageVariantCount: averageOwnership.averageVariantCount,
    averageOwnershipDisplay: averageOwnership.display
  };
}

async function getSquadVersionedCompletionReport(squad, reqUser) {
  const [catalogueAll, members] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    buildSquadCompletionMembers(squad, reqUser)
  ]);
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const matrix = await compare.buildSquadCollectionMatrix(members, activeCatalogue);

  const includedMembers = members.filter(m => m.visible);
  const excludedPrivateCollections = members.length - includedMembers.length;

  const completion = compare.getSquadCollectiveCompletion(matrix, squad.name);
  const averageOwnership = compare.getSquadAverageOwnership(matrix, squad.name);
  const missing = compare.getSquadMissingVariants(matrix, squad.name);
  const uniqueOwners = compare.getSquadUniqueOwners(matrix);
  const shared = compare.getSquadSharedVariants(matrix);
  const mostComplementary = compare.getSquadMostComplementaryMember(matrix, squad.name);
  const pairs = await getSquadComplementaryPairs(squad, reqUser);
  const bestPair = pairs[0] || null;

  const recommendedGoals = await getSquadRecommendedGoals(squad, reqUser);
  const bestTeam = await getSquadBestTeams(squad, reqUser, 3, "global");

  const memberIds = members.map(m => m.userId);
  const [goalsResult, memberGoalsResult, lastActiveResult] = await Promise.all([
    pool.query("SELECT variant_id, user_id FROM collection_goals WHERE squad_id = $1 AND status = 'active' AND variant_id IS NOT NULL", [squad.id]),
    pool.query("SELECT user_id, COUNT(*) AS cnt FROM collection_goals WHERE user_id = ANY($1) AND status = 'active' GROUP BY user_id", [memberIds]),
    pool.query("SELECT user_id, MAX(updated_at) AS last_active FROM sprite_entries WHERE user_id = ANY($1) GROUP BY user_id", [memberIds])
  ]);
  const activeGoalVariantIds = new Set(goalsResult.rows.map(r => r.variant_id).filter(Boolean));
  const activeGoalVariantCounts = new Map();
  const memberGoalVariantSet = new Set();
  for (const r of goalsResult.rows) {
    if (!r.variant_id) continue;
    const key = `${r.user_id}:${r.variant_id}`;
    memberGoalVariantSet.add(key);
    activeGoalVariantCounts.set(r.variant_id, (activeGoalVariantCounts.get(r.variant_id) || 0) + 1);
  }
  const activeGoalCounts = new Map(memberGoalsResult.rows.map(r => [String(r.user_id), parseInt(r.cnt, 10)]));
  const lastActiveByUser = new Map(lastActiveResult.rows.map(r => [String(r.user_id), r.last_active]));
  const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
  const priorityIds = new Set(priorities.map(p => p.variantId).filter(Boolean));
  const assignments = await compare.getSquadAcquisitionAssignments(matrix, priorities, activeGoalCounts, lastActiveByUser, {
    excludedSeasonIds: new Set(),
    activeGoalVariantCounts,
    memberGoalVariantSet,
    maxGoalAssignments: 2
  });
  const plan = compare.getSquadCollectivePlan(matrix, assignments);

  const allVariants = matrix.map(r => ({
    variantId: r.variantId,
    spriteId: r.spriteId,
    spriteName: r.spriteName,
    variantName: r.variantName,
    variantType: r.variantType,
    img: r.img,
    rarity: r.rarity,
    seasonId: r.seasonId,
    eventId: r.eventId,
    availabilityStatus: r.availabilityStatus,
    ownerCount: r.ownerCount,
    missingCount: r.missingCount,
    unknownCount: r.unknownCount,
    isMissingAll: r.ownerCount === 0 && r.unknownCount === 0,
    isUniqueOwner: r.ownerCount === 1,
    isDuplicate: r.ownerCount >= 2,
    isPriority: priorityIds.has(r.variantId),
    isAvailableNow: r.availabilityStatus === "available"
  }));

  const unknownCount = matrix.reduce((sum, r) => sum + r.unknownCount, 0);
  const warnings = [];
  if (members.length === 0) warnings.push("Aucun membre actif dans l'escouade.");
  if (activeCatalogue.length === 0) warnings.push("Aucune variante active dans le catalogue.");
  if (excludedPrivateCollections > 0) {
    const plural = excludedPrivateCollections > 1;
    warnings.push(`Les calculs utilisent ${includedMembers.length} collection${includedMembers.length > 1 ? 's' : ''} sur ${members.length}. ${excludedPrivateCollections} collection${plural ? 's' : ''} privée${plural ? 's' : ''} ${plural ? 'sont' : 'est'} exclue${plural ? 's' : ''} pour confidentialité.`);
  }
  if (unknownCount > activeCatalogue.length * 0.25) warnings.push("Plus de 25 % des collections sont inconnues, les statistiques peuvent être sous-estimées.");

  return {
    engineVersion: "2.0.0",
    generatedAt: new Date().toISOString(),
    squadId: squad.code,
    catalogueVersion: computeCatalogueVersion(catalogueAll),
    summary: {
      squadCode: squad.code,
      squadName: squad.name,
      catalogueVariantCount: activeCatalogue.length,
      totalActiveMembers: members.length,
      includedMemberCount: includedMembers.length,
      excludedPrivateCollections,
      collectiveCompletionRate: completion.collectiveCompletionRate,
      coveredVariantCount: completion.coveredVariantCount,
      averageOwnershipRate: averageOwnership.averageOwnershipRate,
      totalMissing: missing.totalMissing,
      totalUnique: uniqueOwners.totalUnique,
      totalShared: shared.totalShared
    },
    analysis: {
      completion,
      averageOwnership,
      missing,
      uniqueOwners,
      shared,
      mostComplementaryMember: mostComplementary,
      bestPair,
      allVariants
    },
    recommendations: {
      activeGoalCount: activeGoalVariantIds.size,
      priorities,
      assignments,
      plan,
      recommendedGoals: recommendedGoals.goals
    },
    optimization: {
      bestTeam,
      bestTeamSummary: bestTeam.teams.length
        ? `Meilleure équipe de ${bestTeam.teamSize} : ${bestTeam.teams[0].coverageRate}% de couverture.`
        : "Aucune équipe trouvée."
    },
    warnings
  };
}

// ── Squad : complementary member pairs ──

module.exports = { getSquadRecommendedGoals, buildSquadCompletionMembers, getSquadCompletionScope, getSquadVersionedCompletionReport };
