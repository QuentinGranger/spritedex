// ── Push subscriptions (Étapes 44–45) ─────────────────────────────────────
// Separate table for device push credentials. One user may have many devices
// (web / ios / android). `user_id` is INTEGER to match users.id SERIAL.
//
// Web rows store endpoint + VAPID keys. Native rows store a platform token and
// a synthetic endpoint (`android:<token>` / `ios:<token>`) for uniqueness.
//
// Étape 45 — when a provider reports an invalid token, deactivate the
// subscription (no endless retries), keep in-app notifications, and flag the
// user so the client can offer to re-enable push.

const crypto = require("crypto");

const PLATFORMS = Object.freeze(["web", "ios", "android"]);
const MAX_WEB_PUSH_ENDPOINT_LENGTH = 2048;
const MAX_NATIVE_PUSH_TOKEN_LENGTH = 4096;
const TRUSTED_WEB_PUSH_HOSTS = Object.freeze([
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com"
]);

let tableReady = false;

function normalizePlatform(platform) {
  const p = String(platform || "web")
    .toLowerCase()
    .trim();
  if (p === "fcm") return "android";
  if (p === "apns") return "ios";
  if (PLATFORMS.includes(p)) return p;
  return "web";
}

function isSupportedPlatform(platform) {
  if (platform == null || String(platform).trim() === "") return true;
  const p = String(platform).toLowerCase().trim();
  return p === "fcm" || p === "apns" || PLATFORMS.includes(p);
}

function isTrustedWebPushEndpoint(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_WEB_PUSH_ENDPOINT_LENGTH) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !url.pathname ||
      url.pathname === "/"
    ) {
      return false;
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return TRUSTED_WEB_PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

function isValidPushKey(value, { min = 16, max = 512 } = {}) {
  return typeof value === "string" && value.length >= min && value.length <= max && /^[A-Za-z0-9+/_=-]+$/.test(value);
}

function isValidNativePushToken(value) {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= MAX_NATIVE_PUSH_TOKEN_LENGTH &&
    /^[A-Za-z0-9:._-]+$/.test(value)
  );
}

function parseWebSubscription(tokenOrSub) {
  if (!tokenOrSub) return null;
  let sub = tokenOrSub;
  if (typeof sub === "string") {
    try {
      sub = JSON.parse(sub);
    } catch {
      return null;
    }
  }
  if (!sub || typeof sub !== "object" || !sub.endpoint) return null;
  const keys = sub.keys || {};
  return {
    endpoint: String(sub.endpoint),
    publicKey: keys.p256dh || keys.publicKey || sub.publicKey || sub.public_key || null,
    authSecret: keys.auth || keys.authSecret || sub.authSecret || sub.auth_secret || null,
    raw: sub
  };
}

function isValidWebSubscription(subscription) {
  return !!(
    subscription &&
    isTrustedWebPushEndpoint(subscription.endpoint) &&
    isValidPushKey(subscription.publicKey, { min: 32, max: 512 }) &&
    isValidPushKey(subscription.authSecret, { min: 16, max: 128 })
  );
}

function nativeEndpoint(platform, token) {
  return `${platform}:${token}`;
}

