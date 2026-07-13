const STORAGE_KEY = "spritedex_state_v1";
const THEME_KEY = "spritedex_theme_v1";
const USER_KEY = "spritedex_user";
const TOKEN_KEY = "spritedex_token";
const API_BASE = (window.location.port === "3000" ? "" : "http://localhost:3000") + "/api";

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
