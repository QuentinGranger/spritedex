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

