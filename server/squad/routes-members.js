const ctx = require("./context");
const { APP_URL, MAX_SQUAD_SIMULATION_CHANGES, MAX_SQUAD_SIMULATION_TEXT_LENGTH, MAX_SQUAD_SIMULATION_VARIANTS, MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH, MAX_USER_ID, QRCode, SQUAD_SIMULATION_TYPES, analytics, app, areFriends, canViewCollection, compare, computeCatalogueVersion, crypto, generateSquadCode, getCachedOrComputeSquadAnalysis, getRelationship, getRequestingUser, getSquadByIdOrCode, getViewerSafeSquadMembers, getVisibleSquadMemberIds, invalidateSquadAnalysisCache, isBlocked, isPlainObject, loadViewerSafeCollection, normalizeSimulationChange, normalizeSimulationChanges, normalizeSimulationMemberId, normalizeSimulationText, normalizeSimulationVariantIds, parsePositiveUserId, pool, redactCollectionPriorities, refreshSquadStats, requireNotSuspended, requireSquadMember, resolveAddressee, security, shareSquad, squadSimulationLimiter } = ctx;


app.get("/api/squads/:code", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, created_by, created_at, join_open, max_active_goals_per_member FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    if (!(await requireSquadMember(req, res, squadResult.rows[0].id))) return;
    const squad = squadResult.rows[0];
    const reqUser = await getRequestingUser(req);

    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, sm.role, sm.joined_at,
              u.collection_visibility, u.visibility
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1
         AND sm.status = 'active'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY sm.joined_at`,
      [squad.id]
    );

    const viewerMembers = await getViewerSafeSquadMembers(membersResult.rows, reqUser);
    const matrixMembers = viewerMembers.map(m => ({
      userId: m.userId,
      username: m.username || String(m.userId),
      visible: m.visible,
      prioritiesVisible: m.prioritiesVisible
    }));
    const members = [];
    for (const member of viewerMembers) {
      // Hide members who mutually blocked the requester in this squad context.
      if (reqUser && await isBlocked(reqUser, member.userId)) continue;
      const canSeeCollection = member.visible;

      // A member's old imported variant_id can be "__proto__"; keep it inert
      // while constructing the squad response.
      let collection = Object.create(null);
      let entryCount = 0;
      let lastUpdated = null;
      if (canSeeCollection) {
        const entriesResult = await pool.query(
          "SELECT variant_id, status, priority, updated_at FROM sprite_entries WHERE user_id = $1",
          [member.userId]
        );
        for (const row of entriesResult.rows) {
          collection[row.variant_id] = {
            status: row.status,
            priority: member.prioritiesVisible ? (row.priority || "none") : "none"
          };
          if (row.updated_at && (!lastUpdated || row.updated_at > lastUpdated)) {
            lastUpdated = row.updated_at;
          }
        }
        entryCount = entriesResult.rows.length;
      }

      const { friendshipStatus, canReceiveFriendRequest, friendRequestDirection } = await getMemberFriendshipStatus(reqUser, member.userId);
      members.push({
        userId: member.userId,
        username: member.username,
        avatarUrl: member.avatar_url || "",
        role: member.role || (String(member.userId) === String(squad.created_by) ? "owner" : "member"),
        joinedAt: member.joined_at,
        collection,
        entryCount,
        lastUpdated,
        friendshipStatus,
        canReceiveFriendRequest,
        friendRequestDirection
      });
    }

    const [recommendationsList, matrix] = await Promise.all([
      // Preserve granular priority visibility in aggregate recommendation
      // scores/counts as well as in the matrix returned to this viewer.
      compare.getSquadRecommendations(matrixMembers),
      compare.buildSquadCollectionMatrix(matrixMembers)
    ]);

    const completion = compare.getSquadCollectiveCompletion(matrix, squad.name);
    const averageOwnership = compare.getSquadAverageOwnership(matrix, squad.name);
    const mostComplementaryMember = compare.getSquadMostComplementaryMember(matrix, squad.name);
    const uniqueOwners = compare.getSquadUniqueOwners(matrix);
    const uniqueCountByUser = new Map(uniqueOwners.byMember.map(m => [String(m.userId), m.count]));
    for (const m of members) {
      m.uniqueVariantCount = uniqueCountByUser.get(String(m.userId)) || 0;
    }
    const mapRecommendation = (r) => ({
      variantId: r.variantId,
      spriteId: r.spriteId,
      spriteName: r.spriteName,
      variantName: r.variantName,
      img: r.img,
      availability: r.availability,
      availabilityStatus: r.availabilityStatus,
      ownedByCount: r.ownedByCount,
      wantedByCount: r.wantedByCount
    });

    const recommendations = (recommendationsList.immediate || []).map(mapRecommendation);
    const watchListRecommendations = (recommendationsList.watchList || []).map(mapRecommendation);

    res.json({
      id: squad.id,
      code: squad.code,
      name: squad.name,
      createdBy: squad.created_by,
      createdAt: squad.created_at,
      joinOpen: squad.join_open !== false,
      maxActiveGoalsPerMember: squad.max_active_goals_per_member,
      members,
      collectiveCompletionRate: completion.collectiveCompletionRate,
      coveredVariantCount: completion.coveredVariantCount,
      totalVariantCount: completion.totalVariantCount,
      collectiveCompletionDisplay: completion.display,
      averageOwnershipRate: averageOwnership.averageOwnershipRate,
      ownedVariantsSum: averageOwnership.ownedVariantsSum,
      averageVariantCount: averageOwnership.averageVariantCount,
      averageOwnershipDisplay: averageOwnership.display,
      mostComplementaryMember,
      uniqueVariantTotal: uniqueOwners.totalUnique,
      recommendations,
      watchListRecommendations,
      immediateRecommendationCount: recommendationsList.immediateCount || 0,
      watchListRecommendationCount: recommendationsList.watchListCount || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : leave ──
app.post("/api/squads/:code/leave", requireNotSuspended, async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });

    await pool.query(
      `UPDATE squad_members
       SET status = 'left', left_at = NOW()
       WHERE squad_id = $1 AND user_id = $2 AND status = 'active'`,
      [squadResult.rows[0].id, userId]
    );
    invalidateSquadAnalysisCache(squadResult.rows[0].id);

    // Étape 58 — stop future squad progress notifs; cancel scheduled; revoke destinations.
    try {
      const squadCompletion = require("./notification-squad-completion");
      await squadCompletion.applySquadLeaveNotificationCleanup(
        pool, squadResult.rows[0].id, userId
      );
    } catch (err) {
      console.error("[leave] notification cleanup failed", err);
    }

    try {
      await refreshSquadStats(squadResult.rows[0].id);
    } catch (err) {
      console.error("[leave] refresh stats failed", err);
    }

    require("./passport-summary").schedulePassportRecalc(userId, {
      mode: "queue",
      reason: "squad.left",
      triggerEvent: "squad.member_joined",
      notify: false
    }).catch(() => {});

    const remaining = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squadResult.rows[0].id]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query("DELETE FROM squads WHERE id = $1", [squadResult.rows[0].id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : kick member (creator only) ──
app.post("/api/squads/:code/kick", requireNotSuspended, async (req, res) => {
  // SECURITY FIX: this was previously calling getRequestingUser() without
  // `await`, so reqUser held a pending Promise (always truthy) and every
  // String(reqUser) comparison against created_by failed — the route was
  // unusable for legitimate owners and, more importantly, was never actually
  // enforcing the ownership check it appeared to have.
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const targetUserId = parsePositiveUserId(req.body?.targetUserId);
  if (targetUserId === null) return res.status(400).json({ error: "targetUserId invalide" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut retirer un membre" });
    }
    if (String(targetUserId) === String(reqUser)) {
      return res.status(400).json({ error: "Utilisez la route leave pour vous retirer" });
    }
    if (String(targetUserId) === String(squad.created_by)) {
      return res.status(403).json({ error: "Le créateur ne peut pas être retiré" });
    }
    await pool.query(
      `UPDATE squad_members
       SET status = 'removed', left_at = NOW()
       WHERE squad_id = $1 AND user_id = $2 AND status = 'active'`,
      [squad.id, targetUserId]
    );
    invalidateSquadAnalysisCache(squad.id);

    // Étape 58 — same cleanup as leave for the removed member.
    try {
      const squadCompletion = require("./notification-squad-completion");
      await squadCompletion.applySquadLeaveNotificationCleanup(
        pool, squad.id, targetUserId
      );
    } catch (err) {
      console.error("[kick] notification cleanup failed", err);
    }

    try {
      await refreshSquadStats(squad.id);
    } catch (err) {
      console.error("[kick] refresh stats failed", err);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : regenerate code (creator only) ──
app.post("/api/squads/:code/regenerate", security.squadCodeLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut régénérer le code" });
    }
    const newCode = generateSquadCode();
    await pool.query("UPDATE squads SET code = $1 WHERE id = $2", [newCode, squad.id]);
    res.json({ ok: true, code: newCode });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Collision de code, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : toggle join open/closed (creator only) ──
app.post("/api/squads/:code/toggle-join", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by, join_open FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut modifier l'accès" });
    }
    const newState = squad.join_open === false ? true : false;
    await pool.query("UPDATE squads SET join_open = $1 WHERE id = $2", [newState, squad.id]);
    res.json({ ok: true, joinOpen: newState });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : update settings (creator only) ──
app.post("/api/squads/:code/settings", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const { maxActiveGoalsPerMember } = req.body || {};
    const squadResult = await pool.query(
      "SELECT id, created_by, max_active_goals_per_member FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut modifier les paramètres" });
    }

    if (maxActiveGoalsPerMember === undefined || maxActiveGoalsPerMember === null || maxActiveGoalsPerMember === "") {
      return res.status(400).json({ error: "maxActiveGoalsPerMember requis" });
    }

    const parsed = parseInt(maxActiveGoalsPerMember, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 20) {
      return res.status(400).json({ error: "maxActiveGoalsPerMember doit être entre 1 et 20" });
    }

    await pool.query("UPDATE squads SET max_active_goals_per_member = $1 WHERE id = $2", [parsed, squad.id]);
    invalidateSquadAnalysisCache(squad.id);
    res.json({ ok: true, maxActiveGoalsPerMember: parsed });
  } catch (err) {
    console.error("[/api/squads/:code/settings]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : invite an accepted friend into the active squad ──
// This does NOT create a friendship; it only adds the friend as a member.
app.post("/api/squads/:code/invite/:friendId", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const friendId = Number(req.params.friendId);
  if (!friendId || isNaN(friendId)) {
    return res.status(400).json({ error: "Identifiant invalide" });
  }
  if (String(reqUser) === String(friendId)) {
    return res.status(400).json({ error: "Tu ne peux pas t'inviter toi-même" });
  }

  try {
    const squadResult = await pool.query(
      "SELECT id, created_by, join_open FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    if (await isBlocked(reqUser, friendId)) {
      return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });
    }

    const targetRes = await pool.query(
      "SELECT squad_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())",
      [friendId]
    );
    if (!targetRes.rows.length) {
      return res.status(403).json({ error: "Cet utilisateur ne peut pas être invité" });
    }

    if (!(await areFriends(reqUser, friendId))) {
      return res.status(403).json({ error: "Seuls les amis peuvent être invités dans une escouade" });
    }

    const squadInvitesFrom = targetRes.rows[0].squad_invites_from || "friends";
    if (squadInvitesFrom === "nobody") {
      return res.status(403).json({ error: "Cet utilisateur n'accepte pas les invitations d'escouade" });
    }
    if (squadInvitesFrom === "mutual_squad_members" && !(await shareSquad(reqUser, friendId))) {
      return res.status(403).json({ error: "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune" });
    }

    const alreadyMember = await pool.query(
      "SELECT status FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squad.id, friendId]
    );
    if (alreadyMember.rows.length && alreadyMember.rows[0].status === 'active') {
      return res.status(409).json({ error: "Cet utilisateur est déjà membre de l'escouade" });
    }

    const membership = await pool.query(
      "SELECT role FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
      [squad.id, reqUser]
    );
    if (!membership.rows.length) {
      return res.status(403).json({ error: "Vous n'êtes pas membre actif de cette escouade" });
    }
    const role = membership.rows[0].role;
    const canInvite = role === "owner" || role === "admin" || (role === "member" && squad.join_open !== false);
    if (!canInvite) {
      return res.status(403).json({ error: "Votre rôle ne permet pas d'inviter dans cette escouade" });
    }

    const memberCount = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squad.id]
    );
    if (parseInt(memberCount.rows[0].count) >= 10) {
      return res.status(400).json({ error: "Escouade pleine (max 10)" });
    }

    const existingPending = await pool.query(
      `SELECT id FROM squad_invitations
       WHERE squad_id = $1 AND invitee_id = $2 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [squad.id, friendId]
    );
    if (existingPending.rows.length) {
      return res.status(409).json({ error: "Une invitation est déjà en attente" });
    }

    const invitationResult = await pool.query(
      `INSERT INTO squad_invitations (squad_id, inviter_id, invitee_id, status, expires_at)
       VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '7 days')
       RETURNING id`,
      [squad.id, reqUser, friendId]
    );
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "friend_invited_to_squad", details: { friendId, source: "member_profile" } });
    res.json({ ok: true, invitationId: invitationResult.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : list squads invitable for a friend ──
// Returns the squads where the current user has invite rights, the friend is not already an active member,
// the squad is not full, and the friend accepts squad invitations.
