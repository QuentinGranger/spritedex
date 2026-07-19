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
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Resend : email service ──
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || "SPRITNEX <quentinsavigny@protonmail.com>";
const APP_URL = process.env.OAUTH_REDIRECT_BASE || "http://localhost:3000";

async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Vérifie ton email — SPRITNEX",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SPRITNEX</h1>
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
  const resetUrl = `${APP_URL}/?resetToken=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Réinitialisation de mot de passe — SPRITNEX",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SPRITNEX</h1>
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

// Trust the first proxy hop in production (needed for correct req.ip behind a
// reverse proxy / load balancer, which the rate limiter relies on). In dev we
// do not trust proxy headers so X-Forwarded-For cannot be spoofed.
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);

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
app.use(express.urlencoded({ extended: true, limit: "200kb" }));
// Block server-side source / config files, then serve static assets (dotfiles
// such as .env and .git are denied outright).
app.use(security.blockSensitiveFiles);
app.use(express.static(path.join(ROOT_DIR), { dotfiles: "deny" }));

module.exports = { APP_URL, FROM_EMAIL, PORT, app, corsOrigins, escapeHtml, resend, sendPasswordResetEmail, sendVerificationEmail, server, wss };
