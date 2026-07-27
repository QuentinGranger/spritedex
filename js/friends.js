const friendsState = {
  friends: [],
  received: [],
  sent: [],
  blocked: [],
  searchResults: [],
  suggestions: [],
  activeTab: "friends",
  listFilter: "all",
  listSort: "name",
  listSearch: "",
  loading: false
};

const pendingSquadInvite = { friendId: null };

function getFriendsEl(id) {
  return document.getElementById(id);
}

function friendAvatarHTML(user) {
  user = user && typeof user === "object" ? user : {};
  const initial = escapeHtml((user.displayName || user.username || "?").slice(0, 2));
  const avatarUrl = safeImageUrl(user.avatarUrl);
  if (avatarUrl) {
    return `<div class="friend-avatar" style="background-image:url('${escapeHtml(avatarUrl)}'); background-size:cover; background-position:center; color:transparent" aria-label="${initial}">${initial}</div>`;
  }
  return `<div class="friend-avatar">${initial}</div>`;
}

function friendMeta(user) {
  const parts = [];
  if (user.username) parts.push(`@${escapeHtml(user.username)}`);
  if (user.commonSquad) parts.push(t("friends.squadBadge"));
  if (user.lastActive) parts.push(t("friends.online"));
  return parts.join(" · ");
}

function getDisplayName(f) {
  return f.displayName || f.username || "";
}

function nameMatches(f, term) {
  return getDisplayName(f).toLowerCase().includes(term) ||
    (f.username || "").toLowerCase().includes(term);
}

function getTime(ts) {
  if (!ts) return 0;
  const d = new Date(ts);
  return isNaN(d) ? 0 : d.getTime();
}

function isOnline(f) {
  return f.lastActive && (Date.now() - getTime(f.lastActive) < 15 * 60 * 1000);
}

function isRecentlyUpdated(f) {
  return f.lastCollectionUpdate && (Date.now() - getTime(f.lastCollectionUpdate) < 7 * 24 * 60 * 60 * 1000);
}

function getComplementarity(f) {
  const summary = f.preview?.summary;
  if (summary && typeof summary.complementarityScore === "number") return summary.complementarityScore;
  if (summary && typeof summary.complementarityRate === "number") return summary.complementarityRate;
  if (summary && typeof summary.onlyUserBCount === "number") {
    return summary.onlyUserBCount;
  }
  return -1;
}

function hasComplementaryVariants(f) {
  return getComplementarity(f) > 0;
}

function getProgression(f) {
  return typeof f.completionRate === "number" ? f.completionRate : -1;
}

function getLastActiveTs(f) {
  return Math.max(getTime(f.lastActive), getTime(f.lastCollectionUpdate), getTime(f.friendSince));
}

function getAddedTs(f) {
  return getTime(f.friendSince);
}

function sortFriends(items) {
  const sort = friendsState.listSort;
  const sorted = items.slice();
  sorted.sort((a, b) => {
    switch (sort) {
      case "name":
        return getDisplayName(a).localeCompare(getDisplayName(b), "fr", { sensitivity: "base" });
      case "lastActive":
        return getLastActiveTs(b) - getLastActiveTs(a);
      case "complementarity":
        return getComplementarity(b) - getComplementarity(a);
      case "progression":
        return getProgression(b) - getProgression(a);
      case "added":
        return getAddedTs(b) - getAddedTs(a);
      default:
        return getDisplayName(a).localeCompare(getDisplayName(b));
    }
  });
  return sorted;
}

function emptyFriendsHTML(message = t("friends.emptyDefault")) {
  return `<p class="friend-empty">${escapeHtml(message)}</p>`;
}

