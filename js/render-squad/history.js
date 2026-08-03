"use strict";

// ── Squad : unified activity history view ──
function formatSquadHistoryTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(document.documentElement.lang || "fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function renderSquadHistoryEntry(e, itemMap) {
  const meta = e.metadata || {};
  const username = escapeHtml(e.username || t("squad.anonymousUser"));
  switch (e.type) {
    case "member_joined":
      return `${t("squad.historyJoined", { name: username })}`;
    case "friendship":
      return `${t("squad.historyFriendship", { a: escapeHtml(meta.usernameA || t("squad.someone")), b: escapeHtml(meta.usernameB || t("squad.someone")) })}`;
    case "milestone":
      return `${t("squad.historyMilestone", { pct: safePercentage(meta.completionRate ?? meta.threshold, 0) })}`;
    case "goal_created":
      return `${t("squad.historyGoal", { name: username, goal: meta.goalName ? ` : ${escapeHtml(meta.goalName)}` : "" })}`;
    case "collection_update":
    default: {
      const it = itemMap.get(e.sprite_id);
      const spriteName = it ? escapeHtml(it.spriteName) : escapeHtml(meta.spriteName || e.sprite_id);
      const variant = it ? `<span class="history-list__variant">${escapeHtml(it.variant)}</span>` : "";
      const suffix = meta.firstInSquad ? ` <em>(${t("squad.historyFirstInSquad")})</em>` : "";
      return `${t("squad.historyObtained", { name: username, sprite: spriteName, variant: variant, suffix: suffix })}`;
    }
  }
}

async function renderSquadHistory() {
  els.squadCounter.innerHTML = "";
  els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.historyLoading")}</p>`;

  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/history?days=7`, {
      headers: authHeaders()
    });
    if (!res.ok) {
      els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.historyFailed")}</p>`;
      return;
    }
    const data = await res.json();
    const entries = data.entries || [];

    if (entries.length === 0) {
      els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.historyEmpty")}</p>`;
      return;
    }

    const dayMap = new Map();
    for (const e of entries) {
      const day = new Date(e.created_at).toLocaleDateString(document.documentElement.lang || "fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long"
      });
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(e);
    }

    const items = getAllItems();
    const itemMap = new Map();
    for (const it of items) itemMap.set(it.id, it);

    const parts = [];
    parts.push(`<div class="history-view">`);

    for (const [day, dayEntries] of dayMap) {
      parts.push(`<div class="history-day">`);
      parts.push(`<h3 class="history-day__title">${day}</h3>`);
      parts.push(`<ul class="history-list">`);

      for (const e of dayEntries.slice(0, 100)) {
        const time = formatSquadHistoryTime(e.created_at);
        const label = renderSquadHistoryEntry(e, itemMap);
        parts.push(`<li class="history-list__item"><span class="history-list__time">${time}</span> ${label}</li>`);
      }

      if (dayEntries.length > 100) {
        parts.push(`<li class="history-list__more">+${dayEntries.length - 100} ${t("engine.more")}</li>`);
      }
      parts.push(`</ul></div>`);
    }

    parts.push(`</div>`);
    els.squadTableWrap.innerHTML = parts.join("");
  } catch (e) {
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("common.networkError")}</p>`;
  }
}
