function setupMobileMoreEvents() {
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
  moreButton?.addEventListener("click", () =>
    setMoreMenu(moreMenu?.hidden || moreMenu?.classList.contains("is-closing"))
  );
  moreMenu
    ?.querySelectorAll("[data-mobile-more-close]")
    .forEach((button) => button.addEventListener("click", () => setMoreMenu(false)));
  moreMenu?.querySelectorAll("[data-mobile-view]").forEach((button) =>
    button.addEventListener("click", () => {
      setMoreMenu(false);
      activateMainView(button.dataset.mobileView);
    })
  );
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
}
