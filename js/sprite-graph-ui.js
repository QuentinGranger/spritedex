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
  return formatUiNumber(rounded, { maximumFractionDigits: digits });
}

function sgFormatPercent(rate, digits = 1) {
  if (rate == null || !Number.isFinite(Number(rate))) return "—";
  return formatUiPercent(Number(rate), { maximumFractionDigits: digits });
}

function sgTrendLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const key = {
    strongly_rising: "community.trendStronglyRising",
    "fortement en hausse": "community.trendStronglyRising",
    rising: "community.trendRising",
    "en hausse": "community.trendRising",
    stable: "community.trendStable",
    falling: "community.trendFalling",
    "en baisse": "community.trendFalling",
    strongly_falling: "community.trendStronglyFalling",
    "fortement en baisse": "community.trendStronglyFalling"
  }[normalized];
  return key ? t(key) : String(value || "");
}

function sgCommunityLines(data) {
  const community = data?.community || {};
  const lines = [];
  if (community.ownershipRate != null) {
    lines.push(t("community.graphOwnership", { rate: sgFormatPercent(community.ownershipRate) }));
  }
  if (community.priorityRateAmongMissing != null) {
    lines.push(t("community.graphPriority", { rate: sgFormatPercent(community.priorityRateAmongMissing, 0) }));
  }
  if (community.trend || community.trendLabel) {
    lines.push(t("community.graphTrend", { trend: sgTrendLabel(community.trend || community.trendLabel) }));
  } else if (community.trendMessage) {
    lines.push(t("community.notEnoughData"));
  }
  if (community.eligibleCollectionCount != null) {
    const count = Math.max(0, Math.floor(Number(community.eligibleCollectionCount) || 0));
    lines.push(t("community.graphSample", { count, s: count === 1 ? "" : "s" }));
  }
  return lines;
}

function sgTrendsSectionTitle(key) {
  return t({
    mostOwned: "community.trendsMostOwned",
    rarestInSpriteIndex: "community.trendsRarest",
    mostSought: "community.trendsMostSought",
    mostPriorityAdds: "community.trendsPriorityAdds",
    strongestRisers: "community.trendsStrongestRisers",
    mostCompared: "community.trendsMostCompared",
    interestLeaders: "community.trendsInterestLeaders"
  }[key] || "community.trendsTitle");
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

  const sep = data.raritySeparation || {};
  const lines = sgCommunityLines(data);

  let historyHtml = "";
  if (includeHistory && history && history.showHistory) {
    const own = history.ownership;
    const prio = history.priorities;
    const lang = uiLocale();
    const points = (history.series || []).slice(-5).map((p) => `
      <li><span>${sgEscape(new Date(p.date).toLocaleDateString(lang, { day: "numeric", month: "long" }))}</span>
          <strong>${sgFormatPercent(p.ownershipRate)}</strong></li>
    `).join("");
    historyHtml = `
      <div class="sg-community__history">
        <h4 class="sg-community__subtitle">${sgEscape(t("community.ownershipHistory"))}</h4>
        <ul class="sg-community__series">${points}</ul>
        ${own && own.evolutionPoints != null ? `<p class="sg-community__evo">${sgEscape(t("community.historyOwnershipChange", { delta: `${Number(own.evolutionPoints) >= 0 ? "+" : ""}${sgFormatRate(own.evolutionPoints)}` }))}</p>` : ""}
        ${prio && prio.from != null && prio.to != null ? `<p class="sg-community__prio-evo">${sgEscape(t("community.historyPriorityChange", { from: prio.from, to: prio.to }))}</p>` : ""}
      </div>
    `;
  }

  return `
    <div class="sg-community">
      <h3 class="sg-community__title">${sgEscape(t("community.sgTitle"))}</h3>
      ${sep.officialRarity ? `
        <p class="sg-community__official">
          <span class="sg-community__label">${sgEscape(t("community.officialRarityLabel"))}</span>
          <strong>${sgEscape(localizedRarity(sep.officialRarity))}</strong>
        </p>
        ${sep.ownershipLabel ? `
          <p class="sg-community__ownership">
            <span class="sg-community__label">${sgEscape(t("community.spriteIndexOwnershipLabel"))}</span>
            <strong>${sgFormatPercent(sep.spriteIndexOwnershipRate)}</strong>
          </p>
        ` : ""}
        <p class="sg-community__note">${sgEscape(t("community.raritySeparationNote"))}</p>
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
        return `<li><span>${sgEscape(name)}</span><strong>${sgFormatPercent(rate)}</strong></li>`;
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
          <h3 class="stats-module__title">${sgEscape(t("community.trendsTitle"))}</h3>
          <p class="sg-community__muted">${sgEscape(t(board.message || "community.insufficientData"))}</p>
          <p class="sg-community__disclaimer">${sgEscape(t("community.disclaimer"))}</p>
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
            <h4 class="sg-trends__title">${sgEscape(sgTrendsSectionTitle(key))}</h4>
            <p class="sg-community__muted">${sgEscape(t("community.notEnoughData"))}</p>
          </div>
        `;
      }
      const rows = items.map((it) => {
        const name = it.spriteName
          ? `${it.spriteName}${it.variantName && it.variantName !== "Base" ? ` · ${it.variantName}` : ""}`
          : (it.variantName || it.variantId || it.spriteId || "?");
        let metric = "";
        if (it.ownershipRate != null) metric = sgFormatPercent(it.ownershipRate);
        else if (it.priorityUserCount != null) metric = t("community.prioritiesCount", { count: it.priorityUserCount });
        else if (it.priorityAdds7d != null) metric = t("community.priorityAdds7d", { count: it.priorityAdds7d });
        else if (it.change7d != null) metric = `${it.change7d >= 0 ? "+" : "−"}${sgFormatPercent(Math.abs(it.change7d), 0)}`;
        else if (it.differenceAppearanceCount != null) metric = t("community.diffsCount", { count: it.differenceAppearanceCount });
        else if (it.interestScore != null) metric = `${sgFormatRate(it.interestScore, 0)}`;
        const rarity = it.officialRarity
          ? `<span class="sg-trends__rarity">${sgEscape(t("community.officialRarityLabel"))} : ${sgEscape(localizedRarity(it.officialRarity))}</span>`
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
          <h4 class="sg-trends__title">${sgEscape(sgTrendsSectionTitle(key))}</h4>
          ${sec.note ? `<p class="sg-community__note">${sgEscape(t("community.raritySeparationNote"))}</p>` : ""}
          <ul class="sg-trends__list">${rows}</ul>
        </div>
      `;
    }).join("");

    container.innerHTML = `
      <div class="stats-module sg-trends">
        <h3 class="stats-module__title">${sgEscape(t("community.trendsTitle"))}</h3>
        <p class="sg-community__disclaimer">${sgEscape(t("community.disclaimer"))}</p>
        ${blocks}
      </div>
    `;
  } catch (_) {
    container.innerHTML = `<p class="sg-community__muted">${sgEscape(t("community.trendsError"))}</p>`;
  }
}
