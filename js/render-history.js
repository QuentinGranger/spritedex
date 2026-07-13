// ── History : Render ──
let historyOffset = 0;
let historyLoading = false;
let historyHasMore = true;

function statusLabelFR(status) {
  const map = { owned: "Obtenu", missing: "Manquant", priority: "Prioritaire", unsure: "À vérifier", new: "Nouveau" };
  return map[status] || status;
}

function statusIcon(status) {
  const map = {
    owned: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    missing: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    priority: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    unsure: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>',
    new: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'
  };
  return map[status] || map.new;
}

function spriteName(spriteId) {
  const baseId = spriteId.split("__")[0];
  const sprite = SPRITES.find(s => s.id === baseId);
  const variant = spriteId.includes("__") ? spriteId.split("__")[1] : "Base";
  const name = sprite ? sprite.name : baseId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return { name, variant };
}

function formatHistoryDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function formatHistoryTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function renderHistoryItem(item) {
  const { name, variant } = spriteName(item.sprite_id);
  const isAcquisition = item.new_status === "owned";
  return `
    <div class="history-item${isAcquisition ? " history-item--owned" : ""}">
      <div class="history-item__icon">${statusIcon(item.new_status)}</div>
      <div class="history-item__body">
        <p class="history-item__title">${name} <span class="history-item__variant">${variant}</span></p>
        <p class="history-item__change">${statusLabelFR(item.old_status)} → ${statusLabelFR(item.new_status)}</p>
      </div>
      <div class="history-item__date">
        <span class="history-item__day">${formatHistoryDate(item.created_at)}</span>
        <span class="history-item__time">${formatHistoryTime(item.created_at)}</span>
      </div>
    </div>`;
}

function renderWeeklyChart(weeks) {
  if (!weeks || weeks.length === 0) return "";
  const maxVal = Math.max(...weeks.map(w => parseInt(w.changes)), 1);
  const bars = weeks.map(w => {
    const pct = Math.round((parseInt(w.changes) / maxVal) * 100);
    const acq = parseInt(w.acquisitions);
    const weekLabel = new Date(w.week).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    return `
      <div class="history-bar">
        <div class="history-bar__fill" style="height:${pct}%">
          <span class="history-bar__val">${w.changes}</span>
        </div>
        <span class="history-bar__label">${weekLabel}</span>
      </div>`;
  }).reverse().join("");

  const totalChanges = weeks.reduce((s, w) => s + parseInt(w.changes), 0);
  const totalAcq = weeks.reduce((s, w) => s + parseInt(w.acquisitions), 0);

  return `
    <div class="history-summary">
      <div class="history-summary__item">
        <span class="history-summary__val">${totalAcq}</span>
        <span class="history-summary__label">Acquisitions (12 sem.)</span>
      </div>
      <div class="history-summary__item">
        <span class="history-summary__val">${totalChanges}</span>
        <span class="history-summary__label">Changements (12 sem.)</span>
      </div>
    </div>
    <div class="history-chart">${bars}</div>`;
}

async function loadMoreHistory() {
  if (historyLoading || !historyHasMore) return;
  historyLoading = true;

  const list = document.getElementById("historyList");
  if (!list) { historyLoading = false; return; }

  try {
    const res = await fetch(`${API_BASE}/history/${state.userId}?limit=30&offset=${historyOffset}`, { headers: authHeadersOnly() });
    if (!res.ok) {
      if (historyOffset === 0) list.innerHTML = `<p class="squad-empty">Impossible de charger l'historique.</p>`;
      historyLoading = false;
      return;
    }
    const data = await res.json();
    const history = data.history || [];
    historyHasMore = data.hasMore;

    if (historyOffset === 0) {
      const weeklyEl = document.getElementById("historyWeekly");
      if (weeklyEl) weeklyEl.innerHTML = renderWeeklyChart(data.weeklyStats);

      const statsEl = document.getElementById("historyStats");
      if (statsEl) statsEl.innerHTML = `<p class="history-total">${data.total} changement${data.total > 1 ? "s" : ""} enregistré${data.total > 1 ? "s" : ""}</p>`;
    }

    if (history.length === 0 && historyOffset === 0) {
      list.innerHTML = `<p class="squad-empty">Aucun historique. Commence à classer tes sprites !</p>`;
      historyLoading = false;
      return;
    }

    if (historyOffset === 0) list.innerHTML = "";
    const html = history.map(renderHistoryItem).join("");
    list.insertAdjacentHTML("beforeend", html);
    historyOffset += history.length;

    if (!historyHasMore) {
      list.insertAdjacentHTML("beforeend", `<p class="history-end">Fin de l'historique</p>`);
    }
  } catch (e) {
    if (historyOffset === 0) list.innerHTML = `<p class="squad-empty">Erreur réseau.</p>`;
  }
  historyLoading = false;
}

function renderHistory() {
  historyOffset = 0;
  historyHasMore = true;
  const list = document.getElementById("historyList");
  if (list) {
    list.innerHTML = `<p class="squad-empty">Chargement…</p>`;
    list.onscroll = () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 60) {
        loadMoreHistory();
      }
    };
  }
  loadMoreHistory();
}
