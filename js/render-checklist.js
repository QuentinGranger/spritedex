function getVariantList(sprite) {
  // The checklist is an ownership view: its progress, filters and quick
  // actions must only expose the released catalogue used everywhere else.
  return getSpriteCollectionItems(sprite.id).map((item) => item.variantType);
}

function buildFilterChips() {
  const bar = els.filterChipsBar;
  if (!bar || bar.dataset.built) return;
  bar.dataset.built = "true";

  // Rarity chips (from RARITY_ORDER config)
  Object.keys(RARITY_ORDER)
    .sort((a, b) => RARITY_ORDER[a] - RARITY_ORDER[b])
    .forEach(rarity => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.dataset.filter = `rarity:${rarity}`;
      btn.textContent = localizedRarity(rarity);
      btn.setAttribute("aria-pressed", "false");
      bar.appendChild(btn);
    });

  // Variant chips (from VARIANT_META loaded via API)
  Object.keys(VARIANT_META).sort().forEach(variant => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.dataset.filter = `variant:${variant}`;
      btn.textContent = VARIANT_META[variant].label || variant;
      btn.setAttribute("aria-pressed", "false");
      bar.appendChild(btn);
  });

  // Priority chips (from PRIORITIES config)
  PRIORITIES.filter(p => p.id !== "none" && p.id !== "ignored").forEach(p => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.dataset.filter = `prio:${p.id}`;
      btn.textContent = p.label;
      btn.setAttribute("aria-pressed", "false");
      bar.appendChild(btn);
  });
}

function updateChecklistFilterControls() {
  if (!els.filterChipsBar) return;
  const hasPassportFocus = Array.isArray(state.passportMissingVariantIds) && state.passportMissingVariantIds.length > 0;
  els.filterChipsBar.querySelectorAll(".filter-chip").forEach((chip) => {
    const isActive = !hasPassportFocus && chip.dataset.filter === state.checklistFilter;
    chip.classList.toggle("active", isActive);
    chip.setAttribute("aria-pressed", String(isActive));
  });
}

function announceChecklistResults(filtered) {
  const status = document.getElementById("checklistResultsStatus");
  if (!status) return;
  const count = filtered.length;
  const plural = count > 1 ? "s" : "";
  const hasPassportFocus = Array.isArray(state.passportMissingVariantIds) && state.passportMissingVariantIds.length > 0;
  const activeChip = els.filterChipsBar?.querySelector(".filter-chip.active");
  const context = hasPassportFocus
    ? t("checklist.contextPassport")
    : activeChip && activeChip.dataset.filter !== "all"
      ? t("checklist.contextFilter", { filter: activeChip.textContent.trim() })
      : t("checklist.contextAll");
  status.textContent = t("checklist.results", { count, plural, context });
}

function focusChecklistSprite(spriteId) {
  requestAnimationFrame(() => {
    const header = Array.from(els.checklistList?.querySelectorAll("[data-toggle]") || [])
      .find((element) => element.dataset.toggle === String(spriteId));
    header?.focus();
  });
}

