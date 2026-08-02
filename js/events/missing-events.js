function setupMissingEvents() {
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

}
