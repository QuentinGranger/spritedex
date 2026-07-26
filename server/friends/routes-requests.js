// friends/routes-requests.js — send / accept / decline / cancel / remove endpoints.

const { getRequestingUser, isBlocked, shareSquad, requireNotSuspended } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const analytics = require("../../analytics");
const pushService = require("../../push-service");
const security = require("../../security");
const compare = require("../compare");
const { logSquadFriendship } = require("../squad-activity");
const { resolveUsers, resolveAddressee, getActiveFriendship } = require("./helpers");
const { applyFriendAction } = require("./state-machine");
const { emitDomainEvent, DOMAIN_EVENTS } = require("../event-bus");

async function resolveFriendInvitationOptions(reqUser, friendId, body = {}) {
  const { normalizeInvitationMethod } = require("../sprite-graph");
  const rawMethod = body.invitationMethod || body.method || null;
  const mutualSquad = await shareSquad(reqUser, friendId);
  let invitationMethod;
  if (rawMethod) {
    invitationMethod = normalizeInvitationMethod(rawMethod);
  } else if (mutualSquad) {
    invitationMethod = "squad_member";
  } else {
    invitationMethod = "username";
  }
  const invitationSource = body.invitationSource
    || body.source
    || (invitationMethod === "squad_member" ? "squad_member"
      : invitationMethod === "passport" ? "passport"
        : "username_search");
  return {
    invitationMethod,
    invitationSource: String(invitationSource).slice(0, 80),
    origin: "friends.request",
    source: "api"
  };
}

// ── Send a friend request ────────────────────────────────────────────────────
app.post("/api/friends/:friendId/request", requireNotSuspended, async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const blocked = await isBlocked(reqUser, friendId);
  if (blocked) return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });

  const inviteOpts = await resolveFriendInvitationOptions(reqUser, friendId, req.body || {});
  const outcome = await applyFriendAction(reqUser, friendId, "request", inviteOpts);
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });

  const reqUserRecord = await pool.query("SELECT username FROM users WHERE id = $1", [reqUser]);
  await pushService.createNotification(pool, {
    recipientId: friendId,
    actorId: reqUser,
    type: "friend_request_received",
    context: { friendId: reqUser },
    message: `${reqUserRecord.rows[0]?.username || "Quelqu'un"} vous a envoyé une demande d'ami.`,
    url: "/friends"
  });

  if (inviteOpts.invitationMethod === "squad_member" || await shareSquad(reqUser, friendId)) {
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, event: "squad_member_friend_request_sent", details: { friendId } });
  }

  res.json({ ok: true });
});

// ── Send a friend request by addresseeId (username or numeric id) ───────────
app.post("/api/friends/requests", requireNotSuspended, security.validateBody(security.schemas.friendRequestSchema), async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const { addresseeId, invitationMethod, invitationSource, source } = req.validatedBody;
  const resolved = await resolveAddressee(reqUser, addresseeId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { friendId } = resolved;

  const inviteOpts = await resolveFriendInvitationOptions(reqUser, friendId, {
    invitationMethod,
    invitationSource,
    source
  });
  const outcome = await applyFriendAction(reqUser, friendId, "request", inviteOpts);
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });

  const row = await getActiveFriendship(reqUser, friendId);

  const reqUserRecord = await pool.query("SELECT username FROM users WHERE id = $1", [reqUser]);
  await pushService.createNotification(pool, {
    recipientId: friendId,
    actorId: reqUser,
    type: "friend_request_received",
    context: { friendId: reqUser },
    message: `${reqUserRecord.rows[0]?.username || "Quelqu'un"} vous a envoyé une demande d'ami.`,
    url: "/friends"
  });

  if (inviteOpts.invitationMethod === "squad_member" || await shareSquad(reqUser, friendId)) {
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, event: "squad_member_friend_request_sent", details: { friendId } });
  }

  res.json({ requestId: row.id, status: row.status, createdAt: row.created_at });
});

// ── Accept a friend request ──────────────────────────────────────────────────
app.post("/api/friends/:friendId/accept", requireNotSuspended, async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "accept");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });

  logSquadFriendship(reqUser, friendId);

  // Étape 11 — trigger: friendship.accepted fires only on pending → accepted.
  // Recipient = original requester. The accepter is never notified of their own action.
  if (outcome.previousStatus === "pending" && outcome.newStatus === "accepted") {
    await emitDomainEvent(DOMAIN_EVENTS.FRIENDSHIP_ACCEPTED, {
      actorId: outcome.accepterId,
      entityType: "user",
      entityId: outcome.requesterId,
      context: {
        previousStatus: outcome.previousStatus,
        newStatus: outcome.newStatus,
        friendshipId: outcome.friendshipId,
        requesterId: outcome.requesterId,
        accepterId: outcome.accepterId
      }
    });
  }

  res.json({ ok: true });
});

