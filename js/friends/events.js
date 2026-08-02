"use strict";

function setupFriendsEvents() {
  document.querySelectorAll(".friends-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      setFriendsTab(btn.dataset.friendsTab);
      await loadFriendsData();
      renderActivePanel();
    });
  });

  const friendSearch = getFriendsEl("friendSearch");
  if (friendSearch) {
    friendSearch.addEventListener("input", (e) => {
      friendsState.listSearch = e.target.value.trim();
      renderFriendsList();
    });
  }

  const friendFilter = getFriendsEl("friendFilter");
  if (friendFilter) {
    friendFilter.addEventListener("change", (e) => {
      friendsState.listFilter = e.target.value;
      renderFriendsList();
    });
  }

  const friendSort = getFriendsEl("friendSort");
  if (friendSort) {
    friendSort.addEventListener("change", (e) => {
      friendsState.listSort = e.target.value;
      renderFriendsList();
    });
  }

  window.addEventListener("focus", () => {
    if (isFriendsPanelVisible()) {
      sendFriendsPresence();
      void refreshFriendsRealtime();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isFriendsPanelVisible()) {
      sendFriendsPresence();
      void refreshFriendsRealtime();
    }
  });

  const addFriendSearch = getFriendsEl("addFriendSearch");
  const addFriendSearchBtn = getFriendsEl("addFriendSearchBtn");
  if (addFriendSearchBtn) {
    addFriendSearchBtn.addEventListener("click", searchAndRenderAddFriend);
  }
  if (addFriendSearch) {
    addFriendSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") searchAndRenderAddFriend();
    });
  }

  const shareBtn = getFriendsEl("friendShareLinkBtn");
  if (shareBtn) shareBtn.addEventListener("click", copyFriendInviteLink);

  const showQrBtn = getFriendsEl("friendShowQrBtn");
  const generateQrBtn = getFriendsEl("friendGenerateQrBtn");
  if (showQrBtn) showQrBtn.addEventListener("click", () => {
    setFriendsTab("qr");
    showMyQrCode();
  });
  if (generateQrBtn) generateQrBtn.addEventListener("click", showMyQrCode);

  ["friendsList", "receivedList", "sentList", "addFriendResults", "friendSuggestions", "blockedList"].forEach((id) => {
    const el = getFriendsEl(id);
    if (el) el.addEventListener("click", handleFriendsActionClick);
  });

  if (els.squadInviteDialog) {
    const form = els.squadInviteDialog.querySelector("form");
    if (form) form.addEventListener("submit", handleSquadInviteSubmit);
    const cancelBtn = els.squadInviteDialog.querySelector("button[value='cancel']");
    if (cancelBtn) cancelBtn.addEventListener("click", () => els.squadInviteDialog.close());
  }
}
