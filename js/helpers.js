// Escapes user-controlled strings (usernames, squad names, notes...) before
// they are inserted into innerHTML, to prevent stored XSS. Server-side
// validation restricts the charset for new usernames, but this is defense in
// depth for older/legacy data and any other user-supplied text.
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Values coming from the API, localStorage or an imported JSON file must never
// become object keys with special prototype semantics.  Plain objects are used
// as lookup tables throughout the client, so keeping this guard at the boundary
// prevents a malicious import (or a malformed realtime payload) from changing
// their prototype.
const UNSAFE_RECORD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isSafeRecordKey(key) {
  return typeof key === "string"
    && key.length > 0
    && key.length <= 240
    && !UNSAFE_RECORD_KEYS.has(key);
}

function createSafeRecord() {
  return Object.create(null);
}

function setSafeRecordValue(record, key, value) {
  if (!record || !isSafeRecordKey(String(key))) return false;
  record[String(key)] = value;
  return true;
}

function safeText(value, fallback = "") {
  if (value == null) return fallback;
  return String(value).slice(0, 4000);
}

function safeFiniteNumber(value, fallback = 0, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function isPrivateOrLocalHostname(value) {
  const host = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return true;
  // Automatically rendered images must never be used as probes for a
  // visitor's local network. Reject literal IPs and common local/DNS-rebind
  // hostnames; normal public HTTPS image hosts remain supported.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return true;
  return host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host.endsWith(".home")
    || host.endsWith(".lan")
    || host.endsWith(".test")
    || host === "nip.io"
    || host.endsWith(".nip.io")
    || host === "sslip.io"
    || host.endsWith(".sslip.io")
    || host === "localtest.me"
    || host.endsWith(".localtest.me");
}

function safePercentage(value, fallback = 0) {
  return safeFiniteNumber(value, fallback, { min: 0, max: 100 });
}

// URL escaping alone is not enough for href/src attributes: `javascript:` and
// other active schemes remain valid after HTML escaping.  Only web URLs, local
// paths and PNG/JPEG/GIF/WebP data URLs (used for generated QR codes) are
// accepted here.
function safeImageUrl(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || raw.length > 2 * 1024 * 1024) return "";
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
    return raw;
  }
  try {
    const parsed = new URL(raw, window.location.href);
    if (parsed.username || parsed.password) return "";
    // Remote images are fetched automatically while rendering.  Do not allow
    // clear-text third-party requests (tracking/mixed-content); HTTP is only
    // retained for same-origin local development assets.
    const current = new URL(window.location.href);
    if (parsed.protocol === "https:" && !isPrivateOrLocalHostname(parsed.hostname)) return parsed.href;
    if (parsed.protocol === "http:" && parsed.protocol === current.protocol && parsed.host === current.host) return parsed.href;
    // Capacitor serves bundled files from capacitor://localhost. The API stores
    // sprite paths relative to the web root (for example Sprite/Air/Air.webp),
    // which resolve to that origin on iOS. Keep this deliberately restricted to
    // known packaged asset directories instead of treating all local URLs as
    // safe image sources.
    const isBundledAppOrigin = parsed.protocol === current.protocol
      && parsed.host === current.host
      && (current.protocol === "capacitor:" || current.protocol === "file:");
    const isBundledSpriteAsset = parsed.pathname.startsWith("/Sprite/")
      || parsed.pathname.startsWith("/Favicon/")
      || parsed.pathname === "/LogoApp.png"
      || parsed.pathname === "/MainLogo.png"
      || parsed.pathname === "/js/MainLogo.png";
    if (isBundledAppOrigin && isBundledSpriteAsset) return parsed.href;
  } catch {
    // Invalid URLs are rendered as the normal image placeholder.
  }
  return "";
}

function safeExternalUrl(value) {
  if (typeof value !== "string") return "";
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password) return "";
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || isPrivateOrLocalHostname(parsed.hostname)) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

// Links generated by the API for sharing and invitations must lead back to
// this application. Unlike source citations, these are never intended to
// point to arbitrary external sites.
function safeAppWebUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const app = new URL(webOrigin());
    const parsed = new URL(value.trim(), app.href);
    if (
      parsed.protocol !== app.protocol ||
      parsed.host !== app.host ||
      !parsed.pathname.startsWith("/")
    ) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

// Notification destinations are application deep links.  Keep them on this
// origin and reject active schemes / protocol-relative URLs before rendering a
// clickable anchor.
function safeAppPath(value, fallback = "#") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = new URL(value.trim(), window.location.href);
    const current = new URL(window.location.href);
    // `origin` is "null" for custom-scheme desktop URLs, so compare the
    // protocol and host too. This rejects e.g. sprite-index://untrusted/path.
    if (
      parsed.protocol !== current.protocol ||
      parsed.host !== current.host ||
      !parsed.pathname.startsWith("/")
    ) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

