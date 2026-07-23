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
    `SELECT s.user_id FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()
       AND u.deleted_at IS NULL`,
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
    "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
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
     WHERE a.user_id = $1 AND a.status = 'active'
       AND b.user_id = $2 AND b.status = 'active'
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

async function shareActiveSquad(userA, userB) {
  // Same as shareSquad for now; can be extended to ignore deleted/archived squads.
  return shareSquad(userA, userB);
}

const DEFAULT_VISIBILITY = {
  profile: "public",
  collection: "friends",
  priorities: "squad",
  statistics: "public",
  activity: "private",
  notes: "private"
};

// Merge the stored JSONB visibility object with default values and legacy columns.
function compactObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null));
}

function getVisibility(userRow) {
  if (!userRow) return { ...DEFAULT_VISIBILITY };
  const legacy = compactObject({
    profile: userRow.profile_visibility,
    collection: userRow.collection_visibility,
    priorities: userRow.priority_visibility,
    notes: userRow.notes_visibility
  });
  const stored = compactObject(userRow.visibility || {});
  return { ...DEFAULT_VISIBILITY, ...legacy, ...stored };
}

// Central authorization service for viewing a user's collection (or any visibility key).
// Looks up the owner's visibility settings, checks owner identity, blocks, suspensions
// and optionally a temporary share token.
const VISIBILITY_VALUES = new Set(["private", "friends", "squad", "public", "friends_only", "squad_only"]);

async function canViewCollection(viewerId, ownerId, options = {}) {
  if (!ownerId) return false;
  if (String(viewerId) === String(ownerId)) return true;

  let visibilityKey = "collection";
  let explicitValue = null;
  let shareToken = null;
  if (typeof options === "string") {
    if (VISIBILITY_VALUES.has(options)) explicitValue = options;
    else visibilityKey = options;
  } else if (options) {
    visibilityKey = options.visibilityKey || "collection";
    explicitValue = options.explicitValue || null;
    shareToken = options.shareToken || null;
  }

  const ownerRes = await pool.query(
    `SELECT id, deleted_at, suspended_until, collection_visibility, profile_visibility, priority_visibility, notes_visibility, visibility
     FROM users WHERE id = $1`,
    [ownerId]
  );
  if (!ownerRes.rows.length) return false;
  const owner = ownerRes.rows[0];
  if (owner.deleted_at) return false;
  if (owner.suspended_until && new Date(owner.suspended_until) > new Date()) return false;

  if (await isBlocked(viewerId, ownerId)) return false;

  if (shareToken && visibilityKey === "collection") {
    const tokenRes = await pool.query(
      `SELECT collection_visible
       FROM compare_share_tokens
       WHERE token = $1 AND owner_user_id = $2 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [shareToken, ownerId]
    );
    if (tokenRes.rows.length && tokenRes.rows[0].collection_visible) {
      const ownerVisibility = getVisibility(owner);
      if (ownerVisibility.collection !== "private") return true;
    }
  }

  const visibility = getVisibility(owner);
  const value = explicitValue || visibility[visibilityKey] || DEFAULT_VISIBILITY[visibilityKey] || "private";
  switch (value) {
    case "private":
      return false;
    case "public":
      return true;
    case "friends":
    case "friends_only":
      return areFriends(viewerId, ownerId);
    case "squad":
    case "squad_only":
      return shareActiveSquad(viewerId, ownerId);
    default:
      return false;
  }
}

function pairWhereClause() {
  return `LEAST(requester_id, addressee_id) = LEAST($1::integer, $2::integer)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1::integer, $2::integer)`;
}

async function getRelationship(userA, userB) {
  if (!userA || !userB || String(userA) === String(userB)) return null;
  const result = await pool.query(
    `SELECT * FROM friendships
     WHERE ${pairWhereClause()}
     ORDER BY
       CASE WHEN status IN ('pending', 'accepted', 'blocked') THEN 0 ELSE 1 END,
       updated_at DESC
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows[0] || null;
}

async function isBlocked(userA, userB) {
  if (!userA || !userB || String(userA) === String(userB)) return false;
  const result = await pool.query(
    `SELECT 1 FROM user_blocks
     WHERE (blocker_id = $1::integer AND blocked_id = $2::integer)
        OR (blocker_id = $2::integer AND blocked_id = $1::integer)
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

async function isAccountSuspended(userId) {
  if (!userId) return false;
  const result = await pool.query(
    "SELECT 1 FROM users WHERE id = $1 AND suspended_until IS NOT NULL AND suspended_until > NOW()",
    [userId]
  );
  return result.rows.length > 0;
}

async function areFriends(userA, userB) {
  if (!userA || !userB || String(userA) === String(userB)) return false;
  if (await isBlocked(userA, userB)) return false;
  const result = await pool.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND ${pairWhereClause()}
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

async function getCollectionAccessReason(viewerId, ownerId, visibility) {
  if (String(viewerId) === String(ownerId)) return "owner";
  if (await isBlocked(viewerId, ownerId)) return "blocked";
  const collectionVisibility = visibility?.collection || DEFAULT_VISIBILITY.collection;
  switch (collectionVisibility) {
    case "private":
      return "private";
    case "public":
      return "public_profile";
    case "squad":
      return (await shareActiveSquad(viewerId, ownerId)) ? "shared_squad" : "denied";
    case "friends":
      return (await areFriends(viewerId, ownerId)) ? "friend" : "denied";
    default:
      return "denied";
  }
}

async function checkPrivacyAccess(req, targetUserId, visibility) {
  const reqUser = await getRequestingUser(req);
  if (String(reqUser) === String(targetUserId)) return "full";
  if (visibility === "public") return "full";
  if (!reqUser) return "blocked";
  if ((visibility === "friends" || visibility === "friends_only") && await areFriends(reqUser, targetUserId)) return "full";
  if ((visibility === "squad" || visibility === "squad_only") && await shareSquad(reqUser, targetUserId)) return "full";
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

module.exports = { DEFAULT_VISIBILITY, LEGACY_PBKDF2_ITERATIONS, PBKDF2_ITERATIONS, areFriends, canViewCollection, checkPrivacyAccess, createSession, generateToken, getCollectionAccessReason, getRelationship, getRequestingUser, getVisibility, hashPassword, isAccountSuspended, isBlocked, requireSameUser, requireSquadMember, shareActiveSquad, shareSquad, validateSession, verifyPassword };
