(() => {
  "use strict";

  window.SpriteIndexAccount.register("profile-actions", function initializeAccountFeature() {
    // ── Share link state ──
    async function refreshShareState() {
      const revokeBtn = document.getElementById("accountRevokeShare");
      if (!revokeBtn || !state.userId) return;
      try {
        const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, { headers: authHeadersOnly() });
        if (!res.ok) return;
        const { active } = await res.json();
        revokeBtn.style.display = active ? "" : "none";
      } catch {}
    }

    document.getElementById("accountRevokeShare").addEventListener("click", async () => {
      if (!state.userId) return;
      if (!confirm(t("account.revokeShareConfirm"))) return;
      try {
        const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, {
          method: "DELETE",
          headers: authHeadersOnly()
        });
        if (res.ok) {
          toast(t("account.shareRevoked"));
          document.getElementById("accountRevokeShare").style.display = "none";
        } else {
          toast(t("account.error"));
        }
      } catch {
        toast(t("account.networkError"));
      }
    });

    // ── Toggle edit pseudo section ──
    const editSection = document.getElementById("accountEditSection");
    document.getElementById("accountEditUsernameBtn").addEventListener("click", () => {
      const visible = editSection.style.display !== "none";
      editSection.style.display = visible ? "none" : "";
      if (!visible) document.getElementById("accountEditUsername").focus();
    });

    async function loadCommunityStatsOptIn() {
      const el = document.getElementById("accountCommunityStatsOptIn");
      if (!el || !state.userId) return;
      try {
        const res = await fetch(`${API_BASE}/profile/${state.userId}`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        el.checked = data.communityStatsOptIn === true || data.communityStatsParticipation === true;
      } catch {
        /* keep default unchecked */
      }
    }

    document.getElementById("accountCommunityStatsOptIn")?.addEventListener("change", async (ev) => {
      if (!state.userId) return;
      const optIn = !!ev.target.checked;
      try {
        const res = await fetch(`${API_BASE}/consent`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ communityStatsOptIn: optIn })
        });
        if (!res.ok) {
          ev.target.checked = !optIn;
          toast(t("account.consentSaveError"));
          return;
        }
        toast(optIn ? t("account.statsOptInOn") : t("account.statsOptInOff"));
      } catch {
        ev.target.checked = !optIn;
        toast(t("account.savingError"));
      }
    });

    // ── Save profile ──
    document.getElementById("accountSaveProfile").addEventListener("click", async () => {
      if (!state.userId) return;
      const username = document.getElementById("accountEditUsername").value.trim();
      const privacy = document.getElementById("accountPrivacy").value;
      if (!username || username.length < 2) {
        toast(t("account.usernameTooShort"));
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/profile/${state.userId}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ username, privacy })
        });
        if (res.ok) {
          const data = await res.json();
          state.username = data.username;
          const existingUser = JSON.parse(localStorage.getItem(USER_KEY) || "{}");
          localStorage.setItem(USER_KEY, JSON.stringify({ ...existingUser, username: data.username }));
          localStorage.setItem("sprite-index_privacy", privacy);
          document.getElementById("accountUsername").textContent = data.username;
          document.getElementById("accountEditSection").style.display = "none";
          toast(t("account.profileUpdated"));
        }
      } catch {
        toast(t("account.savingError"));
      }
    });

    // ── Change avatar ──
    const avatarModal = document.getElementById("avatarModal");
    document.getElementById("accountChangeAvatar").addEventListener("click", () => {
      avatarModal.style.display = "";
    });
    document.getElementById("avatarModalClose").addEventListener("click", () => {
      avatarModal.style.display = "none";
    });
    document.querySelectorAll("#avatarModalPicker .avatar-picker__item").forEach((item) => {
      item.addEventListener("click", async () => {
        const avatarUrl = item.dataset.avatar || "";
        document
          .querySelectorAll("#avatarModalPicker .avatar-picker__item")
          .forEach((i) => i.classList.remove("selected"));
        item.classList.add("selected");
        try {
          const res = await fetch(`${API_BASE}/profile/${state.userId}`, {
            method: "PATCH",
            headers: authHeaders(),
            body: JSON.stringify({ avatarUrl })
          });
          if (res.ok) {
            localStorage.setItem("sprite-index_avatar", avatarUrl);
            const avatarDisplay = document.getElementById("accountAvatarDisplay");
            renderAvatar(avatarDisplay, avatarUrl);
            updateTopbarAvatar();
            avatarModal.style.display = "none";
            toast(t("account.avatarUpdated"));
          }
        } catch {
          toast(t("account.avatarError"));
        }
      });
    });

    // ── Go to collection tab ──
    document.getElementById("accountGoCollection").addEventListener("click", () => {
      closeAccount();
      const checklistTab = document.querySelector('.tab[data-view="checklist"]');
      if (checklistTab) checklistTab.click();
    });

    document.getElementById("accountGoCompare").addEventListener("click", () => {
      closeAccount();
      if (typeof activateMainView === "function") activateMainView("social");
      if (typeof setSocialTab === "function") setSocialTab("compare");
    });

    // ── Share profile ──
    // Generates (and rotates) an opaque, unguessable share token server-side and
    // shares a /?share=<token> link, instead of exposing the sequential user id.
    document.getElementById("accountShare").addEventListener("click", async () => {
      if (!state.userId) {
        toast(t("account.loginFirst"));
        return;
      }
      let token;
      try {
        const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({})
        });
        if (!res.ok) {
          toast(t("account.shareLinkError"));
          return;
        }
        token = (await res.json()).token;
        const revokeBtn = document.getElementById("accountRevokeShare");
        if (revokeBtn) revokeBtn.style.display = "";
      } catch {
        toast(t("account.networkError"));
        return;
      }
      const url = `${webOrigin()}/?share=${token}`;
      if (navigator.share) {
        try {
          await navigator.share({ title: t("passport.shareNativeTitle", { name: state.username }), url });
        } catch {}
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast(t("account.shareLinkCopied"));
      }
    });

    // ── Privacy auto-save ──
    document.getElementById("accountPrivacy").addEventListener("change", () => {
      document.getElementById("accountSaveProfile").click();
    });

    // ── Force sync ──
    document.getElementById("accountForceSync").addEventListener("click", async () => {
      if (!state.userId) {
        toast(t("account.loginFirst"));
        return;
      }
      await fullSync();
      localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
      document.getElementById("accountLastSync").textContent = new Date().toLocaleString(uiLocale(), {
        dateStyle: "short",
        timeStyle: "short"
      });
      toast(t("account.syncDone"));
    });

    // ── Logout ──
    document.getElementById("accountLogout").addEventListener("click", async () => {
      try {
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          headers: authHeadersOnly()
        });
      } catch {}
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      state.userId = null;
      state.username = null;
      location.reload();
    });

    // ── Delete account modal ──
    const deleteModal = document.getElementById("deleteModal");
    const deleteInput = document.getElementById("deleteConfirmInput");
    const deleteBtn = document.getElementById("deleteConfirmBtn");

    document.getElementById("accountDeleteOpen").addEventListener("click", () => {
      deleteModal.style.display = "";
      deleteInput.value = "";
      deleteBtn.disabled = true;
    });

    document.getElementById("deleteModalClose").addEventListener("click", () => {
      deleteModal.style.display = "none";
    });

    deleteInput.addEventListener("input", () => {
      deleteBtn.disabled = deleteInput.value.trim().toUpperCase() !== "SUPPRIMER";
    });

    // Export before deletion: full server-side export
    document.getElementById("deleteExportBtn").addEventListener("click", async () => {
      try {
        const res = await fetch(`${API_BASE}/export`, { headers: authHeadersOnly() });
        if (!res.ok) throw new Error("Export impossible");
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `sprite-index_export_${data.profile?.username || state.username || "user"}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast(t("account.exportDone"));
      } catch (e) {
        toast(t("account.exportError"));
      }
    });

    // Confirm deletion
    deleteBtn.addEventListener("click", async () => {
      if (deleteInput.value.trim().toUpperCase() !== "SUPPRIMER") return;
      deleteBtn.disabled = true;
      deleteBtn.textContent = t("account.deleting");
      try {
        await fetch(`${API_BASE}/profile/${state.userId}`, {
          method: "DELETE",
          headers: authHeadersOnly()
        });
      } catch {}
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("sprite-index_notifications");
      localStorage.removeItem("sprite-index_avatar");
      localStorage.removeItem("sprite-index_privacy");
      localStorage.removeItem("sprite-index_last_sync");
      localStorage.removeItem(SYNC_QUEUE_KEY);
      state.userId = null;
      state.username = null;
      state.collection = createSafeRecord();
      location.reload();
    });

    Object.assign(globalThis, { refreshShareState, loadCommunityStatsOptIn });
  });
})();