function safeCssColor(value, fallback = "#8d7cff") {
  const color = typeof value === "string" ? value.trim() : "";
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  // Strict numeric rgb()/rgba() support keeps older catalog colours working
  // without allowing arbitrary CSS declarations in an interpolated style.
  const rgb = "(?:0|[1-9]\\d?|1\\d{2}|2[0-4]\\d|25[0-5])";
  const alpha = "(?:0|0?\\.\\d+|1(?:\\.0+)?)";
  const rgbPattern = new RegExp(`^rgb\\(\\s*${rgb}\\s*,\\s*${rgb}\\s*,\\s*${rgb}\\s*\\)$`, "i");
  const rgbaPattern = new RegExp(`^rgba\\(\\s*${rgb}\\s*,\\s*${rgb}\\s*,\\s*${rgb}\\s*,\\s*${alpha}\\s*\\)$`, "i");
  return rgbPattern.test(color) || rgbaPattern.test(color) ? color : fallback;
}

function sanitizeCollectionEntry(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const allowedStatuses = new Set(["owned", "missing", "priority", "unsure", "unknown", "unavailable", "spotted", "new"]);
  const allowedPriorities = new Set(["urgent", "important", "medium", "low", "ignored", "none"]);
  const status = allowedStatuses.has(source.status) ? source.status : "new";
  const priority = allowedPriorities.has(source.priority) ? source.priority : "none";
  // A collector receives level 1 as soon as a variant becomes owned. Levels
  // 2–5 represent the progression in Fortnite; level 5 is Master.
  const rawMastery = Number(source.masteryLevel);
  const masteryLevel = status === "owned"
    ? (Number.isInteger(rawMastery) && rawMastery >= 1 && rawMastery <= 5 ? rawMastery : 1)
    : 0;
  const dateOrNull = (value) => {
    if (typeof value !== "string" || value.length > 64 || Number.isNaN(Date.parse(value))) return null;
    return value;
  };
  return {
    status,
    priority,
    masteryLevel,
    note: typeof source.note === "string" ? source.note.slice(0, 4000) : "",
    obtainedAt: dateOrNull(source.obtainedAt),
    updatedAt: dateOrNull(source.updatedAt)
  };
}

function sanitizeCollection(value) {
  const clean = createSafeRecord();
  if (!value || typeof value !== "object" || Array.isArray(value)) return clean;
  for (const [key, entry] of Object.entries(value)) {
    if (!isSafeRecordKey(key)) continue;
    if (key.startsWith("fav_")) {
      clean[key] = entry === true;
      continue;
    }
    clean[key] = sanitizeCollectionEntry(entry);
  }
  return clean;
}

function variantId(spriteId, variantType) {
  const details = SPRITE_VARIANTS?.[spriteId]?.[variantType];
  if (details?.id && isSafeRecordKey(String(details.id))) return String(details.id);
  const fallback = `${spriteId}::${variantType}`;
  return isSafeRecordKey(fallback) ? fallback : "";
}

function getSpriteImg(spriteId, variantType) {
  const images = SPRITE_IMAGES[spriteId];
  if (!images) return null;
  return safeImageUrl(images[variantType] || images.Base || null) || null;
}

function spriteImgTag(spriteId, variantType, className) {
  const src = safeImageUrl(getSpriteImg(spriteId, variantType));
  if (!src) return `<span class="${escapeHtml(className)}"></span>`;
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(`${spriteId} ${variantType}`)}" class="${escapeHtml(className)}" />`;
}

function getAllItems() {
  return SPRITES.flatMap((sprite) => {
    const details = sprite.variantDetails || SPRITE_VARIANTS?.[sprite.id] || {};
    const variantTypes = Object.keys(details).length > 0
      ? Object.keys(details)
      : (Array.isArray(sprite.variants) ? sprite.variants : ["Base"]);
    return variantTypes.map((variantType) => {
      const variant = details[variantType] || { type: variantType, name: variantType };
      return {
        id: isSafeRecordKey(String(variant.id || "")) ? String(variant.id) : variantId(sprite.id, variantType),
        spriteId: sprite.id,
        variantId: isSafeRecordKey(String(variant.id || "")) ? String(variant.id) : variantId(sprite.id, variantType),
        variantType,
        variantName: variant.name || variantType,
        spriteName: sprite.name,
        rarity: variant.rarity || sprite.rarity,
        img: safeImageUrl(variant.image || getSpriteImg(sprite.id, variantType)),
        color: safeCssColor(sprite.color),
        effect: variant.effect || sprite.effect,
        variant: variantType,
        variantBonus: VARIANT_META[variantType]?.bonus ?? "Variante spéciale."
      };
    });
  });
}

