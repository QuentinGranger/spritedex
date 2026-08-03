// friends/routes-notifications.js — Étape 59 notification API endpoints.
//
//   GET    /api/notifications
//   GET    /api/notifications/unread-count
//   POST   /api/notifications/:notificationId/read
//   POST   /api/notifications/read-all
//   DELETE /api/notifications/:notificationId          (archive)
//   GET    /api/notification-preferences
//   PATCH  /api/notification-preferences
//   (+ legacy aliases under /api/notifications/preferences)

const { getRequestingUser, requireNotSuspended } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const pushService = require("../../push-service");
const notifPrefs = require("../notification-preferences");
const squadCompletion = require("../notification-squad-completion");
const catalog = require("../notification-catalog");
const security = require("../../security");
const { resolveLocale, rememberPreferredLanguage } = require("../i18n");

const notificationPreferenceLimiter = security.rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyPrefix: "notification-preferences",
  message: "Trop de mises à jour des préférences. Réessaie dans quelques minutes."
});

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateBooleanPreferenceMap(value, isKnown, label) {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isPlainRecord(value)) return { ok: false, error: `${label} invalide` };
  const entries = Object.entries(value);
  if (entries.length > 16) return { ok: false, error: `${label} trop volumineux` };
  for (const [key, enabled] of entries) {
    if (!isKnown(key) || typeof enabled !== "boolean") {
      return { ok: false, error: `${label} invalide` };
    }
  }
  return { ok: true, value };
}

// This route used to accept arbitrary maps and perform one database write per
// key. The JSON parser has a 200 kB ceiling, but that still permits thousands
// of keys and a request-amplified DB DoS. Accept only the compact, catalogued
// settings model exposed by the client.
function validateNotificationPreferencePayload(body) {
  if (!isPlainRecord(body)) return { ok: false, error: "Préférences invalides" };
  const allowedRootKeys = new Set([
    "pushEnabled",
    "categories",
    "types",
    "channels",
    "frequencies",
    "delivery",
    "quietHours",
    "maxPushPerDay",
    "timeZone",
    "timezone"
  ]);
  if (Object.keys(body).some((key) => !allowedRootKeys.has(key))) {
    return { ok: false, error: "Champ de préférence invalide" };
  }
  if (body.pushEnabled !== undefined && typeof body.pushEnabled !== "boolean") {
    return { ok: false, error: "pushEnabled invalide" };
  }

  const categoryMap = validateBooleanPreferenceMap(body.categories, catalog.isKnownCategory, "Catégories");
  if (!categoryMap.ok) return categoryMap;
  const typeMap = validateBooleanPreferenceMap(body.types, catalog.isKnownType, "Types");
  if (!typeMap.ok) return typeMap;
  const channelMap = validateBooleanPreferenceMap(body.channels, catalog.isKnownChannel, "Canaux");
  if (!channelMap.ok) return channelMap;

  if (body.frequencies !== undefined) {
    if (!isPlainRecord(body.frequencies) || Object.keys(body.frequencies).length > 16) {
      return { ok: false, error: "Fréquences invalides" };
    }
    for (const [type, frequency] of Object.entries(body.frequencies)) {
      if (!catalog.isFrequencyConfigurable(type) || !catalog.isKnownFrequency(frequency)) {
        return { ok: false, error: "Fréquence invalide" };
      }
    }
  }

  if (body.delivery !== undefined) {
    if (!isPlainRecord(body.delivery) || Object.keys(body.delivery).length > 16) {
      return { ok: false, error: "Options de livraison invalides" };
    }
    for (const [type, config] of Object.entries(body.delivery)) {
      if (!catalog.isKnownType(type) || !isPlainRecord(config)) {
        return { ok: false, error: "Option de livraison invalide" };
      }
      const keys = Object.keys(config);
      if (
        keys.some((key) => key !== "inApp" && key !== "push") ||
        (config.inApp !== undefined && typeof config.inApp !== "boolean") ||
        (config.push !== undefined &&
          (typeof config.push !== "string" || !catalog.getPushModeOptions(type).includes(config.push)))
      ) {
        return { ok: false, error: "Option de livraison invalide" };
      }
    }
  }

  if (body.quietHours !== undefined) {
    if (
      !isPlainRecord(body.quietHours) ||
      Object.keys(body.quietHours).some((key) => key !== "start" && key !== "end")
    ) {
      return { ok: false, error: "Heures silencieuses invalides" };
    }
    for (const value of [body.quietHours.start, body.quietHours.end]) {
      if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0 || value > 23)) {
        return { ok: false, error: "Heures silencieuses invalides" };
      }
    }
  }

  if (
    body.maxPushPerDay !== undefined &&
    (!Number.isInteger(body.maxPushPerDay) || body.maxPushPerDay < 0 || body.maxPushPerDay > 1000)
  ) {
    return { ok: false, error: "Limite de notifications invalide" };
  }
  for (const value of [body.timeZone, body.timezone]) {
    if (value !== undefined && (typeof value !== "string" || value.length > 64)) {
      return { ok: false, error: "Fuseau horaire invalide" };
    }
  }
  return { ok: true, value: body };
}

