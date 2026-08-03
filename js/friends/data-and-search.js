"use strict";

async function loadFriendsData() {
  if (friendsState.loadPromise) return friendsState.loadPromise;
  if (!hasAuthSession()) return;
  friendsState.loadPromise = (async () => {
    friendsState.loading = true;
    try {
      const options = { headers: authHeadersOnly(), cache: "no-store" };
      const [friendsRes, receivedRes, sentRes, blockedRes] = await Promise.all([
        fetch(`${API_BASE}/friends?preview=true`, options),
        fetch(`${API_BASE}/friends/requests/received`, options),
        fetch(`${API_BASE}/friends/requests/sent`, options),
        fetch(`${API_BASE}/users/blocked`, options)
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
      friendsState.loadPromise = null;
    }
  })();
  return friendsState.loadPromise;
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
