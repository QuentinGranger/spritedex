// routes-profile.js — extracted from server.js

const analytics = require("../analytics");
const security = require("../security");
const secLog = require("../security-logger");
const { canViewCollection, getRequestingUser, getVisibility, isBlocked, requireSameUser } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");

// ── Profile : GET ──
app.get("/api/profile/:userId", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    const result = await pool.query(
      `SELECT id, username, display_name, avatar_url,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility,
              visibility, privacy, created_at, last_active_at,
              suspended_at, suspended_until
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const profile = result.rows[0];
    const isSelf = String(reqUser) === String(profile.id);
    const isSuspended = profile.suspended_until && new Date(profile.suspended_until) > new Date();
    if (isSuspended && !isSelf) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }
    const visibility = getVisibility(profile);
    const canViewProfile = await canViewCollection(reqUser, profile.id, { visibilityKey: "profile" });
    if (!canViewProfile && !isSelf) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    const payload = {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      createdAt: profile.created_at,
      lastActiveAt: profile.last_active_at,
      visibility
    };
    if (isSelf) {
      payload.privacy = profile.privacy;
      if (profile.suspended_at) payload.suspendedAt = profile.suspended_at;
      if (profile.suspended_until) payload.suspendedUntil = profile.suspended_until;
    }
    res.json(payload);
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
       WHERE sm.user_id = $1 AND sm.status = 'active'`,
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
      `SELECT id, username, display_name, avatar_url, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility,
              visibility, created_at
       FROM users WHERE share_token = $1 AND deleted_at IS NULL`,
      [token]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "Lien de partage invalide ou révoqué" });
    }
    const user = userResult.rows[0];
    const visitor = await getRequestingUser(req);
    if (visitor && await isBlocked(visitor, user.id)) {
      return res.status(403).json({ error: "Accès refusé" });
    }
    const visibility = getVisibility(user);
    let collection = {};
    if (visibility.collection !== "private") {
      const entries = await pool.query(
        "SELECT variant_id, sprite_id, status, priority FROM sprite_entries WHERE user_id = $1",
        [user.id]
      );
      for (const row of entries.rows) {
        collection[row.variant_id] = { spriteId: row.sprite_id, status: row.status, priority: row.priority || "none" };
      }
    }
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name || user.username,
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
  const { username, displayName, avatarUrl, privacy, visibility: visibilityPatch, profileVisibility, collectionVisibility, priorityVisibility, notesVisibility, friendInvitesFrom, squadInvitesFrom, pushPrefFriendCollectionUpdates, pushPrefFriendPriorityMatches } = req.validatedBody;
  try {
    // Build the new visibility object from the existing row, then apply patches.
    const currentRes = await pool.query(
      `SELECT id, privacy, profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!currentRes.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const current = currentRes.rows[0];
    let visibility = getVisibility(current);

    const legacyToVisibility = { private: "private", friends_only: "friends", squad_only: "squad", public: "public" };
    if (privacy && legacyToVisibility[privacy]) {
      const v = legacyToVisibility[privacy];
      visibility = { ...visibility, profile: v, collection: v, priorities: v, notes: v };
    }
    if (visibilityPatch) {
      visibility = { ...visibility, ...visibilityPatch };
    }
    if (profileVisibility) visibility.profile = profileVisibility;
    if (collectionVisibility) visibility.collection = collectionVisibility;
    if (priorityVisibility) visibility.priorities = priorityVisibility;
    if (notesVisibility) visibility.notes = notesVisibility;

    const sets = [];
    const vals = [];
    let idx = 1;
    if (username && username.trim().length >= 3) {
      sets.push(`username = $${idx++}`);
      vals.push(username.trim());
    }
    if (displayName && displayName.trim().length >= 1) {
      sets.push(`display_name = $${idx++}`);
      vals.push(displayName.trim());
    }
    if (avatarUrl !== undefined) {
      sets.push(`avatar_url = $${idx++}`);
      vals.push(avatarUrl || "");
    }
    sets.push(`visibility = $${idx++}`);
    vals.push(JSON.stringify(visibility));
    // Keep legacy columns synchronised for any code still reading them directly.
    sets.push(`profile_visibility = $${idx++}`);
    vals.push(visibility.profile);
    sets.push(`collection_visibility = $${idx++}`);
    vals.push(visibility.collection);
    sets.push(`priority_visibility = $${idx++}`);
    vals.push(visibility.priorities);
    sets.push(`notes_visibility = $${idx++}`);
    vals.push(visibility.notes);
    if (privacy) {
      sets.push(`privacy = $${idx++}`);
      vals.push(privacy);
    }

    if (friendInvitesFrom && ["everyone", "mutual_squad_members", "nobody"].includes(friendInvitesFrom)) {
      sets.push(`friend_invites_from = $${idx++}`);
      vals.push(friendInvitesFrom);
    }
    if (squadInvitesFrom && ["everyone", "mutual_squad_members", "friends", "nobody"].includes(squadInvitesFrom)) {
      sets.push(`squad_invites_from = $${idx++}`);
      vals.push(squadInvitesFrom);
    }
    if (pushPrefFriendCollectionUpdates !== undefined) {
      sets.push(`push_pref_friend_collection_updates = $${idx++}`);
      vals.push(pushPrefFriendCollectionUpdates);
    }
    if (pushPrefFriendPriorityMatches !== undefined) {
      sets.push(`push_pref_friend_priority_matches = $${idx++}`);
      vals.push(pushPrefFriendPriorityMatches);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Rien à mettre à jour" });
    vals.push(userId);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`, vals);
    secLog.logSecurityEvent(pool, { req, userId, event: "profile_updated", status: "ok", details: { changed: sets.map(s => s.split(" = ")[0]) } });
    const updated = await pool.query(
      `SELECT id, username, display_name, avatar_url, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility,
              visibility, created_at, last_active_at FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    const row = updated.rows[0];
    res.json({
      ...row,
      visibility: getVisibility(row)
    });
  } catch (err) {
    if (err.code === "23505" && err.constraint === "idx_users_username_normalized") {
      return res.status(409).json({ error: "Ce pseudo est déjà pris" });
    }
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);

    // Cancel pending friend invitations from or to this account.
    await client.query(
      `UPDATE friendships
       SET status = 'declined', responded_at = NOW(), updated_at = NOW()
       WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'pending'`,
      [userId]
    );

    // Revoke/delete shareable links owned by the account.
    await client.query("DELETE FROM friend_invite_links WHERE owner_id = $1", [userId]);
    await client.query("UPDATE compare_share_tokens SET revoked_at = NOW() WHERE owner_user_id = $1", [userId]);
    await client.query("UPDATE users SET share_token = NULL WHERE id = $1", [userId]);

    // Anonymise shared activity history by detaching the user id and remove private history.
    await client.query("UPDATE squad_activity SET user_id = NULL WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM collection_history WHERE user_id = $1", [userId]);

    await client.query("UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [userId]);
    await client.query("COMMIT");
    secLog.logSecurityEvent(pool, { req, userId, event: "account_deleted", status: "ok" });
    res.json({ ok: true, scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// ── Profile : suspend / unsuspend (self-service temporary deactivation) ──
app.post("/api/profile/:userId/suspend", security.validateBody(security.schemas.profileSuspendSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { durationMinutes } = req.validatedBody || {};
  const until = new Date(Date.now() + (durationMinutes || 60) * 60 * 1000);
  try {
    await pool.query(
      "UPDATE users SET suspended_at = NOW(), suspended_until = $1 WHERE id = $2 AND deleted_at IS NULL",
      [until.toISOString(), userId]
    );
    secLog.logSecurityEvent(pool, { req, userId, event: "account_suspended", status: "ok", details: { until } });
    res.json({ ok: true, suspendedUntil: until.toISOString() });
  } catch (err) {
    console.error("[SUSPEND] error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/profile/:userId/unsuspend", async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  try {
    await pool.query(
      "UPDATE users SET suspended_at = NULL, suspended_until = NULL WHERE id = $1 AND deleted_at IS NULL",
      [userId]
    );
    secLog.logSecurityEvent(pool, { req, userId, event: "account_unsuspended", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[UNSUSPEND] error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