function defaultEntry() {
  return {
    status: "new",
    priority: "none",
    masteryLevel: 0,
    note: "",
    obtainedAt: null,
    updatedAt: null
  };
}

function priorityLabel(p) {
  return PRIORITIES.find(x => x.id === p)?.label ?? "—";
}

function priorityColor(p) {
  return PRIORITIES.find(x => x.id === p)?.color ?? "transparent";
}

function priorityOrder(p) {
  const order = { urgent: 0, important: 1, medium: 2, low: 3, none: 4, ignored: 5 };
  return order[p] ?? 4;
}

function getEntry(itemId) {
  if (!isSafeRecordKey(String(itemId))) return defaultEntry();
  return sanitizeCollectionEntry(state.collection[itemId] ?? defaultEntry());
}

function masteryLevelFor(entry) {
  return entry?.status === "owned" ? Math.min(5, Math.max(1, Number(entry.masteryLevel) || 1)) : 0;
}

function masteryLabel(level) {
  return level >= 5 ? "Master" : `Niveau ${Math.max(1, Number(level) || 1)}`;
}

function setEntry(itemId, patch) {
  if (!isSafeRecordKey(String(itemId))) return;
  state.collection[itemId] = sanitizeCollectionEntry({
    ...defaultEntry(),
    ...getEntry(itemId),
    ...(patch && typeof patch === "object" ? patch : {}),
    updatedAt: new Date().toISOString()
  });
  persist(itemId);
  renderAll();
}

const STATUS_CATEGORIES = {
  owned: ["owned"],
  missing: ["missing", "priority", "spotted", "unavailable"],
  unknown: ["new", "unknown", "unsure"]
};

function isOwnedStatus(status) { return STATUS_CATEGORIES.owned.includes(status); }
function isMissingStatus(status) { return STATUS_CATEGORIES.missing.includes(status); }
function isUnknownStatus(status) { return !status || STATUS_CATEGORIES.unknown.includes(status); }
function isCollectibleMissingStatus(status) { return ["missing", "priority", "spotted"].includes(status); }
function classifyStatus(status) {
  if (isOwnedStatus(status)) return "owned";
  if (isMissingStatus(status)) return "missing";
  return "unknown";
}

function statusLabel(status) {
  const labels = {
    owned: "Possédé",
    missing: "Manquant",
    priority: "Prioritaire",
    unsure: "À vérifier",
    unknown: "Inconnu",
    unavailable: "Non disponible",
    spotted: "Rare trouvé",
    new: "Non classé"
  };
  const label = labels[status] ?? "Non classé";
  return typeof t === "function" ? t(label) : label;
}

function statusEmoji(status) {
  const icons = {
    owned: '<svg class="status-icon status-icon--success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    missing: '<svg class="status-icon status-icon--danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    priority: '<svg class="status-icon status-icon--star" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    unsure: '<svg class="status-icon status-icon--neutral" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>',
    unknown: '<svg class="status-icon status-icon--neutral" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>',
    unavailable: '<svg class="status-icon status-icon--locked" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    spotted: '<svg class="status-icon status-icon--spotted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    new: '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'
  };
  return icons[status] || icons.new;
}

