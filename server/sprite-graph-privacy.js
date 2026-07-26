"use strict";

// ── Sprite Graph privacy & data levels (Étapes 33–35) ────────────────────────

/** Étape 34 — visibility / consumption levels. */
const GRAPH_DATA_LEVELS = Object.freeze({
  RAW_PRIVATE: "raw_private",
  AGGREGATED_INTERNAL: "aggregated_internal",
  AGGREGATED_PUBLIC: "aggregated_public"
});

const GRAPH_DATA_LEVEL_SET = new Set(Object.values(GRAPH_DATA_LEVELS));

/**
 * Étape 35 — minimum unique users before a community statistic may be shown.
 * Override with GRAPH_PUBLIC_MIN_USERS.
 */
const PUBLIC_ANONYMIZATION_MIN_USERS = (() => {
  const n = Number(process.env.GRAPH_PUBLIC_MIN_USERS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
})();

const INSUFFICIENT_COMMUNITY_DATA_MESSAGE = "Données communautaires insuffisantes";

/**
 * Étape 33 — keys that must never be persisted on graph events.
 * Prefer internal ids (userId, spriteId, variantId, …).
 */
const GRAPH_CONTEXT_PII_KEYS = Object.freeze([
  "email",
  "emails",
  "emailAddress",
  "mail",
  "ip",
  "ipAddress",
  "ip_address",
  "remoteAddress",
  "clientIp",
  "oauth",
  "oauthToken",
  "oauth_token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "token",
  "password",
  "passwordHash",
  "privateMessage",
  "private_message",
  "dm",
  "directMessage",
  "messageBody",
  "message_body",
  "chatMessage",
  "note",
  "notes",
  "personalNote",
  "personal_note",
  "blockReason",
  "block_reason",
  "blockingReason",
  "banReason",
  "bio",
  "biography",
  "phone",
  "phoneNumber",
  "address",
  "street",
  "postalCode",
  "birthdate",
  "dateOfBirth",
  "ssn",
  "avatarBase64",
  "profilePhotoData"
]);

const GRAPH_CONTEXT_PII_KEY_SET = new Set(
  GRAPH_CONTEXT_PII_KEYS.map((k) => k.toLowerCase())
);

const EMAIL_LIKE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const JWT_LIKE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isForbiddenContextKey(key) {
  const k = String(key || "").toLowerCase();
  if (GRAPH_CONTEXT_PII_KEY_SET.has(k)) return true;
  if (k.includes("email")) return true;
  if (k.includes("oauth")) return true;
  if (k.endsWith("token") || k.includes("_token")) return true;
  if (k.includes("password")) return true;
  if (k.includes("blockreason") || k.includes("block_reason")) return true;
  return false;
}

function scrubStringValue(value) {
  const s = String(value);
  if (EMAIL_LIKE.test(s)) return "[redacted]";
  if (JWT_LIKE.test(s.trim())) return "[redacted]";
  return s;
}

/**
 * Deep-sanitize event context before persistence (Étape 33).
 */
function sanitizeGraphContext(context, { maxDepth = 6 } = {}) {
  if (!context || typeof context !== "object" || Array.isArray(context)) return {};

  function walk(node, depth) {
    if (depth > maxDepth) return undefined;
    if (node == null) return null;
    if (Array.isArray(node)) {
      return node.map((item) => walk(item, depth + 1)).filter((v) => v !== undefined);
    }
    if (typeof node !== "object") {
      if (typeof node === "string") return scrubStringValue(node);
      if (typeof node === "number" || typeof node === "boolean") return node;
      return undefined;
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (isForbiddenContextKey(key)) continue;
      const cleaned = walk(value, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }

  try {
    return walk(JSON.parse(JSON.stringify(context)), 0) || {};
  } catch (_) {
    return {};
  }
}

/**
 * Étape 34 — raw individual events are always private.
 */
function classifyGraphDataLevel(kind = "event") {
  if (kind === "public_aggregate" || kind === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
    return GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC;
  }
  if (kind === "internal_aggregate" || kind === GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL) {
    return GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL;
  }
  return GRAPH_DATA_LEVELS.RAW_PRIVATE;
}

/**
 * Étape 35 — gate public community stats on unique-user threshold.
 */
function applyPublicAnonymizationGate({
  uniqueUserCount = 0,
  payload = null,
  minUsers = PUBLIC_ANONYMIZATION_MIN_USERS
} = {}) {
  const users = Number(uniqueUserCount) || 0;
  const threshold = Number.isFinite(Number(minUsers)) && Number(minUsers) > 0
    ? Math.floor(Number(minUsers))
    : PUBLIC_ANONYMIZATION_MIN_USERS;
  if (users < threshold) {
    return {
      ok: false,
      insufficient: true,
      message: INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
      uniqueUserCount: users,
      minUsers: threshold
    };
  }
  return {
    ok: true,
    insufficient: false,
    payload,
    uniqueUserCount: users,
    minUsers: threshold
  };
}

module.exports = {
  GRAPH_DATA_LEVELS,
  GRAPH_DATA_LEVEL_SET,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  GRAPH_CONTEXT_PII_KEYS,
  sanitizeGraphContext,
  isForbiddenContextKey,
  classifyGraphDataLevel,
  applyPublicAnonymizationGate
};
