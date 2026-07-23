// routes-squad-invitations.js — squad invitation context, accept, decline and preview.

const { getRequestingUser, isBlocked, getRelationship, canViewCollection } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const analytics = require("../analytics");
const compare = require("./compare");
const pushService = require("../push-service");
const { logSquadMemberJoined, logSquadCompletionMilestone } = require("./squad-activity");

const ACTIVE_FRIEND_STATUSES = ["pending", "accepted", "blocked"];

async function memberAcceptsFriendRequests(reqUser, memberId) {
  const result = await pool.query(
    "SELECT friend_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL",
    [memberId]
  );
  if (!result.rows.length) return false;
  const setting = result.rows[0].friend_invites_from || "everyone";
  if (setting === "nobody") return false;
  if (setting === "mutual_squad_members") return true;
  return setting === "everyone";
}

async function getMemberFriendshipStatus(reqUser, memberId) {
  if (!reqUser || String(reqUser) === String(memberId)) {
    return { friendshipStatus: "me", canReceiveFriendRequest: false, friendRequestDirection: null };
  }
  if (await isBlocked(reqUser, memberId)) {
    return { friendshipStatus: "blocked", canReceiveFriendRequest: false, friendRequestDirection: null };
  }
  const relationship = await getRelationship(reqUser, memberId);
  const friendshipStatus = relationship && ACTIVE_FRIEND_STATUSES.includes(relationship.status)
    ? relationship.status
    : "none";
  let friendRequestDirection = null;
  if (relationship && relationship.status === "pending") {
    friendRequestDirection = String(relationship.requester_id) === String(reqUser) ? "sent" : "received";
  }
  const canReceiveFriendRequest = friendshipStatus === "none" && await memberAcceptsFriendRequests(reqUser, memberId);
  return { friendshipStatus, canReceiveFriendRequest, friendRequestDirection };
}

