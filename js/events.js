function renderAll() {
  renderSummary();
  renderChecklist();
  renderMissing();
  renderStats();
  renderCard();
}

function setupEvents() {
  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      els.tabs.forEach((button) => button.classList.toggle("active", button === tab));
      els.views.forEach((view) => view.classList.toggle("active", view.id === `view-${tab.dataset.view}`));
      if (tab.dataset.view === "squad" && state.activeSquad) {
        loadSquad(state.activeSquad);
        startSquadPolling();
      } else {
        stopSquadPolling();
      }
      if (tab.dataset.view === "history") {
        renderHistory();
      }
    });
  });

  $("#markOwned").addEventListener("click", () => animateAndMark("owned"));
  $("#markMissing").addEventListener("click", () => animateAndMark("missing"));
  $("#markPriority").addEventListener("click", () => animateAndMark("priority"));
  $("#markUnsure").addEventListener("click", () => animateAndMark("unsure"));
  els.deckFilter.addEventListener("change", () => {
    state.currentIndex = 0;
    buildDeck();
  });
  els.shuffleDeck.addEventListener("click", shuffleDeck);

  els.searchInput.addEventListener("input", (event) => {
    state.checklistSearch = event.target.value;
    renderChecklist();
  });

  els.checklistSort.addEventListener("change", (event) => {
    state.checklistSort = event.target.value;
    renderChecklist();
  });

  els.filterChipsBar.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    els.filterChipsBar.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    state.checklistFilter = chip.dataset.filter;
    state.expandedSprite = null;
    renderChecklist();
  });

  els.checklistList.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      const id = toggle.dataset.toggle;
      state.expandedSprite = state.expandedSprite === id ? null : id;
      renderChecklist();
      return;
    }
    const detailBtn = event.target.closest("[data-sprite-detail]");
    if (detailBtn) {
      openSpriteDetail(detailBtn.dataset.spriteDetail);
      return;
    }
    const statusButton = event.target.closest("[data-status]");
    if (statusButton) {
      setEntry(statusButton.dataset.id, { status: statusButton.dataset.status });
      toast(statusLabel(statusButton.dataset.status));
      return;
    }
  });

  els.spriteDetailContent.addEventListener("change", (event) => {
    const statusSelect = event.target.closest(".sd-status-select");
    if (statusSelect) {
      const patch = { status: statusSelect.value };
      if (statusSelect.value === "owned" && !getEntry(statusSelect.dataset.id).obtainedAt) {
        patch.obtainedAt = new Date().toISOString();
      }
      setEntry(statusSelect.dataset.id, patch);
      const spriteId = statusSelect.dataset.id.split("::")[0];
      openSpriteDetail(spriteId);
      return;
    }
    const prioSelect = event.target.closest(".sd-prio-select");
    if (prioSelect) {
      setEntry(prioSelect.dataset.id, { priority: prioSelect.value });
      const spriteId = prioSelect.dataset.id.split("::")[0];
      openSpriteDetail(spriteId);
      return;
    }
  });

  els.spriteDetailContent.addEventListener("click", (event) => {
    const favBtn = event.target.closest("[data-fav]");
    if (favBtn) {
      const key = `fav_${favBtn.dataset.fav}`;
      state.collection[key] = !state.collection[key];
      persist();
      openSpriteDetail(favBtn.dataset.fav);
      return;
    }
    const dateBtn = event.target.closest(".sd-date-btn");
    if (dateBtn) {
      const id = dateBtn.dataset.id;
      const entry = getEntry(id);
      const current = entry.obtainedAt ? new Date(entry.obtainedAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
      const input = prompt("Date d'obtention (AAAA-MM-JJ) :", current);
      if (input) {
        setEntry(id, { obtainedAt: new Date(input).toISOString() });
        const spriteId = id.split("::")[0];
        openSpriteDetail(spriteId);
      }
      return;
    }
  });

  els.dialogNote.addEventListener("input", () => {
    clearTimeout(saveDialogNote.timer);
    saveDialogNote.timer = setTimeout(saveDialogNote, 250);
  });

  document.getElementById("dialogPriorityBar").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-prio]");
    if (!chip || !state.activeDetailId) return;
    const prio = chip.dataset.prio;
    document.querySelectorAll("#dialogPriorityBar .prio-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    setEntry(state.activeDetailId, { priority: prio });
    toast(`Priorité : ${priorityLabel(prio)}`);
  });

  $("#dialogOwned").addEventListener("click", () => setEntry(state.activeDetailId, { status: "owned", note: els.dialogNote.value }));
  $("#dialogMissing").addEventListener("click", () => setEntry(state.activeDetailId, { status: "missing", note: els.dialogNote.value }));
  $("#dialogPriority").addEventListener("click", () => setEntry(state.activeDetailId, { status: "priority", note: els.dialogNote.value }));
  $("#dialogUnsure").addEventListener("click", () => setEntry(state.activeDetailId, { status: "unsure", note: els.dialogNote.value }));
  $("#dialogUnavailable").addEventListener("click", () => setEntry(state.activeDetailId, { status: "unavailable", note: els.dialogNote.value }));
  $("#dialogSpotted").addEventListener("click", () => setEntry(state.activeDetailId, { status: "spotted", note: els.dialogNote.value }));

  els.exportData.addEventListener("click", exportData);
  els.importData.addEventListener("change", (event) => importData(event.target.files[0]));
  els.resetData.addEventListener("click", async () => {
    const ok = confirm("Réinitialiser toute ta checklist SpriteDex ?");
    if (!ok) return;
    state.collection = {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    if (state.userId) {
      try { await fetch(`${API_BASE}/collection/${state.userId}`, { method: "DELETE", headers: authHeadersOnly() }); } catch {}
    }
    buildDeck();
    renderAll();
    toast("Checklist réinitialisée");
  });
  els.copyMissing.addEventListener("click", copyMissingList);
  els.themeToggle.addEventListener("click", toggleTheme);

  els.missingList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-status]");
    if (btn) {
      setEntry(btn.dataset.id, { status: btn.dataset.status });
      toast(statusLabel(btn.dataset.status));
    }
  });

  els.squadMembers.addEventListener("click", (event) => {
    const kickBtn = event.target.closest("[data-kick]");
    if (kickBtn) kickSquadMember(decodeURIComponent(kickBtn.dataset.kick));
  });
  els.squadCreateBtn.addEventListener("click", createSquad);
  els.squadJoinBtn.addEventListener("click", joinSquad);
  els.squadCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinSquad(); });
  els.squadLeaveBtn.addEventListener("click", leaveSquad);
  els.squadRefreshBtn.addEventListener("click", () => {
    if (state.activeSquad) loadSquad(state.activeSquad);
  });
  els.squadCopyCode.addEventListener("click", () => {
    if (state.activeSquad) {
      navigator.clipboard.writeText(state.activeSquad).then(() => toast("Code copié !"));
    }
  });
  els.squadFilter.addEventListener("change", () => {
    state.squadFilter = els.squadFilter.value;
    renderSquad();
  });
  els.squadSearchInput.addEventListener("input", () => {
    state.squadSearch = els.squadSearchInput.value;
    renderSquad();
  });
  els.duelPlayerA.addEventListener("change", () => renderSquad());
  els.duelPlayerB.addEventListener("change", () => renderSquad());
  els.squadTableWrap.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle]");
    if (!toggle) return;
    const targetId = toggle.dataset.toggle;
    const list = document.getElementById(targetId);
    if (!list) return;
    list.classList.toggle("hunt-list--collapsed");
    toggle.closest(".hunt-section").classList.toggle("hunt-section--collapsed");
  });
  document.querySelectorAll(".squad-view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".squad-view-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.squadView = btn.dataset.squadView;
      renderSquad();
    });
  });

  setupSwipeGestures();

  // Register the service worker for the web PWA only. In the native (Capacitor)
  // shell it would try to intercept capacitor:// requests and conflicts with the
  // native asset loader, so we skip it there.
  if ("serviceWorker" in navigator && !isNativePlatform()) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
