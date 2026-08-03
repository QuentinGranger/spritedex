"use strict";

function renderSquadFriendAction(m) {
  if (String(m.userId) === String(state.userId)) return "";
  const status = m.friendshipStatus;
  const direction = m.friendRequestDirection;
  if (status === "pending" && direction === "received") {
    return `<button class="squad-chip__add squad-chip__add--accept" data-accept-friend="${encodeURIComponent(m.userId)}" title="${t("squad.acceptRequest")}">${t("squad.acceptBtn")}</button>`;
  }
  if (status === "none" && m.canReceiveFriendRequest) {
    return `<button class="squad-chip__add" data-add-friend="${encodeURIComponent(m.userId)}" title="${t("squad.addFriendTitle")}">+</button>`;
  }
  return "";
}

function passesMemberFilter(m) {
  const filter = state.squadMemberFilter || "all";
  if (filter === "all") return true;
  if (filter === "friends") return m.friendshipStatus === "accepted";
  if (filter === "nonfriends") return m.friendshipStatus !== "accepted";
  if (filter === "admins") return m.role === "owner" || m.role === "admin";
  return true;
}

function renderSquadMembers() {
  const isCreator = String(state.squadCreatedBy) === String(state.userId);

  const allMembers = state.squadMembers.map((m) => ({
    ...m,
    role: m.role || (String(m.userId) === String(state.squadCreatedBy) ? "owner" : "member")
  }));

  const filtered = allMembers.filter(passesMemberFilter).sort((a, b) => {
    const aMe = String(a.userId) === String(state.userId) ? -1 : 0;
    const bMe = String(b.userId) === String(state.userId) ? -1 : 0;
    if (aMe !== bMe) return aMe - bMe;
    return (a.username || "").localeCompare(b.username || "");
  });

  const total = allMembers.length;
  const friendCount = allMembers.filter((m) => m.friendshipStatus === "accepted").length;
  const nonFriendCount = total - friendCount;
  const adminCount = allMembers.filter((m) => m.role === "owner" || m.role === "admin").length;

  if (els.squadMemberFilter) {
    els.squadMemberFilter.style.display = total > 0 ? "" : "none";
    els.squadMemberFilter.querySelectorAll(".squad-member-filter__btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.memberFilter === (state.squadMemberFilter || "all"));
    });
  }

  if (els.squadMemberSummary) {
    const summaryParts = [t("squad.memberCount", { count: total, s: total !== 1 ? "s" : "" })];
    if (state.squadMemberFilter === "all" || state.squadMemberFilter === "friends") {
      summaryParts.push(t("squad.friendCount", { count: friendCount, s: friendCount !== 1 ? "s" : "" }));
    }
    if (state.squadMemberFilter === "all" || state.squadMemberFilter === "nonfriends") {
      summaryParts.push(t("squad.otherCount", { count: nonFriendCount, s: nonFriendCount !== 1 ? "s" : "" }));
    }
    if (state.squadMemberFilter === "all" || state.squadMemberFilter === "admins") {
      summaryParts.push(t("squad.adminCount", { count: adminCount }));
    }
    els.squadMemberSummary.textContent = summaryParts.join(" · ");
  }

  const renderChip = (m) => {
    const badge = relationBadge(m);
    const action = renderSquadFriendAction(m);
    const isMe = String(m.userId) === String(state.userId);
    const compare = !isMe
      ? `<button class="squad-chip__compare" data-compare-user="${encodeURIComponent(m.username || m.userId)}" title="${t("squad.compareCollections")}">⇄</button>`
      : "";
    const kick =
      isCreator && !isMe
        ? `<button class="squad-chip__kick" data-kick="${encodeURIComponent(m.userId)}" title="${t("squad.kickBtn")}">✕</button>`
        : "";
    const menu = !isMe
      ? `<button class="squad-chip__menu" data-member-menu="${encodeURIComponent(m.userId)}" data-member-name="${encodeURIComponent(m.username || t("squad.memberFallback"))}" title="${t("common.actions")}">⋯</button>`
      : "";
    const incomplete =
      (m.entryCount || 0) === 0 ? `<span class="squad-chip__warn" title="${t("squad.checklistEmpty")}">?</span>` : "";
    const stale = m.lastUpdated
      ? `<span class="squad-chip__time" title="${t("squad.lastUpdateTitle", { time: timeAgo(m.lastUpdated) })}">${timeAgo(m.lastUpdated)}</span>`
      : `<span class="squad-chip__time squad-chip__time--stale">${t("squad.neverSynced")}</span>`;

    return `
      <div class="squad-chip ${isMe ? "squad-chip--me" : ""}" data-member-id="${encodeURIComponent(m.userId)}">
        <div class="squad-chip__info">
          <div class="squad-chip__name-row">
            <span class="squad-chip__name">${escapeHtml(m.username || t("squad.memberFallback"))}${incomplete}</span>
          </div>
          <div class="squad-chip__meta-row">
            <span class="squad-chip__since">${membershipSince(m.joinedAt)}</span>
            ${stale}
          </div>
        </div>
        <span class="squad-chip__badge ${badge.class}">${badge.label}</span>
        ${action}${compare}${kick}${menu}
      </div>
    `;
  };

  if (filtered.length === 0) {
    els.squadMembers.innerHTML = `<p class="squad-empty">${t("squad.emptyCategory")}</p>`;
    return;
  }
  els.squadMembers.innerHTML = filtered.map(renderChip).join("");
}

