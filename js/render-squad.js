// ── Squad : Create ──
async function createSquad() {
  if (!state.userId) { toast("Connecte-toi d'abord"); return; }
  const name = els.squadNameInput.value.trim() || "Mon escouade";
  try {
    const res = await fetch(`${API_BASE}/squads`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId: state.userId, name })
    });
    if (!res.ok) {
      const err = await res.json();
      toast(err.error || "Erreur création");
      return;
    }
    const squad = await res.json();
    state.activeSquad = squad.code;
    localStorage.setItem("spritedex_squad", squad.code);
    toast(`Escouade créée ! Code : ${squad.code}`);
    await loadSquad(squad.code);
  } catch (e) {
    toast("Erreur réseau");
  }
}

// ── Squad : Join ──
async function joinSquad() {
  if (!state.userId) { toast("Connecte-toi d'abord"); return; }
  const code = els.squadCodeInput.value.trim().toUpperCase();
  if (!code) { toast("Entre un code d'escouade"); return; }
  try {
    const res = await fetch(`${API_BASE}/squads/join`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId: state.userId, code })
    });
    if (!res.ok) {
      const err = await res.json();
      toast(err.error || "Erreur");
      return;
    }
    const squad = await res.json();
    state.activeSquad = squad.code;
    localStorage.setItem("spritedex_squad", squad.code);
    toast(`Rejoint : ${squad.name}`);
    await loadSquad(squad.code);
  } catch (e) {
    toast("Erreur réseau");
  }
}

// ── Squad : Leave ──
async function leaveSquad() {
  if (!state.activeSquad || !state.userId) return;
  try {
    await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/leave`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId: state.userId })
    });
  } catch (e) {
    console.warn("Leave failed", e);
  }
  state.activeSquad = null;
  state.squadMembers = [];
  localStorage.removeItem("spritedex_squad");
  showSquadLobby();
  toast("Tu as quitté l'escouade");
}

// ── Squad : Load from server ──
async function loadSquad(code) {
  if (!code) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}`, { headers: authHeaders() });
    if (!res.ok) {
      toast("Escouade introuvable");
      state.activeSquad = null;
      localStorage.removeItem("spritedex_squad");
      showSquadLobby();
      return;
    }
    const data = await res.json();
    state.activeSquad = data.code;
    state.squadCreatedBy = data.createdBy;
    state.squadJoinOpen = data.joinOpen !== false;
    state.squadMembers = data.members.filter(m => String(m.userId) !== String(state.userId));

    els.squadActiveName.textContent = data.name;
    els.squadActiveCode.textContent = data.code;
    showSquadActive();
    renderSquadAdmin();
    renderSquad();
  } catch (e) {
    toast("Erreur réseau");
  }
}

// ── Squad : restore on init ──
async function restoreSquad() {
  connectSquadWs();
  const code = localStorage.getItem("spritedex_squad");
  if (code && state.userId) {
    state.activeSquad = code;
    await loadSquad(code);
  }
}

// ── Squad : WebSocket real-time ──
let squadWs = null;
let wsReconnectTimer = null;

function connectSquadWs() {
  if (squadWs && squadWs.readyState <= 1) return;
  if (!state.userId) return;

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  squadWs = new WebSocket(`${protocol}//${location.host}`);

  squadWs.onopen = () => {
    // Authenticate the WS with the session token; the server derives the userId
    // from it (never trusts a client-supplied id).
    squadWs.send(JSON.stringify({ type: "auth", token: localStorage.getItem(TOKEN_KEY) }));
  };

  squadWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "squad_update" && msg.code === state.activeSquad) {
        loadSquad(state.activeSquad);
      }
      if (msg.type === "news_update") {
        checkNewsNotifications();
        if (notifDropdownOpen) {
          notifOffset = 0;
          notifHasMore = true;
          const list = document.getElementById("notifList");
          if (list) list.innerHTML = "";
          loadMoreNews();
        }
      }
    } catch {}
  };

  squadWs.onclose = () => {
    squadWs = null;
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectSquadWs, 3000);
  };

  squadWs.onerror = () => {
    squadWs.close();
  };
}

function disconnectSquadWs() {
  clearTimeout(wsReconnectTimer);
  if (squadWs) {
    squadWs.onclose = null;
    squadWs.close();
    squadWs = null;
  }
}

