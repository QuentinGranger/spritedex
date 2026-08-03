"use strict";

function comparePriorityTag(entry) {
  if (!entry || !entry.priority || entry.priority === "none" || entry.priority === "ignored") return "";
  return `<span class="ci-prio" style="--prio-color:${priorityColor(entry.priority)}">${priorityLabel(entry.priority)}</span>`;
}

function compareStatusTag(status, entry) {
  return `<span class="ci-status">${statusEmoji(status)} <span>${statusLabel(status)}</span>${comparePriorityTag(entry)}</span>`;
}

function compareItemHTML(item, extraHTML = "") {
  const imageUrl = safeImageUrl(item.img);
  const img = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.spriteName)}" class="ci-thumb" />`
    : `<span class="ci-thumb ci-thumb--empty">?</span>`;
  return `
    <div class="compare-item" style="--card-color:${safeCssColor(item.color, "#8d7cff")}">
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
    : `<p class="compare-empty">${t("compare.emptyVariants")}</p>`;
  return `
    <details class="compare-section" ${open ? "open" : ""}>
      <summary class="compare-section__title">
        <span>${escapeHtml(title)}</span>
        <span class="compare-section__count">${items.length}</span>
      </summary>
      <div class="compare-section__body">${body}</div>
    </details>`;
}

function compareHelpDirection(record) {
  const iCanHelp = compareIsOwned(record.userA.status) && compareIsRecommend(record.userB.status);
  const friendCanHelp = compareIsOwned(record.userB.status) && compareIsRecommend(record.userA.status);
  return { iCanHelp, friendCanHelp, aidable: iCanHelp || friendCanHelp };
}

function compareHelpPriorityWeight(entry) {
  if (!compareIsPriority(entry)) return 0;
  const weight = { urgent: 44, important: 34, medium: 24, low: 14 };
  return weight[entry.priority] || 20;
}

function compareHelpDeadline(record) {
  const event = record.eventId ? EVENTS?.[record.eventId] : null;
  const end = new Date(event?.endDate || "").getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86400000);
}

function scoreCompareHelp(record) {
  const direction = compareHelpDirection(record);
  if (!direction.aidable) return { score: -1, direction, reasons: [] };
  const recipient = direction.friendCanHelp ? record.userA : record.userB;
  const reasons = [];
  let score = compareHelpPriorityWeight(recipient);
  if (score) reasons.push("priority");
  if (isItemAvailable(record)) {
    score += 12;
    reasons.push("available");
  }
  const days = compareHelpDeadline(record);
  if (days !== null && days >= 0 && days <= 14) {
    score += days <= 2 ? 32 : days <= 7 ? 22 : 12;
    reasons.push("deadline");
  }
  const rarity =
    { mythic: 20, mythique: 20, legendary: 15, légendaire: 15, epic: 9, épique: 9, rare: 5 }[
      String(record.rarity || "").toLowerCase()
    ] || 0;
  if (rarity) {
    score += rarity;
    reasons.push("rarity");
  }
  return { score, direction, reasons, days };
}

function getCompareHelpRecords(records, filter = "all") {
  return records.filter((record) => {
    const direction = compareHelpDirection(record);
    if (filter === "aidable") return direction.aidable;
    if (filter === "i-help") return direction.iCanHelp;
    if (filter === "friend-helps") return direction.friendCanHelp;
    return true;
  });
}

function renderCompareHelpPanel(result, aName, bName) {
  const records = result.records || [];
  const aidable = getCompareHelpRecords(records, "aidable");
  const iCanHelp = getCompareHelpRecords(records, "i-help");
  const friendCanHelp = getCompareHelpRecords(records, "friend-helps");
  const best = aidable.map((record) => ({ record, ...scoreCompareHelp(record) })).sort((a, b) => b.score - a.score)[0];
  const bestCard =
    best && best.score >= 0
      ? `<button type="button" class="compare-help-panel__best" data-compare-help-filter="${best.direction.friendCanHelp ? "friend-helps" : "i-help"}"><span>${escapeHtml(t("compare.smartPick"))}</span><strong>${escapeHtml(`${best.record.spriteName} · ${best.record.variantName || best.record.variantType || "Base"}`)}</strong><small>${escapeHtml(t(best.direction.friendCanHelp ? "compare.smartFriendHelps" : "compare.smartIHelp", { name: best.direction.friendCanHelp ? bName : aName }))} · ${escapeHtml(best.reasons.map((reason) => t(`compare.smartReason.${reason}`)).join(" · ") || t("compare.smartReason.default"))}</small></button>`
      : "";
  return `<section class="compare-help-panel"><div class="compare-help-panel__lead"><span class="compare-help-panel__icon" aria-hidden="true">↔</span><div><p>${escapeHtml(t("compare.helpKicker"))}</p><h3>${escapeHtml(t("compare.helpTitle", { count: aidable.length }))}</h3><span>${escapeHtml(t("compare.helpDetail", { mine: iCanHelp.length, friend: friendCanHelp.length, friendName: bName }))}</span></div></div>${bestCard}<div class="compare-help-panel__actions"><button type="button" data-compare-help-filter="aidable">${escapeHtml(t("compare.helpAll", { count: aidable.length }))}</button><button type="button" data-compare-help-filter="i-help">${escapeHtml(t("compare.helpMine", { count: iCanHelp.length }))}</button><button type="button" data-compare-help-filter="friend-helps">${escapeHtml(t("compare.helpFriend", { name: bName, count: friendCanHelp.length }))}</button></div></section>`;
}

function renderCompareSummary(result, aName, bName) {
  const s = result.summary;
  const safeA = escapeHtml(aName);
  const safeB = escapeHtml(bName);
  const ownerLine = (name, count, other) =>
    t("compare.ownerLine", {
      name: `<strong>${name}</strong>`,
      count: `<strong>${count}</strong>`,
      other: `<strong>${other}</strong>`,
      s: count !== 1 ? "s" : "",
      nt: count !== 1 ? "nt" : ""
    });
  const pct = (v) => (s.insufficientData ? "—" : `${v}%`);
  const warning = s.insufficientData
    ? `<p class="compare-insufficient-warning">${t("compare.insufficientData")}</p>`
    : "";
  els.compareSummary.innerHTML = `
    ${warning}
    ${renderCompareHelpPanel(result, aName, bName)}
    <div class="compare-main-indicators">
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.aPossessionRate)}</span><span class="compare-kpi__label">${t("compare.completionOf", { name: safeA })}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.bPossessionRate)}</span><span class="compare-kpi__label">${t("compare.completionOf", { name: safeB })}</span></div>
      <div class="compare-kpi compare-kpi--large"><span class="compare-kpi__value">${pct(s.collectiveCompletionRate)}</span><span class="compare-kpi__label">${t("compare.collectiveCompletion")}</span></div>
    </div>
    <div class="compare-main-summary">
      <p>${ownerLine(safeA, s.onlyUserACount, safeB)}</p>
      <p>${ownerLine(safeB, s.onlyUserBCount, safeA)}</p>
      <p>${t("compare.inCommonSentence", { count: `<strong>${s.bothOwnedCount}</strong>`, s: s.bothOwnedCount !== 1 ? "s" : "" })}</p>
      <p>${t("compare.bothMissingSentence", { count: `<strong>${s.bothMissingCount}</strong>`, s: s.bothMissingCount !== 1 ? "s" : "" })}</p>
      <p>${t("compare.togetherCover", { pct: `<strong>${pct(s.collectiveCompletionRate)}</strong>` })}</p>
    </div>
    <p class="compare-complementarity-message">${t("compare.complementarityMessage", { rate: `<strong>${pct(s.complementarityRate)}</strong>`, score: `<strong>${pct(s.complementarityScore)}</strong>` })}</p>
    <div class="compare-community" id="compareCommunityContext" hidden>
      <p class="compare-community__title">${t("compare.communityContext")}</p>
      <div class="compare-community__list" id="compareCommunityList"></div>
      <p class="compare-community__note">${t("compare.communityNote")}</p>
    </div>
    <div class="compare-summary-grid">
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.collectiveCompletionRate)}</span><span class="compare-kpi__label">${t("compare.collectiveCompletion")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.complementarityRate)}</span><span class="compare-kpi__label">${t("compare.baseComplementarity")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${pct(s.complementarityScore)}</span><span class="compare-kpi__label">${t("compare.complementarityScore")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothOwnedCount}</span><span class="compare-kpi__label">${t("compare.inCommon")}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserACount}</span><span class="compare-kpi__label">${t("compare.hasLacks", { a: safeA, b: safeB })}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.onlyUserBCount}</span><span class="compare-kpi__label">${t("compare.hasLacks", { a: safeB, b: safeA })}</span></div>
      <div class="compare-kpi"><span class="compare-kpi__value">${s.bothMissingCount}</span><span class="compare-kpi__label">${t("compare.lacksBoth")}</span></div>
    </div>
    <div class="compare-players">
      <div class="compare-player">
        <span class="compare-player__name">${safeA}</span>
        <span class="compare-player__pct">${pct(s.aPossessionRate)} ${t("compare.ownedSuffix")}</span>
        <span class="compare-player__count">${s.aOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
      <div class="compare-player">
        <span class="compare-player__name">${safeB}</span>
        <span class="compare-player__pct">${pct(s.bPossessionRate)} ${t("compare.ownedSuffix")}</span>
        <span class="compare-player__count">${s.bOwnedCount} / ${s.catalogueVariantCount}</span>
      </div>
    </div>`;
  els.compareSummary.querySelectorAll("[data-compare-help-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.compareHelpFilter = button.dataset.compareHelpFilter || "all";
      logCompareAnalytics("comparison_filter_used", {
        filter: "help",
        value: state.compareHelpFilter,
        source: "summary"
      });
      renderCompare();
    });
  });
}

/** Étape 82 — secondary community lines under the personal compare summary. */
async function loadCompareCommunityContext(result, aName, bName) {
  const mount = document.getElementById("compareCommunityContext");
  const list = document.getElementById("compareCommunityList");
  if (!mount || !list || !result || !result.groups) return;

  const pick = (arr, relation, n) =>
    (arr || []).slice(0, n).map((r) => ({
      variantId: r.variantId || r.id,
      relation
    }));
  const items = [
    ...pick(result.groups.bothMissing, "bothMissing", 3),
    ...pick(result.groups.onlyUserA, "onlyA", 2),
    ...pick(result.groups.onlyUserB, "onlyB", 2)
  ].filter((i) => i.variantId);
  if (!items.length) {
    mount.hidden = true;
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/sprite-graph/compare/community-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeadersOnly() },
      body: JSON.stringify({ items, aName, bName })
    });
    if (!res.ok) {
      mount.hidden = true;
      return;
    }
    const data = await res.json();
    const insights = Array.isArray(data.insights) ? data.insights : [];
    if (!insights.length) {
      mount.hidden = true;
      return;
    }
    const variantLabel = (variantId) => {
      const item =
        typeof getAllItems === "function"
          ? getAllItems().find((candidate) => String(candidate.id) === String(variantId))
          : null;
      return item
        ? [item.spriteName, item.variantName || item.variant].filter(Boolean).join(" · ")
        : String(variantId || "?");
    };
    const personalLine = (ins) => {
      const name = variantLabel(ins.variantId);
      if (ins.relation === "bothMissing") return t("compare.communityBothMissing", { name, a: aName, b: bName });
      if (ins.relation === "onlyA") return t("compare.communityOnlyA", { name, a: aName, b: bName });
      if (ins.relation === "onlyB") return t("compare.communityOnlyB", { name, a: aName, b: bName });
      return ins.personalLine ? t(ins.personalLine) : "";
    };
    const communityLine = (ins) => {
      if (ins.relation !== "bothMissing" && ins.priorityRateAmongMissing != null) {
        return t("compare.communityPriority", {
          rate: formatUiPercent(ins.priorityRateAmongMissing, { maximumFractionDigits: 0 })
        });
      }
      if (ins.ownershipRate != null) {
        return t("compare.communityOwnership", {
          rate: formatUiPercent(ins.ownershipRate, { maximumFractionDigits: 1 })
        });
      }
      return ins.communityLine ? t(ins.communityLine) : "";
    };
    list.innerHTML = insights
      .map(
        (ins) => `
      <div class="compare-community__item">
        ${personalLine(ins) ? `<p class="compare-community__personal">${escapeHtml(personalLine(ins))}</p>` : ""}
        ${communityLine(ins) ? `<p class="compare-community__stat">${escapeHtml(communityLine(ins))}</p>` : ""}
      </div>
    `
      )
      .join("");
    mount.hidden = false;
  } catch (_e) {
    mount.hidden = true;
  }
}
