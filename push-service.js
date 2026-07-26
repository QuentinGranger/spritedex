// ── SPRITNEX push notification service ─────────────────────────────────────
// Handles registration, storage and dispatch of push tokens for Web Push
// (VAPID) and native Capacitor/FCM/APNS tokens.
//
// For the PWA, the browser Push API is used via the web-push library.
// For iOS/Android, Capacitor Push Notifications registers a native token
// (FCM on Android, APNS on iOS) that is forwarded to this service.
//
// Required environment variables:
//   VAPID_PUBLIC_KEY  (auto-generated on first boot if missing)
//   VAPID_PRIVATE_KEY (auto-generated on first boot if missing)
//   VAPID_SUBJECT     (mailto: or https:// URL)
// Optional:
//   FCM_SERVER_KEY    (legacy FCM token for Android native pushes)
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY, APNS_TOPIC (for iOS native pushes)

const crypto = require("crypto");
const webpush = require("web-push");
const https = require("https");
const http2 = require("http2");
const fs = require("fs");
const path = require("path");
const notificationCatalog = require("./server/notification-catalog");
const notificationPreferences = require("./server/notification-preferences");
const notificationChannels = require("./server/notification-channels");
const pushSubscriptions = require("./server/push-subscriptions");

const VAPID_FILE = path.join(__dirname, ".vapid-keys.json");
const DEFAULT_VAPID_SUBJECT = "mailto:quentinsavigny@protonmail.com";

function isValidVapidKeys(value) {
  return !!(
    value &&
    typeof value.publicKey === "string" && value.publicKey.length > 0 &&
    typeof value.privateKey === "string" && value.privateKey.length > 0
  );
}

function readStoredVapidKeys(filePath = VAPID_FILE) {
  // Open without following links, then inspect and chmod the *open file
  // descriptor*. `lstat` followed by `chmod/readFile(path)` would leave a
  // time-of-check/time-of-use window for a local symlink replacement.
  const noFollow = fs.constants.O_NOFOLLOW;
  if (!noFollow) throw new Error("Secure VAPID key reads require O_NOFOLLOW support");
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stats = fs.fstatSync(fd);
    // Refuse special files. A secret file must be a regular file owned and
    // controlled by the deployment, never an arbitrary device/pipe.
    if (!stats.isFile()) throw new Error("VAPID key file must be a regular file");

    // Existing installations may have been created with the process umask.
    // Apply permissions through the descriptor so they cannot be redirected.
    fs.fchmodSync(fd, 0o600);

    const saved = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (!isValidVapidKeys(saved)) {
      // Do not silently replace malformed existing material: replacing it
      // would invalidate subscriptions and could conceal tampering.
      throw new Error("VAPID key file is missing a public or private key");
    }
    return {
      publicKey: saved.publicKey,
      privateKey: saved.privateKey,
      subject: saved.subject || process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
    };
  } finally {
    fs.closeSync(fd);
  }
}

function createVapidKeysFile(filePath, keys) {
  // Write the complete payload to a private temporary file, then publish it
  // with `link`. Unlike `rename`, link fails when the destination already
  // exists, so a concurrent process (or a pre-existing file) is never
  // overwritten. The published file is therefore both complete and 0600.
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(16).toString("hex")}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(keys, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.linkSync(temporaryPath, filePath);
  } finally {
    if (fd != null) fs.closeSync(fd);
    // The destination has its own hard link after publication. If publishing
    // failed, this only removes our private, incomplete temporary file.
    try {
      fs.unlinkSync(temporaryPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}

function loadOrCreateVapidKeys(filePath = VAPID_FILE) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
    };
  }

  try {
    return readStoredVapidKeys(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[PUSH] Refusing to replace existing VAPID keys:", err.message);
      throw err;
    }
  }

  const generated = webpush.generateVAPIDKeys();
  const keys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
  };
  try {
    createVapidKeysFile(filePath, keys);
    console.log("[PUSH] Generated and saved new VAPID keys to", filePath);
    return keys;
  } catch (err) {
    // A concurrent process may have created the key file first. Read that
    // material rather than overwrite it; any other failure is unsafe to hide.
    if (err.code === "EEXIST") return readStoredVapidKeys(filePath);
    console.error("[PUSH] Failed to create VAPID key file:", err.message);
    throw err;
  }
}

