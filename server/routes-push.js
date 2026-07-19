// routes-push.js — extracted from server.js

const pushService = require("../push-service");
const secLog = require("../security-logger");
const { getRequestingUser } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");

// ── Push notifications : public VAPID key ──
app.get("/api/push/vapid-key", (req, res) => {
  res.json({ publicKey: pushService.getVapidPublicKey() });
});

// ── Push notifications : register / unregister token ──
app.post("/api/push/register", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { token, platform = "web" } = req.body || {};
  if (!token) return res.status(400).json({ error: "Token requis" });
  try {
    await pushService.registerToken(pool, reqUser, token, platform);
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "push_token_registered", status: "ok", details: { platform } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[PUSH] register error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/push/register", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Token requis" });
  try {
    await pushService.unregisterToken(pool, reqUser, token);
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "push_token_unregistered", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[PUSH] unregister error", err);
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
              push_pref_news
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const row = result.rows[0];
    res.json({
      enabled: row.push_enabled,
      newSprites: row.push_pref_new_sprites,
      newVariants: row.push_pref_new_variants,
      squadActivity: row.push_pref_squad_activity,
      sessionSummary: row.push_pref_session_summary,
      goals: row.push_pref_goals,
      sync: row.push_pref_sync,
      news: row.push_pref_news
    });
  } catch (err) {
    console.error("[PUSH] preferences get error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.patch("/api/push/preferences", async (req, res) => {
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
