"use strict";

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
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.waitingPlayers", { code: escapeHtml(state.activeSquad) })}</p>`;
    return;
  }

  if (state.squadView === "recommendations") {
    renderSquadRecommendations();
    return;
  }

  const items = getReleasedCollectionItems(getAllItems());
  const me = state.username || t("squad.me");
  const players = [
    { name: me, collection: state.collection, lastUpdated: new Date().toISOString(), entryCount: Object.keys(state.collection).length },
    ...state.squadMembers.map(m => ({ name: m.username, collection: m.collection, lastUpdated: m.lastUpdated, entryCount: m.entryCount || 0 }))
  ];
  const filter = state.squadFilter;
  const query = state.squadSearch.trim().toLowerCase();

  const rows = computeSquadDiffs(items, players, filter, query);

  els.squadCounter.innerHTML = t("squad.varianteCount", { count: rows.length });

  if (rows.length === 0) {
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.emptyFilter")}</p>`;
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