const vapidKeys = loadOrCreateVapidKeys();
webpush.setVapidDetails(
  vapidKeys.subject,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

function getVapidPublicKey() {
  return vapidKeys.publicKey;
}

// ── Token / subscription persistence ──
// Étape 44 — push_subscriptions is the source of truth (multi-device).
// Legacy push_tokens is kept for migration only.
async function ensurePushTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      platform VARCHAR(20) NOT NULL DEFAULT 'web',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, token)
    );
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);
  `);
  await pushSubscriptions.ensurePushSubscriptionsTable(pool);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_new_sprites BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_new_variants BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_squad_activity BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_session_summary BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_goals BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_sync BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_news BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS push_pref_friend_collection_updates BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS push_pref_friend_priority_matches BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS push_quiet_start SMALLINT,
      ADD COLUMN IF NOT EXISTS push_quiet_end SMALLINT,
      ADD COLUMN IF NOT EXISTS push_max_per_day INTEGER NOT NULL DEFAULT 8,
      ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
      ADD COLUMN IF NOT EXISTS push_reactivation_needed BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  // Étape 52 — safety default is 8/day (migrate the previous schema default of 20).
  await pool.query(`
    ALTER TABLE users ALTER COLUMN push_max_per_day SET DEFAULT 8
  `).catch(() => {});
  await pool.query(`
    UPDATE users SET push_max_per_day = 8 WHERE push_max_per_day = 20
  `).catch(() => {});
}

async function registerToken(pool, userId, token, platform = "web", extras = {}) {
  return pushSubscriptions.registerSubscription(pool, userId, {
    platform,
    token,
    ...extras
  });
}

async function unregisterToken(pool, userId, token) {
  await pushSubscriptions.unregisterSubscription(pool, userId, { token, endpoint: token });
  // Legacy cleanup.
  await pool.query(
    "DELETE FROM push_tokens WHERE user_id = $1 AND token = $2",
    [userId, token]
  ).catch(() => {});
}

async function unregisterAllTokens(pool, userId) {
  await pushSubscriptions.unregisterAllSubscriptions(pool, userId);
  await pool.query("DELETE FROM push_tokens WHERE user_id = $1", [userId]).catch(() => {});
}

async function getEnabledTokensForUser(pool, userId) {
  const rows = await pushSubscriptions.getActiveSubscriptionsForUser(pool, userId);
  return rows.map(pushSubscriptions.toDispatchTarget).filter(Boolean);
}

async function getNewsSubscriberTokens(pool) {
  await pushSubscriptions.ensurePushSubscriptionsTable(pool);
  const result = await pool.query(
    `SELECT ps.id, ps.user_id, ps.platform, ps.endpoint, ps.token,
            ps.public_key, ps.auth_secret
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.is_active = TRUE
       AND u.push_enabled = TRUE
       AND u.push_pref_news = TRUE
       AND u.deleted_at IS NULL`
  );
  return result.rows.map(row => {
    const target = pushSubscriptions.toDispatchTarget(row);
    return target ? { ...target, user_id: row.user_id } : null;
  }).filter(Boolean);
}

async function getSquadMemberTokens(pool, squadId, excludeUserId) {
  await pushSubscriptions.ensurePushSubscriptionsTable(pool);
  const result = await pool.query(
    `SELECT ps.id, ps.user_id, ps.platform, ps.endpoint, ps.token,
            ps.public_key, ps.auth_secret, u.push_pref_squad_activity
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     JOIN squad_members sm ON sm.user_id = u.id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND ps.is_active = TRUE
       AND u.push_enabled = TRUE
       AND u.push_pref_squad_activity = TRUE
       AND u.deleted_at IS NULL
       AND u.id <> $2`,
    [squadId, excludeUserId]
  );
  return result.rows.map(row => {
    const target = pushSubscriptions.toDispatchTarget(row);
    return target ? { ...target, push_pref_squad_activity: row.push_pref_squad_activity } : null;
  }).filter(Boolean);
}

// ── Sending ──
// Push payloads are rendered outside the usual in-app navigation checks.
// Treat every field as potentially persisted/legacy/untrusted input: a remote
// news feed or stale database row must not make a subscriber's service worker
// fetch a private-network image or open an external URL on notification click.
const PUSH_LOCAL_ORIGIN = "https://spritedex.invalid";
const PUSH_ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".ico"]);

function normalizePushPath(value, fallback = "/") {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  try {
    const parsed = new URL(value, PUSH_LOCAL_ORIGIN);
    if (parsed.origin !== PUSH_LOCAL_ORIGIN || !parsed.pathname.startsWith("/")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function normalizePushAsset(value, fallback) {
  const safePath = normalizePushPath(value, "");
  if (!safePath) return fallback;
  try {
    const pathname = new URL(safePath, PUSH_LOCAL_ORIGIN).pathname;
    return PUSH_ASSET_EXTENSIONS.has(path.extname(pathname).toLowerCase()) ? safePath : fallback;
  } catch {
    return fallback;
  }
}

function normalizePushText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  return value.slice(0, maxLength);
}

function buildNotificationPayload({ title, body, icon, url, badge } = {}) {
  return {
    notification: {
      title: normalizePushText(title, "SPRITNEX", 200) || "SPRITNEX",
      body: normalizePushText(body, "", 1000),
      icon: normalizePushAsset(icon, "/icons/icon-192x192.png"),
      badge: normalizePushAsset(badge, "/icons/icon-72x72.png"),
      tag: "spritedex",
      requireInteraction: false,
      data: {
        url: normalizePushPath(url, "/")
      }
    }
  };
}

async function sendWebPush(subscription, payload) {
  const parsed = pushSubscriptions.parseWebSubscription(subscription);
  if (!pushSubscriptions.isValidWebSubscription(parsed)) {
    return { ok: false, permanent: true, expired: true, error: "Untrusted web push endpoint" };
  }
  try {
    await webpush.sendNotification({
      endpoint: parsed.endpoint,
      keys: { p256dh: parsed.publicKey, auth: parsed.authSecret }
    }, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const permanent = pushSubscriptions.isPermanentProviderFailure({
      statusCode: err.statusCode,
      error: err.message,
      expired: err.statusCode === 404 || err.statusCode === 410
    });
    return {
      ok: false,
      expired: permanent,
      permanent,
      statusCode: err.statusCode || null,
      error: err.message
    };
  }
}

function sendFcmLegacy(token, payload) {
  return new Promise((resolve) => {
    if (!process.env.FCM_SERVER_KEY) {
      return resolve({ ok: false, error: "FCM_SERVER_KEY not configured" });
    }
    const data = JSON.stringify({
      to: token,
      notification: payload.notification,
      data: payload.notification.data
    });
    const req = https.request(
      {
        hostname: "fcm.googleapis.com",
        path: "/fcm/send",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `key=${process.env.FCM_SERVER_KEY}`
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            if (json.failure) {
              const fcmError = json.results?.[0]?.error || body;
              const permanent = pushSubscriptions.isPermanentProviderFailure({ error: fcmError });
              resolve({ ok: false, error: fcmError, expired: permanent, permanent });
            } else resolve({ ok: true });
          } catch {
            resolve({ ok: res.statusCode < 300, error: body });
          }
        });
      }
    );
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.write(data);
    req.end();
  });
}

// APNS helpers: build a JWT with the .p8 key and send via HTTP/2.
function base64Url(input) {
  if (typeof input === "string") input = Buffer.from(input, "utf8");
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function derSignatureToP256Raw(der) {
  // DER sequence: 0x30 <seqLen> 0x02 <rLen> <rBytes> 0x02 <sLen> <sBytes>
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("Invalid DER signature");
  const seqLen = der[i++];
  if (der.length < 2 + seqLen) throw new Error("DER signature too short");
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("Invalid DER integer");
    const len = der[i++];
    let buf = der.slice(i, i + len);
    i += len;
    // Drop leading zero if present (positive integer sign bit)
    if (buf.length === 33 && buf[0] === 0) buf = buf.slice(1);
    // Pad to 32 bytes
    const out = Buffer.alloc(32);
    buf.copy(out, 32 - buf.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

function signApnsJwt() {
  let keyPem = process.env.APNS_KEY.trim()
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n");
  const header = JSON.stringify({ alg: "ES256", kid: process.env.APNS_KEY_ID });
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iss: process.env.APNS_TEAM_ID, iat: now });
  const signingInput = `${base64Url(header)}.${base64Url(payload)}`;
  const sign = crypto.createSign("sha256");
  sign.update(signingInput);
  sign.end();
  const derSig = sign.sign(keyPem);
  const rawSig = derSignatureToP256Raw(derSig);
  return `${signingInput}.${base64Url(rawSig)}`;
}

let apnsClient = null;
function getApnsClient() {
  if (!apnsClient) {
    apnsClient = http2.connect("https://api.push.apple.com");
    apnsClient.on("error", () => { apnsClient = null; });
    apnsClient.on("goaway", () => { apnsClient = null; });
  }
  return apnsClient;
}

function sendApns(deviceToken, payload) {
  return new Promise((resolve) => {
    if (!process.env.APNS_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_TOPIC) {
      return resolve({ ok: false, error: "APNS credentials not configured" });
    }
    const jwt = signApnsJwt();
    const apnsPayload = JSON.stringify({
      aps: {
        alert: { title: payload.notification.title, body: payload.notification.body },
        badge: 1,
        sound: "default"
      },
      url: payload.notification.data?.url || "/"
    });
    const client = getApnsClient();
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      "authorization": `bearer ${jwt}`,
      "apns-topic": process.env.APNS_TOPIC,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(apnsPayload)
    });
    req.setEncoding("utf8");
    let responseData = "";
    req.on("response", (headers) => {
      const status = headers[":status"];
      req.on("data", (chunk) => { responseData += chunk; });
      req.on("end", () => {
        if (status === 200) return resolve({ ok: true });
        const errMsg = responseData || `APNS status ${status}`;
        const permanent = pushSubscriptions.isPermanentProviderFailure({
          statusCode: status,
          error: errMsg,
          expired: status === 410
        });
        resolve({ ok: false, expired: permanent, permanent, statusCode: status, error: errMsg });
      });
    });
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.write(apnsPayload);
    req.end();
  });
}

async function dispatchNotification({ pool, target, payload }) {
  const platform = pushSubscriptions.normalizePlatform(target.platform);
  if (platform === "web") {
    const subscription = target.subscription
      || (typeof target.token === "string" ? JSON.parse(target.token) : target.token);
    if (!subscription || !subscription.endpoint) {
      return { ok: false, error: "Invalid web push subscription", endpoint: target.endpoint };
    }
    const result = await sendWebPush(subscription, payload);
    return { ...result, endpoint: subscription.endpoint || target.endpoint };
  }
  if (platform === "android") {
    const result = await sendFcmLegacy(target.token, payload);
    return { ...result, endpoint: target.endpoint };
  }
  if (platform === "ios") {
    const result = await sendApns(target.token, payload);
    return { ...result, endpoint: target.endpoint };
  }
  return { ok: false, error: `Unknown platform ${platform}` };
}

async function handleDispatchResult(pool, target, result) {
  if (result.ok && target.id) {
    await pushSubscriptions.touchSubscription(pool, target.id);
    return { ...result, permanent: false };
  }
  const permanent = !!(result.permanent || result.expired
    || pushSubscriptions.isPermanentProviderFailure(result));
  if (permanent) {
    // Étape 45 — deactivate invalid token; do not keep retrying it.
    await pushSubscriptions.deactivateInvalidSubscription(pool, {
      endpoint: result.endpoint || target.endpoint,
      subscriptionId: target.id || null,
      userId: target.user_id || null,
      reason: result.error || "provider_invalid"
    });
  }
  return { ...result, permanent };
}

async function notifyUser(pool, userId, message) {
  const targets = await getEnabledTokensForUser(pool, userId);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const target of targets) {
    let result;
    try {
      result = await dispatchNotification({ pool, target, payload });
    } catch (err) {
      result = { ok: false, error: err.message, endpoint: target.endpoint };
    }
    result = await handleDispatchResult(pool, { ...target, user_id: userId }, result);
    results.push({
      platform: target.platform,
      ok: result.ok,
      error: result.error,
      permanent: !!result.permanent,
      messageId: result.messageId || null
    });
  }
  return results;
}

// Alias used by friend/squad routes for per-user notifications.
async function sendNotificationToUser(pool, userId, message) {
  return notifyUser(pool, userId, message);
}

async function notifySquadMembers(pool, squadId, senderUserId, message) {
  const targets = await getSquadMemberTokens(pool, squadId, senderUserId);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const target of targets) {
    let result;
    try {
      result = await dispatchNotification({ pool, target, payload });
    } catch (err) {
      result = { ok: false, error: err.message, endpoint: target.endpoint };
    }
    result = await handleDispatchResult(pool, target, result);
    results.push({ platform: target.platform, ok: result.ok, error: result.error, permanent: !!result.permanent });
  }
  return results;
}

async function notifyNewsSubscribers(pool, message) {
  const targets = await getNewsSubscriberTokens(pool);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const target of targets) {
    let result;
    try {
      result = await dispatchNotification({ pool, target, payload });
    } catch (err) {
      result = { ok: false, error: err.message, endpoint: target.endpoint };
    }
    result = await handleDispatchResult(pool, target, result);
    results.push({ platform: target.platform, ok: result.ok, error: result.error, permanent: !!result.permanent });
  }
  return results;
}

// ── Notification status lifecycle ──
// Moves a notification to a new status and stamps the matching timestamp
// column. Timestamps are only set the first time (COALESCE) so we keep the
// original moment of delivery/read/etc.
const STATUS_TIMESTAMP = {
  delivered: "delivered_at",
  read: "read_at",
  archived: "archived_at"
};

async function setNotificationStatus(pool, notificationId, status, { recipientId } = {}) {
  if (!notificationId || !notificationCatalog.isKnownStatus(status)) return false;
  const tsCol = STATUS_TIMESTAMP[status];
  const stampClause = tsCol ? `, ${tsCol} = COALESCE(${tsCol}, NOW())` : "";
  const args = [notificationId, status];
  let where = "id = $1";
  if (recipientId) {
    where += " AND recipient_id = $3";
    args.push(recipientId);
  }
  const result = await pool.query(
    `UPDATE notifications SET status = $2${stampClause} WHERE ${where} RETURNING id`,
    args
  );
  return result.rows.length > 0;
}

// ── Inbox notifications ──
// Persists a notification for the recipient and dispatches a push when allowed.
async function createNotification(pool, {
  recipientId, actorId, type,
  category, entityType, entityId,
  context = {}, data, title, body, message, url,
  status = "created",
  lang = notificationCatalog.DEFAULT_LANGUAGE,
  allowPush = true,
  // When true, persist the row (typically status='queued') but do not push/email
  // yet — callers revalidate then deliver or cancel (Étape 38).
  deferDelivery = false
}) {
  if (!recipientId) return null;
  if (actorId && String(actorId) === String(recipientId)) return null;

  const finalCategory = category || notificationCatalog.getCategory(type) || "general";

  try {
    // Étape 57 — never create pairwise social/collection notifs across a block.
    if (actorId) {
      const blocks = require("./server/notification-blocks");
      if (blocks.isBlockedPairwiseType(type)) {
        const { isBlocked } = require("./server/auth");
        if (await isBlocked(recipientId, actorId)) return null;
      }
    }

    const userRes = await pool.query(
      `SELECT email, push_enabled, push_pref_friend_collection_updates, push_pref_friend_priority_matches,
              push_quiet_start, push_quiet_end, push_max_per_day, timezone
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [recipientId]
    );
    if (!userRes.rows.length) return null;
    const user = userRes.rows[0];

    if (type === "friend_collection_updated" && user.push_pref_friend_collection_updates === false) return null;
    if (type === "friend_priority_match" && user.push_pref_friend_priority_matches === false) return null;

    // Étape 40 — render with the user's timezone; keep instants as UTC ISO in data.
    const { normalizeTimeZone, toUtcIso } = require("./server/timezone");
    const timeZone = normalizeTimeZone(user.timezone);
    user.timezone = timeZone;
    const baseContext = context && typeof context === "object" ? { ...context } : {};
    for (const key of ["endingAt", "endDate", "availableFrom", "availableUntil"]) {
      if (baseContext[key] != null) {
        const iso = toUtcIso(baseContext[key]);
        if (iso) baseContext[key] = iso;
      }
    }
    baseContext.timeZone = baseContext.timeZone || baseContext.timezone || timeZone;
    baseContext.timezone = baseContext.timeZone;

    // Étape 40/62 — render with timezone-aware context and localized catalog names.
    const rendered = notificationCatalog.isKnownType(type)
      ? await notificationCatalog.renderNotificationLocalized(pool, type, baseContext, lang)
      : null;
    const finalTitle = title || (rendered && rendered.title) || "SPRITNEX";
    const finalBody = body || message || (rendered && rendered.body) || "";
    const finalUrl = url || (rendered ? rendered.url : "/");

    // `data` holds everything needed to render/navigate later: caller context,
    // then the catalog payload (friendId, actionUrl, actions…) so structured
    // fields stay canonical, plus related ids.
    const catalogData = (rendered && rendered.data && typeof rendered.data === "object")
      ? rendered.data
      : {};
    const baseData = (data && typeof data === "object")
      ? data
      : baseContext;
    // Étape 53 — send-priority score (used when the daily push cap is hit).
    const sendPriority = notificationCatalog.resolveSendPriority(type, baseContext);
    const sendPriorityLevel = notificationCatalog.classifySendPriority(sendPriority);

    // Étape 61 — persist translation key + structured params for re-render.
    const translation = notificationCatalog.isKnownType(type)
      ? notificationCatalog.buildTranslationPayload(type, baseContext)
      : null;

    const storedData = {
      ...baseData,
      ...catalogData,
      timeZone,
      sendPriority,
      sendPriorityLevel,
      ...(actorId ? { actorId: String(actorId) } : {}),
      ...(recipientId ? { recipientId: String(recipientId) } : {}),
      ...(entityId ? { entityId: String(entityId) } : {}),
      ...(rendered && rendered.actions ? { actions: rendered.actions } : {}),
      ...(translation ? {
        translationKey: translation.translationKey,
        translationParams: translation.translationParams
      } : {})
    };

    // Étape 3: persist the notification FIRST (in-app is served by this row),
    // before any push/email work. The row is immediately visible in the inbox.
    const inserted = await pool.query(
      `INSERT INTO notifications
         (recipient_id, actor_id, type, category, title, body, entity_type, entity_id, data, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING id`,
      [
        recipientId, actorId || null, type, finalCategory, finalTitle, finalBody,
        entityType || null, entityId || null, JSON.stringify(storedData), status
      ]
    );
    const notificationId = inserted.rows[0]?.id;

    // Étape 43 — in_app delivery is recorded as soon as the inbox row exists.
    if (notificationId) {
      const deliveries = require("./server/notification-deliveries");
      await deliveries.recordInAppDelivery(pool, notificationId)
        .catch(err => console.error("[createNotification] in_app delivery row failed:", err.message));
    }

    // Resolve delivery channels (Étape 7): combines the type's target channels,
    // the étape 6 subject gates (category+type) and per-channel toggles, plus the
    // push runtime constraints (consent, quiet hours, frequency, token state).
    // Étape 41 — quiet hours defer non-urgent push instead of dropping it.
    const resolved = await notificationChannels.resolveDeliveryChannels(
      pool, recipientId, type, {
        category: finalCategory,
        user,
        context: baseContext
      }
    );
    let targetChannels = resolved.channels;
    const dropped = { ...resolved.dropped };
    let pushDeferral = resolved.deferral || null;
    // Étape 21 — callers may suppress push (e.g. per-friend daily push cap).
    if (allowPush === false) {
      if (targetChannels.includes("push")) {
        targetChannels = targetChannels.filter(c => c !== "push");
        dropped.push = "friend_daily_limit";
      }
      pushDeferral = null;
    }

    // Persist the resolved channels into data so the inbox row is complete.
    const finalData = {
      ...storedData,
      channels: targetChannels,
      pushSent: false,
      ...(Object.keys(dropped).length ? { channelsDropped: dropped } : {}),
      ...(deferDelivery ? { deferred: true } : {}),
      // Étape 41 — schedule push for after the quiet window (in-app already stored).
      ...(pushDeferral ? {
        pushDeferred: true,
        pushDeliverAt: pushDeferral.deliverAt,
        ...(pushDeferral.deadline ? { pushDeadline: pushDeferral.deadline } : {})
      } : {})
    };
    if (notificationId) {
      await pool.query(
        `UPDATE notifications SET data = $1::jsonb WHERE id = $2`,
        [JSON.stringify(finalData), notificationId]
      ).catch(err => console.error("[createNotification] data update failed:", err.message));

      // Étape 42 — never send push/email in the request path. Enqueue jobs; a
      // background worker performs deliverExternalChannels and updates status.
      // Étape 38: deferDelivery waits for pre-send revalidation before enqueue.
      // Étape 43 — each external channel also gets a notification_deliveries row.
      if (!deferDelivery) {
        const deliveryQueue = require("./server/notification-delivery-queue");
        const deliveries = require("./server/notification-deliveries");
        const immediate = targetChannels.filter(c => c === "email" || c === "push");
        if (immediate.length) {
          for (const ch of immediate) {
            await deliveries.ensureDelivery(pool, {
              notificationId,
              channel: ch,
              status: "queued",
              provider: ch === "push" ? "web_push" : "email",
              scheduledAt: new Date()
            }).catch(() => {});
          }
          await deliveryQueue.enqueueDelivery(pool, {
            notificationId,
            recipientId,
            channels: immediate,
            notBefore: new Date(),
            title: finalTitle,
            body: finalBody,
            url: finalUrl
          }).catch(err => console.error("[createNotification] enqueue failed:", err.message));
        }
        if (pushDeferral) {
          await deliveries.ensureDelivery(pool, {
            notificationId,
            channel: "push",
            status: "queued",
            provider: "web_push",
            scheduledAt: pushDeferral.deliverAt
          }).catch(() => {});
          await deliveryQueue.enqueueDelivery(pool, {
            notificationId,
            recipientId,
            channels: ["push"],
            notBefore: pushDeferral.deliverAt,
            deadline: pushDeferral.deadline,
            title: finalTitle,
            body: finalBody,
            url: finalUrl
          }).catch(err => console.error("[createNotification] quiet-hours enqueue failed:", err.message));
        }
      }
    }

    return {
      id: notificationId,
      title: finalTitle,
      body: finalBody,
      url: finalUrl,
      targetChannels,
      user,
      data: finalData
    };
  } catch (err) {
    console.error("[createNotification]", err);
    return null;
  }
}

