"use strict";

function setFriendsTab(tab) {
  document.querySelectorAll(".friends-tab").forEach((btn) => {
    const active = btn.dataset.friendsTab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".friends-panel").forEach((panel) => {
    const active = panel.id === `friends-panel-${tab}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function isFriendsPanelVisible() {
  const panel = document.getElementById("social-panel-friends");
  return !!panel && !document.hidden && !panel.hidden && panel.style.display !== "none";
}

async function refreshFriendsRealtime() {
  if (friendsRefreshQueued || !hasAuthSession()) return;
  friendsRefreshQueued = true;
  try {
    await loadFriendsData();
    renderActivePanel();
  } finally {
    friendsRefreshQueued = false;
  }
}

function sendFriendsPresence() {
  if (friendsWs?.readyState !== WebSocket.OPEN) return;
  try {
    friendsWs.send(JSON.stringify({ type: "presence_ping" }));
  } catch {}
}

function connectFriendsRealtime() {
  if (typeof WebSocket === "undefined" || !state.userId || !hasAuthSession()) return;
  if (friendsWs && (friendsWs.readyState === WebSocket.CONNECTING || friendsWs.readyState === WebSocket.OPEN)) return;

  friendsWs = new WebSocket(WS_URL);
  friendsWs.onopen = () => {
    friendsWs.send(JSON.stringify(wsAuthMessage()));
    sendFriendsPresence();
  };
  friendsWs.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "friends_update") void refreshFriendsRealtime();
    } catch {
      // Ignore unrelated or malformed socket messages.
    }
  };
  friendsWs.onclose = () => {
    friendsWs = null;
    clearTimeout(friendsWsReconnectTimer);
    if (state.userId && hasAuthSession()) {
      friendsWsReconnectTimer = setTimeout(connectFriendsRealtime, 3000);
    }
  };
  friendsWs.onerror = () => friendsWs?.close();
}

function startFriendsRealtime() {
  connectFriendsRealtime();
  if (friendsRefreshTimer) return;
  friendsRefreshTimer = setInterval(() => {
    if (isFriendsPanelVisible()) {
      sendFriendsPresence();
      void refreshFriendsRealtime();
    }
  }, FRIENDS_FALLBACK_REFRESH_MS);
}
