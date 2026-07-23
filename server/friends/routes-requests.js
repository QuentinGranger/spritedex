// friends/routes-requests.js — send / accept / decline / cancel / remove endpoints.

const { getRequestingUser, isBlocked, shareSquad } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const analytics = require("../../analytics");
const pushService = require("../../push-service");
const security = require("../../security");
const compare = require("../compare");
const { logSquadFriendship } = require("../squad-activity");
const { resolveUsers, resolveAddressee, getActiveFriendship } = require("./helpers");
const { applyFriendAction } = require("./state-machine");

// ── Send a friend request ────────────────────────────────────────────────────
app.post("/api/friends/:friendId/request", async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const blocked = await isBlocked(reqUser, friendId);
  if (blocked) return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });

  const outcome = await applyFriendAction(reqUser, friendId, "request");
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

  if (await shareSquad(reqUser, friendId)) {
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, event: "squad_member_friend_request_sent", details: { friendId } });
  }

  res.json({ ok: true });
});

// ── Send a friend request by addresseeId (username or numeric id) ───────────
app.post("/api/friends/requests", security.validateBody(security.schemas.friendRequestSchema), async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const { addresseeId } = req.validatedBody;
  const resolved = await resolveAddressee(reqUser, addresseeId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "request");
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

  if (await shareSquad(reqUser, friendId)) {
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, event: "squad_member_friend_request_sent", details: { friendId } });
  }

  res.json({ requestId: row.id, status: row.status, createdAt: row.created_at });
});

// ── Accept a friend request ──────────────────────────────────────────────────
app.post("/api/friends/:friendId/accept", async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "accept");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });

  logSquadFriendship(reqUser, friendId);

  const reqUserRecord = await pool.query("SELECT username FROM users WHERE id = $1", [reqUser]);
  await pushService.createNotification(pool, {
    recipientId: friendId,
    actorId: reqUser,
    type: "friend_request_accepted",
    context: { friendId: reqUser },
    message: `${reqUserRecord.rows[0]?.username || "Quelqu'un"} a accepté votre demande.`,
    url: "/friends"
  });

  res.json({ ok: true });
});

// ── Accept a friend request by request id ────────────────────────────────────
app.post("/api/friends/requests/:requestId/accept", async (req, res) => {
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

    await client.query(
      `UPDATE friendships
       SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );
    await client.query("COMMIT");

    logSquadFriendship(reqUser, request.requester_id);

    const accepter = await pool.query("SELECT username FROM users WHERE id = $1", [reqUser]);
    await pushService.createNotification(pool, {
      recipientId: request.requester_id,
      actorId: reqUser,
      type: "friend_request_accepted",
      message: `${accepter.rows[0]?.username || "Quelqu'un"} a accepté votre demande.`,
      url: "/friends"
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
app.post("/api/friends/requests/:requestId/decline", async (req, res) => {
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
app.delete("/api/friends/requests/:requestId", async (req, res) => {
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
app.post("/api/friends/:friendId/decline", async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "decline");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── Cancel an invitation sent ────────────────────────────────────────────────
app.post("/api/friends/:friendId/cancel", async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "cancel");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── Remove a friendship ──────────────────────────────────────────────────────
// UI should prompt for confirmation before calling this endpoint.
app.post("/api/friends/:friendId/remove", async (req, res) => {
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

app.delete("/api/friends/:friendId", async (req, res) => {
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
