function setupSquadEvents() {
  els.squadMembers.addEventListener("click", (event) => {
    const menuBtn = event.target.closest("[data-member-menu]");
    if (menuBtn) {
      const userId = decodeURIComponent(menuBtn.dataset.memberMenu);
      const username = decodeURIComponent(menuBtn.dataset.memberName || "");
      openMemberActionsDialog(userId, username);
      return;
    }
    const addFriendBtn = event.target.closest("[data-add-friend]");
    if (addFriendBtn) {
      sendFriendRequest(decodeURIComponent(addFriendBtn.dataset.addFriend));
      return;
    }
    const acceptFriendBtn = event.target.closest("[data-accept-friend]");
    if (acceptFriendBtn) {
      acceptFriendRequest(decodeURIComponent(acceptFriendBtn.dataset.acceptFriend));
      return;
    }
    const compareBtn = event.target.closest("[data-compare-user]");
    if (compareBtn) {
      compareWithUser(decodeURIComponent(compareBtn.dataset.compareUser));
      return;
    }
    const kickBtn = event.target.closest("[data-kick]");
    if (kickBtn) kickSquadMember(decodeURIComponent(kickBtn.dataset.kick));
  });

  if (els.memberActionsList) {
    els.memberActionsList.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-member-action]");
      if (!btn) return;
      const action = btn.dataset.memberAction;
      const pending = state.pendingMemberAction || {};
      handleMemberAction(action, pending.userId, pending.username);
    });
  }
  if (els.memberActionsClose) {
    els.memberActionsClose.addEventListener("click", () => {
      if (els.memberActionsDialog) els.memberActionsDialog.close();
    });
  }
  els.squadCreateBtn.addEventListener("click", createSquad);
  els.squadJoinBtn.addEventListener("click", joinSquad);
  els.squadCodeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinSquad();
  });
  els.squadLeaveBtn.addEventListener("click", leaveSquad);
  els.squadRefreshBtn.addEventListener("click", () => {
    if (state.activeSquad) loadSquad(state.activeSquad);
  });
  els.squadCopyCode.addEventListener("click", () => {
    if (state.activeSquad) {
      navigator.clipboard.writeText(state.activeSquad).then(() => toast(t("squad.codeCopied")));
    }
  });
  if (els.squadShareBtn) {
    els.squadShareBtn.addEventListener("click", () => openShareDialog("squad"));
  }
  els.squadFilter.addEventListener("change", () => {
    state.squadFilter = els.squadFilter.value;
    renderSquad();
  });
  if (els.squadMemberFilter) {
    els.squadMemberFilter.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-member-filter]");
      if (!btn) return;
      state.squadMemberFilter = btn.dataset.memberFilter;
      renderSquadMembers();
    });
  }
  els.squadSearchInput.addEventListener("input", () => {
    state.squadSearch = els.squadSearchInput.value;
    renderSquad();
  });
  els.duelPlayerA.addEventListener("change", () => renderSquad());
  els.duelPlayerB.addEventListener("change", () => renderSquad());
  els.squadTableWrap.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle]");
    if (!toggle) return;
    const targetId = toggle.dataset.toggle;
    const list = document.getElementById(targetId);
    if (!list) return;
    list.classList.toggle("hunt-list--collapsed");
    toggle.closest(".hunt-section").classList.toggle("hunt-section--collapsed");
  });
  document.querySelectorAll(".squad-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".squad-view-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.squadView = btn.dataset.squadView;
      renderSquad();
    });
  });
}
