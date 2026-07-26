// core.js — Express app, HTTP server, WebSocket server, middleware and mailer.

const security = require("../security");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const http = require("http");
const path = require("path");
const { Resend } = require("resend");
const { WebSocketServer } = require("ws");

const ROOT_DIR = require("path").join(__dirname, "..");

// ── __preamble__ ──

// On Render, RENDER_EXTERNAL_URL is auto-injected as the full public https URL.
// Use it as the default public base so OAuth redirects and CORS work on the
// very first deploy without manually setting OAUTH_REDIRECT_BASE.
if (!process.env.OAUTH_REDIRECT_BASE && process.env.RENDER_EXTERNAL_URL) {
  process.env.OAUTH_REDIRECT_BASE = process.env.RENDER_EXTERNAL_URL;
}

security.validateEnv();

const app = express();
// All current query parameters are flat scalars.  The simple parser avoids
// `qs` nested-object semantics and the associated prototype-pollution class.
app.set("query parser", "simple");
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const APP_URL = security.resolvePublicAppUrl({ fallback: `http://localhost:${PORT}` });

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Resend : email service ──
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const FROM_EMAIL = process.env.FROM_EMAIL || "SPRITE-INDEX <quentinsavigny@protonmail.com>";

async function sendVerificationEmail(toEmail, token) {
  if (!resend) {
    console.warn(`[RESEND] Skipping verification email to ${toEmail} (RESEND_API_KEY not configured).`);
    return;
  }
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Vérifie ton email — SPRITE-INDEX",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SPRITE-INDEX</h1>
          <p style="margin:0 0 24px;color:rgba(255,255,255,0.7);font-size:14px;">Confirme ton adresse email pour activer ton compte.</p>
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00e1ff,#8d7cff);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Vérifier mon email</a>
          <p style="margin:24px 0 0;color:rgba(255,255,255,0.4);font-size:12px;">Si tu n'as pas créé de compte, ignore cet email.</p>
        </div>
      `
    });
    console.log(`[RESEND] Verification email sent to ${toEmail}`);
  } catch (err) {
    console.error("[RESEND] Failed to send verification email:", err);
  }
}

async function sendPasswordResetEmail(toEmail, token) {
  if (!resend) {
    console.warn(`[RESEND] Skipping password reset email to ${toEmail} (RESEND_API_KEY not configured).`);
    return;
  }
  const resetUrl = `${APP_URL}/?resetToken=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Réinitialisation de mot de passe — SPRITE-INDEX",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SPRITE-INDEX</h1>
          <p style="margin:0 0 24px;color:rgba(255,255,255,0.7);font-size:14px;">Une demande de réinitialisation de mot de passe a été effectuée. Ce lien expire dans 1 heure.</p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00e1ff,#8d7cff);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Réinitialiser mon mot de passe</a>
          <p style="margin:24px 0 0;color:rgba(255,255,255,0.4);font-size:12px;">Si tu n'as pas fait cette demande, ignore cet email — ton mot de passe reste inchangé.</p>
        </div>
      `
    });
    console.log(`[RESEND] Password reset email sent to ${toEmail}`);
  } catch (err) {
    console.error("[RESEND] Failed to send password reset email:", err);
  }
}

// Generic notification email (channel = 'email'). Reserved for important alerts
// or summaries; best-effort and a no-op when RESEND is not configured.
async function sendNotificationEmail(toEmail, { title, body, url } = {}) {
  if (!resend) {
    console.warn(`[RESEND] Skipping notification email to ${toEmail} (RESEND_API_KEY not configured).`);
    return { ok: false, skipped: true };
  }
  if (!toEmail) return { ok: false, skipped: true };
  // Notifications must not turn an attacker-supplied URL into a trusted email
  // link. Accept only a local path (or an absolute URL on this exact origin).
  let link = `${APP_URL}/`;
  try {
    const candidate = new URL(url || "/", APP_URL);
    if (candidate.origin === APP_URL) link = candidate.toString();
  } catch {
    // Keep the safe application homepage fallback.
  }
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: `${title || "SPRITE-INDEX"} — SPRITE-INDEX`,
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SPRITE-INDEX</h1>
          <h2 style="font-size:18px;margin:0 0 8px;color:#eef0ff;">${escapeHtml(title || "")}</h2>
          <p style="margin:0 0 24px;color:rgba(255,255,255,0.7);font-size:14px;">${escapeHtml(body || "")}</p>
          <a href="${link}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00e1ff,#8d7cff);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Ouvrir SPRITE-INDEX</a>
        </div>
      `
    });
    return { ok: true };
  } catch (err) {
    console.error("[RESEND] Failed to send notification email:", err.message);
    return { ok: false, error: err.message };
  }
}

// Trust forwarded client IPs only when the deployment explicitly declares its
// proxy topology. Blindly enabling this in every production process lets a
// directly reachable instance accept spoofed X-Forwarded-For values and evade
// IP-based throttles.
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);

const corsOrigins = security.resolveCorsOrigins();
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(security.securityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: "200kb" }));
// OAuth callbacks only need flat form fields. Avoid the nested `qs` parser
// altogether so URL-encoded input cannot create surprising object shapes.
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
// Apply the prototype-pollution guard even to legacy endpoints that do not
// use a Zod schema yet.
app.use(security.rejectUnsafeBodyKeys);
// Block server-side source / config files, then serve static assets (dotfiles
// such as .env and .git are denied outright).
app.use(security.blockSensitiveFiles);
const staticAssets = express.static(path.join(ROOT_DIR), { dotfiles: "deny" });
app.use((req, res, next) => {
  if (!security.isPublicStaticPath(req.path)) return next();
  return staticAssets(req, res, next);
});

module.exports = { APP_URL, FROM_EMAIL, PORT, app, corsOrigins, escapeHtml, resend, sendNotificationEmail, sendPasswordResetEmail, sendVerificationEmail, server, wss };
