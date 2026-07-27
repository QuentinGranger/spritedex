function itemMatchesMissingEventFilter(item, filter) {
  if (!filter) return true;
  if (Array.isArray(filter.variantIds) && filter.variantIds.length) {
    const id = String(item.id || item.variantId || "");
    if (filter.variantIds.map(String).includes(id)) return true;
  }
  if (filter.eventId) {
    const sprite = SPRITES.find(s => s.id === item.spriteId);
    return !!(sprite && String(sprite.eventId) === String(filter.eventId));
  }
  return true;
}

function missingPriorityValue(entry) {
  if (entry.priority && entry.priority !== "none" && entry.priority !== "ignored") return entry.priority;
  // A status selected from Swipe has no granular priority yet. Keep it visible
  // in the farm plan, with a sensible neutral default.
  return entry.status === "priority" ? "medium" : "none";
}

function isMissingPriority(entry) {
  return missingPriorityValue(entry) !== "none";
}

function sortMissingItems(items) {
  const rarityOrder = { mythic: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5, base: 6 };
  const sort = state.missingSort || "priority";
  return [...items].sort((a, b) => {
    if (sort === "priority") {
      const byPriority = priorityOrder(missingPriorityValue(getEntry(a.id))) - priorityOrder(missingPriorityValue(getEntry(b.id)));
      if (byPriority) return byPriority;
    } else if (sort === "rarity") {
      const byRarity = (rarityOrder[String(a.rarity || "").toLowerCase()] ?? 99) - (rarityOrder[String(b.rarity || "").toLowerCase()] ?? 99);
      if (byRarity) return byRarity;
    } else if (sort === "variant") {
      const byVariant = String(a.variant || "").localeCompare(String(b.variant || ""), "fr");
      if (byVariant) return byVariant;
    }
    return String(a.spriteName || "").localeCompare(String(b.spriteName || ""), "fr");
  });
}

function getVisibleMissingItems() {
  const eventFilter = state.missingEventFilter;
  const query = String(state.missingSearch || "").trim().toLocaleLowerCase("fr");
  const filter = state.missingFilter || "all";
  return sortMissingItems(getAllItems().filter((item) => {
    const entry = getEntry(item.id);
    if (!isCollectibleMissingStatus(entry.status)) return false;
    if (eventFilter && (!isMissingPriority(entry) || !itemMatchesMissingEventFilter(item, eventFilter))) return false;
    if (filter === "priority" && !isMissingPriority(entry)) return false;
    if (filter === "spotted" && entry.status !== "spotted") return false;
    if (filter === "missing" && entry.status !== "missing") return false;
    if (!query) return true;
    return [item.spriteName, item.variant, item.rarity, item.effect].some(value => String(value || "").toLocaleLowerCase("fr").includes(query));
  }));
}

