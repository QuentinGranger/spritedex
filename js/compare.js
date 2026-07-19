let compareWs = null;
let compareWsReconnectTimer = null;

function logCompareAnalytics(event, details = {}) {
  try {
    fetch(`${API_BASE}/analytics/compare`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ event, details })
    }).catch(() => {});
  } catch (e) {}
}

// ── Règles de statuts pour la comparaison ────────────────────────────────────
const COMPARE_RULES = {
  owned: ["owned"],
  missing: ["missing", "priority", "spotted", "unavailable"],
  recommend: ["missing", "priority", "spotted"],
  unknown: ["new", "unknown", "unsure"]
};

function compareIsOwned(status) { return COMPARE_RULES.owned.includes(status); }
function compareIsMissing(status) { return COMPARE_RULES.missing.includes(status); }
function compareIsUnknown(status) { return !status || COMPARE_RULES.unknown.includes(status); }
function compareIsRecommend(status) { return COMPARE_RULES.recommend.includes(status); }

function compareIsPriority(entry) {
  if (!entry) return false;
  const s = entry.status;
  // Un sprite indisponible, déjà possédé ou sans info n’est pas une priorité recommandable
  if (s === "unavailable" || compareIsOwned(s) || compareIsUnknown(s)) return false;
  if (s === "priority") return true;
  return !!(entry.priority && entry.priority !== "none" && entry.priority !== "ignored");
}

function isVariantReleasedAndActive(item) {
  const release = (item.releaseStatus || "").toLowerCase();
  if (["unreleased", "upcoming", "coming_soon", "soon", "unknown"].includes(release)) return false;
  const data = (item.dataStatus || "").toLowerCase();
  if (["archived", "legacy", "disabled"].includes(data)) return false;
  if (item.available === false || item.enabled === false || item.isReleased === false) return false;
  return true;
}

// Build a stable catalog list keyed by variant.id (e.g. sprite_water_holofoil).
function getCompareCatalogItems() {
  const items = [];
  for (const sprite of SPRITES || []) {
    const variantDetails = sprite.variantDetails || {};
    const entries = Object.entries(variantDetails);
    if (entries.length > 0) {
      for (const [variantType, variant] of entries) {
        const stableVariantId = variant.id || variantId(sprite.id, variantType);
        const legacyKeys = [`${sprite.id}::${variantType}`];
        if ((variantType || "").toLowerCase() === "base" || stableVariantId === sprite.id) {
          legacyKeys.push(sprite.id);
        }
        const type = variant.type || variantType;
        const releaseStatus = variant.releaseStatus || sprite.releaseStatus || "";
        const dataStatus = variant.dataStatus || sprite.dataStatus || "";
        const available = variant.available !== undefined ? variant.available : sprite.available;
        const availabilityStatus = variant.availability?.status || sprite.availability?.status || "";
        const acquisitionMethod = variant.acquisition?.type || sprite.acquisitionMethod?.type || "";
        const releaseDate = variant.availability?.startDate || sprite.availability?.startDate || variant.firstObservedAt || sprite.addedDate || null;
        items.push({
          id: stableVariantId,
          spriteId: sprite.id,
          variantId: stableVariantId,
          variantType: type,
          variantName: variant.name || variantType,
          spriteName: sprite.name || sprite.id,
          img: variant.image || (sprite.images && sprite.images[variantType]) || getSpriteImg(sprite.id, variantType),
          rarity: variant.rarity || sprite.rarity,
          color: sprite.color,
          effect: variant.effect || sprite.effect,
          seasonId: sprite.seasonId,
          eventId: sprite.eventId,
          releaseStatus,
          dataStatus,
          available,
          availabilityStatus,
          acquisitionMethod,
          releaseDate,
          legacyKeys
        });
      }
      continue;
    }
    // Fallback for older catalog payloads
    if (Array.isArray(sprite.variants)) {
      for (const variantType of sprite.variants) {
        const stableVariantId = variantId(sprite.id, variantType);
        const legacyKeys = [`${sprite.id}::${variantType}`];
        if ((variantType || "").toLowerCase() === "base") legacyKeys.push(sprite.id);
        items.push({
          id: stableVariantId,
          spriteId: sprite.id,
          variantId: stableVariantId,
          variantType,
          variantName: variantType,
          spriteName: sprite.name || sprite.id,
          img: getSpriteImg(sprite.id, variantType),
          rarity: sprite.rarity,
          color: sprite.color,
          effect: sprite.effect,
          seasonId: sprite.seasonId,
          eventId: sprite.eventId,
          releaseStatus: sprite.releaseStatus || "",
          dataStatus: sprite.dataStatus || "",
          available: sprite.available,
          availabilityStatus: sprite.availability?.status || "",
          acquisitionMethod: sprite.acquisitionMethod?.type || "",
          releaseDate: sprite.availability?.startDate || sprite.addedDate || null,
          legacyKeys
        });
      }
    }
  }
  return items;
}

function compareClassify(entry) {
  const s = entry?.status;
  if (compareIsOwned(s)) return "owned";
  if (compareIsMissing(s)) return "missing";
  return "unknown";
}

function compareEntry(collection, item) {
  if (!collection) return defaultEntry();
  // Prefer stable variantId, then legacy composite key(s).
  const keys = [item.variantId, item.id, ...(item.legacyKeys || [])];
  for (const key of keys) {
    if (key && collection[key]) return collection[key];
  }
  return defaultEntry();
}

function countExplicitCollectionEntries(collection) {
  if (!collection || typeof collection !== "object") return 0;
  let count = 0;
  for (const [key, entry] of Object.entries(collection)) {
    if (key.startsWith("fav_")) continue;
    if (!entry || typeof entry !== "object") continue;
    if (!COMPARE_RULES.unknown.includes(entry.status)) {
      count++;
    } else if ((entry.note && String(entry.note).trim()) || (entry.priority && entry.priority !== "none" && entry.priority !== "ignored")) {
      count++;
    }
  }
  return count;
}

