"use strict";

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
  list.innerHTML = friendsState.received
    .map(
      (r) => `
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
  `
    )
    .join("");
}

function renderSentList() {
  const list = getFriendsEl("sentList");
  if (!list) return;
  if (friendsState.sent.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptySent"));
    return;
  }
  list.innerHTML = friendsState.sent
    .map(
      (r) => `
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
  `
    )
    .join("");
}

function renderBlockedList() {
  const list = getFriendsEl("blockedList");
  if (!list) return;
  if (friendsState.blocked.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptyBlocked"));
    return;
  }
  list.innerHTML = friendsState.blocked
    .map(
      (u) => `
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
  `
    )
    .join("");
}

function renderAddFriendResults() {
  const list = getFriendsEl("addFriendResults");
  if (!list) return;
  if (friendsState.searchResults.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptySearch"));
    return;
  }
  list.innerHTML = friendsState.searchResults
    .map(
      (u) => `
    <div class="friend-item" data-user-id="${escapeHtml(String(u.id))}">
      ${friendAvatarHTML(u)}
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(u.displayName || u.username || t("friends.defaultUser"))}</div>
        <div class="friend-meta">${escapeHtml(u.username ? `@${u.username}` : "")}</div>
      </div>
      <div class="friend-actions">
        ${
          u.canReceiveFriendRequest
            ? `<button class="ghost-button success-text" data-action="send-request" data-id="${escapeHtml(String(u.id))}">${t("friends.addUser")}</button>`
            : `<span class="friend-meta">${t("friends.unavailableUser")}</span>`
        }
      </div>
    </div>
  `
    )
    .join("");
}

function renderSuggestions() {
  const list = getFriendsEl("friendSuggestions");
  if (!list) return;
  if (friendsState.suggestions.length === 0) {
    list.innerHTML = emptyFriendsHTML(t("friends.emptySuggestions"));
    return;
  }
  list.innerHTML = friendsState.suggestions
    .map(
      (u) => `
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
  `
    )
    .join("");
}

function renderActivePanel() {
  switch (friendsState.activeTab) {
    case "friends":
      renderFriendsList();
      break;
    case "received":
      renderReceivedList();
      break;
    case "sent":
      renderSentList();
      break;
    case "blocked":
      renderBlockedList();
      break;
    case "add":
      renderAddFriendResults();
      renderSuggestions();
      break;
    case "qr":
      /* QR shown on demand */ break;
  }
}
