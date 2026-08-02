function setupEvents() {
  setupCommandPalette();
  setupNowDashboard();
  setupFarmPlanEvents();
  setupSquadWishlistEvents();
  document.getElementById("syncBarRetry")?.addEventListener("click", () => {
    if (state.userId && navigator.onLine) flushSyncQueue();
  });
  setupMobileMoreEvents();
  setupNavigationEvents();
  setupSwipeControlEvents();
  setupChecklistEvents();
  setupDetailEvents();
  setupDataEvents();
  setupMissingEvents();
  setupSquadEvents();
  setSocialTab("friends", { silent: true });
  setupCompareEvents();
  setupFriendsEvents();
  setupSwipeGestures();
  setupViewSwipe();
  setupServiceWorker();
}
