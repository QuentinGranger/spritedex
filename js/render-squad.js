// ── Squad : Create ──
async function createSquad() {
  if (!state.userId) { toast(t("squad.loginFirst")); return; }
  const name = els.squadNameInput.value.trim() || t("squad.defaultName");
  try {
    const res = await fetch(`${API_BASE}/squads`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name })
    });
    if (!res.ok) {
      const err = await res.json();
      toastError(err, "squad.createError");
      return;
    }
    const squad = await res.json();
    state.activeSquad = squad.code;
    localStorage.setItem("sprite-index_squad", squad.code);
    toast(t("squad.created", { code: squad.code }));
    await loadSquad(squad.code);
  } catch (e) {
    toast(t("common.networkError"));
  }
}

// ── Squad : Join ──
async function joinSquad() {
  if (!state.userId) { toast(t("squad.loginFirst")); return; }
  const code = els.squadCodeInput.value.trim().toUpperCase();
  if (!code) { toast(t("squad.enterCode")); return; }
  try {
    const res = await fetch(`${API_BASE}/squads/join`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ code })
    });
    if (!res.ok) {
      const err = await res.json();
      toastError(err, "squad.joinError");
      return;
    }
    const squad = await res.json();
    state.activeSquad = squad.code;
    localStorage.setItem("sprite-index_squad", squad.code);
    toast(t("squad.joined", { name: squad.name }));
    await loadSquad(squad.code);
  } catch (e) {
    toast(t("common.networkError"));
  }
}

// ── Squad : Leave ──
async function leaveSquad() {
  if (!state.activeSquad || !state.userId) return;
  try {
    await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/leave`, {
      method: "POST",
      headers: authHeaders()
    });
  } catch (e) {
    console.warn("Leave failed", e);
  }
  state.activeSquad = null;
  state.squadMembers = [];
  localStorage.removeItem("sprite-index_squad");
  showSquadLobby();
  toast(t("squad.left"));
}

// ── Squad : Load from server ──
async function loadSquad(code) {
  if (!code) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}`, { headers: authHeaders() });
    if (!res.ok) {
      toast(t("squad.notFound"));
      state.activeSquad = null;
      localStorage.removeItem("sprite-index_squad");
      showSquadLobby();
      return;
    }
    const data = await res.json();
    state.activeSquad = String(data.code || "");
    state.squadCreatedBy = data.createdBy;
    state.squadJoinOpen = data.joinOpen !== false;
    state.squadMembers = Array.isArray(data.members)
      ? data.members.map((member) => ({
        ...(member && typeof member === "object" ? member : {}),
        collection: sanitizeCollection(member?.collection)
      }))
      : [];

    els.squadActiveName.textContent = data.name;
    els.squadActiveCode.textContent = data.code;
    showSquadActive();
    renderSquadAdmin();
    renderSquad();
    renderSquadRecommendedFriends();
    renderSquadComplementaryPairs();
    if (typeof loadSquadWishlist === "function") loadSquadWishlist(state.activeSquad);
  } catch (e) {
    toast(t("common.networkError"));
  }
}

// ── Squad : restore on init ──
async function restoreSquad() {
  connectSquadWs();
  const code = localStorage.getItem("sprite-index_squad");
  if (code && state.userId) {
    state.activeSquad = code;
    await loadSquad(code);
  }
}

// ── Squad : WebSocket real-time ──
let squadWs = null;
let wsReconnectTimer = null;

function connectSquadWs() {
  if (squadWs && squadWs.readyState <= 1) return;
  if (!state.userId) return;

  squadWs = new WebSocket(WS_URL);

  squadWs.onopen = () => {
    // Authenticate the WS with the session token; the server derives the userId
    // from it (never trusts a client-supplied id).
    squadWs.send(JSON.stringify({ type: "auth", token: localStorage.getItem(TOKEN_KEY) }));
  };

  squadWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "squad_update" && msg.code === state.activeSquad) {
        loadSquad(state.activeSquad);
      }
      if (msg.type === "squad_completion_update" && msg.code === state.activeSquad && msg.summary) {
        if (typeof squadEngineReport !== "undefined" && squadEngineReport) {
          squadEngineReport.summary = msg.summary;
          squadEngineReport.catalogueVersion = msg.summary.catalogueVersion;
          squadEngineReport.generatedAt = msg.summary.generatedAt;
          if (typeof renderSquadEngineTab === "function") renderSquadEngineTab(squadEngineTab);
        }
      }
      if (msg.type === "news_update") {
        checkNewsNotifications();
        if (notifDropdownOpen) {
          notifOffset = 0;
          notifHasMore = true;
          const list = document.getElementById("notifList");
          if (list) list.innerHTML = "";
          loadMoreNews();
        }
      }
    } catch {}
  };

  squadWs.onclose = () => {
    squadWs = null;
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectSquadWs, 3000);
  };

  squadWs.onerror = () => {
    squadWs.close();
  };
}

function disconnectSquadWs() {
  clearTimeout(wsReconnectTimer);
  if (squadWs) {
    squadWs.onclose = null;
    squadWs.close();
    squadWs = null;
  }
}

function startSquadPolling() {
  connectSquadWs();
}

function stopSquadPolling() {
  // keep WS alive across tabs, it's lightweight
}

// ── Squad : UI toggles ──
function showSquadLobby() {
  els.squadLobby.style.display = "block";
  els.squadActive.style.display = "none";
  stopSquadPolling();
}

function showSquadActive() {
  els.squadLobby.style.display = "none";
  els.squadActive.style.display = "block";
  populateSquadVariantOptions();
  startSquadPolling();
}

