"use strict";

// Étape 71 — dedicated passport API surface.
const {
  canViewPassportSection,
  getRequestingUser,
  requireNotSuspended
} = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const passportService = require("./passport");
const { ensureCollectorPassport } = passportService;
const { normalizePassportResponse } = require("./passport-normalize");
const passportActivity = require("./passport-activity");
const passportBadges = require("./passport-badges");
const summaryMod = require("./passport-summary");
const analytics = require("../analytics");

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

function parseUserIdParam(raw) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

async function patchPassportSettings(userId, body) {
  const current = await ensureCollectorPassport(userId);
  let primarySquadId = current.primary_squad_id;
  if (Object.prototype.hasOwnProperty.call(body, "primarySquadId")) {
    primarySquadId = body.primarySquadId == null ? null : Number(body.primarySquadId);
    if (primarySquadId !== null && (!Number.isSafeInteger(primarySquadId) || primarySquadId < 1)) {
      return { status: 400, error: "Squad invalide" };
    }
    if (primarySquadId !== null) {
      const membership = await pool.query(
        "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
        [primarySquadId, userId]
      );
      if (!membership.rows.length) {
        return { status: 400, error: "La squad principale doit être une squad active de l'utilisateur" };
      }
    }
  }

  let featuredBadgeId = current.featured_badge_id || null;
  if (Object.prototype.hasOwnProperty.call(body, "featuredBadgeId")) {
    featuredBadgeId = body.featuredBadgeId == null || body.featuredBadgeId === ""
      ? null
      : String(body.featuredBadgeId);
    if (featuredBadgeId) {
      const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(featuredBadgeId);
      if (!uuidOk) return { status: 400, error: "Badge épinglé invalide" };
      const owned = await pool.query(
        `SELECT 1
         FROM user_badges ub
         JOIN badge_definitions d ON d.id = ub.badge_id
         WHERE ub.user_id = $1
           AND ub.badge_id = $2::uuid
           AND ub.revoked_at IS NULL
           AND d.is_active = TRUE
           AND d.is_hidden = FALSE
         LIMIT 1`,
        [userId, featuredBadgeId]
      );
      if (!owned.rows.length) {
        return { status: 400, error: "Le badge épinglé doit être débloqué et visible" };
      }
    }
  }

  const values = {
    primarySquadId: Object.prototype.hasOwnProperty.call(body, "primarySquadId")
      ? primarySquadId
      : current.primary_squad_id,
    featuredBadgeId: Object.prototype.hasOwnProperty.call(body, "featuredBadgeId")
      ? featuredBadgeId
      : (current.featured_badge_id || null),
    passportVisibility: body.passportVisibility ?? current.passport_visibility,
    statisticsVisibility: body.statisticsVisibility ?? current.statistics_visibility,
    badgesVisibility: body.badgesVisibility ?? current.badges_visibility,
    activityVisibility: body.activityVisibility ?? current.activity_visibility,
    comparisonsVisibility: body.comparisonsVisibility ?? current.comparisons_visibility,
    showJoinDate: body.showJoinDate ?? current.show_join_date,
    showLastActivity: body.showLastActivity ?? current.show_last_activity
  };

  await pool.query(
    `UPDATE collector_passports SET
       primary_squad_id = $1,
       featured_badge_id = $2::uuid,
       passport_visibility = $3,
       statistics_visibility = $4,
       badges_visibility = $5,
       activity_visibility = $6,
       comparisons_visibility = $7,
       show_join_date = $8,
       show_last_activity = $9,
       updated_at = NOW()
     WHERE user_id = $10`,
    [
      values.primarySquadId,
      values.featuredBadgeId,
      values.passportVisibility,
      values.statisticsVisibility,
      values.badgesVisibility,
      values.activityVisibility,
      values.comparisonsVisibility,
      values.showJoinDate,
      values.showLastActivity,
      userId
    ]
  );

  const visibilityChanged = [
    "passportVisibility",
    "statisticsVisibility",
    "badgesVisibility",
    "activityVisibility",
    "comparisonsVisibility"
  ].some((key) => Object.prototype.hasOwnProperty.call(body, key));

  if (visibilityChanged) {
    // Étape 73 — visibility change triggers recalc (summary stamp / gated fields).
    summaryMod.schedulePassportRecalc(userId, {
      mode: "queue",
      reason: "visibility_changed",
      triggerEvent: "collection.updated",
      notify: false,
      collectionChanged: false
    }).catch(() => {});
  }

  // Étape 87 — privacy / primary squad product events.
  const privacyKeys = [
    "passportVisibility",
    "statisticsVisibility",
    "badgesVisibility",
    "activityVisibility",
    "comparisonsVisibility",
    "showJoinDate",
    "showLastActivity"
  ].filter((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (privacyKeys.length) {
    analytics.logProductAnalyticsEvent(pool, {
      userId,
      event: "passport_privacy_changed",
      details: { keys: privacyKeys }
    });
  }
  if (
    Object.prototype.hasOwnProperty.call(body, "primarySquadId")
    && String(values.primarySquadId || "") !== String(current.primary_squad_id || "")
  ) {
    analytics.logProductAnalyticsEvent(pool, {
      userId,
      squadId: values.primarySquadId || null,
      event: "passport_primary_squad_selected",
      details: { primarySquadId: values.primarySquadId }
    });
  }

  return { status: 200, values };
}

function logPassportOpened(viewerId, ownerId, source) {
  analytics.logProductAnalyticsEvent(pool, {
    userId: viewerId || null,
    event: "passport_opened",
    details: {
      ownerId: ownerId != null ? String(ownerId) : null,
      source: String(source || "api").slice(0, 80),
      isSelf: viewerId != null && ownerId != null && String(viewerId) === String(ownerId)
    }
  });
}

function buildShareCardFromPassport(p, options = {}) {
  const c = p.collection || {};
  const cat = p.catalogue || {};
  const squad = p.primarySquad && !p.primarySquad.private ? p.primarySquad : null;
  const featured = p.featuredBadge;
  const completedEventCount = p.eventsCompleted != null
    ? p.eventsCompleted
    : (p.events && p.events.completedCount != null ? p.events.completedCount : null);

  const showSquad = options.showSquad !== false && !!squad;
  const showBadges = options.showBadges !== false && !!featured;
  const showJoinedAt = options.showJoinedAt === true && !!p.user.createdAt;
  const showCompletion = options.showCompletion !== false;
  const showEvents = options.showEvents !== false && completedEventCount != null;

  return {
    username: p.user.username,
    displayName: p.user.displayName || p.user.username,
    avatarUrl: options.includeAvatar === false ? "" : (p.user.avatarUrl || ""),
    completionRateDisplay: showCompletion && c.completionRateDisplay != null
      ? c.completionRateDisplay
      : null,
    ownedVariantCount: showCompletion && c.ownedVariantCount != null ? c.ownedVariantCount : null,
    releasedVariantCount: showCompletion
      ? (c.releasedVariantCount != null ? c.releasedVariantCount : (cat.releasedVariantCount || null))
      : null,
    completedEventCount: showEvents ? completedEventCount : null,
    featuredBadgeLabel: showBadges && featured ? featured.label : null,
    primarySquadName: showSquad && squad ? squad.name : null,
    joinedAt: showJoinedAt ? p.user.createdAt : null,
    publicUrl: `/u/${encodeURIComponent(p.user.username)}`,
    format: options.format || "1080x1080",
    // Never include email, notes, friends, private activity.
    availableFields: {
      squad: !!squad,
      badges: !!featured,
      joinedAt: !!p.user.createdAt,
      completion: c.completionRateDisplay != null || c.ownedVariantCount != null,
      events: completedEventCount != null
    }
  };
}

// ── GET /api/passport/me ──
app.get("/api/passport/me", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await passportService.getCollectorPassport(reqUser, reqUser);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    logPassportOpened(reqUser, reqUser, "passport_me");
    if (String(req.query.format || "").toLowerCase() === "normalized") {
      return res.json(normalizePassportResponse(result.passport, {
        relationship: result.passport.relationship,
        actions: result.passport.actions,
        publicUrl: result.passport.publicUrl
      }));
    }
    res.json(result.passport);
  } catch (err) {
    console.error("[/api/passport/me]", err);
    res.status(500).json({ error: "Impossible de calculer le passeport" });
  }
});

