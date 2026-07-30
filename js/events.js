const MAIN_VIEWS = ["home", "swipe", "checklist", "missing", "stats", "history", "social"];
const DESKTOP_VIEW_COPY = {
  home: ["nav.home", "view.homeSubtitle"],
  swipe: ["nav.swipe", "view.swipeSubtitle"],
  checklist: ["nav.checklist", "view.checklistSubtitle"],
  missing: ["nav.missing", "view.missingSubtitle"],
  stats: ["view.statsTitle", "view.statsSubtitle"],
  history: ["nav.history", "view.historySubtitle"],
  social: ["nav.social", "view.socialSubtitle"]
};

function renderDesktopViewHeading(view) {
  const copy = DESKTOP_VIEW_COPY[view] || DESKTOP_VIEW_COPY.swipe;
  const title = document.getElementById("desktopViewTitle");
  const subtitle = document.getElementById("desktopViewSubtitle");
  if (title) {
    title.dataset.i18n = copy[0];
    title.textContent = t(copy[0]);
  }
  if (subtitle) {
    subtitle.dataset.i18n = copy[1];
    subtitle.textContent = t(copy[1]);
  }
}

function renderAll() {
  renderSummary();
  renderChecklist();
  renderMissing();
  renderStats();
  renderNow();
  renderCard();
  renderCompare();
  clearCollectionViewDirty();
  state.homeViewDirty = false;
}

function markCollectionViewsDirty() {
  state.collectionViewDirty.checklist = true;
  state.collectionViewDirty.missing = true;
  state.collectionViewDirty.stats = true;
}

function clearCollectionViewDirty() {
  state.collectionViewDirty.checklist = false;
  state.collectionViewDirty.missing = false;
  state.collectionViewDirty.stats = false;
}

function refreshCollectionViewIfDirty(view) {
  if (!state.collectionViewDirty?.[view]) return;
  if (view === "checklist") renderChecklist();
  else if (view === "missing") renderMissing();
  else if (view === "stats") renderStats();
  else return;
  state.collectionViewDirty[view] = false;
}

function refreshHomeViewIfDirty(view) {
  if (view !== "home" || !state.homeViewDirty) return;
  renderNow();
  state.homeViewDirty = false;
}

function getActiveMainView() {
  const active = document.querySelector(".tab.active");
  return active ? active.dataset.view : "home";
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
  const moreButton = document.getElementById("mobileMoreButton");
  if (moreButton) moreButton.classList.toggle("active", ["stats", "history", "social"].includes(view));
  els.views.forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });

  // A swipe only dirties hidden collection views. Render a view at the moment
  // it becomes useful, rather than rebuilding three large DOM trees mid-swipe.
  refreshCollectionViewIfDirty(view);
  refreshHomeViewIfDirty(view);

  if (view !== "social") stopSquadPolling();
  if (view === "history" && typeof renderHistory === "function") renderHistory();
  if (view === "social") {
    const activeSocialTab = document.querySelector(".social-tab.active");
    setSocialTab(activeSocialTab ? activeSocialTab.dataset.socialTab : "friends");
  }

  renderDesktopViewHeading(view);
  scrollActiveTabIntoView();
  return true;
}

