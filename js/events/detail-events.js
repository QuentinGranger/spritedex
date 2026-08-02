function setupDetailEvents() {
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

}
