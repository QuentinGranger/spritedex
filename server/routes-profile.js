// routes-profile.js — extracted from server.js

const analytics = require("../analytics");
const security = require("../security");
const secLog = require("../security-logger");
const { canViewCollection, getRequestingUser, getVisibility, hashCapabilityToken, isBlocked, requireNotSuspended, requireSameUser } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");
const { invalidateSquadAnalysisCacheForUser } = require("./squad-analysis-cache");
const { revokeUserSockets } = require("./ws");
const { normalizeCookieConsent } = require("./consent");

const consentLimiter = security.rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyPrefix: "consent",
  message: "Trop de mises à jour du consentement. Réessaie dans quelques minutes."
});

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
    const canViewActivity = isSelf || await canViewCollection(reqUser, profile.id, { visibilityKey: "activity" });

    const payload = {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      createdAt: profile.created_at,
      // Activity has its own granular visibility setting.  A public profile
      // must not make the owner's last-seen timestamp public by accident.
      lastActiveAt: canViewActivity ? profile.last_active_at : null,
      visibility
    };
    if (isSelf) {
      payload.privacy = profile.privacy;
      if (profile.suspended_at) payload.suspendedAt = profile.suspended_at;
      if (profile.suspended_until) payload.suspendedUntil = profile.suspended_until;
      try {
        const participation = await require("./sprite-graph-governance")
          .getCommunityStatsOptIn(pool, profile.id);
        payload.communityStatsOptIn = participation?.communityStatsOptIn ?? null;
        payload.communityStatsParticipation = participation?.participates ?? false;
        payload.essentialFeaturesRequireCommunityConsent = false;
      } catch (_) {
        payload.communityStatsOptIn = null;
        payload.essentialFeaturesRequireCommunityConsent = false;
      }
    }
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collector passport ────────────────────────────────────────────────────
const passportService = require("./passport");
const { ensureCollectorPassport } = passportService;

app.get("/api/profile/:userId/passport", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await passportService.getCollectorPassport(reqUser, req.params.userId);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    const { logPassportOpened } = require("./routes-passport");
    logPassportOpened(reqUser, result.passport.user && result.passport.user.id, "profile_passport");
    // Étape 70 — optional normalized envelope.
    if (String(req.query.format || "").toLowerCase() === "normalized") {
      const { normalizePassportResponse } = require("./passport-normalize");
      return res.json(normalizePassportResponse(result.passport, {
        relationship: result.passport.relationship,
        actions: result.passport.actions,
        publicUrl: result.passport.publicUrl
      }));
    }
    res.json(result.passport);
  } catch (err) {
    console.error("[/api/profile/:userId/passport]", err);
    res.status(500).json({ error: "Impossible de calculer le passeport" });
  }
});

