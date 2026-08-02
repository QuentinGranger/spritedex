function setupSwipeControlEvents() {
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

}
