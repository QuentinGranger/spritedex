"use strict";

async function handleFriendsActionClick(e) {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;

  try {
    switch (action) {
      case "send-request": {
        const userId = btn.dataset.id;
        const res = await fetch(`${API_BASE}/friends/requests`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ addresseeId: userId })
        });
        if (res.ok) {
          toast(t("friends.requestSentToast"));
          await loadFriendsData();
          renderActivePanel();
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "friends.sendFailed");
        }
        break;
      }
      case "accept": {
        const requestId = btn.dataset.requestId;
        const res = await fetch(`${API_BASE}/friends/requests/${encodeURIComponent(requestId)}/accept`, {
          method: "POST",
          headers: authHeaders()
        });
        if (res.ok) {
          toast(t("friends.accepted"));
          await loadFriendsData();
          renderActivePanel();
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "friends.acceptFailed");
        }
        break;
      }
      case "decline": {
        const requestId = btn.dataset.requestId;
        const res = await fetch(`${API_BASE}/friends/requests/${encodeURIComponent(requestId)}/decline`, {
          method: "POST",
          headers: authHeaders()
        });
        if (res.ok) {
          toast(t("friends.declined"));
          await loadFriendsData();
          renderActivePanel();
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "friends.declineFailed");
        }
        break;
      }
      case "cancel": {
        const requestId = btn.dataset.requestId;
        const res = await fetch(`${API_BASE}/friends/requests/${encodeURIComponent(requestId)}`, {
          method: "DELETE",
          headers: authHeaders()
        });
        if (res.ok) {
          toast(t("friends.cancelled"));
          await loadFriendsData();
          renderActivePanel();
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "friends.cancelFailed");
        }
        break;
      }
      case "remove": {
        const friendId = btn.dataset.id;
        if (!confirm(t("friends.confirmRemove"))) return;
        const res = await fetch(`${API_BASE}/friends/${encodeURIComponent(friendId)}`, {
          method: "DELETE",
          headers: authHeaders()
        });
        if (res.ok) {
          toast(t("friends.removed"));
          await loadFriendsData();
          renderActivePanel();
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "friends.removeFailed");
        }
        break;
      }
      case "block": {
        const userId = btn.dataset.id;
        if (!confirm(t("friends.confirmBlock"))) return;
        const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/block`, {
          method: "POST",
          headers: authHeaders()
        });
        if (res.ok) {
          toast(t("friends.blockedToast"));
          await loadFriendsData();
          renderActivePanel();
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "friends.blockFailed");
        }
        break;
      }
      case "unblock": {
        const userId = btn.dataset.id;
        const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/block`, {
          method: "DELETE",
          headers: authHeaders()
        });
        if (res.ok) {
          toast(t("friends.unblocked"));
          await loadFriendsData();
          renderActivePanel();
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "friends.unblockFailed");
        }
        break;
      }
      case "invite-squad": {
        const friendId = btn.dataset.id;
        const friendName = btn.dataset.name || "Ami";
        await openSquadInviteDialog(friendId, friendName);
        break;
      }
      case "passport": {
        const friendId = btn.dataset.id;
        const name = btn.dataset.name || "Ami";
        if (typeof openCollectorPassport === "function") {
          await openCollectorPassport(friendId, name);
        } else {
          toast(t("friends.passportUnavailable"));
        }
        break;
      }
      case "compare": {
        const friendId = btn.dataset.id;
        const name = btn.dataset.name || "Ami";
        await compareWithFriend(friendId, name);
        break;
      }
    }
  } catch (e) {
    console.error("[friends] action error", e);
    toast(t("common.networkError"));
  }
}
