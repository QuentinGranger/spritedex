function setupChecklistEvents() {
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
      if (
        id &&
        getEntry(id).status === "owned" &&
        Number.isInteger(masteryLevel) &&
        masteryLevel >= 1 &&
        masteryLevel <= 5
      ) {
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
}
