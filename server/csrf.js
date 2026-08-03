"use strict";

const crypto = require("crypto");
const { authenticateRequest, CSRF_COOKIE } = require("./auth");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Public auth endpoints that establish a session or do not yet have one.
const CSRF_EXEMPT = [
  /^\/auth\/(csrf|login|register|forgot-password|reset-password|oauth\/exchange)(?:\/|$)/i,
  /^\/auth\/oauth(?:\/|$)/i,
  /^\/auth\/callback(?:\/|$)/i,
  /^\/auth\/verify-email(?:\/|$)/i,
  /^\/health(?:\/|$)/i,
  /^\/openapi\.json$/i
];

function normalizeApiPath(req) {
  const path = String(req.path || req.url || "").split("?")[0];
  return path.startsWith("/") ? path : `/${path}`;
}

function isCsrfExempt(req) {
  const path = normalizeApiPath(req);
  return CSRF_EXEMPT.some((pattern) => pattern.test(path));
}

function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Enforce double-submit CSRF only for cookie-authenticated mutating requests.
 * Bearer (native / Electron / tests) is exempt — the token is not ambient.
 */
async function requireCsrfForCookieAuth(req, res, next) {
  try {
    if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) return next();
    if (isCsrfExempt(req)) return next();

    await authenticateRequest(req);
    if (!req.auth || req.auth.method !== "cookie") return next();

    const headerToken = String(req.get("x-csrf-token") || "");
    const cookieToken = String(req.cookies?.[CSRF_COOKIE] || "");
    if (!tokensMatch(headerToken, cookieToken)) {
      return res.status(403).json({ error: "Jeton CSRF invalide", code: "csrf_failed" });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  requireCsrfForCookieAuth
};
