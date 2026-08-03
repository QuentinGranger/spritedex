"use strict";

function generateCompareRecommendations(result, aName, bName) {
  const safeA = safeText(aName, t("compare.playerA"));
  const safeB = safeText(bName, t("compare.playerB"));
  const recs = [];

  // 1. Priority exchanges
  const aWantsFromB = result.groups.onlyUserB.filter((r) => compareIsPriority(r.userA));
  const bWantsFromA = result.groups.onlyUserA.filter((r) => compareIsPriority(r.userB));
  if (aWantsFromB.length) {
    recs.push({
      type: "priority",
      title: t("compare.recPriorityTitle", {
        owner: safeB,
        count: aWantsFromB.length,
        target: safeA,
        s: aWantsFromB.length !== 1 ? "s" : ""
      }),
      items: aWantsFromB
    });
  }
  if (bWantsFromA.length) {
    recs.push({
      type: "priority",
      title: t("compare.recPriorityTitle", {
        owner: safeA,
        count: bWantsFromA.length,
        target: safeB,
        s: bWantsFromA.length !== 1 ? "s" : ""
      }),
      items: bWantsFromA
    });
  }

  // 2. Unavailable variants owned by one and missing to the other
  const aHasUnavailableBMissing = result.groups.onlyUserA.filter((r) => r.availabilityStatus === "unavailable");
  const bHasUnavailableAMissing = result.groups.onlyUserB.filter((r) => r.availabilityStatus === "unavailable");
  if (aHasUnavailableBMissing.length) {
    recs.push({
      type: "unavailable",
      title: t("compare.recUnavailableTitle", {
        owner: safeA,
        count: aHasUnavailableBMissing.length,
        other: safeB,
        s: aHasUnavailableBMissing.length !== 1 ? "s" : "",
        nt: aHasUnavailableBMissing.length !== 1 ? "nt" : ""
      }),
      items: aHasUnavailableBMissing
    });
  }
  if (bHasUnavailableAMissing.length) {
    recs.push({
      type: "unavailable",
      title: t("compare.recUnavailableTitle", {
        owner: safeB,
        count: bHasUnavailableAMissing.length,
        other: safeA,
        s: bHasUnavailableAMissing.length !== 1 ? "s" : "",
        nt: bHasUnavailableAMissing.length !== 1 ? "nt" : ""
      }),
      items: bHasUnavailableAMissing
    });
  }

  // 3. Both missing by rarity
  const rarities = [...new Set(result.groups.bothMissing.map((r) => r.rarity).filter(Boolean))];
  for (const rarity of rarities) {
    const items = result.groups.bothMissing.filter((r) => r.rarity === rarity);
    if (items.length) {
      recs.push({
        type: "bothMissingRarity",
        title: t("compare.recBothMissingRarity", {
          count: items.length,
          rarity: localizedRarity(rarity),
          s: items.length !== 1 ? "s" : ""
        }),
        items
      });
    }
  }

  // 4. Sprites whose variants are fully covered together
  const bySprite = groupCompareRecordsBy(result.records, "spriteId");
  for (const records of Object.values(bySprite)) {
    const total = records.length;
    if (total < 2) continue;
    const covered = records.filter((r) => isOwnedStatus(r.userA.status) || isOwnedStatus(r.userB.status)).length;
    if (covered === total) {
      const missingA = records.filter((r) => isCollectibleMissingStatus(r.userA.status)).length;
      const missingB = records.filter((r) => isCollectibleMissingStatus(r.userB.status)).length;
      if (!missingA && !missingB) continue;
      const spriteName = records[0].spriteName;
      let detail = "";
      if (missingA && missingB)
        detail = t("compare.recDetailBoth", { a: safeA, countA: missingA, b: safeB, countB: missingB });
      else if (missingA) detail = t("compare.recDetailOne", { who: safeA, count: missingA });
      else if (missingB) detail = t("compare.recDetailOne", { who: safeB, count: missingB });
      recs.push({
        type: "completeTogether",
        title: t("compare.recTogetherComplete", { sprite: safeText(spriteName), detail }),
        items: records.filter(
          (r) => isCollectibleMissingStatus(r.userA.status) || isCollectibleMissingStatus(r.userB.status)
        )
      });
    }
  }

  // 5. Events with only one variant missing
  const byEvent = groupCompareRecordsBy(
    result.records.filter((r) => r.eventId),
    "eventId"
  );
  for (const [eventId, records] of Object.entries(byEvent)) {
    const total = records.length;
    if (total < 2) continue;
    const covered = records.filter((r) => isOwnedStatus(r.userA.status) || isOwnedStatus(r.userB.status)).length;
    if (total - covered === 1) {
      const missingRecord = records.find(
        (r) => isCollectibleMissingStatus(r.userA.status) || isCollectibleMissingStatus(r.userB.status)
      );
      if (missingRecord) {
        recs.push({
          type: "eventClose",
          title: t("compare.recEventClose", { event: safeText(compareEventLabel(eventId)) }),
          items: [missingRecord]
        });
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
      const list = rec.items
        .map((r) => compareItemHTML(r, `${compareStatusIcon(r.userA.status)} ${compareStatusIcon(r.userB.status)}`))
        .join("");
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
  const select = `<select id="compareFilterSelect" class="compare-filter-select" aria-label="${t("compare.filterLabel")}">${options.map((o) => `<option value="${o.value}" ${filter === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const sortSelect = `<select id="compareSortSelect" class="compare-filter-select" aria-label="${t("compare.sortLabel")}">${sortOptions.map((o) => `<option value="${o.value}" ${sort === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  const catalogFilters = renderCompareCatalogFilters(result && result.records);
  const helpFilter = state.compareHelpFilter || "all";
  els.compareActions.innerHTML = `
    <div class="compare-quick-filters" role="group" aria-label="${escapeHtml(t("compare.actionFilters"))}">
      <button type="button" class="${helpFilter === "all" ? "active" : ""}" data-compare-help-filter="all">${escapeHtml(t("compare.helpFilterAll"))}</button>
      <button type="button" class="${helpFilter === "aidable" ? "active" : ""}" data-compare-help-filter="aidable">${escapeHtml(t("compare.helpFilterAidable"))}</button>
      <button type="button" class="${filter === "priorities" ? "active" : ""}" data-compare-status-filter="priorities">${escapeHtml(t("compare.filterPriorities"))}</button>
    </div>
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
  if (filterSelect)
    filterSelect.addEventListener("change", (e) => {
      state.compareFilter = e.target.value;
      logCompareAnalytics("comparison_filter_used", { filter: "status", value: e.target.value });
      trackSpriteGraphInteraction("comparison.filter_applied", { surface: "compare", filterKind: "status" });
      renderCompare();
    });

  els.compareActions.querySelectorAll("[data-compare-help-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.compareHelpFilter = button.dataset.compareHelpFilter || "all";
      logCompareAnalytics("comparison_filter_used", { filter: "help", value: state.compareHelpFilter });
      renderCompare();
    });
  });
  els.compareActions.querySelectorAll("[data-compare-status-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.compareFilter = button.dataset.compareStatusFilter || "all";
      renderCompare();
    });
  });

  const sortSelectEl = $("#compareSortSelect");
  if (sortSelectEl)
    sortSelectEl.addEventListener("change", (e) => {
      state.compareSort = e.target.value;
      logCompareAnalytics("comparison_filter_used", { filter: "sort", value: e.target.value });
      trackSpriteGraphInteraction("comparison.filter_applied", { surface: "compare", filterKind: "sort" });
      renderCompare();
    });

  const refreshBtn = $("#compareRefreshBtn");
  if (refreshBtn)
    refreshBtn.addEventListener("click", () => {
      state.compareFilter = "all";
      state.compareHelpFilter = "all";
      state.compareSort = "alpha";
      state.compareCatalogFilters = createSafeRecord();
      state.compareFocusVariantIds = null;
      renderCompare();
    });

  const shareBtn = $("#compareShareActionBtn");
  if (shareBtn) shareBtn.addEventListener("click", shareCompareLink);

  els.compareActions.querySelectorAll("[data-filter-key]").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const filterKey = e.target.dataset.filterKey;
      const allowedFilterKeys = new Set([
        "season",
        "event",
        "rarity",
        "sprite",
        "variantType",
        "availability",
        "acquisition"
      ]);
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
  if (resetBtn)
    resetBtn.addEventListener("click", () => {
      state.compareCatalogFilters = createSafeRecord();
      trackSpriteGraphInteraction("comparison.filter_applied", { surface: "compare", filterKind: "reset" });
      renderCompare();
    });
}
