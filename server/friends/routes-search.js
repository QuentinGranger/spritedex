// friends/routes-search.js — privacy-safe user search.

const { getRequestingUser, canViewCollection, isBlocked } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const security = require("../../security");
const { getActiveFriendship, canReceiveFriendRequestFrom } = require("./helpers");

// ── Search users by username (privacy-safe) ──────────────────────────────────
// Returns a small list of public accounts; friends_only accounts are included only
// if the requester and the user are already friends, and private accounts are
// omitted entirely (they cannot be discovered).
// Requires at least 3 characters, is rate limited, caps results, and prefers an
// exact normalized-username match before returning similar usernames.
app.get("/api/users/search",
  security.rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    keyPrefix: "search",
    message: "Trop de recherches, ralentis un peu."
  }),
  async (req, res) => {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const q = String(req.query.username || req.query.q || "").trim();
    if (q.length < 3 || q.length > 50) return res.status(400).json({ error: "Recherche invalide" });

    try {
      const safeQ = q.replace(/[%_]/g, "\\$&");
      const usersResult = await pool.query(
        `SELECT id, username, display_name AS "displayName", avatar_url,
                profile_visibility, privacy, visibility
         FROM users
         WHERE (username ILIKE $1 OR display_name ILIKE $1 OR username_normalized ILIKE $1)
           AND deleted_at IS NULL
           AND (suspended_until IS NULL OR suspended_until < NOW())
         ORDER BY CASE WHEN username_normalized = LOWER($2) THEN 0 ELSE 1 END, username
         LIMIT 10`,
        [`%${safeQ}%`, q]
      );

      const rows = [];
      for (const u of usersResult.rows) {
        if (String(u.id) === String(reqUser)) continue;
        if (!(await canViewCollection(reqUser, u.id, { visibilityKey: "profile" }))) continue;
        // Do not surface accounts involved in an active block (either direction).
        if (await isBlocked(reqUser, u.id)) continue;

        const active = await getActiveFriendship(reqUser, u.id);
        const friendshipStatus = active ? active.status : "none";
        const canReceiveFriendRequest = active
          ? false
          : await canReceiveFriendRequestFrom(reqUser, u.id);

        rows.push({
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          avatarUrl: u.avatar_url,
          friendshipStatus,
          canReceiveFriendRequest
        });
      }
      res.json({ users: rows });
    } catch (err) {
      console.error("[/api/users/search]", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

module.exports = {};
