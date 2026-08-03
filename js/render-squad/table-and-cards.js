"use strict";

function renderSquadTable(rows, players, items) {
  const colCount = players.length;
  const parts = [];
  parts.push(`<table class="squad-table"><thead><tr><th class="squad-table__sprite">${t("squad.variantHeader")}</th>`);
  for (const p of players) {
    const shortName = escapeHtml(p.name.length > 8 ? p.name.slice(0, 7) + "…" : p.name);
    parts.push(`<th class="squad-table__player" title="${escapeHtml(p.name)}">${shortName}</th>`);
  }
  parts.push(`</tr></thead><tbody>`);

  let currentSprite = "";
  for (const row of rows) {
    const spriteName = row.item.spriteName;
    if (spriteName !== currentSprite) {
      currentSprite = spriteName;
      parts.push(
        `<tr class="squad-table__sprite-header"><td colspan="${colCount + 1}"><span class="squad-table__sprite-name">${escapeHtml(spriteName)}</span><span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></td></tr>`
      );
    }
    parts.push(`<tr class="squad-table__row"><td class="squad-table__variant">${escapeHtml(row.item.variant)}</td>`);
    for (const status of row.statuses) {
      const cls =
        status === "owned" ? "squad-cell--owned" : status === "new" ? "squad-cell--new" : "squad-cell--missing";
      parts.push(`<td class="squad-table__cell ${cls}">${squadIcon(status)}</td>`);
    }
    parts.push(`</tr>`);
  }

  parts.push(`</tbody></table>`);
  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : "Manque à qui ?" cards view ──
function renderSquadCards(rows, players, items) {
  const parts = [];
  parts.push(`<div class="squad-cards">`);

  for (const row of rows) {
    parts.push(`<div class="squad-card">`);
    parts.push(`<div class="squad-card__header">`);
    parts.push(`<span class="squad-card__name">${escapeHtml(row.item.spriteName)}</span>`);
    parts.push(`<span class="squad-card__variant">${escapeHtml(row.item.variant)}</span>`);
    parts.push(`<span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span>`);
    parts.push(`<span class="squad-card__ratio">${row.ownedCount}/${players.length}</span>`);
    parts.push(`</div>`);

    if (row.ownedBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--owned">`);
      parts.push(`<span class="squad-card__label">${t("squad.ownedByLabel")}</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.ownedBy) {
        parts.push(`<span class="squad-card__player squad-card__player--owned">${escapeHtml(name)}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.priorityBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--prio">`);
      parts.push(`<span class="squad-card__label">${t("squad.priorityFor2")}</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.priorityBy) {
        parts.push(`<span class="squad-card__player squad-card__player--prio">${escapeHtml(name)}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.missingBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--missing">`);
      parts.push(`<span class="squad-card__label">${t("squad.missingByLabel")}</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.missingBy) {
        parts.push(`<span class="squad-card__player squad-card__player--missing">${escapeHtml(name)}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.nobodyHasIt) {
      parts.push(`<div class="squad-card__nobody">${t("squad.filterMissingAll")}</div>`);
    }

    parts.push(`</div>`);
  }

  parts.push(`</div>`);
  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : "À farmer" hunt view ──