async function ensurePushSubscriptionsTable(pool) {
  if (tableReady) return;
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform VARCHAR(30) NOT NULL,
      endpoint TEXT NOT NULL,
      token TEXT,
      public_key TEXT,
      auth_secret TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_used_at TIMESTAMPTZ,
      invalidated_at TIMESTAMPTZ,
      invalidation_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, endpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
      ON push_subscriptions (user_id) WHERE is_active = TRUE;
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint
      ON push_subscriptions (endpoint);
  `);
  await pool
    .query(
      `
    ALTER TABLE push_subscriptions
      ADD COLUMN IF NOT EXISTS invalidation_reason TEXT
  `
    )
    .catch(() => {});
  await pool
    .query(
      `
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS push_reactivation_needed BOOLEAN NOT NULL DEFAULT FALSE
  `
    )
    .catch(() => {});

  // One-time bridge from legacy push_tokens → push_subscriptions.
  await pool
    .query(
      `
    INSERT INTO push_subscriptions (
      id, user_id, platform, endpoint, token, public_key, auth_secret,
      is_active, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      pt.user_id,
      CASE
        WHEN lower(pt.platform) IN ('fcm', 'android') THEN 'android'
        WHEN lower(pt.platform) IN ('apns', 'ios') THEN 'ios'
        ELSE 'web'
      END,
      CASE
        WHEN lower(pt.platform) IN ('web') AND pt.token LIKE '{%' THEN
          COALESCE(pt.token::jsonb->>'endpoint', 'web:' || md5(pt.token))
        WHEN lower(pt.platform) IN ('fcm', 'android') THEN 'android:' || pt.token
        WHEN lower(pt.platform) IN ('apns', 'ios') THEN 'ios:' || pt.token
        ELSE COALESCE(pt.platform, 'web') || ':' || pt.token
      END,
      CASE
        WHEN lower(pt.platform) IN ('web') AND pt.token LIKE '{%' THEN NULL
        ELSE pt.token
      END,
      CASE
        WHEN lower(pt.platform) IN ('web') AND pt.token LIKE '{%' THEN
          pt.token::jsonb->'keys'->>'p256dh'
        ELSE NULL
      END,
      CASE
        WHEN lower(pt.platform) IN ('web') AND pt.token LIKE '{%' THEN
          pt.token::jsonb->'keys'->>'auth'
        ELSE NULL
      END,
      COALESCE(pt.enabled, TRUE),
      COALESCE(pt.created_at, NOW()),
      COALESCE(pt.updated_at, NOW())
    FROM push_tokens pt
    WHERE pt.user_id IS NOT NULL AND pt.token IS NOT NULL
    ON CONFLICT (user_id, endpoint) DO NOTHING
  `
    )
    .catch(() => {});

  tableReady = true;
}

/**
 * Register or reactivate a device subscription.
 * Accepts either:
 *   { platform, endpoint, publicKey, authSecret, token }
 *   { platform: 'web', subscription } / { token: PushSubscriptionJSON }
 *   { platform: 'ios'|'android', token }
 */
async function registerSubscription(pool, userId, input = {}) {
  await ensurePushSubscriptionsTable(pool);
  if (!isSupportedPlatform(input.platform)) {
    const err = new Error("invalid_platform");
    err.code = "invalid_platform";
    throw err;
  }
  const platform = normalizePlatform(input.platform);

  let endpoint = null;
  let token = input.token || null;
  let publicKey = null;
  let authSecret = null;

  if (platform === "web") {
    const web = parseWebSubscription(input.subscription || input.token || input);
    if (!isValidWebSubscription(web)) {
      const err = new Error("invalid_web_subscription");
      err.code = "invalid_web_subscription";
      throw err;
    }
    endpoint = web.endpoint;
    publicKey = web.publicKey;
    authSecret = web.authSecret;
    // Keep a compact token copy for legacy dispatch fallbacks.
    token = JSON.stringify({
      endpoint: web.endpoint,
      keys: { p256dh: web.publicKey, auth: web.authSecret }
    });
  } else {
    token = typeof token === "string" ? token : null;
    if (!isValidNativePushToken(token)) {
      const err = new Error("invalid_native_token");
      err.code = "invalid_native_token";
      throw err;
    }
    // Native endpoints are an internal identifier, never client-controlled.
    endpoint = nativeEndpoint(platform, token);
  }

  if (!endpoint) {
    const err = new Error("endpoint_or_token_required");
    err.code = "endpoint_or_token_required";
    throw err;
  }

  const id = crypto.randomUUID();
  const res = await pool.query(
    `INSERT INTO push_subscriptions
       (id, user_id, platform, endpoint, token, public_key, auth_secret, is_active, last_used_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
     ON CONFLICT (user_id, endpoint) DO UPDATE SET
       platform = EXCLUDED.platform,
       token = COALESCE(EXCLUDED.token, push_subscriptions.token),
       public_key = COALESCE(EXCLUDED.public_key, push_subscriptions.public_key),
       auth_secret = COALESCE(EXCLUDED.auth_secret, push_subscriptions.auth_secret),
       is_active = TRUE,
       invalidated_at = NULL,
       invalidation_reason = NULL,
       last_used_at = NOW(),
       updated_at = NOW()
     RETURNING id, user_id, platform, endpoint, is_active`,
    [id, userId, platform, endpoint, token, publicKey, authSecret]
  );

  // Étape 45 — successful re-registration clears the reactivation prompt.
  await pool.query(`UPDATE users SET push_reactivation_needed = FALSE WHERE id = $1`, [userId]).catch(() => {});

  return res.rows[0];
}

async function unregisterSubscription(pool, userId, { endpoint = null, token = null } = {}) {
  await ensurePushSubscriptionsTable(pool);
  if (!endpoint && !token) return false;

  // Soft-invalidate so history remains; also support lookup by token / native endpoint.
  const res = await pool.query(
    `UPDATE push_subscriptions
     SET is_active = FALSE, invalidated_at = NOW(), updated_at = NOW()
     WHERE user_id = $1
       AND is_active = TRUE
       AND (
         ($2::text IS NOT NULL AND endpoint = $2)
         OR ($3::text IS NOT NULL AND (token = $3 OR endpoint = $3 OR endpoint = 'android:' || $3 OR endpoint = 'ios:' || $3 OR endpoint = 'web:' || $3))
         OR ($3::text IS NOT NULL AND token LIKE '{%' AND token::jsonb->>'endpoint' = $3)
       )
     RETURNING id`,
    [userId, endpoint, token]
  );
  return res.rows.length > 0;
}

async function unregisterAllSubscriptions(pool, userId) {
  await ensurePushSubscriptionsTable(pool);
  await pool.query(
    `UPDATE push_subscriptions
     SET is_active = FALSE, invalidated_at = NOW(), updated_at = NOW()
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId]
  );
}

