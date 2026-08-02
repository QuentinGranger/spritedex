"use strict";

const path = require("path");
const { APP_URL, app } = require("./core");
const { rateLimit } = require("../security");
const {
  describeAuthz,
  hasAllCapabilities
} = require("./admin-authz");
const { isAdminMfaConfigured, consumeTotpCode } = require("./admin-totp");
const {
  ADMIN_SESSION_COOKIE,
  ADMIN_TICKET_TTL_MS,
  AdminAccessError,
  adminSessionCookieOptions,
  attachAdminSession,
  consumeAdminTicket,
  issueAdminTicket,
  listActiveAdminSessions,
  peekAdminTicket,
  resolveOperatorLabel,
  revokeAdminSession,
  revokeAdminSessionByPublicId,
  revokeOtherAdminSessions,
  verifyAdminPassword,
  normalizeAdminUsername,
  verifyAdminOperatorCredentials,
  listAdminOperators,
  createAdminOperator,
  rotateAdminOperatorSecret,
  setAdminOperatorActive
} = require("./admin-access");
const { writeAdminAudit } = require("./admin-audit");

const ROOT_DIR = path.join(__dirname, "..");
if (process.env.NODE_ENV === "production" && !isAdminMfaConfigured()) {
  console.warn("[admin] ADMIN_TOTP_SECRET is not set — terminal MFA is disabled.");
}
const terminalAdminLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyPrefix: "terminal-admin",
  message: "Trop de tentatives, réessaie plus tard."
});
const terminalConsumeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyPrefix: "terminal-admin-consume",
  message: "Trop de tentatives, réessaie plus tard."
});
const terminalIdentityLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyPrefix: "terminal-admin-identity",
  keyGenerator: (req, ip) => `${ip}:${normalizeAdminUsername(req.body?.username) || "legacy"}`,
  message: "Trop de tentatives pour cet accès administrateur. Réessaie plus tard."
});

function noStore(res) {
  res.set({ "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" });
}

function accessUrl(ticket) {
  const url = new URL("/admin/access", APP_URL);
  // A fragment is never transmitted to the server or logged by a reverse proxy.
  url.hash = ticket;
  return url.toString();
}

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get("user-agent") };
}

function requireAdminPage(req, res, next) {
  attachAdminSession(req, requestMeta(req)).then((session) => {
    if (session) return next();
    noStore(res);
    return res.redirect(303, "/admin/access");
  }).catch(next);
}

function requireAdminApi(req, res, next) {
  attachAdminSession(req, requestMeta(req)).then((session) => {
    if (session) return next();
    noStore(res);
    return res.status(401).json({ error: "Accès réservé" });
  }).catch(next);
}

function requireAdminCapability(...capabilities) {
  const required = capabilities.flat().filter(Boolean);
  return (req, res, next) => {
    attachAdminSession(req, requestMeta(req)).then((session) => {
      noStore(res);
      if (!session) return res.status(401).json({ error: "Accès réservé" });
      if (required.length && !hasAllCapabilities(session, required)) {
        return res.status(403).json({
          error: "Privilège insuffisant",
          required,
          role: session.role || null
        });
      }
      return next();
    }).catch(next);
  };
}

function readAdminMfaCode(req) {
  const header = req.get?.("x-admin-mfa");
  const body = req.body && typeof req.body === "object" ? req.body : {};
  return body.totp || body.mfaCode || header || req.query?.totp || null;
}

// Destructive privacy actions re-check TOTP even with a valid session cookie.
function requireAdminStepUp(req, res, next) {
  if (!isAdminMfaConfigured()) return next();
  const code = readAdminMfaCode(req);
  consumeTotpCode(code, { purpose: "stepup" }).then((result) => {
    noStore(res);
    if (result.ok) return next();
    const replay = result.reason === "replay";
    return res.status(401).json({
      error: replay
        ? "Code MFA déjà utilisé — attendez le prochain"
        : "Confirmation MFA requise",
      code: replay ? "ADMIN_MFA_REPLAY" : "ADMIN_STEPUP_REQUIRED",
      stepUpRequired: true
    });
  }).catch(next);
}

