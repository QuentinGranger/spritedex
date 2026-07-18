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
    groups
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

function renderCompareLists(result, aName, bName) {
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);
  const g = result.groups;

  const sections = [];
  sections.push(renderCompareSection("Possédé par les deux", g.bothOwned, (it) => compareItemHTML(it), true));
  sections.push(renderCompareSection(`${safeA} possède · ${safeB} manque`, g.onlyUserA,
    (it) => compareItemHTML(it, compareStatusTag(it.userB.status, { priority: it.userB.priority })), true));
  sections.push(renderCompareSection(`${safeB} possède · ${safeA} manque`, g.onlyUserB,
    (it) => compareItemHTML(it, compareStatusTag(it.userA.status, { priority: it.userA.priority })), true));
  sections.push(renderCompareSection("Manque aux deux", g.bothMissing,
    (it) => compareItemHTML(it, `${compareStatusTag(it.userA.status, { priority: it.userA.priority })} ${compareStatusTag(it.userB.status, { priority: it.userB.priority })}`), true));

  if (g.unknown.length) {
    sections.push(renderCompareSection("Données insuffisantes", g.unknown,
      (it) => compareItemHTML(it, `${compareStatusTag(it.userA.status, { priority: it.userA.priority })} ${compareStatusTag(it.userB.status, { priority: it.userB.priority })}`)));
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
  const userA = { id: state.userId || "userA", displayName: state.username || "Moi", collection: state.collection };
  const userB = { id: state.compareTarget.username || "userB", displayName: state.compareTarget.username || "Ami", collection: state.compareTarget.collection };
  const result = compareCollections(userA, userB, getCompareCatalogItems());
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