// Detached external delivery for a stored notification (Étape 7). Attempts push
// then email on the resolved channels and flips the row to 'delivered'/'failed'.
// Only a genuine send counts as an attempt: an empty push token set or an email
// skipped for lack of configuration leaves the row as-is (in-app only).
async function deliverExternalChannels(pool, { notificationId, recipientId, user = {}, targetChannels = [], title, body, url }) {
  let externalAttempted = false;
  let externalDelivered = false;
  const deliveries = require("./server/notification-deliveries");

  if (targetChannels.includes("push")) {
    await deliveries.markDeliveryAttempt(pool, notificationId, "push", { provider: "web_push" }).catch(() => {});
    const results = await sendNotificationToUser(pool, recipientId, { title, body, url });
    if (Array.isArray(results) && results.length) {
      externalAttempted = true;
      const ok = results.filter(r => r.ok);
      if (ok.length) {
        externalDelivered = true;
        await deliveries.markDeliveryDelivered(pool, notificationId, "push", {
          provider: "web_push",
          providerMessageId: ok[0].messageId || ok[0].id || null
        }).catch(() => {});
      } else {
        const err = results.find(r => !r.ok);
        const permanent = results.some(r => r.permanent);
        await deliveries.markDeliveryFailed(pool, notificationId, "push", {
          provider: "web_push",
          errorCode: permanent ? "subscription_invalid" : (err?.statusCode ? String(err.statusCode) : "push_failed"),
          errorMessage: err?.error || "push delivery failed"
        }).catch(() => {});
      }
    } else {
      // No active tokens — permanent for this attempt; inbox notification stays.
      await deliveries.markDeliveryFailed(pool, notificationId, "push", {
        provider: "web_push",
        errorCode: "no_tokens",
        errorMessage: "No enabled push tokens"
      }).catch(() => {});
    }
  }

  if (targetChannels.includes("email") && user.email) {
    try {
      await deliveries.markDeliveryAttempt(pool, notificationId, "email", { provider: "resend" }).catch(() => {});
      // Lazy require avoids a require cycle with core at load time.
      const { sendNotificationEmail } = require("./server/core");
      const emailResult = await sendNotificationEmail(user.email, { title, body, url });
      if (emailResult && emailResult.ok) {
        externalAttempted = true;
        externalDelivered = true;
        await deliveries.markDeliveryDelivered(pool, notificationId, "email", {
          provider: "resend",
          providerMessageId: emailResult.id || emailResult.messageId || null
        }).catch(() => {});
      } else if (emailResult && emailResult.skipped) {
        await deliveries.markDeliveryCancelled(pool, notificationId, "email", {
          errorCode: "skipped",
          errorMessage: emailResult.reason || "email skipped"
        }).catch(() => {});
      } else if (emailResult && !emailResult.skipped) {
        externalAttempted = true; // genuine email failure
        await deliveries.markDeliveryFailed(pool, notificationId, "email", {
          provider: "resend",
          errorCode: "email_failed",
          errorMessage: emailResult.error || "email delivery failed"
        }).catch(() => {});
      }
    } catch (e) {
      externalAttempted = true;
      console.warn("[deliverExternalChannels] email channel failed:", e.message);
      await deliveries.markDeliveryFailed(pool, notificationId, "email", {
        provider: "resend",
        errorCode: "email_exception",
        errorMessage: e.message
      }).catch(() => {});
    }
  }

  if (externalAttempted) {
    if (externalDelivered) {
      await pool.query(
        `UPDATE notifications
         SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW())
         WHERE id = $1 AND status IN ('created', 'queued', 'failed')`,
        [notificationId]
      ).catch(err => console.error("[deliverExternalChannels] status update failed:", err.message));
    } else {
      // Étape 45 — push/token failure must not hide the in-app notification.
      await pool.query(
        `UPDATE notifications SET status = 'created'
         WHERE id = $1 AND status IN ('queued', 'failed')`,
        [notificationId]
      ).catch(err => console.error("[deliverExternalChannels] status update failed:", err.message));
    }
  }
}