function toast(message) {
  els.toast.textContent = typeof t === "function" ? t(message) : message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

// ── Étape 20 — Formulations honnêtes des incertitudes ──────────────────────
// L'application affiche clairement ce qui est inconnu, observé, officiel ou à
// confirmer, sans masquer les informations manquantes ni faire passer une
// estimation pour une donnée officielle.

// Uses the active application locale so dates follow the same language as the
// rest of the interface.
function formatDateFr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(typeof appLocale === "function" && appLocale() === "en" ? "en-US" : "fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

// Traduit un niveau de confiance en libellé honnête.
function confidenceLabel(confidence) {
  const c = (confidence || "").toLowerCase();
  const map = {
    official: "Information officielle",
    confirmed: "Information officielle",
    primary: "Information officielle",
    observed: "Observation directe",
    in_game: "Observation directe",
    community_database: "Information communautaire",
    community: "Information communautaire",
    secondary: "Information communautaire",
    tertiary: "Information communautaire",
    estimated: "Estimation",
    unknown: "À confirmer",
  };
  const label = map[c] || "À confirmer";
  return typeof t === "function" ? t(label) : label;
}

// Classe CSS associée au niveau de confiance (pour distinguer visuellement
// l'officiel de l'estimation).
function confidenceClass(confidence) {
  const c = (confidence || "").toLowerCase();
  if (["official", "confirmed", "primary"].includes(c)) return "official";
  if (["observed", "in_game"].includes(c)) return "observed";
  if (["community_database", "community", "secondary", "tertiary"].includes(c)) return "community";
  if (c === "estimated") return "estimated";
  return "unknown";
}

// Étape 36 — wording for an end date that is not officially confirmed.
// Estimated dates may appear in the app, but must not read as affirmative.
function endDateDisclaimer(confidence) {
  const conf = confidenceClass(confidence);
  if (conf === "official") return null;
  return "Fin estimée, non confirmée par Epic Games.";
}

function formatEndDateLine(availability) {
  const a = availability || {};
  const endDateFr = formatDateFr(a.endDate);
  const disclaimer = endDateDisclaimer(a.confidence);
  if (!endDateFr) {
    return disclaimer || "Date de fin : inconnue";
  }
  if (disclaimer) {
    return `Date de fin : ${endDateFr} — ${disclaimer}`;
  }
  return `Date de fin : ${endDateFr}`;
}

// Phrase honnête décrivant la disponibilité, en fonction du statut et de la
// source de l'information.
function availabilityPhrase(availability) {
  const a = availability || {};
  const status = (a.status || "unknown").toLowerCase();
  const conf = confidenceClass(a.confidence);
  switch (status) {
    case "available":
      if (conf === "official") return "Disponible (information officielle)";
      if (conf === "observed") return "Disponible selon une observation récente";
      if (conf === "community") return "Disponible selon des informations communautaires";
      return "Disponible (à confirmer)";
    case "upcoming":
      return "À venir";
    case "ended":
      return "Plus disponible";
    case "not_observed":
      return "Non observé récemment";
    case "unreleased":
      return "Pas encore sortie";
    default:
      return "Disponibilité inconnue";
  }
}

// Phrase honnête décrivant la méthode d'obtention.
function acquisitionPhrase(acquisition) {
  const a = acquisition || {};
  const type = (a.type || "unknown").toLowerCase();
  const conf = confidenceClass(a.confidence);
  if (type === "unknown" || conf === "unknown") {
    return a.description
      ? `${a.description} (méthode à confirmer)`
      : "Méthode d'obtention à confirmer";
  }
  const base = a.description || {
    quest: "Obtenu via une quête",
    event: "Obtenu lors d'un événement",
    exploration: "Trouvé en explorant",
    interaction: "Obtenu via une interaction",
    reward: "Obtenu en récompense",
    challenge: "Obtenu via un défi",
    purchase: "Obtenu par achat",
    automatic: "Obtenu automatiquement",
  }[type] || "Méthode d'obtention connue";
  if (conf === "observed") return `${base} (observation directe)`;
  if (conf === "community") return `${base} (information communautaire)`;
  if (conf === "official") return `${base} (information officielle)`;
  return `${base} (à confirmer)`;
}

// Phrase honnête décrivant la récurrence (retour du sprite).
function recurrencePhrase(recurrence) {
  const r = recurrence || {};
  const status = (r.status || "unknown").toLowerCase();
  if (status === "confirmed_recurring" && r.officiallyConfirmed) return "Retour confirmé par Epic Games";
  if (status === "confirmed_recurring") return "Retour probable (non officiel)";
  if (status === "possible_return") return "Retour possible, non confirmé";
  if (status === "not_confirmed") return "Retour non confirmé";
  return "Récurrence inconnue";
}

// Libellé honnête de fiabilité d'une source.
function sourceReliabilityLabel(source) {
  const s = source || {};
  const type = (s.type || "").toLowerCase();
  const rel = (s.reliability || "").toLowerCase();
  if (type === "official" || rel === "primary") return "Information officielle";
  if (type === "in_game") return "Observation en jeu";
  if (type === "creator") return "Information de créateur";
  if (type === "community" || type === "database" || rel === "secondary" || rel === "tertiary") return "Information communautaire";
  return "Source à confirmer";
}

function getStats(items = getAllItems()) {
  const total = items.length;
  const owned = items.filter((item) => getEntry(item.id).status === "owned").length;
  const missing = items.filter((item) => getEntry(item.id).status === "missing").length;
  const priority = items.filter((item) => getEntry(item.id).status === "priority").length;
  const unsure = items.filter((item) => getEntry(item.id).status === "unsure").length;
  const unavailable = items.filter((item) => getEntry(item.id).status === "unavailable").length;
  const spotted = items.filter((item) => getEntry(item.id).status === "spotted").length;
  return { total, owned, missing, priority, unsure, unavailable, spotted, percent: total ? Math.round((owned / total) * 100) : 0 };
}

function updateThemeButton() {
  els.themeToggle.innerHTML = document.body.classList.contains("light")
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
}

function toggleTheme() {
  document.body.classList.toggle("light");
  localStorage.setItem(THEME_KEY, document.body.classList.contains("light") ? "light" : "dark");
  updateThemeButton();
}

// ── Legal Modals ──
function openLegal(key) {
  const content = LEGAL_CONTENT[key];
  if (!content) return;
  const dialog = document.getElementById("legalDialog");
  const container = document.getElementById("legalContent");
  container.innerHTML = content;
  dialog.showModal();
}
