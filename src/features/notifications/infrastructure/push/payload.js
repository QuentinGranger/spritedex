"use strict";

const path = require("path");

// ── Sending ──
// Push payloads are rendered outside the usual in-app navigation checks.
// Treat every field as potentially persisted/legacy/untrusted input: a remote
// news feed or stale database row must not make a subscriber's service worker
// fetch a private-network image or open an external URL on notification click.
const PUSH_LOCAL_ORIGIN = "https://sprite-index.invalid";
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
      title: normalizePushText(title, "SPRITE-INDEX", 200) || "SPRITE-INDEX",
      body: normalizePushText(body, "", 1000),
      icon: normalizePushAsset(icon, "/icons/icon-192x192.png"),
      badge: normalizePushAsset(badge, "/icons/icon-72x72.png"),
      tag: "sprite-index",
      requireInteraction: false,
      data: {
        url: normalizePushPath(url, "/")
      }
    }
  };
}

module.exports = { buildNotificationPayload };
