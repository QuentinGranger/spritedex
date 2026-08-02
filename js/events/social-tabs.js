function setSocialTab(tab, opts = {}) {
  document.querySelectorAll(".social-tab").forEach((button) => {
    const active = button.dataset.socialTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".social-panel").forEach(p => {
    const active = p.id === `social-panel-${tab}`;
    p.style.display = active ? "block" : "none";
    p.hidden = !active;
  });
  if (opts.silent) return;
  if (tab === "friends") {
    renderFriends();
  } else if (tab === "compare") {
    renderCompare();
    stopSquadPolling();
  } else if (tab === "squad") {
    if (state.activeSquad) {
      loadSquad(state.activeSquad);
      startSquadPolling();
    } else {
      if (typeof showSquadLobby === "function") showSquadLobby();
    }
  }
}

function setupRovingTabList(selector) {
  const tabs = [...document.querySelectorAll(selector)];
  if (!tabs.length) return;
  tabs.forEach((tab) => {
    tab.tabIndex = tab.classList.contains("active") ? 0 : -1;
    tab.addEventListener("keydown", (event) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const current = tabs.indexOf(tab);
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex].focus();
      tabs[nextIndex].click();
    });
  });
}
