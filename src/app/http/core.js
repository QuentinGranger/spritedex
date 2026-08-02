// core.js — Express app, HTTP server, WebSocket server, middleware and mailer.

const security = require("../../../security");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { renderServiceWorker } = require("../../../scripts/client-cache");
const { renderIndexPage } = require("../../../scripts/index-page");
const { Resend } = require("resend");
const { WebSocketServer } = require("ws");
const { localizeErrorResponse } = require("../../../server/i18n");

const ROOT_DIR = path.join(__dirname, "..", "..", "..");

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
// A verified sender is mandatory.  Falling back to a personal or unverified
// address causes provider rejections and weakens domain alignment.
const FROM_EMAIL = String(process.env.FROM_EMAIL || "").trim();
const REPLY_TO_EMAIL = String(process.env.REPLY_TO_EMAIL || "").trim();
const RESEND_FROM_DOMAIN = String(process.env.RESEND_FROM_DOMAIN || "").trim().toLowerCase().replace(/\.$/, "");
const EMAIL_ADDRESS_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const EMAIL_COPY = Object.freeze({
  fr: Object.freeze({
    verifySubject: "Vérifie ton email — SPRITE-INDEX",
    verifyIntro: "Confirme ton adresse email pour activer ton compte.",
    verifyCta: "Vérifier mon email",
    verifyIgnore: "Si tu n'as pas créé de compte, ignore cet email.",
    resetSubject: "Réinitialisation de mot de passe — SPRITE-INDEX",
    resetIntro: "Une demande de réinitialisation de mot de passe a été effectuée. Ce lien expire dans 1 heure.",
    resetCta: "Réinitialiser mon mot de passe",
    resetIgnore: "Si tu n'as pas fait cette demande, ignore cet email — ton mot de passe reste inchangé.",
    notifOpen: "Ouvrir SPRITE-INDEX"
  }),
  en: Object.freeze({
    verifySubject: "Verify your email — SPRITE-INDEX",
    verifyIntro: "Confirm your email address to activate your account.",
    verifyCta: "Verify my email",
    verifyIgnore: "If you did not create an account, ignore this email.",
    resetSubject: "Password reset — SPRITE-INDEX",
    resetIntro: "A password reset was requested. This link expires in 1 hour.",
    resetCta: "Reset my password",
    resetIgnore: "If you did not make this request, ignore this email — your password remains unchanged.",
    notifOpen: "Open SPRITE-INDEX"
  }),
  nl: Object.freeze({
    verifySubject: "Bevestig je e-mailadres — SPRITE-INDEX",
    verifyIntro: "Bevestig je e-mailadres om je account te activeren.",
    verifyCta: "Mijn e-mailadres bevestigen",
    verifyIgnore: "Heb je geen account aangemaakt? Negeer deze e-mail.",
    resetSubject: "Wachtwoord opnieuw instellen — SPRITE-INDEX",
    resetIntro: "Er is een verzoek ingediend om je wachtwoord opnieuw in te stellen. Deze link verloopt over 1 uur.",
    resetCta: "Mijn wachtwoord opnieuw instellen",
    resetIgnore: "Heb je dit verzoek niet gedaan? Negeer deze e-mail — je wachtwoord blijft ongewijzigd.",
    notifOpen: "SPRITE-INDEX openen"
  })
});

function emailLocale(lang) {
  const locale = String(lang || "fr").toLowerCase().slice(0, 2);
  return locale === "en" || locale === "nl" ? locale : "fr";
}

function emailCopy(lang) {
  return EMAIL_COPY[emailLocale(lang)];
}

function localizedAppUrl(pathname, params, lang) {
  const url = new URL(pathname, APP_URL);
  for (const [key, value] of Object.entries(params || {})) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("lang", emailLocale(lang));
  return url.toString();
}