function spriteMatchesFilter(sprite) {
  const filter = state.checklistFilter;
  const query = state.checklistSearch.trim().toLowerCase();

  if (state.commandSeasonId && String(sprite.season?.id || "") !== String(state.commandSeasonId)) return false;

  if (query) {
    const nameMatch = sprite.name.toLowerCase().includes(query);
    const rarityMatch = sprite.rarity.toLowerCase().includes(query);
    const variantMatch = getVariantList(sprite).some(v => v.toLowerCase().includes(query));
    const effectMatch = sprite.effect?.toLowerCase().includes(query);
    if (!nameMatch && !rarityMatch && !variantMatch && !effectMatch) return false;
  }

  if (filter === "all") {
    state.passportMissingVariantIds = null;
    return true;
  }

  // Étape 62 — open checklist focused on event missing variants.
  if (Array.isArray(state.passportMissingVariantIds) && state.passportMissingVariantIds.length) {
    const missing = new Set(state.passportMissingVariantIds.map(String));
    return getVariantList(sprite).some((v) => missing.has(String(variantId(sprite.id, v))));
  }

  if (filter.startsWith("rarity:")) return sprite.rarity === filter.split(":")[1];
  if (filter.startsWith("variant:")) return getVariantList(sprite).includes(filter.split(":")[1]);

  if (filter.startsWith("prio:")) {
    const prio = filter.split(":")[1];
    return getVariantList(sprite).some(v => {
      const entry = getEntry(variantId(sprite.id, v));
      return entry.priority === prio;
    });
  }

  if (filter === "complete") {
    return getVariantList(sprite).every(v => getEntry(variantId(sprite.id, v)).status === "owned");
  }
  if (filter === "incomplete") {
    return !getVariantList(sprite).every(v => getEntry(variantId(sprite.id, v)).status === "owned");
  }

  return getVariantList(sprite).some(v => {
    const entry = getEntry(variantId(sprite.id, v));
    return entry.status === filter;
  });
}

function sortSprites(sprites) {
  const sort = state.checklistSort;
  return [...sprites].sort((a, b) => {
    switch (sort) {
      case "alpha":
        return a.name.localeCompare(b.name, uiLocale());
      case "progress-asc": {
        const pA = getVariantList(a).filter(v => getEntry(variantId(a.id, v)).status === "owned").length / (getVariantList(a).length || 1);
        const pB = getVariantList(b).filter(v => getEntry(variantId(b.id, v)).status === "owned").length / (getVariantList(b).length || 1);
        return pA - pB;
      }
      case "progress-desc": {
        const pA = getVariantList(a).filter(v => getEntry(variantId(a.id, v)).status === "owned").length / (getVariantList(a).length || 1);
        const pB = getVariantList(b).filter(v => getEntry(variantId(b.id, v)).status === "owned").length / (getVariantList(b).length || 1);
        return pB - pA;
      }
      case "rarity-desc":
        return (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9);
      case "rarity-asc":
        return (RARITY_ORDER[b.rarity] ?? 9) - (RARITY_ORDER[a.rarity] ?? 9);
      case "priority": {
        const bestPrio = s => Math.min(...getVariantList(s).map(v => priorityOrder(getEntry(variantId(s.id, v)).priority || "none")));
        return bestPrio(a) - bestPrio(b);
      }
      case "recent": {
        const latest = s => Math.max(...getVariantList(s).map(v => {
          const d = getEntry(variantId(s.id, v)).updatedAt;
          return d ? new Date(d).getTime() : 0;
        }));
        return latest(b) - latest(a);
      }
      default:
        return 0;
    }
  });
}

