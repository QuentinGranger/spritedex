// routes-squad.js — extracted from server.js

const security = require("../security");
const analytics = require("../analytics");
const { getRequestingUser, isAccountSuspended, isBlocked, requireSquadMember, areFriends, getRelationship, shareSquad, canViewCollection } = require("./auth");
const { app } = require("./core");
const compare = require("./compare");
const { pool } = require("./db");
const { resolveAddressee } = require("./friends/helpers");
const { getVisibleSquadMemberIds, refreshSquadStats } = require("./routes-squad-invitations");
const crypto = require("crypto");
const QRCode = require("qrcode");

// ── Squad : secure code generation ──
function generateSquadCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return "SPRITE-" + code;
}

// ── Squad : lookup helper accepting numeric id or code ──
async function getSquadByIdOrCode(idOrCode) {
  const raw = String(idOrCode).trim();
  if (/^\d+$/.test(raw)) {
    return await pool.query(
      "SELECT id, code, name, created_by, join_open FROM squads WHERE id = $1",
      [Number(raw)]
    );
  }
  return await pool.query(
    "SELECT id, code, name, created_by, join_open FROM squads WHERE code = $1",
    [raw.toUpperCase()]
  );
}

// ── Squad : create ──
app.post("/api/squads", security.squadCreateLimiter, security.validateBody(security.schemas.squadCreateSchema), async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const { name } = req.validatedBody;

  const code = generateSquadCode();
  const squadName = (name || "Mon escouade").trim().slice(0, 50);

  try {
    const result = await pool.query(
      `INSERT INTO squads (code, name, created_by) VALUES ($1, $2, $3) RETURNING id, code, name, created_at`,
      [code, squadName, userId]
    );
    const squad = result.rows[0];
    await pool.query(
      `INSERT INTO squad_members (squad_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [squad.id, userId]
    );
    res.json(squad);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Code déjà pris, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function getCommonSquads(userA, userB) {
  if (!userA || !userB) return [];
  const result = await pool.query(
    `SELECT s.id, s.code, s.name, s.logo_url
     FROM squads s
     JOIN squad_members a ON a.squad_id = s.id AND a.user_id = $1 AND a.status = 'active'
     JOIN squad_members b ON b.squad_id = s.id AND b.user_id = $2 AND b.status = 'active'
     JOIN users ua ON ua.id = $1 AND ua.deleted_at IS NULL AND (ua.suspended_until IS NULL OR ua.suspended_until < NOW())
     JOIN users ub ON ub.id = $2 AND ub.deleted_at IS NULL AND (ub.suspended_until IS NULL OR ub.suspended_until < NOW())
     ORDER BY s.name`,
    [userA, userB]
  );
  return result.rows.map(s => ({
    id: s.id,
    code: s.code,
    name: s.name,
    logoUrl: s.logo_url || ""
  }));
}

// ── Squad : common squads between two users ──
app.get("/api/squads/common/:userA/:userB", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { userA, userB } = req.params;
  if (String(reqUser) !== String(userA) && String(reqUser) !== String(userB)) {
    return res.status(403).json({ error: "Accès refusé" });
  }
  try {
    const squads = await getCommonSquads(userA, userB);
    res.json({ squads });
  } catch (err) {
    console.error("[/api/squads/common]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : join by code ──
app.post("/api/squads/join", security.squadJoinLimiter, security.validateBody(security.schemas.squadJoinSchema), async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const { code } = req.validatedBody;

  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, join_open, created_at FROM squads WHERE code = $1",
      [code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Code d'escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    if (squad.join_open === false) {
      return res.status(403).json({ error: "Cette escouade n'accepte plus de nouveaux membres" });
    }

    const memberCount = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squad.id]
    );
    if (parseInt(memberCount.rows[0].count) >= 10) {
      return res.status(400).json({ error: "Escouade pleine (max 10)" });
    }

    const role = String(squad.created_by) === String(userId) ? "owner" : "member";
    await pool.query(
      `INSERT INTO squad_members (squad_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (squad_id, user_id)
       DO UPDATE SET status = 'active', left_at = NULL, role = EXCLUDED.role`,
      [squad.id, userId, role]
    );
    res.json(squad);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : shareable join link + QR code ──
// Returns a one-click join link (?joinSquad=CODE) and its QR code. Members only.
// The link/QR encode ONLY the public squad code, no private identifier.
app.get("/api/squads/:code/qr", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = `${base}/?joinSquad=${encodeURIComponent(squad.code)}`;
    let qr = null;
    try {
      qr = await QRCode.toDataURL(url, { type: "image/png", margin: 2, width: 300, errorCorrectionLevel: "M" });
    } catch (qrErr) {
      console.error("[/api/squads/:code/qr qr]", qrErr);
    }
    res.json({ code: squad.code, url, qr });
  } catch (err) {
    console.error("[/api/squads/:code/qr]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function getMemberFriendshipStatus(reqUser, memberId) {
  if (!reqUser || String(reqUser) === String(memberId)) {
    return { friendshipStatus: "me", canReceiveFriendRequest: false, friendRequestDirection: null };
  }
  if (await isBlocked(reqUser, memberId)) {
    return { friendshipStatus: "blocked", canReceiveFriendRequest: false, friendRequestDirection: null };
  }
  const relationship = await getRelationship(reqUser, memberId);
  const activeStatuses = ["pending", "accepted", "blocked"];
  let friendshipStatus = "none";
  let friendRequestDirection = null;
  if (relationship && activeStatuses.includes(relationship.status)) {
    friendshipStatus = relationship.status;
    if (relationship.status === "pending") {
      friendRequestDirection = String(relationship.requester_id) === String(reqUser) ? "sent" : "received";
    }
  }
  const canReceiveFriendRequest = friendshipStatus === "none" && await memberAcceptsFriendRequests(reqUser, memberId);
  return { friendshipStatus, canReceiveFriendRequest, friendRequestDirection };
}

async function memberAcceptsFriendRequests(reqUser, memberId) {
  const result = await pool.query(
    "SELECT friend_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL",
    [memberId]
  );
  if (!result.rows.length) return false;
  const setting = result.rows[0].friend_invites_from || "everyone";
  if (setting === "nobody") return false;
  if (setting === "mutual_squad_members") return true; // both members are in this squad
  return setting === "everyone";
}

// ── Squad : get squad details + members with collections ──
app.get("/api/squads/:code", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, created_by, created_at, join_open FROM squads WHERE code = $1",
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

    const allActiveMemberIds = membersResult.rows.map(m => m.id);
    const matrixMembers = membersResult.rows.map(m => ({ userId: m.id, username: m.username || String(m.id), visible: true }));
    const members = [];
    const visibleMemberIds = [];
    for (const member of membersResult.rows) {
      // Hide members who mutually blocked the requester in this squad context.
      if (reqUser && await isBlocked(reqUser, member.id)) continue;
      const canSeeCollection = String(member.id) === String(reqUser) ||
        await canViewCollection(reqUser, member.id);

      let collection = {};
      let entryCount = 0;
      let lastUpdated = null;
      if (canSeeCollection) {
        visibleMemberIds.push(member.id);
        const entriesResult = await pool.query(
          "SELECT sprite_id, status, priority, updated_at FROM sprite_entries WHERE user_id = $1",
          [member.id]
        );
        for (const row of entriesResult.rows) {
          collection[row.sprite_id] = { status: row.status, priority: row.priority || "none" };
          if (row.updated_at && (!lastUpdated || row.updated_at > lastUpdated)) {
            lastUpdated = row.updated_at;
          }
        }
        entryCount = entriesResult.rows.length;
      }

      const { friendshipStatus, canReceiveFriendRequest, friendRequestDirection } = await getMemberFriendshipStatus(reqUser, member.id);
      members.push({
        userId: member.id,
        username: member.username,
        avatarUrl: member.avatar_url || "",
        role: member.role || (String(member.id) === String(squad.created_by) ? "owner" : "member"),
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
      compare.getSquadRecommendations(visibleMemberIds),
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
app.post("/api/squads/:code/leave", async (req, res) => {
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

    try {
      await refreshSquadStats(squadResult.rows[0].id);
    } catch (err) {
      console.error("[leave] refresh stats failed", err);
    }

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
app.post("/api/squads/:code/kick", async (req, res) => {
  // SECURITY FIX: this was previously calling getRequestingUser() without
  // `await`, so reqUser held a pending Promise (always truthy) and every
  // String(reqUser) comparison against created_by failed — the route was
  // unusable for legitimate owners and, more importantly, was never actually
  // enforcing the ownership check it appeared to have.
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: "targetUserId requis" });
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
app.post("/api/squads/:code/regenerate", security.squadCodeLimiter, async (req, res) => {
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
app.post("/api/squads/:code/toggle-join", async (req, res) => {
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

// ── Squad : invite an accepted friend into the active squad ──
// This does NOT create a friendship; it only adds the friend as a member.
app.post("/api/squads/:code/invite/:friendId", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  if (await isAccountSuspended(reqUser)) {
    return res.status(403).json({ error: "Compte suspendu" });
  }

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
app.post("/api/squads/:squadId/invitations", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  if (await isAccountSuspended(reqUser)) {
    return res.status(403).json({ error: "Compte suspendu" });
  }

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
      return res.status(403).json({ error: "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune" });
    }

    const alreadyMember = await pool.query(
      "SELECT status FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squad.id, friendId]
    );
    if (alreadyMember.rows.length && alreadyMember.rows[0].status === 'active') {
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
    const source = req.body?.source || "squad_invite";
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "friend_invited_to_squad", details: { friendId, source } });
    if (source === "recommended") {
      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "recommended_friend_invited", details: { friendId } });
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
app.get("/api/squads/:squadId/recommendations", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const [friendsToInvite, memberComparisons] = await Promise.all([
      getSquadRecommendedFriends(squad, reqUser),
      getSquadComplementaryPairs(squad, reqUser)
    ]);

    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "squad_recommendation_viewed", details: { friendsToInviteCount: friendsToInvite.length, memberComparisonsCount: memberComparisons.length } });

    res.json({
      squadId: squad.code,
      recommendations: {
        friendsToInvite: friendsToInvite.map(c => ({
          userId: c.userId,
          username: c.username,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl,
          newVariantsForSquad: c.newVariantsForSquad,
          potentialContribution: c.potentialContribution,
          projectedCompletionRate: c.projectedCompletionRate,
          currentCompletionRate: c.currentCompletionRate,
          complementarityScore: c.complementarityScore
        })),
        memberComparisons: memberComparisons.map(p => ({
          userAId: p.userAId,
          userAName: p.userAName,
          userAAvatar: p.userAAvatar,
          userBId: p.userBId,
          userBName: p.userBName,
          userBAvatar: p.userBAvatar,
          complementarityScore: p.complementarityScore
        }))
      }
    });
  } catch (err) {
    console.error("[/api/squads/:squadId/recommendations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : unified activity history ──
app.get("/api/squads/:code/history", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    if (!(await requireSquadMember(req, res, squadResult.rows[0].id))) return;

    const days = parseInt(req.query.days) || 7;
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);

    const result = await pool.query(
      `SELECT sa.type, sa.action, sa.sprite_id, sa.metadata, sa.created_at,
              COALESCE(u.username, 'Utilisateur anonyme') AS username,
              u.id AS user_id
       FROM squad_activity sa
       LEFT JOIN users u ON u.id = sa.user_id
       WHERE sa.squad_id = $1 AND sa.created_at > NOW() - INTERVAL '1 day' * $2
       ORDER BY sa.created_at DESC
       LIMIT $3`,
      [squadResult.rows[0].id, days, limit]
    );

    const entries = result.rows.map(row => ({
      type: row.type,
      action: row.action,
      sprite_id: row.sprite_id,
      metadata: row.metadata || {},
      created_at: row.created_at,
      username: row.username,
      user_id: row.user_id
    }));

    res.json({ entries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function getSquadRecommendedFriends(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id, role FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);

  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const itemMap = new Map(catalogue.map(i => [i.id, i]));
  const total = catalogue.length;

  const memberIds = membersRes.rows.map(r => r.user_id);
  const reqUserMembership = membersRes.rows.find(r => String(r.user_id) === String(reqUser));
  if (!reqUserMembership) return [];

  const canInviteAnyone = reqUserMembership.role === "owner" || reqUserMembership.role === "admin" || (reqUserMembership.role === "member" && squad.join_open !== false);

  const memberCollections = await Promise.all(memberIds.map(id => compare.loadServerCompareCollection(id)));
  const currentOwned = new Set();
  for (const c of memberCollections) {
    for (const item of catalogue) {
      if (compare.compareServerClassify(c[item.id] || compare.compareServerDefaultEntry()) === "owned") currentOwned.add(item.id);
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
    if (memberIds.some(m => String(m) === String(row.id))) continue;
    if (await isBlocked(reqUser, row.id)) continue;
    if (!(await canViewCollection(reqUser, row.id))) continue;

    const invitePref = row.squad_invites_from || "friends";
    let canReceiveInvite = false;
    if (invitePref === "everyone") canReceiveInvite = true;
    else if (invitePref === "friends") canReceiveInvite = true; // friend of reqUser by query
    else if (invitePref === "mutual_squad_members") canReceiveInvite = await shareSquad(reqUser, row.id);
    else if (invitePref === "nobody") canReceiveInvite = false;
    if (!canReceiveInvite) continue;

    const cCollection = await compare.loadServerCompareCollection(row.id);
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

    const inter = new Set([...cOwned].filter(v => currentOwned.has(v))).size;
    const collectiveOwned = currentOwned.size + cOwned.size - inter;
    const onlyOne = collectiveOwned - inter;
    const complementarityRate = collectiveOwned ? Math.round((onlyOne / collectiveOwned) * 10000) / 100 : 0;

    const records = catalogue.map(item => ({
      ...item,
      userA: { status: currentOwned.has(item.id) ? "owned" : "missing", priority: "none", note: "" },
      userB: { status: cOwned.has(item.id) ? "owned" : (cPriority.has(item.id) ? "priority" : "missing"), priority: cPriority.has(item.id) ? "high" : "none", note: "" }
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
    const squadResult = await pool.query(
      "SELECT id, code, name, join_open FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const candidates = await getSquadRecommendedFriends(squad, reqUser);
    res.json({ squadCode: squad.code, squadName: squad.name, candidates });
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
  const memberIds = membersRes.rows.map(r => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const allowed = [];
  for (const u of usersRes.rows) {
    if (await canViewCollection(reqUser, u.id)) allowed.push(u);
  }

  const collectionCache = new Map();
  const memberCollections = await Promise.all(
    allowed.map(async (u) => {
      const c = await compare.loadServerCompareCollection(u.id);
      collectionCache.set(String(u.id), c);
      return c;
    })
  );

  const pairs = [];
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      const a = allowed[i];
      const b = allowed[j];
      const userA = { id: a.id, displayName: a.display_name || a.username, collection: memberCollections[i] };
      const userB = { id: b.id, displayName: b.display_name || b.username, collection: memberCollections[j] };

      let result = compare.getCachedCompareResult(a.id, b.id);
      if (!result) {
        result = compare.compareCollectionsServer(userA, userB, catalogue);
        compare.setCachedCompareResult(a.id, b.id, result);
      }

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

  for (const row of membersRes.rows) {
    const memberId = row.user_id;
    totalActiveMembers.push(memberId);

    if (!(await canViewCollection(reqUser, memberId))) {
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

  const membersForMatrix = membersRes.rows.map(r => ({
    userId: r.user_id,
    username: String(r.user_id),
    visible: true
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

// ── Squad : complementary member pairs ──
app.get("/api/squads/:code/complementary-pairs", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const pairs = await getSquadComplementaryPairs(squad, reqUser);
    res.json({ squadCode: squad.code, squadName: squad.name, pairs });
  } catch (err) {
    console.error("[/api/squads/:code/complementary-pairs]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : most complementary pair ──
app.get("/api/squads/:code/most-complementary-pair", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const pairs = await getSquadComplementaryPairs(squad, reqUser);
    const mostComplementaryPair = pairs[0] || null;
    res.json({ squadCode: squad.code, squadName: squad.name, mostComplementaryPair });
  } catch (err) {
    console.error("[/api/squads/:code/most-complementary-pair]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : most complementary member ──
app.get("/api/squads/:code/most-complementary-member", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

    const matrix = await compare.buildSquadCollectionMatrix(members);
    const mostComplementaryMember = compare.getSquadMostComplementaryMember(matrix, squad.name);

    res.json({ squadCode: squad.code, squadName: squad.name, mostComplementaryMember });
  } catch (err) {
    console.error("[/api/squads/:code/most-complementary-member]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : Level 1 analysis ──
app.get("/api/squads/:code/analysis", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username, u.collection_visibility
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const matrixMembers = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

    const [matrix, pairs] = await Promise.all([
      compare.buildSquadCollectionMatrix(matrixMembers),
      getSquadComplementaryPairs(squad, reqUser)
    ]);

    const analysis = compare.getSquadLevel1Analysis(matrix, squad.name, pairs);
    res.json({ squadCode: squad.code, squadName: squad.name, ...analysis });
  } catch (err) {
    console.error("[/api/squads/:code/analysis]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : scope definition ──
app.get("/api/squads/:code/completion", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const scope = await getSquadCompletionScope(squad, reqUser);
    res.json(scope);
  } catch (err) {
    console.error("[/api/squads/:code/completion]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : collective collection matrix (variant x member) ──
app.get("/api/squads/:code/matrix", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = [];
    for (const row of membersResult.rows) {
      const visible = String(row.user_id) === String(reqUser) || await canViewCollection(reqUser, row.user_id);
      members.push({
        userId: row.user_id,
        username: row.username || String(row.user_id),
        visible
      });
    }

    const matrix = await compare.buildSquadCollectionMatrix(members);
    const publicMatrix = matrix.map(row => {
      const { members, ...rest } = row;
      return rest;
    });

    res.json({
      squadCode: squad.code,
      squadName: squad.name,
      matrix: publicMatrix
    });
  } catch (err) {
    console.error("[/api/squads/:code/matrix]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : variants missing from the whole squad ──
app.get("/api/squads/:code/missing-variants", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = [];
    for (const row of membersResult.rows) {
      const visible = String(row.user_id) === String(reqUser) || await canViewCollection(reqUser, row.user_id);
      members.push({
        userId: row.user_id,
        username: row.username || String(row.user_id),
        visible
      });
    }

    const matrix = await compare.buildSquadCollectionMatrix(members);
    const result = compare.getSquadMissingVariants(matrix, squad.name);
    res.json({
      squadCode: squad.code,
      squadName: squad.name,
      ...result
    });
  } catch (err) {
    console.error("[/api/squads/:code/missing-variants]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : unique owner variants (ownerCount === 1) ──
app.get("/api/squads/:code/unique-owners", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

    const matrix = await compare.buildSquadCollectionMatrix(members);
    const result = compare.getSquadUniqueOwners(matrix);

    res.json({
      squadCode: squad.code,
      squadName: squad.name,
      ...result
    });
  } catch (err) {
    console.error("[/api/squads/:code/unique-owners]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : shared variants (doublons / ownerCount >= 2) ──
app.get("/api/squads/:code/shared-variants", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

    const matrix = await compare.buildSquadCollectionMatrix(members);
    const result = compare.getSquadSharedVariants(matrix);

    res.json({
      squadCode: squad.code,
      squadName: squad.name,
      ...result
    });
  } catch (err) {
    console.error("[/api/squads/:code/shared-variants]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : delete (creator only) ──
app.delete("/api/squads/:code", async (req, res) => {
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
      return res.status(403).json({ error: "Seul le créateur peut supprimer l'escouade" });
    }
    await pool.query("DELETE FROM squads WHERE id = $1", [squad.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// SECURITY: the legacy "/api/squad/:username" route has been removed. It
// exposed ANY user's full collection (status + priority for every sprite)
// to ANYONE who knew their username, with zero authentication and zero
// regard for the "private" / "squad_only" privacy setting — a complete
// bypass of the privacy model. It was not called anywhere in the frontend
// (which uses /api/squads/:code for squad comparisons instead), so removing
// it does not affect any existing feature.

// ── Squad : join link redirect ──
app.get("/squad/join/:code", (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  res.redirect(`/?joinSquad=${encodeURIComponent(code)}`);
});

module.exports = { generateSquadCode };