function emailShell({ heading, intro, ctaLabel, href, footer }) {
  const preheader = [heading, intro].filter(Boolean).join(" — ");
  const safeHref = escapeHtml(href);
  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6fb;margin:0;padding:24px 0;font-family:Arial,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:32px 28px;color:#172033;">
            <div style="font-size:22px;font-weight:700;letter-spacing:0.2px;color:#2454d3;margin:0 0 20px;">SPRITE-INDEX</div>
            ${heading ? `<h1 style="font-size:20px;line-height:28px;margin:0 0 14px;color:#172033;">${escapeHtml(heading)}</h1>` : ""}
            <p style="font-size:16px;line-height:24px;margin:0 0 24px;color:#42526e;white-space:pre-line;">${escapeHtml(intro)}</p>
            <a href="${safeHref}" style="display:inline-block;padding:12px 20px;background:#2454d3;border-radius:7px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${escapeHtml(ctaLabel)}</a>
            ${footer ? `<p style="font-size:13px;line-height:20px;margin:28px 0 0;color:#667085;">${escapeHtml(footer)}</p>` : ""}
          </td></tr>
        </table>
      </td></tr>
    </table>`;
}

function emailText({ heading, intro, ctaLabel, href, footer }) {
  return [
    "SPRITE-INDEX",
    "",
    heading ? String(heading) : null,
    heading ? "" : null,
    String(intro || ""),
    "",
    `${String(ctaLabel || "")}: ${href}`,
    "",
    String(footer || "")
  ].filter(value => value !== null).join("\n");
}

function emailIdempotencyKey(kind, value) {
  const digest = crypto.createHash("sha256").update(String(value)).digest("hex");
  return `sprite-index:${kind}:${digest}`;
}

function extractEmailAddress(value) {
  const raw = String(value || "").trim();
  const bracketed = raw.match(/<([^<>]+)>$/);
  const address = (bracketed ? bracketed[1] : raw).trim().toLowerCase();
  return EMAIL_ADDRESS_RE.test(address) ? address : null;
}

function emailDeliveryUnavailable(toEmail) {
  let reason = null;
  const fromAddress = extractEmailAddress(FROM_EMAIL);
  if (!resend) reason = "RESEND_API_KEY not configured";
  else if (!fromAddress) reason = "FROM_EMAIL is invalid or not configured";
  else if (RESEND_FROM_DOMAIN && fromAddress.split("@")[1] !== RESEND_FROM_DOMAIN) reason = "FROM_EMAIL does not match RESEND_FROM_DOMAIN";
  else if (REPLY_TO_EMAIL && !extractEmailAddress(REPLY_TO_EMAIL)) reason = "REPLY_TO_EMAIL is invalid";
  else if (!extractEmailAddress(toEmail)) reason = "recipient address is invalid";
  if (!reason) return null;
  console.warn(`[RESEND] Skipping email to ${toEmail} (${reason}).`);
  return { ok: false, skipped: true, reason };
}

function resendResponse(result) {
  if (result?.error) {
    return { ok: false, error: result.error.message || "Resend rejected the email" };
  }
  return { ok: true, id: result?.data?.id || null };
}

function transactionalEmail({ to, subject, html, text, tag }) {
  const payload = { from: FROM_EMAIL, to, subject, html, text };
  if (REPLY_TO_EMAIL) payload.replyTo = REPLY_TO_EMAIL;
  if (tag) payload.tags = [{ name: "category", value: tag }];
  return payload;
}

async function sendVerificationEmail(toEmail, token, lang = "fr") {
  const unavailable = emailDeliveryUnavailable(toEmail);
  if (unavailable) return unavailable;
  const copy = emailCopy(lang);
  const verifyUrl = localizedAppUrl("/api/auth/verify-email", { token }, lang);
  const content = {
    heading: "",
    intro: copy.verifyIntro,
    ctaLabel: copy.verifyCta,
    href: verifyUrl,
    footer: copy.verifyIgnore
  };
  try {
    const result = await resend.emails.send(transactionalEmail({
      to: toEmail,
      subject: copy.verifySubject,
      html: emailShell(content),
      text: emailText(content),
      tag: "account_verification"
    }), { idempotencyKey: emailIdempotencyKey("verify", token) });
    const response = resendResponse(result);
    if (!response.ok) {
      console.error("[RESEND] Failed to send verification email:", response.error);
      return response;
    }
    console.log(`[RESEND] Verification email sent to ${toEmail} (${String(lang || "fr").slice(0, 2)})`);
    return response;
  } catch (err) {
    console.error("[RESEND] Failed to send verification email:", err);
    return { ok: false, error: err.message };
  }
}

async function sendPasswordResetEmail(toEmail, token, lang = "fr") {
  const unavailable = emailDeliveryUnavailable(toEmail);
  if (unavailable) return unavailable;
  const copy = emailCopy(lang);
  const resetUrl = localizedAppUrl("/", { resetToken: token }, lang);
  const content = {
    heading: "",
    intro: copy.resetIntro,
    ctaLabel: copy.resetCta,
    href: resetUrl,
    footer: copy.resetIgnore
  };
  try {
    const result = await resend.emails.send(transactionalEmail({
      to: toEmail,
      subject: copy.resetSubject,
      html: emailShell(content),
      text: emailText(content),
      tag: "password_reset"
    }), { idempotencyKey: emailIdempotencyKey("password-reset", token) });
    const response = resendResponse(result);
    if (!response.ok) {
      console.error("[RESEND] Failed to send password reset email:", response.error);
      return response;
    }
    console.log(`[RESEND] Password reset email sent to ${toEmail} (${String(lang || "fr").slice(0, 2)})`);
    return response;
  } catch (err) {
    console.error("[RESEND] Failed to send password reset email:", err);
    return { ok: false, error: err.message };
  }
}

// Generic notification email (channel = 'email'). Reserved for important alerts
// or summaries; best-effort and a no-op when RESEND is not configured.
async function sendNotificationEmail(toEmail, { title, body, url, lang, idempotencyKey } = {}) {
  const unavailable = emailDeliveryUnavailable(toEmail);
  if (unavailable) return unavailable;
  if (!toEmail) return { ok: false, skipped: true };
  const copy = emailCopy(lang);
  // Notifications must not turn an attacker-supplied URL into a trusted email
  // link. Accept only a local path (or an absolute URL on this exact origin).
  let link = `${APP_URL}/`;
  try {
    const candidate = new URL(url || "/", APP_URL);
    if (candidate.origin === APP_URL) link = candidate.toString();
  } catch {
    // Keep the safe application homepage fallback.
  }
  const content = {
    heading: title || "",
    intro: body || "",
    ctaLabel: copy.notifOpen,
    href: link,
    footer: ""
  };
  try {
    const result = await resend.emails.send(transactionalEmail({
      to: toEmail,
      subject: `${title || "SPRITE-INDEX"} — SPRITE-INDEX`,
      html: emailShell(content),
      text: emailText(content),
      tag: "notification"
    }), idempotencyKey ? { idempotencyKey: `sprite-index:notification:${idempotencyKey}` } : undefined);
    const response = resendResponse(result);
    if (!response.ok) console.error("[RESEND] Failed to send notification email:", response.error);
    return response;
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
// Localize JSON error responses before any API route is registered. The
// client supplies Accept-Language on every request; no geolocation is used.
app.use(localizeErrorResponse);
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
// A service worker is checked byte-for-byte by browsers. Generate it from the
// current client shell so a deploy that changes a CSS/JS file always gets a
// fresh cache namespace, without a human-maintained counter.
app.get("/sw.js", (req, res, next) => {
  try {
    res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" });
    res.type("application/javascript").send(renderServiceWorker(ROOT_DIR));
  } catch (error) {
    next(error);
  }
});
// The source index is a fragment manifest. Always render it before returning
// the public SPA document instead of exposing the manifest through static
// middleware.
app.get(["/", "/index.html"], (req, res, next) => {
  try {
    res.type("html").send(renderIndexPage(ROOT_DIR));
  } catch (error) {
    next(error);
  }
});
const staticAssets = express.static(path.join(ROOT_DIR), { dotfiles: "deny" });
app.use((req, res, next) => {
  if (!security.isPublicStaticPath(req.path)) return next();
  return staticAssets(req, res, next);
});

module.exports = { APP_URL, EMAIL_COPY, FROM_EMAIL, PORT, REPLY_TO_EMAIL, app, corsOrigins, emailCopy, emailLocale, emailText, escapeHtml, localizedAppUrl, resend, sendNotificationEmail, sendPasswordResetEmail, sendVerificationEmail, server, wss };