// ── Accept a friend request by request id ────────────────────────────────────
app.post("/api/friends/requests/:requestId/accept", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const requestId = req.params.requestId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT * FROM friendships
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
       FOR UPDATE`,
      [requestId, reqUser]
    );
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Demande introuvable" });
    }
    const request = result.rows[0];

    const usersRes = await client.query(
      "SELECT id FROM users WHERE id = ANY($1::integer[]) AND deleted_at IS NULL",
      [[request.requester_id, request.addressee_id]]
    );
    if (usersRes.rows.length !== 2) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Compte invalide" });
    }

    const blocked = await client.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = $1::integer AND blocked_id = $2::integer)
          OR (blocker_id = $2::integer AND blocked_id = $1::integer)`,
      [request.requester_id, request.addressee_id]
    );
    if (blocked.rows.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });
    }

    // Étape 11 — pending → accepted (row was locked with status = 'pending').
    await client.query(
      `UPDATE friendships
       SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [requestId]
    );
    await client.query("COMMIT");

    logSquadFriendship(reqUser, request.requester_id);

    // Recipient = original requester. The accepter (reqUser) is never notified.
    await emitDomainEvent(DOMAIN_EVENTS.FRIENDSHIP_ACCEPTED, {
      actorId: reqUser,
      entityType: "user",
      entityId: request.requester_id,
      context: {
        previousStatus: "pending",
        newStatus: "accepted",
        friendshipId: request.id,
        requesterId: request.requester_id,
        accepterId: reqUser
      }
    });

    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[/api/friends/requests/:requestId/accept]", err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// ── Decline a friend request by request id ───────────────────────────────────
app.post("/api/friends/requests/:requestId/decline", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const requestId = req.params.requestId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE friendships
       SET status = 'declined', responded_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
       RETURNING id`,
      [requestId, reqUser]
    );
    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Demande introuvable" });
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[/api/friends/requests/:requestId/decline]", err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// ── Cancel a friend request by request id ────────────────────────────────────
app.delete("/api/friends/requests/:requestId", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const requestId = req.params.requestId;
  try {
    const result = await pool.query(
      `UPDATE friendships
       SET status = 'cancelled', responded_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND requester_id = $2 AND status = 'pending'
       RETURNING id`,
      [requestId, reqUser]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Demande introuvable" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/friends/requests/:requestId]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Decline an invitation ────────────────────────────────────────────────────
app.post("/api/friends/:friendId/decline", requireNotSuspended, async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "decline");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── Cancel an invitation sent ────────────────────────────────────────────────
app.post("/api/friends/:friendId/cancel", requireNotSuspended, async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "cancel");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── Remove a friendship ──────────────────────────────────────────────────────
// UI should prompt for confirmation before calling this endpoint.
app.post("/api/friends/:friendId/remove", requireNotSuspended, async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "remove");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  compare.invalidateCompareCacheForUser(reqUser);
  compare.invalidateCompareCacheForUser(friendId);

  const reqUserRecord = await pool.query("SELECT username FROM users WHERE id = $1", [reqUser]);
  await pushService.createNotification(pool, {
    recipientId: friendId,
    actorId: reqUser,
    type: "friend_removed",
    context: { friendId: reqUser },
    message: `${reqUserRecord.rows[0]?.username || "Quelqu'un"} a supprimé votre amitié.`,
    url: "/friends"
  });

  res.json({ ok: true });
});

app.delete("/api/friends/:friendId", requireNotSuspended, async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "remove");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  compare.invalidateCompareCacheForUser(reqUser);
  compare.invalidateCompareCacheForUser(friendId);

  const reqUserRecord = await pool.query("SELECT username FROM users WHERE id = $1", [reqUser]);
  await pushService.createNotification(pool, {
    recipientId: friendId,
    actorId: reqUser,
    type: "friend_removed",
    context: { friendId: reqUser },
    message: `${reqUserRecord.rows[0]?.username || "Quelqu'un"} a supprimé votre amitié.`,
    url: "/friends"
  });

  res.json({ ok: true });
});

module.exports = {};
