(() => {
  "use strict";

  window.SpriteIndexAccount.register("shell", function initializeAccountFeature() {
    // Keep the source markup simple for the mobile flow, then compose the
    // desktop dashboard around the same, real controls. No action is cloned.
    if (hero && profileActions && profileActions.parentElement !== hero) {
      hero.append(profileActions);
    }
    if (dashboard && quickNav && passport && quickNav.parentElement !== dashboard) {
      dashboard.insertBefore(quickNav, passport);
    }

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
    document.getElementById("accountHeaderEdit")?.addEventListener("click", () => {
      document.getElementById("accountEditUsernameBtn")?.click();
    });

    // The desktop profile uses this compact navigation as a quick way to reach
    // the real settings below.  It does not duplicate or hide any preference:
    // every control stays available and keyboard reachable in the same panel.
    document.querySelectorAll("[data-account-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = document.getElementById(button.dataset.accountTarget);
        if (!target) return;
        if (target.id === "collectorPassport" || target.id === "notifSettingsSection") {
          target.hidden = false;
        }
        if (target.id === "accountProfileOverview") {
          document.getElementById("collectorPassport").hidden = true;
        }
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelectorAll("[data-account-target]").forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-current", active ? "page" : "false");
        });
      });
    });

    document.querySelectorAll("[data-account-overview-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.accountOverviewAction;
        if (action === "collection") {
          document.getElementById("accountGoCollection")?.click();
        } else if (action === "history") {
          closeAccount();
          if (typeof activateMainView === "function") activateMainView("history", { force: true });
        } else if (action === "passport") {
          document.querySelector('[data-account-target="collectorPassport"]')?.click();
        } else if (action === "notifications") {
          document.querySelector('[data-account-target="notifSettingsSection"]')?.click();
        }
      });
    });

    Object.assign(globalThis, { openAccount, closeAccount, renderAvatar });
  });
})();