function setFriendsTab(tab) {
  friendsState.activeTab = tab;
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

function getPendingEntries() {
  const entries = [];
  for (const r of friendsState.received) {
    entries.push({ kind: "received", requestId: r.requestId, createdAt: r.createdAt, user: r.user, commonSquad: r.commonSquad });
  }
  for (const r of friendsState.sent) {
    entries.push({ kind: "sent", requestId: r.requestId, createdAt: r.createdAt, user: r.user });
  }
  return entries.sort((a, b) => getTime(b.createdAt) - getTime(a.createdAt));
}

function renderPendingItem(item) {
  const user = item.user || {};
  const actions = item.kind === "received"
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

function renderFriendItem(f) {
  const comp = getComplementarity(f);
  const progress = getProgression(f);
  const metaParts = [];
  if (f.username) metaParts.push(`@${escapeHtml(f.username)}`);
  if (f.commonSquad) metaParts.push(t("friends.squadBadge"));
  if (isOnline(f)) metaParts.push(t("friends.online"));
  if (progress >= 0) metaParts.push(t("friends.progressMeta", { pct: progress }));
  if (comp > 0) metaParts.push(t("friends.complementaryMeta", { pct: comp }));
  const meta = metaParts.join(" · ");
  const inviteSquad = canInviteToSquad(f)
    ? `<button class="ghost-button" data-action="invite-squad" data-id="${escapeHtml(String(f.id))}" data-name="${escapeHtml(getDisplayName(f))}">${t("friends.inviteToSquad")}</button>`
    : "";
  return `
    <div class="friend-item" data-friend-id="${escapeHtml(String(f.id))}">
      ${friendAvatarHTML(f)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(getDisplayName(f) || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${meta}</div>
      </div>
      <div class="friend-actions">
        <button class="ghost-button" data-action="passport" data-id="${escapeHtml(String(f.id))}" data-name="${escapeHtml(getDisplayName(f))}">${t("friends.passport")}</button>
        <button class="ghost-button" data-action="compare" data-id="${escapeHtml(String(f.id))}" data-name="${escapeHtml(getDisplayName(f))}">${t("friends.compare")}</button>
        ${inviteSquad}
        <button class="ghost-button danger-text" data-action="remove" data-id="${escapeHtml(String(f.id))}">${t("friends.remove")}</button>
        <button class="ghost-button" data-action="block" data-id="${escapeHtml(String(f.id))}">${t("friends.block")}</button>
      </div>
    </div>
  `;
}

function renderFriendsList() {
  const list = getFriendsEl("friendsList");
  if (!list) return;
  const term = friendsState.listSearch.toLowerCase();

  if (friendsState.listFilter === "pending") {
    let entries = getPendingEntries();
    if (term) entries = entries.filter((e) => nameMatches(e.user, term));
    if (entries.length === 0) {
      list.innerHTML = emptyFriendsHTML(t("friends.emptyPending"));
      return;
    }
    list.innerHTML = entries.map(renderPendingItem).join("");
    return;
  }

  let items = friendsState.friends;
  if (term) items = items.filter((f) => nameMatches(f, term));

  switch (friendsState.listFilter) {
    case "online":
      items = items.filter(isOnline);
      break;
    case "squad":
      items = items.filter((f) => f.commonSquad);
      break;
    case "recent":
      items = items.filter(isRecentlyUpdated);
      break;
    case "complementary":
      items = items.filter(hasComplementaryVariants);
      break;
  }

  items = sortFriends(items);

  if (items.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptyFriends"));
    return;
  }

  list.innerHTML = items.map(renderFriendItem).join("");
}

function renderReceivedList() {
  const list = getFriendsEl("receivedList");
  if (!list) return;
  if (friendsState.received.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptyReceived"));
    return;
  }
  list.innerHTML = friendsState.received.map((r) => `
    <div class="friend-item" data-request-id="${escapeHtml(String(r.requestId))}">
      ${friendAvatarHTML(r.user)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(r.user.displayName || r.user.username || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${escapeHtml(r.user.username ? `@${r.user.username}` : "")}${r.commonSquad ? ` · ${t("friends.squadBadge")}` : ""}</div>
      </div>
      <div class="friend-actions">
        <button class="ghost-button success-text" data-action="accept" data-request-id="${escapeHtml(String(r.requestId))}">${t("friends.accept")}</button>
        <button class="ghost-button danger-text" data-action="decline" data-request-id="${escapeHtml(String(r.requestId))}">${t("friends.decline")}</button>
        <button class="ghost-button" data-action="block" data-id="${escapeHtml(String(r.user.id))}">${t("friends.block")}</button>
      </div>
    </div>
  `).join("");
}

function renderSentList() {
  const list = getFriendsEl("sentList");
  if (!list) return;
  if (friendsState.sent.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptySent"));
    return;
  }
  list.innerHTML = friendsState.sent.map((r) => `
    <div class="friend-item" data-request-id="${escapeHtml(String(r.requestId))}">
      ${friendAvatarHTML(r.user)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(r.user.displayName || r.user.username || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${escapeHtml(r.user.username ? `@${r.user.username}` : "")}</div>
      </div>
      <div class="friend-actions">
        <button class="ghost-button danger-text" data-action="cancel" data-request-id="${escapeHtml(String(r.requestId))}">${t("friends.cancel")}</button>
      </div>
    </div>
  `).join("");
}

function renderBlockedList() {
  const list = getFriendsEl("blockedList");
  if (!list) return;
  if (friendsState.blocked.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptyBlocked"));
    return;
  }
  list.innerHTML = friendsState.blocked.map((u) => `
    <div class="friend-item" data-user-id="${escapeHtml(String(u.id))}">
      ${friendAvatarHTML(u)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(u.displayName || u.username || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${escapeHtml(u.username ? `@${u.username}` : "")}</div>
      </div>
      <div class="friend-actions">
        <button class="ghost-button" data-action="unblock" data-id="${escapeHtml(String(u.id))}">${t("friends.unblock")}</button>
      </div>
    </div>
  `).join("");
}

function renderAddFriendResults() {
  const list = getFriendsEl("addFriendResults");
  if (!list) return;
  if (friendsState.searchResults.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptySearch"));
    return;
  }
  list.innerHTML = friendsState.searchResults.map((u) => `
    <div class="friend-item" data-user-id="${escapeHtml(String(u.id))}">
      ${friendAvatarHTML(u)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(u.displayName || u.username || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${escapeHtml(u.username ? `@${u.username}` : "")}</div>
      </div>
      <div class="friend-actions">
        ${u.canReceiveFriendRequest
          ? `<button class="ghost-button success-text" data-action="send-request" data-id="${escapeHtml(String(u.id))}">${t("friends.addUser")}</button>`
          : `<span class="friend-meta">${t("friends.unavailableUser")}</span>`}
      </div>
    </div>
  `).join("");
}

function renderSuggestions() {
  const list = getFriendsEl("friendSuggestions");
  if (!list) return;
  if (friendsState.suggestions.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptySuggestions"));
    return;
  }
  list.innerHTML = friendsState.suggestions.map((u) => `
    <div class="friend-item" data-user-id="${escapeHtml(String(u.id))}">
      ${friendAvatarHTML(u)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(u.displayName || u.username || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${escapeHtml(u.username ? `@${u.username}` : "")} · ${t("friends.squadBadge")}</div>
      </div>
      <div class="friend-actions">
        <button class="ghost-button success-text" data-action="send-request" data-id="${escapeHtml(String(u.id))}">${t("friends.addUser")}</button>
      </div>
    </div>
  `).join("");
}

function renderActivePanel() {
  switch (friendsState.activeTab) {
    case "friends": renderFriendsList(); break;
    case "received": renderReceivedList(); break;
    case "sent": renderSentList(); break;
    case "blocked": renderBlockedList(); break;
    case "add": renderAddFriendResults(); renderSuggestions(); break;
    case "qr": /* QR shown on demand */ break;
  }
}

async function loadFriendsData() {
  if (friendsState.loading) return;
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  friendsState.loading = true;

  try {
    const [friendsRes, receivedRes, sentRes, blockedRes] = await Promise.all([
      fetch(`${API_BASE}/friends?preview=true`, { headers: authHeadersOnly() }),
      fetch(`${API_BASE}/friends/requests/received`, { headers: authHeadersOnly() }),
      fetch(`${API_BASE}/friends/requests/sent`, { headers: authHeadersOnly() }),
      fetch(`${API_BASE}/users/blocked`, { headers: authHeadersOnly() })
    ]);

    if (!friendsRes.ok) throw new Error("friends");
    const friendsData = await friendsRes.json();
    friendsState.friends = friendsData.friends || [];

    if (receivedRes.ok) {
      const data = await receivedRes.json();
      friendsState.received = data.requests || [];
    }
    if (sentRes.ok) {
      const data = await sentRes.json();
      friendsState.sent = data.requests || [];
    }
    if (blockedRes.ok) {
      const data = await blockedRes.json();
      friendsState.blocked = data.blocked || [];
    }

    await loadSquadSuggestions();
  } catch (e) {
    console.error("[friends] load error", e);
  } finally {
    friendsState.loading = false;
  }
}

async function loadSquadSuggestions() {
  friendsState.suggestions = [];
  const code = state.activeSquad || localStorage.getItem("sprite-index_squad");
  if (!code || !state.userId) return;

  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}`, { headers: authHeadersOnly() });
    if (!res.ok) return;
    const data = await res.json();
    state.activeSquad = data.code;
    state.squadCreatedBy = data.createdBy;
    state.squadJoinOpen = data.joinOpen !== false;
    state.squadMembers = (data.members || []).filter((m) => String(m.userId) !== String(state.userId));

    const friendIds = new Set(friendsState.friends.map((f) => String(f.id)));
    friendIds.add(String(state.userId));
    friendsState.suggestions = state.squadMembers
      .filter((m) => !friendIds.has(String(m.userId)))
      .map((m) => ({
        id: m.userId,
        username: m.username,
        displayName: m.username,
        avatarUrl: m.avatarUrl
      }));
  } catch (e) {
    console.error("[friends] suggestions error", e);
  }
}

async function searchAndRenderAddFriend() {
  const input = getFriendsEl("addFriendSearch");
  if (!input) return;
  const q = input.value.trim();
  if (!q || q.length < 3) {
    toast(t("friends.searchMinChars"));
    return;
  }
  friendsState.searchResults = [];
  renderAddFriendResults();

  try {
    const res = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(q)}`, { headers: authHeadersOnly() });
    if (!res.ok) throw new Error("search failed");
    const data = await res.json();
    friendsState.searchResults = data.users || [];
  } catch (e) {
    toast(t("friends.searchError"));
    console.error("[friends] search error", e);
  }
  renderAddFriendResults();
}

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

