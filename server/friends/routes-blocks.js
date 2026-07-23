// friends/routes-blocks.js — block / unblock and relationship status endpoints.

const { getRequestingUser, isBlocked, getRelationship } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const { resolveUsers } = require("./helpers");
const { applyFriendAction, blockUser } = require("./state-machine");

// ── Block a user from any context (profile, friend list, public link, report) ──
app.post("/api/users/:userId/block", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const userId = Number(req.params.userId);
  if (!userId || String(userId) !== String(req.params.userId) || String(userId) === String(reqUser)) {
    return res.status(400).json({ error: "Identifiant invalide" });
  }

  const exists = await pool.query("SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
  if (!exists.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });

  if (await isBlocked(reqUser, userId)) {
    return res.status(409).json({ error: "Utilisateur déjà bloqué" });
  }

  const outcome = await blockUser(reqUser, userId);
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── Block a user (friendship context) ──────────────────────────────────────────
app.post("/api/friends/:friendId/block", async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await blockUser(reqUser, friendId);
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── Unblock a user ───────────────────────────────────────────────────────────
app.post("/api/friends/:friendId/unblock", async (req, res) => {
  const resolved = await resolveUsers(req, req.params.friendId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const { reqUser, friendId } = resolved;

  const outcome = await applyFriendAction(reqUser, friendId, "unblock");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── Unblock a user from the users endpoint (does not restore friendship) ───
app.delete("/api/users/:userId/block", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const userId = Number(req.params.userId);
  if (!userId || String(userId) !== String(req.params.userId) || String(userId) === String(reqUser)) {
    return res.status(400).json({ error: "Identifiant invalide" });
  }

  const exists = await pool.query("SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
  if (!exists.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });

  const outcome = await applyFriendAction(reqUser, userId, "unblock");
  if (outcome.error) return res.status(outcome.error).json({ error: outcome.message });
  res.json({ ok: true });
});

// ── List blocked users from the users endpoint ────────────────────────────────
app.get("/api/users/blocked", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url, f.updated_at
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1
         AND f.status = 'blocked'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY f.updated_at DESC`,
      [reqUser]
    );
    res.json({ blocked: result.rows });
  } catch (err) {
    console.error("[/api/users/blocked]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Report a user ────────────────────────────────────────────────────────────
app.post("/api/users/:userId/report", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const userId = Number(req.params.userId);
  if (!userId || String(userId) !== String(req.params.userId) || String(userId) === String(reqUser)) {
    return res.status(400).json({ error: "Identifiant invalide" });
  }

  const { reason } = req.body || {};
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (!cleanReason || cleanReason.length > 500) {
    return res.status(400).json({ error: "Motif invalide (1-500 caractères)" });
  }

  const exists = await pool.query("SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
  if (!exists.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });

  try {
    await pool.query(
      `INSERT INTO user_reports (reporter_id, reported_id, reason, status, created_at)
       VALUES ($1, $2, $3, 'open', NOW())`,
      [reqUser, userId, cleanReason]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/users/:userId/report]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Relationship status between me and another user ──────────────────────────
app.get("/api/friends/:friendId/status", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const friendId = req.params.friendId;
  if (String(reqUser) === String(friendId)) return res.status(400).json({ error: "Toi-même ?" });
  try {
    const row = await getRelationship(reqUser, friendId);
    const status = row ? row.status : "none";
    const direction = row
      ? (Number(row.requester_id) === Number(reqUser) ? "outgoing" : "incoming")
      : "none";
    res.json({ status, direction });
  } catch (err) {
    console.error("[/api/friends/:friendId/status]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = {};