function startSquadPolling() {
  connectSquadWs();
}

function stopSquadPolling() {
  // keep WS alive across tabs, it's lightweight
}

// ── Squad : UI toggles ──
function showSquadLobby() {
  els.squadLobby.style.display = "";
  els.squadActive.style.display = "none";
  stopSquadPolling();
}

function showSquadActive() {
  els.squadLobby.style.display = "none";
  els.squadActive.style.display = "";
  populateSquadVariantOptions();
  startSquadPolling();
}

// ── Squad : Admin panel (creator only) ──
function renderSquadAdmin() {
  const wrap = document.getElementById("squadAdminWrap");
  if (!wrap) return;
  const isCreator = String(state.squadCreatedBy) === String(state.userId);
  if (!isCreator) { wrap.innerHTML = ""; return; }

  const joinLabel = state.squadJoinOpen ? "Ouvert" : "Fermé";
  const joinIcon = state.squadJoinOpen ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const joinLink = `${location.origin}/squad/join/${state.activeSquad}`;

  wrap.innerHTML = `
    <div class="squad-admin">
      <h4 class="squad-admin__title"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Admin squad</h4>
      <div class="squad-admin__row">
        <span class="squad-admin__label">Lien d'invitation</span>
        <button class="ghost-button squad-admin__btn" id="adminCopyLink" title="Copier le lien"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copier</button>
      </div>
      <div class="squad-admin__link">${joinLink}</div>
      <div class="squad-admin__row">
        <span class="squad-admin__label">Accès : ${joinIcon} ${joinLabel}</span>
        <button class="ghost-button squad-admin__btn" id="adminToggleJoin">${state.squadJoinOpen ? "Fermer" : "Ouvrir"}</button>
      </div>
      <div class="squad-admin__row">
        <span class="squad-admin__label">Code actuel</span>
        <button class="ghost-button squad-admin__btn squad-admin__btn--warn" id="adminRegenCode">↻ Régénérer</button>
      </div>
      <div class="squad-admin__row">
        <button class="ghost-button squad-admin__btn squad-admin__btn--danger" id="adminDeleteSquad">Supprimer la squad</button>
      </div>
    </div>`;

  document.getElementById("adminCopyLink").addEventListener("click", () => {
    navigator.clipboard.writeText(joinLink).then(() => toast("Lien copié !"));
  });
  document.getElementById("adminToggleJoin").addEventListener("click", toggleSquadJoin);
  document.getElementById("adminRegenCode").addEventListener("click", regenerateSquadCode);
  document.getElementById("adminDeleteSquad").addEventListener("click", deleteSquad);
}

async function toggleSquadJoin() {
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/toggle-join`, {
      method: "POST", headers: authHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      state.squadJoinOpen = data.joinOpen;
      renderSquadAdmin();
      toast(data.joinOpen ? "Escouade ouverte" : "Escouade fermée");
    } else { toast(data.error); }
  } catch (e) { toast("Erreur réseau"); }
}

async function regenerateSquadCode() {
  if (!confirm("Régénérer le code ? L'ancien lien ne fonctionnera plus.")) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/regenerate`, {
      method: "POST", headers: authHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      state.activeSquad = data.code;
      localStorage.setItem("spritedex_squad", data.code);
      els.squadActiveCode.textContent = data.code;
      renderSquadAdmin();
      toast(`Nouveau code : ${data.code}`);
    } else { toast(data.error); }
  } catch (e) { toast("Erreur réseau"); }
}

async function deleteSquad() {
  if (!confirm("Supprimer l'escouade ? Cette action est irréversible.")) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}`, {
      method: "DELETE", headers: authHeaders()
    });
    if (res.ok) {
      state.activeSquad = null;
      state.squadMembers = [];
      localStorage.removeItem("spritedex_squad");
      showSquadLobby();
      toast("Escouade supprimée");
    } else {
      const data = await res.json();
      toast(data.error);
    }
  } catch (e) { toast("Erreur réseau"); }
}

async function kickSquadMember(targetUserId) {
  if (!confirm("Retirer ce membre de l'escouade ?")) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/kick`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ targetUserId })
    });
    if (res.ok) {
      toast("Membre retiré");
      await loadSquad(state.activeSquad);
    } else {
      const data = await res.json();
      toast(data.error);
    }
  } catch (e) { toast("Erreur réseau"); }
}

