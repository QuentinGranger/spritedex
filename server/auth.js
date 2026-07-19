// auth.js — extracted from server.js

const { server } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");

// ── Sessions : token generation ──
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [userId, token, expiresAt]
  );
  return token;
}

async function validateSession(token) {
  if (!token) return null;
  const result = await pool.query(
    "SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()",
    [token]
  );
  return result.rows.length ? result.rows[0].user_id : null;
}

// ── Permissions : extract requesting user from a valid session token only ──
// SECURITY: never trust a client-supplied user id (e.g. an "x-user-id" header
// or a body field) as identity proof. Identity is derived exclusively from a
// server-issued session token, otherwise anyone could impersonate any user.
async function getRequestingUser(req) {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const userId = await validateSession(token);
    if (userId) return String(userId);
  }
  return null;
}

async function requireSameUser(req, res, paramUserId) {
  const reqUser = await getRequestingUser(req);
  if (!reqUser || String(reqUser) !== String(paramUserId)) {
    res.status(403).json({ error: "Accès interdit : vous ne pouvez modifier que votre propre collection" });
    return false;
  }
  return true;
}

async function requireSquadMember(req, res, squadId) {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) {
    res.status(401).json({ error: "Authentification requise" });
    return false;
  }
  const check = await pool.query(
    "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2",
    [squadId, reqUser]
  );
  if (check.rows.length === 0) {
    res.status(403).json({ error: "Vous n'êtes pas membre de cette escouade" });
    return false;
  }
  return true;
}

async function shareSquad(userA, userB) {
  if (!userA || !userB) return false;
  const result = await pool.query(
    `SELECT 1 FROM squad_members a
     JOIN squad_members b ON a.squad_id = b.squad_id
     WHERE a.user_id = $1 AND b.user_id = $2
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

async function areFriends(userA, userB) {
  if (!userA || !userB) return false;
  const result = await pool.query(
    `SELECT 1 FROM friends
     WHERE status = 'accepted'
       AND ((user_id = $1 AND friend_user_id = $2)
         OR (user_id = $2 AND friend_user_id = $1))
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

async function checkPrivacyAccess(req, targetUserId, privacy) {
  const reqUser = await getRequestingUser(req);
  if (String(reqUser) === String(targetUserId)) return "full";
  if (privacy === "public") return "full";
  if (!reqUser) return "blocked";
  if (privacy === "friends_only" && await areFriends(reqUser, targetUserId)) return "full";
  if (privacy === "squad_only" && await shareSquad(reqUser, targetUserId)) return "full";
  return "blocked";
}

// ── Helpers ──
// PBKDF2-HMAC-SHA512 work factor. OWASP (2023) recommends 210 000 iterations
// for PBKDF2-SHA512. Legacy accounts were hashed with 10 000 iterations; that
// count is stored per-user (password_iterations) and upgraded transparently on
// the next successful login (see /api/auth/login).
const PBKDF2_ITERATIONS = 210000;
const LEGACY_PBKDF2_ITERATIONS = 10000;

function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, "sha512").toString("hex");
  return { salt, hash, iterations };
}

function verifyPassword(password, hash, salt, iterations = LEGACY_PBKDF2_ITERATIONS) {
  if (!hash || !salt) return false;
  const result = crypto.pbkdf2Sync(password, salt, iterations || LEGACY_PBKDF2_ITERATIONS, 64, "sha512").toString("hex");
  // Constant-time comparison to avoid leaking hash-match progress via timing.
  const a = Buffer.from(result, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// SECURITY NOTE: the legacy "/api/auth/quick" (pseudo-only login, no password)
// has been removed. It allowed anyone who knew or guessed a username to obtain
// a valid session for that account with zero credentials. It was unused by the
// current UI (no button called it), so removing it does not affect any feature.

module.exports = { LEGACY_PBKDF2_ITERATIONS, PBKDF2_ITERATIONS, areFriends, checkPrivacyAccess, createSession, generateToken, getRequestingUser, hashPassword, requireSameUser, requireSquadMember, shareSquad, validateSession, verifyPassword };
