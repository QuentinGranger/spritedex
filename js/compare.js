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
          releaseStatus,
          dataStatus,
          available,
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
          releaseStatus: sprite.releaseStatus || "",
          dataStatus: sprite.dataStatus || "",
          available: sprite.available,
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
      variantId: item.variantId,
      spriteId: item.spriteId,
      variantType: item.variantType,
      variantName: item.variantName,
      spriteName: item.spriteName,
      img: item.img,
      rarity: item.rarity,
      color: item.color,
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

  const comparisonId = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `comparison_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return {
    comparisonId,
    generatedAt: new Date().toISOString(),
    users: {
      userA: { id: userAInfo.id, displayName: userAInfo.displayName },
      userB: { id: userBInfo.id, displayName: userBInfo.displayName }
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
      complementarityRate
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
  els.compareSummary.innerHTML = `
    <div class="compare-main-indicators">
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${s.aPossessionRate}%</span><span class="compare-kpi__label">Complétion ${safeA}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${s.bPossessionRate}%</span><span class="compare-kpi__label">Complétion ${safeB}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${s.collectiveCompletionRate}%</span><span class="compare-kpi__label">Complétion collective</span></div>
    </div>
    <div class="compare-main-summary">
      <p>${ownerLine(safeA, s.onlyUserACount, safeB)}</p>
      <p>${ownerLine(safeB, s.onlyUserBCount, safeA)}</p>
      <p>Vous possédez <strong>${s.bothOwnedCount}</strong> variante${s.bothOwnedCount > 1 ? 's' : ''} en commun.</p>
      <p><strong>${s.bothMissingCount}</strong> variante${s.bothMissingCount > 1 ? 's' : ''} vous manquent à tous les deux.</p>
      <p>Ensemble, vous couvrez <strong>${s.collectiveCompletionRate}%</strong> du catalogue.</p>
    </div>
    <p class="compare-complementarity-message">Vos collections sont complémentaires à <strong>${s.complementarityRate}%</strong>.</p>
    <div class="compare-summary-grid">
      <div class="compare-kpi"><span class="compare-kpi__value">${s.collectiveCompletionRate}%</span><span class="compare-kpi__label">Complétion collective</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.complementarityRate}%</span><span class="compare-kpi__label">Complémentarité</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothOwnedCount}</span><span class="compare-kpi__label">En commun</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserACount}</span><span class="compare-kpi__label">${safeA} a · ${safeB} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserBCount}</span><span class="compare-kpi__label">${safeB} a · ${safeA} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothMissingCount}</span><span class="compare-kpi__label">Manque aux deux</span></div>
    </div>
    <div class="compare-players">
      <div class="compare-player">
        <span class="compare-player__name">${safeA}</span>
        <span class="compare-player__pct">${s.aPossessionRate}% possédé</span>
        <span class="compare-player__count">${s.aOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
      <div class="compare-player">
        <span class="compare-player__name">${safeB}</span>
        <span class="compare-player__pct">${s.bPossessionRate}% possédé</span>
        <span class="compare-player__count">${s.bOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
    </div>`;
}

function compareStatusIcon(status) {
  return statusEmoji(status);
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
  const records = getCompareFilterRecords(result, filter);

  const header = `
    <div class="compare-table__header">
      <span class="compare-table__cell compare-table__cell--variant">Variante</span>
      <span class="compare-table__cell">${escapeHtml(aName)}</span>
      <span class="compare-table__cell">${escapeHtml(bName)}</span>
      <span class="compare-table__cell compare-table__cell--actions"></span>
    </div>`;

  const rows = records.map(r => {
    const canPrioritize = r.userA.status !== "owned";
    const actions = `
      <button type="button" class="compare-action compare-action--detail" data-sprite-id="${r.spriteId}">Fiche</button>
      ${canPrioritize ? `<button type="button" class="compare-action compare-action--priority" data-variant-id="${r.variantId}">Priorité</button>` : ""}`;
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
      if (e.target.closest("button")) return;
      openSpriteDetail(row.dataset.spriteId);
    });
  });

  els.compareTable.querySelectorAll(".compare-action--detail").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); openSpriteDetail(btn.dataset.spriteId); });
  });

  els.compareTable.querySelectorAll(".compare-action--priority").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setEntry(btn.dataset.variantId, { status: "priority" });
      toast("Marqué comme priorité");
      renderCompare();
    });
  });
}

function renderCompareRecommendations(result, aName, bName) {
  if (!els.compareRecommendations) return;
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);

  const recA = result.groups.onlyUserB.filter(r => compareIsPriority(r.userA)).slice(0, 10);
  const recB = result.groups.onlyUserA.filter(r => compareIsPriority(r.userB)).slice(0, 10);
  const fallbackA = recA.length ? [] : result.groups.onlyUserB.slice(0, 5);
  const fallbackB = recB.length ? [] : result.groups.onlyUserA.slice(0, 5);

  let html = `<div class="compare-section compare-section--recommendations"><h3 class="compare-section__title">Recommandations</h3><div class="compare-section__body">`;
  if (!recA.length && !recB.length && !fallbackA.length && !fallbackB.length) {
    html += `<p class="compare-empty">Aucune recommandation notable.</p>`;
  } else {
    if (recA.length || fallbackA.length) {
      const list = (recA.length ? recA : fallbackA).map(r => compareItemHTML(r, `${compareStatusIcon(r.userA.status)} ${comparePriorityTag(r.userA)}`)).join("");
      html += `<div class="compare-subsection"><h4 class="compare-subsection__title">${safeA} devrait obtenir de ${safeB}</h4><div class="compare-list">${list}</div></div>`;
    }
    if (recB.length || fallbackB.length) {
      const list = (recB.length ? recB : fallbackB).map(r => compareItemHTML(r, `${compareStatusIcon(r.userB.status)} ${comparePriorityTag(r.userB)}`)).join("");
      html += `<div class="compare-subsection"><h4 class="compare-subsection__title">${safeB} devrait obtenir de ${safeA}</h4><div class="compare-list">${list}</div></div>`;
    }
  }
  html += `</div></div>`;
  els.compareRecommendations.innerHTML = html;
}

function renderCompareActions() {
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
  const select = `<select id="compareFilterSelect" class="compare-filter-select" aria-label="Filtrer">${options.map(o => `<option value="${o.value}" ${filter === o.value ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
  els.compareActions.innerHTML = `
    <div class="compare-actions-bar">
      <label for="compareFilterSelect" class="compare-actions-label">Filtrer</label>
      ${select}
      <button type="button" class="login-btn" id="compareRefreshBtn">Actualiser</button>
      <button type="button" class="ghost-button" id="compareShareActionBtn">Partager</button>
    </div>`;

  const filterSelect = $("#compareFilterSelect");
  if (filterSelect) filterSelect.addEventListener("change", (e) => { state.compareFilter = e.target.value; renderCompare(); });

  const refreshBtn = $("#compareRefreshBtn");
  if (refreshBtn) refreshBtn.addEventListener("click", () => { state.compareFilter = "all"; renderCompare(); });

  const shareBtn = $("#compareShareActionBtn");
  if (shareBtn) shareBtn.addEventListener("click", shareCompareLink);
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
  const userB = { id: state.compareTarget.username || "userB", displayName: state.compareTarget.username || "Ami", collection: state.compareTarget.collection };
  const result = compareCollections(userA, userB, getCompareCatalogItems());
  renderCompareSummary(result, aName, bName);
  renderCompareActions();
  renderCompareRecommendations(result, aName, bName);
  renderCompareTable(result, aName, bName);
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