function parseBoolQuery(value) {
  if (value === true || value === false) return value;
  const s = String(value ?? "").toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

async function updateNotificationPreferences(reqUser, body = {}) {
  const { pushEnabled, categories, types, channels, frequencies, quietHours, maxPushPerDay, timeZone, timezone } =
    body || {};
  const { isValidTimeZone, normalizeTimeZone } = require("../timezone");

  if (typeof pushEnabled === "boolean") {
    await pool.query("UPDATE users SET push_enabled = $1 WHERE id = $2", [pushEnabled, reqUser]);
  }
  if (categories && typeof categories === "object") {
    for (const [key, enabled] of Object.entries(categories)) {
      if (typeof enabled === "boolean") await notifPrefs.setPreference(pool, reqUser, "category", key, enabled);
    }
  }
  if (types && typeof types === "object") {
    for (const [key, enabled] of Object.entries(types)) {
      if (typeof enabled === "boolean") await notifPrefs.setPreference(pool, reqUser, "type", key, enabled);
    }
  }
  if (channels && typeof channels === "object") {
    for (const [key, enabled] of Object.entries(channels)) {
      if (typeof enabled === "boolean") await notifPrefs.setPreference(pool, reqUser, "channel", key, enabled);
    }
  }
  if (frequencies && typeof frequencies === "object") {
    for (const [key, frequency] of Object.entries(frequencies)) {
      if (typeof frequency === "string") await notifPrefs.setFrequency(pool, reqUser, key, frequency);
    }
  }
  if (body.delivery && typeof body.delivery === "object") {
    for (const [key, cfg] of Object.entries(body.delivery)) {
      if (!cfg || typeof cfg !== "object") continue;
      await notifPrefs.setTypeDelivery(pool, reqUser, key, {
        inApp: typeof cfg.inApp === "boolean" ? cfg.inApp : undefined,
        push: typeof cfg.push === "string" ? cfg.push : undefined
      });
    }
  }
  if (quietHours && typeof quietHours === "object") {
    const norm = (v) => {
      if (v === null) return null;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= 23 ? n : undefined;
    };
    const start = norm(quietHours.start);
    const end = norm(quietHours.end);
    if (start !== undefined) await pool.query("UPDATE users SET push_quiet_start = $1 WHERE id = $2", [start, reqUser]);
    if (end !== undefined) await pool.query("UPDATE users SET push_quiet_end = $1 WHERE id = $2", [end, reqUser]);
  }
  if (maxPushPerDay !== undefined) {
    const n = Number(maxPushPerDay);
    if (Number.isInteger(n) && n >= 0 && n <= 1000) {
      await pool.query("UPDATE users SET push_max_per_day = $1 WHERE id = $2", [n, reqUser]);
    }
  }
  const tzRaw = timeZone || timezone;
  if (typeof tzRaw === "string" && isValidTimeZone(tzRaw.trim())) {
    await pool.query("UPDATE users SET timezone = $1 WHERE id = $2", [normalizeTimeZone(tzRaw), reqUser]);
  }

  return notifPrefs.getPreferences(pool, reqUser);
}

// ── GET /api/notifications ──
// Params: category, unreadOnly, limit, cursor (+ legacy filter/offset/unread)
app.get("/api/notifications", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    await squadCompletion.hideInaccessibleSquadCompletionNotifications(pool, reqUser);
    const { limit, offset, cursor, category, filter, unreadOnly: unreadOnlyRaw, unread } = req.query;
    const unreadOnly =
      parseBoolQuery(unreadOnlyRaw) === true ||
      parseBoolQuery(unread) === true ||
      String(filter || "").toLowerCase() === "unread";

    if (cursor != null && cursor !== "" && !pushService.decodeNotificationCursor(cursor)) {
      return res.status(400).json({ error: "cursor invalide" });
    }

    const acceptLanguage = req.get("accept-language");
    const lang = resolveLocale(acceptLanguage);
    await rememberPreferredLanguage(pool, reqUser, acceptLanguage).catch(() => null);

    const page = await pushService.getNotifications(pool, reqUser, {
      limit,
      offset,
      cursor: cursor || null,
      unreadOnly,
      category: category || null,
      filter: filter || null,
      lang
    });

    res.json({
      notifications: page.notifications,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      // Kept for older clients / notification-center UI.
      unreadCount: await pushService.getUnreadNotificationCount(pool, reqUser),
      filter: filter || category || (unreadOnly ? "unread" : "all")
    });
  } catch (err) {
    console.error("[/api/notifications]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── GET /api/notifications/unread-count ──
app.get("/api/notifications/unread-count", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    await squadCompletion.hideInaccessibleSquadCompletionNotifications(pool, reqUser);
    const count = await pushService.getUnreadNotificationCount(pool, reqUser);
    res.json({ count, unreadCount: count });
  } catch (err) {
    console.error("[/api/notifications/unread-count]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Preferences (canonical Étape 59 paths) ──
app.get("/api/notification-preferences", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    res.json(await notifPrefs.getPreferences(pool, reqUser));
  } catch (err) {
    console.error("[GET /api/notification-preferences]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.patch("/api/notification-preferences", notificationPreferenceLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const validated = validateNotificationPreferencePayload(req.body || {});
  if (!validated.ok) return res.status(400).json({ error: validated.error });
  try {
    const prefs = await updateNotificationPreferences(reqUser, validated.value);
    res.json(prefs);
  } catch (err) {
    console.error("[PATCH /api/notification-preferences]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Legacy aliases used by account settings UI / friends tests.
app.get("/api/notifications/preferences", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    res.json(await notifPrefs.getPreferences(pool, reqUser));
  } catch (err) {
    console.error("[GET /api/notifications/preferences]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.put("/api/notifications/preferences", notificationPreferenceLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const validated = validateNotificationPreferencePayload(req.body || {});
  if (!validated.ok) return res.status(400).json({ error: validated.error });
  try {
    const prefs = await updateNotificationPreferences(reqUser, validated.value);
    res.json(prefs);
  } catch (err) {
    console.error("[PUT /api/notifications/preferences]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.patch("/api/notifications/preferences", notificationPreferenceLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const validated = validateNotificationPreferencePayload(req.body || {});
  if (!validated.ok) return res.status(400).json({ error: validated.error });
  try {
    const prefs = await updateNotificationPreferences(reqUser, validated.value);
    res.json(prefs);
  } catch (err) {
    console.error("[PATCH /api/notifications/preferences]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Étape 47/59 — read-all before :notificationId routes.
app.post("/api/notifications/read-all", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const updated = await pushService.markAllNotificationsRead(pool, reqUser);
    res.json({ ok: true, updated });
  } catch (err) {
    console.error("[/api/notifications/read-all]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// POST /api/notifications/:notificationId/read
app.post("/api/notifications/:notificationId/read", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const clicked = req.body?.clicked === true || req.query?.clicked === "true";
    const row = await pushService.markNotificationRead(pool, reqUser, req.params.notificationId, { clicked });
    if (!row) return res.status(404).json({ error: "Notification introuvable" });
    // The read endpoint is the authoritative notification-open signal; the
    // browser cannot forge another user's notification identifier here.
    try {
      const {
        GRAPH_EVENT_TYPES,
        GRAPH_INTERACTION_EVENT_TYPES,
        buildNotificationOpenedContext,
        recordGraphEventSafe
      } = require("../sprite-graph");
      const source = req.get("origin")?.startsWith("capacitor:") ? "ios" : "web";
      const openedContext = buildNotificationOpenedContext(row, {
        channel: clicked ? "in_app" : "in_app",
        openedAt: row.read_at || new Date().toISOString()
      });
      recordGraphEventSafe({
        eventType: GRAPH_EVENT_TYPES.NOTIFICATION_OPENED,
        actorUserId: reqUser,
        notificationId: row.id,
        source,
        origin: "notifications.read",
        context: openedContext,
        deduplicationKey: `${GRAPH_EVENT_TYPES.NOTIFICATION_OPENED}:${row.id}`
      });
      if (clicked) {
        recordGraphEventSafe({
          eventType: GRAPH_INTERACTION_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED,
          actorUserId: reqUser,
          notificationId: row.id,
          source,
          origin: "notifications.read",
          context: { ...openedContext, surface: "notification" },
          deduplicationKey: `${GRAPH_INTERACTION_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED}:${row.id}`
        });
      }
    } catch (graphErr) {
      console.error("[sprite-graph] notification interaction:", graphErr.message);
    }
    res.json({
      ok: true,
      id: row.id,
      read_at: row.read_at,
      clicked_at: row.clicked_at,
      status: row.status
    });
  } catch (err) {
    console.error("[/api/notifications/:notificationId/read]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Soft-archive alias (legacy).
app.post("/api/notifications/:notificationId/archive", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const ok = await pushService.archiveNotification(pool, reqUser, req.params.notificationId);
    if (!ok) return res.status(404).json({ error: "Notification introuvable" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/notifications/:notificationId/archive]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Étape 59 — DELETE archives (soft-remove from inbox).
app.delete("/api/notifications/:notificationId", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const ok = await pushService.archiveNotification(pool, reqUser, req.params.notificationId);
    if (!ok) return res.status(404).json({ error: "Notification introuvable" });
    res.json({ ok: true, archived: true });
  } catch (err) {
    console.error("[DELETE /api/notifications/:notificationId]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = {};
