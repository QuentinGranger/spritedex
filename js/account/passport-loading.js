(() => {
  "use strict";

  window.SpriteIndexAccount.register("passport-loading", function initializeAccountFeature() {
  async function fetchCollectorPassport(userId) {
    const res = await fetch(`${API_BASE}/profile/${encodeURIComponent(userId)}/passport`, { headers: authHeadersOnly(), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t("account.passportUnavailable"));
    return data;
  }

  async function loadCollectorPassport() {
    const content = document.getElementById("collectorPassportContent");
    const reliabilityEl = document.getElementById("passportReliability");
    const actionsEl = document.getElementById("collectorPassportActions");
    if (!content || !state.userId) return;
    content.innerHTML = `<p class="collector-passport__empty">${t("account.passportLoading")}</p>`;
    if (actionsEl) actionsEl.innerHTML = "";
    try {
      const serverData = await fetchCollectorPassport(state.userId);
      const data = withCurrentLocalCollection(serverData);
      const reliability = (data.collection && data.collection.reliability) || {};
      if (reliabilityEl) {
        reliabilityEl.textContent = passportReliabilityLabel(reliability);
        reliabilityEl.className = `collector-passport__status collector-passport__status--${escapeHtml(reliability.level || "insufficient")}`;
      }
      renderAccountOverview(data);
      content.innerHTML = renderCollectorPassportBody(data);
      wirePassportActions(actionsEl, data, { isSelf: true });
      await loadCollectorPassportSettings(content);
      wirePassportBodyActions(content, data);
    } catch (error) {
      if (reliabilityEl) reliabilityEl.textContent = t("account.unavailable");
      content.innerHTML = `<p class="collector-passport__empty">${t("account.passportLoadError")}</p>`;
      console.error("[collector-passport]", error);
    }
  }

  async function openCollectorPassport(userId, displayName = "") {
    const dialog = document.getElementById("passportDialog");
    const content = document.getElementById("passportDialogContent");
    const reliabilityEl = document.getElementById("passportDialogReliability");
    const actionsEl = document.getElementById("passportDialogActions");
    const titleEl = document.getElementById("passportDialogTitle");
    if (!dialog || !content || !userId) return;
    if (titleEl) titleEl.textContent = displayName ? t("account.passportTitleUser", { name: displayName }) : t("account.passportTitle");
    content.innerHTML = `<p class="collector-passport__empty">${t("account.passportLoading")}</p>`;
    if (actionsEl) actionsEl.innerHTML = "";
    if (reliabilityEl) {
      reliabilityEl.textContent = "—";
      reliabilityEl.className = "collector-passport__status";
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    try {
      const data = await fetchCollectorPassport(userId);
      const reliability = (data.collection && data.collection.reliability) || {};
      if (reliabilityEl) {
        reliabilityEl.textContent = passportReliabilityLabel(reliability);
        reliabilityEl.className = `collector-passport__status collector-passport__status--${escapeHtml(reliability.level || "insufficient")}`;
      }
      content.innerHTML = renderCollectorPassportBody(data);
      const isSelf = String(userId) === String(state.userId);
      wirePassportActions(actionsEl, data, { isSelf });
      wirePassportBodyActions(content, data);
    } catch (error) {
      content.innerHTML = `<p class="collector-passport__empty">${escapeHtml(error.message || t("account.passportUnavailable"))}</p>`;
    }
  }

  window.openCollectorPassport = openCollectorPassport;

  function wirePassportBodyActions(content, data = null) {
    if (!content) return;
    const passportData = data || {};
    const ownerId = passportData.user && passportData.user.id;
    const name = (passportData.user && (passportData.user.displayName || passportData.user.username)) || t("account.player");

    content.querySelectorAll('[data-passport-action="choose-squad"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const details = content.querySelector(".collector-passport__settings");
        if (details) {
          details.open = true;
          const select = details.querySelector('[data-passport-setting="primarySquadId"]');
          if (select) {
            select.focus();
            select.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } else {
          loadCollectorPassportSettings(content).then(() => {
            const opened = content.querySelector(".collector-passport__settings");
            if (opened) {
              opened.open = true;
              opened.querySelector('[data-passport-setting="primarySquadId"]')?.focus();
            }
          });
        }
      });
    });

    content.querySelectorAll('[data-passport-action="compare"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        document.getElementById("accountGoCompare")?.click();
      });
    });

    content.querySelectorAll('[data-passport-action="compare-user"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        const dialog = document.getElementById("passportDialog");
        if (dialog && dialog.open) dialog.close();
        logPassportAnalytics("passport_comparison_started", {
          source: "passport_compare_btn",
          targetId: String(btn.dataset.id || ownerId || "")
        });
        if (typeof compareWithFriend === "function") {
          await compareWithFriend(
            btn.dataset.id || ownerId,
            btn.dataset.name || name,
            { source: "passport" }
          );
        }
      });
    });

    const openBadge = (card) => {
      const code = card.dataset.badgeCode || "";
      logPassportAnalytics("passport_badge_opened", {
        badgeCode: code,
        status: card.dataset.badgeStatus || null
      });
      const label = card.querySelector("strong")?.textContent || code || "Badge";
      const status = card.querySelector(".collector-passport__badge-status")?.textContent || "";
      announcePassportStatus(`${label}. ${status}`);
    };
    content.querySelectorAll('[data-passport-action="badge-open"]').forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest('[data-passport-action="pin-badge"]')) return;
        openBadge(card);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest('[data-passport-action="pin-badge"]')) return;
        e.preventDefault();
        openBadge(card);
      });
    });
    content.querySelectorAll('[data-passport-action="pin-badge"]').forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!state.userId) return;
        const badgeId = btn.dataset.badgeId || null;
        const currentlyPinned = btn.getAttribute("aria-pressed") === "true";
        const nextId = currentlyPinned ? null : badgeId;
        btn.disabled = true;
        try {
          const save = await fetch(
            `${API_BASE}/profile/${encodeURIComponent(state.userId)}/passport/settings`,
            {
              method: "PATCH",
              headers: authHeaders(),
              body: JSON.stringify({ featuredBadgeId: nextId })
            }
          );
          if (!save.ok) {
            const err = await save.json().catch(() => ({}));
            throw new Error(err.error || t("account.badgePinError"));
          }
          toast(nextId ? t("account.badgePinned") : t("account.badgeUnpinned"));
          loadCollectorPassport();
        } catch (err) {
          toastError(err, "account.badgePinError");
          btn.disabled = false;
        }
      });
    });

    content.querySelectorAll('[data-passport-action="open-filter"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        openPassportCollectionFilter(btn.dataset.filter || "all");
      });
    });

    content.querySelectorAll('[data-passport-action="event-missing"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const raw = btn.dataset.missing || "";
        const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
        openPassportEventMissing(ids);
      });
    });

    content.querySelectorAll('[data-passport-action="badge-filter"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const filter = btn.dataset.badgeFilter || "all";
        content.querySelectorAll('[data-passport-action="badge-filter"]').forEach((b) => {
          const active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });
        content.querySelectorAll(".collector-passport__badge-card").forEach((card) => {
          const status = card.dataset.badgeStatus;
          const category = card.dataset.badgeCategory;
          let show = true;
          if (filter === "unlocked") show = status === "unlocked";
          else if (filter === "locked") show = status === "locked";
          else if (filter === "progression" || filter === "social" || filter === "events") {
            show = category === filter;
          }
          card.hidden = !show;
        });
        content.querySelectorAll(".collector-passport__badge-group").forEach((group) => {
          const visible = [...group.querySelectorAll(".collector-passport__badge-card")].some((c) => !c.hidden);
          group.hidden = !visible;
        });
        announcePassportStatus(`Filtre badges : ${btn.textContent || filter}`);
      });
    });
  }

  async function loadCollectorPassportSettings(content) {
    if (!state.userId || !content) return;
    try {
      const res = await fetch(`${API_BASE}/profile/${encodeURIComponent(state.userId)}/passport/settings`, { headers: authHeadersOnly() });
      if (!res.ok) return;
      const settings = await res.json();
      const options = (selected) => ["private", "friends", "squad", "public"].map(value => `<option value="${value}" ${selected === value ? "selected" : ""}>${({
          private: t("account.passport.settings.private"),
          friends: t("account.passport.settings.friends"),
          squad: t("account.passport.settings.squad"),
          public: t("account.passport.settings.public")
        })[value]}</option>`).join("");
      const squadOptions = [`<option value="">${t("account.passport.settings.noSquad")}</option>`, ...((settings.availableSquads || []).map(s => `<option value="${escapeHtml(String(s.id))}" ${String(settings.primarySquadId) === String(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`))].join("");
      const featuredOptions = [
        `<option value="">${t("account.passport.settings.noBadge")}</option>`,
        ...((settings.availableFeaturedBadges || []).map((b) =>
          `<option value="${escapeHtml(String(b.id))}" ${String(settings.featuredBadgeId) === String(b.id) ? "selected" : ""}>${escapeHtml(b.label || b.code)}</option>`
        ))
      ].join("");
      content.insertAdjacentHTML("beforeend", `
        <details class="collector-passport__settings"><summary>${t("account.passport.settings.title")}</summary>
          <p>${t("account.passport.settings.note")}</p>
          <label>${t("account.passport.settings.mainSquad")}<select data-passport-setting="primarySquadId">${squadOptions}</select></label>
          <label>${t("account.passport.settings.featuredBadge")}<select data-passport-setting="featuredBadgeId">${featuredOptions}</select></label>
          <label>${t("account.passport.settings.passport")}<select data-passport-setting="passportVisibility">${options(settings.passportVisibility)}</select></label>
          <label>${t("account.passport.settings.statistics")}<select data-passport-setting="statisticsVisibility">${options(settings.statisticsVisibility)}</select></label>
          <label>${t("account.passport.settings.badges")}<select data-passport-setting="badgesVisibility">${options(settings.badgesVisibility)}</select></label>
          <label>${t("account.passport.settings.activity")}<select data-passport-setting="activityVisibility">${options(settings.activityVisibility)}</select></label>
          <label>${t("account.passport.settings.comparisons")}<select data-passport-setting="comparisonsVisibility">${options(settings.comparisonsVisibility)}</select></label>
          <label class="collector-passport__check"><input type="checkbox" data-passport-setting="showJoinDate" ${settings.showJoinDate ? "checked" : ""}> ${t("account.passport.settings.showJoinDate")}</label>
          <label class="collector-passport__check"><input type="checkbox" data-passport-setting="showLastActivity" ${settings.showLastActivity ? "checked" : ""}> ${t("account.passport.settings.showLastActivity")}</label>
          <button type="button" class="account-save-btn" id="passportSaveSettings">${t("account.passport.settings.save")}</button>
        </details>
      `);
      const saveBtn = content.querySelector("#passportSaveSettings");
      if (!saveBtn) return;
      saveBtn.addEventListener("click", async () => {
        const payload = {};
        content.querySelectorAll("[data-passport-setting]").forEach(field => {
          if (field.type === "checkbox") {
            payload[field.dataset.passportSetting] = field.checked;
          } else if (field.dataset.passportSetting === "primarySquadId" || field.dataset.passportSetting === "featuredBadgeId") {
            payload[field.dataset.passportSetting] = field.value || null;
          } else {
            payload[field.dataset.passportSetting] = field.value;
          }
        });
        saveBtn.disabled = true;
        try {
          const save = await fetch(`${API_BASE}/profile/${encodeURIComponent(state.userId)}/passport/settings`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload) });
          if (!save.ok) throw new Error();
          toast(t("account.passportSaved"));
          loadCollectorPassport();
        } catch {
          toast(t("account.passportSaveError"));
          saveBtn.disabled = false;
        }
      });
    } catch (err) {
      console.error("[collector-passport settings]", err);
    }
  }

  Object.assign(globalThis, { fetchCollectorPassport, loadCollectorPassport, openCollectorPassport, wirePassportBodyActions, loadCollectorPassportSettings });
  });
})();
