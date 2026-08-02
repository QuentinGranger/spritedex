"use strict";

// ── Squad : Compute diffs for all items ──
function computeSquadDiffs(items, players, filter, query) {
  const rows = [];
  for (const item of items) {
    if (query) {
      const q = query;
      const match = item.spriteName.toLowerCase().includes(q)
        || item.variant.toLowerCase().includes(q)
        || item.rarity.toLowerCase().includes(q);
      if (!match) continue;
    }

    if (filter.startsWith("rarity:") && item.rarity !== filter.split(":")[1]) continue;
    if (filter.startsWith("variant:") && item.variant !== filter.split(":")[1]) continue;

    const statuses = [];
    const ownedBy = [];
    const missingBy = [];
    const priorityBy = [];

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const entry = p.collection[item.id];
      const status = entry ? entry.status || "new" : "new";
      const prio = entry ? entry.priority || "none" : "none";
      statuses.push(status);

      if (status === "owned") ownedBy.push(p.name);
      else missingBy.push(p.name);

      if ((prio !== "none" && prio !== "ignored") || status === "priority") {
        priorityBy.push(p.name);
      }
    }

    const ownedCount = ownedBy.length;
    const missingCount = missingBy.length;
    const everyoneHasIt = ownedCount === players.length;
    const nobodyHasIt = ownedCount === 0;
    const myStatus = statuses[0];
    const meOwned = myStatus === "owned";
    const othersOwned = statuses.slice(1).some(s => s === "owned");

    if (filter === "diff" && everyoneHasIt) continue;
    if (filter === "missing-me" && meOwned) continue;
    if (filter === "missing-all" && !nobodyHasIt) continue;
    if (filter === "exclusive" && (!meOwned || othersOwned)) continue;
    if (filter === "everyone" && !everyoneHasIt) continue;
    if (filter === "team-prio" && priorityBy.length === 0) continue;
    if (filter === "duo") {
      const hasTradeOpportunity = players.some((_, i) =>
        players.some((_, j) => i !== j && statuses[i] === "owned" && statuses[j] !== "owned")
      );
      if (!hasTradeOpportunity || everyoneHasIt) continue;
    }

    rows.push({
      item,
      statuses,
      ownedBy,
      missingBy,
      priorityBy,
      ownedCount,
      missingCount,
      everyoneHasIt,
      nobodyHasIt
    });
  }
  return rows;
}

// ── Squad : Compact status icons (fast rendering) ──
const SQUAD_ICONS = {
  owned:       '<span class="sq-icon sq-icon--owned"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>',
  missing:     '<span class="sq-icon sq-icon--missing"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>',
  priority:    '<span class="sq-icon sq-icon--priority"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></span>',
  unsure:      '<span class="sq-icon sq-icon--unsure"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg></span>',
  unavailable: '<span class="sq-icon sq-icon--unavail"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>',
  spotted:     '<span class="sq-icon sq-icon--spotted"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>',
  new:         '<span class="sq-icon sq-icon--new"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>'
};

function squadIcon(status) {
  if (!status || status === "new") return SQUAD_ICONS.new;
  return SQUAD_ICONS[status] || SQUAD_ICONS.new;
}

// ── Squad : Render members chips ──
function timeAgo(dateStr) {
  if (!dateStr) return t("squad.neverSynced");
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("squad.justNow");
  if (mins < 60) return t("squad.timeAgoMins", { mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("squad.timeAgoHours", { hrs });
  const days = Math.floor(hrs / 24);
  return t("squad.timeAgoDays", { days });
}

function membershipSince(joinedAt) {
  if (!joinedAt) return t("squad.memberRecent");
  const days = Math.floor((Date.now() - new Date(joinedAt).getTime()) / 86400000);
  if (days === 0) return t("squad.memberToday");
  if (days === 1) return t("squad.memberOneDay");
  return t("squad.memberDaysAgo", { days: days });
}

function relationBadge(m) {
  const isMe = String(m.userId) === String(state.userId);
  if (isMe) {
    return { label: t("squad.me"), class: "squad-chip__badge--me" };
  }
  switch (m.friendshipStatus) {
    case "accepted":
      return { label: t("squad.friend"), class: "squad-chip__badge--friend" };
    case "pending":
      return { label: t("squad.pendingInvite"), class: "squad-chip__badge--pending" };
    case "blocked":
      return { label: t("squad.blockedBadge"), class: "squad-chip__badge--blocked" };
    default:
      return { label: t("squad.memberOnly"), class: "squad-chip__badge--member" };
  }
}

