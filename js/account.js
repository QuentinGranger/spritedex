function setupAccountPanel() {
  const panel = document.getElementById("accountPanel");
  const openBtn = document.getElementById("accountBtn");
  const closeBtn = document.getElementById("accountClose");

  function openAccount() {
    panel.style.display = "";
    populateAccount();
  }

  function closeAccount() {
    panel.style.display = "none";
  }

  openBtn.addEventListener("click", openAccount);
  closeBtn.addEventListener("click", closeAccount);

  // ── Email verification banner ──
  const emailBanner = document.getElementById("emailBanner");
  const resendBtn = document.getElementById("resendVerification");

  function checkEmailVerified() {
    const emailVerified = localStorage.getItem("spritedex_email_verified");
    emailBanner.style.display = (emailVerified === "true" || !state.userId) ? "none" : "";
  }

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true;
    resendBtn.textContent = "Envoi...";
    try {
      await fetch(`${API_BASE}/auth/resend-verification`, {
        method: "POST",
        headers: authHeadersOnly()
      });
      toast("Email de vérification renvoyé !");
    } catch {
      toast("Erreur, réessaie plus tard.");
    }
    resendBtn.disabled = false;
    resendBtn.textContent = "Renvoyer";
  });

  // ── Populate all profile data ──
  function populateAccount() {
    checkEmailVerified();

    // Username & avatar
    document.getElementById("accountUsername").textContent = state.username || "—";
    document.getElementById("accountEditUsername").value = state.username || "";

    const avatarDisplay = document.getElementById("accountAvatarDisplay");
    const avatarUrl = localStorage.getItem("spritedex_avatar") || "";
    if (avatarUrl) {
      avatarDisplay.innerHTML = `<img src="${avatarUrl}" alt="Avatar" />`;
    }

    // Stats
    const coll = state.collection || {};
    const entries = Object.values(coll);
    const ownedVariants = entries.filter(e => e.status === "owned").length;
    const totalVariants = SPRITES.reduce((sum, s) => sum + (s.variants ? s.variants.length : 1), 0);
    const percent = totalVariants ? Math.round((ownedVariants / totalVariants) * 100) : 0;

    // Sprites completed = sprites where ALL variants are owned
    const spriteVariantMap = {};
    SPRITES.forEach(s => {
      const variants = s.variants || ["Base"];
      variants.forEach(v => {
        const key = `${s.id}_${v}`;
        if (!spriteVariantMap[s.id]) spriteVariantMap[s.id] = { total: 0, owned: 0 };
        spriteVariantMap[s.id].total++;
        if (coll[key] && coll[key].status === "owned") spriteVariantMap[s.id].owned++;
      });
    });
    const totalSprites = Object.keys(spriteVariantMap).length;
    const completedSprites = Object.values(spriteVariantMap).filter(s => s.owned === s.total && s.total > 0).length;

    // Priorities
    const priorities = entries.filter(e => e.status === "priority").length;

    document.getElementById("accountPercent").textContent = percent + "%";
    document.getElementById("accountCompleted").textContent = `${completedSprites} / ${totalSprites}`;
    document.getElementById("accountVariants").textContent = `${ownedVariants} / ${totalVariants}`;
    document.getElementById("accountPriorities").textContent = priorities;

    // Privacy
    const privacyEl = document.getElementById("accountPrivacy");
    privacyEl.value = localStorage.getItem("spritedex_privacy") || "squad_only";

    // Last sync
    const lastSync = localStorage.getItem("spritedex_last_sync");
    document.getElementById("accountLastSync").textContent = lastSync
      ? new Date(lastSync).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
      : "Jamais";

    // Member since
    const userRaw = localStorage.getItem(USER_KEY);
    if (userRaw) {
      try {
        const u = JSON.parse(userRaw);
        if (u.created_at) {
          document.getElementById("accountSince").textContent =
            "Membre depuis " + new Date(u.created_at).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
        }
      } catch {}
    }

    // Reflect whether an active share link exists (show/hide revoke button).
    refreshShareState();
  }

  // ── Share link state ──
  async function refreshShareState() {
    const revokeBtn = document.getElementById("accountRevokeShare");
    if (!revokeBtn || !state.userId) return;
    try {
      const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, { headers: authHeadersOnly() });
      if (!res.ok) return;
      const { token } = await res.json();
      revokeBtn.style.display = token ? "" : "none";
    } catch {}
  }

  document.getElementById("accountRevokeShare").addEventListener("click", async () => {
    if (!state.userId) return;
    if (!confirm("Désactiver le lien de partage ? Les liens existants cesseront de fonctionner.")) return;
    try {
      const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, {
        method: "DELETE",
        headers: authHeadersOnly()
      });
      if (res.ok) {
        toast("Lien de partage désactivé");
        document.getElementById("accountRevokeShare").style.display = "none";
      } else {
        toast("Erreur");
      }
    } catch {
      toast("Erreur réseau");
    }
  });

  // ── Toggle edit pseudo section ──
  const editSection = document.getElementById("accountEditSection");
  document.getElementById("accountEditUsernameBtn").addEventListener("click", () => {
    const visible = editSection.style.display !== "none";
    editSection.style.display = visible ? "none" : "";
    if (!visible) document.getElementById("accountEditUsername").focus();
  });

  // ── Save profile ──
  document.getElementById("accountSaveProfile").addEventListener("click", async () => {
    if (!state.userId) return;
    const username = document.getElementById("accountEditUsername").value.trim();
    const privacy = document.getElementById("accountPrivacy").value;
    if (!username || username.length < 2) {
      toast("Pseudo trop court (min 2)");
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
        localStorage.setItem("spritedex_privacy", privacy);
        document.getElementById("accountUsername").textContent = data.username;
        document.getElementById("accountEditSection").style.display = "none";
        toast("Profil mis à jour !");
      }
    } catch {
      toast("Erreur de sauvegarde");
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
  document.querySelectorAll("#avatarModalPicker .avatar-picker__item").forEach(item => {
    item.addEventListener("click", async () => {
      const avatarUrl = item.dataset.avatar || "";
      document.querySelectorAll("#avatarModalPicker .avatar-picker__item").forEach(i => i.classList.remove("selected"));
      item.classList.add("selected");
      try {
        const res = await fetch(`${API_BASE}/profile/${state.userId}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ avatarUrl })
        });
        if (res.ok) {
          localStorage.setItem("spritedex_avatar", avatarUrl);
          const avatarDisplay = document.getElementById("accountAvatarDisplay");
          avatarDisplay.innerHTML = avatarUrl ? `<img src="${avatarUrl}" alt="Avatar" />` : `<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
          updateTopbarAvatar();
          avatarModal.style.display = "none";
          toast("Avatar mis à jour !");
        }
      } catch {
        toast("Erreur lors du changement d'avatar");
      }
    });
  });

  // ── Go to collection tab ──
  document.getElementById("accountGoCollection").addEventListener("click", () => {
    closeAccount();
    const checklistTab = document.querySelector('.tab[data-view="checklist"]');
    if (checklistTab) checklistTab.click();
  });

  // ── Share profile ──
  // Generates (or reuses) an opaque, unguessable share token server-side and
  // shares a /?share=<token> link, instead of exposing the sequential user id.
  document.getElementById("accountShare").addEventListener("click", async () => {
    if (!state.userId) { toast("Connecte-toi d'abord"); return; }
    let token;
    try {
      const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({})
      });
      if (!res.ok) { toast("Impossible de générer le lien"); return; }
      token = (await res.json()).token;
      const revokeBtn = document.getElementById("accountRevokeShare");
      if (revokeBtn) revokeBtn.style.display = "";
    } catch {
      toast("Erreur réseau");
      return;
    }
    const url = `${location.origin}/?share=${token}`;
    if (navigator.share) {
      try { await navigator.share({ title: `Profil de ${state.username}`, url }); } catch {}
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      toast("Lien de partage copié !");
    }
  });

  // ── Privacy auto-save ──
  document.getElementById("accountPrivacy").addEventListener("change", () => {
    document.getElementById("accountSaveProfile").click();
  });

  // ── Force sync ──
  document.getElementById("accountForceSync").addEventListener("click", async () => {
    if (!state.userId) { toast("Connecte-toi d'abord"); return; }
    await fullSync();
    localStorage.setItem("spritedex_last_sync", new Date().toISOString());
    document.getElementById("accountLastSync").textContent =
      new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    toast("Synchronisation terminée !");
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
      a.download = `spritedex_export_${data.profile?.username || state.username || "user"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Export téléchargé !");
    } catch (e) {
      toast("Impossible d'exporter tes données. Réessaie.");
    }
  });

  // Confirm deletion
  deleteBtn.addEventListener("click", async () => {
    if (deleteInput.value.trim().toUpperCase() !== "SUPPRIMER") return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = "Suppression...";
    try {
      await fetch(`${API_BASE}/profile/${state.userId}`, {
        method: "DELETE",
        headers: authHeadersOnly()
      });
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("spritedex_notifications");
    localStorage.removeItem("spritedex_avatar");
    localStorage.removeItem("spritedex_privacy");
    localStorage.removeItem("spritedex_last_sync");
    localStorage.removeItem(SYNC_QUEUE_KEY);
    state.userId = null;
    state.username = null;
    state.collection = {};
    location.reload();
  });

  // ── Notification preferences ──
  const NOTIF_KEY = "spritedex_notifications";
  const NOTIF_IDS = [
    "notifNewSprites",
    "notifNewVariants",
    "notifSquadActivity",
    "notifSessionSummary",
    "notifGoals",
    "notifSync"
  ];

  function loadNotifPrefs() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(NOTIF_KEY) || "{}"); } catch {}
    NOTIF_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.checked = prefs[id] !== undefined ? prefs[id] : true;
    });
  }

  function saveNotifPrefs() {
    const prefs = {};
    NOTIF_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) prefs[id] = el.checked;
    });
    localStorage.setItem(NOTIF_KEY, JSON.stringify(prefs));
    if (window.PushClient) {
      window.PushClient.syncPreferences({
        enabled: true,
        newSprites: prefs.notifNewSprites,
        newVariants: prefs.notifNewVariants,
        squadActivity: prefs.notifSquadActivity,
        sessionSummary: prefs.notifSessionSummary,
        goals: prefs.notifGoals,
        sync: prefs.notifSync
      });
    }
  }

  NOTIF_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", saveNotifPrefs);
  });

  loadNotifPrefs();

  // ── Topbar avatar ──
  function updateTopbarAvatar() {
    const avatarUrl = localStorage.getItem("spritedex_avatar") || "";
    const img = document.getElementById("topbarAvatarImg");
    if (avatarUrl) {
      img.src = avatarUrl;
      img.style.display = "";
    }
  }
  updateTopbarAvatar();
}

function getNotifPref(key) {
  try {
    const prefs = JSON.parse(localStorage.getItem("spritedex_notifications") || "{}");
    return prefs[key] !== undefined ? prefs[key] : true;
  } catch { return true; }
}
