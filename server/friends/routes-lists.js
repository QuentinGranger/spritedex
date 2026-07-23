// friends/routes-lists.js — read-only listing endpoints (friends, pending, sent, blocked).

const { getRequestingUser, canViewCollection } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const compare = require("../compare");
const {
  getCommonSquad,
  getFriendCompletionRate,
  getLastCollectionUpdate,
  getFriendPreviewSummary
} = require("./helpers");

// ── List mutual accepted friends ─────────────────────────────────────────────
// Returns each friend with public profile info, online status, completion rate
// and last collection update, while respecting privacy settings.
app.get("/api/friends", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const includePreview = req.query.preview === "true";
    const catalog = await compare.getServerCompareCatalogItemsCached();
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url, u.privacy,
              u.profile_visibility, u.collection_visibility, u.priority_visibility, u.notes_visibility,
              u.visibility, u.last_active_at, f.status, f.created_at AS "friendSince"
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [reqUser]
    );
    const friends = [];
    for (const row of result.rows) {
      const commonSquad = await getCommonSquad(reqUser, row.id);
      const canCompare = await canViewCollection(reqUser, row.id);

      let completionRate = null;
      let lastCollectionUpdate = null;
      let preview = null;
      if (canCompare) {
        completionRate = await getFriendCompletionRate(row.id, catalog);
        lastCollectionUpdate = await getLastCollectionUpdate(row.id);
        if (includePreview) {
          preview = await getFriendPreviewSummary(reqUser, row.id);
        }
      }

      const friendEntry = {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatar_url,
        lastActive: row.last_active_at,
        completionRate,
        lastCollectionUpdate,
        friendSince: row.friendSince,
        commonSquad,
        actions: {
          compare: canCompare,
          inviteToSquad: true,
          remove: true,
          block: true
        }
      };
      if (includePreview) friendEntry.preview = preview;
      friends.push(friendEntry);
    }
    res.json({ friends });
  } catch (err) {
    console.error("[/api/friends]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── List pending invitations received ────────────────────────────────────────
app.get("/api/friends/pending", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1
         AND f.status = 'pending'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY f.created_at DESC`,
      [reqUser]
    );
    const pending = [];
    for (const row of result.rows) {
      const commonSquad = await getCommonSquad(reqUser, row.id);
      pending.push({
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatar_url,
        sentAt: row.created_at,
        commonSquad
      });
    }
    res.json({ pending });
  } catch (err) {
    console.error("[/api/friends/pending]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── List pending invitations received (REST style) ─────────────────────────
app.get("/api/friends/requests/received", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT f.id AS "requestId", f.created_at, f.status,
              u.id AS "userId", u.username, u.display_name AS "displayName", u.avatar_url
       FROM friendships f
       JOIN users u ON u.id = f.requester_id
       WHERE f.addressee_id = $1
         AND f.status = 'pending'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY f.created_at DESC`,
      [reqUser]
    );
    const requests = [];
    for (const row of result.rows) {
      requests.push({
        requestId: row.requestId,
        status: row.status,
        createdAt: row.created_at,
        user: {
          id: row.userId,
          username: row.username,
          displayName: row.displayName,
          avatarUrl: row.avatar_url
        },
        commonSquad: await getCommonSquad(reqUser, row.userId)
      });
    }
    res.json({ requests });
  } catch (err) {
    console.error("[/api/friends/requests/received]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── List pending invitations sent (REST style) ─────────────────────────────────
app.get("/api/friends/requests/sent", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT f.id AS "requestId", f.created_at, f.status,
              u.id AS "userId", u.username, u.display_name AS "displayName", u.avatar_url
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1
         AND f.status = 'pending'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY f.created_at DESC`,
      [reqUser]
    );
    const requests = result.rows.map(row => ({
      requestId: row.requestId,
      status: row.status,
      createdAt: row.created_at,
      user: {
        id: row.userId,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatar_url
      }
    }));
    res.json({ requests });
  } catch (err) {
    console.error("[/api/friends/requests/sent]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── List pending invitations sent ────────────────────────────────────────────
app.get("/api/friends/sent", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.display_name AS "displayName", u.avatar_url, f.status, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.addressee_id
       WHERE f.requester_id = $1
         AND f.status = 'pending'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY f.created_at DESC`,
      [reqUser]
    );
    const sent = result.rows.map(row => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatar_url,
      status: row.status,
      sentAt: row.created_at
    }));
    res.json({ sent });
  } catch (err) {
    console.error("[/api/friends/sent]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── List blocked users (from the requester's perspective) ────────────────────
app.get("/api/friends/blocked", async (req, res) => {
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
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [reqUser]
    );
    res.json({ blocked: result.rows });
  } catch (err) {
    console.error("[/api/friends/blocked]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = {};