/**
 * Provider errors that mean the token/subscription is permanently dead.
 * These must deactivate the row and must not be retried.
 */
function isPermanentProviderFailure({ statusCode = null, error = null, expired = false } = {}) {
  if (expired) return true;
  const code = Number(statusCode);
  if (code === 404 || code === 410) return true;
  const err = String(error || "").toLowerCase();
  if (!err) return false;
  const needles = [
    "notregistered",
    "invalidregistration",
    "unregistered",
    "baddevicetoken",
    "devicetokennotfortopic",
    "expiredtoken",
    "invalidtoken",
    "mismatchedsenderid",
    "canonical_id", // FCM replaced token — treat as stale
    "gone"
  ];
  return needles.some((n) => err.includes(n));
}

/**
 * Étape 45 — deactivate an invalid subscription, stop further use, and if the
 * user has no active devices left while push is enabled, set
 * push_reactivation_needed so the client can prompt them.
 */
/** Étape 59 — user-initiated device disable (scoped to owner). */
async function deactivateSubscriptionForUser(pool, userId, subscriptionId, { reason = "user_disabled" } = {}) {
  await ensurePushSubscriptionsTable(pool);
  if (userId == null || !subscriptionId) return { deactivated: false };
  const res = await pool.query(
    `UPDATE push_subscriptions
     SET is_active = FALSE,
         invalidated_at = NOW(),
         invalidation_reason = $3,
         updated_at = NOW()
     WHERE id = $1::uuid
       AND user_id = $2
       AND is_active = TRUE
     RETURNING id, user_id, endpoint`,
    [subscriptionId, userId, String(reason || "user_disabled").slice(0, 200)]
  );
  if (!res.rows.length) return { deactivated: false };
  return {
    deactivated: true,
    userId,
    subscriptionId: res.rows[0].id,
    endpoint: res.rows[0].endpoint
  };
}

async function deactivateInvalidSubscription(
  pool,
  { endpoint = null, subscriptionId = null, userId = null, reason = "provider_invalid" } = {}
) {
  await ensurePushSubscriptionsTable(pool);
  if (!endpoint && !subscriptionId) return { deactivated: false };

  const res = await pool.query(
    `UPDATE push_subscriptions
     SET is_active = FALSE,
         invalidated_at = NOW(),
         invalidation_reason = $3,
         updated_at = NOW()
     WHERE is_active = TRUE
       AND (
         ($1::uuid IS NOT NULL AND id = $1::uuid)
         OR ($2::text IS NOT NULL AND endpoint = $2)
       )
     RETURNING id, user_id, endpoint`,
    [subscriptionId, endpoint, String(reason || "provider_invalid").slice(0, 200)]
  );
  if (!res.rows.length) return { deactivated: false };

  const ownerId = userId || res.rows[0].user_id;

  // Cancel pending push-only queue jobs for this user — no point retrying a dead token.
  await pool
    .query(
      `UPDATE notification_delivery_queue
     SET status = 'cancelled', processed_at = NOW(), updated_at = NOW(),
         last_error = 'subscription_invalid'
     WHERE recipient_id = $1
       AND status IN ('pending', 'processing')
       AND channels = ARRAY['push']::text[]`,
      [ownerId]
    )
    .catch(() => {});

  const active = await pool.query(
    `SELECT COUNT(*)::int AS c FROM push_subscriptions
     WHERE user_id = $1 AND is_active = TRUE`,
    [ownerId]
  );
  let reactivationNeeded = false;
  if ((active.rows[0]?.c || 0) === 0) {
    const flagged = await pool.query(
      `UPDATE users
       SET push_reactivation_needed = TRUE
       WHERE id = $1 AND push_enabled = TRUE AND deleted_at IS NULL
       RETURNING id`,
      [ownerId]
    );
    reactivationNeeded = flagged.rows.length > 0;
  }

  return {
    deactivated: true,
    userId: ownerId,
    subscriptionId: res.rows[0].id,
    endpoint: res.rows[0].endpoint,
    reactivationNeeded
  };
}

