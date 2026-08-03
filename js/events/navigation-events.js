function setupNavigationEvents() {
  document.querySelectorAll(".social-tab").forEach((btn) => {
    btn.addEventListener("click", () => setSocialTab(btn.dataset.socialTab));
  });
  setupRovingTabList(".social-tab");
  setupRovingTabList(".friends-tab");

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateMainView(tab.dataset.view, { force: true }));
  });
}
