// ── SpriteDex push notification service ─────────────────────────────────────
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
const fs = require("fs");
const path = require("path");

const VAPID_FILE = path.join(__dirname, ".vapid-keys.json");

function loadOrCreateVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || "mailto:support@spritedex.app"
    };
  }
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const saved = JSON.parse(fs.readFileSync(VAPID_FILE, "utf8"));
      if (saved.publicKey && saved.privateKey) return saved;
    }
  } catch (err) {
    console.warn("[PUSH] Failed to load saved VAPID keys:", err.message);
  }
  const generated = webpush.generateVAPIDKeys();
  const keys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: process.env.VAPID_SUBJECT || "mailto:support@spritedex.app"
  };
  try {
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
    console.log("[PUSH] Generated and saved new VAPID keys to", VAPID_FILE);
  } catch (err) {
    console.warn("[PUSH] Failed to save VAPID keys:", err.message);
  }
  return keys;
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

// ── Token persistence ──
// push_tokens stores one row per (user_id, token). Tokens are scoped to a
// device/platform so deleting a token on one device does not affect others.
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
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_new_sprites BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_new_variants BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_squad_activity BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_session_summary BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_goals BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_sync BOOLEAN NOT NULL DEFAULT FALSE;
  `);
}

async function registerToken(pool, userId, token, platform = "web") {
  await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform, enabled)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (user_id, token) DO UPDATE SET
       platform = EXCLUDED.platform,
       enabled = TRUE,
       updated_at = NOW()`,
    [userId, token, platform]
  );
}

async function unregisterToken(pool, userId, token) {
  await pool.query(
    "DELETE FROM push_tokens WHERE user_id = $1 AND token = $2",
    [userId, token]
  );
}

async function unregisterAllTokens(pool, userId) {
  await pool.query("DELETE FROM push_tokens WHERE user_id = $1", [userId]);
}

async function getEnabledTokensForUser(pool, userId) {
  const result = await pool.query(
    `SELECT token, platform FROM push_tokens
     WHERE user_id = $1 AND enabled = TRUE`,
    [userId]
  );
  return result.rows;
}

async function getSquadMemberTokens(pool, squadId, excludeUserId) {
  const result = await pool.query(
    `SELECT DISTINCT pt.token, pt.platform, u.push_pref_squad_activity
     FROM push_tokens pt
     JOIN users u ON u.id = pt.user_id
     JOIN squad_members sm ON sm.user_id = u.id
     WHERE sm.squad_id = $1
       AND pt.enabled = TRUE
       AND u.push_enabled = TRUE
       AND u.push_pref_squad_activity = TRUE
       AND u.id <> $2`,
    [squadId, excludeUserId]
  );
  return result.rows;
}

// ── Sending ──
function buildNotificationPayload({ title, body, icon, url, badge }) {
  return {
    notification: {
      title: title || "SpriteDex",
      body: body || "",
      icon: icon || "/icons/icon-192x192.png",
      badge: badge || "/icons/icon-72x72.png",
      tag: "spritedex",
      requireInteraction: false,
      data: {
        url: url || "/"
      }
    }
  };
}

async function sendWebPush(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    // 404/410 = subscription expired, should be removed
    if (err.statusCode === 404 || err.statusCode === 410) {
      return { ok: false, expired: true, error: err.message };
    }
    return { ok: false, expired: false, error: err.message };
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
            if (json.failure) resolve({ ok: false, error: json.results?.[0]?.error || body });
            else resolve({ ok: true });
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

function sendApns(token, payload) {
  return new Promise((resolve) => {
    if (!process.env.APNS_KEY || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_TOPIC) {
      return resolve({ ok: false, error: "APNS credentials not configured" });
    }
    // APNS HTTP/2 via native apn library is recommended; this is a placeholder.
    resolve({ ok: false, error: "APNS sender requires the apn package or JWT signing" });
  });
}

async function dispatchNotification({ pool, token, platform, payload }) {
  if (platform === "web") {
    // Web Push tokens are full PushSubscription JSON objects
    let subscription;
    try {
      subscription = typeof token === "string" ? JSON.parse(token) : token;
    } catch {
      return { ok: false, error: "Invalid web push token" };
    }
    return sendWebPush(subscription, payload);
  }
  if (platform === "android" || platform === "fcm") {
    return sendFcmLegacy(token, payload);
  }
  if (platform === "ios" || platform === "apns") {
    return sendApns(token, payload);
  }
  return { ok: false, error: `Unknown platform ${platform}` };
}

async function notifyUser(pool, userId, message) {
  const tokens = await getEnabledTokensForUser(pool, userId);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const row of tokens) {
    const result = await dispatchNotification({ pool, token: row.token, platform: row.platform, payload });
    if (result.expired) {
      await unregisterToken(pool, userId, row.token);
    }
    results.push({ platform: row.platform, ok: result.ok, error: result.error });
  }
  return results;
}

async function notifySquadMembers(pool, squadId, senderUserId, message) {
  const tokens = await getSquadMemberTokens(pool, squadId, senderUserId);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const row of tokens) {
    const result = await dispatchNotification({ pool, token: row.token, platform: row.platform, payload });
    if (result.expired) {
      // token is unique per user, but we don't have user_id here easily; deletion by token value is safe
      await pool.query("DELETE FROM push_tokens WHERE token = $1", [row.token]);
    }
    results.push({ platform: row.platform, ok: result.ok, error: result.error });
  }
  return results;
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
  notifySquadMembers
};
