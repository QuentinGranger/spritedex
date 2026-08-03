"use strict";

// Terminal-admin access is intentionally independent from application accounts.
// Password material stays on the server, while the browser only receives a
// short-lived, one-time ticket and then an HttpOnly session cookie.
// Tickets and sessions are stored in Postgres so every instance can validate
// them during rolling deploys and multi-instance hosting.

const crypto = require("crypto");
const { pool } = require("./db");
const { listCapabilitiesForRole, normalizeRole, resolveOperatorRole } = require("./admin-authz");
const { consumeTotpCode, isAdminMfaConfigured, isAdminMfaRequired } = require("./admin-totp");

const ADMIN_SESSION_COOKIE = "sprite_index_admin_session";
const ADMIN_TICKET_TTL_MS = 5 * 60 * 1000;
// Sliding idle window refreshed on activity (throttled).
const ADMIN_SESSION_TTL_MS = 4 * 60 * 60 * 1000;
// Hard cap from session creation, even with continuous activity.
const ADMIN_SESSION_MAX_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const ADMIN_ACCESS_PURGE_INTERVAL_MS = 5 * 60 * 1000;
const ADMIN_MAX_CONCURRENT_SESSIONS = Math.max(
  1,
  Math.min(20, Number.parseInt(process.env.ADMIN_MAX_CONCURRENT_SESSIONS || "3", 10) || 3)
);
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

let lastPurgeAt = 0;

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function resolveOperatorLabel(raw = process.env.ADMIN_OPERATOR_LABEL || "terminal") {
  const cleaned = String(raw || "terminal")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "terminal";
}

function normalizeAdminUsername(value) {
  const username = String(value || "")
    .trim()
    .toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(username) ? username : null;
}

function formatActor(label, publicId) {
  return `${resolveOperatorLabel(label)}:${String(publicId || "unknown").slice(0, 16)}`;
}

function clientMeta(meta = {}) {
  const ip = typeof meta.ip === "string" ? meta.ip.trim().slice(0, 64) || null : null;
  const userAgent = typeof meta.userAgent === "string" ? meta.userAgent.trim().slice(0, 500) || null : null;
  return { ip, userAgent };
}

function readSessionToken(req) {
  const token = req?.cookies?.[ADMIN_SESSION_COOKIE];
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token) ? token : null;
}

function mapSessionRow(row) {
  const sessionRole = String(row.role || "").trim() || resolveOperatorRole(row.actor_label);
  return {
    publicId: row.public_id,
    actorLabel: row.actor_label,
    operatorId: row.operator_id || null,
    authMode: row.auth_mode || "legacy_global",
    actor: formatActor(row.actor_label, row.public_id),
    role: sessionRole,
    capabilities: listCapabilitiesForRole(sessionRole),
    expiresAt: row.expires_at,
    maxExpiresAt: row.max_expires_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    createdIp: row.created_ip,
    lastIp: row.last_ip,
    current: !!row.current
  };
}

function mapOperatorRow(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretRotatedAt: row.secret_rotated_at,
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
    lastUnusualLoginAt: row.last_unusual_login_at
  };
}

