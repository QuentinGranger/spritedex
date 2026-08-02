"use strict";

function renderSquadHunt(rows, players, items) {
  const nobodyRows = rows.filter(r => r.nobodyHasIt);
  const everyoneRows = rows.filter(r => r.everyoneHasIt);
  const partialRows = rows.filter(r => r.ownedCount > 0 && !r.everyoneHasIt);

  const parts = [];

  if (nobodyRows.length > 0) {
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--nobody">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">${t("squad.filterMissingAll")}</h3>`);
    parts.push(t("squad.huntNobody", { count: nobodyRows.length }));
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list">`);
    for (const row of nobodyRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
      }
      const priorityByLabel = escapeHtml(row.priorityBy.join(", "));
      const prioTag = row.priorityBy.length > 0
        ? ` <span class="hunt-prio" title="${t('squad.priorityFor', { name: priorityByLabel })}"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${priorityByLabel}</span>`
        : "";
      parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span>${prioTag}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (partialRows.length > 0) {
    if (nobodyRows.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--partial">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20" fill="currentColor"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">${t("squad.huntSomeHave")}</h3>`);
    parts.push(t("squad.huntPartial", { count: partialRows.length }));
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list">`);
    for (const row of partialRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
      }
      parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span><span class="hunt-owners">${escapeHtml(row.ownedBy.join(", "))}</span></li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (everyoneRows.length > 0) {
    if (nobodyRows.length > 0 || partialRows.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    parts.push(`<div class="hunt-section hunt-section--collapsed" id="huntEveryoneSection">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--done hunt-section__toggle" data-toggle="huntEveryoneList">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">${t("squad.filterEveryone")}</h3>`);
    parts.push(t("squad.huntEveryone", { count: everyoneRows.length }));
    parts.push(`<span class="hunt-section__chevron">›</span>`);
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list hunt-list--collapsed" id="huntEveryoneList">`);
    for (const row of everyoneRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
      }
      parts.push(`<li class="hunt-list__item hunt-list__item--done"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span></li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (nobodyRows.length === 0 && partialRows.length === 0 && everyoneRows.length === 0) {
    parts.push(`<div class="hunt-section"><div class="hunt-section__header hunt-section__header--done"><span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><div><h3 class="hunt-section__title">${t("squad.allFoundTitle")}</h3><p class="hunt-section__sub">${t("squad.allFoundSub")}</p></div></div></div>`);
  }

  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : Duel 1v1 view ──