// ── Squad : Populate dynamic variant filter options ──
function populateSquadVariantOptions() {
  const group = document.getElementById("squadVariantGroup");
  if (!group || group.children.length > 0) return;
  const variants = Object.keys(VARIANT_META).sort();
  for (const v of variants) {
    const opt = document.createElement("option");
    opt.value = `variant:${v}`;
    opt.textContent = VARIANT_META[v].label || v;
    group.appendChild(opt);
  }
}

// ── Squad : Compute diffs for all items ──
function computeSquadDiffs(items, players, filter, query) {
  const rows = [];
  for (const item of items) {
    if (query) {
      const q = query;
      const match = item.spriteName.toLowerCase().includes(q)
        || item.variant.toLowerCase().includes(q)
        || item.rarity.toLowerCase().includes(q);
      if (!match) continue;
    }

    if (filter.startsWith("rarity:") && item.rarity !== filter.split(":")[1]) continue;
    if (filter.startsWith("variant:") && item.variant !== filter.split(":")[1]) continue;

    const statuses = [];
    const ownedBy = [];
    const missingBy = [];
    const priorityBy = [];

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const entry = p.collection[item.id];
      const status = entry ? entry.status || "new" : "new";
      const prio = entry ? entry.priority || "none" : "none";
      statuses.push(status);

      if (status === "owned") ownedBy.push(p.name);
      else missingBy.push(p.name);

      if ((prio !== "none" && prio !== "ignored") || status === "priority") {
        priorityBy.push(p.name);
      }
    }

    const ownedCount = ownedBy.length;
    const missingCount = missingBy.length;
    const everyoneHasIt = ownedCount === players.length;
    const nobodyHasIt = ownedCount === 0;
    const myStatus = statuses[0];
    const meOwned = myStatus === "owned";
    const othersOwned = statuses.slice(1).some(s => s === "owned");

    if (filter === "diff" && everyoneHasIt) continue;
    if (filter === "missing-me" && meOwned) continue;
    if (filter === "missing-all" && !nobodyHasIt) continue;
    if (filter === "exclusive" && (!meOwned || othersOwned)) continue;
    if (filter === "everyone" && !everyoneHasIt) continue;
    if (filter === "team-prio" && priorityBy.length === 0) continue;
    if (filter === "duo") {
      const hasTradeOpportunity = players.some((_, i) =>
        players.some((_, j) => i !== j && statuses[i] === "owned" && statuses[j] !== "owned")
      );
      if (!hasTradeOpportunity || everyoneHasIt) continue;
    }

    rows.push({
      item,
      statuses,
      ownedBy,
      missingBy,
      priorityBy,
      ownedCount,
      missingCount,
      everyoneHasIt,
      nobodyHasIt
    });
  }
  return rows;
}

// ── Squad : Compact status icons (fast rendering) ──
const SQUAD_ICONS = {
  owned:       '<span class="sq-icon sq-icon--owned"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>',
  missing:     '<span class="sq-icon sq-icon--missing"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>',
  priority:    '<span class="sq-icon sq-icon--priority"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>',
  unsure:      '<span class="sq-icon sq-icon--unsure"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg></span>',
  unavailable: '<span class="sq-icon sq-icon--unavail"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>',
  spotted:     '<span class="sq-icon sq-icon--spotted"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>',
  new:         '<span class="sq-icon sq-icon--new"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>'
};

function squadIcon(status) {
  if (!status || status === "new") return SQUAD_ICONS.new;
  return SQUAD_ICONS[status] || SQUAD_ICONS.new;
}

// ── Squad : Render members chips ──
function timeAgo(dateStr) {
  if (!dateStr) return "jamais sync";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `il y a ${days}j`;
}

