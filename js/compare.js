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
          effect: (typeof variant.effect === "string" ? variant.effect : null) || sprite.effect,
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

const DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS = {
  mythic: 1.5,
  legendary: 1.2,
  epic: 1,
  rare: 0.7,
  uncommon: 0.4,
  common: 0.1
};

function isItemAvailable(item) {
  if (item.available === false) return false;
  const status = (item.availabilityStatus || "").toLowerCase();
  return status !== "unavailable";
}

function computeComplementarityScore(baseRate, records, options = {}) {
  const rarityWeights = options.rarityWeights || DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS;
  const objectiveVariantIds = options.objectiveVariantIds ? new Set(options.objectiveVariantIds) : null;
  const activeEventIds = options.activeEventIds ? new Set(options.activeEventIds) : null;

  const isOwned = (entry) => compareClassify(entry) === "owned";
  const isMissing = (entry) => compareClassify(entry) === "missing";
  const isPriority = (entry) => compareIsPriority(entry);

  let commonPriorities = 0;
  let availableComplements = 0;
  let objectiveMatches = 0;
  let soughtRarities = 0;
  let activeEvents = 0;

  for (const rec of records) {
    const aOwned = isOwned(rec.userA);
    const bOwned = isOwned(rec.userB);
    const aPrio = isPriority(rec.userA);
    const bPrio = isPriority(rec.userB);
    const aMissing = isMissing(rec.userA);
    const bMissing = isMissing(rec.userB);
    const onlyOne = (aOwned && !bOwned) || (bOwned && !aOwned);

    if (aPrio && bPrio) commonPriorities++;
    if (onlyOne && isItemAvailable(rec)) availableComplements++;

    if (objectiveVariantIds && objectiveVariantIds.has(rec.id) && onlyOne) {
      if ((aOwned && (bMissing || bPrio)) || (bOwned && (aMissing || aPrio))) objectiveMatches++;
    }

    if (onlyOne && ((aOwned && bPrio) || (bOwned && aPrio))) {
      const weight = rarityWeights[(rec.rarity || "").toLowerCase()] || 0;
      if (weight > 0) soughtRarities += weight;
    }

    if (rec.eventId && onlyOne) {
      const isActiveEvent = activeEventIds ? activeEventIds.has(rec.eventId) : isItemAvailable(rec) && (rec.availabilityStatus || "").toLowerCase() === "event";
      if (isActiveEvent) activeEvents++;
    }
  }

  const bonus = (commonPriorities * 0.5) + (availableComplements * 0.3) + (objectiveMatches * 0.7) + (soughtRarities * 0.4) + (activeEvents * 0.5);
  return Math.min(100, Math.round((baseRate + bonus) * 100) / 100);
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
    : { id: "userA", displayName: t("compare.playerA"), collection: userA || {} };
  const userBInfo = userB && typeof userB === "object" && "collection" in userB
    ? userB
    : { id: "userB", displayName: t("compare.playerB"), collection: userB || {} };
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
  const complementarityScore = computeComplementarityScore(complementarityRate, records);

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
      complementarityScore,
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
  const imageUrl = safeImageUrl(item.img);
  const img = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.spriteName)}" class="ci-thumb" />`
    : `<span class="ci-thumb ci-thumb--empty">?</span>`;
  return `
    <div class="compare-item" style="--card-color:${safeCssColor(item.color, '#8d7cff')}">
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
    : `<p class="compare-empty">${t("compare.emptyVariants")}</p>`;
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
  const ownerLine = (name, count, other) => t("compare.ownerLine", { name: `<strong>${name}</strong>`, count: `<strong>${count}</strong>`, other: `<strong>${other}</strong>`, s: count !== 1 ? "s" : "", nt: count !== 1 ? "nt" : "" });
  const pct = (v) => s.insufficientData ? "—" : `${v}%`;
  const warning = s.insufficientData
    ? `<p class="compare-insufficient-warning">${t("compare.insufficientData")}</p>`
    : "";
  els.compareSummary.innerHTML = `
    ${warning}
    <div class="compare-main-indicators">
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.aPossessionRate)}</span><span class="compare-kpi__label">${t("compare.completionOf", { name: safeA })}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.bPossessionRate)}</span><span class="compare-kpi__label">${t("compare.completionOf", { name: safeB })}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.collectiveCompletionRate)}</span><span class="compare-kpi__label">${t("compare.collectiveCompletion")}</span></div>
    </div>
    <div class="compare-main-summary">
      <p>${ownerLine(safeA, s.onlyUserACount, safeB)}</p>
      <p>${ownerLine(safeB, s.onlyUserBCount, safeA)}</p>
      <p>${t("compare.inCommonSentence", { count: `<strong>${s.bothOwnedCount}</strong>`, s: s.bothOwnedCount !== 1 ? "s" : "" })}</p>
      <p>${t("compare.bothMissingSentence", { count: `<strong>${s.bothMissingCount}</strong>`, s: s.bothMissingCount !== 1 ? "s" : "" })}</p>
      <p>${t("compare.togetherCover", { pct: `<strong>${pct(s.collectiveCompletionRate)}</strong>` })}</p>
    </div>
    <p class="compare-complementarity-message">${t("compare.complementarityMessage", { rate: `<strong>${pct(s.complementarityRate)}</strong>`, score: `<strong>${pct(s.complementarityScore)}</strong>` })}</p>
    <div class="compare-community" id="compareCommunityContext" hidden>
      <p class="compare-community__title">${t("compare.communityContext")}</p>
      <div class="compare-community__list" id="compareCommunityList"></div>
      <p class="compare-community__note">${t("compare.communityNote")}</p>
    </div>
    <div class="compare-summary-grid">
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.collectiveCompletionRate)}</span><span class="compare-kpi__label">${t("compare.collectiveCompletion")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.complementarityRate)}</span><span class="compare-kpi__label">${t("compare.baseComplementarity")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.complementarityScore)}</span><span class="compare-kpi__label">${t("compare.complementarityScore")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothOwnedCount}</span><span class="compare-kpi__label">${t("compare.inCommon")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserACount}</span><span class="compare-kpi__label">${t("compare.hasLacks", { a: safeA, b: safeB })}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserBCount}</span><span class="compare-kpi__label">${t("compare.hasLacks", { a: safeB, b: safeA })}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothMissingCount}</span><span class="compare-kpi__label">${t("compare.lacksBoth")}</span></div>
    </div>
    <div class="compare-players">
      <div class="compare-player">
        <span class="compare-player__name">${safeA}</span>
        <span class="compare-player__pct">${pct(s.aPossessionRate)} ${t("compare.ownedSuffix")}</span>
        <span class="compare-player__count">${s.aOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
      <div class="compare-player">
        <span class="compare-player__name">${safeB}</span>
        <span class="compare-player__pct">${pct(s.bPossessionRate)} ${t("compare.ownedSuffix")}</span>
        <span class="compare-player__count">${s.bOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
    </div>`;
}

/** Étape 82 — secondary community lines under the personal compare summary. */
async function loadCompareCommunityContext(result, aName, bName) {
  const mount = document.getElementById("compareCommunityContext");
  const list = document.getElementById("compareCommunityList");
  if (!mount || !list || !result || !result.groups) return;

  const pick = (arr, relation, n) => (arr || []).slice(0, n).map((r) => ({
    variantId: r.variantId || r.id,
    relation
  }));
  const items = [
    ...pick(result.groups.bothMissing, "bothMissing", 3),
    ...pick(result.groups.onlyUserA, "onlyA", 2),
    ...pick(result.groups.onlyUserB, "onlyB", 2)
  ].filter((i) => i.variantId);
  if (!items.length) {
    mount.hidden = true;
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/sprite-graph/compare/community-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeadersOnly() },
      body: JSON.stringify({ items, aName, bName })
    });
    if (!res.ok) {
      mount.hidden = true;
      return;
    }
    const data = await res.json();
    const insights = Array.isArray(data.insights) ? data.insights : [];
    if (!insights.length) {
      mount.hidden = true;
      return;
    }
    list.innerHTML = insights.map((ins) => `
      <div class="compare-community__item">
        ${ins.personalLine ? `<p class="compare-community__personal">${escapeHtml(t(ins.personalLine))}</p>` : ""}
        ${ins.communityLine ? `<p class="compare-community__stat">${escapeHtml(t(ins.communityLine))}</p>` : ""}
      </div>
    `).join("");
    mount.hidden = false;
  } catch (_e) {
    mount.hidden = true;
  }
}

function compareStatusIcon(status) {
  return statusEmoji(status);
}

function compareSeasonLabel(seasonId) {
  const s = (typeof SEASONS !== "undefined" && SEASONS[seasonId]) || null;
  if (!s) return seasonId || t("compare.unknownStatus");
  return s.name || t("compare.chapterSeason", { chapter: s.chapter, season: s.season });
}

function compareEventLabel(eventId) {
  const e = (typeof EVENTS !== "undefined" && EVENTS[eventId]) || null;
  if (!e) return eventId || t("compare.noneEvent");
  return e.name || eventId;
}

function compareAvailabilityLabel(status) {
  const map = { available: t("compare.availableNow"), unavailable: t("compare.unavailableStatus"), unknown: t("compare.unknownStatus") };
  return map[(status || "").toLowerCase()] || status || t("compare.unknownStatus");
}

function compareAcquisitionLabel(method) {
  const map = { exploration: t("compare.acqExploration"), shop: t("compare.acqShop"), challenge: t("compare.acqChallenge"), event: t("compare.acqEvent"), unknown: t("compare.unknownStatus") };
  return map[(method || "").toLowerCase()] || method || t("compare.unknownStatus");
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
  state.compareCatalogFilters = state.compareCatalogFilters || createSafeRecord();
  const filters = state.compareCatalogFilters;
  const makeSelect = (key, label, options) => {
    const current = filters[key] || "";
    return `<div class="compare-catalog-filter"><label for="compareFilter-${key}">${escapeHtml(label)}</label><select id="compareFilter-${key}" class="compare-catalog-filter__select" data-filter-key="${key}"><option value="">${t("compare.selectAll")}</option>${options.map(([val, lbl]) => `<option value="${escapeHtml(val)}" ${val === current ? "selected" : ""}>${escapeHtml(lbl)}</option>`).join("")}</select></div>`;
  };

  const seasonOpts = getCompareFilterOptions(records, "seasonId", r => compareSeasonLabel(r.seasonId));
  const eventOpts = getCompareFilterOptions(records, "eventId", r => compareEventLabel(r.eventId));
  const rarityOpts = getCompareFilterOptions(records, "rarity", r => r.rarity || t("compare.unknownStatus"));
  const spriteOpts = getCompareFilterOptions(records, "spriteId", r => r.spriteName);
  const variantOpts = getCompareFilterOptions(records, "variantType", r => compareVariantTypeLabel(r.variantType));
  const availOpts = getCompareFilterOptions(records, "availabilityStatus", r => compareAvailabilityLabel(r.availabilityStatus));
  const acqOpts = getCompareFilterOptions(records, "acquisitionMethod", r => compareAcquisitionLabel(r.acquisitionMethod));

  const hasFilters = Object.keys(filters).some(k => filters[k]);
  return `
    <details class="compare-catalog-filters" ${hasFilters ? "open" : ""}>
      <summary class="compare-catalog-filters__summary">${t("compare.catalogFilters")}</summary>
      <div class="compare-catalog-filters__grid">
        ${makeSelect("season", t("compare.seasonLabel"), seasonOpts)}
        ${makeSelect("event", t("compare.eventLabel"), eventOpts)}
        ${makeSelect("rarity", t("compare.rarityLabel"), rarityOpts)}
        ${makeSelect("sprite", t("compare.spriteLabel"), spriteOpts)}
        ${makeSelect("variantType", t("compare.variantTypeLabel"), variantOpts)}
        ${makeSelect("availability", t("compare.availabilityLabel"), availOpts)}
        ${makeSelect("acquisition", t("compare.acquisitionLabel"), acqOpts)}
      </div>
      <button type="button" class="ghost-button compare-catalog-filters__reset" id="compareFilterReset">${t("compare.resetFilters")}</button>
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
  if (sa === "unknown" || sb === "unknown") return 1;
  if ((sa === "owned" && sb !== "owned") || (sb === "owned" && sa !== "owned")) return 3;
  if (sa !== sb) return 2;
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

function recordMatchesCompareFocus(record, focusIds) {
  if (!focusIds || !focusIds.length) return true;
  const keys = [record.variantId, record.id, ...(record.legacyKeys || [])].filter(Boolean).map(String);
  return focusIds.some((id) => keys.includes(String(id)));
}

function renderCompareTable(result, aName, bName) {
  if (!els.compareTable) return;
  const filter = state.compareFilter || "all";
  const catalogFilters = state.compareCatalogFilters || {};
  const sort = state.compareSort || "alpha";
  let records = getCompareFilterRecords(result, filter);
  records = records.filter(r => matchesCompareCatalogFilters(r, catalogFilters));
  const focusIds = Array.isArray(state.compareFocusVariantIds) ? state.compareFocusVariantIds : null;
  if (focusIds && focusIds.length) {
    const focused = records.filter(r => recordMatchesCompareFocus(r, focusIds));
    if (focused.length) records = focused;
  }
  records = compareSortRecords(records, sort);

  const header = `
    <div class="compare-table__header">
      <span class="compare-table__cell compare-table__cell--variant">${t("compare.variantHeader")}</span>
      <span class="compare-table__cell">${escapeHtml(aName)}</span>
      <span class="compare-table__cell">${escapeHtml(bName)}</span>
      <span class="compare-table__cell compare-table__cell--actions"></span>
    </div>`;

  const rows = records.map(r => {
    const imageUrl = safeImageUrl(r.img);
    const actions = `
      <button type="button" class="compare-action compare-action--detail" data-sprite-id="${escapeHtml(String(r.spriteId || ""))}">${t("compare.detailBtn")}</button>
      ${compareQuickActionsHTML(r.variantId, r.userA.status)}`;
    return `
      <div class="compare-table__row" data-sprite-id="${escapeHtml(String(r.spriteId || ""))}" data-variant-id="${escapeHtml(String(r.variantId || ""))}">
        <span class="compare-table__cell compare-table__cell--variant">
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" class="compare-table__thumb" loading="lazy">` : `<span class="compare-table__thumb" aria-hidden="true"></span>`}
          <span class="compare-table__name">${escapeHtml(r.spriteName)} — ${escapeHtml(r.variantName || "Base")}</span>
        </span>
        <span class="compare-table__cell compare-table__cell--status">${compareStatusIcon(r.userA.status)}<span class="compare-table__status-label">${statusLabel(r.userA.status)}</span></span>
        <span class="compare-table__cell compare-table__cell--status">${compareStatusIcon(r.userB.status)}<span class="compare-table__status-label">${statusLabel(r.userB.status)}</span></span>
        <span class="compare-table__cell compare-table__cell--actions">${actions}</span>
      </div>`;
  }).join("");

  const body = records.length
    ? `<div class="compare-table__body">${rows}</div>`
    : `<div class="compare-table__empty"><p class="compare-empty">${t("compare.emptyVariants")}</p></div>`;

  els.compareTable.innerHTML = `
    <div class="compare-section compare-section--table">
      <h3 class="compare-section__title">${t("compare.visualComparison")}</h3>
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
  const headerImage = safeImageUrl(records[0].img);

  const header = `
    <div class="compare-sprite-header" style="--card-color:${safeCssColor(sprite && sprite.color, '#8d7cff')}">
      ${headerImage ? `<img src="${escapeHtml(headerImage)}" alt="${spriteName}" class="compare-sprite-header__img">` : ""}
      <div class="compare-sprite-header__info">
        <h2>${spriteName}</h2>
        <span class="compare-sprite-completion">${t("compare.spriteCompletion", { name: spriteName, pct: `${pct}%` })}</span>
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
        <span class="compare-sprite-table__cell">${t("compare.variantHeader")}</span>
        <span class="compare-sprite-table__cell">${safeA}</span>
        <span class="compare-sprite-table__cell">${safeB}</span>
        <span class="compare-sprite-table__cell compare-sprite-table__cell--actions">${t("compare.actionHeader")}</span>
      </div>
      <div class="compare-sprite-table__body">${rows}</div>
    </div>`;

  els.compareSpriteDetailContent.innerHTML = `${header}${table}`;
  attachCompareQuickActions(els.compareSpriteDetailContent, true);

  const dialog = document.getElementById("compareSpriteDialog");
  if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  const hasMissing = records.some(r => isCollectibleMissingStatus(r.userA.status) || isCollectibleMissingStatus(r.userB.status));
  logCompareAnalytics("missing_match_opened", { spriteId, hasMissing });
  state.compareSpriteId = spriteId;
}

function compareQuickActionsHTML(variantId, selectedStatus) {
  const options = [
    { value: "", label: t("compare.quickDefault") },
    { value: "owned", label: t("compare.quickOwned") },
    { value: "missing", label: t("compare.quickMissing") },
    { value: "priority", label: t("compare.quickPriority") },
    { value: "spotted", label: t("compare.quickSpotted") }
  ];
  const safeVariantId = escapeHtml(String(variantId || ""));
  const select = `<select class="compare-status-select" data-variant-id="${safeVariantId}">${options.map(o => `<option value="${o.value}" ${selectedStatus === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const noteBtn = `<button type="button" class="compare-action compare-action--note" data-variant-id="${safeVariantId}">${t("compare.noteBtn")}</button>`;
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
      const note = prompt(t("compare.notePrompt"));
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
    const recordKey = String(v ?? "");
    if (!recordKey || !isSafeRecordKey(recordKey)) return acc;
    acc[recordKey] = acc[recordKey] || [];
    acc[recordKey].push(r);
    return acc;
  }, createSafeRecord());
}

function generateCompareRecommendations(result, aName, bName) {
  const safeA = safeText(aName, t("compare.playerA"));
  const safeB = safeText(bName, t("compare.playerB"));
  const recs = [];

  // 1. Priority exchanges
  const aWantsFromB = result.groups.onlyUserB.filter(r => compareIsPriority(r.userA));
  const bWantsFromA = result.groups.onlyUserA.filter(r => compareIsPriority(r.userB));
  if (aWantsFromB.length) {
    recs.push({ type: "priority", title: t("compare.recPriorityTitle", { owner: safeB, count: aWantsFromB.length, target: safeA, s: aWantsFromB.length !== 1 ? "s" : "" }), items: aWantsFromB });
  }
  if (bWantsFromA.length) {
    recs.push({ type: "priority", title: t("compare.recPriorityTitle", { owner: safeA, count: bWantsFromA.length, target: safeB, s: bWantsFromA.length !== 1 ? "s" : "" }), items: bWantsFromA });
  }

  // 2. Unavailable variants owned by one and missing to the other
  const aHasUnavailableBMissing = result.groups.onlyUserA.filter(r => r.availabilityStatus === "unavailable");
  const bHasUnavailableAMissing = result.groups.onlyUserB.filter(r => r.availabilityStatus === "unavailable");
  if (aHasUnavailableBMissing.length) {
    recs.push({ type: "unavailable", title: t("compare.recUnavailableTitle", { owner: safeA, count: aHasUnavailableBMissing.length, other: safeB, s: aHasUnavailableBMissing.length !== 1 ? "s" : "", nt: aHasUnavailableBMissing.length !== 1 ? "nt" : "" }), items: aHasUnavailableBMissing });
  }
  if (bHasUnavailableAMissing.length) {
    recs.push({ type: "unavailable", title: t("compare.recUnavailableTitle", { owner: safeB, count: bHasUnavailableAMissing.length, other: safeA, s: bHasUnavailableAMissing.length !== 1 ? "s" : "", nt: bHasUnavailableAMissing.length !== 1 ? "nt" : "" }), items: bHasUnavailableAMissing });
  }

  // 3. Both missing by rarity
  const rarities = [...new Set(result.groups.bothMissing.map(r => r.rarity).filter(Boolean))];
  for (const rarity of rarities) {
    const items = result.groups.bothMissing.filter(r => r.rarity === rarity);
    if (items.length) {
      recs.push({ type: "bothMissingRarity", title: t("compare.recBothMissingRarity", { count: items.length, rarity, s: items.length !== 1 ? "s" : "" }), items });
    }
  }

  // 4. Sprites whose variants are fully covered together
  const bySprite = groupCompareRecordsBy(result.records, "spriteId");
  for (const records of Object.values(bySprite)) {
    const total = records.length;
    if (total < 2) continue;
    const covered = records.filter(r => isOwnedStatus(r.userA.status) || isOwnedStatus(r.userB.status)).length;
    if (covered === total) {
      const missingA = records.filter(r => isCollectibleMissingStatus(r.userA.status)).length;
      const missingB = records.filter(r => isCollectibleMissingStatus(r.userB.status)).length;
      if (!missingA && !missingB) continue;
      const spriteName = records[0].spriteName;
      let detail = "";
      if (missingA && missingB) detail = t("compare.recDetailBoth", { a: safeA, countA: missingA, b: safeB, countB: missingB });
      else if (missingA) detail = t("compare.recDetailOne", { who: safeA, count: missingA });
      else if (missingB) detail = t("compare.recDetailOne", { who: safeB, count: missingB });
      recs.push({ type: "completeTogether", title: t("compare.recTogetherComplete", { sprite: safeText(spriteName), detail }), items: records.filter(r => isCollectibleMissingStatus(r.userA.status) || isCollectibleMissingStatus(r.userB.status)) });
    }
  }

  // 5. Events with only one variant missing
  const byEvent = groupCompareRecordsBy(result.records.filter(r => r.eventId), "eventId");
  for (const [eventId, records] of Object.entries(byEvent)) {
    const total = records.length;
    if (total < 2) continue;
    const covered = records.filter(r => isOwnedStatus(r.userA.status) || isOwnedStatus(r.userB.status)).length;
    if (total - covered === 1) {
      const missingRecord = records.find(r => isCollectibleMissingStatus(r.userA.status) || isCollectibleMissingStatus(r.userB.status));
      if (missingRecord) {
        recs.push({ type: "eventClose", title: t("compare.recEventClose", { event: safeText(compareEventLabel(eventId)) }), items: [missingRecord] });
      }
    }
  }

  return recs;
}

function renderCompareRecommendations(result, aName, bName) {
  if (!els.compareRecommendations) return;
  const recommendations = generateCompareRecommendations(result, aName, bName);

  let html = `<div class="compare-section compare-section--recommendations"><h3 class="compare-section__title">${t("compare.recommendationsTitle")}</h3><div class="compare-section__body">`;
  if (!recommendations.length) {
    html += `<p class="compare-empty">${t("compare.emptyRecommendations")}</p>`;
  } else {
    for (const rec of recommendations) {
      const list = rec.items.map(r => compareItemHTML(r, `${compareStatusIcon(r.userA.status)} ${compareStatusIcon(r.userB.status)}`)).join("");
      html += `<div class="compare-subsection"><h4 class="compare-subsection__title">${escapeHtml(rec.title)}</h4><div class="compare-list">${list}</div></div>`;
    }
  }
  html += `</div></div>`;
  els.compareRecommendations.innerHTML = html;
}

function renderCompareActions(result) {
  if (!els.compareActions) return;
  const filter = state.compareFilter || "all";
  const options = [
    { value: "all", label: t("compare.filterAll") },
    { value: "differences", label: t("compare.filterDiffs") },
    { value: "missingMatch", label: t("compare.filterMissingMatch") },
    { value: "priorities", label: t("compare.filterPriorities") },
    { value: "bothMissing", label: t("compare.filterBothMissing") },
    { value: "bothOwned", label: t("compare.filterBothOwned") },
    { value: "onlyUserA", label: t("compare.filterOnlyA") },
    { value: "onlyUserB", label: t("compare.filterOnlyB") },
    { value: "unknown", label: t("compare.filterUnknown") }
  ];
  const sortOptions = [
    { value: "alpha", label: t("compare.sortAlpha") },
    { value: "rarity-asc", label: t("compare.sortRarityAsc") },
    { value: "rarity-desc", label: t("compare.sortRarityDesc") },
    { value: "priority", label: t("compare.sortPriority") },
    { value: "availability", label: t("compare.sortAvailability") },
    { value: "release-date", label: t("compare.sortReleaseDate") },
    { value: "biggest-difference", label: t("compare.sortBiggestDiff") }
  ];
  const sort = state.compareSort || "alpha";
  const select = `<select id="compareFilterSelect" class="compare-filter-select" aria-label="${t("compare.filterLabel")}">${options.map(o => `<option value="${o.value}" ${filter === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const sortSelect = `<select id="compareSortSelect" class="compare-filter-select" aria-label="${t("compare.sortLabel")}">${sortOptions.map(o => `<option value="${o.value}" ${sort === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const catalogFilters = renderCompareCatalogFilters(result && result.records);
  els.compareActions.innerHTML = `
    <div class="compare-actions-bar">
      <label for="compareFilterSelect" class="compare-actions-label">${t("compare.filterLabel")}</label>
      ${select}
      <label for="compareSortSelect" class="compare-actions-label">${t("compare.sortLabel")}</label>
      ${sortSelect}
      <button type="button" class="login-btn" id="compareRefreshBtn">${t("compare.refreshBtn")}</button>
      <button type="button" class="ghost-button" id="compareShareActionBtn">${t("compare.shareActionBtn")}</button>
    </div>
    ${catalogFilters}`;

  const filterSelect = $("#compareFilterSelect");
  if (filterSelect) filterSelect.addEventListener("change", (e) => {
    state.compareFilter = e.target.value;
    logCompareAnalytics("comparison_filter_used", { filter: "status", value: e.target.value });
    trackSpriteGraphInteraction("comparison.filter_applied", { surface: "compare", filterKind: "status" });
    renderCompare();
  });

  const sortSelectEl = $("#compareSortSelect");
  if (sortSelectEl) sortSelectEl.addEventListener("change", (e) => {
    state.compareSort = e.target.value;
    logCompareAnalytics("comparison_filter_used", { filter: "sort", value: e.target.value });
    trackSpriteGraphInteraction("comparison.filter_applied", { surface: "compare", filterKind: "sort" });
    renderCompare();
  });

  const refreshBtn = $("#compareRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => {
    state.compareFilter = "all";
    state.compareSort = "alpha";
    state.compareCatalogFilters = createSafeRecord();
    state.compareFocusVariantIds = null;
    renderCompare();
  });

  const shareBtn = $("#compareShareActionBtn");
  if (shareBtn) shareBtn.addEventListener("click", shareCompareLink);

  els.compareActions.querySelectorAll("[data-filter-key]").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const filterKey = e.target.dataset.filterKey;
      const allowedFilterKeys = new Set(["season", "event", "rarity", "sprite", "variantType", "availability", "acquisition"]);
      state.compareCatalogFilters = state.compareCatalogFilters || createSafeRecord();
      if (!allowedFilterKeys.has(filterKey)) return;
      setSafeRecordValue(state.compareCatalogFilters, filterKey, String(e.target.value || "").slice(0, 240));
      logCompareAnalytics("comparison_filter_used", { filter: e.target.dataset.filterKey, value: e.target.value });
      trackSpriteGraphInteraction("comparison.filter_applied", {
        surface: "compare",
        filterKind: filterKey === "variantType" ? "variant_type" : filterKey
      });
      renderCompare();
    });
  });

  const resetBtn = $("#compareFilterReset");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    state.compareCatalogFilters = createSafeRecord();
    trackSpriteGraphInteraction("comparison.filter_applied", { surface: "compare", filterKind: "reset" });
    renderCompare();
  });
}

