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

  function renderAvatar(container, value) {
    if (!container) return;
    const url = typeof safeImageUrl === "function" ? safeImageUrl(value) : "";
    if (!url) {
      // Static fallback only; never interpolate a stored avatar value into HTML.
      container.innerHTML = `<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      return;
    }
    const image = document.createElement("img");
    image.src = url;
    image.alt = "Avatar";
    image.referrerPolicy = "no-referrer";
    container.replaceChildren(image);
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
    renderAvatar(avatarDisplay, avatarUrl);

    // Stats
    const coll = state.collection || {};
    const entries = Object.values(coll);
    const ownedVariants = entries.filter(e => e.status === "owned").length;
    const totalVariants = SPRITES.reduce((sum, s) => sum + (Object.keys(s.variantDetails || {}).length || (Array.isArray(s.variants) ? s.variants.length : 1)), 0);
    const percent = totalVariants ? Math.round((ownedVariants / totalVariants) * 100) : 0;

    // Sprites completed = sprites where ALL variants are owned
    const spriteVariantMap = {};
    SPRITES.forEach(s => {
      const variantTypes = Object.keys(s.variantDetails || {});
      const variants = variantTypes.length > 0 ? variantTypes : (s.variants || ["Base"]);
      variants.forEach(v => {
        const key = variantId(s.id, v);
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
    loadNotificationSettings();
  }

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
          renderAvatar(avatarDisplay, avatarUrl);
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
  // Generates (and rotates) an opaque, unguessable share token server-side and
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
    const url = `${webOrigin()}/?share=${token}`;
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
    state.collection = createSafeRecord();
    location.reload();
  });

  // ── Notification settings (Étape 49) ──
  const NOTIF_TIMEZONES = [
    "Europe/Paris",
    "Europe/Brussels",
    "Europe/Zurich",
    "Europe/London",
    "Atlantic/Reykjavik",
    "America/Montreal",
    "America/New_York",
    "America/Los_Angeles",
    "America/Martinique",
    "America/Guadeloupe",
    "Indian/Reunion",
    "Pacific/Noumea",
    "Pacific/Tahiti",
    "UTC"
  ];

  let notifSettingsSaving = false;
  let notifSettingsReady = false;

  function fillQuietHourSelect(selectEl) {
    if (!selectEl || selectEl.options.length) return;
    const off = document.createElement("option");
    off.value = "";
    off.textContent = "Désactivé";
    selectEl.appendChild(off);
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement("option");
      opt.value = String(h);
      opt.textContent = `${String(h).padStart(2, "0")}:00`;
      selectEl.appendChild(opt);
    }
  }

  function fillTimezoneSelect(selectEl, current) {
    if (!selectEl) return;
    const values = new Set(NOTIF_TIMEZONES);
    if (current) values.add(current);
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) values.add(detected);
    } catch { /* ignore */ }
    const sorted = [...values].sort((a, b) => a.localeCompare(b));
    selectEl.innerHTML = sorted
      .map((tz) => `<option value="${escapeHtml(tz)}">${escapeHtml(tz)}</option>`)
      .join("");
    selectEl.value = current && values.has(current) ? current : "Europe/Paris";
  }

  function setNotifSettingsStatus(message, kind) {
    const el = document.getElementById("notifSettingsStatus");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.className = "notif-settings__status";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = `notif-settings__status${kind ? ` notif-settings__status--${kind}` : ""}`;
  }

  function applyNotificationSettings(prefs) {
    const channels = prefs.channels || {};
    document.querySelectorAll("[data-notif-channel]").forEach((el) => {
      const key = el.dataset.notifChannel;
      el.checked = channels[key] !== false;
    });
    // Push master switch also mirrors users.push_enabled.
    const pushEl = document.getElementById("notifChannelPush");
    if (pushEl && prefs.pushEnabled === false) pushEl.checked = false;

    const types = prefs.types || {};
    document.querySelectorAll("[data-notif-type]").forEach((el) => {
      const key = el.dataset.notifType;
      el.checked = types[key] !== false;
    });

    const delivery = prefs.delivery || {};
    document.querySelectorAll("[data-notif-in-app]").forEach((el) => {
      const key = el.dataset.notifInApp;
      const cfg = delivery[key];
      el.checked = cfg ? cfg.inApp !== false : true;
    });
    document.querySelectorAll("[data-notif-push]").forEach((el) => {
      const key = el.dataset.notifPush;
      const cfg = delivery[key];
      const defaults = {
        friend_request_accepted: "enabled",
        friend_acquired_missing_variant: "priorities_only",
        squad_completion_increased: "milestones_only",
        priority_variant_available: "enabled",
        wanted_event_ending_soon: "enabled"
      };
      const value = (cfg && cfg.push) || defaults[key] || "enabled";
      if ([...el.options].some((o) => o.value === value)) el.value = value;
    });

    const frequencies = prefs.frequencies || {};
    document.querySelectorAll("[data-notif-frequency]").forEach((el) => {
      const key = el.dataset.notifFrequency;
      const value = frequencies[key] || "immediate";
      el.value = ["immediate", "daily_digest", "disabled"].includes(value) ? value : "immediate";
    });

    const quiet = prefs.quietHours || {};
    const startEl = document.getElementById("notifQuietStart");
    const endEl = document.getElementById("notifQuietEnd");
    fillQuietHourSelect(startEl);
    fillQuietHourSelect(endEl);
    if (startEl) startEl.value = quiet.start == null ? "" : String(quiet.start);
    if (endEl) endEl.value = quiet.end == null ? "" : String(quiet.end);

    fillTimezoneSelect(
      document.getElementById("notifTimezone"),
      prefs.timeZone || prefs.timezone || "Europe/Paris"
    );

    const maxPushEl = document.getElementById("notifMaxPushPerDay");
    if (maxPushEl) {
      const max = prefs.maxPushPerDay == null ? 8 : Number(prefs.maxPushPerDay);
      const value = Number.isFinite(max) ? String(max) : "8";
      if ([...maxPushEl.options].some((o) => o.value === value)) maxPushEl.value = value;
      else maxPushEl.value = "8";
    }
  }

  async function loadNotificationSettings() {
    const section = document.getElementById("notifSettingsSection");
    if (!section || !state.userId) return;
    fillQuietHourSelect(document.getElementById("notifQuietStart"));
    fillQuietHourSelect(document.getElementById("notifQuietEnd"));
    fillTimezoneSelect(document.getElementById("notifTimezone"), "Europe/Paris");
    try {
      const res = await fetch(`${API_BASE}/notifications/preferences`, {
        headers: authHeadersOnly()
      });
      if (!res.ok) throw new Error("load failed");
      const prefs = await res.json();
      applyNotificationSettings(prefs);
      notifSettingsReady = true;
      setNotifSettingsStatus("");
    } catch {
      notifSettingsReady = true;
      setNotifSettingsStatus("Impossible de charger les préférences.", "err");
    }
  }

  function collectNotificationSettingsPayload() {
    const channels = {};
    document.querySelectorAll("[data-notif-channel]").forEach((el) => {
      channels[el.dataset.notifChannel] = !!el.checked;
    });
    const types = {};
    document.querySelectorAll("[data-notif-type]").forEach((el) => {
      types[el.dataset.notifType] = !!el.checked;
    });
    const delivery = {};
    document.querySelectorAll("[data-notif-delivery]").forEach((card) => {
      const key = card.dataset.notifDelivery;
      const inAppEl = card.querySelector(`[data-notif-in-app="${key}"]`);
      const pushEl = card.querySelector(`[data-notif-push="${key}"]`);
      delivery[key] = {
        inApp: inAppEl ? !!inAppEl.checked : true,
        push: pushEl ? (pushEl.value || "enabled") : "enabled"
      };
      types[key] = delivery[key].inApp;
    });
    const frequencies = {};
    document.querySelectorAll("[data-notif-frequency]").forEach((el) => {
      frequencies[el.dataset.notifFrequency] = el.value || "immediate";
    });
    const startRaw = document.getElementById("notifQuietStart")?.value;
    const endRaw = document.getElementById("notifQuietEnd")?.value;
    const quietHours = {
      start: startRaw === "" ? null : Number(startRaw),
      end: endRaw === "" ? null : Number(endRaw)
    };
    const timeZone = document.getElementById("notifTimezone")?.value || "Europe/Paris";
    const maxRaw = document.getElementById("notifMaxPushPerDay")?.value;
    const maxPushPerDay = maxRaw === "" || maxRaw == null ? 8 : Number(maxRaw);
    return {
      pushEnabled: !!channels.push,
      channels,
      types,
      frequencies,
      delivery,
      quietHours,
      timeZone,
      maxPushPerDay: Number.isFinite(maxPushPerDay) ? maxPushPerDay : 8
    };
  }

  async function saveNotificationSettings() {
    if (!notifSettingsReady || notifSettingsSaving || !state.userId) return;
    notifSettingsSaving = true;
    setNotifSettingsStatus("Enregistrement…");
    const payload = collectNotificationSettingsPayload();
    try {
      const res = await fetch(`${API_BASE}/notifications/preferences`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("save failed");
      const prefs = await res.json();
      applyNotificationSettings(prefs);
      setNotifSettingsStatus("Préférences enregistrées.", "ok");
      if (payload.pushEnabled && window.PushClient && typeof window.PushClient.register === "function") {
        window.PushClient.register();
      }
      if (window.PushClient && typeof window.PushClient.syncPreferences === "function") {
        window.PushClient.syncPreferences({ enabled: payload.pushEnabled });
      }
    } catch {
      setNotifSettingsStatus("Erreur lors de l'enregistrement.", "err");
    }
    notifSettingsSaving = false;
  }

  const notifSettingsRoot = document.getElementById("notifSettings");
  if (notifSettingsRoot) {
    notifSettingsRoot.addEventListener("change", (e) => {
      if (!e.target.closest("[data-notif-channel], [data-notif-type], [data-notif-frequency], [data-notif-in-app], [data-notif-push], #notifQuietStart, #notifQuietEnd, #notifTimezone, #notifMaxPushPerDay")) {
        return;
      }
      saveNotificationSettings();
    });
  }

  // ── Topbar avatar ──
  function updateTopbarAvatar() {
    const avatarUrl = localStorage.getItem("spritedex_avatar") || "";
    const img = document.getElementById("topbarAvatarImg");
    if (!img) return;
    const safeUrl = typeof safeImageUrl === "function" ? safeImageUrl(avatarUrl) : "";
    if (safeUrl) {
      img.src = safeUrl;
      img.referrerPolicy = "no-referrer";
      img.style.display = "";
    } else if (img) {
      img.removeAttribute("src");
      img.style.display = "none";
    }
  }
  updateTopbarAvatar();
}

function getNotifPref(_key) {
  // Legacy helper — contextual prefs live on the server (Étape 49).
  return true;
}
