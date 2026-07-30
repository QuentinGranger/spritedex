"use strict";

// Terminal-admin access is intentionally independent from application accounts.
// Password material stays on the server, while the browser only receives a
// short-lived, one-time ticket and then an HttpOnly session cookie.

const crypto = require("crypto");

const ADMIN_SESSION_COOKIE = "sprite_index_admin_session";
const ADMIN_TICKET_TTL_MS = 5 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

const tickets = new Map();
const sessions = new Map();

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function purgeExpired() {
  const now = Date.now();
  for (const [key, record] of tickets) if (record.expiresAt <= now) tickets.delete(key);
  for (const [key, record] of sessions) if (record.expiresAt <= now) sessions.delete(key);
}

function hashAdminPassword(password, salt = crypto.randomBytes(16)) {
  if (typeof password !== "string" || password.length < 12 || password.length > 1024) {
    throw new Error("Admin password must contain between 12 and 1024 characters.");
  }
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAX_MEMORY
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

function verifyAdminPassword(password, encoded = process.env.ADMIN_ACCESS_PASSWORD_HASH || "") {
  if (typeof password !== "string" || password.length > 1024) return false;
  const parts = String(encoded).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [scheme, nRaw, rRaw, pRaw, saltRaw, expectedRaw] = parts;
  if (scheme !== "scrypt" || Number(nRaw) !== SCRYPT_N || Number(rRaw) !== SCRYPT_R || Number(pRaw) !== SCRYPT_P) {
    return false;
  }
  try {
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(expectedRaw, "base64url");
    if (!salt.length || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAX_MEMORY
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

function issueAdminTicket() {
  purgeExpired();
  const token = crypto.randomBytes(32).toString("hex");
  tickets.set(hashSecret(token), { expiresAt: Date.now() + ADMIN_TICKET_TTL_MS });
  return token;
}

function consumeAdminTicket(token) {
  purgeExpired();
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const key = hashSecret(token);
  const ticket = tickets.get(key);
  tickets.delete(key); // one use, including malformed / expired attempts
  if (!ticket || ticket.expiresAt <= Date.now()) return null;

  const session = crypto.randomBytes(32).toString("hex");
  sessions.set(hashSecret(session), { expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
  return session;
}

function isAdminSession(req) {
  purgeExpired();
  const token = req?.cookies?.[ADMIN_SESSION_COOKIE];
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return false;
  const record = sessions.get(hashSecret(token));
  return !!record && record.expiresAt > Date.now();
}

function revokeAdminSession(req) {
  const token = req?.cookies?.[ADMIN_SESSION_COOKIE];
  if (typeof token === "string" && /^[a-f0-9]{64}$/i.test(token)) sessions.delete(hashSecret(token));
}

function adminSessionCookieOptions() {
  const publicUrl = process.env.APP_URL || process.env.OAUTH_REDIRECT_BASE || process.env.RENDER_EXTERNAL_URL || "";
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" || /^https:/i.test(publicUrl),
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS
  };
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  ADMIN_TICKET_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  hashAdminPassword,
  verifyAdminPassword,
  issueAdminTicket,
  consumeAdminTicket,
  isAdminSession,
  revokeAdminSession,
  adminSessionCookieOptions
};
