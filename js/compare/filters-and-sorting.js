"use strict";

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
  const map = {
    available: t("compare.availableNow"),
    unavailable: t("compare.unavailableStatus"),
    unknown: t("compare.unknownStatus")
  };
  return map[(status || "").toLowerCase()] || status || t("compare.unknownStatus");
}

function compareAcquisitionLabel(method) {
  const map = {
    exploration: t("compare.acqExploration"),
    shop: t("compare.acqShop"),
    challenge: t("compare.acqChallenge"),
    event: t("compare.acqEvent"),
    unknown: t("compare.unknownStatus")
  };
  return map[(method || "").toLowerCase()] || method || t("compare.unknownStatus");
}

function compareVariantTypeLabel(type) {
  const m = (typeof VARIANT_META !== "undefined" && VARIANT_META[type]) || null;
  return m ? m.label : type || "Base";
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
  return [...seen.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), uiLocale()));
}

function renderCompareCatalogFilters(records) {
  if (!records) return "";
  state.compareCatalogFilters = state.compareCatalogFilters || createSafeRecord();
  const filters = state.compareCatalogFilters;
  const makeSelect = (key, label, options) => {
    const current = filters[key] || "";
    return `<div class="compare-catalog-filter"><label for="compareFilter-${key}">${escapeHtml(label)}</label><select id="compareFilter-${key}" class="compare-catalog-filter__select" data-filter-key="${key}"><option value="">${t("compare.selectAll")}</option>${options.map(([val, lbl]) => `<option value="${escapeHtml(val)}" ${val === current ? "selected" : ""}>${escapeHtml(lbl)}</option>`).join("")}</select></div>`;
  };

  const seasonOpts = getCompareFilterOptions(records, "seasonId", (r) => compareSeasonLabel(r.seasonId));
  const eventOpts = getCompareFilterOptions(records, "eventId", (r) => compareEventLabel(r.eventId));
  const rarityOpts = getCompareFilterOptions(records, "rarity", (r) =>
    r.rarity ? localizedRarity(r.rarity) : t("compare.unknownStatus")
  );
  const spriteOpts = getCompareFilterOptions(records, "spriteId", (r) => r.spriteName);
  const variantOpts = getCompareFilterOptions(records, "variantType", (r) => compareVariantTypeLabel(r.variantType));
  const availOpts = getCompareFilterOptions(records, "availabilityStatus", (r) =>
    compareAvailabilityLabel(r.availabilityStatus)
  );
  const acqOpts = getCompareFilterOptions(records, "acquisitionMethod", (r) =>
    compareAcquisitionLabel(r.acquisitionMethod)
  );

  const hasFilters = Object.keys(filters).some((k) => filters[k]);
  return `
    <details class="compare-catalog-filters" open>
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
  mythic: 0,
  mythique: 0,
  legendary: 1,
  légendaire: 1,
  epic: 2,
  épique: 2,
  rare: 3,
  common: 4,
  uncommon: 5
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
        const pa = compareIsPriority(a.userA) || compareIsPriority(a.userB) ? 0 : 1;
        const pb = compareIsPriority(b.userA) || compareIsPriority(b.userB) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const pva = Math.min(priorityOrder(a.userA.priority || "none"), priorityOrder(a.userB.priority || "none"));
        const pvb = Math.min(priorityOrder(b.userA.priority || "none"), priorityOrder(b.userB.priority || "none"));
        return pva - pvb;
      });
      break;
    }
    case "availability": {
      const order = { available: 0, unknown: 1, unavailable: 2, "": 3 };
      sorted.sort(
        (a, b) =>
          (order[(a.availabilityStatus || "").toLowerCase()] ?? 3) -
          (order[(b.availabilityStatus || "").toLowerCase()] ?? 3)
      );
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
    return result.records.filter((r) => compareIsPriority(r.userA) || compareIsPriority(r.userB));
  }
  return result.records;
}

function recordMatchesCompareFocus(record, focusIds) {
  if (!focusIds || !focusIds.length) return true;
  const keys = [record.variantId, record.id, ...(record.legacyKeys || [])].filter(Boolean).map(String);
  return focusIds.some((id) => keys.includes(String(id)));
}