function refreshAdminCookie(res, req) {
  const token = req?.cookies?.[ADMIN_SESSION_COOKIE];
  if (!token || !req.adminSession) return;
  res.cookie(ADMIN_SESSION_COOKIE, token, adminSessionCookieOptions(req.adminSession));
}

// The password is submitted by the local command-line helper over the normal
// HTTPS connection. It is never added to a browser URL or to a client bundle.
app.post("/api/admin/terminal/ticket", terminalAdminLimiter, terminalIdentityLimiter, async (req, res) => {
  noStore(res);
  try {
    const password = req.body?.password;
    const username = normalizeAdminUsername(req.body?.username);
    const operator = username ? await verifyAdminOperatorCredentials(username, password) : null;
    const accepted = operator || (!username && verifyAdminPassword(password));
    if (!accepted) return res.status(403).json({ error: "Accès refusé" });
    const ticket = await issueAdminTicket(requestMeta(req), operator);
    return res.json({
      accessUrl: accessUrl(ticket),
      expiresInSeconds: Math.floor(ADMIN_TICKET_TTL_MS / 1000),
      mfaRequired: isAdminMfaConfigured(),
      authMode: operator ? "named_operator" : "legacy_global"
    });
  } catch (error) {
    if (error?.code === "ADMIN_MFA_NOT_CONFIGURED") {
      return res.status(503).json({ error: error.message, code: error.code });
    }
    console.error("[admin] ticket issue failed:", error.message);
    return res.status(500).json({ error: "Impossible d’émettre le lien d’accès" });
  }
});

function adminText(value, max = 1000) {
  const text = typeof value === "string" ? value.trim().slice(0, max) : "";
  return text || null;
}

app.get("/api/admin/operators", requireAdminCapability("admins.manage"), async (req, res) => {
  noStore(res);
  try {
    const operators = await listAdminOperators();
    const alerts = await require("./db").pool.query(
      `SELECT a.id, a.operator_id, o.username, a.severity, a.kind, a.details, a.created_at, a.acknowledged_at, a.acknowledged_by
       FROM admin_security_alerts a LEFT JOIN admin_operators o ON o.id = a.operator_id
       ORDER BY a.acknowledged_at NULLS FIRST, a.created_at DESC LIMIT 30`
    );
    return res.json({ operators, alerts: alerts.rows });
  } catch (error) {
    console.error("[admin] list operators failed:", error.message);
    return res.status(500).json({ error: "Impossible de charger les accès administrateur" });
  }
});

app.post("/api/admin/operators", requireAdminCapability("admins.manage"), requireAdminStepUp, terminalConsumeLimiter, async (req, res) => {
  noStore(res);
  const reason = adminText(req.body?.reason);
  try {
    if (!reason) return res.status(400).json({ error: "Une justification est requise" });
    const operator = await createAdminOperator({ username: req.body?.username, displayName: req.body?.displayName, password: req.body?.password, role: req.body?.role });
    await writeAdminAudit(require("./db").pool, { actor: req.adminSession.actor, action: "admin_operator.created", targetType: "admin_operator", targetId: operator.id, justification: reason, details: { username: operator.username, role: operator.role } });
    return res.status(201).json({ operator });
  } catch (error) {
    const status = error?.code === "23505" ? 409 : (error?.status || 400);
    return res.status(status).json({ error: error?.code === "23505" ? "Cet identifiant administrateur existe déjà" : (error.message || "Création impossible") });
  }
});

