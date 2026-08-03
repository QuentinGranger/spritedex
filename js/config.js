const STORAGE_KEY = "sprite-index_state_v1";
const THEME_KEY = "sprite-index_theme_v1";
const USER_KEY = "sprite-index_user";
const TOKEN_KEY = "sprite-index_token";
const LEGACY_STORAGE_KEYS = Object.freeze({
  [STORAGE_KEY]: "spritedex_state_v1",
  [THEME_KEY]: "spritedex_theme_v1",
  [USER_KEY]: "spritedex_user",
  [TOKEN_KEY]: "spritedex_token"
});

// Preserve existing sessions, themes and offline collections during the brand
// rename. New writes use only the sprite-index namespace.
for (const [nextKey, legacyKey] of Object.entries(LEGACY_STORAGE_KEYS)) {
  if (localStorage.getItem(nextKey) == null && localStorage.getItem(legacyKey) != null) {
    localStorage.setItem(nextKey, localStorage.getItem(legacyKey));
  }
}

// ── Backend origin resolution ──────────────────────────────────────────────
// Web (served by our own Express server): same-origin ("").
// Local dev opened on another port (e.g. Live Server): target :3000.
// Native app (Capacitor iOS/Android): the webview runs from capacitor://localhost
// or http://localhost, so it must target the remote production backend.
// Override with window.SPRITE_INDEX_API_ORIGIN if needed (staging, custom domain).
const PROD_API_ORIGIN = "https://spritedex.onrender.com";

function isNativePlatform() {
  return !!(
    window.Capacitor &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform()
  );
}

function isDesktopPlatform() {
  return window.SPRITE_INDEX_DESKTOP === true;
}

function resolveApiOrigin() {
  if (window.SPRITE_INDEX_API_ORIGIN) return window.SPRITE_INDEX_API_ORIGIN;
  if (
    isDesktopPlatform() ||
    isNativePlatform() ||
    location.protocol === "capacitor:" ||
    location.protocol === "file:"
  ) {
    return PROD_API_ORIGIN;
  }
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    if (location.port === "3000") return ""; // served by the Express dev server
    return "http://localhost:3000"; // Live Server / other local port / native fallback
  }
  return ""; // same-origin (web prod)
}

let API_ORIGIN = resolveApiOrigin();

function webOrigin() {
  if (
    isDesktopPlatform() ||
    isNativePlatform() ||
    location.protocol === "capacitor:" ||
    location.protocol === "file:"
  ) {
    return PROD_API_ORIGIN;
  }
  if ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && !location.port) {
    return PROD_API_ORIGIN;
  }
  return location.origin;
}

let API_BASE = `${API_ORIGIN}/api`;
let WS_URL = (() => {
  if (API_ORIGIN) return API_ORIGIN.replace(/^http/, "ws");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
})();

// Re-evaluate once Capacitor bridge is fully ready (native builds only).
function recomputeApiUrls() {
  API_ORIGIN = resolveApiOrigin();
  API_BASE = `${API_ORIGIN}/api`;
  WS_URL = API_ORIGIN
    ? API_ORIGIN.replace(/^http/, "ws")
    : (location.protocol === "https:" ? "wss:" : "ws:") + `//${location.host}`;
}
if (window.Capacitor) {
  document.addEventListener("deviceready", recomputeApiUrls);
}

function authHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (usesCookieAuth()) {
    headers["X-Auth-Mode"] = "cookie";
    const csrf = readCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  } else {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function authHeadersOnly() {
  const headers = {};
  if (usesCookieAuth()) {
    headers["X-Auth-Mode"] = "cookie";
    const csrf = readCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  } else {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Same-origin web uses HttpOnly cookies; Capacitor/Electron keep Bearer. */
function usesCookieAuth() {
  return (
    !isNativePlatform() &&
    !isDesktopPlatform() &&
    !API_ORIGIN &&
    location.protocol !== "capacitor:" &&
    location.protocol !== "file:"
  );
}

function readCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)sprite_index_csrf=([^;]*)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1] || "";
  }
}

function hasAuthSession() {
  if (usesCookieAuth()) return !!localStorage.getItem(USER_KEY);
  return !!localStorage.getItem(TOKEN_KEY);
}

/** Payload for the WebSocket `auth` frame (Bearer only; cookie auth uses upgrade Cookie). */
function wsAuthMessage() {
  if (usesCookieAuth()) return { type: "auth" };
  const token = localStorage.getItem(TOKEN_KEY);
  return { type: "auth", token };
}

function storeAuthSession(user = {}) {
  if (user && user.id != null) {
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        avatar_url: user.avatar_url,
        privacy: user.privacy,
        email: user.email || undefined,
        emailVerified: user.emailVerified
      })
    );
  }
  if (usesCookieAuth()) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEYS[TOKEN_KEY]);
    return;
  }
  if (user?.token) localStorage.setItem(TOKEN_KEY, user.token);
}

async function ensureCsrfToken() {
  if (!usesCookieAuth()) return "";
  if (readCsrfToken()) return readCsrfToken();
  try {
    await fetch(`${API_BASE}/auth/csrf`, { credentials: "include", headers: { Accept: "application/json" } });
  } catch (_) {
    /* ignore */
  }
  return readCsrfToken();
}

async function migrateLegacyBearerToCookie() {
  if (!usesCookieAuth()) return false;
  const legacy = localStorage.getItem(TOKEN_KEY);
  if (!legacy || !/^[a-f0-9]{64}$/i.test(legacy)) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/session/upgrade`, {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${legacy}`, Accept: "application/json" }
    });
    if (!res.ok) return false;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEYS[TOKEN_KEY]);
    return true;
  } catch (_) {
    return false;
  }
}

// Attach credentials + CSRF automatically for same-origin API fetches.
(function installCookieAuthFetch() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = function cookieAwareFetch(input, init = {}) {
    if (!usesCookieAuth()) return originalFetch(input, init);
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const isApi = url.startsWith(API_BASE) || url.startsWith("/api") || url.startsWith(`${location.origin}/api`);
    if (!isApi) return originalFetch(input, init);
    const next = { ...init, credentials: init.credentials || "include" };
    const headers = new Headers(next.headers || {});
    if (!headers.has("X-Auth-Mode")) headers.set("X-Auth-Mode", "cookie");
    const method = String(next.method || "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !headers.has("Authorization") && !headers.has("X-CSRF-Token")) {
      const csrf = readCsrfToken();
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
    next.headers = headers;
    return originalFetch(input, next);
  };
})();

const PRIORITIES = [
  { id: "urgent", label: "Urgent", color: "#ff4500" },
  { id: "important", label: "Important", color: "#ffcc00" },
  { id: "medium", label: "Medium", color: "#f5a623" },
  { id: "low", label: "Low", color: "#88889a" },
  { id: "ignored", label: "Ignored", color: "#555" },
  { id: "none", label: "—", color: "transparent" }
];

const RARITY_ORDER = { Mythique: 0, Légendaire: 1, Épique: 2, Rare: 3 };

const SWIPE_CONFIG = {
  owned: { x: 600, y: 0, rot: 18, label: "OWNED", color: "#00ff87", dir: "out-right" },
  missing: { x: -600, y: 0, rot: -18, label: "MISSING", color: "#ff3a6e", dir: "out-left" },
  priority: { x: 0, y: -600, rot: 0, label: "PRIORITY", color: "#ffcc00", dir: "out-up" },
  unsure: { x: 0, y: 600, rot: 0, label: "TO CHECK", color: "#8d7cff", dir: "out-down" }
};
