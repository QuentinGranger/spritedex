"use strict";

const path = require("path");
const { APP_URL, app } = require("./core");
const { rateLimit } = require("../security");
const {
  ADMIN_SESSION_COOKIE,
  ADMIN_TICKET_TTL_MS,
  adminSessionCookieOptions,
  consumeAdminTicket,
  isAdminSession,
  issueAdminTicket,
  revokeAdminSession,
  verifyAdminPassword
} = require("./admin-access");

const ROOT_DIR = path.join(__dirname, "..");
const terminalAdminLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyPrefix: "terminal-admin",
  message: "Trop de tentatives, réessaie plus tard."
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

function requireAdminPage(req, res, next) {
  if (isAdminSession(req)) return next();
  noStore(res);
  return res.redirect(303, "/admin/access");
}

function requireAdminApi(req, res, next) {
  if (isAdminSession(req)) return next();
  noStore(res);
  return res.status(401).json({ error: "Accès réservé" });
}

// The password is submitted by the local command-line helper over the normal
// HTTPS connection. It is never added to a browser URL or to a client bundle.
app.post("/api/admin/terminal/ticket", terminalAdminLimiter, (req, res) => {
  noStore(res);
  const password = req.body?.password;
  if (!verifyAdminPassword(password)) return res.status(403).json({ error: "Accès refusé" });
  const ticket = issueAdminTicket();
  return res.json({
    accessUrl: accessUrl(ticket),
    expiresInSeconds: Math.floor(ADMIN_TICKET_TTL_MS / 1000)
  });
});

// The fragment is read only by admin-access.html, posted once, then removed
// from the browser history before the user reaches the backoffice.
app.post("/api/admin/terminal/consume", (req, res) => {
  noStore(res);
  const session = consumeAdminTicket(req.body?.ticket);
  if (!session) return res.status(401).json({ error: "Lien d’accès invalide ou expiré" });
  res.cookie(ADMIN_SESSION_COOKIE, session, adminSessionCookieOptions());
  return res.status(204).end();
});

app.get("/api/admin/session", requireAdminApi, (req, res) => {
  noStore(res);
  res.json({ authenticated: true });
});

app.post("/api/admin/logout", requireAdminApi, (req, res) => {
  revokeAdminSession(req);
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

module.exports = { requireAdminApi, requireAdminPage };