async function invalidateSubscriptionByEndpoint(pool, endpoint, reason = "provider_invalid") {
  return deactivateInvalidSubscription(pool, { endpoint, reason });
}

async function userNeedsPushReactivation(pool, userId) {
  const res = await pool.query(
    `SELECT push_reactivation_needed FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  return !!res.rows[0]?.push_reactivation_needed;
}

async function touchSubscription(pool, subscriptionId) {
  if (!subscriptionId) return;
  await pool
    .query(`UPDATE push_subscriptions SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`, [subscriptionId])
    .catch(() => {});
}

/** Active subscriptions for a user (multi-device). */
async function getActiveSubscriptionsForUser(pool, userId) {
  await ensurePushSubscriptionsTable(pool);
  const res = await pool.query(
    `SELECT ps.id, ps.user_id, ps.platform, ps.endpoint, ps.token,
            ps.public_key, ps.auth_secret, ps.last_used_at
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.user_id = $1
       AND ps.is_active = TRUE
       AND u.deleted_at IS NULL`,
    [userId]
  );
  return res.rows;
}

function toDispatchTarget(row) {
  const platform = normalizePlatform(row.platform);
  if (platform === "web") {
    if (row.endpoint && row.public_key && row.auth_secret) {
      const subscription = {
        endpoint: row.endpoint,
        publicKey: row.public_key,
        authSecret: row.auth_secret
      };
      if (!isValidWebSubscription(subscription)) return null;
      return {
        id: row.id,
        platform: "web",
        endpoint: row.endpoint,
        subscription: {
          endpoint: row.endpoint,
          keys: { p256dh: row.public_key, auth: row.auth_secret }
        }
      };
    }
    // Legacy JSON token fallback.
    if (row.token) {
      try {
        const sub = typeof row.token === "string" ? JSON.parse(row.token) : row.token;
        const parsed = parseWebSubscription(sub);
        if (!isValidWebSubscription(parsed)) return null;
        return {
          id: row.id,
          platform: "web",
          endpoint: parsed.endpoint,
          subscription: { endpoint: parsed.endpoint, keys: { p256dh: parsed.publicKey, auth: parsed.authSecret } }
        };
      } catch {
        return null;
      }
    }
    return null;
  }
  const token =
    row.token ||
    (row.endpoint && row.endpoint.includes(":") ? row.endpoint.slice(row.endpoint.indexOf(":") + 1) : null);
  // Legacy database rows bypassed registerSubscription(), so never trust a
  // token merely because it was persisted before the current validation was
  // introduced. In particular, an arbitrary APNS token is interpolated into
  // an HTTP/2 request path; reject it before it reaches a provider client.
  if (!isValidNativePushToken(token)) return null;
  // Use a canonical internal endpoint rather than a legacy stored value. The
  // row id remains the authority for updates/deactivation, while this keeps
  // provider-facing logging and error handling free of untrusted endpoint
  // strings from historical data.
  return { id: row.id, platform, endpoint: nativeEndpoint(platform, token), token };
}

module.exports = {
  PLATFORMS,
  normalizePlatform,
  isSupportedPlatform,
  parseWebSubscription,
  isTrustedWebPushEndpoint,
  isValidWebSubscription,
  ensurePushSubscriptionsTable,
  registerSubscription,
  unregisterSubscription,
  unregisterAllSubscriptions,
  invalidateSubscriptionByEndpoint,
  deactivateInvalidSubscription,
  deactivateSubscriptionForUser,
  isPermanentProviderFailure,
  userNeedsPushReactivation,
  touchSubscription,
  getActiveSubscriptionsForUser,
  toDispatchTarget
};
