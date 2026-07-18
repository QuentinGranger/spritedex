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

// ── Moteur de comparaison ───────────────────────────────────────────────────
function compareCollections(collectionA, collectionB, labelA, labelB, items = getCompareCatalogItems()) {
  const total = items.length;
  const result = {
    total,
    bothOwn: [],
    onlyA: [],
    onlyB: [],
    bothMissing: [],
    aOwnUnknown: [],
    bOwnUnknown: [],
    other: [],
    aPrioBHas: [],
    bPrioAHas: [],
    bothPrio: [],
    aPrioOnly: [],
    bPrioOnly: [],
    aOwnCount: 0, bOwnCount: 0,
    aMissingCount: 0, bMissingCount: 0,
    aUnknownCount: 0, bUnknownCount: 0,
    aMissingTotal: 0, bMissingTotal: 0,
    aMissingCovered: 0, bMissingCovered: 0,
    unionOwned: 0,
    labelA, labelB
  };

  for (const item of items) {
    const a = compareEntry(collectionA, item.id);
    const b = compareEntry(collectionB, item.id);
    const sa = compareClassify(a);
    const sb = compareClassify(b);
    const pa = compareIsPriority(a);
    const pb = compareIsPriority(b);

    if (sa === "owned") result.aOwnCount++;
    else if (sa === "missing") result.aMissingCount++;
    else result.aUnknownCount++;

    if (sb === "owned") result.bOwnCount++;
    else if (sb === "missing") result.bMissingCount++;
    else result.bUnknownCount++;

    if (sa === "owned" || sb === "owned") result.unionOwned++;

    if (sa === "missing") {
      result.aMissingTotal++;
      if (sb === "owned") result.aMissingCovered++;
    }
    if (sb === "missing") {
      result.bMissingTotal++;
      if (sa === "owned") result.bMissingCovered++;
    }

    if (sa === "owned" && sb === "owned") {
      result.bothOwn.push(item);
    } else if (sa === "owned" && sb === "missing") {
      result.onlyA.push({ item, bStatus: b.status, bEntry: b });
    } else if (sb === "owned" && sa === "missing") {
      result.onlyB.push({ item, aStatus: a.status, aEntry: a });
    } else if (sa === "missing" && sb === "missing") {
      result.bothMissing.push({ item, aStatus: a.status, bStatus: b.status });
    } else if (sa === "owned" && sb === "unknown") {
      result.aOwnUnknown.push({ item, bStatus: b.status });
    } else if (sb === "owned" && sa === "unknown") {
      result.bOwnUnknown.push({ item, aStatus: a.status });
    } else {
      result.other.push({ item, aStatus: a.status, bStatus: b.status });
    }

    if (pa || pb) {
      const aHas = sa === "owned";
      const bHas = sb === "owned";
      if (pa && pb) result.bothPrio.push({ item, aEntry: a, bEntry: b });
      else if (pa && bHas) result.aPrioBHas.push({ item, aEntry: a });
      else if (pb && aHas) result.bPrioAHas.push({ item, bEntry: b });
      else if (pa) result.aPrioOnly.push({ item, aEntry: a });
      else if (pb) result.bPrioOnly.push({ item, bEntry: b });
    }
  }

  result.aPercent = total ? Math.round((result.aOwnCount / total) * 100) : 0;
  result.bPercent = total ? Math.round((result.bOwnCount / total) * 100) : 0;
  result.collectiveCompletion = total ? Math.round((result.unionOwned / total) * 100) : 0;
  const aComp = result.aMissingTotal ? result.aMissingCovered / result.aMissingTotal : 1;
  const bComp = result.bMissingTotal ? result.bMissingCovered / result.bMissingTotal : 1;
  result.complementarity = Math.round(((aComp + bComp) / 2) * 100);

  return result;
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
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);
  els.compareSummary.innerHTML = `
    <div class="compare-summary-grid">
      <div class="compare-kpi"><span class="compare-kpi__value">${result.collectiveCompletion}%</span><span class="compare-kpi__label">Complétion collective</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.complementarity}%</span><span class="compare-kpi__label">Complémentarité</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.bothOwn.length}</span><span class="compare-kpi__label">En commun</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.onlyA.length}</span><span class="compare-kpi__label">${safeA} a · ${safeB} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.onlyB.length}</span><span class="compare-kpi__label">${safeB} a · ${safeA} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.bothMissing.length}</span><span class="compare-kpi__label">Manque aux deux</span></div>
    </div>
    <div class="compare-players">
      <div class="compare-player">
        <span class="compare-player__name">${safeA}</span>
        <span class="compare-player__pct">${result.aPercent}% possédé</span>
        <span class="compare-player__count">${result.aOwnCount} / ${result.total}</span>
      </div>
      <div class="compare-player">
        <span class="compare-player__name">${safeB}</span>
        <span class="compare-player__pct">${result.bPercent}% possédé</span>
        <span class="compare-player__count">${result.bOwnCount} / ${result.total}</span>
      </div>
    </div>`;
}

