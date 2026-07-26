const MAIN_VIEWS = ["swipe", "checklist", "missing", "stats", "history", "social"];

function renderAll() {
  renderSummary();
  renderChecklist();
  renderMissing();
  renderStats();
  renderCard();
  renderCompare();
}

function getActiveMainView() {
  const active = document.querySelector(".tab.active");
  return active ? active.dataset.view : "swipe";
}

function scrollActiveTabIntoView() {
  const tab = document.querySelector(".tab.active");
  const nav = document.getElementById("mainTabs");
  if (!tab || !nav) return;
  const tabRect = tab.getBoundingClientRect();
  const navRect = nav.getBoundingClientRect();
  if (tabRect.left < navRect.left + 8 || tabRect.right > navRect.right - 8) {
    tab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

function activateMainView(view, opts = {}) {
  if (!MAIN_VIEWS.includes(view)) return false;
  const current = getActiveMainView();
  if (current === view && !opts.force) {
    scrollActiveTabIntoView();
    return true;
  }

  els.tabs.forEach((button) => {
    const on = button.dataset.view === view;
    button.classList.toggle("active", on);
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  els.views.forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });

  if (view !== "social") stopSquadPolling();
  if (view === "history" && typeof renderHistory === "function") renderHistory();
  if (view === "social") {
    const activeSocialTab = document.querySelector(".social-tab.active");
    setSocialTab(activeSocialTab ? activeSocialTab.dataset.socialTab : "friends");
  }

  scrollActiveTabIntoView();
  return true;
}

function setSocialTab(tab, opts = {}) {
  document.querySelectorAll(".social-tab").forEach(b => b.classList.toggle("active", b.dataset.socialTab === tab));
  document.querySelectorAll(".social-panel").forEach(p => {
    p.style.display = p.id === `social-panel-${tab}` ? "block" : "none";
  });
  if (opts.silent) return;
  if (tab === "friends") {
    renderFriends();
  } else if (tab === "compare") {
    renderCompare();
    stopSquadPolling();
  } else if (tab === "squad") {
    if (state.activeSquad) {
      loadSquad(state.activeSquad);
      startSquadPolling();
    } else {
      if (typeof showSquadLobby === "function") showSquadLobby();
    }
  }
}

function isViewSwipeBlockedTarget(target, clientX = 0) {
  if (!target || !target.closest) return true;
  // Hard blocks — never steal focus from forms/dialogs/nav.
  if (target.closest("input, textarea, select, dialog, .tabs, [data-no-view-swipe]")) return true;
  const edge = 28;
  const nearEdge = clientX <= edge || clientX >= window.innerWidth - edge;
  if (nearEdge) return false;
  return Boolean(target.closest([
    ".sprite-card",
    ".deck-zone",
    ".swipe-actions",
    "button",
    "a",
    "label",
    ".filter-chips-bar",
    ".social-tabs",
    ".friends-tabs",
    ".squad-engine__tabs",
    ".squad-view-btn",
    ".engine-filter-bar"
  ].join(",")));
}

function setupViewSwipe() {
  const main = document.getElementById("mainViews") || document.querySelector("main");
  if (!main) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = null; // "h" | "v" | null
  let pointerId = null;
  const AXIS_LOCK = 12;
  const COMMIT = 72;

  const resetTransform = () => {
    main.classList.remove("main-views--swiping");
    main.style.removeProperty("--view-swipe-x");
  };

  main.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    if (isViewSwipeBlockedTarget(event.target, event.clientX)) return;
    tracking = true;
    locked = null;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
  });

  main.addEventListener("pointermove", (event) => {
    if (!tracking || event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!locked) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      locked = Math.abs(dx) > Math.abs(dy) * 1.15 ? "h" : "v";
      if (locked === "v") {
        tracking = false;
        resetTransform();
        return;
      }
      main.classList.add("main-views--swiping");
      try { main.setPointerCapture(event.pointerId); } catch (_) { /* ignore */ }
    }
    if (locked !== "h") return;
    event.preventDefault();
    const idx = MAIN_VIEWS.indexOf(getActiveMainView());
    const atStart = idx <= 0 && dx > 0;
    const atEnd = idx >= MAIN_VIEWS.length - 1 && dx < 0;
    const resistance = (atStart || atEnd) ? 0.28 : 0.55;
    main.style.setProperty("--view-swipe-x", `${dx * resistance}px`);
  });

  const end = (event) => {
    if (!tracking || (pointerId != null && event.pointerId !== pointerId)) {
      tracking = false;
      locked = null;
      pointerId = null;
      resetTransform();
      return;
    }
    const dx = event.clientX - startX;
    const wasHorizontal = locked === "h";
    tracking = false;
    locked = null;
    pointerId = null;
    resetTransform();
    if (!wasHorizontal || Math.abs(dx) < COMMIT) return;
    const idx = MAIN_VIEWS.indexOf(getActiveMainView());
    if (dx < 0 && idx < MAIN_VIEWS.length - 1) activateMainView(MAIN_VIEWS[idx + 1]);
    else if (dx > 0 && idx > 0) activateMainView(MAIN_VIEWS[idx - 1]);
  };

  main.addEventListener("pointerup", end);
  main.addEventListener("pointercancel", end);
}