// ── Moteur de comparaison ───────────────────────────────────────────────────
// userA et userB sont des objets { id, displayName, collection }.
// catalogue est une liste de variants (par défaut tous les variants sortis du catalogue).
// Le résultat est normalisé : comparisonId, generatedAt, users, summary, groups.
function compareCollections(userA, userB, catalogue = getCompareCatalogItems()) {
  const userAInfo = userA && typeof userA === "object" && "collection" in userA
    ? userA
    : { id: "userA", displayName: "Joueur A", collection: userA || {} };
  const userBInfo = userB && typeof userB === "object" && "collection" in userB
    ? userB
    : { id: "userB", displayName: "Joueur B", collection: userB || {} };
  const collectionA = userAInfo.collection;
  const collectionB = userBInfo.collection;

  const activeCatalogue = catalogue.filter(isVariantReleasedAndActive);

  const groups = {
    bothOwned: [],
    onlyUserA: [],
    onlyUserB: [],
    bothMissing: [],
    unknown: []
  };
  const records = [];

  for (const item of activeCatalogue) {
    const a = compareEntry(collectionA, item);
    const b = compareEntry(collectionB, item);
    const sa = compareClassify(a);
    const sb = compareClassify(b);

    const record = {
      ...item,
      userA: { status: a.status, priority: a.priority, note: a.note },
      userB: { status: b.status, priority: b.priority, note: b.note }
    };

    if (sa === "unknown" || sb === "unknown") {
      groups.unknown.push(record);
    } else if (sa === "owned" && sb === "owned") {
      groups.bothOwned.push(record);
    } else if (sa === "owned" && sb !== "owned") {
      groups.onlyUserA.push(record);
    } else if (sb === "owned" && sa !== "owned") {
      groups.onlyUserB.push(record);
    } else if (sa === "missing" && sb === "missing") {
      groups.bothMissing.push(record);
    } else {
      groups.unknown.push(record);
    }
    records.push(record);
  }

  const total = activeCatalogue.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;

  const toRate = (n, d) => d ? Math.round((n / d) * 10000) / 100 : 0;
  const aPossessionRate = toRate(aOwnedCount, total);
  const bPossessionRate = toRate(bOwnedCount, total);
  const collectiveCompletionRate = toRate(collectiveOwnedCount, total);
  const complementarityRate = toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount);

  const aEnteredCount = countExplicitCollectionEntries(collectionA);
  const bEnteredCount = countExplicitCollectionEntries(collectionB);
  const insufficientData = aEnteredCount === 0 || bEnteredCount === 0;

  const comparisonId = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `comparison_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return {
    comparisonId,
    generatedAt: new Date().toISOString(),
    users: {
      userA: { id: userAInfo.id, displayName: userAInfo.displayName, enteredCount: aEnteredCount },
      userB: { id: userBInfo.id, displayName: userBInfo.displayName, enteredCount: bEnteredCount }
    },
    summary: {
      catalogueVariantCount: total,
      bothOwnedCount,
      onlyUserACount,
      onlyUserBCount,
      bothMissingCount,
      unknownCount,
      aOwnedCount,
      bOwnedCount,
      aPossessionRate,
      bPossessionRate,
      collectiveOwnedCount,
      collectiveCompletionRate,
      complementarityRate,
      aEnteredCount,
      bEnteredCount,
      insufficientData
    },
    groups,
    records
  };
}

// ── Rendu ──────────────────────────────────────────────────────────────────
function comparePriorityTag(entry) {
  if (!entry || !entry.priority || entry.priority === "none" || entry.priority === "ignored") return "";
  return `<span class="ci-prio" style="--prio-color:${priorityColor(entry.priority)}">${priorityLabel(entry.priority)}</span>`;
}

function compareStatusTag(status, entry) {
  return `<span class="ci-status">${statusEmoji(status)} <span>${statusLabel(status)}</span>${comparePriorityTag(entry)}</span>`;
}

function compareItemHTML(item, extraHTML = "") {
  const img = item.img
    ? `<img src="${item.img}" alt="${escapeHtml(item.spriteName)}" class="ci-thumb" />`
    : `<span class="ci-thumb ci-thumb--empty">?</span>`;
  return `
    <div class="compare-item" style="--card-color:${item.color || 'var(--text)'}">
      ${img}
      <div class="compare-item__info">
        <span class="compare-item__name">${escapeHtml(item.spriteName)}</span>
        <span class="compare-item__variant">${escapeHtml(item.variantName || item.variant || "Base")}</span>
      </div>
      ${extraHTML ? `<div class="compare-item__extra">${extraHTML}</div>` : ""}
    </div>`;
}

function renderCompareSection(title, items, renderItem, open = false) {
  const body = items.length
    ? `<div class="compare-list">${items.map(renderItem).join("")}</div>`
    : `<p class="compare-empty">Aucun sprite dans cette catégorie.</p>`;
  return `
    <details class="compare-section" ${open ? "open" : ""}>
      <summary class="compare-section__title">
        <span>${escapeHtml(title)}</span>
        <span class="compare-section__count">${items.length}</span>
      </summary>
      <div class="compare-section__body">${body}</div>
    </details>`;
}

function renderCompareSummary(result, aName, bName) {
  const s = result.summary;
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);
  const ownerLine = (name, count, other) => `<strong>${name}</strong> possède <strong>${count}</strong> variante${count > 1 ? 's' : ''} qui manque${count > 1 ? 'nt' : ''} à <strong>${other}</strong>.`;
  const pct = (v) => s.insufficientData ? "—" : `${v}%`;
  const warning = s.insufficientData
    ? `<p class="compare-insufficient-warning">Collection insuffisamment renseignée pour calculer une comparaison fiable.</p>`
    : "";
  els.compareSummary.innerHTML = `
    ${warning}
    <div class="compare-main-indicators">
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.aPossessionRate)}</span><span class="compare-kpi__label">Complétion ${safeA}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.bPossessionRate)}</span><span class="compare-kpi__label">Complétion ${safeB}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.collectiveCompletionRate)}</span><span class="compare-kpi__label">Complétion collective</span></div>
    </div>
    <div class="compare-main-summary">
      <p>${ownerLine(safeA, s.onlyUserACount, safeB)}</p>
      <p>${ownerLine(safeB, s.onlyUserBCount, safeA)}</p>
      <p>Vous possédez <strong>${s.bothOwnedCount}</strong> variante${s.bothOwnedCount > 1 ? 's' : ''} en commun.</p>
      <p><strong>${s.bothMissingCount}</strong> variante${s.bothMissingCount > 1 ? 's' : ''} vous manquent à tous les deux.</p>
      <p>Ensemble, vous couvrez <strong>${pct(s.collectiveCompletionRate)}</strong> du catalogue.</p>
    </div>
    <p class="compare-complementarity-message">Vos collections sont complémentaires à <strong>${pct(s.complementarityRate)}</strong>.</p>
    <div class="compare-summary-grid">
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.collectiveCompletionRate)}</span><span class="compare-kpi__label">Complétion collective</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.complementarityRate)}</span><span class="compare-kpi__label">Complémentarité</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothOwnedCount}</span><span class="compare-kpi__label">En commun</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserACount}</span><span class="compare-kpi__label">${safeA} a · ${safeB} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserBCount}</span><span class="compare-kpi__label">${safeB} a · ${safeA} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothMissingCount}</span><span class="compare-kpi__label">Manque aux deux</span></div>
    </div>
    <div class="compare-players">
      <div class="compare-player">
        <span class="compare-player__name">${safeA}</span>
        <span class="compare-player__pct">${pct(s.aPossessionRate)} possédé</span>
        <span class="compare-player__count">${s.aOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
      <div class="compare-player">
        <span class="compare-player__name">${safeB}</span>
        <span class="compare-player__pct">${pct(s.bPossessionRate)} possédé</span>
        <span class="compare-player__count">${s.bOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
    </div>`;
}

function compareStatusIcon(status) {
  return statusEmoji(status);
}

function compareSeasonLabel(seasonId) {
  const s = (typeof SEASONS !== "undefined" && SEASONS[seasonId]) || null;
  if (!s) return seasonId || "Inconnue";
  return s.name || `Chapitre ${s.chapter} — Saison ${s.season}`;
}

function compareEventLabel(eventId) {
  const e = (typeof EVENTS !== "undefined" && EVENTS[eventId]) || null;
  if (!e) return eventId || "Aucun";
  return e.name || eventId;
}

function compareAvailabilityLabel(status) {
  const map = { available: "Disponible actuellement", unavailable: "Indisponible", unknown: "Inconnue" };
  return map[(status || "").toLowerCase()] || status || "Inconnue";
}

function compareAcquisitionLabel(method) {
  const map = { exploration: "Exploration", shop: "Boutique", challenge: "Défi", event: "Événement", unknown: "Inconnue" };
  return map[(method || "").toLowerCase()] || method || "Inconnue";
}

function compareVariantTypeLabel(type) {
  const m = (typeof VARIANT_META !== "undefined" && VARIANT_META[type]) || null;
  return m ? m.label : (type || "Base");
}

function matchesCompareCatalogFilters(record, filters) {
  if (!filters) return true;
  if (filters.season && record.seasonId !== filters.season) return false;
  if (filters.event && record.eventId !== filters.event) return false;
  if (filters.rarity && record.rarity !== filters.rarity) return false;
  if (filters.sprite && record.spriteId !== filters.sprite && record.spriteName !== filters.sprite) return false;
  if (filters.variantType && record.variantType !== filters.variantType) return false;
  if (filters.availability && record.availabilityStatus !== filters.availability) return false;
  if (filters.acquisition && record.acquisitionMethod !== filters.acquisition) return false;
  return true;
}

function getCompareFilterOptions(records, key, labelFn) {
  const seen = new Map();
  for (const r of records) {
    const val = r[key];
    if (val === undefined || val === null || val === "") continue;
    if (!seen.has(val)) seen.set(val, labelFn(r));
  }
  return [...seen.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
}

function renderCompareCatalogFilters(records) {
  if (!records) return "";
  state.compareCatalogFilters = state.compareCatalogFilters || {};
  const filters = state.compareCatalogFilters;
  const makeSelect = (key, label, options) => {
    const current = filters[key] || "";
    return `<div class="compare-catalog-filter"><label for="compareFilter-${key}">${escapeHtml(label)}</label><select id="compareFilter-${key}" class="compare-catalog-filter__select" data-filter-key="${key}"><option value="">Tous</option>${options.map(([val, lbl]) => `<option value="${escapeHtml(val)}" ${val === current ? "selected" : ""}>${escapeHtml(lbl)}</option>`).join("")}</select></div>`;
  };

  const seasonOpts = getCompareFilterOptions(records, "seasonId", r => compareSeasonLabel(r.seasonId));
  const eventOpts = getCompareFilterOptions(records, "eventId", r => compareEventLabel(r.eventId));
  const rarityOpts = getCompareFilterOptions(records, "rarity", r => r.rarity || "Inconnue");
  const spriteOpts = getCompareFilterOptions(records, "spriteId", r => r.spriteName);
  const variantOpts = getCompareFilterOptions(records, "variantType", r => compareVariantTypeLabel(r.variantType));
  const availOpts = getCompareFilterOptions(records, "availabilityStatus", r => compareAvailabilityLabel(r.availabilityStatus));
  const acqOpts = getCompareFilterOptions(records, "acquisitionMethod", r => compareAcquisitionLabel(r.acquisitionMethod));

  const hasFilters = Object.keys(filters).some(k => filters[k]);
  return `
    <details class="compare-catalog-filters" ${hasFilters ? "open" : ""}>
      <summary class="compare-catalog-filters__summary">Filtres du catalogue</summary>
      <div class="compare-catalog-filters__grid">
        ${makeSelect("season", "Saison", seasonOpts)}
        ${makeSelect("event", "Événement", eventOpts)}
        ${makeSelect("rarity", "Rareté", rarityOpts)}
        ${makeSelect("sprite", "Sprite", spriteOpts)}
        ${makeSelect("variantType", "Variante", variantOpts)}
        ${makeSelect("availability", "Disponibilité", availOpts)}
        ${makeSelect("acquisition", "Obtention", acqOpts)}
      </div>
      <button type="button" class="ghost-button compare-catalog-filters__reset" id="compareFilterReset">Réinitialiser les filtres</button>
    </details>`;
}

const COMPARE_RARITY_VALUE = {
  "mythic": 0, "mythique": 0,
  "legendary": 1, "légendaire": 1,
  "epic": 2, "épique": 2,
  "rare": 3,
  "common": 4, "uncommon": 5
};

function compareRarityValue(rarity) {
  return COMPARE_RARITY_VALUE[(rarity || "").toLowerCase()] ?? 9;
}

function compareDifferenceScore(r) {
  const sa = compareClassify(r.userA);
  const sb = compareClassify(r.userB);
  if ((sa === "owned" && sb !== "owned") || (sb === "owned" && sa !== "owned")) return 3;
  if (sa !== "unknown" && sb !== "unknown" && sa !== sb) return 2;
  if (sa === "unknown" || sb === "unknown") return 1;
  return 0;
}

function compareSortRecords(records, sort) {
  const sorted = [...records];
  switch (sort) {
    case "alpha":
      sorted.sort((a, b) => `${a.spriteName} ${a.variantName}`.localeCompare(`${b.spriteName} ${b.variantName}`));
      break;
    case "rarity-asc":
      sorted.sort((a, b) => compareRarityValue(a.rarity) - compareRarityValue(b.rarity));
      break;
    case "rarity-desc":
      sorted.sort((a, b) => compareRarityValue(b.rarity) - compareRarityValue(a.rarity));
      break;
    case "priority": {
      sorted.sort((a, b) => {
        const pa = (compareIsPriority(a.userA) || compareIsPriority(a.userB)) ? 0 : 1;
        const pb = (compareIsPriority(b.userA) || compareIsPriority(b.userB)) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const pva = Math.min(priorityOrder(a.userA.priority || "none"), priorityOrder(a.userB.priority || "none"));
        const pvb = Math.min(priorityOrder(b.userA.priority || "none"), priorityOrder(b.userB.priority || "none"));
        return pva - pvb;
      });
      break;
    }
    case "availability": {
      const order = { available: 0, unknown: 1, unavailable: 2, "": 3 };
      sorted.sort((a, b) => (order[(a.availabilityStatus || "").toLowerCase()] ?? 3) - (order[(b.availabilityStatus || "").toLowerCase()] ?? 3));
      break;
    }
    case "release-date":
      sorted.sort((a, b) => {
        const da = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const db = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return da - db;
      });
      break;
    case "biggest-difference":
      sorted.sort((a, b) => compareDifferenceScore(b) - compareDifferenceScore(a));
      break;
  }
  return sorted;
}

function getCompareFilterRecords(result, filter) {
  if (filter === "all") return result.records;
  if (result.groups[filter]) return result.groups[filter];
  if (filter === "differences" || filter === "missingMatch") {
    return [...result.groups.onlyUserA, ...result.groups.onlyUserB];
  }
  if (filter === "priorities") {
    return result.records.filter(r => compareIsPriority(r.userA) || compareIsPriority(r.userB));
  }
  return result.records;
}

function renderCompareTable(result, aName, bName) {
  if (!els.compareTable) return;
  const filter = state.compareFilter || "all";
  const catalogFilters = state.compareCatalogFilters || {};
  const sort = state.compareSort || "alpha";
  let records = getCompareFilterRecords(result, filter);
  records = records.filter(r => matchesCompareCatalogFilters(r, catalogFilters));
  records = compareSortRecords(records, sort);

  const header = `
    <div class="compare-table__header">
      <span class="compare-table__cell compare-table__cell--variant">Variante</span>
      <span class="compare-table__cell">${escapeHtml(aName)}</span>
      <span class="compare-table__cell">${escapeHtml(bName)}</span>
      <span class="compare-table__cell compare-table__cell--actions"></span>
    </div>`;

  const rows = records.map(r => {
    const actions = `
      <button type="button" class="compare-action compare-action--detail" data-sprite-id="${r.spriteId}">Fiche</button>
      ${compareQuickActionsHTML(r.variantId, r.userA.status)}`;
    return `
      <div class="compare-table__row" data-sprite-id="${r.spriteId}" data-variant-id="${r.variantId}">
        <span class="compare-table__cell compare-table__cell--variant">
          <img src="${r.img || ""}" alt="" class="compare-table__thumb" loading="lazy" onerror="this.style.display='none'">
          <span class="compare-table__name">${escapeHtml(r.spriteName)} — ${escapeHtml(r.variantName || "Base")}</span>
        </span>
        <span class="compare-table__cell compare-table__cell--status">${compareStatusIcon(r.userA.status)}<span class="compare-table__status-label">${statusLabel(r.userA.status)}</span></span>
        <span class="compare-table__cell compare-table__cell--status">${compareStatusIcon(r.userB.status)}<span class="compare-table__status-label">${statusLabel(r.userB.status)}</span></span>
        <span class="compare-table__cell compare-table__cell--actions">${actions}</span>
      </div>`;
  }).join("");

  const body = records.length
    ? `<div class="compare-table__body">${rows}</div>`
    : `<div class="compare-table__empty"><p class="compare-empty">Aucune variante dans cette catégorie.</p></div>`;

  els.compareTable.innerHTML = `
    <div class="compare-section compare-section--table">
      <h3 class="compare-section__title">Comparaison visuelle</h3>
      <div class="compare-table__wrap">${header}${body}</div>
    </div>`;

  els.compareTable.querySelectorAll(".compare-table__row").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, select")) return;
      openCompareSprite(row.dataset.spriteId);
    });
  });

  els.compareTable.querySelectorAll(".compare-action--detail").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openCompareSprite(btn.dataset.spriteId); });
  });

  attachCompareQuickActions(els.compareTable);
}

function openCompareSprite(spriteId) {
  if (!els.compareSpriteDetailContent || !state.lastCompareResult) return;
  const result = state.lastCompareResult;
  const records = result.records
    .filter(r => r.spriteId === spriteId)
    .sort((a, b) => compareVariantTypeLabel(a.variantType).localeCompare(compareVariantTypeLabel(b.variantType)));
  if (!records.length) return;

  const sprite = SPRITES.find(s => s.id === spriteId);
  const safeA = escapeHtml(result.users.userA.displayName);
  const safeB = escapeHtml(result.users.userB.displayName);
  const spriteName = escapeHtml(records[0].spriteName);

  const total = records.length;
  const covered = records.filter(r => r.userA.status === "owned" || r.userB.status === "owned").length;
  const pct = total ? Math.round((covered / total) * 10000) / 100 : 0;

  const header = `
    <div class="compare-sprite-header" style="--card-color:${sprite && sprite.color ? sprite.color : 'var(--text)'}">
      ${records[0].img ? `<img src="${records[0].img}" alt="${spriteName}" class="compare-sprite-header__img" onerror="this.style.display='none'">` : ""}
      <div class="compare-sprite-header__info">
        <h2>${spriteName}</h2>
        <span class="compare-sprite-completion">Complétion collective du ${spriteName} : <strong>${pct}%</strong></span>
      </div>
    </div>`;

  const rows = records.map(r => {
    const aStatus = `${statusLabel(r.userA.status)} ${comparePriorityTag(r.userA)}`;
    const bStatus = `${statusLabel(r.userB.status)} ${comparePriorityTag(r.userB)}`;
    return `
      <div class="compare-sprite-table__row">
        <span class="compare-sprite-table__cell compare-sprite-table__cell--name">${escapeHtml(compareVariantTypeLabel(r.variantType))}</span>
        <span class="compare-sprite-table__cell">${aStatus}</span>
        <span class="compare-sprite-table__cell">${bStatus}</span>
        <span class="compare-sprite-table__cell compare-sprite-table__cell--actions">${compareQuickActionsHTML(r.variantId, r.userA.status)}</span>
      </div>`;
  }).join("");

  const table = `
    <div class="compare-sprite-table">
      <div class="compare-sprite-table__header">
        <span class="compare-sprite-table__cell">Variante</span>
        <span class="compare-sprite-table__cell">${safeA}</span>
        <span class="compare-sprite-table__cell">${safeB}</span>
        <span class="compare-sprite-table__cell compare-sprite-table__cell--actions">Action</span>
      </div>
      <div class="compare-sprite-table__body">${rows}</div>
    </div>`;

  els.compareSpriteDetailContent.innerHTML = `${header}${table}`;
  attachCompareQuickActions(els.compareSpriteDetailContent, true);

  const dialog = document.getElementById("compareSpriteDialog");
  if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  const hasMissing = records.some(r => r.userA.status !== "owned" || r.userB.status !== "owned");
  logCompareAnalytics("missing_match_opened", { spriteId, hasMissing });
  state.compareSpriteId = spriteId;
}

function compareQuickActionsHTML(variantId, selectedStatus) {
  const options = [
    { value: "", label: "Action" },
    { value: "owned", label: "Possédé" },
    { value: "missing", label: "Manquant" },
    { value: "priority", label: "Prioritaire" },
    { value: "spotted", label: "Repéré" }
  ];
  const select = `<select class="compare-status-select" data-variant-id="${variantId}">${options.map(o => `<option value="${o.value}" ${selectedStatus === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const noteBtn = `<button type="button" class="compare-action compare-action--note" data-variant-id="${variantId}">Note</button>`;
  return `<span class="compare-quick-actions">${select}${noteBtn}</span>`;
}

function attachCompareQuickActions(container, spriteIdForDialog = null) {
  container.querySelectorAll(".compare-status-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      e.stopPropagation();
      const status = e.target.value;
      if (!status) return;
      const patch = { status };
      if (status === "owned") {
        const entry = getEntry(sel.dataset.variantId);
        if (!entry.obtainedAt) patch.obtainedAt = new Date().toISOString();
      }
      setEntry(sel.dataset.variantId, patch);
      if (status === "priority") logCompareAnalytics("priority_added_from_comparison", { variantId: sel.dataset.variantId, source: "quick_action" });
      toast(statusLabel(status));
      renderCompare();
      if (spriteIdForDialog && state.compareSpriteId) openCompareSprite(state.compareSpriteId);
    });
  });

  container.querySelectorAll(".compare-action--note").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const note = prompt("Note :");
      if (note !== null) {
        setEntry(btn.dataset.variantId, { note });
        renderCompare();
        if (spriteIdForDialog && state.compareSpriteId) openCompareSprite(state.compareSpriteId);
      }
    });
  });
}

function groupCompareRecordsBy(records, key) {
  return records.reduce((acc, r) => {
    const v = r[key];
    if (v === undefined || v === null || v === "") return acc;
    acc[v] = acc[v] || [];
    acc[v].push(r);
    return acc;
  }, {});
}

function generateCompareRecommendations(result, aName, bName) {
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);
  const recs = [];

  // 1. Priority exchanges
  const aWantsFromB = result.groups.onlyUserB.filter(r => compareIsPriority(r.userA));
  const bWantsFromA = result.groups.onlyUserA.filter(r => compareIsPriority(r.userB));
  if (aWantsFromB.length) {
    recs.push({ type: "priority", title: `${safeB} possède ${aWantsFromB.length} variante${aWantsFromB.length > 1 ? 's' : ''} prioritaire${aWantsFromB.length > 1 ? 's' : ''} pour ${safeA}`, items: aWantsFromB });
  }
  if (bWantsFromA.length) {
    recs.push({ type: "priority", title: `${safeA} possède ${bWantsFromA.length} variante${bWantsFromA.length > 1 ? 's' : ''} prioritaire${bWantsFromA.length > 1 ? 's' : ''} pour ${safeB}`, items: bWantsFromA });
  }

  // 2. Unavailable variants owned by one and missing to the other
  const aHasUnavailableBMissing = result.groups.onlyUserA.filter(r => r.availabilityStatus === "unavailable");
  const bHasUnavailableAMissing = result.groups.onlyUserB.filter(r => r.availabilityStatus === "unavailable");
  if (aHasUnavailableBMissing.length) {
    recs.push({ type: "unavailable", title: `${safeA} possède ${aHasUnavailableBMissing.length} variante${aHasUnavailableBMissing.length > 1 ? 's' : ''} indisponible${aHasUnavailableBMissing.length > 1 ? 's' : ''} qui manque${aHasUnavailableBMissing.length > 1 ? 'nt' : ''} à ${safeB}`, items: aHasUnavailableBMissing });
  }
  if (bHasUnavailableAMissing.length) {
    recs.push({ type: "unavailable", title: `${safeB} possède ${bHasUnavailableAMissing.length} variante${bHasUnavailableAMissing.length > 1 ? 's' : ''} indisponible${bHasUnavailableAMissing.length > 1 ? 's' : ''} qui manque${bHasUnavailableAMissing.length > 1 ? 'nt' : ''} à ${safeA}`, items: bHasUnavailableAMissing });
  }

  // 3. Both missing by rarity
  const rarities = [...new Set(result.groups.bothMissing.map(r => r.rarity).filter(Boolean))];
  for (const rarity of rarities) {
    const items = result.groups.bothMissing.filter(r => r.rarity === rarity);
    if (items.length) {
      recs.push({ type: "bothMissingRarity", title: `Il vous manque à tous les deux ${items.length} variante${items.length > 1 ? 's' : ''} ${rarity}`, items });
    }
  }

  // 4. Sprites whose variants are fully covered together
  const bySprite = groupCompareRecordsBy(result.records, "spriteId");
  for (const records of Object.values(bySprite)) {
    const total = records.length;
    if (total < 2) continue;
    const covered = records.filter(r => r.userA.status === "owned" || r.userB.status === "owned").length;
    if (covered === total) {
      const missingA = records.filter(r => r.userA.status !== "owned").length;
      const missingB = records.filter(r => r.userB.status !== "owned").length;
      const spriteName = records[0].spriteName;
      let detail = "";
      if (missingA && missingB) detail = ` (${safeA} en manque ${missingA}, ${safeB} en manque ${missingB})`;
      else if (missingA) detail = ` (${safeA} en manque ${missingA})`;
      else if (missingB) detail = ` (${safeB} en manque ${missingB})`;
      recs.push({ type: "completeTogether", title: `Vous possédez ensemble toutes les variantes du ${escapeHtml(spriteName)}${detail}`, items: records.filter(r => r.userA.status !== "owned" || r.userB.status !== "owned") });
    }
  }

  // 5. Events with only one variant missing
  const byEvent = groupCompareRecordsBy(result.records.filter(r => r.eventId), "eventId");
  for (const [eventId, records] of Object.entries(byEvent)) {
    const total = records.length;
    if (total < 2) continue;
    const covered = records.filter(r => r.userA.status === "owned" || r.userB.status === "owned").length;
    if (total - covered === 1) {
      recs.push({ type: "eventClose", title: `Il ne vous manque qu’une variante pour compléter l’événement ${escapeHtml(compareEventLabel(eventId))}`, items: records.filter(r => r.userA.status !== "owned" && r.userB.status !== "owned") });
    }
  }

  return recs;
}

function renderCompareRecommendations(result, aName, bName) {
  if (!els.compareRecommendations) return;
  const recommendations = generateCompareRecommendations(result, aName, bName);

  let html = `<div class="compare-section compare-section--recommendations"><h3 class="compare-section__title">Recommandations</h3><div class="compare-section__body">`;
  if (!recommendations.length) {
    html += `<p class="compare-empty">Aucune recommandation notable.</p>`;
  } else {
    for (const rec of recommendations) {
      const list = rec.items.map(r => compareItemHTML(r, `${compareStatusIcon(r.userA.status)} ${compareStatusIcon(r.userB.status)}`)).join("");
      html += `<div class="compare-subsection"><h4 class="compare-subsection__title">${rec.title}</h4><div class="compare-list">${list}</div></div>`;
    }
  }
  html += `</div></div>`;
  els.compareRecommendations.innerHTML = html;
}

function renderCompareActions(result) {
  if (!els.compareActions) return;
  const filter = state.compareFilter || "all";
  const options = [
    { value: "all", label: "Tous les Sprites" },
    { value: "differences", label: "Seulement les différences" },
    { value: "missingMatch", label: "Missing Match (complémentaires)" },
    { value: "priorities", label: "Seulement les priorités" },
    { value: "bothMissing", label: "Manquantes aux deux" },
    { value: "bothOwned", label: "En commun" },
    { value: "onlyUserA", label: "Possédés par moi" },
    { value: "onlyUserB", label: "Possédés par l'ami" },
    { value: "unknown", label: "Inconnus" }
  ];
  const sortOptions = [
    { value: "alpha", label: "Ordre alphabétique" },
    { value: "rarity-asc", label: "Rareté croissante" },
    { value: "rarity-desc", label: "Rareté décroissante" },
    { value: "priority", label: "Priorité" },
    { value: "availability", label: "Disponibilité" },
    { value: "release-date", label: "Date de sortie" },
    { value: "biggest-difference", label: "Plus grande différence" }
  ];
  const sort = state.compareSort || "alpha";
  const select = `<select id="compareFilterSelect" class="compare-filter-select" aria-label="Filtrer">${options.map(o => `<option value="${o.value}" ${filter === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const sortSelect = `<select id="compareSortSelect" class="compare-filter-select" aria-label="Trier">${sortOptions.map(o => `<option value="${o.value}" ${sort === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const catalogFilters = renderCompareCatalogFilters(result && result.records);
  els.compareActions.innerHTML = `
    <div class="compare-actions-bar">
      <label for="compareFilterSelect" class="compare-actions-label">Filtrer</label>
      ${select}
      <label for="compareSortSelect" class="compare-actions-label">Trier</label>
      ${sortSelect}
      <button type="button" class="login-btn" id="compareRefreshBtn">Actualiser</button>
      <button type="button" class="ghost-button" id="compareShareActionBtn">Partager</button>
    </div>
    ${catalogFilters}`;

  const filterSelect = $("#compareFilterSelect");
  if (filterSelect) filterSelect.addEventListener("change", (e) => { state.compareFilter = e.target.value; logCompareAnalytics("comparison_filter_used", { filter: "status", value: e.target.value }); renderCompare(); });

  const sortSelectEl = $("#compareSortSelect");
  if (sortSelectEl) sortSelectEl.addEventListener("change", (e) => { state.compareSort = e.target.value; logCompareAnalytics("comparison_filter_used", { filter: "sort", value: e.target.value }); renderCompare(); });

  const refreshBtn = $("#compareRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => { state.compareFilter = "all"; state.compareSort = "alpha"; state.compareCatalogFilters = {}; renderCompare(); });

  const shareBtn = $("#compareShareActionBtn");
  if (shareBtn) shareBtn.addEventListener("click", shareCompareLink);

  els.compareActions.querySelectorAll("[data-filter-key]").forEach(sel => {
    sel.addEventListener("change", (e) => {
      state.compareCatalogFilters = state.compareCatalogFilters || {};
      state.compareCatalogFilters[e.target.dataset.filterKey] = e.target.value;
      logCompareAnalytics("comparison_filter_used", { filter: e.target.dataset.filterKey, value: e.target.value });
      renderCompare();
    });
  });

  const resetBtn = $("#compareFilterReset");
  if (resetBtn) resetBtn.addEventListener("click", () => { state.compareCatalogFilters = {}; renderCompare(); });
}

function renderCompare() {
  if (!els.compareResults || !els.compareSummary || !els.compareTable || !els.compareRecommendations || !els.compareActions) return;
  if (!state.compareTarget) {
    els.compareResults.style.display = "none";
    if (els.compareStatus) els.compareStatus.textContent = "";
    return;
  }
  els.compareResults.style.display = "block";
  const aName = state.username || "Moi";
  const bName = state.compareTarget.username || "Ami";
  if (els.comparePlayerAName) els.comparePlayerAName.textContent = aName;
  if (els.comparePlayerBName) els.comparePlayerBName.textContent = bName;
  const userA = { id: state.userId || "userA", displayName: state.username || "Moi", collection: state.collection };
  const userB = { id: state.compareTarget.userId || state.compareTarget.username || "userB", displayName: state.compareTarget.username || "Ami", collection: state.compareTarget.collection };
  const result = compareCollections(userA, userB, getCompareCatalogItems());
  state.lastCompareResult = result;
  renderCompareSummary(result, aName, bName);
  renderCompareActions(result);
  renderCompareRecommendations(result, aName, bName);
  renderCompareTable(result, aName, bName);

  connectCompareWs();
  if (state.compareTarget.userId) sendCompareSubscribe(state.compareTarget.userId);
}

// ── Chargement et partage ───────────────────────────────────────────────────
function extractShareToken(raw) {
  if (!raw) return "";
  let value = raw.trim();
  // supporte ?share=... et ?compare=...
  for (const param of ["share", "compare"]) {
    const re = new RegExp(`[?&]${param}=([a-f0-9]{64})`, "i");
    const m = value.match(re);
    if (m) return m[1].toLowerCase();
  }
  // token direct
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  return "";
}

async function loadCompareTarget(raw) {
  const token = extractShareToken(raw);
  if (!token) {
    toast("Lien ou token de partage invalide");
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/shared/${encodeURIComponent(token)}`, { headers: authHeadersOnly() });
    if (res.status === 403) {
      toast("Ce profil est privé ou tu n’as pas l’autorisation de le comparer");
      return;
    }
    if (res.status === 404) {
      toast("Lien de partage invalide ou révoqué");
      return;
    }
    if (!res.ok) throw new Error("shared failed");
    const data = await res.json();
    state.compareToken = token;
    state.compareTarget = {
      userId: data.id,
      username: data.username || "Ami",
      avatarUrl: data.avatarUrl || "",
      collection: data.collection || {}
    };
    logCompareAnalytics("comparison_viewed", { source: "shared_profile", targetId: data.id });
    if (els.compareTokenInput) els.compareTokenInput.value = raw;
    const url = new URL(location.href);
    url.searchParams.set("compare", token);
    history.replaceState(null, "", url.toString());
    renderCompare();
    toast(`Comparaison avec ${state.compareTarget.username} chargée`);
  } catch (e) {
    toast("Impossible de charger ce profil partagé");
    console.error("[compare]", e);
  }
}

async function shareCompareLink() {
  if (!state.userId) {
    toast("Connecte-toi d’abord pour obtenir un lien de partage");
    return;
  }
  if (els.shareCompareDialog && typeof els.shareCompareDialog.showModal === "function") {
    els.shareCompareDialog.showModal();
  } else {
    createCompareShare();
  }
}

async function createCompareShare() {
  if (!state.userId) {
    toast("Connecte-toi d’abord pour obtenir un lien de partage");
    return;
  }
  if (!els.shareCompareDuration) return;

  const duration = els.shareCompareDuration.value || "24h";
  const collectionVisible = els.shareCompareCollection ? els.shareCompareCollection.checked : true;
  const showNotes = els.shareCompareNotes ? els.shareCompareNotes.checked : false;
  const showPriorities = els.shareComparePriorities ? els.shareComparePriorities.checked : true;
  const allowVisitorCompare = els.shareCompareVisitor ? els.shareCompareVisitor.checked : true;

  try {
    const res = await fetch(`${API_BASE}/compare/share`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ duration, collectionVisible, showNotes, showPriorities, allowVisitorCompare })
    });
    if (!res.ok) throw new Error("create share failed");
    const data = await res.json();
    logCompareAnalytics("compare_invitation_generated", { source: "compare_dialog" });
    const url = data.url;
    if (els.shareCompareResult) {
      els.shareCompareResult.innerHTML = `<p class="share-compare-url"><a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a></p>`;
    }
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast("Lien copié !");
    } else {
      toast(url);
    }
  } catch (e) {
    toast("Erreur réseau");
    console.error("[compare share]", e);
  }
}

async function loadCompareShare(token) {
  try {
    const res = await fetch(`${API_BASE}/compare/share/${encodeURIComponent(token)}`, { headers: authHeadersOnly() });
    if (res.status === 403) {
      toast("Ce profil est privé ou tu n’as pas l’autorisation de le comparer");
      return;
    }
    if (res.status === 404) {
      toast("Lien de partage invalide, expiré ou révoqué");
      return;
    }
    if (!res.ok) throw new Error("compare share failed");
    const data = await res.json();
    state.compareToken = token;
    state.compareShareOptions = data.options;

    const owner = data.result?.users?.userA;
    const ownerCollection = {};
    for (const r of (data.result?.records || [])) {
      ownerCollection[r.variantId] = { status: r.userA.status, priority: r.userA.priority, note: r.userA.note };
    }

    state.compareTarget = {
      userId: owner?.id,
      username: owner?.displayName || "Ami",
      collection: ownerCollection
    };

    if (els.compareTokenInput) els.compareTokenInput.value = token;
    logCompareAnalytics("app_returned_from_compare", { source: "share_link", targetId: state.compareTarget.userId });
    renderCompare();
    switchToCompareView();
    toast(`Comparaison avec ${state.compareTarget.username} chargée`);
  } catch (e) {
    toast("Impossible de charger ce lien partagé");
    console.error("[compare share load]", e);
  }
}

function setCompareMode(mode) {
  state.compareMode = mode === "squad" ? "squad" : "friend";
  const friendPanel = document.getElementById("compareModeFriend");
  const squadPanel = document.getElementById("compareModeSquad");
  document.querySelectorAll(".compare-mode-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.compareMode === state.compareMode);
  });
  if (friendPanel) friendPanel.style.display = state.compareMode === "friend" ? "" : "none";
  if (squadPanel) squadPanel.style.display = state.compareMode === "squad" ? "" : "none";
  if (state.compareMode === "friend") {
    renderCompare();
    if (typeof stopSquadPolling === "function") stopSquadPolling();
  } else {
    if (state.activeSquad && typeof loadSquad === "function") {
      loadSquad(state.activeSquad);
      startSquadPolling();
    }
  }
}

