"use strict";

// Compatibility entry point. Friends features are loaded in focused classic scripts.
async function renderFriends() {
  startFriendsRealtime();
  setFriendsTab(friendsState.activeTab);
  await loadFriendsData();
  renderActivePanel();
}
