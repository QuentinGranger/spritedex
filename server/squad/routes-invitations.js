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

app.get("/api/squads/invitable", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const friendId = Number(req.query.friendId);
  if (!friendId || isNaN(friendId)) {
    return res.status(400).json({ error: "friendId invalide" });
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.code, s.name, s.join_open, sm.role,
              COALESCE(u.squad_invites_from, 'friends') AS squad_invites_from,
              (SELECT COUNT(*) FROM squad_members m WHERE m.squad_id = s.id AND m.status = 'active') AS member_count
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id
       JOIN users u ON u.id = $2
       WHERE sm.user_id = $1
         AND sm.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM squad_members m2
           WHERE m2.squad_id = s.id AND m2.user_id = $2 AND m2.status = 'active'
         )
         AND NOT EXISTS (
           SELECT 1 FROM squad_invitations si
           WHERE si.squad_id = s.id AND si.invitee_id = $2 AND si.status = 'pending'
             AND (si.expires_at IS NULL OR si.expires_at > NOW())
         )
         AND (
           sm.role IN ('owner', 'admin')
           OR (sm.role = 'member' AND s.join_open = TRUE)
         )`,
      [reqUser, friendId]
    );

    const rows = [];
    for (const row of result.rows) {
      if (parseInt(row.member_count) >= 10) continue;
      const invitePref = row.squad_invites_from || "friends";
      if (invitePref === "nobody") continue;
      if (invitePref === "mutual_squad_members" && !(await shareSquad(reqUser, friendId))) continue;
      if (invitePref === "friends" && !(await areFriends(reqUser, friendId))) continue;
      rows.push({
        id: row.id,
        code: row.code,
        name: row.name,
        joinOpen: row.join_open !== false,
        role: row.role
      });
    }

    res.json({ squads: rows });
  } catch (err) {
    console.error("[/api/squads/invitable]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : invite a friend by squad id (body inviteeId) ──
app.post("/api/squads/:squadId/invitations", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const resolved = await resolveAddressee(reqUser, req.body?.inviteeId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const friendId = resolved.friendId;

  if (await isBlocked(reqUser, friendId)) {
    return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });
  }

  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];

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

    if (!(await areFriends(reqUser, friendId))) {
      return res.status(403).json({ error: "Seuls les amis peuvent être invités dans une escouade" });
    }

    const targetRes = await pool.query(
      "SELECT squad_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())",
      [friendId]
    );
    if (!targetRes.rows.length) {
      return res.status(403).json({ error: "Cet utilisateur ne peut pas être invité" });
    }
    const squadInvitesFrom = targetRes.rows[0].squad_invites_from || "friends";
    if (squadInvitesFrom === "nobody") {
      return res.status(403).json({ error: "Cet utilisateur n'accepte pas les invitations d'escouade" });
    }
    if (squadInvitesFrom === "mutual_squad_members" && !(await shareSquad(reqUser, friendId))) {
      return res
        .status(403)
        .json({ error: "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune" });
    }

    const alreadyMember = await pool.query("SELECT status FROM squad_members WHERE squad_id = $1 AND user_id = $2", [
      squad.id,
      friendId
    ]);
    if (alreadyMember.rows.length && alreadyMember.rows[0].status === "active") {
      return res.status(409).json({ error: "Cet utilisateur est déjà membre de l'escouade" });
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
    // `source` is analytics metadata. It is not a free-form user field:
    // accepting it verbatim would let an invitation request persist up to the
    // JSON body limit in product_analytics. These are the only two product
    // meanings used below.
    const source = req.body?.source === "recommended" ? "recommended" : "squad_invite";
    analytics.logProductAnalyticsEvent(pool, {
      userId: reqUser,
      squadId: squad.id,
      event: "friend_invited_to_squad",
      details: { friendId, source }
    });
    if (source === "recommended") {
      analytics.logProductAnalyticsEvent(pool, {
        userId: reqUser,
        squadId: squad.id,
        event: "recommended_friend_invited",
        details: { friendId }
      });
    }
    res.json({ ok: true, invitationId: invitationResult.rows[0].id });
  } catch (err) {
    console.error("[/api/squads/:squadId/invitations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : list friends invitable to a given squad ──
app.get("/api/squads/:squadId/invitable-friends", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];

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
    const isFull = parseInt(memberCount.rows[0].count) >= 10;

    const friendsRes = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, COALESCE(u.squad_invites_from, 'friends') AS squad_invites_from
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY u.username`,
      [reqUser]
    );

    const friends = [];
    for (const f of friendsRes.rows) {
      if (isFull) continue;
      const invitePref = f.squad_invites_from || "friends";
      if (invitePref === "nobody") continue;
      if (invitePref === "mutual_squad_members" && !(await shareSquad(reqUser, f.id))) continue;

      const alreadyMember = await pool.query(
        "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
        [squad.id, f.id]
      );
      if (alreadyMember.rows.length) continue;

      const existingPending = await pool.query(
        `SELECT 1 FROM squad_invitations
         WHERE squad_id = $1 AND invitee_id = $2 AND status = 'pending'
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [squad.id, f.id]
      );
      if (existingPending.rows.length) continue;

      friends.push({
        id: f.id,
        username: f.username,
        displayName: f.display_name,
        avatarUrl: f.avatar_url || ""
      });
    }

    res.json({ friends });
  } catch (err) {
    console.error("[/api/squads/:squadId/invitable-friends]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : standardized recommendations (friends to invite + member comparisons) ──