// ── GET /api/users/:userId/passport ──
app.get("/api/users/:userId/passport", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const userId = parseUserIdParam(req.params.userId);
  if (!userId) return res.status(400).json({ error: "Utilisateur invalide" });
  try {
    const result = await passportService.getCollectorPassport(reqUser, userId);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    logPassportOpened(reqUser, userId, "users_passport");
    if (String(req.query.format || "").toLowerCase() === "normalized") {
      return res.json(normalizePassportResponse(result.passport, {
        relationship: result.passport.relationship,
        actions: result.passport.actions,
        publicUrl: result.passport.publicUrl
      }));
    }
    res.json(result.passport);
  } catch (err) {
    console.error("[/api/users/:userId/passport]", err);
    res.status(500).json({ error: "Impossible de calculer le passeport" });
  }
});

// ── PATCH /api/passport/settings ──
app.patch("/api/passport/settings", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
  if (!body || Object.keys(body).some((key) => !PASSPORT_SETTING_KEYS.has(key))) {
    return res.status(400).json({ error: "Réglages invalides" });
  }
  const visibilityKeys = ["passportVisibility", "statisticsVisibility", "badgesVisibility", "activityVisibility", "comparisonsVisibility"];
  if (visibilityKeys.some((key) => key in body && !PASSPORT_VISIBILITY_VALUES.has(body[key]))) {
    return res.status(400).json({ error: "Visibilité invalide" });
  }
  if (["showJoinDate", "showLastActivity"].some((key) => key in body && typeof body[key] !== "boolean")) {
    return res.status(400).json({ error: "Option invalide" });
  }
  try {
    const result = await patchPassportSettings(reqUser, body);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json(result.values);
  } catch (err) {
    console.error("[/api/passport/settings]", err);
    res.status(500).json({ error: "Impossible d'enregistrer les réglages du passeport" });
  }
});

