const STORAGE_KEY = "spritedex_state_v1";
const THEME_KEY = "spritedex_theme_v1";
const USER_KEY = "spritedex_user";
const TOKEN_KEY = "spritedex_token";

// ── Backend origin resolution ──────────────────────────────────────────────
// Web (served by our own Express server): same-origin ("").
// Local dev opened on another port (e.g. Live Server): target :3000.
// Native app (Capacitor iOS/Android): the webview runs from capacitor://localhost
// or http://localhost, so it must target the remote production backend.
// Override with window.SPRITEDEX_API_ORIGIN if needed (staging, custom domain).
const PROD_API_ORIGIN = "https://spritedex.onrender.com";

function isNativePlatform() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
}

function resolveApiOrigin() {
  if (window.SPRITEDEX_API_ORIGIN) return window.SPRITEDEX_API_ORIGIN;
  if (isNativePlatform() || location.protocol === "capacitor:" || location.protocol === "file:") {
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
  if (isNativePlatform() || location.protocol === "capacitor:" || location.protocol === "file:") {
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
  WS_URL = API_ORIGIN ? API_ORIGIN.replace(/^http/, "ws") : (location.protocol === "https:" ? "wss:" : "ws:") + `//${location.host}`;
}
if (window.Capacitor) {
  document.addEventListener("deviceready", recomputeApiUrls);
}

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function authHeadersOnly() {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

const PRIORITIES = [
  { id: "urgent",    label: "Urgent",    color: "#ff4500" },
  { id: "important", label: "Important", color: "#ffcc00" },
  { id: "medium",    label: "Moyen",     color: "#f5a623" },
  { id: "low",       label: "Faible",    color: "#88889a" },
  { id: "ignored",   label: "Ignoré",    color: "#555" },
  { id: "none",      label: "—",         color: "transparent" }
];

const RARITY_ORDER = { "Mythique": 0, "Légendaire": 1, "Épique": 2, "Rare": 3 };

const SWIPE_CONFIG = {
  owned:    { x: 600, y: 0, rot: 18, label: "JE L'AI",     color: "#00ff87", dir: "out-right" },
  missing:  { x: -600, y: 0, rot: -18, label: "MANQUANT",   color: "#ff3a6e", dir: "out-left" },
  priority: { x: 0, y: -600, rot: 0, label: "PRIORITÉ",    color: "#ffcc00", dir: "out-up" },
  unsure:   { x: 0, y: 600, rot: 0, label: "À VÉRIFIER", color: "#8d7cff", dir: "out-down" }
};