function openMemberActionsDialog(userId, username) {
  if (!els.memberActionsDialog || !els.memberActionsList) return;
  const m = state.squadMembers.find((x) => String(x.userId) === String(userId));
  if (!m) return;

  state.pendingMemberAction = { userId, username: username || m.username };
  if (els.memberActionsTitle) {
    els.memberActionsTitle.textContent = `Actions · ${escapeHtml(m.username || t("squad.memberFallback"))}`;
  }

  const items = [];
  items.push({ action: "compare", label: t("squad.compareCollections"), icon: "⇄" });

  if (m.friendshipStatus === "none" && m.canReceiveFriendRequest) {
    items.push({ action: "add-friend", label: t("squad.addFriendTitle"), icon: "+" });
  }

  if (m.friendshipStatus === "accepted") {
    items.push({ action: "invite-squad", label: t("squad.inviteToSquad"), icon: "⚑" });
    items.push({ action: "priorities", label: t("squad.viewPriorities"), icon: "★" });
  } else if (m.friendshipStatus !== "blocked") {
    items.push({ action: "priorities", label: t("squad.viewPriorities"), icon: "★" });
  }

  items.push({ action: "block", label: t("friends.block"), icon: "🚫", danger: true });
  items.push({ action: "report", label: t("squad.report"), icon: "⚠", danger: true });

  els.memberActionsList.innerHTML = items
    .map(
      (it) => `
    <button type="button" class="member-action ${it.danger ? "member-action--danger" : ""}" data-member-action="${it.action}">
      <span class="member-action__icon">${it.icon}</span>
      <span class="member-action__label">${escapeHtml(it.label)}</span>
    </button>
  `
    )
    .join("");

  els.memberActionsDialog.showModal();
}

async function handleMemberAction(action, userId, username) {
  const m = state.squadMembers.find((x) => String(x.userId) === String(userId));
  const name = username || (m && m.username) || t("squad.memberFallback");

  switch (action) {
    case "compare":
      if (typeof compareWithUser === "function") {
        await compareWithUser(userId);
      } else {
        toast(t("squad.compareUnavailable"));
      }
      break;
    case "add-friend":
      if (typeof sendFriendRequest === "function") {
        await sendFriendRequest(userId);
      }
      break;
    case "invite-squad":
      if (typeof openSquadInviteDialog === "function") {
        await openSquadInviteDialog(userId, name);
      }
      break;
    case "priorities":
      await showMemberPriorities(userId, name);
      break;
    case "block":
      if (!confirm(t("squad.confirmBlock", { name: escapeHtml(name) }))) return;
      try {
        const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/block`, {
          method: "POST",
          headers: authHeaders()
        });
        if (res.ok) {
          toast(t("squad.memberBlockedToast", { name: escapeHtml(name) }));
          if (state.activeSquad) await loadSquad(state.activeSquad);
        } else {
          const data = await res.json().catch(() => ({}));
          toastError(data, "squad.blockFailed");
        }
      } catch (e) {
        toast(t("common.networkError"));
      }
      break;
    case "report":
      {
        const reason = prompt(t("squad.confirmReport", { name: escapeHtml(name) }));
        if (!reason || !reason.trim()) return;
        try {
          const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/report`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason.trim() })
          });
          if (res.ok) {
            toast(t("squad.reportSent"));
          } else {
            const data = await res.json().catch(() => ({}));
            toastError(data, "squad.reportFailed");
          }
        } catch (e) {
          toast(t("common.networkError"));
        }
      }
      break;
  }

  if (els.memberActionsDialog) els.memberActionsDialog.close();
}

async function showMemberPriorities(userId, username) {
  try {
    const res = await fetch(`${API_BASE}/collection/${encodeURIComponent(userId)}`, { headers: authHeaders() });
    if (!res.ok) {
      toast(t("squad.collectionPrivate"));
      return;
    }
    const collection = await res.json();
    const priorityIds = Object.entries(collection)
      .filter(([, entry]) => entry.priority && entry.priority !== "none")
      .map(([variantId]) => variantId);

    if (priorityIds.length === 0) {
      toast(t("squad.prioritiesNone", { name: escapeHtml(username) }));
      return;
    }

    // Open compare with this user so priorities can be seen through existing UI.
    if (typeof compareWithUser === "function") {
      await compareWithUser(userId);
    }
  } catch (e) {
    toast(t("squad.prioritiesError"));
  }
}