function switchToCompareView() {
  const tab = document.querySelector('.tab[data-view="squad"]');
  if (tab) tab.click();
  setCompareMode("friend");
}

async function handleCompareParams() {
  const params = new URLSearchParams(location.search);
  const token = params.get("compare");
  if (!token) return false;
  await loadCompareTarget(token);
  if (state.compareTarget) switchToCompareView();
  return true;
}

async function handleCompareShareParams() {
  const pathMatch = location.pathname.match(/\/compare\/share\/([a-f0-9]{64})/i);
  const token = pathMatch ? pathMatch[1].toLowerCase() : new URLSearchParams(location.search).get("compareShare");
  if (!token) return false;
  await loadCompareShare(token);
  return true;
}

// ── WebSocket temps réel pour la comparaison ──
function connectCompareWs() {
  if (compareWs && (compareWs.readyState === WebSocket.CONNECTING || compareWs.readyState === WebSocket.OPEN)) return;
  if (!state.userId) return;
  try {
    compareWs = new WebSocket(WS_URL);
  } catch (e) {
    console.error("[compare ws] connect failed", e);
    return;
  }

  compareWs.onopen = () => {
    compareWs.send(JSON.stringify({ type: "auth", token: localStorage.getItem(TOKEN_KEY) }));
    if (state.compareTarget?.userId) {
      sendCompareSubscribe(state.compareTarget.userId);
    }
  };

  compareWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleCompareWsMessage(msg);
    } catch (e) {}
  };

  compareWs.onclose = () => {
    compareWs = null;
    clearTimeout(compareWsReconnectTimer);
    compareWsReconnectTimer = setTimeout(connectCompareWs, 3000);
  };

  compareWs.onerror = () => {
    if (compareWs) compareWs.close();
  };
}

