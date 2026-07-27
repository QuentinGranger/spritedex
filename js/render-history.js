// ── History : personal collection activity dashboard ──
let historyOffset = 0;
let historyLoading = false;
let historyHasMore = true;
let historyEntries = [];
let historyFilter = "all";
let historyMeta = { total: 0, weeklyStats: [] };

function historyStatusLabel(status) {
  const keyMap = {
    owned: "history.statusOwned",
    missing: "history.statusMissing",
    priority: "history.statusPriority",
    spotted: "history.statusSpotted",
    unsure: "history.statusUnsure",
    unavailable: "history.statusUnavailable",
    unknown: "history.statusUnknown",
    new: "history.statusNew"
  };
  const key = keyMap[status];
  if (key) return t(key);
  return status ? String(status) : t("history.statusNew");
}

function statusIcon(status) {
  const map = {
    owned: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    missing: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    priority: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    unsure: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>',
    new: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'
  };
  return map[status] || map.new;
}

function spriteName(spriteId) {
  const rawId = String(spriteId || "");
  // Newer history stores the stable variant id. Resolve it from the loaded
  // catalogue first, then retain compatibility with legacy composite ids.
  const item = typeof getAllItems === "function"
    ? getAllItems().find((entry) => entry.id === rawId || entry.variantId === rawId)
    : null;
  if (item) return {
    name: item.spriteName,
    variant: item.variant || item.variantName || "Base",
    image: typeof safeImageUrl === "function" ? safeImageUrl(item.img) : "",
    sprite: SPRITES.find(s => s.id === item.spriteId) || null
  };

  const [baseId, legacyVariant] = rawId.includes("::")
    ? rawId.split("::", 2)
    : rawId.includes("__")
      ? rawId.split("__", 2)
      : [rawId, "Base"];
  const sprite = SPRITES.find(s => s.id === baseId);
  const name = sprite ? sprite.name : baseId.replace(/[_-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { name, variant: legacyVariant || "Base", image: "", sprite };
}

function historyDate(dateStr) {
  const value = new Date(dateStr);
  return Number.isNaN(value.getTime()) ? null : value;
}

function historyDateLocale() {
  return typeof appLocale === "function" && appLocale() === "en" ? "en-US" : "fr-FR";
}

function formatHistoryDate(dateStr) {
  const date = historyDate(dateStr);
  return date ? date.toLocaleDateString(historyDateLocale(), { day: "numeric", month: "short", year: "numeric" }) : t("history.dateUnknown");
}

function formatHistoryTime(dateStr) {
  const date = historyDate(dateStr);
  return date ? date.toLocaleTimeString(historyDateLocale(), { hour: "2-digit", minute: "2-digit" }) : "—";
}

function formatHistoryUpdate(dateStr) {
  const date = historyDate(dateStr);
  if (!date) return t("history.noUpdate");
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const prefix = sameDay ? t("history.today") : (date.toDateString() === yesterday.toDateString() ? t("history.yesterday") : formatHistoryDate(dateStr));
  return `${prefix} · ${formatHistoryTime(dateStr)}`;
}

function isAcquisition(item) {
  return item && item.new_status === "owned" && item.old_status !== "owned";
}

function historyItemKind(item) {
  return isAcquisition(item) ? "acquisition" : "change";
}

function historyChangeText(item) {
  const from = item.old_status ? historyStatusLabel(item.old_status) : t("history.statusNew");
  return `${from} → ${historyStatusLabel(item.new_status)}`;
}

function activityLabel(count) {
  return t(count === 1 ? "history.activityOne" : "history.activityMany", { count });
}

function renderHistoryItem(item, index) {
  const { name, variant } = spriteName(String(item.sprite_id || ""));
  const kind = historyItemKind(item);
  const changeText = historyChangeText(item);
  const dateText = t("history.dateAt", { date: formatHistoryDate(item.created_at), time: formatHistoryTime(item.created_at) });
  return `
    <article class="history-item history-item--${kind}${isAcquisition(item) ? " history-item--owned" : ""}" role="article" tabindex="0" aria-label="${escapeHtml(`${name}, ${variant}. ${changeText}. ${dateText}`)}" data-history-index="${index}">
      <div class="history-item__timeline" aria-hidden="true"><span class="history-item__icon">${statusIcon(item.new_status)}</span></div>
      <div class="history-item__body">
        <p class="history-item__title">${escapeHtml(name)} <span class="history-item__variant">${escapeHtml(variant)}</span></p>
        <p class="history-item__change"><span>${escapeHtml(historyStatusLabel(item.old_status || "new"))}</span><span class="history-item__arrow" aria-hidden="true">→</span><strong>${escapeHtml(historyStatusLabel(item.new_status))}</strong></p>
      </div>
      <span class="history-item__type history-item__type--${kind}">${kind === "acquisition" ? escapeHtml(t("history.typeAcquisition")) : escapeHtml(t("history.typeChange"))}</span>
      <time class="history-item__date" datetime="${escapeHtml(String(item.created_at || ""))}" title="${escapeHtml(dateText)}">
        <span class="history-item__day">${escapeHtml(formatHistoryDate(item.created_at))}</span>
        <span class="history-item__time">${escapeHtml(formatHistoryTime(item.created_at))}</span>
      </time>
    </article>`;
}

function weeklyData(weeks) {
  return (Array.isArray(weeks) ? weeks : []).map(week => ({
    date: historyDate(week.week),
    changes: safeFiniteNumber(week.changes, 0, { min: 0, max: 1000000 }),
    acquisitions: safeFiniteNumber(week.acquisitions, 0, { min: 0, max: 1000000 })
  })).filter(week => week.date).sort((a, b) => a.date - b.date);
}

function historyTotals() {
  const weeks = weeklyData(historyMeta.weeklyStats);
  const acquisitions = weeks.reduce((sum, week) => sum + week.acquisitions, 0);
  const changes = weeks.reduce((sum, week) => sum + week.changes, 0);
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0 && weeks[i].changes > 0; i -= 1) streak += 1;
  return { weeks, acquisitions, changes, nonAcquisition: Math.max(0, changes - acquisitions), streak };
}

function renderHistoryKpis() {
  const stats = document.getElementById("historyStats");
  if (!stats) return;
  const { acquisitions, nonAcquisition, streak } = historyTotals();
  const latest = historyEntries[0];
  const streakHint = streak > 1 ? t("history.kpiStreakWeekOther") : t("history.kpiStreakWeekOne");
  const cards = [
    { key: "acquisition", icon: "↓", label: t("history.kpiAcquisitionLabel"), value: acquisitions, hint: t("history.kpiAcquisitionHint") },
    { key: "change", icon: "⇄", label: t("history.kpiChangeLabel"), value: nonAcquisition, hint: t("history.kpiChangeHint") },
    { key: "streak", icon: "♨", label: t("history.kpiStreakLabel"), value: streak, hint: streakHint },
    { key: "updated", icon: "▣", label: t("history.kpiUpdatedLabel"), value: latest ? formatHistoryDate(latest.created_at) : "—", hint: latest ? formatHistoryTime(latest.created_at) : t("history.kpiNoActivity") }
  ];
  stats.innerHTML = cards.map(card => `
    <article class="history-kpi history-kpi--${card.key}">
      <span class="history-kpi__icon" aria-hidden="true">${card.icon}</span>
      <span class="history-kpi__label">${card.label}</span>
      <strong class="history-kpi__value">${escapeHtml(String(card.value))}</strong>
      <span class="history-kpi__hint">${escapeHtml(card.hint)}</span>
    </article>`).join("");
}

function renderWeeklyChart(weeks) {
  const rows = weeklyData(weeks);
  const max = Math.max(...rows.map(row => row.changes), 1);
  const total = rows.reduce((sum, row) => sum + row.changes, 0);
  const bars = rows.length ? rows.map(row => {
    const label = row.date.toLocaleDateString(historyDateLocale(), { day: "numeric", month: "short" });
    const pct = Math.max(5, Math.round((row.changes / max) * 100));
    const weekStr = t("history.chartBarWeek", { date: label });
    const acqStr = t("history.chartBarAcq", { count: row.acquisitions, plural: row.acquisitions > 1 ? "s" : "" });
    const barAria = `${weekStr} : ${activityLabel(row.changes)}, ${acqStr}`;
    return `<li class="history-trend__bar" style="--history-bar:${pct}%" aria-label="${escapeHtml(barAria)}"><span class="history-trend__bar-value">${row.changes}</span><span class="history-trend__bar-column" aria-hidden="true"></span><span class="history-trend__bar-label">${label}</span></li>`;
  }).join("") : `<li class="history-trend__empty">${escapeHtml(t("history.chartEmpty"))}</li>`;
  return `
    <header class="history-panel__header">
      <div><p class="history-panel__eyebrow">${escapeHtml(t("history.chartEyebrow"))}</p><h3 id="historyTrendTitle">${escapeHtml(t("history.chartTitle"))}</h3></div>
      <span class="history-panel__meta">${escapeHtml(activityLabel(total))}</span>
    </header>
    <div class="history-trend__plot" role="img" aria-label="${escapeHtml(`${activityLabel(total)} — ${t("history.chartEyebrow")}`)}"><ol class="history-trend__bars">${bars}</ol></div>`;
}

function renderRecentAcquisitions() {
  const target = document.getElementById("historyRecent");
  if (!target) return;
  const acquisitions = historyEntries.filter(isAcquisition).slice(0, 4);
  target.setAttribute("aria-busy", "false");
  target.innerHTML = `
    <header class="history-panel__header"><div><p class="history-panel__eyebrow">${escapeHtml(t("history.recentEyebrow"))}</p><h3 id="historyRecentTitle">${escapeHtml(t("history.recentTitle"))}</h3></div></header>
    ${acquisitions.length ? `<ul class="history-recent__list">${acquisitions.map(item => {
      const { name, variant, image } = spriteName(String(item.sprite_id || ""));
      const thumbnail = image
        ? `<img src="${escapeHtml(image)}" alt="" />`
        : statusIcon("owned");
      return `<li class="history-recent__item"><span class="history-recent__avatar" aria-hidden="true">${thumbnail}</span><span class="history-recent__name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(variant)}</small></span><time datetime="${escapeHtml(String(item.created_at || ""))}">${escapeHtml(formatHistoryUpdate(item.created_at))}</time></li>`;
    }).join("")}</ul>` : `<p class="history-panel__empty">${escapeHtml(t("history.recentEmpty"))}</p>`}`;
}

function renderActionSummary() {
  const target = document.getElementById("historyActionSummary");
  if (!target) return;
  const { acquisitions, changes } = historyTotals();
  const regressions = Math.min(
    historyEntries.filter(item => item.old_status === "owned" && item.new_status !== "owned").length,
    Math.max(0, changes - acquisitions)
  );
  const otherChanges = Math.max(0, changes - acquisitions - regressions);
  const acquisitionPercent = changes ? Math.round((acquisitions / changes) * 100) : 0;
  const changeEndPercent = changes ? Math.round(((acquisitions + otherChanges) / changes) * 100) : 0;
  target.setAttribute("aria-busy", "false");
  target.innerHTML = `
    <header class="history-panel__header"><div><p class="history-panel__eyebrow">${escapeHtml(t("history.summaryEyebrow"))}</p><h3 id="historyActionSummaryTitle">${escapeHtml(t("history.summaryTitle"))}</h3></div></header>
    <div class="history-action-summary">
      <div class="history-action-summary__ring" style="--history-acquisition:${acquisitionPercent}%;--history-change-end:${changeEndPercent}%" role="img" aria-label="${escapeHtml(t("history.summaryActionsAria", { count: changes }))}"><strong>${changes}</strong><span>${escapeHtml(t("history.summaryActions"))}</span></div>
      <ul class="history-action-summary__legend"><li><span class="history-action-summary__dot history-action-summary__dot--acquisition"></span>${escapeHtml(t("history.summaryAcquisitions"))} <strong>${acquisitions}</strong></li><li><span class="history-action-summary__dot history-action-summary__dot--change"></span>${escapeHtml(t("history.summaryChanges"))} <strong>${otherChanges}</strong></li><li><span class="history-action-summary__dot history-action-summary__dot--regression"></span>${escapeHtml(t("history.summaryRegressions"))} <strong>${regressions}</strong></li></ul>
    </div>`;
}

function renderActiveSprites() {
  const target = document.getElementById("historyActiveSprites");
  if (!target) return;
  const counts = new Map();
  historyEntries.forEach(item => counts.set(item.sprite_id, (counts.get(item.sprite_id) || 0) + 1));
  const active = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const max = Math.max(...active.map(([, count]) => count), 1);
  target.setAttribute("aria-busy", "false");
  target.innerHTML = `
    <header class="history-panel__header"><div><p class="history-panel__eyebrow">${escapeHtml(t("history.activeEyebrow"))}</p><h3 id="historyActiveSpritesTitle">${escapeHtml(t("history.activeTitle"))}</h3></div></header>
    ${active.length ? `<ol class="history-active__list">${active.map(([spriteId, count], index) => {
      const { name } = spriteName(String(spriteId || ""));
      const actionText = t(count === 1 ? "history.actionsOne" : "history.actionsMany", { count });
      return `<li><span class="history-active__rank">${index + 1}</span><strong>${escapeHtml(name)}</strong><span class="history-active__bar"><i style="--history-active:${Math.round((count / max) * 100)}%"></i></span><span>${actionText}</span></li>`;
    }).join("")}</ol>` : `<p class="history-panel__empty">${escapeHtml(t("history.activeEmpty"))}</p>`}`;
}

function filteredHistoryEntries() {
  return historyFilter === "all" ? historyEntries : historyEntries.filter(item => historyItemKind(item) === historyFilter);
}

function renderHistoryList() {
  const list = document.getElementById("historyList");
  const count = document.getElementById("historyActivityCount");
  if (!list) return;
  const entries = filteredHistoryEntries();
  const totalLabel = entries.length === 1
    ? t(historyFilter === "all" ? "history.totalLoadedOne" : "history.totalShownOne", { count: entries.length })
    : t(historyFilter === "all" ? "history.totalLoadedMany" : "history.totalShownMany", { count: entries.length });
  if (count) count.textContent = totalLabel;
  list.setAttribute("aria-busy", "false");
  if (!entries.length) {
    list.innerHTML = `<p class="squad-empty">${escapeHtml(historyEntries.length ? t("history.listEmpty") : t("history.listEmptyAll"))}</p>`;
    return;
  }
  list.innerHTML = entries.map(renderHistoryItem).join("") + (!historyHasMore ? `<p class="history-end">${escapeHtml(t("history.listEnd"))}</p>` : "");
}

function renderHistoryDashboard(data) {
  historyMeta = { total: safeFiniteNumber(data.total, 0, { min: 0, max: 1000000 }), weeklyStats: Array.isArray(data.weeklyStats) ? data.weeklyStats : [] };
  renderHistoryKpis();
  const weeklyEl = document.getElementById("historyWeekly");
  if (weeklyEl) {
    weeklyEl.setAttribute("aria-busy", "false");
    weeklyEl.innerHTML = renderWeeklyChart(historyMeta.weeklyStats);
  }
  renderRecentAcquisitions();
  renderActionSummary();
  renderActiveSprites();
}

function setHistoryFilter(nextFilter) {
  historyFilter = ["all", "acquisition", "change"].includes(nextFilter) ? nextFilter : "all";
  document.querySelectorAll("[data-history-filter]").forEach(button => {
    const active = button.dataset.historyFilter === historyFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderHistoryList();
}

function setupHistoryControls() {
  document.querySelectorAll("[data-history-filter]").forEach(button => {
    if (button.dataset.historyBound === "true") return;
    button.dataset.historyBound = "true";
    button.addEventListener("click", () => setHistoryFilter(button.dataset.historyFilter));
  });
}

async function loadMoreHistory() {
  if (historyLoading || !historyHasMore) return;
  historyLoading = true;
  const list = document.getElementById("historyList");
  if (!list) { historyLoading = false; return; }
  list.setAttribute("aria-busy", "true");

  try {
    const res = await fetch(`${API_BASE}/history/${state.userId}?limit=30&offset=${historyOffset}`, { headers: authHeadersOnly() });
    if (!res.ok) {
      if (historyOffset === 0) list.innerHTML = `<p class="squad-empty">${escapeHtml(t("history.loadError"))}</p>`;
      return;
    }
    const data = await res.json();
    const incoming = Array.isArray(data.history) ? data.history : [];
    historyHasMore = Boolean(data.hasMore);
    if (historyOffset === 0) renderHistoryDashboard(data);
    historyEntries.push(...incoming);
    historyOffset += incoming.length;
    renderHistoryKpis();
    renderRecentAcquisitions();
    renderActionSummary();
    renderActiveSprites();
    renderHistoryList();
  } catch (_) {
    if (historyOffset === 0) list.innerHTML = `<p class="squad-empty">${escapeHtml(t("history.networkError"))}</p>`;
  } finally {
    list.setAttribute("aria-busy", "false");
    historyLoading = false;
  }
}

function renderHistory() {
  historyOffset = 0;
  historyHasMore = true;
  historyLoading = false;
  historyEntries = [];
  historyMeta = { total: 0, weeklyStats: [] };
  setupHistoryControls();
  const list = document.getElementById("historyList");
  if (list) {
    list.innerHTML = `<p class="squad-empty">${escapeHtml(t("history.loading"))}</p>`;
    list.setAttribute("aria-busy", "true");
    list.onscroll = () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 60) loadMoreHistory();
    };
  }
  loadMoreHistory();
}
