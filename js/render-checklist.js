function getVariantList(sprite) {
  const keys = Object.keys(sprite.variantDetails || {});
  return keys.length > 0 ? keys : (sprite.variants || ["Base"]);
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
      btn.className = "filter-chip";
      btn.dataset.filter = `rarity:${rarity}`;
      btn.textContent = rarity;
      bar.appendChild(btn);
    });

  // Variant chips (from VARIANT_META loaded via API)
  Object.keys(VARIANT_META).sort().forEach(variant => {
    const btn = document.createElement("button");
    btn.className = "filter-chip";
    btn.dataset.filter = `variant:${variant}`;
    btn.textContent = VARIANT_META[variant].label || variant;
    bar.appendChild(btn);
  });

  // Priority chips (from PRIORITIES config)
  PRIORITIES.filter(p => p.id !== "none" && p.id !== "ignored").forEach(p => {
    const btn = document.createElement("button");
    btn.className = "filter-chip";
    btn.dataset.filter = `prio:${p.id}`;
    btn.textContent = p.label;
    bar.appendChild(btn);
  });
}

function spriteMatchesFilter(sprite) {
  const filter = state.checklistFilter;
  const query = state.checklistSearch.trim().toLowerCase();

  if (query) {
    const nameMatch = sprite.name.toLowerCase().includes(query);
    const rarityMatch = sprite.rarity.toLowerCase().includes(query);
    const variantMatch = getVariantList(sprite).some(v => v.toLowerCase().includes(query));
    const effectMatch = sprite.effect?.toLowerCase().includes(query);
    if (!nameMatch && !rarityMatch && !variantMatch && !effectMatch) return false;
  }

  if (filter === "all") return true;
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
        return a.name.localeCompare(b.name);
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
  const filtered = sortSprites(SPRITES.filter(spriteMatchesFilter));
  if (!filtered.length) {
    els.checklistList.innerHTML = `<p class="empty-state">Aucun résultat avec ce filtre.</p>`;
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
    const pct = total ? Math.round((owned / total) * 100) : 0;
    const isExpanded = state.expandedSprite === sprite.id;
    const baseImg = getSpriteImg(sprite.id, "Base");

    let variantFilter = null;
    if (state.checklistFilter.startsWith("variant:")) {
      variantFilter = state.checklistFilter.split(":")[1];
    }
    const displayedVariants = variantFilter
      ? variants.filter(v => v.name === variantFilter)
      : variants;

    return `
      <article class="cl-sprite ${isExpanded ? "cl-sprite--open" : ""}" style="--card-color:${sprite.color}" data-sprite-id="${sprite.id}" data-rarity="${sprite.rarity}">
        <div class="cl-sprite__header" data-toggle="${sprite.id}">
          <div class="cl-sprite__avatar">${baseImg ? `<img src="${baseImg}" alt="${sprite.name}" class="cl-sprite__img" />` : `<span class="avatar-placeholder">?</span>`}</div>
          <div class="cl-sprite__info">
            <h3 class="cl-sprite__name">${sprite.name}</h3>
            <p class="cl-sprite__meta">${sprite.rarity} · ${owned}/${total} variantes ${sprite.confidence ? `<span class="cl-confidence cl-confidence--${sprite.confidence}">${sprite.confidence}</span>` : ""}</p>
          </div>
          <div class="cl-sprite__bar">
            <div class="cl-sprite__bar-fill" style="width:${pct}%"></div>
          </div>
          <button class="cl-sprite__detail" data-sprite-detail="${sprite.id}" title="Fiche complète">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          <svg class="cl-sprite__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        ${isExpanded ? `
        <div class="cl-sprite__body">
          ${displayedVariants.map(v => {
            const vPrio = v.entry.priority || "none";
            const vPrioBadge = vPrio !== "none" && vPrio !== "ignored"
              ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(vPrio)}">${priorityLabel(vPrio)}</span>`
              : "";
            return `
            <div class="cl-variant" data-variant-id="${v.id}">
              <div class="cl-variant__left">
                <div class="cl-variant__thumb">${v.img ? `<img src="${v.img}" class="cl-variant__img" />` : `<span>?</span>`}</div>
                <span class="cl-variant__name">${v.name} ${vPrioBadge}</span>
              </div>
              <div class="cl-variant__status">${statusEmoji(v.entry.status)} <span>${statusLabel(v.entry.status)}</span></div>
              <div class="cl-variant__actions">
                <button class="cl-btn cl-btn--owned ${v.entry.status === "owned" ? "active" : ""}" data-id="${v.id}" data-status="owned" title="Possédé">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <button class="cl-btn cl-btn--missing ${v.entry.status === "missing" ? "active" : ""}" data-id="${v.id}" data-status="missing" title="Manquant">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <button class="cl-btn cl-btn--priority ${v.entry.status === "priority" ? "active" : ""}" data-id="${v.id}" data-status="priority" title="Prioritaire">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </button>
                <button class="cl-btn cl-btn--unsure ${v.entry.status === "unsure" ? "active" : ""}" data-id="${v.id}" data-status="unsure" title="À vérifier">
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
