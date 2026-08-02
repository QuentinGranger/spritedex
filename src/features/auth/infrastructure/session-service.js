// auth.js — extracted from server.js

const { pool } = require("@/infrastructure/database/postgres-pool");
const crypto = require("crypto");

// ── Sessions : token generation ──
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Opaque links are bearer capabilities too. Store only this digest, never the
// value that appears in a URL, so a database read cannot be replayed as a
// profile/compare link. Callers validate the raw token's context separately.
function hashCapabilityToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashSessionToken(token) {
  const digest = hashCapabilityToken(token);
  return digest ? `s_${digest}` : null;
}

async function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await pool.query("INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)", [
    userId,
    hashSessionToken(token),
    expiresAt
  ]);
  return token;
}

async function validateSession(token) {
  const tokenHash = hashSessionToken(token);
  if (!tokenHash) return null;
  const result = await pool.query(
    `SELECT s.user_id FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()
       AND u.deleted_at IS NULL`,
    [tokenHash]
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

const PASSPORT_VISIBILITY_FIELDS = {
  passport: "passport_visibility",
  statistics: "statistics_visibility",
  badges: "badges_visibility",
  activity: "activity_visibility",
  comparisons: "comparisons_visibility"
};

// Centralizes all passport authorization. Routes must ask this service before
// serializing each sensitive section; the UI is never the security boundary.
async function canViewPassportSection(viewerId, ownerId, section) {
  if (!ownerId || !PASSPORT_VISIBILITY_FIELDS[section]) return false;
  if (viewerId != null && String(viewerId) === String(ownerId)) return true;

  const passportResult = await pool.query(
    `SELECT primary_squad_id, ${PASSPORT_VISIBILITY_FIELDS[section]} AS visibility
     FROM collector_passports WHERE user_id = $1`,
    [ownerId]
  );
  const settings = passportResult.rows[0] || {
    primary_squad_id: null,
    visibility: section === "comparisons" ? "private" : "friends"
  };

  // Étape 67 — anonymous visitors may only see sections marked public.
  if (viewerId == null || viewerId === "") {
    const ownerOk = await pool.query(
      `SELECT 1 FROM users
       WHERE id = $1 AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until <= NOW())
       LIMIT 1`,
      [ownerId]
    );
    return ownerOk.rows.length > 0 && settings.visibility === "public";
  }

  if (await isBlocked(viewerId, ownerId)) return false;

  const accounts = await pool.query(`SELECT id, deleted_at, suspended_until FROM users WHERE id = ANY($1::integer[])`, [
    [Number(viewerId), Number(ownerId)]
  ]);
  if (
    accounts.rows.length !== 2 ||
    accounts.rows.some((row) => row.deleted_at || (row.suspended_until && new Date(row.suspended_until) > new Date()))
  ) {
    return false;
  }

  switch (settings.visibility) {
    case "public":
      return true;
    case "friends":
      return await areFriends(viewerId, ownerId);
    case "squad": {
      if (!settings.primary_squad_id) return await shareActiveSquad(viewerId, ownerId);
      const sharedPrimary = await pool.query(
        `SELECT 1 FROM squad_members viewer JOIN squad_members owner ON owner.squad_id = viewer.squad_id
         WHERE viewer.squad_id = $1 AND viewer.user_id = $2 AND owner.user_id = $3
           AND viewer.status = 'active' AND owner.status = 'active' LIMIT 1`,
        [settings.primary_squad_id, viewerId, ownerId]
      );
      return sharedPrimary.rows.length > 0;
    }
    case "private":
    default:
      return false;
  }
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
    const tokenHash = hashCapabilityToken(shareToken);
    if (tokenHash) {
      const tokenRes = await pool.query(
        `SELECT collection_visible
         FROM compare_share_tokens
         WHERE token = $1 AND owner_user_id = $2 AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [tokenHash, ownerId]
      );
      if (tokenRes.rows.length && tokenRes.rows[0].collection_visible) {
        const ownerVisibility = getVisibility(owner);
        if (ownerVisibility.collection !== "private") return true;
      }
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

// Middleware: reject requests from a suspended account. Identity still resolves
// (so the user can call /unsuspend, /auth/me and /logout), but any action guarded
// by this middleware is blocked while the suspension is active. This turns an
// account suspension into an effective freeze without locking the owner out of
// the reactivation path.
async function requireNotSuspended(req, res, next) {
  try {
    const reqUser = await getRequestingUser(req);
    if (reqUser && (await isAccountSuspended(reqUser))) {
      return res.status(403).json({ error: "Compte suspendu" });
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

function isEmailVerificationEnforced() {
  // Explicit opt-out for local integration-test servers.
  if (process.env.EMAIL_VERIFICATION_REQUIRED === "0") return false;
  return true;
}

/** Password accounts must confirm email; OAuth accounts are already trusted. */
async function accountRequiresEmailVerification(userId) {
  if (!userId || !isEmailVerificationEnforced()) return false;
  const result = await pool.query(
    `SELECT email_verified, oauth_provider, password_hash
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (!result.rows.length) return false;
  const user = result.rows[0];
  if (user.email_verified) return false;
  if (user.oauth_provider && String(user.oauth_provider).trim()) return false;
  return !!(user.password_hash && String(user.password_hash).trim());
}

const EMAIL_VERIFICATION_ALLOWLIST = [
  /^\/api\/auth\/(login|register|logout|me|verify-email|resend-verification|forgot-password|reset-password)(?:\/|$|\?)/i,
  /^\/api\/auth\/oauth(?:\/|$|\?)/i,
  /^\/api\/auth\/callback(?:\/|$|\?)/i,
  /^\/api\/health(?:\/|$|\?)/i,
  /^\/api\/openapi\.json$/i
];

function isEmailVerificationAllowlisted(req) {
  // Mounted at `/api`, so `req.path` is relative (e.g. `/auth/me`).
  const path = String(req.path || req.url || "").split("?")[0];
  const full = path.startsWith("/api/") ? path : `/api${path.startsWith("/") ? path : `/${path}`}`;
  return EMAIL_VERIFICATION_ALLOWLIST.some((pattern) => pattern.test(full));
}

/**
 * Global gate: an authenticated password account without a verified email may
 * only hit auth helpers (me / logout / resend). Guests and OAuth sessions pass.
 */
async function requireEmailVerified(req, res, next) {
  try {
    if (!isEmailVerificationEnforced()) return next();
    if (isEmailVerificationAllowlisted(req)) return next();
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return next();
    if (!(await accountRequiresEmailVerification(reqUser))) return next();
    return res.status(403).json({
      error: "Email non vérifié",
      code: "email_not_verified",
      emailVerified: false
    });
  } catch (err) {
    return next(err);
  }
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
  if ((visibility === "friends" || visibility === "friends_only") && (await areFriends(reqUser, targetUserId)))
    return "full";
  if ((visibility === "squad" || visibility === "squad_only") && (await shareSquad(reqUser, targetUserId)))
    return "full";
  return "blocked";
}

// ── Helpers ──
// PBKDF2-HMAC-SHA512 work factor. OWASP (2023) recommends 210 000 iterations
// for PBKDF2-SHA512. Legacy accounts were hashed with 10 000 iterations; that
// count is stored per-user (password_iterations) and upgraded transparently on
// the next successful login (see /api/auth/login).
const PBKDF2_ITERATIONS = 210000;
const LEGACY_PBKDF2_ITERATIONS = 10000;
// Fixed dummy material is deliberately not a credential. It only makes the
// CPU cost of a rejected login independent of whether an account exists.
const DUMMY_PASSWORD_SALT = "2a1c9fd3b0e84cb79f51a43dce08a6b2";

function derivePassword(password, salt, iterations) {
  return new Promise((resolve, reject) => {
    // PBKDF2 is intentionally expensive. Use libuv's asynchronous crypto
    // worker rather than pbkdf2Sync so a burst of login attempts cannot block
    // the HTTP/WebSocket event loop for every other user.
    crypto.pbkdf2(password, salt, iterations, 64, "sha512", (err, derived) => {
      if (err) return reject(err);
      resolve(derived);
    });
  });
}

async function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const finalSalt = salt || crypto.randomBytes(16).toString("hex");
  const derived = await derivePassword(password, finalSalt, iterations);
  return { salt: finalSalt, hash: derived.toString("hex"), iterations };
}

async function verifyPassword(password, hash, salt, iterations = LEGACY_PBKDF2_ITERATIONS) {
  if (!hash || !salt) return false;
  const derived = await derivePassword(password, salt, iterations || LEGACY_PBKDF2_ITERATIONS);
  // Constant-time comparison to avoid leaking hash-match progress via timing.
  const a = derived;
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function burnPasswordWork(password, iterations = PBKDF2_ITERATIONS) {
  await derivePassword(password, DUMMY_PASSWORD_SALT, Math.max(1, iterations));
}

// SECURITY NOTE: the legacy "/api/auth/quick" (pseudo-only login, no password)
// has been removed. It allowed anyone who knew or guessed a username to obtain
// a valid session for that account with zero credentials. It was unused by the
// current UI (no button called it), so removing it does not affect any feature.

module.exports = {
  DEFAULT_VISIBILITY,
  LEGACY_PBKDF2_ITERATIONS,
  PASSPORT_VISIBILITY_FIELDS,
  PBKDF2_ITERATIONS,
  areFriends,
  burnPasswordWork,
  canViewCollection,
  canViewPassportSection,
  checkPrivacyAccess,
  createSession,
  generateToken,
  getCollectionAccessReason,
  getRelationship,
  getRequestingUser,
  getVisibility,
  hashCapabilityToken,
  hashPassword,
  hashSessionToken,
  isAccountSuspended,
  isBlocked,
  accountRequiresEmailVerification,
  isEmailVerificationEnforced,
  requireEmailVerified,
  requireNotSuspended,
  requireSameUser,
  requireSquadMember,
  shareActiveSquad,
  shareSquad,
  validateSession,
  verifyPassword
};
