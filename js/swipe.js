function setupSwipeGestures() {
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let longPressTimer = null;
  let longPressed = false;
  let swipeStartScroll = null;
  const THRESHOLD = 100;
  const BADGE_THRESHOLD = 50;
  const TAP_THRESHOLD = 10;
  const LONG_PRESS_MS = 500;

  function clearSwipeFeedback() {
    els.card.classList.remove("drag-left", "drag-right", "drag-up", "drag-down");
    els.card.style.setProperty("--swipe-intensity", "0");
  }

  els.card.addEventListener("pointerdown", (event) => {
    if (!currentItem() || (typeof swipeSessionIsPaused === "function" && swipeSessionIsPaused())) return;
    if (event.target.closest("button")) return;
    dragging = true;
    longPressed = false;
    const pageScroll = document.scrollingElement;
    swipeStartScroll = pageScroll ? { top: pageScroll.scrollTop, left: pageScroll.scrollLeft } : null;
    startX = event.clientX;
    startY = event.clientY;
    els.card.classList.add("dragging");
    els.card.setPointerCapture(event.pointerId);
    // Some mobile WebViews still begin a vertical page pan before the card
    // transition starts. This gesture owns the pointer from its first frame.
    event.preventDefault();

    longPressTimer = setTimeout(() => {
      const item = currentItem();
      if (item && dragging) {
        longPressed = true;
        dragging = false;
        els.card.classList.remove("dragging");
        els.card.style.setProperty("--tx", "0px");
        els.card.style.setProperty("--ty", "0px");
        els.card.style.setProperty("--rot", "0deg");
        clearBadge();
        openDetail(item.id);
        setTimeout(() => els.dialogNote.focus(), 100);
      }
    }, LONG_PRESS_MS);
  });

  els.card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const rot = dx / 14;
    els.card.style.setProperty("--tx", `${dx}px`);
    els.card.style.setProperty("--ty", `${dy * 0.4}px`);
    els.card.style.setProperty("--rot", `${rot}deg`);

    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) {
      clearTimeout(longPressTimer);
    }

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    if (absX > BADGE_THRESHOLD || absY > BADGE_THRESHOLD) {
      const distance = Math.max(absX, absY);
      els.card.style.setProperty("--swipe-intensity", String(Math.min(1, distance / THRESHOLD)));
      if (absX > absY) {
        const cfg = dx > 0 ? SWIPE_CONFIG.owned : SWIPE_CONFIG.missing;
        els.card.classList.toggle("drag-right", dx > 0);
        els.card.classList.toggle("drag-left", dx < 0);
        els.card.classList.remove("drag-up", "drag-down");
        setBadge(t(dx > 0 ? "status.owned" : "status.missing"), cfg.color);
      } else {
        const cfg = dy < 0 ? SWIPE_CONFIG.priority : SWIPE_CONFIG.unsure;
        els.card.classList.toggle("drag-up", dy < 0);
        els.card.classList.toggle("drag-down", dy > 0);
        els.card.classList.remove("drag-left", "drag-right");
        setBadge(t(dy < 0 ? "status.priority" : "status.unsure"), cfg.color);
      }
    } else {
      clearSwipeFeedback();
      clearBadge();
    }
  });

  const release = (event) => {
    clearTimeout(longPressTimer);
    if (longPressed) {
      longPressed = false;
      return;
    }
    if (!dragging) return;
    dragging = false;
    els.card.classList.remove("dragging");
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (Math.max(absX, absY) < THRESHOLD) {
      els.card.style.setProperty("--tx", "0px");
      els.card.style.setProperty("--ty", "0px");
      els.card.style.setProperty("--rot", "0deg");
      clearSwipeFeedback();
      clearBadge();

      if (Math.max(absX, absY) < TAP_THRESHOLD) {
        const item = currentItem();
        if (item) openDetail(item.id);
      }
      return;
    }

    if (absX > absY) {
      animateAndMark(dx > 0 ? "owned" : "missing", dx > 0 ? "owned" : "missing", swipeStartScroll);
    } else {
      animateAndMark(dy < 0 ? "priority" : "unsure", dy < 0 ? "priority" : "unsure", swipeStartScroll);
    }
    swipeStartScroll = null;
  };

  els.card.addEventListener("pointerup", release);
  els.card.addEventListener("pointercancel", release);
}