// ── Squad : Admin panel (creator only) ──
function renderSquadAdmin() {
  const wrap = document.getElementById("squadAdminWrap");
  if (!wrap) return;
  const isCreator = String(state.squadCreatedBy) === String(state.userId);
  if (!isCreator) { wrap.innerHTML = ""; return; }

  const joinLabel = state.squadJoinOpen ? t("squad.joinOpen") : t("squad.joinClosed");
  const joinIcon = state.squadJoinOpen ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>' : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
  const joinLink = `${webOrigin()}/?joinSquad=${encodeURIComponent(String(state.activeSquad || ""))}`;

  wrap.innerHTML = `
    <div class="squad-admin">
      <h4 class="squad-admin__title"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> ${t("squad.adminTitle")}</h4>
      <div class="squad-admin__row">
        <span class="squad-admin__label">${t("squad.inviteLink")}</span>
        <button class="ghost-button squad-admin__btn" id="adminCopyLink" title="${t('squad.copyBtn')}"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> \${t("squad.copyBtn")}</button>
      </div>
      <div class="squad-admin__link">${escapeHtml(joinLink)}</div>
      <div class="squad-admin__row">
        <span class="squad-admin__label">\${t("squad.access")} ${joinIcon} ${joinLabel}</span>
        <button class="ghost-button squad-admin__btn" id="adminToggleJoin">${state.squadJoinOpen ? t("squad.closeJoin") : t("squad.openJoin")}</button>
      </div>
      <div class="squad-admin__row">
        <span class="squad-admin__label">${t("squad.currentCode")}</span>
        <button class="ghost-button squad-admin__btn squad-admin__btn--warn" id="adminRegenCode">${t("squad.regenBtn")}</button>
      </div>
      <div class="squad-admin__row">
        <button class="ghost-button squad-admin__btn squad-admin__btn--danger" id="adminDeleteSquad">${t("squad.deleteBtn")}</button>
      </div>
    </div>`;

  document.getElementById("adminCopyLink").addEventListener("click", () => {
    navigator.clipboard.writeText(joinLink).then(() => toast(t("squad.linkCopied")));
  });
  document.getElementById("adminToggleJoin").addEventListener("click", toggleSquadJoin);
  document.getElementById("adminRegenCode").addEventListener("click", regenerateSquadCode);
  document.getElementById("adminDeleteSquad").addEventListener("click", deleteSquad);
}

async function toggleSquadJoin() {
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/toggle-join`, {
      method: "POST", headers: authHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      state.squadJoinOpen = data.joinOpen;
      renderSquadAdmin();
      toast(data.joinOpen ? t("squad.opened") : t("squad.closed"));
    } else { toastError(data, "common.error"); }
  } catch (e) { toast(t("common.networkError")); }
}

async function regenerateSquadCode() {
  if (!confirm(t("squad.confirmRegen"))) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/regenerate`, {
      method: "POST", headers: authHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      state.activeSquad = data.code;
      localStorage.setItem("sprite-index_squad", data.code);
      els.squadActiveCode.textContent = data.code;
      renderSquadAdmin();
      toast(t("squad.newCode", { code: data.code }));
    } else { toastError(data, "common.error"); }
  } catch (e) { toast(t("common.networkError")); }
}

async function deleteSquad() {
  if (!confirm(t("squad.confirmDelete"))) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}`, {
      method: "DELETE", headers: authHeaders()
    });
    if (res.ok) {
      state.activeSquad = null;
      state.squadMembers = [];
      localStorage.removeItem("sprite-index_squad");
      showSquadLobby();
      toast(t("squad.deleted"));
    } else {
      const data = await res.json();
      toastError(data, "common.error");
    }
  } catch (e) { toast(t("common.networkError")); }
}

async function kickSquadMember(targetUserId) {
  if (!confirm(t("squad.confirmKick"))) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/kick`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ targetUserId })
    });
    if (res.ok) {
      toast(t("squad.memberKicked"));
      await loadSquad(state.activeSquad);
    } else {
      const data = await res.json();
      toastError(data, "common.error");
    }
  } catch (e) { toast(t("common.networkError")); }
}

// ── Squad : Populate dynamic variant filter options ──
function populateSquadVariantOptions() {
  const group = document.getElementById("squadVariantGroup");
  if (!group || group.children.length > 0) return;
  const variants = Object.keys(VARIANT_META).sort();
  for (const v of variants) {
    const opt = document.createElement("option");
    opt.value = `variant:${v}`;
    opt.textContent = VARIANT_META[v].label || v;
    group.appendChild(opt);
  }
}

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