function sendCompareSubscribe(userId) {
  if (!compareWs || compareWs.readyState !== WebSocket.OPEN || !userId) return;
  compareWs.send(JSON.stringify({ type: "compare_subscribe", targetUserId: userId }));
}

function handleCompareWsMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "compare_update" || msg.type === "compare_reset") {
    updateCompareFromMessage(msg);
  }
}

function updateCompareFromMessage(msg) {
  if (!state.compareTarget) return;
  const targetId = state.compareTarget.userId;
  const isTarget = targetId && String(targetId) === String(msg.userId);
  const isSelf = state.userId && String(state.userId) === String(msg.userId);
  if (!isTarget && !isSelf) return;

  if (msg.type === "compare_reset") {
    if (isTarget) state.compareTarget.collection = {};
    if (isSelf) state.collection = {};
  } else if (msg.type === "compare_update" && Array.isArray(msg.changes)) {
    for (const ch of msg.changes) {
      const entry = {
        status: ch.status || "new",
        priority: ch.priority || "none",
        note: ch.note || "",
        obtainedAt: ch.obtainedAt || null
      };
      if (isTarget) state.compareTarget.collection[ch.variantId] = entry;
      if (isSelf) state.collection[ch.variantId] = entry;
    }
    if (isTarget && msg.changes.length > 0) {
      showCompareUpdateToast(msg, msg.changes[0]);
    }
  }

  if (isTarget || isSelf) {
    renderCompare();
  }
}

function showCompareUpdateToast(msg, change) {
  const catalog = getCompareCatalogItems().find(i => i.variantId === change.variantId);
  const spriteName = catalog?.spriteName || change.spriteId || "un sprite";
  const variantName = catalog?.variantName || "";
  const displayName = state.compareTarget?.username || "Votre ami";
  const action = (change.status === "owned") ? "a obtenu" : "a mis à jour";
  const label = variantName && variantName !== "Base" ? `${spriteName} (${variantName})` : spriteName;
  toast(`${displayName} ${action} ${label}`);
}

function setupCompareEvents() {
  document.querySelectorAll(".compare-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => setCompareMode(btn.dataset.compareMode));
  });
  if (els.compareForm) {
    els.compareForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = els.compareTokenInput.value.trim();
      if (!raw) return;
      loadCompareTarget(raw);
    });
  }
  if (els.compareShareBtn) {
    els.compareShareBtn.addEventListener("click", shareCompareLink);
  }
  if (els.shareCompareGenerate && els.shareCompareDialog) {
    els.shareCompareGenerate.addEventListener("click", (e) => {
      e.preventDefault();
      createCompareShare();
    });
  }
}
