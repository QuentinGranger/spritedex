function setupDataEvents() {
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

}