app.post("/api/admin/operators/:operatorId/rotate-secret", requireAdminCapability("admins.manage"), requireAdminStepUp, terminalConsumeLimiter, async (req, res) => {
  noStore(res);
  const reason = adminText(req.body?.reason);
  try {
    if (!reason) return res.status(400).json({ error: "Une justification est requise" });
    const operator = await rotateAdminOperatorSecret(req.params.operatorId, req.body?.password);
    if (!operator) return res.status(404).json({ error: "Compte administrateur introuvable ou inactif" });
    await require("./db").pool.query("DELETE FROM admin_access_sessions WHERE operator_id = $1", [operator.id]);
    await writeAdminAudit(require("./db").pool, { actor: req.adminSession.actor, action: "admin_operator.secret_rotated", targetType: "admin_operator", targetId: operator.id, justification: reason, details: { username: operator.username, sessionsRevoked: true } });
    return res.json({ operator, sessionsRevoked: true });
  } catch (error) { return res.status(error?.status || 400).json({ error: error.message || "Rotation impossible" }); }
});

app.patch("/api/admin/operators/:operatorId", requireAdminCapability("admins.manage"), terminalConsumeLimiter, async (req, res) => {
  noStore(res);
  const reason = adminText(req.body?.reason);
  const active = req.body?.active;
  if (typeof active !== "boolean" || !reason) return res.status(400).json({ error: "État et justification requis" });
  if (req.adminSession.operatorId && req.adminSession.operatorId === req.params.operatorId && !active) return res.status(400).json({ error: "Tu ne peux pas désactiver ton propre compte" });
  try {
    const operator = await setAdminOperatorActive(req.params.operatorId, active);
    if (!operator) return res.status(404).json({ error: "Compte administrateur introuvable" });
    await writeAdminAudit(require("./db").pool, { actor: req.adminSession.actor, action: active ? "admin_operator.activated" : "admin_operator.deactivated", targetType: "admin_operator", targetId: operator.id, justification: reason, details: { username: operator.username } });
    return res.json({ operator });
  } catch (error) { return res.status(error?.status || 400).json({ error: error.message || "Mise à jour impossible" }); }
});

app.post("/api/admin/security-alerts/:alertId/acknowledge", requireAdminCapability("admins.manage"), async (req, res) => {
  noStore(res);
  const id = String(req.params.alertId || "");
  if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ error: "Alerte invalide" });
  try {
    const { pool } = require("./db");
    const result = await pool.query("UPDATE admin_security_alerts SET acknowledged_at = NOW(), acknowledged_by = $2 WHERE id = $1 AND acknowledged_at IS NULL RETURNING id", [id, req.adminSession.actor]);
    if (!result.rows.length) return res.status(404).json({ error: "Alerte introuvable ou déjà traitée" });
    await writeAdminAudit(pool, { actor: req.adminSession.actor, action: "security_alert.acknowledged", targetType: "admin_security_alert", targetId: id, justification: "Alerte de sécurité examinée", details: {} });
    return res.status(204).end();
  } catch (error) { return res.status(500).json({ error: "Impossible de traiter l’alerte" }); }
});

// Validates the one-time fragment without consuming it, so the access page
// can collect MFA before opening the durable session.
app.post("/api/admin/terminal/challenge", terminalConsumeLimiter, async (req, res) => {
  noStore(res);
  try {
    const challenge = await peekAdminTicket(req.body?.ticket);
    if (!challenge) return res.status(401).json({ error: "Lien d’accès invalide ou expiré" });
    return res.json({
      valid: true,
      mfaRequired: challenge.mfaRequired,
      role: challenge.role,
      expiresAt: challenge.expiresAt
    });
  } catch (error) {
    console.error("[admin] ticket challenge failed:", error.message);
    return res.status(500).json({ error: "Impossible de vérifier le lien d’accès" });
  }
});