function renderCompareLists(result, aName, bName) {
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);

  const sections = [];
  sections.push(renderCompareSection("Possédé par les deux", result.bothOwn, (it) => compareItemHTML(it), true));
  sections.push(renderCompareSection(`${safeA} possède · ${safeB} manque`, result.onlyA,
    (it) => compareItemHTML(it.item, compareStatusTag(it.bStatus, it.bEntry)), true));
  sections.push(renderCompareSection(`${safeB} possède · ${safeA} manque`, result.onlyB,
    (it) => compareItemHTML(it.item, compareStatusTag(it.aStatus, it.aEntry)), true));
  sections.push(renderCompareSection("Manque aux deux", result.bothMissing,
    (it) => compareItemHTML(it.item, `<span class="ci-status">${compareStatusTag(it.aStatus, {priority: null})}</span><span class="ci-status">${compareStatusTag(it.bStatus, {priority: null})}</span>`), true));

  // Priorités / opportunités d’échange
  if (result.aPrioBHas.length || result.bPrioAHas.length || result.bothPrio.length || result.aPrioOnly.length || result.bPrioOnly.length) {
    const prioParts = [];
    if (result.aPrioBHas.length) {
      prioParts.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Priorités de ${safeA} que ${safeB} possède</h4><div class="compare-list">${result.aPrioBHas.map(it => compareItemHTML(it.item, comparePriorityTag(it.aEntry))).join("")}</div></div>`);
    }
    if (result.bPrioAHas.length) {
      prioParts.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Priorités de ${safeB} que ${safeA} possède</h4><div class="compare-list">${result.bPrioAHas.map(it => compareItemHTML(it.item, comparePriorityTag(it.bEntry))).join("")}</div></div>`);
    }
    if (result.bothPrio.length) {
      prioParts.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Priorités communes</h4><div class="compare-list">${result.bothPrio.map(it => compareItemHTML(it.item, `${comparePriorityTag(it.aEntry)} ${comparePriorityTag(it.bEntry)}`)).join("")}</div></div>`);
    }
    if (result.aPrioOnly.length) {
      prioParts.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Autres priorités de ${safeA}</h4><div class="compare-list">${result.aPrioOnly.map(it => compareItemHTML(it.item, comparePriorityTag(it.aEntry))).join("")}</div></div>`);
    }
    if (result.bPrioOnly.length) {
      prioParts.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Autres priorités de ${safeB}</h4><div class="compare-list">${result.bPrioOnly.map(it => compareItemHTML(it.item, comparePriorityTag(it.bEntry))).join("")}</div></div>`);
    }
    sections.push(`<details class="compare-section" open><summary class="compare-section__title"><span>Priorités</span><span class="compare-section__count">${result.aPrioBHas.length + result.bPrioAHas.length + result.bothPrio.length + result.aPrioOnly.length + result.bPrioOnly.length}</span></summary><div class="compare-section__body">${prioParts.join("")}</div></details>`);
  }

  // Non renseigné chez l’un des deux
  const unknownCount = result.aOwnUnknown.length + result.bOwnUnknown.length + result.other.length;
  if (unknownCount) {
    const unknownItems = [];
    if (result.aOwnUnknown.length) {
      unknownItems.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Possédé par ${safeA} · non renseigné chez ${safeB}</h4><div class="compare-list">${result.aOwnUnknown.map(it => compareItemHTML(it.item)).join("")}</div></div>`);
    }
    if (result.bOwnUnknown.length) {
      unknownItems.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Possédé par ${safeB} · non renseigné chez ${safeA}</h4><div class="compare-list">${result.bOwnUnknown.map(it => compareItemHTML(it.item)).join("")}</div></div>`);
    }
    if (result.other.length) {
      unknownItems.push(`<div class="compare-subsection"><h4 class="compare-subsection__title">Autres différences</h4><div class="compare-list">${result.other.map(it => compareItemHTML(it.item, `<span class="ci-status">${statusLabel(it.aStatus)}</span> <span class="ci-status">${statusLabel(it.bStatus)}</span>`)).join("")}</div></div>`);
    }
    sections.push(`<details class="compare-section"><summary class="compare-section__title"><span>Non renseigné / autres</span><span class="compare-section__count">${unknownCount}</span></summary><div class="compare-section__body">${unknownItems.join("")}</div></details>`);
  }

  els.compareLists.innerHTML = sections.join("");
}

function renderCompare() {
  if (!els.compareResults || !els.compareSummary || !els.compareLists) return;
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
  const result = compareCollections(state.collection, state.compareTarget.collection, aName, bName);
  renderCompareSummary(result, aName, bName);
  renderCompareLists(result, aName, bName);
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
    if (!res.ok) throw new Error("shared failed");
    const data = await res.json();
    state.compareToken = token;
    state.compareTarget = {
      username: data.username || "Ami",
      avatarUrl: data.avatarUrl || "",
      collection: data.collection || {}
    };
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
  try {
    const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, { headers: authHeaders() });
    const data = await res.json();
    if (!data.shareToken) {
      toast("Impossible de générer le lien");
      return;
    }
    const url = `${location.origin}${location.pathname}?compare=${data.shareToken}`;
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast("Lien de comparaison copié !");
    } else {
      toast(url);
    }
  } catch (e) {
    toast("Erreur réseau");
    console.error("[compare share]", e);
  }
}

function switchToCompareView() {
  const tab = document.querySelector('.tab[data-view="compare"]');
  if (tab) tab.click();
}

async function handleCompareParams() {
  const params = new URLSearchParams(location.search);
  const token = params.get("compare");
  if (!token) return false;
  await loadCompareTarget(token);
  if (state.compareTarget) switchToCompareView();
  return true;
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
}
