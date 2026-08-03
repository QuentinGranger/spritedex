"use strict";

function buildSquadSummary(players, items) {
  const total = items.length;
  if (total === 0) return "";

  const atLeastOne = items.filter((i) => players.some((p) => (p.collection[i.id]?.status || "new") === "owned")).length;
  const everyoneCount = items.filter((i) =>
    players.every((p) => (p.collection[i.id]?.status || "new") === "owned")
  ).length;
  const nobodyCount = total - atLeastOne;
  const teamPct = collectionPercent(atLeastOne, total);
  const fullPct = collectionPercent(everyoneCount, total);

  const stats = players.map((p) => {
    const owned = items.filter((i) => (p.collection[i.id]?.status || "new") === "owned").length;
    return { name: p.name, owned, total, pct: collectionPercent(owned, total) };
  });

  const uniqueMap = players.map((p, pi) => {
    return items.filter((i) => {
      const myStatus = p.collection[i.id]?.status || "new";
      if (myStatus !== "owned") return false;
      return players.every((other, oi) => oi === pi || (other.collection[i.id]?.status || "new") !== "owned");
    }).length;
  });

  const parts = [];

  parts.push(`<div class="squad-summary">`);
  parts.push(`<div class="team-score">`);
  parts.push(
    `<div class="team-score__ring"><svg viewBox="0 0 36 36" class="team-score__svg"><path class="team-score__bg" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831" /><path class="team-score__fill" stroke-dasharray="${teamPct}, 100" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831" /></svg><span class="team-score__pct">${teamPct}%</span></div>`
  );
  parts.push(`<div class="team-score__details">`);
  parts.push(`<h3 class="team-score__title">${t("squad.teamProgress")}</h3>`);
  parts.push(`<div class="team-score__rows">`);
  parts.push(
    `<div class="team-score__row"><span class="team-score__label">${t("squad.atLeastOne")}</span><span class="team-score__val team-score__val--good">${atLeastOne} / ${total}</span></div>`
  );
  parts.push(
    `<div class="team-score__row"><span class="team-score__label">${t("squad.wholeSquad")}</span><span class="team-score__val team-score__val--full">${everyoneCount} / ${total}</span></div>`
  );
  parts.push(
    `<div class="team-score__row"><span class="team-score__label">${t("squad.filterMissingAll")}</span><span class="team-score__val team-score__val--nobody">${nobodyCount} / ${total}</span></div>`
  );
  parts.push(`</div></div></div>`);

  parts.push(`<div class="squad-summary__divider"></div>`);
  parts.push(`<h4 class="squad-summary__subtitle">${t("squad.perPlayer")}</h4>`);
  parts.push(`<div class="squad-summary__grid">`);
  stats.forEach((s, i) => {
    parts.push(`<div class="squad-stat">
      <span class="squad-stat__name">${escapeHtml(s.name)}</span>
      <div class="squad-stat__bar"><div class="squad-stat__fill" style="width:${s.pct}%"></div></div>
      <span class="squad-stat__pct">${s.owned}/${s.total} (${s.pct}%)</span>
      <span class="squad-stat__unique">${t("squad.uniqueExcl", { count: uniqueMap[i] })}</span>
    </div>`);
  });
  parts.push(`</div></div>`);
  return parts.join("");
}
