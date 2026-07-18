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

function variantId(spriteId, variantType) {
  const details = SPRITE_VARIANTS?.[spriteId]?.[variantType];
  if (details?.id) return details.id;
  return `${spriteId}::${variantType}`;
}

function getSpriteImg(spriteId, variantType) {
  const images = SPRITE_IMAGES[spriteId];
  if (!images) return null;
  return images[variantType] || images.Base || null;
}

function spriteImgTag(spriteId, variantType, className) {
  const src = getSpriteImg(spriteId, variantType);
  if (!src) return `<span class="${className}"></span>`;
  return `<img src="${src}" alt="${spriteId} ${variantType}" class="${className}" />`;
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
        id: variant.id || variantId(sprite.id, variantType),
        spriteId: sprite.id,
        variantId: variant.id || variantId(sprite.id, variantType),
        variantType,
        variantName: variant.name || variantType,
        spriteName: sprite.name,
        rarity: variant.rarity || sprite.rarity,
        img: variant.image || getSpriteImg(sprite.id, variantType),
        color: sprite.color,
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
  return state.collection[itemId] ?? defaultEntry();
}

function setEntry(itemId, patch) {
  state.collection[itemId] = {
    ...defaultEntry(),
    ...getEntry(itemId),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  persist(itemId);
  renderAll();
}

function statusLabel(status) {
  const labels = {
    owned: "Possédé",
    missing: "Manquant",
    priority: "Prioritaire",
    unsure: "À vérifier",
    unavailable: "Non disponible",
    spotted: "Rare trouvé",
    new: "Non classé"
  };
  return labels[status] ?? "Non classé";
}

function statusEmoji(status) {
  const icons = {
    owned: '<svg class="status-icon status-icon--success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    missing: '<svg class="status-icon status-icon--danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    priority: '<svg class="status-icon status-icon--star" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    unsure: '<svg class="status-icon status-icon--neutral" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>',
    unavailable: '<svg class="status-icon status-icon--locked" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    spotted: '<svg class="status-icon status-icon--spotted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    new: '<svg class="status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'
  };
  return icons[status] || icons.new;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

// ── Étape 20 — Formulations honnêtes des incertitudes ──────────────────────
// L'application affiche clairement ce qui est inconnu, observé, officiel ou à
// confirmer, sans masquer les informations manquantes ni faire passer une
// estimation pour une donnée officielle.

// Formate une date ISO en français long : "18 juillet 2026". Renvoie null si
// la date est inconnue/invalide (l'appelant affichera alors « inconnue »).
function formatDateFr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
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
  return map[c] || "À confirmer";
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