// The fragment is read only by admin-access.html, posted once, then removed
// from the browser history before the user reaches the backoffice.
app.post("/api/admin/terminal/consume", terminalConsumeLimiter, async (req, res) => {
  noStore(res);
  try {
    const session = await consumeAdminTicket(req.body?.ticket, requestMeta(req), {
      totp: req.body?.totp || req.body?.mfaCode || null
    });
    if (!session) return res.status(401).json({ error: "Lien d’accès invalide ou expiré" });
    res.cookie(ADMIN_SESSION_COOKIE, session.token, adminSessionCookieOptions(session));
    return res.status(204).end();
  } catch (error) {
    if (error instanceof AdminAccessError || error?.code === "ADMIN_MFA_INVALID" || error?.code === "ADMIN_MFA_REPLAY") {
      return res.status(error.status || 401).json({
        error: error.message || "Code MFA invalide",
        code: error.code || "ADMIN_MFA_INVALID",
        mfaRequired: true
      });
    }
    console.error("[admin] ticket consume failed:", error.message);
    return res.status(500).json({ error: "Impossible d’ouvrir la session administrateur" });
  }
});

app.get("/api/admin/session", requireAdminApi, (req, res) => {
  noStore(res);
  refreshAdminCookie(res, req);
  const authz = describeAuthz(req.adminSession.role);
  res.json({
    authenticated: true,
    actor: req.adminSession.actor,
    operatorLabel: req.adminSession.actorLabel || resolveOperatorLabel(),
    operatorId: req.adminSession.operatorId || null,
    authMode: req.adminSession.authMode || "legacy_global",
    publicId: req.adminSession.publicId,
    role: authz.role,
    capabilities: authz.capabilities,
    tabs: authz.tabs,
    mfaConfigured: isAdminMfaConfigured(),
    stepUpRequired: isAdminMfaConfigured(),
    expiresAt: req.adminSession.expiresAt,
    maxExpiresAt: req.adminSession.maxExpiresAt,
    createdAt: req.adminSession.createdAt
  });
});

app.get("/api/admin/sessions", requireAdminCapability("sessions.manage"), async (req, res) => {
  noStore(res);
  try {
    const sessions = await listActiveAdminSessions(req.adminSession.publicId);
    return res.json({
      currentPublicId: req.adminSession.publicId,
      sessions
    });
  } catch (error) {
    console.error("[admin] list sessions failed:", error.message);
    return res.status(500).json({ error: "Impossible de lister les sessions" });
  }
});

app.post("/api/admin/sessions/revoke-others", requireAdminCapability("sessions.manage"), async (req, res) => {
  noStore(res);
  try {
    const result = await revokeOtherAdminSessions(req.adminSession.publicId, {
      actor: req.adminSession.actor
    });
    return res.json(result);
  } catch (error) {
    console.error("[admin] revoke other sessions failed:", error.message);
    return res.status(500).json({ error: "Impossible de révoquer les autres sessions" });
  }
});

app.delete("/api/admin/sessions/:publicId", requireAdminCapability("sessions.manage"), async (req, res) => {
  noStore(res);
  try {
    const revoked = await revokeAdminSessionByPublicId(req.params.publicId, {
      actor: req.adminSession.actor,
      exceptPublicId: req.adminSession.publicId
    });
    if (!revoked) return res.status(404).json({ error: "Session introuvable" });
    return res.status(204).end();
  } catch (error) {
    console.error("[admin] revoke session failed:", error.message);
    return res.status(500).json({ error: "Impossible de révoquer la session" });
  }
});

app.post("/api/admin/logout", requireAdminApi, async (req, res) => {
  try {
    await revokeAdminSession(req, { reason: "logout" });
  } catch (error) {
    console.error("[admin] logout failed:", error.message);
  }
  const { maxAge, ...clearOptions } = adminSessionCookieOptions();
  res.clearCookie(ADMIN_SESSION_COOKIE, clearOptions);
  noStore(res);
  res.status(204).end();
});

app.get("/admin/access", (req, res) => {
  noStore(res);
  res.sendFile(path.join(ROOT_DIR, "admin-access.html"));
});

app.get("/admin", requireAdminPage, (req, res) => {
  noStore(res);
  res.sendFile(path.join(ROOT_DIR, "admin.html"));
});

module.exports = { requireAdminApi, requireAdminPage, requireAdminCapability, requireAdminStepUp };