async function purgeExpiredAdminAccess({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastPurgeAt < ADMIN_ACCESS_PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  await pool.query("DELETE FROM admin_access_tickets WHERE expires_at <= NOW()");
  await pool.query(
    `DELETE FROM admin_access_sessions
     WHERE expires_at <= NOW()
        OR COALESCE(max_expires_at, expires_at) <= NOW()`
  );
}

async function recordAdminAccessEvent(
  actor,
  action,
  { targetType = "admin_session", targetId = null, justification = null, details = {} } = {}
) {
  try {
    const { writeAdminAudit } = require("./admin-audit");
    await writeAdminAudit(pool, {
      actor,
      action,
      targetType,
      targetId,
      justification,
      details,
      requireJustification: false
    });
  } catch (error) {
    // Session open/close must not fail because the audit log is unavailable.
    console.error("[admin] access audit write failed:", error.message);
  }
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
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64url"), derived.toString("base64url")].join("$");
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

async function verifyAdminOperatorCredentials(username, password) {
  const normalized = normalizeAdminUsername(username);
  if (!normalized || typeof password !== "string" || password.length > 1024) return null;
  const result = await pool.query(
    `SELECT id, username, display_name, password_hash, role, active
     FROM admin_operators WHERE username = $1 AND active = TRUE`,
    [normalized]
  );
  const row = result.rows[0];
  if (!row || !verifyAdminPassword(password, row.password_hash)) return null;
  return {
    id: row.id,
    username: row.username,
    label: row.username,
    displayName: row.display_name,
    role: normalizeRole(row.role) || "readonly",
    authMode: "named_operator"
  };
}

async function listAdminOperators() {
  const result = await pool.query(
    `SELECT id, username, display_name, role, active, created_at, updated_at,
            secret_rotated_at, last_login_at, last_login_ip, last_unusual_login_at
     FROM admin_operators ORDER BY active DESC, username ASC`
  );
  return result.rows.map(mapOperatorRow);
}

async function createAdminOperator({ username, displayName, password, role = "owner" } = {}) {
  const normalized = normalizeAdminUsername(username);
  const name = String(displayName || "")
    .trim()
    .slice(0, 80);
  const normalizedRole = normalizeRole(role);
  if (!normalized || !name || !normalizedRole)
    throw new AdminAccessError("Compte administrateur invalide", { status: 400, code: "ADMIN_OPERATOR_INVALID" });
  const id = crypto.randomBytes(12).toString("hex");
  const result = await pool.query(
    `INSERT INTO admin_operators (id, username, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, display_name, role, active, created_at, updated_at,
               secret_rotated_at, last_login_at, last_login_ip, last_unusual_login_at`,
    [id, normalized, name, hashAdminPassword(password), normalizedRole]
  );
  return mapOperatorRow(result.rows[0]);
}

async function rotateAdminOperatorSecret(operatorId, password) {
  if (!/^[a-f0-9]{24}$/i.test(String(operatorId || "")))
    throw new AdminAccessError("Compte administrateur invalide", { status: 400, code: "ADMIN_OPERATOR_INVALID" });
  const result = await pool.query(
    `UPDATE admin_operators
     SET password_hash = $2, secret_rotated_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND active = TRUE
     RETURNING id, username, display_name, role, active, created_at, updated_at,
               secret_rotated_at, last_login_at, last_login_ip, last_unusual_login_at`,
    [operatorId, hashAdminPassword(password)]
  );
  return result.rows.length ? mapOperatorRow(result.rows[0]) : null;
}

async function setAdminOperatorActive(operatorId, active) {
  if (!/^[a-f0-9]{24}$/i.test(String(operatorId || "")))
    throw new AdminAccessError("Compte administrateur invalide", { status: 400, code: "ADMIN_OPERATOR_INVALID" });
  const result = await pool.query(
    `UPDATE admin_operators SET active = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, username, display_name, role, active, created_at, updated_at,
               secret_rotated_at, last_login_at, last_login_ip, last_unusual_login_at`,
    [operatorId, active === true]
  );
  if (result.rows.length && active === false) {
    await pool.query("DELETE FROM admin_access_sessions WHERE operator_id = $1", [operatorId]);
  }
  return result.rows.length ? mapOperatorRow(result.rows[0]) : null;
}

async function enforceConcurrentSessionLimit(client, actorLabel) {
  const result = await client.query(
    `DELETE FROM admin_access_sessions
     WHERE token_hash IN (
       SELECT token_hash
       FROM admin_access_sessions
       WHERE actor_label = $1
         AND expires_at > NOW()
         AND COALESCE(max_expires_at, expires_at) > NOW()
       ORDER BY created_at DESC
       OFFSET $2
     )
     RETURNING public_id, actor_label`,
    [actorLabel, ADMIN_MAX_CONCURRENT_SESSIONS]
  );
  return result.rows;
}

async function issueAdminTicket(meta = {}, operator = null) {
  if (isAdminMfaRequired() && !isAdminMfaConfigured()) {
    const error = new Error("MFA administrateur requis mais ADMIN_TOTP_SECRET est absent.");
    error.code = "ADMIN_MFA_NOT_CONFIGURED";
    throw error;
  }
  await purgeExpiredAdminAccess();
  const { ip, userAgent } = clientMeta(meta);
  const token = crypto.randomBytes(32).toString("hex");
  const identity = operator || {
    id: null,
    label: resolveOperatorLabel(),
    role: resolveOperatorRole(),
    authMode: "legacy_global"
  };
  await pool.query(
    `INSERT INTO admin_access_tickets (
       token_hash, expires_at, created_ip, created_user_agent,
       operator_id, operator_label, role, auth_mode
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      hashSecret(token),
      new Date(Date.now() + ADMIN_TICKET_TTL_MS),
      ip,
      userAgent,
      identity.id,
      identity.label,
      identity.role,
      identity.authMode
    ]
  );
  return token;
}

async function peekAdminTicket(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  await purgeExpiredAdminAccess();
  const result = await pool.query(
    `SELECT expires_at, operator_id, operator_label, role, auth_mode
     FROM admin_access_tickets
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [hashSecret(token)]
  );
  if (!result.rows.length) return null;
  return {
    expiresAt: result.rows[0].expires_at,
    mfaRequired: isAdminMfaConfigured(),
    role: result.rows[0].role || resolveOperatorRole(),
    authMode: result.rows[0].auth_mode || "legacy_global"
  };
}

class AdminAccessError extends Error {
  constructor(message, { status = 401, code = "ADMIN_ACCESS_DENIED" } = {}) {
    super(message);
    this.name = "AdminAccessError";
    this.status = status;
    this.code = code;
  }
}

async function consumeAdminTicket(token, meta = {}, { totp = null } = {}) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  await purgeExpiredAdminAccess();
  const { ip, userAgent } = clientMeta(meta);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ticket = await client.query(
      `SELECT token_hash, operator_id, operator_label, role, auth_mode
       FROM admin_access_tickets
       WHERE token_hash = $1 AND expires_at > NOW()
       FOR UPDATE`,
      [hashSecret(token)]
    );
    if (!ticket.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const ticketRow = ticket.rows[0];
    let operator = null;
    if (ticketRow.operator_id) {
      const operatorResult = await client.query(
        `SELECT id, username, display_name, role, active, last_login_at, last_login_ip, last_login_user_agent
         FROM admin_operators WHERE id = $1 FOR UPDATE`,
        [ticketRow.operator_id]
      );
      operator = operatorResult.rows[0];
      if (!operator?.active) {
        await client.query("ROLLBACK");
        return null;
      }
    }

    if (isAdminMfaConfigured()) {
      const mfa = await consumeTotpCode(totp, { db: client, purpose: "login" });
      if (!mfa.ok) {
        await client.query("ROLLBACK");
        throw new AdminAccessError(
          mfa.reason === "replay" ? "Code MFA déjà utilisé — attendez le prochain" : "Code MFA invalide ou expiré",
          {
            status: 401,
            code: mfa.reason === "replay" ? "ADMIN_MFA_REPLAY" : "ADMIN_MFA_INVALID"
          }
        );
      }
    } else if (isAdminMfaRequired()) {
      await client.query("ROLLBACK");
      throw new AdminAccessError("MFA administrateur non configuré", {
        status: 503,
        code: "ADMIN_MFA_NOT_CONFIGURED"
      });
    }

    await client.query(`DELETE FROM admin_access_tickets WHERE token_hash = $1`, [hashSecret(token)]);

    const sessionToken = crypto.randomBytes(32).toString("hex");
    const publicId = crypto.randomBytes(4).toString("hex");
    const actorLabel = operator?.username || ticketRow.operator_label || resolveOperatorLabel();
    const role = normalizeRole(operator?.role || ticketRow.role) || resolveOperatorRole(actorLabel);
    const authMode = ticketRow.auth_mode || (operator ? "named_operator" : "legacy_global");
    const now = Date.now();
    const expiresAt = new Date(now + ADMIN_SESSION_TTL_MS);
    const maxExpiresAt = new Date(now + ADMIN_SESSION_MAX_TTL_MS);
    await client.query(
      `INSERT INTO admin_access_sessions (
         token_hash, public_id, actor_label, operator_id, auth_mode, role, expires_at, max_expires_at,
         created_ip, created_user_agent, last_ip, last_user_agent
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9, $10)`,
      [
        hashSecret(sessionToken),
        publicId,
        actorLabel,
        operator?.id || ticketRow.operator_id || null,
        authMode,
        role,
        expiresAt,
        maxExpiresAt,
        ip,
        userAgent
      ]
    );
    const unusualLogin =
      operator?.last_login_at &&
      ((ip && operator.last_login_ip && ip !== operator.last_login_ip) ||
        (userAgent && operator.last_login_user_agent && userAgent !== operator.last_login_user_agent));
    if (operator) {
      await client.query(
        `UPDATE admin_operators
         SET last_login_at = NOW(), last_login_ip = $2, last_login_user_agent = $3,
             last_unusual_login_at = CASE WHEN $4 THEN NOW() ELSE last_unusual_login_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [operator.id, ip, userAgent, !!unusualLogin]
      );
      if (unusualLogin) {
        await client.query(
          `INSERT INTO admin_security_alerts (id, operator_id, severity, kind, details)
           VALUES ($1, $2, 'warning', 'unusual_login', $3::jsonb)`,
          [
            crypto.randomBytes(12).toString("hex"),
            operator.id,
            JSON.stringify({
              ip,
              userAgent: userAgent?.slice(0, 180) || null,
              previousIp: operator.last_login_ip || null
            })
          ]
        );
      }
    }
    const evicted = await enforceConcurrentSessionLimit(client, actorLabel);
    await client.query("COMMIT");

    const session = {
      token: sessionToken,
      publicId,
      actorLabel,
      operatorId: operator?.id || ticketRow.operator_id || null,
      authMode,
      role,
      capabilities: listCapabilitiesForRole(role),
      actor: formatActor(actorLabel, publicId),
      expiresAt,
      maxExpiresAt
    };
    await recordAdminAccessEvent(session.actor, "session.opened", {
      targetId: publicId,
      details: {
        ip,
        userAgent: userAgent ? userAgent.slice(0, 120) : null,
        role,
        mfa: isAdminMfaConfigured(),
        authMode
      }
    });
    if (unusualLogin) {
      await recordAdminAccessEvent(session.actor, "security.unusual_login", {
        targetType: "admin_operator",
        targetId: operator.id,
        details: {
          ipChanged: !!(ip && operator.last_login_ip && ip !== operator.last_login_ip),
          userAgentChanged: !!(
            userAgent &&
            operator.last_login_user_agent &&
            userAgent !== operator.last_login_user_agent
          )
        }
      });
    }
    for (const row of evicted) {
      await recordAdminAccessEvent(formatActor(row.actor_label, row.public_id), "session.closed", {
        targetId: row.public_id,
        details: { reason: "concurrent_limit" }
      });
    }
    return session;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

function needsSessionTouch(row, ip, userAgent) {
  const lastSeenMs = new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs >= ADMIN_SESSION_TOUCH_INTERVAL_MS) {
    return true;
  }
  if (ip && ip !== row.last_ip) return true;
  if (userAgent && userAgent !== row.last_user_agent) return true;
  return false;
}

async function getAdminSession(req, meta = {}) {
  const token = readSessionToken(req);
  if (!token) return null;
  const tokenHash = hashSecret(token);
  const { ip, userAgent } = clientMeta({
    ip: meta.ip ?? req.ip,
    userAgent: meta.userAgent ?? req.get?.("user-agent")
  });

  const existing = await pool.query(
    `SELECT public_id, actor_label, operator_id, auth_mode, role, expires_at, max_expires_at, created_at, last_seen_at,
            created_ip, last_ip, last_user_agent
     FROM admin_access_sessions
     WHERE token_hash = $1
       AND expires_at > NOW()
       AND COALESCE(max_expires_at, expires_at) > NOW()`,
    [tokenHash]
  );
  if (!existing.rows.length) return null;

  const row = existing.rows[0];
  if (!needsSessionTouch(row, ip, userAgent)) {
    return mapSessionRow(row);
  }
  const ipChanged = !!(ip && row.last_ip && ip !== row.last_ip);
  const userAgentChanged = !!(userAgent && row.last_user_agent && userAgent !== row.last_user_agent);

  const result = await pool.query(
    `UPDATE admin_access_sessions
     SET last_seen_at = NOW(),
         last_ip = COALESCE($2, last_ip),
         last_user_agent = COALESCE($3, last_user_agent),
         expires_at = LEAST(
           NOW() + ($4::bigint * INTERVAL '1 millisecond'),
           COALESCE(max_expires_at, NOW() + ($4::bigint * INTERVAL '1 millisecond'))
         )
     WHERE token_hash = $1
       AND expires_at > NOW()
       AND COALESCE(max_expires_at, expires_at) > NOW()
     RETURNING public_id, actor_label, operator_id, auth_mode, role, expires_at, max_expires_at, created_at, last_seen_at,
               created_ip, last_ip`,
    [tokenHash, ip, userAgent, ADMIN_SESSION_TTL_MS]
  );
  if (!result.rows.length) return null;
  const session = mapSessionRow(result.rows[0]);
  if (ipChanged || userAgentChanged) {
    await recordAdminAccessEvent(session.actor, "session.context_changed", {
      targetId: session.publicId,
      details: {
        ipChanged,
        userAgentChanged,
        previousIp: ipChanged ? row.last_ip : null,
        currentIp: ipChanged ? ip : null
      }
    });
  }
  return session;
}

async function attachAdminSession(req, meta = {}) {
  const session = await getAdminSession(req, meta);
  if (session) req.adminSession = session;
  else delete req.adminSession;
  return session;
}

async function isAdminSession(req, meta = {}) {
  return !!(await attachAdminSession(req, meta));
}

async function revokeAdminSession(req, { reason = "logout" } = {}) {
  const token = readSessionToken(req);
  if (!token) return false;
  const result = await pool.query(
    `DELETE FROM admin_access_sessions
     WHERE token_hash = $1
     RETURNING public_id, actor_label`,
    [hashSecret(token)]
  );
  const previous = req.adminSession;
  delete req.adminSession;
  if (!result.rows.length) return false;
  const row = result.rows[0];
  await recordAdminAccessEvent(previous?.actor || formatActor(row.actor_label, row.public_id), "session.closed", {
    targetId: row.public_id,
    details: { reason }
  });
  return true;
}

async function listActiveAdminSessions(currentPublicId = null) {
  await purgeExpiredAdminAccess();
  const result = await pool.query(
    `SELECT public_id, actor_label, operator_id, auth_mode, role, expires_at, max_expires_at, created_at, last_seen_at,
            created_ip, last_ip,
            (public_id = $1) AS current
     FROM admin_access_sessions
     WHERE expires_at > NOW()
       AND COALESCE(max_expires_at, expires_at) > NOW()
     ORDER BY created_at DESC
     LIMIT 50`,
    [currentPublicId]
  );
  return result.rows.map(mapSessionRow);
}

async function revokeAdminSessionByPublicId(publicId, { actor = "unknown", exceptPublicId = null } = {}) {
  if (typeof publicId !== "string" || !/^[a-f0-9]{8}$/i.test(publicId)) return false;
  if (exceptPublicId && publicId === exceptPublicId) return false;
  const result = await pool.query(
    `DELETE FROM admin_access_sessions
     WHERE public_id = $1
     RETURNING public_id, actor_label`,
    [publicId]
  );
  if (!result.rows.length) return false;
  await recordAdminAccessEvent(actor, "session.revoked", {
    targetId: publicId,
    details: { revokedPublicId: publicId }
  });
  return true;
}

async function revokeOtherAdminSessions(currentPublicId, { actor = "unknown" } = {}) {
  if (typeof currentPublicId !== "string" || !/^[a-f0-9]{8}$/i.test(currentPublicId)) {
    return { revoked: 0 };
  }
  const result = await pool.query(
    `DELETE FROM admin_access_sessions
     WHERE public_id <> $1
       AND expires_at > NOW()
       AND COALESCE(max_expires_at, expires_at) > NOW()
     RETURNING public_id`,
    [currentPublicId]
  );
  if (result.rows.length) {
    await recordAdminAccessEvent(actor, "session.revoked_others", {
      targetId: currentPublicId,
      details: { revoked: result.rows.length, publicIds: result.rows.map((row) => row.public_id) }
    });
  }
  return { revoked: result.rows.length };
}

function adminSessionCookieOptions(session = null) {
  const publicUrl = process.env.APP_URL || process.env.OAUTH_REDIRECT_BASE || process.env.RENDER_EXTERNAL_URL || "";
  const remaining = session?.expiresAt
    ? Math.max(0, new Date(session.expiresAt).getTime() - Date.now())
    : ADMIN_SESSION_TTL_MS;
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production" || /^https:/i.test(publicUrl),
    path: "/",
    maxAge: remaining
  };
}

function adminActorFromReq(req) {
  return req?.adminSession?.actor || "unknown";
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  ADMIN_TICKET_TTL_MS,
  ADMIN_SESSION_TTL_MS,
  ADMIN_SESSION_MAX_TTL_MS,
  ADMIN_MAX_CONCURRENT_SESSIONS,
  AdminAccessError,
  hashAdminPassword,
  verifyAdminPassword,
  normalizeAdminUsername,
  verifyAdminOperatorCredentials,
  listAdminOperators,
  createAdminOperator,
  rotateAdminOperatorSecret,
  setAdminOperatorActive,
  issueAdminTicket,
  peekAdminTicket,
  consumeAdminTicket,
  getAdminSession,
  attachAdminSession,
  isAdminSession,
  revokeAdminSession,
  listActiveAdminSessions,
  revokeAdminSessionByPublicId,
  revokeOtherAdminSessions,
  adminSessionCookieOptions,
  resolveOperatorLabel,
  adminActorFromReq,
  formatActor,
  purgeExpiredAdminAccess
};