function renderMissing() {
  const allItems = getAllItems();
  const eventFilter = state.missingEventFilter;
  const allMissing = allItems.filter(item => isCollectibleMissingStatus(getEntry(item.id).status));
  const notOwned = getVisibleMissingItems();
  const hasControls = Boolean(String(state.missingSearch || "").trim()) || state.missingFilter !== "all" || state.missingSort !== "priority";
  const search = document.getElementById("missingSearch");
  const sort = document.getElementById("missingSort");
  const reset = document.getElementById("clearMissingFilters");
  const copy = document.getElementById("copyMissing");
  const status = document.getElementById("missingResultsStatus");

  if (search && search.value !== state.missingSearch) search.value = state.missingSearch;
  if (sort) sort.value = state.missingSort || "priority";
  if (reset) reset.hidden = !hasControls;
  if (copy) copy.disabled = !notOwned.length;
  document.querySelectorAll("[data-missing-filter]").forEach((chip) => {
    const active = chip.dataset.missingFilter === (state.missingFilter || "all");
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
  if (status) {
    const plural = notOwned.length > 1 ? "s" : "";
    const extra = notOwned.length !== allMissing.length
      ? t("missing.resultsExtra", { total: allMissing.length })
      : t("missing.resultsSuffix");
    status.textContent = t("missing.results", { count: notOwned.length, plural, extra });
  }

  if (!notOwned.length) {
    const title = eventFilter
      ? t("missing.emptyEvent")
      : allMissing.length
        ? t("missing.emptyFilters")
        : t("missing.emptyDone");
    els.missingList.innerHTML = `
      <div class="missing-empty" role="status">
        <span class="missing-empty__icon" aria-hidden="true">${allMissing.length ? "⌕" : "✓"}</span>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(allMissing.length ? t("missing.emptyHintFilters") : t("missing.emptyHintDone"))}</p>
        <div class="missing-empty__actions">
          ${eventFilter ? `<button type="button" class="ghost-button" data-missing-action="clear-event">${escapeHtml(t("missing.seeAll"))}</button>` : ""}
          ${hasControls ? `<button type="button" class="ghost-button" data-missing-action="reset">${escapeHtml(t("missing.resetFilters"))}</button>` : ""}
          ${!allMissing.length ? `<button type="button" class="ghost-button" data-missing-action="checklist">${escapeHtml(t("missing.seeChecklist"))}</button>` : ""}
        </div>
      </div>`;
    return;
  }

  const withPrio = notOwned.filter(item => isMissingPriority(getEntry(item.id)));
  const urgent = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "urgent");
  const important = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "important");
  const mediumPrio = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "medium");
  const lowPrio = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "low");
  const spotted = notOwned.filter(item => getEntry(item.id).status === "spotted" && !isMissingPriority(getEntry(item.id)));
  const prioritizedIds = new Set([...withPrio, ...spotted].map(i => i.id));
  const variantGroups = createSafeRecord();
  for (const item of notOwned.filter(item => !prioritizedIds.has(item.id))) {
    (variantGroups[item.variant] ||= []).push(item);
  }

  const total = allItems.length;
  const owned = allItems.filter(item => getEntry(item.id).status === "owned").length;
  const eventName = eventFilter && eventFilter.eventId && typeof EVENTS !== "undefined" ? (EVENTS[eventFilter.eventId]?.name || eventFilter.eventId) : null;
  const pct = total ? Math.round((owned / total) * 100) : 0;
  let html = eventFilter ? `<div class="farm-event-filter" id="missingEventFilterBanner"><div class="farm-event-filter__text">${escapeHtml(t("missing.eventBanner"))}${eventName ? ` · ${escapeHtml(eventName)}` : escapeHtml(t("missing.eventBannerFor"))}</div><button type="button" class="ghost-button" data-missing-action="clear-event">${escapeHtml(t("missing.showAll"))}</button></div>` : "";
  html += `<div class="farm-summary"><div class="farm-summary__count"><strong>${notOwned.length}</strong> ${escapeHtml(eventFilter ? t("missing.prioritiesToFarm") : t("missing.variantsShown"))}</div><div class="farm-summary__bar" aria-label="${escapeHtml(t("missing.progressAria", { pct }))}"><div class="farm-summary__fill" style="width:${pct}%"></div></div><p class="farm-summary__pct">${escapeHtml(t("missing.progressText", { owned, total, pct }))}${notOwned.length !== allMissing.length ? escapeHtml(t("missing.progressTotal", { total: allMissing.length })) : ""}</p></div>`;

  [[t("missing.section.urgent"), "urgent", urgent], [t("missing.section.important"), "important", important], [t("missing.section.medium"), "medium", mediumPrio], [t("missing.section.low"), "low", lowPrio], [t("missing.section.spotted"), "spotted", spotted]].forEach(([title, type, items]) => { if (items.length) html += renderMissingSection(title, type, items); });
  Object.keys(VARIANT_META).forEach((name) => { if (variantGroups[name]?.length) { html += renderMissingSection(t("missing.section.variants", { name: VARIANT_META[name]?.label || name }), name.toLowerCase(), variantGroups[name]); delete variantGroups[name]; } });
  Object.entries(variantGroups).forEach(([name, items]) => { if (items.length) html += renderMissingSection(t("missing.section.variants", { name }), "other", items); });
  els.missingList.innerHTML = html;
}