app.get("/api/passport/settings", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const [settings, squads, unlockedBadges] = await Promise.all([
      ensureCollectorPassport(reqUser),
      pool.query(
        `SELECT s.id, s.name FROM squads s JOIN squad_members sm ON sm.squad_id = s.id
         WHERE sm.user_id = $1 AND sm.status = 'active' ORDER BY sm.joined_at ASC`,
        [reqUser]
      ),
      passportBadges.listUserBadges(reqUser)
    ]);
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
      availableSquads: squads.rows.map((s) => ({ id: s.id, name: s.name })),
      availableFeaturedBadges
    });
  } catch (err) {
    console.error("[/api/passport/settings GET]", err);
    res.status(500).json({ error: "Impossible de charger les réglages du passeport" });
  }
});

// ── PATCH /api/passport/primary-squad ──
app.patch("/api/passport/primary-squad", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const result = await patchPassportSettings(reqUser, {
      primarySquadId: Object.prototype.hasOwnProperty.call(body, "primarySquadId")
        ? body.primarySquadId
        : body.squadId
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({
      primarySquadId: result.values.primarySquadId,
      ok: true
    });
  } catch (err) {
    console.error("[/api/passport/primary-squad]", err);
    res.status(500).json({ error: "Impossible de choisir la squad principale" });
  }
});

// ── PATCH /api/passport/featured-badge ──
app.patch("/api/passport/featured-badge", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const result = await patchPassportSettings(reqUser, {
      featuredBadgeId: Object.prototype.hasOwnProperty.call(body, "featuredBadgeId")
        ? body.featuredBadgeId
        : body.badgeId
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({
      featuredBadgeId: result.values.featuredBadgeId,
      ok: true
    });
  } catch (err) {
    console.error("[/api/passport/featured-badge]", err);
    res.status(500).json({ error: "Impossible d'épingler le badge" });
  }
});

// ── GET /api/users/:userId/badges ──
app.get("/api/users/:userId/badges", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const userId = parseUserIdParam(req.params.userId);
  if (!userId) return res.status(400).json({ error: "Utilisateur invalide" });
  try {
    const canSee = await canViewPassportSection(reqUser, userId, "badges");
    if (!canSee) return res.status(404).json({ error: "Badges non accessibles" });
    const badgeEngine = require("./badge-engine");
    const [unlocked, progress] = await Promise.all([
      passportBadges.listUserBadges(userId),
      badgeEngine.listBadgeProgress(userId)
    ]);
    res.json({ badges: unlocked, badgeProgress: progress });
  } catch (err) {
    console.error("[/api/users/:userId/badges]", err);
    res.status(500).json({ error: "Impossible de charger les badges" });
  }
});

// ── GET /api/users/:userId/passport/activity ──
app.get("/api/users/:userId/passport/activity", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const userId = parseUserIdParam(req.params.userId);
  if (!userId) return res.status(400).json({ error: "Utilisateur invalide" });
  try {
    const canSee = await canViewPassportSection(reqUser, userId, "activity");
    if (!canSee) return res.status(404).json({ error: "Activité non accessible" });

    const isSelf = String(reqUser) === String(userId);
    let items = await passportActivity.listRecentActivity(userId, {
      limit: Math.min(50, Math.max(1, Number(req.query.limit) || passportActivity.ACTIVITY_FEED_LIMIT))
    });

    if (!isSelf) {
      const { areFriends, shareActiveSquad } = require("./auth");
      const [friendOk, squadOk] = await Promise.all([
        areFriends(reqUser, userId),
        shareActiveSquad(reqUser, userId)
      ]);
      items = items.filter((item) => {
        const vis = String(item.visibility || "friends");
        if (vis === "public") return true;
        if (vis === "private") return false;
        if (vis === "friends") return friendOk;
        if (vis === "squad") return squadOk;
        return false;
      });
    }

    res.json({ recentActivity: items });
  } catch (err) {
    console.error("[/api/users/:userId/passport/activity]", err);
    res.status(500).json({ error: "Impossible de charger l'activité" });
  }
});

// ── POST /api/passport/share-card ──
app.post("/api/passport/share-card", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const result = await passportService.getCollectorPassport(reqUser, reqUser);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    const format = ["1080x1080", "1080x1920", "1200x630"].includes(body.format)
      ? body.format
      : "1080x1080";
    const card = buildShareCardFromPassport(result.passport, {
      showSquad: body.showSquad !== false,
      showBadges: body.showBadges !== false,
      showJoinedAt: body.showJoinedAt === true,
      showCompletion: body.showCompletion !== false,
      showEvents: body.showEvents !== false,
      format
    });
    analytics.logProductAnalyticsEvent(pool, {
      userId: reqUser,
      event: "passport_share_card_generated",
      details: { format }
    });
    res.json(card);
  } catch (err) {
    console.error("[/api/passport/share-card]", err);
    res.status(500).json({ error: "Impossible de générer la carte" });
  }
});

module.exports = {
  patchPassportSettings,
  buildShareCardFromPassport,
  logPassportOpened
};
