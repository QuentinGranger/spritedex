const engineFilters = {
  missingAll: false,
  uniqueOwner: false,
  duplicates: false,
  availableNow: false,
  priorities: false,
  rarity: "",
  season: "",
  event: "",
  variantType: ""
};

function getEngineAllVariants() {
  return (squadEngineReport && squadEngineReport.analysis && squadEngineReport.analysis.allVariants) || [];
}

function applyEngineFilters(variants) {
  const f = engineFilters;
  const hasCategory = f.missingAll || f.uniqueOwner || f.duplicates;
  return variants.filter(v => {
    if (hasCategory) {
      const categoryOk = (f.missingAll && v.isMissingAll) || (f.uniqueOwner && v.isUniqueOwner) || (f.duplicates && v.isDuplicate);
      if (!categoryOk) return false;
    }
    if (f.availableNow && !v.isAvailableNow) return false;
    if (f.priorities && !v.isPriority) return false;
    if (f.rarity && v.rarity !== f.rarity) return false;
    if (f.season && v.seasonId !== f.season) return false;
    if (f.event && v.eventId !== f.event) return false;
    if (f.variantType && v.variantType !== f.variantType) return false;
    return true;
  });
}

function engineFilterControl() {
  const all = getEngineAllVariants();
  const defs = getEngineDefinitions();
  const rarityOptions = distinctOptions(all, "rarity", r => r ? `${t("engine.rarity")} ${r}` : t("engine.rarityUnknown"));
  const seasonOptions = distinctOptions(all, "seasonId", id => id ? (SEASONS[id]?.name || id) : t("engine.noSeason"));
  const eventOptions = distinctOptions(all, "eventId", id => id ? (EVENTS[id]?.name || id) : t("engine.noEvent"));
  const typeOptions = distinctOptions(all, "variantType", vt => vt || t("engine.typeUnknown"));
  return `
    <div class="engine-filter-bar" id="squadEngineFilterBar">
      <div class="engine-filter-group">
        <label class="engine-filter-toggle" title="${escapeHtml(defs.missingAll)}"><input type="checkbox" data-engine-filter="missingAll" ${engineFilters.missingAll ? "checked" : ""}> ${t("engine.filterMissingAll")}</label>
        <label class="engine-filter-toggle" title="${escapeHtml(defs.uniqueOwner)}"><input type="checkbox" data-engine-filter="uniqueOwner" ${engineFilters.uniqueOwner ? "checked" : ""}> ${t("engine.filterUniqueOwner")}</label>
        <label class="engine-filter-toggle" title="${escapeHtml(defs.duplicates)}"><input type="checkbox" data-engine-filter="duplicates" ${engineFilters.duplicates ? "checked" : ""}> ${t("engine.filterDuplicates")}</label>
        <label class="engine-filter-toggle" title="${escapeHtml(defs.availableNow)}"><input type="checkbox" data-engine-filter="availableNow" ${engineFilters.availableNow ? "checked" : ""}> ${t("engine.filterAvailableNow")}</label>
        <label class="engine-filter-toggle" title="${escapeHtml(defs.priorities)}"><input type="checkbox" data-engine-filter="priorities" ${engineFilters.priorities ? "checked" : ""}> ${t("engine.filterPriorities")}</label>
      </div>
      <div class="engine-filter-group engine-filter-group--selects">
        <select class="engine-select" data-engine-filter="rarity"><option value="">${t("engine.allRarities")}</option>${rarityOptions}</select>
        <select class="engine-select" data-engine-filter="season"><option value="">${t("engine.allSeasons")}</option>${seasonOptions}</select>
        <select class="engine-select" data-engine-filter="event"><option value="">${t("engine.allEvents")}</option>${eventOptions}</select>
        <select class="engine-select" data-engine-filter="variantType"><option value="">${t("engine.allTypes")}</option>${typeOptions}</select>
      </div>
      <button type="button" class="ghost-button" id="squadEngineResetFilters">${t("engine.reset")}</button>
    </div>
  `;
}

function distinctOptions(arr, key, labelFn) {
  const map = new Map();
  for (const item of arr) {
    const raw = item[key];
    const value = (raw === null || raw === undefined || raw === "") ? "_none" : String(raw);
    if (!map.has(value)) map.set(value, labelFn(raw));
  }
  return Array.from(map.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([value, label]) => `<option value="${escapeHtml(value)}" ${engineFilters[key] === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderEngineFilterResults(filtered) {
  return `
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.filteredResults", { count: filtered.length })}</h4>
      <div class="engine-chip-list">
        ${filtered.slice(0, 60).map(v => `<span class="engine-chip" title="${escapeHtml(v.variantId)}">${escapeHtml(v.spriteName || v.spriteId)} <small>· ${escapeHtml(v.variantName || v.variantId)}</small></span>`).join("")}
        ${filtered.length > 60 ? `<span class="engine-chip">+${filtered.length - 60} ${t("engine.more")}</span>` : ""}
      </div>
    </div>
  `;
}

function renderEngineMissing(r) {
  const m = (r.analysis && r.analysis.missing) || {};
  const variants = m.variants || [];
  const confirmed = variants.filter(v => v.classification === "confirmed_missing");
  const maybe = variants.filter(v => v.classification !== "confirmed_missing");
  const all = getEngineAllVariants();
  const filtered = applyEngineFilters(all);
  return `
    ${engineFilterControl()}
    <div id="squadEngineFilterResults">${renderEngineFilterResults(filtered)}</div>
    <div class="engine-grid engine-grid--4">
      <div class="engine-card">
        <div class="engine-card__value">${confirmed.length}</div>
        <div class="engine-card__label">${t("engine.label.missingAll")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${maybe.length}</div>
        <div class="engine-card__label">${t("engine.label.maybeAbsent")}</div>
      </div>
    </div>
    <div class="engine-columns">
      <div class="engine-column">
        <h4 class="engine-section__title">${t("engine.byRarity")}</h4>
        ${renderGroupList(m.byRarity)}
      </div>
      <div class="engine-column">
        <h4 class="engine-section__title">${t("engine.byEvent")}</h4>
        ${renderGroupList(m.byEvent)}
      </div>
      <div class="engine-column">
        <h4 class="engine-section__title">${t("engine.byAvailability")}</h4>
        ${renderGroupList(m.byAvailability)}
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.missingVariants", { count: variants.length })}</h4>
      <div class="engine-chip-list">
        ${variants.slice(0, 60).map(v => `<span class="engine-chip" title="${escapeHtml(v.display || "")}">${escapeHtml(v.spriteName || v.spriteId)} <small>· ${escapeHtml(v.variantName || v.variantId)}</small></span>`).join("")}
        ${variants.length > 60 ? `<span class="engine-chip">+${variants.length - 60} ${t("engine.more")}</span>` : ""}
      </div>
    </div>
  `;
}