function setupEvents() {
  document.querySelectorAll(".social-tab").forEach(btn => {
    btn.addEventListener("click", () => setSocialTab(btn.dataset.socialTab));
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateMainView(tab.dataset.view, { force: true }));
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
    state.passportMissingVariantIds = null;
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
      const item = getAllItems().find(i => i.id === statusSelect.dataset.id);
      if (item) openSpriteDetail(item.spriteId);
      return;
    }
    const prioSelect = event.target.closest(".sd-prio-select");
    if (prioSelect) {
      setEntry(prioSelect.dataset.id, { priority: prioSelect.value });
      const item = getAllItems().find(i => i.id === prioSelect.dataset.id);
      if (item) openSpriteDetail(item.spriteId);
      return;
    }
  });

  els.spriteDetailContent.addEventListener("click", (event) => {
    const favBtn = event.target.closest("[data-fav]");
    if (favBtn) {
      const key = `fav_${favBtn.dataset.fav}`;
      setSafeRecordValue(state.collection, key, !state.collection[key]);
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
        const item = getAllItems().find(i => i.id === id);
        if (item) openSpriteDetail(item.spriteId);
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
    const ok = confirm("Réinitialiser toute ta checklist SPRITNEX ?");
    if (!ok) return;
    state.collection = createSafeRecord();
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
    const menuBtn = event.target.closest("[data-member-menu]");
    if (menuBtn) {
      const userId = decodeURIComponent(menuBtn.dataset.memberMenu);
      const username = decodeURIComponent(menuBtn.dataset.memberName || "");
      openMemberActionsDialog(userId, username);
      return;
    }
    const addFriendBtn = event.target.closest("[data-add-friend]");
    if (addFriendBtn) {
      sendFriendRequest(decodeURIComponent(addFriendBtn.dataset.addFriend));
      return;
    }
    const acceptFriendBtn = event.target.closest("[data-accept-friend]");
    if (acceptFriendBtn) {
      acceptFriendRequest(decodeURIComponent(acceptFriendBtn.dataset.acceptFriend));
      return;
    }
    const compareBtn = event.target.closest("[data-compare-user]");
    if (compareBtn) {
      compareWithUser(decodeURIComponent(compareBtn.dataset.compareUser));
      return;
    }
    const kickBtn = event.target.closest("[data-kick]");
    if (kickBtn) kickSquadMember(decodeURIComponent(kickBtn.dataset.kick));
  });

  if (els.memberActionsList) {
    els.memberActionsList.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-member-action]");
      if (!btn) return;
      const action = btn.dataset.memberAction;
      const pending = state.pendingMemberAction || {};
      handleMemberAction(action, pending.userId, pending.username);
    });
  }
  if (els.memberActionsClose) {
    els.memberActionsClose.addEventListener("click", () => {
      if (els.memberActionsDialog) els.memberActionsDialog.close();
    });
  }
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
  if (els.squadShareBtn) {
    els.squadShareBtn.addEventListener("click", () => openShareDialog("squad"));
  }
  els.squadFilter.addEventListener("change", () => {
    state.squadFilter = els.squadFilter.value;
    renderSquad();
  });
  if (els.squadMemberFilter) {
    els.squadMemberFilter.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-member-filter]");
      if (!btn) return;
      state.squadMemberFilter = btn.dataset.memberFilter;
      renderSquadMembers();
    });
  }
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

  setSocialTab("friends", { silent: true });
  setupCompareEvents();
  setupFriendsEvents();
  setupSwipeGestures();
  setupViewSwipe();

  // Register the service worker for the web PWA only. In the native (Capacitor)
  // shell it would try to intercept capacitor:// requests and conflicts with the
  // native asset loader, so we skip it there.
  if ("serviceWorker" in navigator && !isNativePlatform()) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
