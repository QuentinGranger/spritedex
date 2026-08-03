"use strict";

function getPendingEntries() {
  const entries = [];
  for (const r of friendsState.received) {
    entries.push({
      kind: "received",
      requestId: r.requestId,
      createdAt: r.createdAt,
      user: r.user,
      commonSquad: r.commonSquad
    });
  }
  for (const r of friendsState.sent) {
    entries.push({ kind: "sent", requestId: r.requestId, createdAt: r.createdAt, user: r.user });
  }
  return entries.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
}

function renderPendingItem(item) {
  const user = item.user || {};
  const actions =
    item.kind === "received"
      ? `<button class="ghost-button success-text" data-action="accept" data-request-id="${escapeHtml(String(item.requestId))}">${t("friends.accept")}</button>
       <button class="ghost-button danger-text" data-action="decline" data-request-id="${escapeHtml(String(item.requestId))}">${t("friends.decline")}</button>
       <button class="ghost-button" data-action="block" data-id="${escapeHtml(String(user.id))}">${t("friends.block")}</button>`
      : `<button class="ghost-button danger-text" data-action="cancel" data-request-id="${escapeHtml(String(item.requestId))}">${t("friends.cancel")}</button>`;
  return `
    <div class="friend-item" data-request-id="${escapeHtml(String(item.requestId))}">
      ${friendAvatarHTML(user)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(user.displayName || user.username || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${escapeHtml(user.username ? `@${user.username}` : "")}${item.commonSquad ? ` · ${t("friends.squadBadge")}` : ""} · ${item.kind === "received" ? t("friends.requestReceived") : t("friends.requestSentMeta")}</div>
      </div>
      <div class="friend-actions">${actions}</div>
    </div>
  `;
}

function canInviteToSquad(f) {
  return f.actions && f.actions.inviteToSquad === true;
}

async function sendFriendRequest(userId) {
  try {
    const res = await fetch(`${API_BASE}/friends/requests`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ addresseeId: userId })
    });
    if (res.ok) {
      toast(t("friends.requestSentToast"));
      await loadFriendsData();
      if (friendsState.activeTab === "friends") renderFriendsList();
      if (state.activeSquad) await loadSquad(state.activeSquad);
    } else {
      const data = await res.json().catch(() => ({}));
      toastError(data, "friends.sendFailed");
    }
  } catch (e) {
    console.error("[friends] send request error", e);
    toast(t("common.networkError"));
  }
}

async function acceptFriendRequest(userId) {
  try {
    const res = await fetch(`${API_BASE}/friends/${encodeURIComponent(userId)}/accept`, {
      method: "POST",
      headers: authHeaders()
    });
    if (res.ok) {
      toast(t("friends.requestAcceptedToast"));
      await loadFriendsData();
      if (friendsState.activeTab === "friends") renderFriendsList();
      if (state.activeSquad) await loadSquad(state.activeSquad);
    } else {
      const data = await res.json().catch(() => ({}));
      toastError(data, "friends.acceptFailed");
    }
  } catch (e) {
    console.error("[friends] accept request error", e);
    toast(t("common.networkError"));
  }
}