async function loadCompareSquads() {
  if (!state.compareTarget || !state.compareTarget.userId || !state.userId) {
    state.compareCommonSquads = [];
    renderCompareSquads();
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/squads/common/${encodeURIComponent(state.userId)}/${encodeURIComponent(state.compareTarget.userId)}`, { headers: authHeadersOnly() });
    if (!res.ok) throw new Error("common squads failed");
    const data = await res.json();
    state.compareCommonSquads = data.squads || [];
  } catch (e) {
    console.error("[compare] common squads error", e);
    state.compareCommonSquads = [];
  }
  renderCompareSquads();
}

function handleCompareSquadAction(e) {
  const btn = e.target.closest("[data-squad-action]");
  if (!btn) return;
  const code = decodeURIComponent(btn.dataset.squadCode);
  const action = btn.dataset.squadAction;
  if (!code) return;
  const socialTab = document.querySelector('.tab[data-view="social"]');
  if (socialTab) {
    socialTab.click();
    if (typeof setSocialTab === "function") setSocialTab("squad");
  }
  if (typeof setCompareMode === "function") setCompareMode("squad");
  if (typeof loadSquad === "function") loadSquad(code);
  if (action === "hunt" || action === "session") {
    state.squadView = action;
    document.querySelectorAll(".squad-view-btn").forEach(b => b.classList.remove("active"));
    const activeBtn = document.querySelector(`.squad-view-btn[data-squad-view="${action}"]`);
    if (activeBtn) activeBtn.classList.add("active");
  }
}

function renderCompareSquads() {
  if (!els.compareSquads) return;
  const squads = state.compareCommonSquads;
  if (!squads || squads.length === 0) {
    els.compareSquads.innerHTML = "";
    return;
  }
  const cards = squads.map(s => `
    <div class="compare-squad-card">
      <span class="compare-squad-card__name">${escapeHtml(s.name)}</span>
      <div class="compare-squad-card__actions">
        <button type="button" class="ghost-button" data-squad-code="${encodeURIComponent(s.code)}" data-squad-action="view">${t("compare.viewSquad")}</button>
        <button type="button" class="login-btn" data-squad-code="${encodeURIComponent(s.code)}" data-squad-action="hunt">${t("compare.commonGoal")}</button>
        <button type="button" class="ghost-button" data-squad-code="${encodeURIComponent(s.code)}" data-squad-action="session">${t("compare.recommendationsTitle")}</button>
      </div>
    </div>`).join("");
  els.compareSquads.innerHTML = `
    <div class="compare-section compare-section--squads">
      <h3 class="compare-section__title">${t("compare.commonSquads")}</h3>
      <p class="compare-squads__intro">${t("compare.bothMembers")}</p>
      <div class="compare-squads__list">${cards}</div>
    </div>`;
  els.compareSquads.querySelectorAll("[data-squad-action]").forEach(b => b.addEventListener("click", handleCompareSquadAction));
}

function renderCompare() {
  if (!els.compareResults || !els.compareSummary || !els.compareTable || !els.compareRecommendations || !els.compareActions || !els.compareSquads) return;
  if (!state.compareTarget) {
    els.compareResults.style.display = "none";
    if (els.compareStatus) els.compareStatus.textContent = "";
    return;
  }
  els.compareResults.style.display = "block";
  const pairA = state.compareAsPair?.userA;
  const aName = pairA ? pairA.displayName : (state.username || t("compare.me"));
  const bName = state.compareTarget.username || t("compare.friend");
  if (els.comparePlayerAName) els.comparePlayerAName.textContent = aName;
  if (els.comparePlayerBName) els.comparePlayerBName.textContent = bName;
  const userA = pairA
    ? { id: pairA.id || "userA", displayName: pairA.displayName, collection: pairA.collection }
    : { id: state.userId || "userA", displayName: state.username || t("compare.me"), collection: state.collection };
  const userB = { id: state.compareTarget.userId || state.compareTarget.username || "userB", displayName: state.compareTarget.username || t("compare.friend"), collection: state.compareTarget.collection };
  const result = compareCollections(userA, userB, getCompareCatalogItems());
  state.lastCompareResult = result;
  renderCompareSummary(result, aName, bName);
  loadCompareCommunityContext(result, aName, bName);
  renderCompareSquads();
  renderCompareActions(result);
  renderCompareRecommendations(result, aName, bName);
  renderCompareTable(result, aName, bName);

  connectCompareWs();
  if (state.compareTarget.userId) sendCompareSubscribe(state.compareTarget.userId);
  if (state.compareTarget.userId) loadCompareSquads();
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
    toast(t("compare.invalidToken"));
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/shared/${encodeURIComponent(token)}`, { headers: authHeadersOnly() });
    if (res.status === 403) {
      toast(t("compare.profilePrivate"));
      return;
    }
    if (res.status === 404) {
      toast(t("compare.shareRevoked"));
      return;
    }
    if (!res.ok) throw new Error("shared failed");
    const data = await res.json();
    state.compareToken = token;
    state.compareTarget = {
      userId: data.id,
      username: data.username || t("compare.friend"),
      avatarUrl: data.avatarUrl || "",
      collection: sanitizeCollection(data.collection)
    };
    logCompareAnalytics("comparison_viewed", { source: "shared_profile", targetId: data.id });
    if (els.compareTokenInput) els.compareTokenInput.value = raw;
    const url = new URL(location.href);
    url.searchParams.set("compare", token);
    history.replaceState(null, "", url.toString());
    renderCompare();
    toast(t("compare.loadedWith", { name: state.compareTarget.username }));
  } catch (e) {
    toast(t("compare.loadProfileFailed"));
    console.error("[compare]", e);
  }
}