async function compareWithFriend(friendId, name, options = {}) {
  try {
    const source = options && options.source ? String(options.source) : "friends_list";
    const qs = source ? `?source=${encodeURIComponent(source)}` : "";
    const res = await fetch(`${API_BASE}/compare/${encodeURIComponent(friendId)}${qs}`, { headers: authHeadersOnly() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toastError(data, "friends.compareError");
      return;
    }
    const result = await res.json();

    // Rebuild friend's collection from server records so renderCompare works offline afterwards.
    const friendCollection = createSafeRecord();
    for (const rec of result.records || []) {
      const entry = rec.userB || {};
      const safeEntry = sanitizeCollectionEntry(entry);
      if (rec.variantId) {
        setSafeRecordValue(friendCollection, rec.variantId, safeEntry);
      }
      if (rec.id && rec.id !== rec.variantId) {
        setSafeRecordValue(friendCollection, rec.id, safeEntry);
      }
      if (Array.isArray(rec.legacyKeys)) {
        for (const key of rec.legacyKeys) {
          setSafeRecordValue(friendCollection, key, safeEntry);
        }
      }
    }

    state.compareTarget = {
      userId: Number(friendId),
      username: name,
      collection: friendCollection
    };
    renderCompare();
    switchToCompareView();
  } catch (e) {
    console.error("[friends] compare error", e);
    toast(t("compare.error"));
  }
}

async function openSquadInviteDialog(friendId, friendName) {
  if (!els.squadInviteDialog) return;
  pendingSquadInvite.friendId = friendId;
  if (els.squadInviteDialogTitle) {
    els.squadInviteDialogTitle.textContent = t("friends.inviteDialogTitle", { name: friendName || t("squad.friend") });
  }
  if (els.squadInviteDialogOptions) {
    els.squadInviteDialogOptions.innerHTML = `<p class='friend-meta'>${t("friends.loadingSquads")}</p>`;
  }
  if (els.squadInviteDialogConfirm) els.squadInviteDialogConfirm.disabled = true;
  els.squadInviteDialog.showModal();
  try {
    const res = await fetch(`${API_BASE}/squads/invitable?friendId=${encodeURIComponent(friendId)}`, { headers: authHeaders() });
    if (!res.ok) throw new Error("failed to load squads");
    const data = await res.json();
    renderSquadInviteOptions(data.squads || []);
  } catch (e) {
    console.error("[friends] invitable squads", e);
    if (els.squadInviteDialogOptions) {
      els.squadInviteDialogOptions.innerHTML = `<p class='friend-meta'>${t("friends.loadSquadsFailed")}</p>`;
    }
  }
}

function renderSquadInviteOptions(squads) {
  if (!els.squadInviteDialogOptions) return;
  if (!squads.length) {
    els.squadInviteDialogOptions.innerHTML = `<p class='friend-meta'>${t("friends.noInvitableSquads")}</p>`;
    if (els.squadInviteDialogConfirm) els.squadInviteDialogConfirm.disabled = true;
    return;
  }
  const html = squads.map((s, i) => `
    <label class="squad-invite-option">
      <input type="radio" name="squadInviteChoice" value="${escapeHtml(s.code)}" ${i === 0 ? "checked" : ""}>
      <span class="squad-invite-option__name">${escapeHtml(s.name)}</span>
      <span class="squad-invite-option__meta">${escapeHtml(s.code)}</span>
    </label>
  `).join("");
  els.squadInviteDialogOptions.innerHTML = html;
  if (els.squadInviteDialogConfirm) els.squadInviteDialogConfirm.disabled = false;
}

function getSelectedSquadInviteCode() {
  const checked = els.squadInviteDialogOptions?.querySelector("input[name='squadInviteChoice']:checked");
  return checked ? checked.value : null;
}

async function handleSquadInviteSubmit(e) {
  e.preventDefault();
  const code = getSelectedSquadInviteCode();
  const friendId = pendingSquadInvite.friendId;
  if (!code || !friendId) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/invite/${encodeURIComponent(friendId)}`, {
      method: "POST",
      headers: authHeaders()
    });
    if (res.ok) {
      toast(t("friends.inviteSent"));
      els.squadInviteDialog.close();
      await loadSquadSuggestions();
      renderFriendsList();
    } else {
      const data = await res.json().catch(() => ({}));
      toastError(data, "friends.inviteFailed");
    }
  } catch (e) {
    console.error("[friends] invite to squad", e);
    toast(t("common.networkError"));
  }
}

async function copyFriendInviteLink() {
  try {
    const res = await fetch(`${API_BASE}/friends/invite-links`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ duration: "permanent" })
    });
    if (!res.ok) throw new Error("invite link failed");
    const data = await res.json();
    const fallbackLink = data.token
      ? `${webOrigin()}/?invite=${encodeURIComponent(String(data.token))}`
      : "";
    const link = safeAppWebUrl(data.url) || safeAppWebUrl(fallbackLink);
    if (!link) throw new Error("invalid invite link");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(link);
      toast(t("friends.linkCopied"));
    } else {
      toast(t("friends.linkFallback", { link }));
    }
  } catch (e) {
    console.error("[friends] invite link error", e);
    toast(t("friends.linkFailed"));
  }
}

async function showMyQrCode() {
  const img = getFriendsEl("friendQrImg");
  const hint = getFriendsEl("friendQrHint");
  if (!state.userId || !localStorage.getItem(TOKEN_KEY)) {
    if (hint) hint.textContent = t("friends.loginForQr");
    toast(t("friends.loginForQr"));
    return;
  }
  if (img) { img.style.display = "none"; img.src = ""; }
  if (hint) hint.textContent = t("friends.qrGenerating");
  try {
    const res = await fetch(`${API_BASE}/friends/invite-links`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ duration: "permanent" })
    });
    if (!res.ok) {
      throw new Error(`invite link failed: ${res.status}`);
    }
    const data = await res.json();
    if (!data.token) throw new Error("missing token");

    // Prefer server-rendered QR, fallback to a public QR API if the endpoint is unavailable.
    const qrUrl = `${API_BASE}/friends/invite-links/${encodeURIComponent(data.token)}/qr`;
    const qrRes = await fetch(qrUrl, { headers: authHeadersOnly() });
    if (!qrRes.ok) {
      throw new Error(`qr failed: ${qrRes.status}`);
    }
    const qrData = await qrRes.json();
    const qrImage = safeImageUrl(qrData.qr);
    if (img && qrImage) {
      img.src = qrImage;
      img.style.display = "block";
      if (hint) hint.style.display = "none";
      return;
    }
    throw new Error("no qr data");
  } catch (e) {
    console.error("[friends] qr error", e);
    if (hint) hint.textContent = t("friends.qrFailed");
    toast(t("friends.qrFailedShort"));
  }
}

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

async function renderFriends() {
  setFriendsTab(friendsState.activeTab);
  await loadFriendsData();
  renderActivePanel();
}
