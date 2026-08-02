"use strict";

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