function renderSquadFriendAction(m) {
  if (String(m.userId) === String(state.userId)) return "";
  const status = m.friendshipStatus;
  const direction = m.friendRequestDirection;
  if (status === "pending" && direction === "received") {
    return `<button class="squad-chip__add squad-chip__add--accept" data-accept-friend="${encodeURIComponent(m.userId)}" title="${t('squad.acceptRequest')}">${t("squad.acceptBtn")}</button>`;
  }
  if (status === "none" && m.canReceiveFriendRequest) {
    return `<button class="squad-chip__add" data-add-friend="${encodeURIComponent(m.userId)}" title="${t('squad.addFriendTitle')}">+</button>`;
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

  const allMembers = state.squadMembers.map(m => ({
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
  const friendCount = allMembers.filter(m => m.friendshipStatus === "accepted").length;
  const nonFriendCount = total - friendCount;
  const adminCount = allMembers.filter(m => m.role === "owner" || m.role === "admin").length;

  if (els.squadMemberFilter) {
    els.squadMemberFilter.style.display = total > 0 ? "" : "none";
    els.squadMemberFilter.querySelectorAll(".squad-member-filter__btn").forEach(btn => {
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
      ? `<button class="squad-chip__compare" data-compare-user="${encodeURIComponent(m.username || m.userId)}" title="${t('squad.compareCollections')}">⇄</button>`
      : "";
    const kick = isCreator && !isMe
      ? `<button class="squad-chip__kick" data-kick="${encodeURIComponent(m.userId)}" title="${t('squad.kickBtn')}">✕</button>`
      : "";
    const menu = !isMe
      ? `<button class="squad-chip__menu" data-member-menu="${encodeURIComponent(m.userId)}" data-member-name="${encodeURIComponent(m.username || t("squad.memberFallback"))}" title="${t("common.actions")}">⋯</button>`
      : "";
    const incomplete = (m.entryCount || 0) === 0 ? `<span class="squad-chip__warn" title="${t('squad.checklistEmpty')}">?</span>` : "";
    const stale = m.lastUpdated
      ? `<span class="squad-chip__time" title="${t('squad.lastUpdateTitle', { time: timeAgo(m.lastUpdated) })}">${timeAgo(m.lastUpdated)}</span>`
      : `<span class="squad-chip__time squad-chip__time--stale">${t('squad.neverSynced')}</span>`;

    return `
      <div class="squad-chip ${isMe ? 'squad-chip--me' : ''}" data-member-id="${encodeURIComponent(m.userId)}">
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
  const m = state.squadMembers.find(x => String(x.userId) === String(userId));
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

  els.memberActionsList.innerHTML = items.map(it => `
    <button type="button" class="member-action ${it.danger ? 'member-action--danger' : ''}" data-member-action="${it.action}">
      <span class="member-action__icon">${it.icon}</span>
      <span class="member-action__label">${escapeHtml(it.label)}</span>
    </button>
  `).join("");

  els.memberActionsDialog.showModal();
}

async function handleMemberAction(action, userId, username) {
  const m = state.squadMembers.find(x => String(x.userId) === String(userId));
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
        const res = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}/block`, { method: "POST", headers: authHeaders() });
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
    if (!res.ok) { toast(t("squad.collectionPrivate")); return; }
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

// ── Squad : Populate duel selects ──
function populateDuelSelects(players) {
  [els.duelPlayerA, els.duelPlayerB].forEach((sel, idx) => {
    const prev = sel.value;
    sel.innerHTML = "";
    players.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (prev && prev < players.length) sel.value = prev;
    else sel.value = idx < players.length ? idx : 0;
  });
  if (els.duelPlayerA.value === els.duelPlayerB.value && players.length > 1) {
    els.duelPlayerB.value = els.duelPlayerA.value === "0" ? "1" : "0";
  }
}

// ── Squad : Render comparison table ──
function renderSquad() {
  renderSquadMembers();
  els.squadDuelBar.style.display = state.squadView === "duel" ? "" : "none";

  if (state.squadMembers.length === 0) {
    els.squadCounter.textContent = "";
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.waitingPlayers", { code: escapeHtml(state.activeSquad) })}</p>`;
    return;
  }

  if (state.squadView === "recommendations") {
    renderSquadRecommendations();
    return;
  }

  const items = getReleasedCollectionItems(getAllItems());
  const me = state.username || t("squad.me");
  const players = [
    { name: me, collection: state.collection, lastUpdated: new Date().toISOString(), entryCount: Object.keys(state.collection).length },
    ...state.squadMembers.map(m => ({ name: m.username, collection: m.collection, lastUpdated: m.lastUpdated, entryCount: m.entryCount || 0 }))
  ];
  const filter = state.squadFilter;
  const query = state.squadSearch.trim().toLowerCase();

  const rows = computeSquadDiffs(items, players, filter, query);

  els.squadCounter.innerHTML = t("squad.varianteCount", { count: rows.length });

  if (rows.length === 0) {
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.emptyFilter")}</p>`;
    return;
  }

  if (state.squadView === "cards") {
    renderSquadCards(rows, players, items);
  } else if (state.squadView === "hunt") {
    renderSquadHunt(rows, players, items);
  } else if (state.squadView === "duel") {
    populateDuelSelects(players);
    renderSquadDuel(rows, players, items);
  } else if (state.squadView === "session") {
    renderSquadSession(players, items);
    return;
  } else if (state.squadView === "history") {
    renderSquadHistory();
    return;
  } else {
    renderSquadTable(rows, players, items);
  }
}

// ── Squad : Table view ──
function renderSquadTable(rows, players, items) {
  const colCount = players.length;
  const parts = [];
  parts.push(`<table class="squad-table"><thead><tr><th class="squad-table__sprite">${t("squad.variantHeader")}</th>`);
  for (const p of players) {
    const shortName = escapeHtml(p.name.length > 8 ? p.name.slice(0, 7) + "…" : p.name);
    parts.push(`<th class="squad-table__player" title="${escapeHtml(p.name)}">${shortName}</th>`);
  }
  parts.push(`</tr></thead><tbody>`);

  let currentSprite = "";
  for (const row of rows) {
    const spriteName = row.item.spriteName;
    if (spriteName !== currentSprite) {
      currentSprite = spriteName;
      parts.push(`<tr class="squad-table__sprite-header"><td colspan="${colCount + 1}"><span class="squad-table__sprite-name">${escapeHtml(spriteName)}</span><span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></td></tr>`);
    }
    parts.push(`<tr class="squad-table__row"><td class="squad-table__variant">${escapeHtml(row.item.variant)}</td>`);
    for (const status of row.statuses) {
      const cls = status === "owned" ? "squad-cell--owned" : status === "new" ? "squad-cell--new" : "squad-cell--missing";
      parts.push(`<td class="squad-table__cell ${cls}">${squadIcon(status)}</td>`);
    }
    parts.push(`</tr>`);
  }

  parts.push(`</tbody></table>`);
  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : "Manque à qui ?" cards view ──
function renderSquadCards(rows, players, items) {
  const parts = [];
  parts.push(`<div class="squad-cards">`);

  for (const row of rows) {
    parts.push(`<div class="squad-card">`);
    parts.push(`<div class="squad-card__header">`);
    parts.push(`<span class="squad-card__name">${escapeHtml(row.item.spriteName)}</span>`);
    parts.push(`<span class="squad-card__variant">${escapeHtml(row.item.variant)}</span>`);
    parts.push(`<span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span>`);
    parts.push(`<span class="squad-card__ratio">${row.ownedCount}/${players.length}</span>`);
    parts.push(`</div>`);

    if (row.ownedBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--owned">`);
      parts.push(`<span class="squad-card__label">${t("squad.ownedByLabel")}</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.ownedBy) {
        parts.push(`<span class="squad-card__player squad-card__player--owned">${escapeHtml(name)}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.priorityBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--prio">`);
      parts.push(`<span class="squad-card__label">${t("squad.priorityFor2")}</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.priorityBy) {
        parts.push(`<span class="squad-card__player squad-card__player--prio">${escapeHtml(name)}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.missingBy.length > 0) {
      parts.push(`<div class="squad-card__group squad-card__group--missing">`);
      parts.push(`<span class="squad-card__label">${t("squad.missingByLabel")}</span>`);
      parts.push(`<div class="squad-card__players">`);
      for (const name of row.missingBy) {
        parts.push(`<span class="squad-card__player squad-card__player--missing">${escapeHtml(name)}</span>`);
      }
      parts.push(`</div></div>`);
    }

    if (row.nobodyHasIt) {
      parts.push(`<div class="squad-card__nobody">${t("squad.filterMissingAll")}</div>`);
    }

    parts.push(`</div>`);
  }

  parts.push(`</div>`);
  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : "À farmer" hunt view ──
function renderSquadHunt(rows, players, items) {
  const nobodyRows = rows.filter(r => r.nobodyHasIt);
  const everyoneRows = rows.filter(r => r.everyoneHasIt);
  const partialRows = rows.filter(r => r.ownedCount > 0 && !r.everyoneHasIt);

  const parts = [];

  if (nobodyRows.length > 0) {
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--nobody">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">${t("squad.filterMissingAll")}</h3>`);
    parts.push(t("squad.huntNobody", { count: nobodyRows.length }));
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list">`);
    for (const row of nobodyRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
      }
      const priorityByLabel = escapeHtml(row.priorityBy.join(", "));
      const prioTag = row.priorityBy.length > 0
        ? ` <span class="hunt-prio" title="${t('squad.priorityFor', { name: priorityByLabel })}"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${priorityByLabel}</span>`
        : "";
      parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span>${prioTag}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (partialRows.length > 0) {
    if (nobodyRows.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--partial">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 0 0 20" fill="currentColor"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">${t("squad.huntSomeHave")}</h3>`);
    parts.push(t("squad.huntPartial", { count: partialRows.length }));
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list">`);
    for (const row of partialRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
      }
      parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span><span class="hunt-owners">${escapeHtml(row.ownedBy.join(", "))}</span></li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (everyoneRows.length > 0) {
    if (nobodyRows.length > 0 || partialRows.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    parts.push(`<div class="hunt-section hunt-section--collapsed" id="huntEveryoneSection">`);
    parts.push(`<div class="hunt-section__header hunt-section__header--done hunt-section__toggle" data-toggle="huntEveryoneList">`);
    parts.push(`<span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>`);
    parts.push(`<div><h3 class="hunt-section__title">${t("squad.filterEveryone")}</h3>`);
    parts.push(t("squad.huntEveryone", { count: everyoneRows.length }));
    parts.push(`<span class="hunt-section__chevron">›</span>`);
    parts.push(`</div>`);

    let currentSprite = "";
    parts.push(`<ul class="hunt-list hunt-list--collapsed" id="huntEveryoneList">`);
    for (const row of everyoneRows) {
      const isNewSprite = row.item.spriteName !== currentSprite;
      if (isNewSprite) {
        currentSprite = row.item.spriteName;
        parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
      }
      parts.push(`<li class="hunt-list__item hunt-list__item--done"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span></li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (nobodyRows.length === 0 && partialRows.length === 0 && everyoneRows.length === 0) {
    parts.push(`<div class="hunt-section"><div class="hunt-section__header hunt-section__header--done"><span class="hunt-section__icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><div><h3 class="hunt-section__title">${t("squad.allFoundTitle")}</h3><p class="hunt-section__sub">${t("squad.allFoundSub")}</p></div></div></div>`);
  }

  parts.push(buildSquadSummary(players, items));
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : Duel 1v1 view ──
function renderSquadDuel(rows, players, items) {
  const idxA = parseInt(els.duelPlayerA.value) || 0;
  const idxB = parseInt(els.duelPlayerB.value) || (players.length > 1 ? 1 : 0);
  const pA = players[idxA];
  const pB = players[idxB];
  if (!pA || !pB) return;

  const common = [];
  const onlyA = [];
  const onlyB = [];

  for (const row of rows) {
    const sA = row.statuses[idxA];
    const sB = row.statuses[idxB];
    const aOwned = sA === "owned";
    const bOwned = sB === "owned";

    if (aOwned && bOwned) common.push(row);
    else if (aOwned && !bOwned) onlyA.push(row);
    else if (!aOwned && bOwned) onlyB.push(row);
  }

  const parts = [];

  function buildDuelSection(title, icon, colorClass, sectionRows, subtitle) {
    parts.push(`<div class="hunt-section">`);
    parts.push(`<div class="hunt-section__header ${colorClass}">`);
    parts.push(`<span class="hunt-section__icon">${icon}</span>`);
    parts.push(`<div><h3 class="hunt-section__title">${title}</h3>`);
    parts.push(t("squad.duelSection", { count: sectionRows.length, subtitle: subtitle || "" }));
    parts.push(`</div>`);

    if (sectionRows.length > 0) {
      let currentSprite = "";
      parts.push(`<ul class="hunt-list">`);
      for (const row of sectionRows) {
        if (row.item.spriteName !== currentSprite) {
          currentSprite = row.item.spriteName;
          parts.push(`<li class="hunt-list__sprite">${escapeHtml(currentSprite)} <span class="squad-table__rarity">${escapeHtml(localizedRarity(row.item.rarity))}</span></li>`);
        }
        parts.push(`<li class="hunt-list__item"><span class="hunt-list__variant">${escapeHtml(row.item.variant)}</span></li>`);
      }
      parts.push(`</ul>`);
    }
    parts.push(`</div>`);
  }

  if (onlyA.length > 0) {
    buildDuelSection(t("squad.duelOnlyA", { a: escapeHtml(pA.name), b: escapeHtml(pB.name) }), "→", "hunt-section__header--partial", onlyA, t("squad.duelSubtitle"));
  }

  if (onlyB.length > 0) {
    if (onlyA.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    buildDuelSection(t("squad.duelOnlyB", { a: escapeHtml(pA.name), b: escapeHtml(pB.name) }), "←", "hunt-section__header--nobody", onlyB, t("squad.duelSubtitle"));
  }

  if (common.length > 0) {
    if (onlyA.length > 0 || onlyB.length > 0) parts.push(`<div class="hunt-divider"></div>`);
    buildDuelSection(t("squad.inCommon"), "∩", "hunt-section__header--done", common, "");
  }

  if (onlyA.length === 0 && onlyB.length === 0 && common.length === 0) {
    parts.push(`<p class="squad-empty">${t("squad.noDuelData")}</p>`);
  }

  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : Session rapide view ──
function renderSquadSession(players, items) {
  const allDiffs = computeSquadDiffs(items, players, "all", "");

  const prioItems = allDiffs
    .filter(r => r.priorityBy.length > 0 && !r.everyoneHasIt)
    .sort((a, b) => b.missingCount - a.missingCount);

  const nobodyItems = allDiffs
    .filter(r => r.nobodyHasIt)
    .sort((a, b) => {
      const ra = RARITY_ORDER[a.item.rarity] ?? 9;
      const rb = RARITY_ORDER[b.item.rarity] ?? 9;
      return ra - rb;
    });

  const toCheck = allDiffs
    .filter(r => {
      return r.statuses.some(s => s === "unsure" || s === "spotted");
    });

  const total = items.length;
  const atLeastOne = allDiffs.filter(r => r.ownedCount > 0).length;
  const teamPct = collectionPercent(atLeastOne, total);

  const parts = [];
  parts.push(`<div class="session-view">`);

  parts.push(`<div class="session-header">`);
  parts.push(`<span class="session-header__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>`);
  parts.push(`<div><h3 class="session-header__title">${t("squad.sessionMode")}</h3>`);
  parts.push(`<p class="session-header__sub">${t("squad.sessionProgress", { pct: teamPct, found: atLeastOne, total: total })}</p></div>`);
  parts.push(`</div>`);

  if (prioItems.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--prio"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> ${t("squad.prioritiesHeader")}</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of prioItems.slice(0, 15)) {
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${escapeHtml(r.item.spriteName)} <span class="session-list__variant">${escapeHtml(r.item.variant)}</span></span>`);
      parts.push(`<span class="session-list__meta session-list__meta--missing">${t("squad.missingTo", { count: r.missingCount })}</span>`);
      parts.push(`</li>`);
    }
    if (prioItems.length > 15) {
      parts.push(`<li class="session-list__more">+${prioItems.length - 15} ${t("engine.more")}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (nobodyItems.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--nobody"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ${t("squad.filterMissingAll")}</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of nobodyItems.slice(0, 20)) {
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${escapeHtml(r.item.spriteName)} <span class="session-list__variant">${escapeHtml(r.item.variant)}</span></span>`);
      parts.push(`<span class="squad-table__rarity">${escapeHtml(localizedRarity(r.item.rarity))}</span>`);
      parts.push(`</li>`);
    }
    if (nobodyItems.length > 20) {
      parts.push(`<li class="session-list__more">+${nobodyItems.length - 20} ${t("engine.more")}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (toCheck.length > 0) {
    parts.push(`<div class="session-block">`);
    parts.push(`<h4 class="session-block__title session-block__title--check">? ${t("squad.toCheck")}</h4>`);
    parts.push(`<ul class="session-list">`);
    for (const r of toCheck.slice(0, 15)) {
      const who = players.filter((_, i) => r.statuses[i] === "unsure" || r.statuses[i] === "spotted").map(p => p.name);
      parts.push(`<li class="session-list__item">`);
      parts.push(`<span class="session-list__name">${escapeHtml(r.item.spriteName)} <span class="session-list__variant">${escapeHtml(r.item.variant)}</span></span>`);
      parts.push(`<span class="session-list__meta session-list__meta--check">${escapeHtml(who.join(", "))}</span>`);
      parts.push(`</li>`);
    }
    if (toCheck.length > 15) {
      parts.push(`<li class="session-list__more">+${toCheck.length - 15} ${t("engine.more")}</li>`);
    }
    parts.push(`</ul></div>`);
  }

  if (prioItems.length === 0 && nobodyItems.length === 0 && toCheck.length === 0) {
    parts.push(`<div class="session-block"><p class="squad-empty">${t("squad.allGood")}</p></div>`);
  }

  parts.push(`</div>`);

  els.squadCounter.innerHTML = "";
  els.squadTableWrap.innerHTML = parts.join("");
}

// ── Squad : unified activity history view ──
function formatSquadHistoryTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString(document.documentElement.lang || "fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function renderSquadHistoryEntry(e, itemMap) {
  const meta = e.metadata || {};
  const username = escapeHtml(e.username || t("squad.anonymousUser"));
  switch (e.type) {
    case "member_joined":
      return `${t("squad.historyJoined", { name: username })}`;
    case "friendship":
      return `${t("squad.historyFriendship", { a: escapeHtml(meta.usernameA || t("squad.someone")), b: escapeHtml(meta.usernameB || t("squad.someone")) })}`;
    case "milestone":
      return `${t("squad.historyMilestone", { pct: safePercentage(meta.completionRate ?? meta.threshold, 0) })}`;
    case "goal_created":
      return `${t("squad.historyGoal", { name: username, goal: meta.goalName ? ` : ${escapeHtml(meta.goalName)}` : "" })}`;
    case "collection_update":
    default: {
      const it = itemMap.get(e.sprite_id);
      const spriteName = it ? escapeHtml(it.spriteName) : escapeHtml(meta.spriteName || e.sprite_id);
      const variant = it ? `<span class="history-list__variant">${escapeHtml(it.variant)}</span>` : "";
      const suffix = meta.firstInSquad ? ` <em>(${t("squad.historyFirstInSquad")})</em>` : "";
      return `${t("squad.historyObtained", { name: username, sprite: spriteName, variant: variant, suffix: suffix })}`;
    }
  }
}

async function renderSquadHistory() {
  els.squadCounter.innerHTML = "";
  els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.historyLoading")}</p>`;

  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/history?days=7`, {
      headers: authHeaders()
    });
    if (!res.ok) {
      els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.historyFailed")}</p>`;
      return;
    }
    const data = await res.json();
    const entries = data.entries || [];

    if (entries.length === 0) {
      els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.historyEmpty")}</p>`;
      return;
    }

    const dayMap = new Map();
    for (const e of entries) {
      const day = new Date(e.created_at).toLocaleDateString(document.documentElement.lang || "fr-FR", {
        weekday: "long", day: "numeric", month: "long"
      });
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day).push(e);
    }

    const items = getAllItems();
    const itemMap = new Map();
    for (const it of items) itemMap.set(it.id, it);

    const parts = [];
    parts.push(`<div class="history-view">`);

    for (const [day, dayEntries] of dayMap) {
      parts.push(`<div class="history-day">`);
      parts.push(`<h3 class="history-day__title">${day}</h3>`);
      parts.push(`<ul class="history-list">`);

      for (const e of dayEntries.slice(0, 100)) {
        const time = formatSquadHistoryTime(e.created_at);
        const label = renderSquadHistoryEntry(e, itemMap);
        parts.push(`<li class="history-list__item"><span class="history-list__time">${time}</span> ${label}</li>`);
      }

      if (dayEntries.length > 100) {
        parts.push(`<li class="history-list__more">+${dayEntries.length - 100} ${t("engine.more")}</li>`);
      }
      parts.push(`</ul></div>`);
    }

    parts.push(`</div>`);
    els.squadTableWrap.innerHTML = parts.join("");
  } catch (e) {
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("common.networkError")}</p>`;
  }
}

// ── Squad : Recommendations view (complementarity engine) ──
async function renderSquadRecommendations() {
  if (!state.activeSquad) return;
  els.squadCounter.innerHTML = `<span class="squad-counter__text">${t("squad.recommendations")}</span>`;
  els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.recsLoading")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/recommendations`, { headers: authHeadersOnly() });
    if (!res.ok) throw new Error("recommendations failed");
    const data = await res.json();
    const parts = [];
    parts.push(`<div class="recommendations-view">`);
    const ownedCount = safeFiniteNumber(data.ownedCount, 0, { min: 0, max: 1000000 });
    const totalVariants = safeFiniteNumber(data.totalVariants, 0, { min: 0, max: 1000000 });
    const ownedRate = safePercentage(data.ownedRate, 0);
    parts.push(`<div class="recommendations-header"><h3 class="recommendations-title">${t("squad.recTitle")}</h3><p class="recommendations-subtitle">${t("squad.recSubtitle", { owned: ownedCount, total: totalVariants, rate: ownedRate })}</p></div>`);
    parts.push(`<div class="recommendations-engine-cta"><button type="button" class="ghost-button" id="openSquadEngineFromRecs">${t("squad.openEngineFromRecs")}</button></div>`);

    if (data.mostComplementary) {
      const m = data.mostComplementary;
      const rarityParts = Object.entries(m.jointCoverageByRarity || {})
        .sort((a, b) => (b[1].coverage || 0) - (a[1].coverage || 0))
        .slice(0, 3)
        .map(([r, info]) => `<span class="recommendation-rarity">${escapeHtml(localizedRarity(r))} : <strong>${formatUiPercent(info.coverage, { maximumFractionDigits: 0 })}</strong> (${safeFiniteNumber(info.owned, 0, { min: 0, max: 1000000 })}/${safeFiniteNumber(info.total, 0, { min: 0, max: 1000000 })})</span>`)
        .join(" · ");
      parts.push(`<div class="recommendation-card recommendation-card--highlight">`);
      parts.push(`<div class="recommendation-card__header">`);
      parts.push(`<span class="recommendation-card__name">${escapeHtml(m.displayName || m.username)}</span>`);
      parts.push(`<span class="recommendation-card__badge">${t("squad.mostComplementaryBadge")}</span>`);
      parts.push(`</div>`);
      parts.push(`<div class="recommendation-card__body">`);
      parts.push(`<p>${t("squad.recMemberMissing", { name: escapeHtml(m.displayName || m.username), count: safeFiniteNumber(m.missingCount, 0, { min: 0, max: 1000000 }), priority: safeFiniteNumber(m.priorityMatchCount, 0, { min: 0, max: 1000000 }) })}</p>`);
      parts.push(`<p>${t("squad.recJointCoverage", { pct: safePercentage(m.jointCoverage, 0) })}</p>`);
      if (rarityParts) parts.push(`<p class="recommendation-rarities">${rarityParts}</p>`);
      parts.push(`</div></div>`);
    }

    if (data.friends && data.friends.length > 0) {
      parts.push(`<h4 class="recommendations-section-title">${t("squad.friendsAndMembers")}</h4>`);
      parts.push(`<div class="recommendation-list">`);
      for (const f of data.friends) {
        parts.push(`<div class="recommendation-card">
          <div class="recommendation-card__header">
            <span class="recommendation-card__name">${escapeHtml(f.displayName || f.username)}</span>
            <span class="recommendation-card__score">score ${safeFiniteNumber(f.score, 0, { min: 0, max: 1000000 })}</span>
          </div>
          <div class="recommendation-card__body">
            <p>${t("squad.recFriendStats", { count: safeFiniteNumber(f.missingCount, 0, { min: 0, max: 1000000 }), priority: safeFiniteNumber(f.priorityMatchCount, 0, { min: 0, max: 1000000 }), pct: safePercentage(f.jointCoverage, 0) })}</p>
          </div>
        </div>`);
      }
      parts.push(`</div>`);
    }

    if (data.squadAdditions && data.squadAdditions.length > 0) {
      parts.push(`<h4 class="recommendations-section-title">${t("squad.strengthenSquad")}</h4>`);
      parts.push(`<div class="recommendation-list">`);
      for (const s of data.squadAdditions) {
        parts.push(`<div class="recommendation-card">
          <div class="recommendation-card__header">
            <span class="recommendation-card__name">${escapeHtml(s.name)}</span>
            <span class="recommendation-card__gain">+${safePercentage(s.gain, 0)}%</span>
          </div>
          <div class="recommendation-card__body">
            <p>${t("squad.addBoostsCoverage", { name: `<strong>${escapeHtml(s.candidate.displayName || s.candidate.username)}</strong>`, from: `<strong>${safePercentage(s.currentRate, 0)}%</strong>`, to: `<strong>${safePercentage(s.newRate, 0)}%</strong>` })}</p>
          </div>
        </div>`);
      }
      parts.push(`</div>`);
    }

    parts.push(`</div>`);
    els.squadTableWrap.innerHTML = parts.join("");
    const engineCta = document.getElementById("openSquadEngineFromRecs");
    if (engineCta && typeof showSquadEngine === "function") {
      engineCta.addEventListener("click", () => {
        showSquadEngine();
        if (typeof switchSquadEngineTab === "function") switchSquadEngineTab("recommendations");
      });
    }
  } catch (e) {
    console.error("[renderSquadRecommendations]", e);
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.recLoadFailed")}</p>`;
  }
}

async function handleRecommendedFriendInvite(e) {
  const btn = e.target.closest("[data-recommended-id]");
  if (!btn) return;
  const friendId = btn.dataset.recommendedId;
  const code = state.activeSquad;
  if (!code || !friendId) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/invite/${encodeURIComponent(friendId)}`, {
      method: "POST",
      headers: authHeaders()
    });
    if (res.ok) {
      toast(t("squad.inviteSent"));
      btn.disabled = true;
      btn.textContent = t("squad.invited");
    } else {
      const data = await res.json().catch(() => ({}));
      toastError(data, "squad.inviteFailed");
    }
  } catch (e) {
    console.error("[invite recommended]", e);
    toast(t("common.networkError"));
  }
}

async function renderSquadRecommendedFriends() {
  if (!els.squadRecommendedFriends) return;
  if (!state.activeSquad) {
    els.squadRecommendedFriends.innerHTML = "";
    return;
  }
  els.squadRecommendedFriends.innerHTML = `<p class="squad-empty">${t("squad.loading")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/recommended-friends`, { headers: authHeadersOnly() });
    if (!res.ok) throw new Error("recommended friends failed");
    const data = await res.json();
    const candidates = data.candidates || [];
    if (candidates.length === 0) {
      els.squadRecommendedFriends.innerHTML = "";
      return;
    }
    const squadName = escapeHtml(data.squadName || els.squadActiveName?.textContent || "l'escouade");
    const parts = [];
    parts.push(`<div class="recommended-friends-section"><h4 class="recommended-friends__title">${t("squad.recommendedFriendsTitle")}</h4><div class="recommended-friends__list">`);
    for (const c of candidates) {
      const btn = c.canInvite
        ? `<button type="button" class="login-btn" data-recommended-id="${encodeURIComponent(c.userId)}" data-action="invite-recommended">${t("squad.inviteBtn")}</button>`
        : `<button type="button" class="ghost-button" disabled>${t("squad.inviteBtn")}</button>`;
      const contrib = safeFiniteNumber(c.potentialContribution || c.newVariantsForSquad, 0, { min: 0, max: 1000000 });
      const contributionLine = contrib > 0
        ? `<span class="recommended-friend__stat recommended-friend__stat--contribution">${t("squad.recContrib", { name: escapeHtml(c.displayName || c.username), count: contrib, squad: squadName })}</span>`
        : "";
      parts.push(`<div class="recommended-friend">
        <div class="recommended-friend__info">
          <span class="recommended-friend__name">${escapeHtml(c.displayName || c.username)}</span>
          <span class="recommended-friend__meta">
            <span class="recommended-friend__stat">+${safeFiniteNumber(c.newVariantsForSquad, 0, { min: 0, max: 1000000 })} ${t("squad.newVariants")}</span>
            <span class="recommended-friend__stat">${safeFiniteNumber(c.mythicNewVariants, 0, { min: 0, max: 1000000 })} ${t("squad.mythicMissing")}</span>
            <span class="recommended-friend__stat">${t("squad.complementarityScoreLabel", { pct: safePercentage(c.complementarityScore, 0) })}</span>
            ${contributionLine}
          </span>
        </div>
        ${btn}
      </div>`);
    }
    parts.push(`</div></div>`);
    els.squadRecommendedFriends.innerHTML = parts.join("");
    els.squadRecommendedFriends.querySelectorAll("[data-action='invite-recommended']").forEach(btn => {
      btn.addEventListener("click", handleRecommendedFriendInvite);
    });
  } catch (e) {
    console.error("[renderSquadRecommendedFriends]", e);
    els.squadRecommendedFriends.innerHTML = `<p class="squad-empty">${t("squad.recommendedFriendsFailed")}</p>`;
  }
}

async function renderSquadComplementaryPairs() {
  if (!els.squadComplementaryPairs) return;
  if (!state.activeSquad) {
    els.squadComplementaryPairs.innerHTML = "";
    return;
  }
  els.squadComplementaryPairs.innerHTML = `<p class="squad-empty">${t("squad.loading")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/complementary-pairs`, { headers: authHeadersOnly() });
    if (!res.ok) throw new Error("complementary pairs failed");
    const data = await res.json();
    const pairs = data.pairs || [];
    if (pairs.length === 0) {
      els.squadComplementaryPairs.innerHTML = "";
      return;
    }
    const parts = [];
    parts.push(`<div class="complementary-pairs-section"><h4 class="complementary-pairs__title">${t("squad.complementaryTitle")}</h4><div class="complementary-pairs__list">`);
    for (const p of pairs) {
      parts.push(`<button type="button" class="complementary-pair" data-user-a-id="${encodeURIComponent(p.userAId)}" data-user-a-name="${escapeHtml(p.userAName)}" data-user-b-id="${encodeURIComponent(p.userBId)}" data-user-b-name="${escapeHtml(p.userBName)}">
        <span class="complementary-pair__names">${escapeHtml(p.userAName)} <span class="complementary-pair__cross">×</span> ${escapeHtml(p.userBName)}</span>
        <span class="complementary-pair__score">${safePercentage(p.complementarityScore, 0)}%</span>
      </button>`);
    }
    parts.push(`</div></div>`);
    els.squadComplementaryPairs.innerHTML = parts.join("");
    els.squadComplementaryPairs.querySelectorAll(".complementary-pair").forEach(btn => {
      btn.addEventListener("click", handleComplementaryPairClick);
    });
  } catch (e) {
    console.error("[renderSquadComplementaryPairs]", e);
    els.squadComplementaryPairs.innerHTML = `<p class="squad-empty">${t("squad.complementaryPairsFailed")}</p>`;
  }
}

function handleComplementaryPairClick(e) {
  const btn = e.target.closest(".complementary-pair");
  if (!btn) return;
  const userAId = btn.dataset.userAId;
  const userAName = btn.dataset.userAName;
  const userBId = btn.dataset.userBId;
  const userBName = btn.dataset.userBName;
  if (typeof comparePair === "function") {
    comparePair(userAId, userAName, userBId, userBName);
  }
}

// ── Squad : Summary ──
function buildSquadSummary(players, items) {
  const total = items.length;
  if (total === 0) return "";

  const atLeastOne = items.filter(i => players.some(p => (p.collection[i.id]?.status || "new") === "owned")).length;
  const everyoneCount = items.filter(i => players.every(p => (p.collection[i.id]?.status || "new") === "owned")).length;
  const nobodyCount = total - atLeastOne;
  const teamPct = collectionPercent(atLeastOne, total);
  const fullPct = collectionPercent(everyoneCount, total);

  const stats = players.map(p => {
    const owned = items.filter(i => (p.collection[i.id]?.status || "new") === "owned").length;
    return { name: p.name, owned, total, pct: collectionPercent(owned, total) };
  });

  const uniqueMap = players.map((p, pi) => {
    return items.filter(i => {
      const myStatus = p.collection[i.id]?.status || "new";
      if (myStatus !== "owned") return false;
      return players.every((other, oi) => oi === pi || (other.collection[i.id]?.status || "new") !== "owned");
    }).length;
  });

  const parts = [];

  parts.push(`<div class="squad-summary">`);
  parts.push(`<div class="team-score">`);
  parts.push(`<div class="team-score__ring"><svg viewBox="0 0 36 36" class="team-score__svg"><path class="team-score__bg" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831" /><path class="team-score__fill" stroke-dasharray="${teamPct}, 100" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831 15.9155 15.9155 0 1 1 0-31.831" /></svg><span class="team-score__pct">${teamPct}%</span></div>`);
  parts.push(`<div class="team-score__details">`);
  parts.push(`<h3 class="team-score__title">${t("squad.teamProgress")}</h3>`);
  parts.push(`<div class="team-score__rows">`);
  parts.push(`<div class="team-score__row"><span class="team-score__label">${t("squad.atLeastOne")}</span><span class="team-score__val team-score__val--good">${atLeastOne} / ${total}</span></div>`);
  parts.push(`<div class="team-score__row"><span class="team-score__label">${t("squad.wholeSquad")}</span><span class="team-score__val team-score__val--full">${everyoneCount} / ${total}</span></div>`);
  parts.push(`<div class="team-score__row"><span class="team-score__label">${t("squad.filterMissingAll")}</span><span class="team-score__val team-score__val--nobody">${nobodyCount} / ${total}</span></div>`);
  parts.push(`</div></div></div>`);

  parts.push(`<div class="squad-summary__divider"></div>`);
  parts.push(`<h4 class="squad-summary__subtitle">${t("squad.perPlayer")}</h4>`);
  parts.push(`<div class="squad-summary__grid">`);
  stats.forEach((s, i) => {
    parts.push(`<div class="squad-stat">
      <span class="squad-stat__name">${escapeHtml(s.name)}</span>
      <div class="squad-stat__bar"><div class="squad-stat__fill" style="width:${s.pct}%"></div></div>
      <span class="squad-stat__pct">${s.owned}/${s.total} (${s.pct}%)</span>
      <span class="squad-stat__unique">${t("squad.uniqueExcl", { count: uniqueMap[i] })}</span>
    </div>`);
  });
  parts.push(`</div></div>`);
  return parts.join("");
}