function renderSquadMembers() {
  const me = escapeHtml(state.username || "Moi");
  const isCreator = String(state.squadCreatedBy) === String(state.userId);
  let html = `<span class="squad-chip squad-chip--me">${me}</span>`;
  state.squadMembers.forEach(m => {
    // Uses a data-kick attribute + delegated listener (see events.js) instead
    // of an inline onclick="..." handler, both to avoid re-building a CSP
    // 'unsafe-inline' script-src exception and to keep the numeric userId out
    // of directly-interpolated executable markup.
    const kick = isCreator
      ? `<button class="squad-chip__kick" data-kick="${encodeURIComponent(m.userId)}" title="Retirer">✕</button>`
      : "";
    const incomplete = (m.entryCount || 0) === 0 ? `<span class="squad-chip__warn" title="Checklist vide">?</span>` : "";
    const stale = m.lastUpdated ? `<span class="squad-chip__time" title="Dernière MAJ : ${timeAgo(m.lastUpdated)}">${timeAgo(m.lastUpdated)}</span>` : `<span class="squad-chip__time squad-chip__time--stale">jamais sync</span>`;
    html += `<span class="squad-chip">${escapeHtml(m.username)}${incomplete}${stale}${kick}</span>`;
  });
  els.squadMembers.innerHTML = html;
}

// ── Squad : Populate duel selects ──
function populateDuelSelects(players) {
  [els.duelPlayerA, els.duelPlayerB].forEach((sel, idx) => {
    const prev = sel.value;
    sel.innerHTML = "";
    players.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (prev && prev < players.length) sel.value = prev;
    else sel.value = idx < players.length ? idx : 0;
  });
  if (els.duelPlayerA.value === els.duelPlayerB.value && players.length > 1) {
    els.duelPlayerB.value = els.duelPlayerA.value === "0" ? "1" : "0";
  }
}

// ── Squad : Render comparison table ──
function renderSquad() {
  renderSquadMembers();
  els.squadDuelBar.style.display = state.squadView === "duel" ? "" : "none";

  if (state.squadMembers.length === 0) {
    els.squadCounter.textContent = "";
    els.squadTableWrap.innerHTML = `<p class="squad-empty">En attente d'autres joueurs…<br>Partage le code <strong>${state.activeSquad}</strong> à tes amis !</p>`;
    return;
  }

  const items = getAllItems();
  const me = state.username || "Moi";
  const players = [
    { name: me, collection: state.collection, lastUpdated: new Date().toISOString(), entryCount: Object.keys(state.collection).length },
    ...state.squadMembers.map(m => ({ name: m.username, collection: m.collection, lastUpdated: m.lastUpdated, entryCount: m.entryCount || 0 }))
  ];
  const filter = state.squadFilter;
  const query = state.squadSearch.trim().toLowerCase();

  const rows = computeSquadDiffs(items, players, filter, query);

  els.squadCounter.innerHTML = `<span class="squad-counter__text">${rows.length} variante${rows.length > 1 ? "s" : ""}</span>`;

  if (rows.length === 0) {
    els.squadTableWrap.innerHTML = `<p class="squad-empty">Aucun résultat pour ce filtre.</p>`;
    return;
  }

  if (state.squadView === "cards") {
    renderSquadCards(rows, players, items);
  } else if (state.squadView === "hunt") {
    renderSquadHunt(rows, players, items);
  } else if (state.squadView === "duel") {
    populateDuelSelects(players);
    renderSquadDuel(rows, players, items);
  } else if (state.squadView === "session") {
    renderSquadSession(players, items);
    return;
  } else if (state.squadView === "history") {
    renderSquadHistory();
    return;
  } else {
    renderSquadTable(rows, players, items);
  }
}