function setSocialTab(tab, opts = {}) {
  document.querySelectorAll(".social-tab").forEach((button) => {
    const active = button.dataset.socialTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".social-panel").forEach(p => {
    const active = p.id === `social-panel-${tab}`;
    p.style.display = active ? "block" : "none";
    p.hidden = !active;
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

function setupRovingTabList(selector) {
  const tabs = [...document.querySelectorAll(selector)];
  if (!tabs.length) return;
  tabs.forEach((tab) => {
    tab.tabIndex = tab.classList.contains("active") ? 0 : -1;
    tab.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  });
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
  setupCommandPalette();
  setupNowDashboard();
  setupFarmPlanEvents();
  setupSquadWishlistEvents();
  document.getElementById("syncBarRetry")?.addEventListener("click", () => {
    if (state.userId && navigator.onLine) flushSyncQueue();
  });
  const moreButton = document.getElementById("mobileMoreButton");
  const moreMenu = document.getElementById("mobileMoreMenu");
  const moreSheet = moreMenu?.querySelector(".mobile-more__sheet");
  const moreHandle = moreMenu?.querySelector(".mobile-more__sheet header");
  let moreCloseTimer = null;
  const setMoreMenu = (open, { fromDrag = false } = {}) => {
    if (!moreButton || !moreMenu) return;
    clearTimeout(moreCloseTimer);
    moreButton.setAttribute("aria-expanded", String(open));
    if (open) {
      moreMenu.hidden = false;
      moreMenu.classList.remove("is-closing");
      moreSheet?.classList.remove("is-dragging");
      moreSheet?.style.removeProperty("--mobile-more-drag");
      document.body.classList.add("mobile-more-open");
      moreMenu.querySelector("[data-mobile-view]")?.focus();
      return;
    }
    if (moreMenu.hidden) return;
    if (!fromDrag) {
      moreSheet?.classList.remove("is-dragging");
      moreSheet?.style.removeProperty("--mobile-more-drag");
    } else {
      // Freeze the sheet at the finger's position before its final descent.
      void moreSheet?.offsetHeight;
    }
    moreMenu.classList.add("is-closing");
    moreCloseTimer = setTimeout(() => {
      moreMenu.hidden = true;
      moreMenu.classList.remove("is-closing");
      moreSheet?.classList.remove("is-dragging");
      moreSheet?.style.removeProperty("--mobile-more-drag");
      document.body.classList.remove("mobile-more-open");
      moreButton.focus({ preventScroll: true });
    }, 220);
  };
  moreButton?.addEventListener("click", () => setMoreMenu(moreMenu?.hidden || moreMenu?.classList.contains("is-closing")));
  moreMenu?.querySelectorAll("[data-mobile-more-close]").forEach((button) => button.addEventListener("click", () => setMoreMenu(false)));
  moreMenu?.querySelectorAll("[data-mobile-view]").forEach((button) => button.addEventListener("click", () => {
    setMoreMenu(false);
    activateMainView(button.dataset.mobileView);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && moreMenu && !moreMenu.hidden) setMoreMenu(false);
  });
  if (moreSheet && moreHandle) {
    let dragStartY = 0;
    let dragDistance = 0;
    let dragPointerId = null;

    moreHandle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      dragStartY = event.clientY;
      dragDistance = 0;
      dragPointerId = event.pointerId;
      moreSheet.classList.add("is-dragging");
      moreHandle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    moreHandle.addEventListener("pointermove", (event) => {
      if (dragPointerId !== event.pointerId) return;
      dragDistance = Math.max(0, Math.min(window.innerHeight, event.clientY - dragStartY));
      moreSheet.style.setProperty("--mobile-more-drag", `${dragDistance}px`);
      event.preventDefault();
    });
    const endMoreDrag = (event) => {
      if (dragPointerId !== event.pointerId) return;
      dragPointerId = null;
      if (dragDistance >= 72) {
        setMoreMenu(false, { fromDrag: true });
      } else {
        moreSheet.classList.remove("is-dragging");
        moreSheet.style.removeProperty("--mobile-more-drag");
      }
      dragDistance = 0;
    };
    moreHandle.addEventListener("pointerup", endMoreDrag);
    moreHandle.addEventListener("pointercancel", endMoreDrag);
  }
  document.querySelectorAll(".social-tab").forEach(btn => {
    btn.addEventListener("click", () => setSocialTab(btn.dataset.socialTab));
  });
  setupRovingTabList(".social-tab");
  setupRovingTabList(".friends-tab");

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateMainView(tab.dataset.view, { force: true }));
  });

  $("#markOwned").addEventListener("click", () => animateAndMark("owned"));
  $("#markMissing").addEventListener("click", () => animateAndMark("missing"));
  $("#markPriority").addEventListener("click", () => animateAndMark("priority"));
  $("#markUnsure").addEventListener("click", () => animateAndMark("unsure"));
  document.getElementById("swipeSessionPause")?.addEventListener("click", toggleSwipeSessionPause);
  document.getElementById("swipeSessionUndo")?.addEventListener("click", undoSwipeSessionAction);
  document.getElementById("swipeSessionRestart")?.addEventListener("click", () => buildDeck({ restartSession: true }));
  const shortcutGuide = document.getElementById("swipeShortcutGuide");
  const setShortcutGuide = (open) => {
    if (!shortcutGuide) return;
    shortcutGuide.hidden = !open;
    document.getElementById("swipeShortcutsToggle")?.setAttribute("aria-expanded", String(open));
  };
  document.getElementById("swipeShortcutsToggle")?.addEventListener("click", () => setShortcutGuide(shortcutGuide?.hidden));
  document.getElementById("swipeShortcutsClose")?.addEventListener("click", () => setShortcutGuide(false));
  document.addEventListener("keydown", (event) => {
    if (getActiveMainView() !== "swipe" || event.defaultPrevented || event.altKey) return;
    if (event.target.closest("input, textarea, select, button, dialog, [contenteditable='true']")) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoSwipeSessionAction();
      return;
    }
    if (event.metaKey || event.ctrlKey) return;
    if (event.key === "Escape" && !shortcutGuide?.hidden) {
      event.preventDefault();
      setShortcutGuide(false);
      return;
    }
    if (event.key === "?") {
      event.preventDefault();
      setShortcutGuide(shortcutGuide?.hidden);
      return;
    }
    const shortcuts = { ArrowRight: "owned", ArrowLeft: "missing", ArrowUp: "priority", ArrowDown: "unsure", "1": "missing", "2": "unsure", "3": "priority", "4": "owned" };
    if (shortcuts[event.key]) {
      event.preventDefault();
      const status = shortcuts[event.key];
      const button = document.getElementById({ owned: "markOwned", missing: "markMissing", priority: "markPriority", unsure: "markUnsure" }[status]);
      button?.classList.remove("is-shortcut-fired");
      void button?.offsetWidth;
      button?.classList.add("is-shortcut-fired");
      animateAndMark(status);
      return;
    }
    if (event.key === " " || event.key.toLowerCase() === "p") {
      event.preventDefault();
      toggleSwipeSessionPause();
      return;
    }
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoSwipeSessionAction();
    }
  });
  if (els.cardMasteryLevels) {
    els.cardMasteryLevels.addEventListener("click", (event) => {
      const control = event.target.closest("[data-card-mastery]");
      const item = currentItem();
      if (!control || !item || getEntry(item.id).status !== "owned") return;
      const masteryLevel = Number(control.dataset.cardMastery);
      if (!Number.isInteger(masteryLevel) || masteryLevel < 1 || masteryLevel > 5) return;
      setEntry(item.id, { masteryLevel });
      toast(masteryLevel === 5 ? t("mastery.masterReached") : t("mastery.saved", { level: masteryLevel }));
    });
  }
  els.deckFilter.addEventListener("change", () => {
    state.currentIndex = 0;
    buildDeck();
  });
  els.shuffleDeck.addEventListener("click", shuffleDeck);

  els.searchInput.addEventListener("input", (event) => {
    state.commandSeasonId = null;
    state.checklistSearch = event.target.value;
    if (desktopSearch) desktopSearch.value = event.target.value;
    renderChecklist();
  });

  els.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !event.currentTarget.value) return;
    event.preventDefault();
    event.currentTarget.value = "";
    state.checklistSearch = "";
    const desktopSearch = document.getElementById("desktopSearch");
    if (desktopSearch) desktopSearch.value = "";
    renderChecklist();
  });

  els.checklistSort.addEventListener("change", (event) => {
    state.checklistSort = event.target.value;
    renderChecklist();
  });

  els.filterChipsBar.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-filter]");
    if (!chip) return;
    state.commandSeasonId = null;
    state.checklistFilter = chip.dataset.filter;
    state.passportMissingVariantIds = null;
    state.expandedSprite = null;
    renderChecklist();
  });

  els.checklistList.addEventListener("keydown", (event) => {
    const toggle = event.target.closest("[data-toggle]");
    if (!toggle || (event.key !== "Enter" && event.key !== " ")) return;
    if (event.target.closest("button, a, input, select, textarea")) return;
    event.preventDefault();
    const id = toggle.dataset.toggle;
    state.expandedSprite = state.expandedSprite === id ? null : id;
    renderChecklist();
    focusChecklistSprite(id);
  });

  els.checklistList.addEventListener("click", (event) => {
    const masteryButton = event.target.closest("[data-mastery-level]");
    if (masteryButton) {
      const id = masteryButton.dataset.id;
      const masteryLevel = Number(masteryButton.dataset.masteryLevel);
      if (id && getEntry(id).status === "owned" && Number.isInteger(masteryLevel) && masteryLevel >= 1 && masteryLevel <= 5) {
        setEntry(id, { masteryLevel });
        toast(masteryLevel === 5 ? t("mastery.masterReached") : t("mastery.saved", { level: masteryLevel }));
      }
      return;
    }
    const quickStatus = event.target.closest("[data-quick-status]");
    if (quickStatus) {
      const status = quickStatus.dataset.quickStatus;
      const id = quickStatus.dataset.id;
      if (id && ["owned", "priority"].includes(status)) {
        const patch = { status };
        if (status === "owned" && !getEntry(id).obtainedAt) patch.obtainedAt = new Date().toISOString();
        setEntry(id, patch);
        toast(status === "owned" ? t("checklist.markedOwned") : t("checklist.addedPriority"));
      }
      return;
    }
    const detailBtn = event.target.closest("[data-sprite-detail]");
    if (detailBtn) {
      openSpriteDetail(detailBtn.dataset.spriteDetail);
      return;
    }
    const toggle = event.target.closest("[data-toggle]");
    if (toggle) {
      const id = toggle.dataset.toggle;
      state.expandedSprite = state.expandedSprite === id ? null : id;
      renderChecklist();
      focusChecklistSprite(id);
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
    const masteryButton = event.target.closest("[data-detail-mastery-level]");
    if (masteryButton) {
      const id = masteryButton.dataset.id;
      const masteryLevel = Number(masteryButton.dataset.detailMasteryLevel);
      if (id && getEntry(id).status === "owned" && Number.isInteger(masteryLevel) && masteryLevel >= 1 && masteryLevel <= 5) {
        setEntry(id, { masteryLevel });
        const item = getAllItems().find(i => i.id === id);
        if (item) openSpriteDetail(item.spriteId);
        toast(masteryLevel === 5 ? t("mastery.masterReached") : t("mastery.saved", { level: masteryLevel }));
      }
      return;
    }
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
      const input = prompt(t("dialog.dateObtainedPrompt"), current);
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
    toast(t("swipe.priorityToast", { label: priorityLabel(prio) }));
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
    const ok = confirm(t("checklist.resetConfirm"));
    if (!ok) return;
    state.collection = createSafeRecord();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    if (state.userId) {
      try { await fetch(`${API_BASE}/collection/${state.userId}`, { method: "DELETE", headers: authHeadersOnly() }); } catch {}
    }
    buildDeck();
    renderAll();
    toast(t("checklist.resetDone"));
  });
  els.copyMissing.addEventListener("click", () => {
    if (typeof copyCurrentMissingList === "function") copyCurrentMissingList();
    else copyMissingList();
  });
  els.themeToggle?.addEventListener("click", toggleTheme);

  const missingSearch = document.getElementById("missingSearch");
  const missingSort = document.getElementById("missingSort");
  const missingFilterChips = document.getElementById("missingFilterChips");
  const clearMissingFilters = document.getElementById("clearMissingFilters");
  if (missingSearch) {
    missingSearch.addEventListener("input", (event) => {
      state.missingSearch = event.target.value;
      renderMissing();
    });
    missingSearch.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !event.currentTarget.value) return;
      event.preventDefault();
      state.missingSearch = "";
      renderMissing();
    });
  }
  if (missingSort) missingSort.addEventListener("change", (event) => {
    state.missingSort = event.target.value;
    renderMissing();
  });
  if (missingFilterChips) missingFilterChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-missing-filter]");
    if (!chip) return;
    state.missingFilter = chip.dataset.missingFilter || "all";
    renderMissing();
  });
  if (clearMissingFilters) clearMissingFilters.addEventListener("click", () => resetMissingControls());

  els.missingList.addEventListener("click", (event) => {
    const action = event.target.closest("[data-missing-action]");
    if (action) {
      if (action.dataset.missingAction === "clear-event") state.missingEventFilter = null;
      if (action.dataset.missingAction === "checklist") activateMainView("checklist");
      if (action.dataset.missingAction !== "checklist") resetMissingControls();
      return;
    }
    const section = event.target.closest("[data-missing-section]");
    if (section) {
      const key = `missing-section-${section.dataset.missingSection}`;
      state.missingCollapsedSections[key] = !state.missingCollapsedSections[key];
      renderMissing();
      return;
    }
    const detail = event.target.closest("[data-missing-detail]");
    if (detail) {
      openDetail(detail.dataset.missingDetail);
      return;
    }
    const priority = event.target.closest("[data-missing-priority]");
    if (priority) {
      const id = priority.dataset.missingPriority;
      const entry = getEntry(id);
      const isPriority = typeof isMissingPriority === "function" && isMissingPriority(entry);
      setEntry(id, isPriority ? { status: "missing", priority: "none" } : { status: "priority", priority: "medium" });
      toast(isPriority ? t("missing.removedPriority") : t("missing.addedPriority"));
      return;
    }
    const btn = event.target.closest("[data-status]");
    if (btn) {
      const patch = { status: btn.dataset.status };
      if (btn.dataset.status === "owned" && !getEntry(btn.dataset.id).obtainedAt) patch.obtainedAt = new Date().toISOString();
      setEntry(btn.dataset.id, patch);
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
      navigator.clipboard.writeText(state.activeSquad).then(() => toast(t("squad.codeCopied")));
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
    // An absolute URL matters on public routes such as /u/:username: a relative
    // "sw.js" would otherwise resolve to /u/sw.js and silently leave that
    // session on an old cache. updateViaCache:none pairs with the server's
    // no-cache worker response, so every app return can discover a deploy.
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        const checkForUpdate = () => registration.update().catch(() => {});
        window.addEventListener("focus", checkForUpdate, { passive: true });
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
      })
      .catch(() => {});
  }
}