function setShareResult(url, qrDataUrl = null) {
  const absoluteUrl = safeAppWebUrl(url);
  if (!absoluteUrl) {
    toast(t("compare.shareInvalid"));
    return;
  }
  if (els.shareCompareUrl) {
    els.shareCompareUrl.href = absoluteUrl;
    els.shareCompareUrl.textContent = absoluteUrl;
  }
  if (els.shareCompareQr) {
    const qrImage = safeImageUrl(qrDataUrl);
    els.shareCompareQr.style.display = qrImage ? "block" : "none";
    els.shareCompareQr.src = qrImage;
  }
  if (els.shareCompareCopy) {
    els.shareCompareCopy.onclick = async () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
        toast(t("compare.copied"));
      } else {
        toast(absoluteUrl);
      }
    };
  }
  if (els.shareCompareResult) els.shareCompareResult.classList.add("is-visible");
}

function resetShareDialog() {
  if (els.shareCompareResult) els.shareCompareResult.classList.remove("is-visible");
  if (els.shareCompareUrl) els.shareCompareUrl.href = "#";
  if (els.shareCompareUrl) els.shareCompareUrl.textContent = "";
  if (els.shareCompareQr) els.shareCompareQr.style.display = "none";
}

async function openShareDialog(context) {
  if (!state.userId) {
    toast(t("compare.loginForShare"));
    return;
  }
  if (!els.shareCompareDialog || typeof els.shareCompareDialog.showModal !== "function") return;
  resetShareDialog();

  const isSquad = context === "squad";
  if (els.shareCompareTitle) {
    els.shareCompareTitle.textContent = isSquad ? t("compare.shareSquadTitle") : t("compare.shareTitle");
  }
  if (els.shareCompareIntro) {
    els.shareCompareIntro.textContent = isSquad
      ? t("compare.shareSquadIntro")
      : t("compare.shareCompareIntro");
  }
  if (els.shareCompareOptions) {
    els.shareCompareOptions.style.display = isSquad ? "none" : "";
  }
  if (els.shareCompareGenerate) {
    els.shareCompareGenerate.style.display = isSquad ? "none" : "";
    els.shareCompareGenerate.textContent = isSquad ? "" : t("compare.generateBtn");
  }

  els.shareCompareDialog.showModal();

  if (isSquad) {
    const code = state.activeSquad;
    if (!code) return;
    try {
      const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/qr`, { headers: authHeadersOnly() });
      if (!res.ok) throw new Error("squad qr failed");
      const data = await res.json();
      setShareResult(data.url, data.qr);
    } catch (e) {
      console.error("[squad share]", e);
      toast(t("compare.squadLinkFailed"));
    }
  }
}

async function shareCompareLink() {
  openShareDialog("compare");
}

async function createCompareShare() {
  if (!state.userId) {
    toast(t("compare.loginForShare"));
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
    setShareResult(data.url, data.qr);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(data.url);
      toast(t("compare.copied"));
    } else {
      toast(data.url);
    }
  } catch (e) {
    toast(t("common.networkError"));
    console.error("[compare share]", e);
  }
}

async function loadCompareShare(token) {
  try {
    const res = await fetch(`${API_BASE}/compare/share/${encodeURIComponent(token)}`, { headers: authHeadersOnly() });
    if (res.status === 403) {
      toast(t("compare.profilePrivate"));
      return;
    }
    if (res.status === 404) {
      toast(t("compare.shareExpiredRevoked"));
      return;
    }
    if (!res.ok) throw new Error("compare share failed");
    const data = await res.json();
    state.compareToken = token;
    state.compareShareOptions = data.options;

    const owner = data.result?.users?.userA;
    const ownerCollection = createSafeRecord();
    for (const r of (data.result?.records || [])) {
      setSafeRecordValue(ownerCollection, r.variantId, sanitizeCollectionEntry(r.userA));
    }

    state.compareTarget = {
      userId: owner?.id,
      username: owner?.displayName || t("compare.friend"),
      collection: ownerCollection
    };

    if (els.compareTokenInput) els.compareTokenInput.value = token;
    logCompareAnalytics("app_returned_from_compare", { source: "share_link", targetId: state.compareTarget.userId });
    renderCompare();
    switchToCompareView();
    toast(t("compare.loadedWith", { name: state.compareTarget.username }));
  } catch (e) {
    toast(t("compare.loadShareFailed"));
    console.error("[compare share load]", e);
  }
}

function setCompareMode(mode) {
  state.compareMode = mode === "squad" ? "squad" : "friend";
  if (state.compareMode === "squad") {
    if (typeof setSocialTab === "function") setSocialTab("squad");
    if (state.activeSquad && typeof loadSquad === "function") {
      loadSquad(state.activeSquad);
      if (typeof startSquadPolling === "function") startSquadPolling();
    }
  } else {
    if (typeof setSocialTab === "function") setSocialTab("compare");
    renderCompare();
    if (typeof stopSquadPolling === "function") stopSquadPolling();
  }
}

function switchToCompareView() {
  const socialTab = document.querySelector('.tab[data-view="social"]');
  if (socialTab) socialTab.click();
  if (typeof setSocialTab === "function") setSocialTab("compare");
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

async function compareWithUser(identifier) {
  if (!state.userId) { toast(t("squad.loginFirst")); return; }
  if (!identifier) return;
  const self = state.username || state.userId;
  const target = identifier;
  try {
    const url = self
      ? `${API_BASE}/compare/${encodeURIComponent(self)}/${encodeURIComponent(target)}`
      : `${API_BASE}/compare/${encodeURIComponent(target)}`;
    const res = await fetch(url, { headers: authHeadersOnly() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toastError(data, "compare.failed");
      return;
    }
    const result = await res.json();

    const targetId = result.users?.userB?.id;
    const targetName = result.users?.userB?.displayName || target;
    const targetCollection = createSafeRecord();
    for (const rec of result.records || []) {
      const entry = rec.userB || {};
      setSafeRecordValue(targetCollection, rec.variantId, sanitizeCollectionEntry({
        status: entry.status || "new",
        priority: entry.priority || "none",
        note: entry.note || "",
        obtainedAt: entry.obtainedAt || null
      }));
    }

    state.compareTarget = {
      userId: targetId ? Number(targetId) : null,
      username: targetName,
      collection: targetCollection
    };
    if (self && typeof history !== "undefined") {
      history.replaceState(null, "", `/compare/${encodeURIComponent(self)}/${encodeURIComponent(target)}`);
    }
    renderCompare();
    switchToCompareView();
  } catch (e) {
    console.error("[compare] compare with user", e);
    toast(t("compare.error"));
  }
}

async function comparePair(userAId, userAName, userBId, userBName) {
  if (!userAId || !userBId) return;
  try {
    const res = await fetch(`${API_BASE}/comparisons/users/${encodeURIComponent(userAId)}/${encodeURIComponent(userBId)}?source=squad`, { headers: authHeadersOnly() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toastError(data, "compare.pairFailed");
      return;
    }
    const result = await res.json();
    const collectionA = createSafeRecord();
    const collectionB = createSafeRecord();
    for (const rec of result.records || []) {
      const a = rec.userA || {};
      const b = rec.userB || {};
      const entryA = sanitizeCollectionEntry({ status: a.status || "new", priority: a.priority || "none", note: a.note || "", obtainedAt: null });
      const entryB = sanitizeCollectionEntry({ status: b.status || "new", priority: b.priority || "none", note: b.note || "", obtainedAt: null });
      setSafeRecordValue(collectionA, rec.variantId, entryA);
      if (rec.id && rec.id !== rec.variantId) setSafeRecordValue(collectionA, rec.id, entryA);
      setSafeRecordValue(collectionB, rec.variantId, entryB);
      if (rec.id && rec.id !== rec.variantId) setSafeRecordValue(collectionB, rec.id, entryB);
    }

    state.compareAsPair = { userA: { id: Number(userAId), displayName: userAName || t("compare.playerA"), collection: collectionA } };
    state.compareTarget = { userId: Number(userBId), username: userBName || t("compare.playerB"), collection: collectionB };
    renderCompare();
    switchToCompareView();
  } catch (e) {
    console.error("[compare] comparePair", e);
    toast(t("compare.error"));
  }
}

async function handleCompareUserParams() {
  const pathMatch = location.pathname.match(/^\/compare\/(?!share\/)([^/]+)\/([^/]+)\/?$/);
  if (!pathMatch) return false;
  const [, userA, userB] = pathMatch;
  const res = await fetch(`${API_BASE}/compare/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}`, { headers: authHeadersOnly() });
  if (!res.ok) {
    if (res.status === 401) toast(t("compare.loginToView"));
    else toast(t("compare.loadFailed"));
    return false;
  }
  const result = await res.json();
  const target = String(userA) === String(state.username || state.userId) ? userB : userA;
  const targetId = result.users?.userB?.id;
  const targetName = result.users?.userB?.displayName || target;
  const targetCollection = createSafeRecord();
  for (const rec of result.records || []) {
    const entry = rec.userB || {};
    setSafeRecordValue(targetCollection, rec.variantId, sanitizeCollectionEntry({
      status: entry.status || "new",
      priority: entry.priority || "none",
      note: entry.note || "",
      obtainedAt: entry.obtainedAt || null
    }));
  }
  state.compareTarget = {
    userId: targetId ? Number(targetId) : null,
    username: targetName,
    collection: targetCollection
  };
  renderCompare();
  switchToCompareView();
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
    if (isTarget) state.compareTarget.collection = createSafeRecord();
    if (isSelf) state.collection = createSafeRecord();
  } else if (msg.type === "compare_update" && Array.isArray(msg.changes)) {
    for (const ch of msg.changes) {
      const entry = sanitizeCollectionEntry({
        status: ch.status || "new",
        priority: ch.priority || "none",
        note: ch.note || "",
        obtainedAt: ch.obtainedAt || null
      });
      if (isTarget) setSafeRecordValue(state.compareTarget.collection, ch.variantId, entry);
      if (isSelf) setSafeRecordValue(state.collection, ch.variantId, entry);
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
  const spriteName = catalog?.spriteName || change.spriteId || t("compare.aSprite");
  const variantName = catalog?.variantName || "";
  const displayName = state.compareTarget?.username || t("compare.yourFriend");
  const action = (change.status === "owned") ? t("compare.actionObtained") : t("compare.actionUpdated");
  const label = variantName && variantName !== "Base" ? `${spriteName} (${variantName})` : spriteName;
  toast(t("compare.actionToast", { name: displayName, action, label }));
}

function setupCompareEvents() {
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
