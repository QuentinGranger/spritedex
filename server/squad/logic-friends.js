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

async function getSquadRecommendedFriends(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id, role FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);

  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const itemMap = new Map(catalogue.map((i) => [i.id, i]));
  const total = catalogue.length;

  const viewerMembers = await getViewerSafeSquadMembers(membersRes.rows, reqUser);
  const memberIds = viewerMembers.map((r) => r.userId);
  const reqUserMembership = viewerMembers.find((r) => String(r.userId) === String(reqUser));
  if (!reqUserMembership) return [];

  const canInviteAnyone =
    reqUserMembership.role === "owner" ||
    reqUserMembership.role === "admin" ||
    (reqUserMembership.role === "member" && squad.join_open !== false);

  const memberCollections = await Promise.all(
    viewerMembers.filter((member) => member.visible).map(loadViewerSafeCollection)
  );
  const currentOwned = new Set();
  for (const c of memberCollections) {
    for (const item of catalogue) {
      if (compare.compareServerClassify(c[item.id] || compare.compareServerDefaultEntry()) === "owned")
        currentOwned.add(item.id);
    }
  }
  const squadMissingCount = total - currentOwned.size;

  const friendsRes = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.squad_invites_from
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted'
       AND (f.requester_id = $1 OR f.addressee_id = $1)
       AND u.deleted_at IS NULL
       AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
    [reqUser]
  );

  const candidates = [];
  for (const row of friendsRes.rows) {
    if (String(row.id) === String(reqUser)) continue;
    if (memberIds.some((m) => String(m) === String(row.id))) continue;
    if (await isBlocked(reqUser, row.id)) continue;
    if (!(await canViewCollection(reqUser, row.id))) continue;
    const prioritiesVisible = await canViewCollection(reqUser, row.id, { visibilityKey: "priorities" });

    const invitePref = row.squad_invites_from || "friends";
    let canReceiveInvite = false;
    if (invitePref === "everyone") canReceiveInvite = true;
    else if (invitePref === "friends")
      canReceiveInvite = true; // friend of reqUser by query
    else if (invitePref === "mutual_squad_members") canReceiveInvite = await shareSquad(reqUser, row.id);
    else if (invitePref === "nobody") canReceiveInvite = false;
    if (!canReceiveInvite) continue;

    const cCollection = await loadViewerSafeCollection({
      userId: row.id,
      visible: true,
      prioritiesVisible
    });
    const cOwned = new Set();
    const cPriority = new Set();
    for (const item of catalogue) {
      const entry = cCollection[item.id] || compare.compareServerDefaultEntry();
      const cls = compare.compareServerClassify(entry);
      if (cls === "owned") cOwned.add(item.id);
      else if (compare.compareServerIsPriority(entry)) cPriority.add(item.id);
    }

    const newVariants = [];
    const mythicNewVariants = [];
    for (const vid of cOwned) {
      if (currentOwned.has(vid)) continue;
      newVariants.push(vid);
      const item = itemMap.get(vid);
      if (item && (item.rarity || "").toLowerCase() === "mythic") mythicNewVariants.push(vid);
    }

    const inter = new Set([...cOwned].filter((v) => currentOwned.has(v))).size;
    const collectiveOwned = currentOwned.size + cOwned.size - inter;
    const onlyOne = collectiveOwned - inter;
    const complementarityRate = collectiveOwned ? Math.round((onlyOne / collectiveOwned) * 10000) / 100 : 0;

    const records = catalogue.map((item) => ({
      ...item,
      userA: { status: currentOwned.has(item.id) ? "owned" : "missing", priority: "none", note: "" },
      userB: {
        status: cOwned.has(item.id) ? "owned" : cPriority.has(item.id) ? "priority" : "missing",
        priority: cPriority.has(item.id) ? "high" : "none",
        note: ""
      }
    }));
    const complementarityScore = compare.computeComplementarityScore(complementarityRate, records);

    const coverageGain = total ? Math.round((newVariants.length / total) * 10000) / 100 : 0;
    const currentSquadCoverageCount = currentOwned.size;
    const potentialCoverageCount = currentSquadCoverageCount + newVariants.length;
    const currentCompletionRate = total ? Math.round((currentSquadCoverageCount / total) * 10000) / 100 : 0;
    const projectedCompletionRate = total ? Math.round((potentialCoverageCount / total) * 10000) / 100 : 0;

    candidates.push({
      userId: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url || "",
      newVariantsForSquad: newVariants.length,
      mythicNewVariants: mythicNewVariants.length,
      currentSquadCoverageCount,
      potentialCoverageCount,
      potentialContribution: newVariants.length,
      complementarityRate,
      complementarityScore,
      coverageGain,
      currentCompletionRate,
      projectedCompletionRate,
      canInvite: canInviteAnyone && canReceiveInvite
    });
  }

  candidates.sort((a, b) => b.newVariantsForSquad - a.newVariantsForSquad);
  return candidates.slice(0, 20);
}

// ── Squad : recommended friends to invite based on collection complementarity ──
app.get("/api/squads/:code/recommended-friends", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name, join_open FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "recommended-friends", async () => {
      const candidates = await getSquadRecommendedFriends(squad, reqUser);
      return { squadCode: squad.code, squadName: squad.name, candidates };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/recommended-friends]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function getSquadComplementaryPairs(squad, reqUser) {
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

  const memberCollections = await Promise.all(allowed.map(loadViewerSafeCollection));

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
      const userA = { id: a.id, displayName: a.display_name || a.username, collection: memberCollections[i] };
      const userB = { id: b.id, displayName: b.display_name || b.username, collection: memberCollections[j] };

      // This is viewer-specific: each collection may have had its priorities
      // redacted above.  Do not reuse the generic raw comparison cache here.
      const result = compare.compareCollectionsServer(userA, userB, catalogue);

      pairs.push({
        userAId: a.id,
        userAName: a.display_name || a.username,
        userAAvatar: a.avatar_url || "",
        userBId: b.id,
        userBName: b.display_name || b.username,
        userBAvatar: b.avatar_url || "",
        display: `${a.display_name || a.username} × ${b.display_name || b.username}`,
        complementarityRate: result.summary.complementarityRate,
        complementarityScore: result.summary.complementarityScore,
        combinedCoverageRate: result.summary.collectiveCompletionRate,
        combinedCoverageCount: result.summary.collectiveOwnedCount,
        totalVariantCount: result.summary.catalogueVariantCount
      });
    }
  }

  pairs.sort((a, b) => b.complementarityScore - a.complementarityScore);
  return pairs.slice(0, 15);
}

module.exports = { getSquadRecommendedFriends, getSquadComplementaryPairs };
