"use strict";

const crypto = require("crypto");
const webpush = require("web-push");
const https = require("https");
const http2 = require("http2");
const pushSubscriptions = require("../../../../../server/push-subscriptions");

async function sendWebPush(subscription, payload) {
  const parsed = pushSubscriptions.parseWebSubscription(subscription);
  if (!pushSubscriptions.isValidWebSubscription(parsed)) {
    return { ok: false, permanent: true, expired: true, error: "Untrusted web push endpoint" };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: parsed.endpoint,
        keys: { p256dh: parsed.publicKey, auth: parsed.authSecret }
      },
      JSON.stringify(payload)
    );
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
          Authorization: `key=${process.env.FCM_SERVER_KEY}`
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
  let keyPem = process.env.APNS_KEY.trim().replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
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
    apnsClient.on("error", () => {
      apnsClient = null;
    });
    apnsClient.on("goaway", () => {
      apnsClient = null;
    });
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
      authorization: `bearer ${jwt}`,
      "apns-topic": process.env.APNS_TOPIC,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(apnsPayload)
    });
    req.setEncoding("utf8");
    let responseData = "";
    req.on("response", (headers) => {
      const status = headers[":status"];
      req.on("data", (chunk) => {
        responseData += chunk;
      });
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

async function dispatchNotification({ pool: _pool, target, payload }) {
  const platform = pushSubscriptions.normalizePlatform(target.platform);
  if (platform === "web") {
    const subscription =
      target.subscription || (typeof target.token === "string" ? JSON.parse(target.token) : target.token);
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
  const permanent = !!(result.permanent || result.expired || pushSubscriptions.isPermanentProviderFailure(result));
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

module.exports = { dispatchNotification, handleDispatchResult };