// Étape 67/70 — public stable username passport.
app.get("/api/u/:username/passport", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  try {
    const { resolveUsernameSlug } = require("./username-history");
    const resolved = await resolveUsernameSlug(req.params.username);
    if (resolved.status === "redirect") {
      return res.redirect(302, `/api/u/${encodeURIComponent(resolved.to)}/passport${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
    }
    if (resolved.status !== "ok") {
      return res.status(404).json({ error: "Passeport non trouvé" });
    }
    const result = await passportService.getCollectorPassport(reqUser || null, resolved.user.id);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    const { logPassportOpened } = require("./routes-passport");
    logPassportOpened(reqUser || null, resolved.user.id, "public_username");
    const { normalizePassportResponse } = require("./passport-normalize");
    res.json(normalizePassportResponse(result.passport, {
      relationship: result.passport.relationship,
      actions: result.passport.actions,
      publicUrl: `/u/${encodeURIComponent(resolved.user.username)}`
    }));
  } catch (err) {
    console.error("[/api/u/:username/passport]", err);
    res.status(500).json({ error: "Impossible de charger le passeport" });
  }
});

// Share-card safe payload (Étapes 68–69) — only public-safe fields.
app.get("/api/u/:username/passport/card", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  try {
    const { resolveUsernameSlug } = require("./username-history");
    const resolved = await resolveUsernameSlug(req.params.username);
    if (resolved.status === "redirect") {
      return res.redirect(302, `/api/u/${encodeURIComponent(resolved.to)}/passport/card`);
    }
    if (resolved.status !== "ok") return res.status(404).json({ error: "Passeport non trouvé" });
    // Card requires the viewer to be the owner (preview before share) OR passport public.
    const result = await passportService.getCollectorPassport(reqUser || null, resolved.user.id);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    const p = result.passport;
    const isOwner = reqUser && String(reqUser) === String(resolved.user.id);
    if (!isOwner && !(p.permissions && p.permissions.passport)) {
      return res.status(403).json({ error: "Carte non disponible" });
    }
    const c = p.collection || {};
    const cat = p.catalogue || {};
    const squad = p.primarySquad && !p.primarySquad.private ? p.primarySquad : null;
    const featured = p.featuredBadge;
    const completedEventCount = p.eventsCompleted != null
      ? p.eventsCompleted
      : (p.events && p.events.completedCount != null ? p.events.completedCount : null);
    // Étapes 68–69 — never email, notes, friends list, private fields, or hidden activity.
    res.json({
      username: p.user.username,
      displayName: p.user.displayName || p.user.username,
      avatarUrl: p.user.avatarUrl || "",
      completionRateDisplay: c.completionRateDisplay != null ? c.completionRateDisplay : null,
      ownedVariantCount: c.ownedVariantCount != null ? c.ownedVariantCount : null,
      releasedVariantCount: c.releasedVariantCount != null ? c.releasedVariantCount : (cat.releasedVariantCount || null),
      completedEventCount,
      featuredBadgeLabel: featured ? featured.label : null,
      primarySquadName: squad ? squad.name : null,
      joinedAt: p.user.createdAt || null,
      publicUrl: `/u/${encodeURIComponent(p.user.username)}`,
      availableFields: {
        squad: !!squad,
        badges: !!featured,
        joinedAt: !!p.user.createdAt,
        completion: c.completionRateDisplay != null || c.ownedVariantCount != null,
        events: completedEventCount != null
      }
    });
  } catch (err) {
    console.error("[/api/u/:username/passport/card]", err);
    res.status(500).json({ error: "Impossible de préparer la carte" });
  }
});

const PASSPORT_VISIBILITY_VALUES = new Set(["private", "friends", "squad", "public"]);
const PASSPORT_SETTING_KEYS = new Set([
  "primarySquadId",
  "featuredBadgeId",
  "passportVisibility",
  "statisticsVisibility",
  "badgesVisibility",
  "activityVisibility",
  "comparisonsVisibility",
  "showJoinDate",
  "showLastActivity"
]);

app.get("/api/profile/:userId/passport/settings", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    const [settings, squads, unlockedBadges] = await Promise.all([
      ensureCollectorPassport(req.params.userId),
      pool.query(`SELECT s.id, s.name FROM squads s JOIN squad_members sm ON sm.squad_id = s.id
                  WHERE sm.user_id = $1 AND sm.status = 'active' ORDER BY sm.joined_at ASC`, [req.params.userId]),
      require("./passport-badges").listUserBadges(req.params.userId)
    ]);
    // Deduplicate family badges by badgeId for the pin picker.
    const seen = new Set();
    const availableFeaturedBadges = [];
    for (const b of unlockedBadges) {
      const id = b.badgeId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      availableFeaturedBadges.push({ id, code: b.code, label: b.label });
    }
    res.json({
      primarySquadId: settings.primary_squad_id,
      featuredBadgeId: settings.featured_badge_id || null,
      passportVisibility: settings.passport_visibility,
      statisticsVisibility: settings.statistics_visibility,
      badgesVisibility: settings.badges_visibility,
      activityVisibility: settings.activity_visibility,
      comparisonsVisibility: settings.comparisons_visibility,
      showJoinDate: settings.show_join_date,
      showLastActivity: settings.show_last_activity,
      availableSquads: squads.rows.map(s => ({ id: s.id, name: s.name })),
      availableFeaturedBadges
    });
  } catch (err) {
    console.error("[/passport/settings GET]", err);
    res.status(500).json({ error: "Impossible de charger les réglages du passeport" });
  }
});

app.patch("/api/profile/:userId/passport/settings", requireNotSuspended, async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
  if (!body || Object.keys(body).some(key => !PASSPORT_SETTING_KEYS.has(key))) return res.status(400).json({ error: "Réglages invalides" });
  const visibilityKeys = ["passportVisibility", "statisticsVisibility", "badgesVisibility", "activityVisibility", "comparisonsVisibility"];
  if (visibilityKeys.some(key => key in body && !PASSPORT_VISIBILITY_VALUES.has(body[key]))) return res.status(400).json({ error: "Visibilité invalide" });
  if (["showJoinDate", "showLastActivity"].some(key => key in body && typeof body[key] !== "boolean")) return res.status(400).json({ error: "Option invalide" });
  try {
    const { patchPassportSettings } = require("./routes-passport");
    const result = await patchPassportSettings(req.params.userId, body);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json(result.values);
  } catch (err) {
    console.error("[/passport/settings PATCH]", err);
    res.status(500).json({ error: "Impossible d'enregistrer les réglages du passeport" });
  }
});

// ── Consent update (owner only) ──
app.patch("/api/consent", consentLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body == null ? {} : req.body;
  const isPlainBody = body && typeof body === "object" && !Array.isArray(body) &&
    (Object.getPrototypeOf(body) === Object.prototype || Object.getPrototypeOf(body) === null);
  const allowedKeys = new Set(["cookieConsent", "communityStatsOptIn"]);
  if (!isPlainBody || Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return res.status(400).json({ error: "Consentement invalide" });
  }
  if (!("cookieConsent" in body) && !("communityStatsOptIn" in body)) {
    return res.status(400).json({ error: "Consentement invalide" });
  }
  try {
    let cookiePayload = null;
    if ("cookieConsent" in body) {
      cookiePayload = normalizeCookieConsent(body.cookieConsent);
      if (!cookiePayload) return res.status(400).json({ error: "Consentement invalide" });
      await pool.query(
        "UPDATE users SET cookie_consent = $1 WHERE id = $2 AND deleted_at IS NULL",
        [JSON.stringify(cookiePayload), reqUser]
      );
    }
    // Étape 68 — community stats opt-in is separate; never required for essentials.
    let communityStatsOptIn = undefined;
    if ("communityStatsOptIn" in body) {
      if (typeof body.communityStatsOptIn !== "boolean") {
        return res.status(400).json({ error: "Consentement invalide" });
      }
      const gov = require("./sprite-graph-governance");
      const row = await gov.setCommunityStatsOptIn(pool, reqUser, body.communityStatsOptIn);
      communityStatsOptIn = row ? row.community_stats_opt_in : body.communityStatsOptIn;
    }
    secLog.logSecurityEvent(pool, {
      req,
      userId: reqUser,
      event: "consent_updated",
      status: "ok",
      details: { payload: cookiePayload, communityStatsOptIn }
    });
    const participation = await require("./sprite-graph-governance").getCommunityStatsOptIn(pool, reqUser);
    res.json({
      ok: true,
      communityStatsOptIn: participation?.communityStatsOptIn ?? null,
      essentialFeaturesRequireCommunityConsent: false
    });
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
              cookie_consent, age_confirmed, push_enabled, share_token,
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
    // Protect exports against a legacy collection row named "__proto__".
    const collection = Object.create(null);
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
      `SELECT platform, is_active AS enabled, created_at, updated_at, endpoint
       FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
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
        cookieConsent: user.cookie_consent,
        communityStatsOptIn: (
          await require("./sprite-graph-governance").getCommunityStatsOptIn(pool, reqUser)
        )?.communityStatsOptIn ?? null,
        essentialFeaturesRequireCommunityConsent: false
      },
      // The stored value is a digest of a bearer link, never expose it even
      // to an export consumer.
      shareLinkActive: !!user.share_token,
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
    res.json({ active: !!result.rows[0].share_token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/profile/:userId/share-link", requireNotSuspended, async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    // The browser is the only place that sees the raw bearer capability.
    // Reissuing deliberately rotates any previous link, because a digest
    // cannot safely be turned back into its original token.
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashCapabilityToken(token);
    const updated = await pool.query(
      "UPDATE users SET share_token = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id",
      [tokenHash, req.params.userId]
    );
    if (!updated.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
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
    const tokenHash = hashCapabilityToken(token);
    if (!tokenHash) return res.status(404).json({ error: "Lien de partage invalide" });
    const userResult = await pool.query(
      `SELECT id, username, display_name, avatar_url, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility,
              visibility, created_at
       FROM users
       WHERE share_token = $1
         AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until <= NOW())`,
      [tokenHash]
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
    // Collection keys originate from persisted user data and may predate input
    // validation, so use a record without Object.prototype setters.
    let collection = Object.create(null);
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
app.patch("/api/profile/:userId", security.validateBody(security.schemas.profilePatchSchema), requireNotSuspended, async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { username, displayName, avatarUrl, privacy, visibility: visibilityPatch, profileVisibility, collectionVisibility, priorityVisibility, notesVisibility, friendInvitesFrom, squadInvitesFrom, pushPrefFriendCollectionUpdates, pushPrefFriendPriorityMatches } = req.validatedBody;
  try {
    // Build the new visibility object from the existing row, then apply patches.
    const currentRes = await pool.query(
      `SELECT id, username, privacy, profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
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
      const nextUsername = username.trim();
      const usernameHistory = require("./username-history");
      if (await usernameHistory.isUsernameReserved(nextUsername, { exceptUserId: Number(userId) })) {
        return res.status(409).json({ error: "Ce pseudo est déjà pris ou temporairement réservé" });
      }
      if (usernameHistory.normalizeUsername(current.username) !== usernameHistory.normalizeUsername(nextUsername)) {
        await usernameHistory.recordUsernameChange(userId, current.username);
      }
      sets.push(`username = $${idx++}`);
      vals.push(nextUsername);
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
    invalidateSquadAnalysisCacheForUser(userId);
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
    revokeUserSockets(userId, "Account deleted");
    invalidateSquadAnalysisCacheForUser(userId);
    // Étape 67 — anonymize graph events (async; must not block deletion response).
    setImmediate(() => {
      require("./sprite-graph-governance").anonymizeUserGraphData(pool, userId, {
        recalculateSensitive: process.env.GRAPH_RECALC_ON_DELETE === "1"
      }).catch((err) =>
        console.error("[sprite-graph] account deletion anonymization failed:", err.message)
      );
    });
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
    const result = await pool.query(
      `UPDATE users
       SET suspended_at = NOW(),
           suspended_until = $1,
           suspension_source = 'self',
           suspension_reason = NULL
       WHERE id = $2
         AND deleted_at IS NULL
         AND (suspension_source IS DISTINCT FROM 'admin' OR suspended_until <= NOW())
       RETURNING id`,
      [until.toISOString(), userId]
    );
    if (!result.rows.length) {
      return res.status(403).json({ error: "Cette suspension a été appliquée par un administrateur" });
    }
    revokeUserSockets(userId, "Account suspended");
    invalidateSquadAnalysisCacheForUser(userId);
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
    const result = await pool.query(
      `UPDATE users
       SET suspended_at = NULL,
           suspended_until = NULL,
           suspension_source = NULL,
           suspension_reason = NULL
       WHERE id = $1
         AND deleted_at IS NULL
         AND (suspension_source IS DISTINCT FROM 'admin' OR suspended_until <= NOW())
       RETURNING id`,
      [userId]
    );
    if (!result.rows.length) {
      return res.status(403).json({ error: "Cette suspension ne peut être levée que par un administrateur" });
    }
    invalidateSquadAnalysisCacheForUser(userId);
    secLog.logSecurityEvent(pool, { req, userId, event: "account_unsuspended", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[UNSUSPEND] error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
