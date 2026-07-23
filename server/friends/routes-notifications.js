// friends/routes-notifications.js — user notification feed endpoints.

const { getRequestingUser } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const pushService = require("../../push-service");

// ── Notifications ───────────────────────────────────────────────────────────────
app.get("/api/notifications", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const { limit, offset, unread } = req.query;
    const notifications = await pushService.getNotifications(pool, reqUser, {
      limit,
      offset,
      unreadOnly: unread === "true"
    });
    const unreadCountRes = await pool.query(
      "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL",
      [reqUser]
    );
    res.json({ notifications, unreadCount: parseInt(unreadCountRes.rows[0].count) });
  } catch (err) {
    console.error("[/api/notifications]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/notifications/:id/read", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const ok = await pushService.markNotificationRead(pool, reqUser, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Notification introuvable" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/notifications/:id/read]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/notifications/read-all", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    await pushService.markAllNotificationsRead(pool, reqUser);
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/notifications/read-all]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/notifications/:id", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const ok = await pushService.deleteNotification(pool, reqUser, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Notification introuvable" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/notifications/:id]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = {};
