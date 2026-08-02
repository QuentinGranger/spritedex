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
