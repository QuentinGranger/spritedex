"use strict";

const { analytics, security, app, pool, getRequestingUser, requireNotSuspended } = require("./shared");

// ── Compare analytics ──
const COMPARE_ANALYTICS_EVENTS_SET = analytics.COMPARE_ANALYTICS_EVENTS;
const ANALYTICS_ADMIN_IDS = new Set(
  String(process.env.ANALYTICS_ADMIN_USER_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(id => /^\d+$/.test(id))
);

function isAnalyticsAdmin(userId) {
  return !!userId && ANALYTICS_ADMIN_IDS.has(String(userId));
}

function sanitizeAnalyticsDetails(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return Object.create(null);
  const clean = Object.create(null);
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 20)) {
    const key = String(rawKey).slice(0, 64);
    if (!/^[A-Za-z0-9_.-]+$/.test(key) || key === "__proto__" || key === "prototype" || key === "constructor") continue;
    if (typeof rawValue === "string") clean[key] = rawValue.slice(0, 200);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) clean[key] = rawValue;
    else if (typeof rawValue === "boolean") clean[key] = rawValue;
    else if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
      clean[key] = sanitizeAnalyticsDetails(rawValue, depth + 1);
    }
  }
  return clean;
}

app.post("/api/analytics/compare", security.analyticsLimiter, requireNotSuspended, async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const { event, details } = req.body || {};
    if (!event || !COMPARE_ANALYTICS_EVENTS_SET.has(event)) {
      return res.status(400).json({ error: "Événement inconnu" });
    }
    const cleanDetails = sanitizeAnalyticsDetails(details);
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event, details: cleanDetails });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/analytics/compare]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/analytics/product", security.analyticsLimiter, requireNotSuspended, async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const { event, details, squadId } = req.body || {};
    if (!event || !analytics.PASSPORT_CLIENT_ANALYTICS_EVENTS.has(event)) {
      return res.status(400).json({ error: "Événement inconnu" });
    }
    const cleanDetails = sanitizeAnalyticsDetails(details);
    const cleanSquadId = Number.isSafeInteger(Number(squadId)) && Number(squadId) > 0
      ? Number(squadId)
      : null;
    analytics.logProductAnalyticsEvent(pool, {
      userId: reqUser,
      squadId: cleanSquadId,
      event,
      details: cleanDetails
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/analytics/product POST]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/analytics/compare", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    if (!isAnalyticsAdmin(reqUser)) return res.status(403).json({ error: "Accès réservé" });
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const metrics = await analytics.getCompareAnalyticsMetrics(pool, { days });
    res.json(metrics);
  } catch (err) {
    console.error("[/api/analytics/compare]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/analytics/product", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    if (!isAnalyticsAdmin(reqUser)) return res.status(403).json({ error: "Accès réservé" });
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const metrics = await analytics.getProductAnalyticsMetrics(pool, { days });
    res.json(metrics);
  } catch (err) {
    console.error("[/api/analytics/product]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


module.exports = { isAnalyticsAdmin, sanitizeAnalyticsDetails, COMPARE_ANALYTICS_EVENTS_SET };
