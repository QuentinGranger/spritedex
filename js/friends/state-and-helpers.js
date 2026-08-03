"use strict";

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
  loading: false,
  loadPromise: null
};

const pendingSquadInvite = { friendId: null };
let friendsWs = null;
let friendsWsReconnectTimer = null;
let friendsRefreshTimer = null;
let friendsRefreshQueued = false;
const FRIENDS_FALLBACK_REFRESH_MS = 30000;

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
  return getDisplayName(f).toLowerCase().includes(term) || (f.username || "").toLowerCase().includes(term);
}

function getTime(ts) {
  if (!ts) return 0;
  const d = new Date(ts);
  return isNaN(d) ? 0 : d.getTime();
}

function isOnline(f) {
  return f.lastActive && Date.now() - getTime(f.lastActive) < 15 * 60 * 1000;
}

function isRecentlyUpdated(f) {
  return f.lastCollectionUpdate && Date.now() - getTime(f.lastCollectionUpdate) < 7 * 24 * 60 * 60 * 1000;
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