async function getVisibleSquadMemberIds(squadId, reqUser) {
  const result = await pool.query(
    `SELECT u.id
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND u.deleted_at IS NULL
       AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
    [squadId]
  );
  const visible = [];
  for (const row of result.rows) {
    if (String(row.id) === String(reqUser) || await canViewCollection(reqUser, row.id)) {
      visible.push(row.id);
    }
  }
  return visible;
}

async function getSquadActiveMembers(squadId, reqUser) {
  const result = await pool.query(
    `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url, sm.role, sm.joined_at
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND u.deleted_at IS NULL
       AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
     ORDER BY sm.joined_at`,
    [squadId]
  );
  const members = [];
  for (const member of result.rows) {
    if (reqUser && await isBlocked(reqUser, member.id)) continue;
    const { friendshipStatus, canReceiveFriendRequest, friendRequestDirection } = await getMemberFriendshipStatus(reqUser, member.id);
    members.push({
      userId: member.id,
      username: member.username,
      displayName: member.displayName,
      avatarUrl: member.avatar_url || "",
      role: member.role || "member",
      joinedAt: member.joined_at,
      friendshipStatus,
      canReceiveFriendRequest,
      friendRequestDirection
    });
  }
  return members;
}

async function getSquadPreview(squad, reqUser) {
  const members = await getSquadActiveMembers(squad.id, reqUser);
  const visibleMemberIds = await getVisibleSquadMemberIds(squad.id, reqUser);
  const [completion, friendsResult] = await Promise.all([
    compare.getSquadCollectiveCompletionSummary(visibleMemberIds),
    pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       JOIN friendships f ON (
         (f.requester_id = $1 AND f.addressee_id = u.id)
         OR (f.requester_id = u.id AND f.addressee_id = $1)
       )
       WHERE sm.squad_id = $2
         AND sm.status = 'active'
         AND f.status = 'accepted'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [reqUser, squad.id]
    )
  ]);
  const friendsInSquad = friendsResult.rows.map(row => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatar_url || ""
  }));
  return {
    id: squad.id,
    code: squad.code,
    name: squad.name,
    logoUrl: squad.logo_url || "",
    joinOpen: squad.join_open !== false,
    createdAt: squad.created_at,
    memberCount: members.length,
    members,
    friendsInSquad,
    friendsInSquadCount: friendsInSquad.length,
    collectiveCompletionRate: completion.collectiveCompletionRate,
    totalVariants: completion.totalVariants
  };
}

async function refreshSquadStats(squadId) {
  const members = await getSquadActiveMembers(squadId, null);
  const memberIds = members.map(m => m.userId);
  const [completion, recommendations] = await Promise.all([
    compare.getSquadCollectiveCompletionSummary(memberIds),
    compare.getSquadRecommendations(memberIds)
  ]);

  await logSquadCompletionMilestone(squadId, completion.collectiveCompletionRate);

  const recPayload = JSON.stringify(recommendations.map(r => ({
    variantId: r.variantId,
    spriteId: r.spriteId,
    spriteName: r.spriteName,
    variantName: r.variantName,
    img: r.img,
    ownedByCount: r.ownedByCount,
    wantedByCount: r.wantedByCount
  })));
  await pool.query(
    `INSERT INTO squad_stats (squad_id, collective_completion_rate, recommendations, computed_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (squad_id)
     DO UPDATE SET collective_completion_rate = EXCLUDED.collective_completion_rate,
                   recommendations = EXCLUDED.recommendations,
                   computed_at = EXCLUDED.computed_at`,
    [squadId, completion.collectiveCompletionRate, recPayload]
  );
  return completion.collectiveCompletionRate;
}

const pendingSquadStatsRefreshes = new Map();
const LARGE_SQUAD_THRESHOLD = 5;
const LARGE_SQUAD_REFRESH_DELAY_MS = 2000;

async function scheduleSquadStatsRefresh(squadId) {
  if (pendingSquadStatsRefreshes.has(squadId)) return;

  const countRes = await pool.query(
    "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
    [squadId]
  );
  const memberCount = parseInt(countRes.rows[0].count);

  const runRefresh = async () => {
    pendingSquadStatsRefreshes.delete(squadId);
    try {
      await refreshSquadStats(squadId);
    } catch (err) {
      console.error("[scheduleSquadStatsRefresh]", err);
    }
  };

  if (memberCount > LARGE_SQUAD_THRESHOLD) {
    const timeout = setTimeout(runRefresh, LARGE_SQUAD_REFRESH_DELAY_MS);
    pendingSquadStatsRefreshes.set(squadId, timeout);
  } else {
    pendingSquadStatsRefreshes.set(squadId, true);
    runRefresh();
  }
}

async function notifySquadOfJoin(squadId, joinerId, squadCode, squadName) {
  try {
    const joinerRes = await pool.query(
      "SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL",
      [joinerId]
    );
    const joinerName = joinerRes.rows[0]?.username || "Un membre";
    const message = `${joinerName} a rejoint l'escouade ${squadName || ""}`.trim();
    const members = await pool.query(
      "SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active' AND user_id <> $2",
      [squadId, joinerId]
    );
    for (const row of members.rows) {
      pushService.createNotification(pool, {
        recipientId: row.user_id,
        actorId: joinerId,
        type: "squad_member_joined",
        entityId: squadId,
        context: { squadId, squadCode, squadName },
        message,
        url: `/squad/${squadCode}`
      }).catch(err => console.error("[notifySquadOfJoin] notification failed", err));
    }
  } catch (err) {
    console.error("[notifySquadOfJoin]", err);
  }
}

async function buildInvitationContext(invitation, reqUser) {
  const [squadResult, inviterResult] = await Promise.all([
    pool.query(
      "SELECT id, code, name, join_open, logo_url, created_at FROM squads WHERE id = $1",
      [invitation.squad_id]
    ),
    pool.query(
      "SELECT id, username, display_name, avatar_url FROM users WHERE id = $1 AND deleted_at IS NULL",
      [invitation.inviter_id]
    )
  ]);
  const squad = squadResult.rows[0];
  const inviter = inviterResult.rows[0];
  const members = await getSquadActiveMembers(invitation.squad_id, reqUser);
  const visibleMemberIds = await getVisibleSquadMemberIds(invitation.squad_id, reqUser);
  const [completion, friendsResult, alreadyMember] = await Promise.all([
    compare.getSquadCollectiveCompletionSummary(visibleMemberIds),
    pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       JOIN friendships f ON (
         (f.requester_id = $1 AND f.addressee_id = u.id)
         OR (f.requester_id = u.id AND f.addressee_id = $1)
       )
       WHERE sm.squad_id = $2
         AND sm.status = 'active'
         AND f.status = 'accepted'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [reqUser, invitation.squad_id]
    ),
    pool.query(
      "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
      [invitation.squad_id, reqUser]
    )
  ]);
  const friendsInSquad = friendsResult.rows.map(row => ({
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatar_url || ""
  }));
  const isFull = members.length >= 10;
  return {
    invitationId: invitation.id,
    status: invitation.status,
    createdAt: invitation.created_at,
    expiresAt: invitation.expires_at,
    squad: {
      id: squad.id,
      code: squad.code,
      name: squad.name,
      logoUrl: squad.logo_url || "",
      joinOpen: squad.join_open !== false,
      createdAt: squad.created_at
    },
    inviter: {
      id: inviter.id,
      username: inviter.username,
      displayName: inviter.display_name,
      avatarUrl: inviter.avatar_url || ""
    },
    memberCount: members.length,
    collectiveCompletionRate: completion.collectiveCompletionRate,
    totalVariants: completion.totalVariants,
    friendsInSquad,
    friendsInSquadCount: friendsInSquad.length,
    actions: {
      join: !alreadyMember.rows.length && !isFull,
      decline: true,
      viewSquad: true,
      blockUser: true
    }
  };
}

