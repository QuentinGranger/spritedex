"use strict";

// ── Squad : Create ──
async function createSquad() {
  if (!state.userId) {
    toast(t("squad.loginFirst"));
    return;
  }
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
  if (!state.userId) {
    toast(t("squad.loginFirst"));
    return;
  }
  const code = els.squadCodeInput.value.trim().toUpperCase();
  if (!code) {
    toast(t("squad.enterCode"));
    return;
  }
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
    // Authenticate the WS with the session cookie (web) or bearer token (native).
    squadWs.send(JSON.stringify(wsAuthMessage()));
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
