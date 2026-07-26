"use strict";

// Étapes 85–86 — pure passport UI contracts (Node + browser).
// No DOM required: returns HTML strings for regression / a11y tests.

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateUi(value, max = 48) {
  const s = String(value == null ? "" : value);
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function formatLocaleNumber(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

/** Étape 86 — screen-reader progress sentence. */
function formatCollectionProgressText(owned, released, rateDisplay) {
  const o = Math.max(0, Number(owned) || 0);
  const r = Math.max(0, Number(released) || 0);
  const rateStr = formatLocaleNumber(rateDisplay, 1);
  return `Progression de la collection : ${o} variante${o === 1 ? "" : "s"} sur ${r}, soit ${rateStr} %.`;
}

/** Étape 86 — accessible badge name (not colour-only). */
function formatBadgeAccessibleName(badge = {}) {
  const label = String(badge.label || badge.badgeCode || badge.code || badge.id || "Badge");
  const unlocked = !badge.status || badge.status === "unlocked";
  const status = unlocked ? "débloqué" : "verrouillé";
  if (unlocked) return `Badge ${label}, ${status}`;
  const progressValue = badge.progressValue;
  const targetValue = badge.targetValue;
  if (progressValue != null && targetValue != null) {
    return `Badge ${label}, ${status}, progression ${progressValue} sur ${targetValue}`;
  }
  return `Badge ${label}, ${status}`;
}

function passportActivityLabel(item) {
  const type = item && (item.activityType || item.type);
  const data = (item && item.data) || {};
  switch (type) {
    case "variants_owned": {
      const count = Number(data.count) || 0;
      if (count > 1) return `${count} variantes ajoutées à la collection.`;
      return data.variantName
        ? `${data.variantName} ajouté à la collection.`
        : "Variante ajoutée à la collection.";
    }
    case "badge_unlocked":
      return data.label ? `Badge ${data.label} débloqué.` : "Badge débloqué.";
    case "event_completed":
      return data.eventName ? `Événement complété : ${data.eventName}.` : "Événement complété.";
    case "account_created":
      return "Inscription à SpriteDex.";
    default:
      return type || "Activité";
  }
}

function passportActionDestination(action) {
  const map = {
    "open-filter": { view: "checklist", source: "passport_collection" },
    "event-missing": { view: "checklist", source: "passport_event" },
    compare_collections: { view: "social", tab: "compare", source: "passport" },
    update_collection: { view: "checklist", source: "passport_action" },
    share_passport: { dialog: "passportShareDialog", source: "passport" },
    view_public_collection: { path: "/u/:username", source: "passport" }
  };
  return map[action] || null;
}

/**
 * Build a compact passport shell HTML for contract tests (Étapes 85–86).
 */
function renderPassportContractHtml(data = {}, options = {}) {
  const viewport = options.viewport || "desktop"; // phone | tablet | desktop
  const u = data.user || {};
  const c = data.collection || null;
  const cat = data.catalogue || {};
  const badges = Array.isArray(data.badgeProgress)
    ? data.badgeProgress
    : (Array.isArray(data.badges) ? data.badges : []);
  const squads = Array.isArray(data.availableSquads) ? data.availableSquads : [];
  const primary = data.primarySquad;
  const username = truncateUi(u.username || u.displayName || "—", options.maxNameLength || 48);
  const longCopy = options.longCopy
    || "Cette collection n’est renseignée qu’à 12,5 %. Certaines statistiques peuvent être incomplètes.";

  const squadLine = primary && primary.private
    ? "Squad privée"
    : (primary && primary.name
      ? truncateUi(primary.name, 40)
      : (squads.length ? `${squads.length} squads disponibles` : "Aucune squad principale"));

  const badgeHtml = badges.slice(0, options.maxBadgesRender || 100).map((b) => {
    const label = truncateUi(b.label || b.badgeCode || b.code || b.id || "Badge", 40);
    const a11y = formatBadgeAccessibleName(b);
    const unlocked = !b.status || b.status === "unlocked";
    return `<article class="collector-passport__badge-card collector-passport__badge-card--${unlocked ? "unlocked" : "locked"}"`
      + ` tabindex="0" role="listitem" aria-label="${escapeHtml(a11y)}" data-badge-status="${unlocked ? "unlocked" : "locked"}">`
      + `<span class="collector-passport__badge-icon" aria-hidden="true">${escapeHtml(label.slice(0, 1).toUpperCase())}</span>`
      + `<strong>${escapeHtml(label)}</strong>`
      + `<span class="collector-passport__badge-status">${unlocked ? "Débloqué" : "Verrouillé"}</span>`
      + `<small class="collector-passport__badge-declared">Calculé à partir de la collection déclarée</small></article>`;
  }).join("");

  const statsHidden = !c;
  const empty = c && Number(c.ownedVariantCount) === 0;
  const owned = c ? Number(c.ownedVariantCount) || 0 : 0;
  const released = c
    ? (Number(c.releasedVariantCount) || Number(cat.releasedVariantCount) || 0)
    : 0;
  const rate = c && c.completionRateDisplay != null ? c.completionRateDisplay : 0;
  const progressText = formatCollectionProgressText(owned, released, rate);
  const progressId = "passport-progress-text-contract";

  return `
<section class="collector-passport collector-passport--${escapeHtml(viewport)}" data-viewport="${escapeHtml(viewport)}" aria-labelledby="passport-contract-title">
  <h2 id="passport-contract-title" class="collector-passport__title">Passeport du collectionneur</h2>
  <section class="collector-passport__section collector-passport__section--identity" aria-labelledby="passport-identity-heading">
    <h3 id="passport-identity-heading">Identité</h3>
    <div class="collector-passport__identity">
      <p class="collector-passport__username" title="${escapeHtml(u.username || "")}">${escapeHtml(username)}</p>
      <p class="collector-passport__identity-meta">Squad principale : <strong>${escapeHtml(squadLine)}</strong></p>
    </div>
  </section>
  ${statsHidden
    ? `<p class="collector-passport__empty" role="status">Statistiques masquées</p>`
    : `<section class="collector-passport__section collector-passport__section--progress" aria-labelledby="passport-progress-heading">
        <h3 id="passport-progress-heading">Progression</h3>
        <div class="collector-passport__progress">
          <strong aria-hidden="true">${escapeHtml(String(rate))} %</strong>
          <div class="collector-passport__progress-track" role="progressbar"
            aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(String(Math.max(0, Math.min(100, Number(rate) || 0))))}"
            aria-valuetext="${escapeHtml(progressText)}" aria-describedby="${progressId}">
            <div class="collector-passport__progress-fill" style="width:${Math.max(0, Math.min(100, Number(rate) || 0))}%"></div>
          </div>
          <p id="${progressId}" class="collector-passport__progress-text">${escapeHtml(progressText)}</p>
          ${empty ? `<p class="collector-passport__empty">Collection vide</p>` : ""}
          <p class="collector-passport__disclaimer">Collection déclarée par l’utilisateur</p>
        </div>
      </section>`}
  ${options.showReliabilityWarning ? `<p class="collector-passport__warning" role="status">${escapeHtml(longCopy)}</p>` : ""}
  <section class="collector-passport__section collector-passport__section--badges" aria-labelledby="passport-badges-heading">
    <h3 id="passport-badges-heading">Badges</h3>
    <div class="collector-passport__badge-grid" role="list" data-badge-count="${badges.length}">${badgeHtml || "<em>Aucun badge</em>"}</div>
  </section>
  <p class="collector-passport__footnote">catalogue ${escapeHtml((c && c.catalogueVersion) || cat.version || "—")}</p>
  <div class="sr-only" aria-live="polite" id="passport-a11y-status"></div>
</section>`.trim();
}

const PASSPORT_VIEWPORTS = Object.freeze({
  phone: { maxWidth: 480 },
  tablet: { minWidth: 481, maxWidth: 1023 },
  desktop: { minWidth: 1024 }
});

const PASSPORT_A11Y = Object.freeze({
  progressExample: formatCollectionProgressText(64, 82, 78.1)
});

const api = {
  escapeHtml,
  truncateUi,
  formatLocaleNumber,
  formatCollectionProgressText,
  formatBadgeAccessibleName,
  passportActivityLabel,
  passportActionDestination,
  renderPassportContractHtml,
  PASSPORT_VIEWPORTS,
  PASSPORT_A11Y
};

if (typeof module === "object" && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== "undefined") {
  globalThis.PassportRender = api;
}
