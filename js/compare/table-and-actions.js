"use strict";

function renderCompareTable(result, aName, bName) {
  if (!els.compareTable) return;
  const filter = state.compareFilter || "all";
  const catalogFilters = state.compareCatalogFilters || {};
  const sort = state.compareSort || "alpha";
  let records = getCompareFilterRecords(result, filter);
  records = getCompareHelpRecords(records, state.compareHelpFilter || "all");
  records = records.filter(r => matchesCompareCatalogFilters(r, catalogFilters));
  const focusIds = Array.isArray(state.compareFocusVariantIds) ? state.compareFocusVariantIds : null;
  if (focusIds && focusIds.length) {
    const focused = records.filter(r => recordMatchesCompareFocus(r, focusIds));
    if (focused.length) records = focused;
  }
  records = compareSortRecords(records, sort);
  if ((state.compareHelpFilter || "all") !== "all" && sort === "alpha") {
    records.sort((a, b) => scoreCompareHelp(b).score - scoreCompareHelp(a).score || String(a.spriteName).localeCompare(String(b.spriteName), uiLocale()));
  }

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