function renderChecklist() {
  buildFilterChips();
  const filtered = sortSprites(SPRITES.filter((sprite) => getVariantList(sprite).length > 0 && spriteMatchesFilter(sprite)));
  updateChecklistFilterControls();
  announceChecklistResults(filtered);
  if (!filtered.length) {
    els.checklistList.innerHTML = `<p class="empty-state">${escapeHtml(t("checklist.empty"))}</p>`;
    return;
  }

  els.checklistList.innerHTML = filtered.map(sprite => {
    const variants = getVariantList(sprite).map(v => ({
      id: variantId(sprite.id, v),
      name: v,
      entry: getEntry(variantId(sprite.id, v)),
      img: getSpriteImg(sprite.id, v)
    }));
    const owned = variants.filter(v => v.entry.status === "owned").length;
    const total = variants.length;
    const pct = collectionPercent(owned, total);
    const isExpanded = state.expandedSprite === sprite.id;
    const baseImg = safeImageUrl(getSpriteImg(sprite.id, "Base"));
    const priorityVariant = variants.find((variant) => {
      const priority = variant.entry.priority || "none";
      return variant.entry.status === "priority" || (priority !== "none" && priority !== "ignored");
    });
    const quickVariant = variants.find((variant) => variant.entry.status !== "owned");
    const highestMastery = Math.max(0, ...variants.map((variant) => masteryLevelFor(variant.entry)));

    let variantFilter = null;
    if (state.checklistFilter.startsWith("variant:")) {
      variantFilter = state.checklistFilter.split(":")[1];
    }
    const displayedVariants = variantFilter
      ? variants.filter(v => v.name === variantFilter)
      : variants;

    return `
      <article class="cl-sprite ${isExpanded ? "cl-sprite--open" : ""}" style="--card-color:${safeCssColor(sprite.color)}" data-sprite-id="${escapeHtml(String(sprite.id || ""))}" data-rarity="${escapeHtml(sprite.rarity)}" aria-labelledby="checklist-sprite-${escapeHtml(String(sprite.id || ""))}">
        <div class="cl-sprite__header" data-toggle="${escapeHtml(String(sprite.id || ""))}" role="button" tabindex="0" aria-expanded="${isExpanded ? "true" : "false"}" aria-controls="checklist-sprite-body-${escapeHtml(String(sprite.id || ""))}" aria-label="${escapeHtml(t(isExpanded ? "checklist.collapseSprite" : "checklist.expandSprite", { name: sprite.name }))}">
          <div class="cl-sprite__avatar">${baseImg ? `<img src="${escapeHtml(baseImg)}" alt="${escapeHtml(sprite.name)}" class="cl-sprite__img" />` : `<span class="avatar-placeholder">?</span>`}</div>
          <div class="cl-sprite__info">
            <h3 class="cl-sprite__name" id="checklist-sprite-${escapeHtml(String(sprite.id || ""))}">${escapeHtml(sprite.name)}</h3>
            <p class="cl-sprite__meta"><span class="cl-sprite__rarity" data-rarity="${escapeHtml(sprite.rarity)}">${escapeHtml(localizedRarity(sprite.rarity))}</span>${priorityVariant ? `<span class="cl-sprite__priority">${escapeHtml(t("checklist.priorityBadge"))}</span>` : ""}${highestMastery === 5 ? `<span class="cl-sprite__master">${escapeHtml(t("checklist.masterBadge"))}</span>` : ""}</p>
            <p class="cl-sprite__effect">${escapeHtml(sprite.effect || t("checklist.noEffect"))}</p>
          </div>
          <div class="cl-sprite__progress">
            <span><strong>${escapeHtml(t("checklist.variantsCount", { owned, total }))}</strong></span>
            <div class="cl-sprite__bar"><div class="cl-sprite__bar-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="cl-sprite__inline-actions" role="group" aria-label="${escapeHtml(t("checklist.quickActions", { name: sprite.name }))}">
          <button type="button" class="cl-sprite__detail" data-sprite-detail="${escapeHtml(String(sprite.id || ""))}" title="${escapeHtml(t("checklist.openDetail"))}" aria-label="${escapeHtml(t("checklist.openDetail"))}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          ${quickVariant ? `<button type="button" class="cl-sprite__quick cl-sprite__quick--priority ${priorityVariant ? "is-active" : ""}" data-quick-status="priority" data-id="${escapeHtml(String(quickVariant.id || ""))}" title="${escapeHtml(t("checklist.quickPriority"))}" aria-label="${escapeHtml(t("checklist.quickPriority"))}"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3"/></svg></button>` : ""}
          ${quickVariant ? `<button type="button" class="cl-sprite__quick cl-sprite__quick--owned ${owned === total && total ? "is-active" : ""}" data-quick-status="owned" data-id="${escapeHtml(String(quickVariant.id || ""))}" title="${escapeHtml(t("checklist.quickOwned"))}" aria-label="${escapeHtml(t("checklist.quickOwned"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>` : ""}
          <svg class="cl-sprite__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        ${isExpanded ? `
        <div class="cl-sprite__body" id="checklist-sprite-body-${escapeHtml(String(sprite.id || ""))}" role="region" aria-label="${escapeHtml(t("checklist.variantsOf", { name: sprite.name }))}">
          ${displayedVariants.map(v => {
            const vPrio = v.entry.priority || "none";
            const masteryLevel = masteryLevelFor(v.entry);
            const masteryControls = masteryLevel > 0
              ? `<div class="cl-variant__mastery ${masteryLevel === 5 ? "cl-variant__mastery--master" : ""}" aria-label="${escapeHtml(masteryLabel(masteryLevel))}">
                  <span class="cl-variant__mastery-label">${escapeHtml(masteryLevel === 5 ? t("checklist.masteryMaster") : t("checklist.masteryLevel", { level: masteryLevel }))}</span>
                  <div class="cl-variant__mastery-levels" role="group" aria-label="${escapeHtml(t("checklist.masteryOf", { name: v.name }))}">
                    ${Array.from({ length: 5 }, (_, index) => {
                      const level = index + 1;
                      const levelTitle = level === 5 ? t("mastery.masterTitle") : t("mastery.level", { level });
                      return `<button type="button" class="cl-mastery-btn ${level <= masteryLevel ? "is-active" : ""} ${level === 5 ? "is-master" : ""}" data-id="${escapeHtml(String(v.id || ""))}" data-mastery-level="${level}" title="${escapeHtml(levelTitle)}" aria-label="${escapeHtml(levelTitle)}" aria-pressed="${level === masteryLevel}">${level === 5 ? "♛" : level}</button>`;
                    }).join("")}
                  </div>
                </div>`
              : "";
            const vPrioBadge = vPrio !== "none" && vPrio !== "ignored"
              ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(vPrio)}">${priorityLabel(vPrio)}</span>`
              : "";
            return `
            <div class="cl-variant" data-variant-id="${escapeHtml(String(v.id || ""))}">
              <div class="cl-variant__left">
                <div class="cl-variant__thumb">${v.img ? `<img src="${escapeHtml(safeImageUrl(v.img))}" alt="${escapeHtml(`${sprite.name} — ${v.name}`)}" class="cl-variant__img" />` : `<span aria-hidden="true">?</span>`}</div>
                <span class="cl-variant__name">${escapeHtml(v.name)} ${vPrioBadge}</span>
              </div>
              <div class="cl-variant__status">${statusEmoji(v.entry.status)} <span>${statusLabel(v.entry.status)}</span></div>
              ${masteryControls}
              <div class="cl-variant__actions" role="group" aria-label="${escapeHtml(t("checklist.statusOf", { name: `${sprite.name} — ${v.name}` }))}">
                <button type="button" class="cl-btn cl-btn--owned ${v.entry.status === "owned" ? "active" : ""}" data-id="${escapeHtml(String(v.id || ""))}" data-status="owned" title="${escapeHtml(t("status.owned"))}" aria-label="${escapeHtml(t("checklist.markOwned", { name: v.name }))}" aria-pressed="${v.entry.status === "owned"}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <button type="button" class="cl-btn cl-btn--missing ${v.entry.status === "missing" ? "active" : ""}" data-id="${escapeHtml(String(v.id || ""))}" data-status="missing" title="${escapeHtml(t("status.missing"))}" aria-label="${escapeHtml(t("checklist.markMissing", { name: v.name }))}" aria-pressed="${v.entry.status === "missing"}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <button type="button" class="cl-btn cl-btn--priority ${v.entry.status === "priority" ? "active" : ""}" data-id="${escapeHtml(String(v.id || ""))}" data-status="priority" title="${escapeHtml(t("status.priority"))}" aria-label="${escapeHtml(t("checklist.markPriority", { name: v.name }))}" aria-pressed="${v.entry.status === "priority"}">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </button>
                <button type="button" class="cl-btn cl-btn--unsure ${v.entry.status === "unsure" ? "active" : ""}" data-id="${escapeHtml(String(v.id || ""))}" data-status="unsure" title="${escapeHtml(t("status.unsure"))}" aria-label="${escapeHtml(t("checklist.markUnsure", { name: v.name }))}" aria-pressed="${v.entry.status === "unsure"}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>
                </button>
              </div>
            </div>
          `}).join("")}
        </div>
        ` : ""}
      </article>
    `;
  }).join("");
}
