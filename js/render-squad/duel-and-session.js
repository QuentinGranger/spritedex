"use strict";

function renderSquadDuel(rows, players, items) {
  const idxA = parseInt(els.duelPlayerA.value) || 0;
  const idxB = parseInt(els.duelPlayerB.value) || (players.length > 1 ? 1 : 0);
  const pA = players[idxA];
  const pB = players[idxB];
  if (!pA || !pB) return;

  const common = [];
  const onlyA = [];
  const onlyB = [];

  for (const row of rows) {
    const sA = row.statuses[idxA];
    const sB = row.statuses[idxB];
    const aOwned = sA === "owned";
    const bOwned = sB === "owned";

    if (aOwned && bOwned) common.push(row);
    else if (aOwned && !bOwned) onlyA.push(row);
    else if (!aOwned && bOwned) onlyB.push(row);
  }

  const parts = [];

  function buildDuelSection(title, icon, colorClass, sectionRows, subtitle) {
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header ${colorClass}">`);
    parts.push(`<span class="hunt-section__icon">${icon}</span>`);
    parts.push(`<div><h3 class="hunt-section__title">${title}</h3>`);
    parts.push(t("squad.duelSection", { count: sectionRows.length, subtitle: subtitle || "" }));
    parts.push(`</div>`);

    if (sectionRows.length > 0) {
      let currentSprite = "";
      parts.push(`<ul class="hunt-list">`);
      for (const row of sectionRows) {
        if (row.item.spriteName !== currentSprite) {
          currentSprite = row.item.spriteName;
          parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
        }
        parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span></li>`);
      }
      parts.push(`</ul>`);
    }
    parts.push(`</div>`);
  }

  if (onlyA.length > 0) {
    buildDuelSection(t("squad.duelOnlyA", { a: escapeHtml(pA.name), b: escapeHtml(pB.name) }), "→", "hunt-section__header--partial", onlyA, t("squad.duelSubtitle"));
  }

  if (onlyB.length > 0) {
    if (onlyA.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    buildDuelSection(t("squad.duelOnlyB", { a: escapeHtml(pA.name), b: escapeHtml(pB.name) }), "←", "hunt-section__header--nobody", onlyB, t("squad.duelSubtitle"));
  }

  if (common.length > 0) {
    if (onlyA.length > 0 || onlyB.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    buildDuelSection(t("squad.inCommon"), "∩", "hunt-section__header--done", common, "");
  }

  if (onlyA.length === 0 && onlyB.length === 0 && common.length === 0) {
    parts.push(`<p class="squad-empty">${t("squad.noDuelData")}</p>`);
  }

  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : Session rapide view ──
function renderSquadSession(players, items) {
  const allDiffs = computeSquadDiffs(items, players, "all", "");

  const prioItems = allDiffs
    .filter(r => r.priorityBy.length > 0 && !r.everyoneHasIt)
    .sort((a, b) => b.missingCount - a.missingCount);

  const nobodyItems = allDiffs
    .filter(r => r.nobodyHasIt)
    .sort((a, b) => {
      const ra = RARITY_ORDER[a.item.rarity] ?? 9;
      const rb = RARITY_ORDER[b.item.rarity] ?? 9;
      return ra - rb;
    });

  const toCheck = allDiffs
    .filter(r => {
      return r.statuses.some(s => s === "unsure" || s === "spotted");
    });

  const total = items.length;
  const atLeastOne = allDiffs.filter(r => r.ownedCount > 0).length;
  const teamPct = collectionPercent(atLeastOne, total);

  const parts = [];
  parts.push(`<div class="session-view">`);

  parts.push(`<div class="session-header">`);
  parts.push(`<span class="session-header__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>`);
  parts.push(`<div><h3 class="session-header__title">${t("squad.sessionMode")}</h3>`);
  parts.push(`<p class="session-header__sub">${t("squad.sessionProgress", { pct: teamPct, found: atLeastOne, total: total })}</p></div>`);
  parts.push(`</div>`);

  if (prioItems.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--prio"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${t("squad.prioritiesHeader")}</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of prioItems.slice(0, 15)) {
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${escapeHtml(r.item.spriteName)} <span class="session-list__variant">${escapeHtml(r.item.variant)}</span></span>`);
      parts.push(`<span class="session-list__meta session-list__meta--missing">${t("squad.missingTo", { count: r.missingCount })}</span>`);
      parts.push(`</li>`);
    }
    if (prioItems.length > 15) {
      parts.push(`<li class="session-list__more">+${prioItems.length - 15} ${t("engine.more")}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (nobodyItems.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--nobody"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ${t("squad.filterMissingAll")}</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of nobodyItems.slice(0, 20)) {
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${escapeHtml(r.item.spriteName)} <span class="session-list__variant">${escapeHtml(r.item.variant)}</span></span>`);
      parts.push(`<span class="squad-table__rarity">${escapeHtml(localizedRarity(r.item.rarity))}</span>`);
      parts.push(`</li>`);
    }
    if (nobodyItems.length > 20) {
      parts.push(`<li class="session-list__more">+${nobodyItems.length - 20} ${t("engine.more")}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (toCheck.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--check">? ${t("squad.toCheck")}</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of toCheck.slice(0, 15)) {
      const who = players.filter((_, i) => r.statuses[i] === "unsure" || r.statuses[i] === "spotted").map(p => p.name);
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${escapeHtml(r.item.spriteName)} <span class="session-list__variant">${escapeHtml(r.item.variant)}</span></span>`);
      parts.push(`<span class="session-list__meta session-list__meta--check">${escapeHtml(who.join(", "))}</span>`);
      parts.push(`</li>`);
    }
    if (toCheck.length > 15) {
      parts.push(`<li class="session-list__more">+${toCheck.length - 15} ${t("engine.more")}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (prioItems.length === 0 && nobodyItems.length === 0 && toCheck.length === 0) {
    parts.push(`<div class="session-block"><p class="squad-empty">${t("squad.allGood")}</p></div>`);
  }

  parts.push(`</div>`);

  els.squadCounter.innerHTML = "";
  els.squadTableWrap.innerHTML = parts.join("");
}

