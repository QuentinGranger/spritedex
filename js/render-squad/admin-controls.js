"use strict";

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

