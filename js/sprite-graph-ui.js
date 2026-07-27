// Sprite Graph UI helpers (Étapes 76–80) — fiches + Tendances.

function sgEscape(s) {
  if (typeof escapeHtml === "function") return escapeHtml(s);
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}

function sgFormatRate(rate, digits = 1) {
  if (rate == null || !Number.isFinite(Number(rate))) return "—";
  const n = Number(rate);
  const rounded = Math.round(n * (10 ** digits)) / (10 ** digits);
  return String(rounded).replace(".", ",");
}

// Fine interaction signals are optional and never block the user action. Only
// allow-listed metadata is sent; no collection, search term or profile data.
function trackSpriteGraphInteraction(type, details = {}) {
  try {
    if (!localStorage.getItem(TOKEN_KEY) || !API_BASE || typeof authHeaders !== "function") return;
    const source = typeof isNativePlatform === "function" && isNativePlatform() ? "ios" : "web";
    fetch(`${API_BASE}/sprite-graph/interactions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ type, source, ...details })
    }).catch(() => {});
  } catch (_) { /* analytics must stay non-blocking */ }
}

function renderCommunityPublicBlock(data, { includeHistory = false, history = null } = {}) {
  if (!data || data.insufficient) {
    return `
      <div class="sg-community sg-community--empty">
        <p class="sg-community__muted">${sgEscape(t((data && data.message) || "community.insufficientData"))}</p>
        <p class="sg-community__disclaimer">${sgEscape(t("community.disclaimer"))}</p>
      </div>
    `;
  }

  const d = data.publicDisplay || {};
  const sep = data.raritySeparation || {};
  const lines = [
    d.ownership,
    d.priority,
    d.trend,
    d.sample
  ].filter(Boolean);

  let historyHtml = "";
  if (includeHistory && history && history.showHistory) {
    const own = history.ownership;
    const prio = history.priorities;
    const lang = typeof appLocale === "function" && appLocale() === "en" ? "en-US" : "fr-FR";
    const points = (history.series || []).slice(-5).map((p) => `
      <li><span>${sgEscape(new Date(p.date).toLocaleDateString(lang, { day: "numeric", month: "long" }))}</span>
          <strong>${sgFormatRate(p.ownershipRate)} %</strong></li>
    `).join("");
    historyHtml = `
      <div class="sg-community__history">
        <h4 class="sg-community__subtitle">${sgEscape(t("community.ownershipHistory"))}</h4>
        <ul class="sg-community__series">${points}</ul>
        ${own && own.evolutionLabel ? `<p class="sg-community__evo">${sgEscape(t(own.evolutionLabel))}</p>` : ""}
        ${prio && prio.label ? `<p class="sg-community__prio-evo">${sgEscape(t(prio.label))}</p>` : ""}
      </div>
    `;
  }

  return `
    <div class="sg-community">
      <h3 class="sg-community__title">${sgEscape(t("community.sgTitle"))}</h3>
      ${sep.officialRarity ? `
        <p class="sg-community__official">
          <span class="sg-community__label">${sgEscape(t("community.officialRarityLabel"))}</span>
          <strong>${sgEscape(sep.officialRarity)}</strong>
        </p>
        ${sep.ownershipLabel ? `
          <p class="sg-community__ownership">
            <span class="sg-community__label">${sgEscape(t("community.spriteIndexOwnershipLabel"))}</span>
            <strong>${sgFormatRate(sep.spriteIndexOwnershipRate)} %</strong>
          </p>
        ` : ""}
        <p class="sg-community__note">${sgEscape(sep.note ? t(sep.note) : "")}</p>
      ` : ""}
      <ul class="sg-community__lines">
        ${lines.map((l) => `<li>${sgEscape(t(l))}</li>`).join("")}
      </ul>
      ${historyHtml}
      <p class="sg-community__disclaimer">${sgEscape(t("community.disclaimer"))}</p>
    </div>
  `;
}

async function fetchVariantCommunity(variantId) {
  const res = await fetch(`${API_BASE}/sprite-graph/variants/${encodeURIComponent(variantId)}/community`);
  if (!res.ok) throw new Error("community_fetch_failed");
  return res.json();
}

async function fetchVariantHistory(variantId) {
  const res = await fetch(`${API_BASE}/sprite-graph/variants/${encodeURIComponent(variantId)}/history?days=30`);
  if (!res.ok) throw new Error("history_fetch_failed");
  return res.json();
}

async function fetchSpriteCommunity(spriteId) {
  const res = await fetch(`${API_BASE}/sprite-graph/sprites/${encodeURIComponent(spriteId)}/community`);
  if (!res.ok) throw new Error("sprite_community_fetch_failed");
  return res.json();
}

async function fetchTrendsBoard() {
  const res = await fetch(`${API_BASE}/sprite-graph/trends?limit=8`);
  if (!res.ok) throw new Error("trends_fetch_failed");
  return res.json();
}

/**
 * Étape 77/79/80 — inject community block into variant detail dialog.
 */
async function loadDetailCommunityStats(variantId) {
  const mount = document.getElementById("dialogCommunityStats");
  if (!mount || !variantId) return;
  mount.innerHTML = `<p class="sg-community__muted">${sgEscape(t("history.loading"))}</p>`;
  try {
    const [data, history] = await Promise.all([
      fetchVariantCommunity(variantId),
      fetchVariantHistory(variantId).catch(() => null)
    ]);
    mount.innerHTML = renderCommunityPublicBlock(data, {
      includeHistory: true,
      history
    });
  } catch (_) {
    mount.innerHTML = `<p class="sg-community__muted">${sgEscape(t("community.statsUnavailable"))}</p>`;
  }
}

/**
 * Étape 77/79 — inject into sprite fiche (official rarity separated).
 */
async function loadSpriteDetailCommunity(spriteId) {
  const mount = document.getElementById("spriteDetailCommunity");
  if (!mount || !spriteId) return;
  mount.innerHTML = `<p class="sg-community__muted">${sgEscape(t("community.loadingSpriteStats"))}</p>`;
  try {
    const board = await fetchSpriteCommunity(spriteId);
    const variants = board.variants || [];
    // Prefer Base variant, else first with data.
    let pick = variants.find((v) => !v.insufficient && v.official?.variantName === "Base")
      || variants.find((v) => !v.insufficient)
      || variants[0];

    let history = null;
    if (pick && pick.variantId && !pick.insufficient) {
      history = await fetchVariantHistory(pick.variantId).catch(() => null);
    }

    const header = `
      <div class="sg-community__sprite-head">
        <p class="sg-community__official">
          <span class="sg-community__label">${sgEscape(t("community.officialRarityLabel"))}</span>
          <strong>${sgEscape(board.officialRarity || "—")}</strong>
        </p>
      </div>
    `;

    if (!pick || pick.insufficient) {
      mount.innerHTML = `
        ${header}
        <p class="sg-community__muted">${sgEscape(t((pick && pick.message) || "community.insufficientData"))}</p>
        <p class="sg-community__disclaimer">${sgEscape(t("community.disclaimer"))}</p>
      `;
      return;
    }

    // Compact per-variant ownership rates (no overload).
    const compact = variants
      .filter((v) => !v.insufficient && v.community)
      .slice(0, 6)
      .map((v) => {
        const name = v.official?.variantName || v.variantId;
        const rate = v.community.ownershipRate;
        return `<li><span>${sgEscape(name)}</span><strong>${sgFormatRate(rate)} %</strong></li>`;
      })
      .join("");

    mount.innerHTML = `
      ${header}
      ${renderCommunityPublicBlock(pick, { includeHistory: true, history })}
      ${compact ? `
        <div class="sg-community__variants">
          <h4 class="sg-community__subtitle">${sgEscape(t("community.variantOwnership"))}</h4>
          <ul class="sg-community__series">${compact}</ul>
        </div>
      ` : ""}
    `;
  } catch (_) {
    mount.innerHTML = `<p class="sg-community__muted">${sgEscape(t("community.statsUnavailable"))}</p>`;
  }
}

/**
 * Étape 78 — Tendances page sections inside Stats.
 */
async function renderSpriteIndexTrends() {
  const container = document.getElementById("sprite-indexTrends");
  if (!container) return;
  container.innerHTML = `<p class="sg-community__muted">${sgEscape(t("community.loadingTrends"))}</p>`;
  try {
    const board = await fetchTrendsBoard();
    if (board.insufficient) {
      container.innerHTML = `
        <div class="stats-module sg-trends sg-trends--gated">
          <h3 class="stats-module__title">${sgEscape(t(board.label || "community.trendsTitle"))}</h3>
          <p class="sg-community__muted">${sgEscape(t(board.message || "community.insufficientData"))}</p>
          <p class="sg-community__disclaimer">${sgEscape(t(board.disclaimer || "community.disclaimer"))}</p>
        </div>
      `;
      return;
    }
    const sections = board.sections || {};
    const order = [
      "mostOwned",
      "rarestInSpriteIndex",
      "mostSought",
      "mostPriorityAdds",
      "strongestRisers",
      "mostCompared"
    ];

    const blocks = order.map((key) => {
      const sec = sections[key];
      if (!sec) return "";
      const items = sec.items || [];
      if (!items.length) {
        return `
          <div class="sg-trends__section">
            <h4 class="sg-trends__title">${sgEscape(t(sec.title))}</h4>
            <p class="sg-community__muted">${sgEscape(t("community.notEnoughData"))}</p>
          </div>
        `;
      }
      const rows = items.map((it) => {
        const name = it.spriteName
          ? `${it.spriteName}${it.variantName && it.variantName !== "Base" ? ` · ${it.variantName}` : ""}`
          : (it.variantName || it.variantId || it.spriteId || "?");
        let metric = "";
        if (it.ownershipRate != null) metric = `${sgFormatRate(it.ownershipRate)} %`;
        else if (it.priorityUserCount != null) metric = t("community.prioritiesCount", { count: it.priorityUserCount });
        else if (it.priorityAdds7d != null) metric = t("community.priorityAdds7d", { count: it.priorityAdds7d });
        else if (it.change7d != null) metric = `${it.change7d >= 0 ? "+" : ""}${sgFormatRate(it.change7d, 0)} %`;
        else if (it.differenceAppearanceCount != null) metric = t("community.diffsCount", { count: it.differenceAppearanceCount });
        else if (it.interestScore != null) metric = `${sgFormatRate(it.interestScore, 0)}`;
        const rarity = it.officialRarity
          ? `<span class="sg-trends__rarity">${sgEscape(t("community.officialRarityLabel"))} : ${sgEscape(it.officialRarity)}</span>`
          : "";
        return `
          <li class="sg-trends__item">
            <span class="sg-trends__name">${sgEscape(name)}</span>
            ${rarity}
            <strong class="sg-trends__metric">${sgEscape(metric)}</strong>
          </li>
        `;
      }).join("");
      return `
        <div class="sg-trends__section">
          <h4 class="sg-trends__title">${sgEscape(t(sec.title))}</h4>
          ${sec.note ? `<p class="sg-community__note">${sgEscape(t(sec.note))}</p>` : ""}
          <ul class="sg-trends__list">${rows}</ul>
        </div>
      `;
    }).join("");

    container.innerHTML = `
      <div class="stats-module sg-trends">
        <h3 class="stats-module__title">${sgEscape(t(board.label || "community.trendsTitle"))}</h3>
        <p class="sg-community__disclaimer">${sgEscape(t(board.disclaimer || "community.disclaimer"))}</p>
        ${blocks}
      </div>
    `;
  } catch (_) {
    container.innerHTML = `<p class="sg-community__muted">${sgEscape(t("community.trendsError"))}</p>`;
  }
}