// Anti-spam helper: has a similar notification (same recipient + type + entity)
// been created within the last `withinHours`? Used by the notification service
// to avoid flooding a user with duplicates.
async function recentNotificationExists(pool, { recipientId, type, entityId = null, withinHours = 24 }) {
  if (!recipientId || !type) return false;
  const params = [recipientId, type, Number(withinHours) || 24];
  let entityClause = "AND entity_id IS NULL";
  if (entityId != null) {
    entityClause = "AND entity_id = $4";
    params.push(String(entityId));
  }
  const res = await pool.query(
    `SELECT 1 FROM notifications
     WHERE recipient_id = $1 AND type = $2
       AND status <> 'cancelled'
       AND created_at > NOW() - ($3::int * INTERVAL '1 hour')
       ${entityClause}
     LIMIT 1`,
    params
  );
  return res.rows.length > 0;
}

// Inbox filters for the notification center (Étape 46).
// Pure helper — exported for unit tests.
function buildNotificationInboxFilters(userId, {
  unreadOnly = false,
  category = null,
  filter = null
} = {}) {
  const conditions = [
    "recipient_id = $1",
    "archived_at IS NULL",
    "hidden_at IS NULL",
    "status <> 'cancelled'"
  ];
  const args = [userId];
  const f = String(filter || category || "").toLowerCase();
  if (unreadOnly || f === "unread") conditions.push("read_at IS NULL");
  if (f === "social") {
    conditions.push("category = 'social'");
  } else if (f === "alerts" || f === "alertes") {
    conditions.push("category = 'alerts'");
  } else if (f === "squads" || f === "squad") {
    // Squad activity lives under collection in the catalog; filter by type.
    conditions.push("(type = 'squad_completion_increased' OR type LIKE 'squad_%')");
  } else if (f === "collection" || f === "collections") {
    conditions.push("category = 'collection'");
    conditions.push("type <> 'squad_completion_increased' AND type NOT LIKE 'squad_%'");
  } else if (f && f !== "all" && f !== "unread") {
    args.push(f);
    conditions.push(`category = $${args.length}`);
  }
  return { conditions, args, filter: f || "all" };
}

