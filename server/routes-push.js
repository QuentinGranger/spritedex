// routes-push.js — extracted from server.js

const pushService = require("../push-service");
const pushSubscriptions = require("./push-subscriptions");
const security = require("../security");
const secLog = require("../security-logger");
const { getRequestingUser, requireNotSuspended } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Push notifications : public VAPID key ──
app.get("/api/push/vapid-key", (req, res) => {
  res.json({ publicKey: pushService.getVapidPublicKey() });
});

// ── Push notifications : register / unregister device (Étape 44) ──
// Body (web):
//   { platform: "web", subscription: { endpoint, keys: { p256dh, auth } } }
//   or legacy { platform: "web", token: "<PushSubscription JSON>" }
// Body (native):
//   { platform: "ios"|"android", token: "<device token>" }
app.post("/api/push/register", security.pushRegistrationLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body || {};
  const platform = pushSubscriptions.normalizePlatform(body.platform || "web");
  const hasWeb = !!(body.subscription || (body.token && platform === "web"));
  const hasNative = !!(body.token && (platform === "ios" || platform === "android"));
  const hasStructured = !!(body.endpoint || body.publicKey || body.public_key);
  if (!hasWeb && !hasNative && !hasStructured && !body.token) {
    return res.status(400).json({ error: "Token ou subscription requis" });
  }
  try {
    const row = await pushSubscriptions.registerSubscription(pool, reqUser, body);
    secLog.logSecurityEvent(pool, {
      req,
      userId: reqUser,
      event: "push_token_registered",
      status: "ok",
      details: { platform: row.platform, subscriptionId: row.id }
    });
    res.json({ ok: true, subscriptionId: row.id, platform: row.platform });
  } catch (err) {
    if (["endpoint_or_token_required", "invalid_platform", "invalid_web_subscription", "invalid_native_token"].includes(err.code)) {
      return res.status(400).json({ error: "Abonnement push invalide" });
    }
    console.error("[PUSH] register error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/push/register", security.pushRegistrationLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { token, endpoint } = req.body || {};
  const identifier = token || endpoint;
  // This is an owner-scoped delete, but do not pass arbitrary objects or the
  // full JSON request ceiling into SQL lookups. A normal Web Push endpoint,
  // native token, or legacy serialized subscription is well below this size.
  if (typeof identifier !== "string" || !identifier || identifier.length > 8192) {
    return res.status(400).json({ error: "Token ou endpoint invalide" });
  }
  try {
    await pushService.unregisterToken(pool, reqUser, identifier);
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "push_token_unregistered", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[PUSH] unregister error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// List active devices for the current user.
app.get("/api/push/subscriptions", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const rows = await pushSubscriptions.getActiveSubscriptionsForUser(pool, reqUser);
    res.json({
      subscriptions: rows.map(r => ({
        id: r.id,
        platform: r.platform,
        endpoint: r.endpoint,
        lastUsedAt: r.last_used_at
      }))
    });
  } catch (err) {
    console.error("[PUSH] list subscriptions error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Étape 59 — canonical push subscription endpoints ──
// POST /api/push-subscriptions  (alias of /api/push/register)
app.post("/api/push-subscriptions", security.pushRegistrationLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body || {};
  const platform = pushSubscriptions.normalizePlatform(body.platform || "web");
  const hasWeb = !!(body.subscription || (body.token && platform === "web"));
  const hasNative = !!(body.token && (platform === "ios" || platform === "android"));
  const hasStructured = !!(body.endpoint || body.publicKey || body.public_key);
  if (!hasWeb && !hasNative && !hasStructured && !body.token) {
    return res.status(400).json({ error: "Token ou subscription requis" });
  }
  try {
    const row = await pushSubscriptions.registerSubscription(pool, reqUser, body);
    secLog.logSecurityEvent(pool, {
      req,
      userId: reqUser,
      event: "push_token_registered",
      status: "ok",
      details: { platform: row.platform, subscriptionId: row.id }
    });
    res.status(201).json({
      ok: true,
      subscriptionId: row.id,
      id: row.id,
      platform: row.platform
    });
  } catch (err) {
    if (["endpoint_or_token_required", "invalid_platform", "invalid_web_subscription", "invalid_native_token"].includes(err.code)) {
      return res.status(400).json({ error: "Abonnement push invalide" });
    }
    console.error("[PUSH] /api/push-subscriptions register error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// DELETE /api/push-subscriptions/:subscriptionId
app.delete("/api/push-subscriptions/:subscriptionId", security.pushRegistrationLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const subscriptionId = req.params.subscriptionId;
  if (!subscriptionId || !UUID_RE.test(subscriptionId)) {
    return res.status(400).json({ error: "subscriptionId invalide" });
  }
  try {
    const outcome = await pushSubscriptions.deactivateSubscriptionForUser(
      pool, reqUser, subscriptionId, { reason: "user_disabled" }
    );
    if (!outcome.deactivated) {
      return res.status(404).json({ error: "Appareil introuvable" });
    }
    secLog.logSecurityEvent(pool, {
      req,
      userId: reqUser,
      event: "push_token_unregistered",
      status: "ok",
      details: { subscriptionId: outcome.subscriptionId }
    });
    res.json({ ok: true, deactivated: true, subscriptionId: outcome.subscriptionId });
  } catch (err) {
    console.error("[PUSH] /api/push-subscriptions delete error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Push notifications : user preferences ──
app.get("/api/push/preferences", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT push_enabled,
              push_pref_new_sprites,
              push_pref_new_variants,
              push_pref_squad_activity,
              push_pref_session_summary,
              push_pref_goals,
              push_pref_sync,
              push_pref_news,
              push_reactivation_needed
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const row = result.rows[0];
    const needsReactivation = await pushSubscriptions.userNeedsPushReactivation(pool, reqUser);
    res.json({
      enabled: row.push_enabled,
      newSprites: row.push_pref_new_sprites,
      newVariants: row.push_pref_new_variants,
      squadActivity: row.push_pref_squad_activity,
      sessionSummary: row.push_pref_session_summary,
      goals: row.push_pref_goals,
      sync: row.push_pref_sync,
      news: row.push_pref_news,
      // Étape 45 — client may offer to re-enable push after invalid tokens.
      needsReactivation,
      pushReactivationNeeded: needsReactivation
    });
  } catch (err) {
    console.error("[PUSH] preferences get error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.patch("/api/push/preferences", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body || {};
  const fields = [];
  const values = [];
  let idx = 1;
  const map = {
    enabled: "push_enabled",
    newSprites: "push_pref_new_sprites",
    newVariants: "push_pref_new_variants",
    squadActivity: "push_pref_squad_activity",
    sessionSummary: "push_pref_session_summary",
    goals: "push_pref_goals",
    sync: "push_pref_sync",
    news: "push_pref_news"
  };
  for (const [key, col] of Object.entries(map)) {
    if (typeof body[key] === "boolean") {
      fields.push(`${col} = $${idx++}`);
      values.push(body[key]);
    }
  }
  if (fields.length === 0) return res.status(400).json({ error: "Aucune préférence à mettre à jour" });
  values.push(reqUser);
  try {
    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx}`,
      values
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[PUSH] preferences patch error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