function renderMissingSection(title, type, items) {
  const safeType = /^[a-z0-9_-]{1,40}$/i.test(type) ? type : "other";
  const sectionId = `missing-section-${safeType}`;
  const collapsed = Boolean(state.missingCollapsedSections[sectionId]);
  return `<section class="farm-section farm-section--${safeType}"><h3 class="farm-section__title"><button type="button" class="farm-section__toggle" data-missing-section="${safeType}" aria-expanded="${!collapsed}" aria-controls="${sectionId}">${escapeHtml(title)} <span class="farm-section__count">${items.length}</span><span class="sr-only">${escapeHtml(collapsed ? t("missing.expandSection") : t("missing.collapseSection"))}</span></button></h3><div class="farm-section__list" id="${sectionId}" ${collapsed ? "hidden" : ""}>${items.map(renderMissingItem).join("")}</div></section>`;
}

function renderMissingItem(item) {
  const entry = getEntry(item.id);
  const img = safeImageUrl(item.img);
  const priority = missingPriorityValue(entry);
  const prioBadge = priority !== "none" ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(priority)}">${escapeHtml(priorityLabel(priority))}</span>` : "";
  const label = `${item.spriteName} · ${item.variant}`;
  return `<article class="farm-item" data-id="${escapeHtml(String(item.id || ""))}"><div class="farm-item__avatar">${img ? `<img src="${escapeHtml(img)}" class="farm-item__img" alt="" />` : "<span aria-hidden=\"true\">?</span>"}</div><div class="farm-item__info"><span class="farm-item__name">${escapeHtml(item.spriteName)}</span><span class="farm-item__variant">${escapeHtml(item.variant)} ${prioBadge}</span></div><span class="farm-item__rarity">${escapeHtml(item.rarity)}</span><div class="farm-item__status" aria-label="${escapeHtml(t("status.row", { status: statusLabel(entry.status) }))}">${statusEmoji(entry.status)}</div><div class="farm-item__actions"><button class="farm-item__detail" type="button" data-missing-detail="${escapeHtml(String(item.id || ""))}" aria-label="${escapeHtml(t("missing.viewDetail", { name: label }))}">${escapeHtml(t("common.details"))}</button><button class="farm-item__priority" type="button" data-missing-priority="${escapeHtml(String(item.id || ""))}" aria-pressed="${priority !== "none"}" title="${escapeHtml(priority === "none" ? t("missing.addPriority") : t("missing.removePriority"))}">${priority === "none" ? "☆" : "★"}<span class="sr-only">${escapeHtml(priority === "none" ? t("missing.addPrioritySr", { name: label }) : t("missing.removePrioritySr", { name: label }))}</span></button><button class="farm-item__mark" type="button" data-id="${escapeHtml(String(item.id || ""))}" data-status="owned" title="${escapeHtml(t("missing.markOwned", { name: label }))}" aria-label="${escapeHtml(t("missing.markOwned", { name: label }))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></button></div></article>`;
}

function resetMissingControls() {
  state.missingSearch = "";
  state.missingFilter = "all";
  state.missingSort = "priority";
  renderMissing();
}

function copyCurrentMissingList() {
  const items = getVisibleMissingItems();
  const plural = items.length > 1 ? "s" : "";
  const lines = [t("missing.copyHeader", { count: items.length, plural }), "", ...items.map((item) => `- ${item.spriteName} · ${item.variant}${isMissingPriority(getEntry(item.id)) ? ` (${priorityLabel(missingPriorityValue(getEntry(item.id)))})` : ""}`)];
  if (!navigator.clipboard?.writeText) {
    toast(t("missing.copyUnsupported"));
    return;
  }
  navigator.clipboard.writeText(lines.join("\n")).then(
    () => toast(t("missing.copyOk")),
    () => toast(t("missing.copyUnsupported"))
  );
}
