// routes-profile.js — extracted from server.js

const analytics = require("../analytics");
const security = require("../security");
const secLog = require("../security-logger");
const { checkPrivacyAccess, getRequestingUser, requireSameUser } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");

// ── Profile : GET ──
app.get("/api/profile/:userId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, avatar_url, privacy, created_at, last_active_at FROM users WHERE id = $1 AND deleted_at IS NULL",
      [req.params.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const profile = result.rows[0];
    const access = await checkPrivacyAccess(req, profile.id, profile.privacy);
    if (access === "blocked") {
      return res.json({ id: profile.id, username: profile.username, privacy: profile.privacy });
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Consent update (owner only) ──
app.patch("/api/consent", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body || {};
  const payload = body.cookieConsent && typeof body.cookieConsent === "object"
    ? { ...body.cookieConsent, consentedAt: body.cookieConsent.consentedAt || new Date().toISOString() }
    : { necessary: true, analytics: false, consentedAt: new Date().toISOString() };
  try {
    await pool.query("UPDATE users SET cookie_consent = $1 WHERE id = $2 AND deleted_at IS NULL", [JSON.stringify(payload), reqUser]);
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "consent_updated", status: "ok", details: { payload } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[CONSENT] update error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Data export (owner only) ──
app.get("/api/export", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const userResult = await pool.query(
      `SELECT id, username, email, avatar_url, privacy, created_at, last_active_at,
              email_verified, cgu_accepted, cgu_version, cgu_accepted_at,
              cookie_consent, age_confirmed, push_enabled,
              push_pref_new_sprites, push_pref_new_variants, push_pref_squad_activity,
              push_pref_session_summary, push_pref_goals, push_pref_sync
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [reqUser]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const user = userResult.rows[0];

    const collectionResult = await pool.query(
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, updated_at FROM sprite_entries WHERE user_id = $1",
      [reqUser]
    );
    const collection = {};
    for (const row of collectionResult.rows) {
      collection[row.variant_id] = {
        spriteId: row.sprite_id,
        status: row.status,
        note: row.note || "",
        priority: row.priority || "none",
        obtainedAt: row.obtained_at || null,
        updatedAt: row.updated_at
      };
    }

    const squadsResult = await pool.query(
      `SELECT s.id, s.code, s.name, s.join_open, s.created_at, sm.joined_at
       FROM squads s
       JOIN squad_members sm ON sm.squad_id = s.id
       WHERE sm.user_id = $1`,
      [reqUser]
    );

    const activityResult = await pool.query(
      `SELECT squad_id, sprite_id, action, created_at
       FROM squad_activity
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [reqUser]
    );

    const historyResult = await pool.query(
      `SELECT sprite_id, old_status, new_status, created_at
       FROM collection_history
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [reqUser]
    );

    const pushTokensResult = await pool.query(
      "SELECT platform, enabled, created_at, updated_at FROM push_tokens WHERE user_id = $1",
      [reqUser]
    );

    res.json({
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        privacy: user.privacy,
        createdAt: user.created_at,
        lastActiveAt: user.last_active_at,
        emailVerified: user.email_verified
      },
      settings: {
        privacy: user.privacy,
        pushEnabled: user.push_enabled,
        pushPreferences: {
          newSprites: user.push_pref_new_sprites,
          newVariants: user.push_pref_new_variants,
          squadActivity: user.push_pref_squad_activity,
          sessionSummary: user.push_pref_session_summary,
          goals: user.push_pref_goals,
          sync: user.push_pref_sync
        }
      },
      consent: {
        cguAccepted: user.cgu_accepted,
        cguVersion: user.cgu_version,
        cguAcceptedAt: user.cgu_accepted_at,
        ageConfirmed: user.age_confirmed,
        cookieConsent: user.cookie_consent
      },
      shareLink: user.share_token || null,
      collection,
      squads: squadsResult.rows,
      squadActivity: activityResult.rows,
      collectionHistory: historyResult.rows,
      pushTokens: pushTokensResult.rows.map(r => ({ platform: r.platform, enabled: r.enabled, createdAt: r.created_at, updatedAt: r.updated_at }))
    });
  } catch (err) {
    console.error("[EXPORT] error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Share link : owner-only management ──
// A share link uses an opaque, cryptographically random 256-bit token instead
// of the sequential numeric user id. Anyone holding the token can view a
// READ-ONLY snapshot of the collection (status + priority only — never notes,
// email or other private fields). The owner can revoke it at any time.
app.get("/api/profile/:userId/share-link", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    const result = await pool.query("SELECT share_token FROM users WHERE id = $1 AND deleted_at IS NULL", [req.params.userId]);
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json({ token: result.rows[0].share_token || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/profile/:userId/share-link", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    const existing = await pool.query("SELECT share_token FROM users WHERE id = $1 AND deleted_at IS NULL", [req.params.userId]);
    if (!existing.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    // Reuse the current token unless the caller explicitly asks to rotate it.
    let token = existing.rows[0].share_token;
    if (!token || req.body?.rotate === true) {
      token = crypto.randomBytes(32).toString("hex");
      await pool.query("UPDATE users SET share_token = $1 WHERE id = $2", [token, req.params.userId]);
    }
    secLog.logSecurityEvent(pool, { req, userId: req.params.userId, event: "share_link_created", status: "ok" });
    res.json({ token });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Collision de token, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/profile/:userId/share-link", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    await pool.query("UPDATE users SET share_token = NULL WHERE id = $1", [req.params.userId]);
    secLog.logSecurityEvent(pool, { req, userId: req.params.userId, event: "share_link_revoked", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Shared profile : public read-only view via opaque token ──
// No authentication required (the unguessable token IS the credential). Only
// non-sensitive fields are exposed: username, avatar and a status/priority
// snapshot of the collection. Notes are deliberately omitted.
app.get("/api/shared/:token", async (req, res) => {
  const token = req.params.token;
  // Reject anything that is not a well-formed token before touching the DB.
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(404).json({ error: "Lien de partage invalide" });
  }
  try {
    const userResult = await pool.query(
      "SELECT id, username, avatar_url, created_at FROM users WHERE share_token = $1 AND deleted_at IS NULL",
      [token]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "Lien de partage invalide ou révoqué" });
    }
    const user = userResult.rows[0];
    const access = await checkPrivacyAccess(req, user.id, user.privacy || "squad_only");
    if (access === "blocked") {
      return res.status(403).json({ error: "Profil non accessible" });
    }
    const entries = await pool.query(
      "SELECT variant_id, sprite_id, status, priority FROM sprite_entries WHERE user_id = $1",
      [user.id]
    );
    const collection = {};
    for (const row of entries.rows) {
      collection[row.variant_id] = { spriteId: row.sprite_id, status: row.status, priority: row.priority || "none" };
    }
    res.json({
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url || "",
      createdAt: user.created_at,
      privacy: user.privacy || "squad_only",
      collection
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Profile : PATCH (update own profile) ──
app.patch("/api/profile/:userId", security.validateBody(security.schemas.profilePatchSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { username, avatarUrl, privacy } = req.validatedBody;
  try {
    const sets = [];
    const vals = [];
    let idx = 1;
    if (username && username.trim().length >= 2) {
      sets.push(`username = $${idx++}`);
      vals.push(username.trim());
    }
    if (avatarUrl !== undefined) {
      sets.push(`avatar_url = $${idx++}`);
      vals.push(avatarUrl || "");
    }
    if (privacy && ["public", "friends_only", "squad_only", "private"].includes(privacy)) {
      sets.push(`privacy = $${idx++}`);
      vals.push(privacy);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Rien à mettre à jour" });
    vals.push(userId);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`, vals);
    secLog.logSecurityEvent(pool, { req, userId, event: "profile_updated", status: "ok", details: { changed: sets.map(s => s.split(" = ")[0]) } });
    const updated = await pool.query(
      "SELECT id, username, avatar_url, privacy, created_at, last_active_at FROM users WHERE id = $1 AND deleted_at IS NULL",
      [userId]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Profile : DELETE (soft-delete account) ──
// The account is marked as deleted and becomes inaccessible immediately.
// Personal data is permanently purged by the cleanup cron after 30 days.
app.delete("/api/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  try {
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [userId]);
    secLog.logSecurityEvent(pool, { req, userId, event: "account_deleted", status: "ok" });
    res.json({ ok: true, scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Friends (used by friends_only privacy) ──
app.get("/api/friends", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, f.status, f.created_at
       FROM friends f
       JOIN users u ON (CASE WHEN f.user_id = $1 THEN f.friend_user_id ELSE f.user_id END) = u.id
       WHERE (f.user_id = $1 OR f.friend_user_id = $1) AND u.deleted_at IS NULL`,
      [reqUser]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/friends/:friendId/request", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const friendId = req.params.friendId;
  if (String(reqUser) === String(friendId)) return res.status(400).json({ error: "Tu ne peux pas t'ajouter toi-même" });
  try {
    const exists = await pool.query("SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", [friendId]);
    if (!exists.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    await pool.query(
      `INSERT INTO friends (user_id, friend_user_id, status) VALUES ($1, $2, 'pending')
       ON CONFLICT (user_id, friend_user_id) DO UPDATE SET status = 'pending', updated_at = NOW()`,
      [reqUser, friendId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/friends/:friendId/accept", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const friendId = req.params.friendId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO friends (user_id, friend_user_id, status, updated_at) VALUES ($1, $2, 'accepted', NOW())
       ON CONFLICT (user_id, friend_user_id) DO UPDATE SET status = 'accepted', updated_at = NOW()`,
      [reqUser, friendId]
    );
    await client.query(
      `UPDATE friends SET status = 'accepted', updated_at = NOW() WHERE user_id = $1 AND friend_user_id = $2`,
      [friendId, reqUser]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

app.delete("/api/friends/:friendId", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const friendId = req.params.friendId;
  try {
    await pool.query(
      `DELETE FROM friends WHERE (user_id = $1 AND friend_user_id = $2) OR (user_id = $2 AND friend_user_id = $1)`,
      [reqUser, friendId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
