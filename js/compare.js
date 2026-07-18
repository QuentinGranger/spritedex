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
// userA et userB sont des objets collection { variantId: { status, priority, ... } }.
// catalogue est une liste de variants (par défaut tous les variants sortis du catalogue).
// Pour chaque variante on renvoie l'une des 5 catégories : both_owned, only_user_a,
// only_user_b, both_missing, unknown.
function compareCollections(userA, userB, catalogue = getCompareCatalogItems()) {
  const result = {
    both_owned: [],
    only_user_a: [],
    only_user_b: [],
    both_missing: [],
    unknown: [],
    summary: {
      total: catalogue.length,
      bothOwned: 0,
      onlyUserA: 0,
      onlyUserB: 0,
      bothMissing: 0,
      unknown: 0,
      aOwned: 0,
      bOwned: 0
    }
  };

  for (const item of catalogue) {
    const a = compareEntry(userA, item);
    const b = compareEntry(userB, item);
    const sa = compareClassify(a);
    const sb = compareClassify(b);
    const record = { item, entryA: a, entryB: b };

    if (sa === "unknown" || sb === "unknown") {
      result.unknown.push(record);
      result.summary.unknown++;
      continue;
    }

    if (sa === "owned" && sb === "owned") {
      result.both_owned.push(record);
      result.summary.bothOwned++;
      result.summary.aOwned++;
      result.summary.bOwned++;
    } else if (sa === "owned" && sb !== "owned") {
      result.only_user_a.push(record);
      result.summary.onlyUserA++;
      result.summary.aOwned++;
    } else if (sb === "owned" && sa !== "owned") {
      result.only_user_b.push(record);
      result.summary.onlyUserB++;
      result.summary.bOwned++;
    } else if (sa === "missing" && sb === "missing") {
      result.both_missing.push(record);
      result.summary.bothMissing++;
    } else {
      // Sécurité : statut non classifiable, on le met dans "unknown"
      result.unknown.push(record);
      result.summary.unknown++;
    }
  }

  const total = result.summary.total;
  result.summary.aPercent = total ? Math.round((result.summary.aOwned / total) * 100) : 0;
  result.summary.bPercent = total ? Math.round((result.summary.bOwned / total) * 100) : 0;
  const unionOwned = result.summary.aOwned + result.summary.bOwned - result.summary.bothOwned;
  result.summary.collectiveCompletion = total ? Math.round((unionOwned / total) * 100) : 0;
  const aMissing = result.summary.onlyUserB + result.summary.bothMissing;
  const bMissing = result.summary.onlyUserA + result.summary.bothMissing;
  const aCovered = result.summary.onlyUserB;
  const bCovered = result.summary.onlyUserA;
  const aComp = aMissing ? aCovered / aMissing : 1;
  const bComp = bMissing ? bCovered / bMissing : 1;
  result.summary.complementarity = Math.round(((aComp + bComp) / 2) * 100);

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
  const s = result.summary;
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);
  els.compareSummary.innerHTML = `
    <div class="compare-summary-grid">
      <div class="compare-kpi"><span class="compare-kpi__value">${s.collectiveCompletion}%</span><span class="compare-kpi__label">Complétion collective</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.complementarity}%</span><span class="compare-kpi__label">Complémentarité</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.both_owned.length}</span><span class="compare-kpi__label">En commun</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.only_user_a.length}</span><span class="compare-kpi__label">${safeA} a · ${safeB} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.only_user_b.length}</span><span class="compare-kpi__label">${safeB} a · ${safeA} manque</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${result.both_missing.length}</span><span class="compare-kpi__label">Manque aux deux</span></div>
    </div>
    <div class="compare-players">
      <div class="compare-player">
        <span class="compare-player__name">${safeA}</span>
        <span class="compare-player__pct">${s.aPercent}% possédé</span>
        <span class="compare-player__count">${s.aOwned} / ${s.total}</span>
      </div>
      <div class="compare-player">
        <span class="compare-player__name">${safeB}</span>
        <span class="compare-player__pct">${s.bPercent}% possédé</span>
        <span class="compare-player__count">${s.bOwned} / ${s.total}</span>
      </div>
    </div>`;
}

function renderCompareLists(result, aName, bName) {
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);

  const sections = [];
  sections.push(renderCompareSection("Possédé par les deux", result.both_owned, (it) => compareItemHTML(it.item), true));
  sections.push(renderCompareSection(`${safeA} possède · ${safeB} manque`, result.only_user_a,
    (it) => compareItemHTML(it.item, compareStatusTag(it.entryB.status, it.entryB)), true));
  sections.push(renderCompareSection(`${safeB} possède · ${safeA} manque`, result.only_user_b,
    (it) => compareItemHTML(it.item, compareStatusTag(it.entryA.status, it.entryA)), true));
  sections.push(renderCompareSection("Manque aux deux", result.both_missing,
    (it) => compareItemHTML(it.item, `${compareStatusTag(it.entryA.status, it.entryA)} ${compareStatusTag(it.entryB.status, it.entryB)}`), true));

  if (result.unknown.length) {
    sections.push(renderCompareSection("Données insuffisantes", result.unknown,
      (it) => compareItemHTML(it.item, `${compareStatusTag(it.entryA.status, it.entryA)} ${compareStatusTag(it.entryB.status, it.entryB)}`)));
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
  const result = compareCollections(state.collection, state.compareTarget.collection, getCompareCatalogItems());
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