// ── Squad : Table view ──
function renderSquadTable(rows, players, items) {
  const colCount = players.length;
  const parts = [];
  parts.push(`<table class="squad-table"><thead><tr><th class="squad-table__sprite">Variante</th>`);
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
      parts.push(`<tr class="squad-table__sprite-header"><td colspan="${colCount + 1}"><span class="squad-table__sprite-name">${spriteName}</span><span class="squad-table__rarity">${row.item.rarity}</span></td></tr>`);
    }
    parts.push(`<tr class="squad-table__row"><td class="squad-table__variant">${row.item.variant}</td>`);
    for (const status of row.statuses) {
      const cls = status === "owned" ? "squad-cell--owned" : status === "new" ? "squad-cell--new" : "squad-cell--missing";
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
    parts.push(`<span class="squad-card__name">${row.item.spriteName}</span>`);
    parts.push(`<span class="squad-card__variant">${row.item.variant}</span>`);
    parts.push(`<span class="squad-table__rarity">${row.item.rarity}</span>`);
    parts.push(`<span class="squad-card__ratio">${row.ownedCount}/${players.length}</span>`);
    parts.push(`</div>`);

    if (row.ownedBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--owned">`);
      parts.push(`<span class="squad-card__label">Possédé par</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.ownedBy) {
        parts.push(`<span class="squad-card__player squad-card__player--owned">${name}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.priorityBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--prio">`);
      parts.push(`<span class="squad-card__label">Priorité pour</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.priorityBy) {
        parts.push(`<span class="squad-card__player squad-card__player--prio">${name}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.missingBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--missing">`);
      parts.push(`<span class="squad-card__label">Manque à</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.missingBy) {
        parts.push(`<span class="squad-card__player squad-card__player--missing">${name}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.nobodyHasIt) {
      parts.push(`<div class="squad-card__nobody">Personne ne l'a</div>`);
    }

    parts.push(`</div>`);
  }

  parts.push(`</div>`);
  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : "À farmer" hunt view ──
function renderSquadHunt(rows, players, items) {
  const nobodyRows = rows.filter(r => r.nobodyHasIt);
  const everyoneRows = rows.filter(r => r.everyoneHasIt);
  const partialRows = rows.filter(r => r.ownedCount > 0 && !r.everyoneHasIt);

  const parts = [];

  if (nobodyRows.length > 0) {
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--nobody">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">Personne ne l'a</h3>`);
    parts.push(`<p class="hunt-section__sub">${nobodyRows.length} variante${nobodyRows.length > 1 ? "s" : ""} à chercher ensemble</p></div>`);
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list">`);
    for (const row of nobodyRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${currentSprite} <span class="squad-table__rarity">${row.item.rarity}</span></li>`);
      }
      const priorityByLabel = escapeHtml(row.priorityBy.join(", "));
      const prioTag = row.priorityBy.length > 0
        ? ` <span class="hunt-prio" title="Priorité pour ${priorityByLabel}"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${priorityByLabel}</span>`
        : "";
      parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${row.item.variant}</span>${prioTag}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (partialRows.length > 0) {
    if (nobodyRows.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--partial">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20" fill="currentColor"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">Certains l'ont</h3>`);
    parts.push(`<p class="hunt-section__sub">${partialRows.length} variante${partialRows.length > 1 ? "s" : ""} — demandez aux autres !</p></div>`);
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list">`);
    for (const row of partialRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${currentSprite} <span class="squad-table__rarity">${row.item.rarity}</span></li>`);
      }
      parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${row.item.variant}</span><span class="hunt-owners">${escapeHtml(row.ownedBy.join(", "))}</span></li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (everyoneRows.length > 0) {
    if (nobodyRows.length > 0 || partialRows.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    parts.push(`<div class="hunt-section hunt-section--collapsed" id="huntEveryoneSection">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--done hunt-section__toggle" data-toggle="huntEveryoneList">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">Tout le monde l'a</h3>`);
    parts.push(`<p class="hunt-section__sub">${everyoneRows.length} variante${everyoneRows.length > 1 ? "s" : ""} — rien à faire ici</p></div>`);
    parts.push(`<span class="hunt-section__chevron">›</span>`);
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list hunt-list--collapsed" id="huntEveryoneList">`);
    for (const row of everyoneRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${currentSprite} <span class="squad-table__rarity">${row.item.rarity}</span></li>`);
      }
      parts.push(`<li class="hunt-list__item hunt-list__item--done"><span class="hunt-list__variant">${row.item.variant}</span></li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (nobodyRows.length === 0 && partialRows.length === 0 && everyoneRows.length === 0) {
    parts.push(`<div class="hunt-section"><div class="hunt-section__header hunt-section__header--done"><span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><div><h3 class="hunt-section__title">Beau travail !</h3><p class="hunt-section__sub">Tout a été trouvé par au moins un membre.</p></div></div></div>`);
  }

  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : Duel 1v1 view ──
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
    parts.push(`<p class="hunt-section__sub">${sectionRows.length} variante${sectionRows.length > 1 ? "s" : ""}${subtitle ? " — " + subtitle : ""}</p></div>`);
    parts.push(`</div>`);

    if (sectionRows.length > 0) {
      let currentSprite = "";
      parts.push(`<ul class="hunt-list">`);
      for (const row of sectionRows) {
        if (row.item.spriteName !== currentSprite) {
          currentSprite = row.item.spriteName;
          parts.push(`<li class="hunt-list__sprite">${currentSprite} <span class="squad-table__rarity">${row.item.rarity}</span></li>`);
        }
        parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${row.item.variant}</span></li>`);
      }
      parts.push(`</ul>`);
    }
    parts.push(`</div>`);
  }

  if (onlyA.length > 0) {
    buildDuelSection(`${pA.name} a, ${pB.name} n'a pas`, "→", "hunt-section__header--partial", onlyA, "à échanger ?");
  }

  if (onlyB.length > 0) {
    if (onlyA.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    buildDuelSection(`${pB.name} a, ${pA.name} n'a pas`, "←", "hunt-section__header--nobody", onlyB, "à échanger ?");
  }

  if (common.length > 0) {
    if (onlyA.length > 0 || onlyB.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    buildDuelSection("En commun", "∩", "hunt-section__header--done", common, "");
  }

  if (onlyA.length === 0 && onlyB.length === 0 && common.length === 0) {
    parts.push(`<p class="squad-empty">Aucune donnée pour ces deux joueurs.</p>`);
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
  const teamPct = total ? Math.round((atLeastOne / total) * 100) : 0;

  const parts = [];
  parts.push(`<div class="session-view">`);

  parts.push(`<div class="session-header">`);
  parts.push(`<span class="session-header__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>`);
  parts.push(`<div><h3 class="session-header__title">Mode Session</h3>`);
  parts.push(`<p class="session-header__sub">Progression : ${teamPct}% — ${atLeastOne}/${total} trouvés</p></div>`);
  parts.push(`</div>`);

  if (prioItems.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--prio"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Priorités squad</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of prioItems.slice(0, 15)) {
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${r.item.spriteName} <span class="session-list__variant">${r.item.variant}</span></span>`);
      parts.push(`<span class="session-list__meta session-list__meta--missing">manque à ${r.missingCount}</span>`);
      parts.push(`</li>`);
    }
    if (prioItems.length > 15) {
      parts.push(`<li class="session-list__more">+${prioItems.length - 15} autres</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (nobodyItems.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--nobody"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Personne ne l'a</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of nobodyItems.slice(0, 20)) {
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${r.item.spriteName} <span class="session-list__variant">${r.item.variant}</span></span>`);
      parts.push(`<span class="squad-table__rarity">${r.item.rarity}</span>`);
      parts.push(`</li>`);
    }
    if (nobodyItems.length > 20) {
      parts.push(`<li class="session-list__more">+${nobodyItems.length - 20} autres</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (toCheck.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--check">? À vérifier</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of toCheck.slice(0, 15)) {
      const who = players.filter((_, i) => r.statuses[i] === "unsure" || r.statuses[i] === "spotted").map(p => p.name);
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${r.item.spriteName} <span class="session-list__variant">${r.item.variant}</span></span>`);
      parts.push(`<span class="session-list__meta session-list__meta--check">${escapeHtml(who.join(", "))}</span>`);
      parts.push(`</li>`);
    }
    if (toCheck.length > 15) {
      parts.push(`<li class="session-list__more">+${toCheck.length - 15} autres</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (prioItems.length === 0 && nobodyItems.length === 0 && toCheck.length === 0) {
    parts.push(`<div class="session-block"><p class="squad-empty">Tout est en ordre ! Rien à signaler.</p></div>`);
  }

  parts.push(`</div>`);

  els.squadCounter.innerHTML = "";
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : History view ──
async function renderSquadHistory() {
  els.squadCounter.innerHTML = "";
  els.squadTableWrap.innerHTML = `<p class="squad-empty">Chargement de l'historique…</p>`;

  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/history?days=7`, {
      headers: authHeaders()
    });
    if (!res.ok) {
      els.squadTableWrap.innerHTML = `<p class="squad-empty">Impossible de charger l'historique.</p>`;
      return;
    }
    const data = await res.json();
    const entries = data.entries || [];

    if (entries.length === 0) {
      els.squadTableWrap.innerHTML = `<p class="squad-empty">Aucune activité récente dans la squad.</p>`;
      return;
    }

    const dayMap = new Map();
    for (const e of entries) {
      const day = new Date(e.created_at).toLocaleDateString("fr-FR", {
        weekday: "long", day: "numeric", month: "long"
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
      parts.push(`<h3 class="history-day__title">Session du ${day}</h3>`);

      const byUser = new Map();
      for (const e of dayEntries) {
        if (!byUser.has(e.username)) byUser.set(e.username, []);
        byUser.get(e.username).push(e);
      }

      for (const [username, userEntries] of byUser) {
        parts.push(`<div class="history-user">`);
        parts.push(`<h4 class="history-user__name">${escapeHtml(username)} <span class="history-user__count">+${userEntries.length}</span></h4>`);
        parts.push(`<ul class="history-list">`);
        for (const e of userEntries.slice(0, 30)) {
          const it = itemMap.get(e.sprite_id);
          const label = it ? `${it.spriteName} <span class="history-list__variant">${it.variant}</span>` : e.sprite_id;
          parts.push(`<li class="history-list__item">${label}</li>`);
        }
        if (userEntries.length > 30) {
          parts.push(`<li class="history-list__more">+${userEntries.length - 30} autres</li>`);
        }
        parts.push(`</ul></div>`);
      }

      parts.push(`<div class="history-day__total">La squad a progressé de <strong>+${dayEntries.length}</strong> variante${dayEntries.length > 1 ? "s" : ""}</div>`);
      parts.push(`</div>`);
    }

    parts.push(`</div>`);
    els.squadTableWrap.innerHTML = parts.join("");
  } catch (e) {
    els.squadTableWrap.innerHTML = `<p class="squad-empty">Erreur réseau.</p>`;
  }
}

// ── Squad : Summary ──
function buildSquadSummary(players, items) {
  const total = items.length;
  if (total === 0) return "";

  const atLeastOne = items.filter(i => players.some(p => (p.collection[i.id]?.status || "new") === "owned")).length;
  const everyoneCount = items.filter(i => players.every(p => (p.collection[i.id]?.status || "new") === "owned")).length;
  const nobodyCount = total - atLeastOne;
  const teamPct = Math.round((atLeastOne / total) * 100);
  const fullPct = Math.round((everyoneCount / total) * 100);

  const stats = players.map(p => {
    const owned = items.filter(i => (p.collection[i.id]?.status || "new") === "owned").length;
    return { name: p.name, owned, total, pct: Math.round((owned / total) * 100) };
  });

  const uniqueMap = players.map((p, pi) => {
    return items.filter(i => {
      const myStatus = p.collection[i.id]?.status || "new";
      if (myStatus !== "owned") return false;
      return players.every((other, oi) => oi === pi || (other.collection[i.id]?.status || "new") !== "owned");
    }).length;
  });

  const parts = [];

  parts.push(`<div class="squad-summary">`);
  parts.push(`<div class="team-score">`);
  parts.push(`<div class="team-score__ring"><svg viewBox="0 0 36 36" class="team-score__svg"><path class="team-score__bg" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831" /><path class="team-score__fill" stroke-dasharray="${teamPct}, 100" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831" /></svg><span class="team-score__pct">${teamPct}%</span></div>`);
  parts.push(`<div class="team-score__details">`);
  parts.push(`<h3 class="team-score__title">Progression équipe</h3>`);
  parts.push(`<div class="team-score__rows">`);
  parts.push(`<div class="team-score__row"><span class="team-score__label">Au moins 1 joueur</span><span class="team-score__val team-score__val--good">${atLeastOne} / ${total}</span></div>`);
  parts.push(`<div class="team-score__row"><span class="team-score__label">Toute la squad</span><span class="team-score__val team-score__val--full">${everyoneCount} / ${total}</span></div>`);
  parts.push(`<div class="team-score__row"><span class="team-score__label">Personne ne l'a</span><span class="team-score__val team-score__val--nobody">${nobodyCount} / ${total}</span></div>`);
  parts.push(`</div></div></div>`);

  parts.push(`<div class="squad-summary__divider"></div>`);
  parts.push(`<h4 class="squad-summary__subtitle">Par joueur</h4>`);
  parts.push(`<div class="squad-summary__grid">`);
  stats.forEach((s, i) => {
    parts.push(`<div class="squad-stat">
      <span class="squad-stat__name">${escapeHtml(s.name)}</span>
      <div class="squad-stat__bar"><div class="squad-stat__fill" style="width:${s.pct}%"></div></div>
      <span class="squad-stat__pct">${s.owned}/${s.total} (${s.pct}%)</span>
      <span class="squad-stat__unique">${uniqueMap[i]} exclu.</span>
    </div>`);
  });
  parts.push(`</div></div>`);
  return parts.join("");
}