// Étape 59 — opaque cursor for keyset pagination (created_at, id).
function encodeNotificationCursor(row) {
  if (!row || row.id == null || row.created_at == null) return null;
  const createdAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString();
  if (Number.isNaN(new Date(createdAt).getTime())) return null;
  return Buffer.from(JSON.stringify({ t: createdAt, i: Number(row.id) }), "utf8").toString("base64url");
}

function decodeNotificationCursor(cursor) {
  if (cursor == null || cursor === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    const id = Number(parsed?.i);
    const createdAt = parsed?.t;
    if (!createdAt || !Number.isFinite(id)) return null;
    if (Number.isNaN(new Date(createdAt).getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function getUnreadNotificationCount(pool, userId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM notifications
     WHERE recipient_id = $1
       AND read_at IS NULL
       AND archived_at IS NULL
       AND hidden_at IS NULL
       AND status <> 'cancelled'`,
    [userId]
  );
  return res.rows[0]?.c || 0;
}

async function getNotifications(pool, userId, {
  limit = 50,
  offset = 0,
  cursor = null,
  unreadOnly = false,
  category = null,
  filter = null
} = {}) {
  const { conditions, args } = buildNotificationInboxFilters(userId, {
    unreadOnly,
    category,
    filter
  });
  const decoded = decodeNotificationCursor(cursor);
  if (decoded) {
    args.push(decoded.createdAt, decoded.id);
    conditions.push(
      `(created_at, id) < ($${args.length - 1}::timestamptz, $${args.length}::int)`
    );
  }
  const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
  const where = conditions.join(" AND ");

  // Prefer cursor pagination (Étape 59). Offset remains for older clients.
  let result;
  if (decoded || cursor != null) {
    result = await pool.query(
      `SELECT id, type, category, actor_id, entity_type, entity_id, data, title, body, status,
              read_at, created_at, delivered_at, clicked_at, archived_at, hidden_at
       FROM notifications
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${args.length + 1}`,
      [...args, pageSize + 1]
    );
  } else {
    result = await pool.query(
      `SELECT id, type, category, actor_id, entity_type, entity_id, data, title, body, status,
              read_at, created_at, delivered_at, clicked_at, archived_at, hidden_at
       FROM notifications
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      // Offset pagination is kept only for older clients. Bound it so a
      // crafted legacy request cannot force PostgreSQL to scan an arbitrarily
      // large notification history; current clients use the signed cursor.
      [...args, pageSize + 1, Math.max(0, Math.min(10_000, parseInt(offset, 10) || 0))]
    );
  }

  const rows = result.rows || [];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  // Étape 60 — normalized API shape (id/actor/entity/action/isRead/createdAt).
  const serialize = require("./server/notification-serialize");
  const normalized = await serialize.normalizeNotificationList(pool, page.map((row) => ({
    ...row,
    data: row.data || {}
  })));
  // Attach legacy fields so older clients keep working during the transition.
  const notifications = normalized.map((item, idx) => {
    const row = page[idx];
    const data = row.data || {};
    return {
      ...item,
      // Legacy aliases
      actor_id: row.actor_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      data,
      context: data,
      message: item.body,
      status: row.status,
      read_at: row.read_at,
      created_at: row.created_at,
      delivered_at: row.delivered_at,
      clicked_at: row.clicked_at,
      archived_at: row.archived_at
    };
  });
  const nextCursor = hasMore && page.length
    ? encodeNotificationCursor(page[page.length - 1])
    : null;
  return { notifications, nextCursor, hasMore };
}

/**
 * Étape 47 — mark a notification as read.
 * When `clicked` is true (user opened the notification), also set clicked_at
 * (first click only). Already-read rows can still receive clicked_at.
 */
async function markNotificationRead(pool, userId, notificationId, { clicked = false } = {}) {
  const serialize = require("./server/notification-serialize");
  const id = serialize.fromPublicNotificationId(notificationId);
  if (!Number.isFinite(id)) return null;
  const result = await pool.query(
    `UPDATE notifications SET
       read_at = COALESCE(read_at, NOW()),
       status = CASE
         WHEN status IN ('archived', 'cancelled') THEN status
         ELSE 'read'
       END,
       clicked_at = CASE
         WHEN $3::boolean THEN COALESCE(clicked_at, NOW())
         ELSE clicked_at
       END
     WHERE id = $1
       AND recipient_id = $2
       AND archived_at IS NULL
       AND hidden_at IS NULL
       AND status <> 'cancelled'
     RETURNING id, read_at, clicked_at, status`,
    [id, userId, !!clicked]
  );
  return result.rows[0] || null;
}

async function markAllNotificationsRead(pool, userId) {
  const result = await pool.query(
    `UPDATE notifications SET read_at = NOW(), status = 'read'
     WHERE recipient_id = $1 AND read_at IS NULL AND archived_at IS NULL
       AND hidden_at IS NULL AND status <> 'cancelled'
     RETURNING id`,
    [userId]
  );
  return result.rowCount || 0;
}

// Soft-removes a notification from the main inbox (status='archived').
async function archiveNotification(pool, userId, notificationId) {
  const serialize = require("./server/notification-serialize");
  const id = serialize.fromPublicNotificationId(notificationId);
  if (!Number.isFinite(id)) return false;
  const result = await pool.query(
    `UPDATE notifications SET status = 'archived', archived_at = COALESCE(archived_at, NOW())
     WHERE id = $1 AND recipient_id = $2 AND archived_at IS NULL
     RETURNING id`,
    [id, userId]
  );
  return result.rows.length > 0;
}

// Cancels notifications that became irrelevant before they were ever sent.
// Only affects still-pending rows (created/queued). Used by triggers, e.g. when
// an invitation is withdrawn or a priority variant is no longer wanted.
async function cancelNotification(pool, notificationId) {
  const result = await pool.query(
    `UPDATE notifications SET status = 'cancelled'
     WHERE id = $1 AND status IN ('created', 'queued')
     RETURNING id`,
    [notificationId]
  );
  return result.rows.length > 0;
}

/**
 * Étape 41/42 — legacy helper: enqueue any pushDeferred rows that have no queue
 * job yet, then let the delivery worker send them. Prefer enqueueing at create
 * time; this recovers rows created before the queue existed.
 */
async function flushDeferredPushes(pool) {
  const deliveryQueue = require("./server/notification-delivery-queue");
  await deliveryQueue.ensureDeliveryQueueTable(pool);

  const res = await pool.query(
    `SELECT n.id, n.recipient_id, n.title, n.body, n.data
     FROM notifications n
     WHERE n.status NOT IN ('cancelled', 'archived')
       AND COALESCE(n.data->>'pushDeferred', 'false') = 'true'
       AND COALESCE(n.data->>'pushSent', 'false') <> 'true'
       AND (n.data->>'pushDeliverAt') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM notification_delivery_queue q
         WHERE q.notification_id = n.id
           AND q.status IN ('pending', 'processing')
           AND 'push' = ANY (q.channels)
       )
     ORDER BY (n.data->>'pushDeliverAt')::timestamptz ASC
     LIMIT 50`
  );

  let enqueued = 0;
  for (const row of res.rows) {
    const data = row.data || {};
    const id = await deliveryQueue.enqueueDelivery(pool, {
      notificationId: row.id,
      recipientId: row.recipient_id,
      channels: ["push"],
      notBefore: data.pushDeliverAt,
      deadline: data.pushDeadline || data.endingAt || data.endDate || null,
      title: row.title,
      body: row.body,
      url: data.actionUrl || "/"
    }).catch(() => null);
    if (id) enqueued++;
  }

  const processed = await deliveryQueue.processDeliveryQueue(pool);
  return { enqueued, ...processed, examined: res.rows.length };
}

function startQuietHoursFlushSweep() {
  // Étape 42 — quiet-hours deferrals are regular queue jobs (not_before).
  // The delivery-queue worker is the single flusher.
  const { pool } = require("./server/db");
  const deliveryQueue = require("./server/notification-delivery-queue");
  deliveryQueue.startDeliveryQueueWorker(pool);
}

async function deleteNotification(pool, userId, notificationId) {
  const serialize = require("./server/notification-serialize");
  const id = serialize.fromPublicNotificationId(notificationId);
  if (!Number.isFinite(id)) return false;
  const result = await pool.query(
    "DELETE FROM notifications WHERE id = $1 AND recipient_id = $2 RETURNING id",
    [id, userId]
  );
  return result.rows.length > 0;
}

module.exports = {
  getVapidPublicKey,
  ensurePushTables,
  registerToken,
  unregisterToken,
  unregisterAllTokens,
  getEnabledTokensForUser,
  getSquadMemberTokens,
  buildNotificationPayload,
  dispatchNotification,
  notifyUser,
  sendNotificationToUser,
  notifySquadMembers,
  notifyNewsSubscribers,
  createNotification,
  setNotificationStatus,
  deliverExternalChannels,
  recentNotificationExists,
  getNotifications,
  getUnreadNotificationCount,
  encodeNotificationCursor,
  decodeNotificationCursor,
  buildNotificationInboxFilters,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
  cancelNotification,
  deleteNotification,
  flushDeferredPushes,
  startQuietHoursFlushSweep,
  NOTIFICATION_TYPES: notificationCatalog.NOTIFICATION_TYPES,
  CONTEXTUAL_NOTIFICATION_TYPES: notificationCatalog.CONTEXTUAL_NOTIFICATION_TYPES,
  NOTIFICATION_STATUSES: notificationCatalog.NOTIFICATION_STATUSES,
  renderNotification: notificationCatalog.renderNotification,
  renderAllLocales: notificationCatalog.renderAllLocales
};