// ── List pending squad invitations for the current user with full context ──
app.get("/api/squad-invitations", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT id, squad_id, inviter_id, status, created_at, expires_at
       FROM squad_invitations
       WHERE invitee_id = $1
         AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC`,
      [reqUser]
    );
    const invitations = [];
    for (const row of result.rows) {
      invitations.push(await buildInvitationContext(row, reqUser));
    }
    res.json({ invitations });
  } catch (err) {
    console.error("[/api/squad-invitations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function acceptInvitation(invitationId, reqUser) {
  const invResult = await pool.query(
    `SELECT si.*, s.code, s.name FROM squad_invitations si
     JOIN squads s ON s.id = si.squad_id
     WHERE si.id = $1 AND si.invitee_id = $2 AND si.status = 'pending'`,
    [invitationId, reqUser]
  );
  if (!invResult.rows.length) {
    const err = new Error("Invitation introuvable");
    err.status = 404;
    throw err;
  }
  const invitation = invResult.rows[0];
  if (invitation.expires_at && new Date(invitation.expires_at) <= new Date()) {
    await pool.query(
      "UPDATE squad_invitations SET status = 'expired', responded_at = NOW() WHERE id = $1",
      [invitationId]
    );
    const err = new Error("Invitation expirée");
    err.status = 400;
    throw err;
  }
  const alreadyMember = await pool.query(
    "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
    [invitation.squad_id, reqUser]
  );
  if (alreadyMember.rows.length) {
    await pool.query(
      "UPDATE squad_invitations SET status = 'accepted', responded_at = NOW() WHERE id = $1",
      [invitationId]
    );
    return { ok: true, squadCode: invitation.code };
  }
  const memberCount = await pool.query(
    "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
    [invitation.squad_id]
  );
  if (parseInt(memberCount.rows[0].count) >= 10) {
    const err = new Error("Escouade pleine (max 10)");
    err.status = 400;
    throw err;
  }
  await pool.query(
    `INSERT INTO squad_members (squad_id, user_id, role, status)
     VALUES ($1, $2, 'member', 'active')
     ON CONFLICT (squad_id, user_id)
     DO UPDATE SET status = 'active', left_at = NULL, role = 'member'`,
    [invitation.squad_id, reqUser]
  );
  await pool.query(
    "UPDATE squad_invitations SET status = 'accepted', responded_at = NOW() WHERE id = $1",
    [invitationId]
  );

  const statsRes = await pool.query(
    "SELECT collective_completion_rate FROM squad_stats WHERE squad_id = $1",
    [invitation.squad_id]
  );
  const beforeRate = statsRes.rows.length ? parseFloat(statsRes.rows[0].collective_completion_rate) : 0;
  const afterRate = await refreshSquadStats(invitation.squad_id);
  const completionRateDelta = Math.round((afterRate - beforeRate) * 100) / 100;

  await Promise.all([
    notifySquadOfJoin(invitation.squad_id, reqUser, invitation.code, invitation.name),
    logSquadMemberJoined(invitation.squad_id, reqUser)
  ]);

  analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: invitation.squad_id, event: "friend_joined_squad", details: { invitationId, completionRateDelta, beforeRate, afterRate } });

  return { ok: true, squadCode: invitation.code };
}

async function declineInvitation(invitationId, reqUser) {
  const invResult = await pool.query(
    "SELECT id FROM squad_invitations WHERE id = $1 AND invitee_id = $2 AND status = 'pending'",
    [invitationId, reqUser]
  );
  if (!invResult.rows.length) {
    const err = new Error("Invitation introuvable");
    err.status = 404;
    throw err;
  }
  await pool.query(
    "UPDATE squad_invitations SET status = 'declined', responded_at = NOW() WHERE id = $1",
    [invitationId]
  );
  return { ok: true };
}

function handleInvitationError(res, err) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error("[squad-invitation]", err);
  return res.status(500).json({ error: "Erreur serveur" });
}

// ── Accept a squad invitation (canonical path) ──
app.post("/api/squads/invitations/:invitationId/accept", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await acceptInvitation(req.params.invitationId, reqUser);
    res.json(result);
  } catch (err) {
    handleInvitationError(res, err);
  }
});

// ── Decline a squad invitation (canonical path) ──
app.post("/api/squads/invitations/:invitationId/decline", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await declineInvitation(req.params.invitationId, reqUser);
    res.json(result);
  } catch (err) {
    handleInvitationError(res, err);
  }
});

// ── Accept a squad invitation (legacy alias) ──
app.post("/api/squad-invitations/:id/accept", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await acceptInvitation(req.params.id, reqUser);
    res.json(result);
  } catch (err) {
    handleInvitationError(res, err);
  }
});

// ── Decline a squad invitation (legacy alias) ──
app.post("/api/squad-invitations/:id/decline", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await declineInvitation(req.params.id, reqUser);
    res.json(result);
  } catch (err) {
    handleInvitationError(res, err);
  }
});

// ── Preview a squad before accepting an invitation ──
app.get("/api/squads/:code/preview", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, join_open, logo_url, created_at, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    const hasPendingInvitation = await pool.query(
      `SELECT 1 FROM squad_invitations
       WHERE squad_id = $1 AND invitee_id = $2 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [squad.id, reqUser]
    );
    if (!hasPendingInvitation.rows.length) {
      return res.status(403).json({ error: "Aucune invitation en attente pour cette escouade" });
    }
    const preview = await getSquadPreview(squad, reqUser);
    res.json(preview);
  } catch (err) {
    console.error("[/api/squads/:code/preview]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = { refreshSquadStats, getVisibleSquadMemberIds, scheduleSquadStatsRefresh };
