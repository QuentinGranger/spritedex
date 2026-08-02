(() => {
  "use strict";

  window.SpriteIndexAccount.register("notifications", function initializeAccountFeature() {
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
    off.textContent = t("account.disabled");
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
      refreshAccountQuickPreferences();
      notifSettingsReady = true;
      setNotifSettingsStatus("");
    } catch {
      refreshAccountQuickPreferences();
      notifSettingsReady = true;
      setNotifSettingsStatus(t("account.notif.loadError"), "err");
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
    setNotifSettingsStatus(t("account.notif.saving"));
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
      refreshAccountQuickPreferences();
      setNotifSettingsStatus(t("account.notif.saved"), "ok");
      if (payload.pushEnabled && window.PushClient && typeof window.PushClient.register === "function") {
        window.PushClient.register();
      }
      if (window.PushClient && typeof window.PushClient.syncPreferences === "function") {
        window.PushClient.syncPreferences({ enabled: payload.pushEnabled });
      }
    } catch {
      setNotifSettingsStatus(t("account.notif.saveError"), "err");
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
    const avatarUrl = localStorage.getItem("sprite-index_avatar") || "";
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
  Object.assign(globalThis, { fillQuietHourSelect, fillTimezoneSelect, setNotifSettingsStatus, applyNotificationSettings, loadNotificationSettings, collectNotificationSettingsPayload, saveNotificationSettings, updateTopbarAvatar });
  });
})();
