/* Language menu — polished globe trigger + dropdown / mobile sheet. */
(function setupLanguageSwitcher() {
  const LOCALES = [
    { code: "fr", native: "Français", region: "France / Belgique" },
    { code: "en", native: "English", region: "International" },
    { code: "nl", native: "Nederlands", region: "Nederland / België" }
  ];

  function currentLocale() {
    if (typeof window.appLocale === "function") return window.appLocale();
    return window.SPRITE_INDEX_LOCALE || "en";
  }

  function tKey(key, fallback) {
    if (typeof window.t === "function") {
      const translated = window.t(key);
      if (translated && translated !== key) return translated;
    }
    return fallback;
  }

  function labelFor(code) {
    return tKey(`lang.${code}`, LOCALES.find((item) => item.code === code)?.native || code.toUpperCase());
  }

  function regionFor(code) {
    return tKey(
      `lang.region.${code}`,
      LOCALES.find((item) => item.code === code)?.region || ""
    );
  }

  function switcherLabel() {
    return tKey("lang.switcher", "Language");
  }

  function syncMenu(root) {
    const active = currentLocale();
    const codeEl = root.querySelector("[data-lang-code]");
    const nameEl = root.querySelector("[data-lang-name]");
    const flagEl = root.querySelector("[data-lang-flag]");
    if (codeEl) codeEl.textContent = active.toUpperCase();
    if (nameEl) nameEl.textContent = labelFor(active);
    if (flagEl) flagEl.src = `icons/flags/${active}.png`;

    const trigger = root.querySelector(".lang-menu__trigger");
    if (trigger) {
      const full = `${switcherLabel()} — ${labelFor(active)}`;
      trigger.title = full;
      trigger.setAttribute("aria-label", full);
    }

    root.querySelectorAll("[data-lang]").forEach((option) => {
      const code = option.getAttribute("data-lang");
      const selected = code === active;
      option.setAttribute("aria-selected", selected ? "true" : "false");
      option.classList.toggle("is-active", selected);
      const meta = option.querySelector("[data-lang-meta]");
      if (meta) meta.textContent = regionFor(code);
    });
  }

  function isMobileLayout() {
    return window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
  }

  function clampPanel(root) {
    const panel = root.querySelector(".lang-menu__panel");
    const trigger = root.querySelector(".lang-menu__trigger");
    if (!panel || panel.hidden || !trigger) return;

    panel.style.left = "";
    panel.style.right = "";
    panel.style.top = "";
    panel.style.bottom = "";
    panel.style.transform = "";
    panel.style.width = "";

    if (!isMobileLayout()) {
      // Desktop: absolute under trigger; nudge if it overflows the viewport.
      panel.style.right = "0";
      const rect = panel.getBoundingClientRect();
      const pad = 10;
      if (rect.left < pad) {
        panel.style.right = "auto";
        panel.style.left = "0";
      }
      return;
    }

    // Mobile: fixed dropdown anchored under the trigger, clamped in-viewport.
    const triggerRect = trigger.getBoundingClientRect();
    const pad = 10;
    const viewportW = document.documentElement.clientWidth || window.innerWidth;
    const width = Math.min(280, viewportW - pad * 2);
    let left = triggerRect.right - width;
    left = Math.max(pad, Math.min(left, viewportW - width - pad));
    const top = Math.min(triggerRect.bottom + 8, window.innerHeight - 12);
    panel.style.position = "fixed";
    panel.style.width = `${width}px`;
    panel.style.maxWidth = `${viewportW - pad * 2}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.visibility = "visible";
    panel.style.pointerEvents = "auto";

    const caretOffset = Math.max(14, Math.min(triggerRect.left + triggerRect.width / 2 - left - 6, width - 26));
    panel.style.setProperty("--lang-caret-right", "auto");
    panel.style.setProperty("--lang-caret-left", `${caretOffset}px`);
  }

  function setOpen(root, open) {
    const trigger = root.querySelector(".lang-menu__trigger");
    const panel = root.querySelector(".lang-menu__panel");
    const backdrop = root.querySelector(".lang-menu__backdrop");
    if (!trigger || !panel) return;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    panel.hidden = !open;
    if (backdrop) backdrop.hidden = !open;
    root.classList.toggle("is-open", open);
    document.documentElement.classList.toggle("lang-menu-open", !!document.querySelector(".lang-menu.is-open"));
    if (open) {
      requestAnimationFrame(() => clampPanel(root));
    } else {
      panel.style.left = "";
      panel.style.right = "";
      panel.style.top = "";
      panel.style.bottom = "";
      panel.style.width = "";
      panel.style.maxWidth = "";
      panel.style.transform = "";
      panel.style.position = "";
      panel.style.visibility = "";
      panel.style.pointerEvents = "";
    }
  }

  function closeAll(except) {
    document.querySelectorAll(".lang-menu").forEach((menu) => {
      if (except && menu === except) return;
      setOpen(menu, false);
    });
    if (![...document.querySelectorAll(".lang-menu.is-open")].length) {
      document.documentElement.classList.remove("lang-menu-open");
    }
  }

  function showSwitchOverlay(code) {
    let overlay = document.getElementById("langSwitchOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "langSwitchOverlay";
      overlay.className = "lang-switch-overlay";
      overlay.innerHTML = `
        <div class="lang-switch-overlay__card" role="status" aria-live="polite">
          <span class="lang-switch-overlay__spin" aria-hidden="true"></span>
          <strong class="lang-switch-overlay__title"></strong>
          <span class="lang-switch-overlay__code"></span>
        </div>`;
      document.body.appendChild(overlay);
    }
    const title = overlay.querySelector(".lang-switch-overlay__title");
    const codeEl = overlay.querySelector(".lang-switch-overlay__code");
    if (title) title.textContent = tKey("lang.switching", "Changement de langue…");
    if (codeEl) codeEl.textContent = labelFor(code);
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
  }

  function onSelect(code) {
    if (!code || code === currentLocale()) return;
    showSwitchOverlay(code);
    window.setTimeout(() => {
      if (typeof window.setAppLanguage === "function") {
        window.setAppLanguage(code);
        return;
      }
      try {
        localStorage.setItem(window.SPRITE_INDEX_LOCALE_KEY || "sprite-index_locale", code);
      } catch { /* ignore */ }
      window.location.reload();
    }, 180);
  }

  function focusOption(root, index) {
    const options = [...root.querySelectorAll(".lang-menu__option")];
    if (!options.length) return;
    const next = options[(index + options.length) % options.length];
    next.focus();
  }

  function closeNotifPopover() {
    const notifDropdown = document.getElementById("notifDropdown");
    const notifBell = document.getElementById("notifBell");
    if (notifDropdown) notifDropdown.style.display = "none";
    if (notifBell) notifBell.setAttribute("aria-expanded", "false");
  }

  function bind(root) {
    if (!root || root.dataset.langBound === "1") return;
    root.dataset.langBound = "1";
    const trigger = root.querySelector(".lang-menu__trigger");
    const panel = root.querySelector(".lang-menu__panel");
    if (!trigger || !panel) return;

    if (!root.querySelector(".lang-menu__backdrop")) {
      const backdrop = document.createElement("button");
      backdrop.type = "button";
      backdrop.className = "lang-menu__backdrop";
      backdrop.hidden = true;
      backdrop.setAttribute("aria-label", "Close");
      backdrop.addEventListener("click", (event) => {
        event.preventDefault();
        setOpen(root, false);
        trigger.focus();
      });
      root.insertBefore(backdrop, panel);
    }

    syncMenu(root);

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = trigger.getAttribute("aria-expanded") !== "true";
      closeAll(root);
      setOpen(root, willOpen);
      if (willOpen) {
        closeNotifPopover();
        // Avoid forcing focus on touch devices (virtual keyboard / scroll jump).
        const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
        if (!coarse) {
          const active = root.querySelector('.lang-menu__option[aria-selected="true"]')
            || root.querySelector(".lang-menu__option");
          active?.focus();
        }
      }
    });

    panel.addEventListener("click", (event) => {
      const option = event.target.closest("[data-lang]");
      if (!option || !panel.contains(option)) return;
      event.preventDefault();
      event.stopPropagation();
      const code = option.getAttribute("data-lang");
      setOpen(root, false);
      if (code === currentLocale()) return;
      onSelect(code);
    });

    root.addEventListener("keydown", (event) => {
      const open = trigger.getAttribute("aria-expanded") === "true";
      const options = [...root.querySelectorAll(".lang-menu__option")];
      const currentIndex = options.indexOf(document.activeElement);

      if (event.key === "Escape") {
        if (!open) return;
        event.preventDefault();
        setOpen(root, false);
        trigger.focus();
        return;
      }

      if (!open) {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
          if (document.activeElement !== trigger) return;
          event.preventDefault();
          closeAll(root);
          setOpen(root, true);
          focusOption(root, Math.max(0, options.findIndex((el) => el.getAttribute("aria-selected") === "true")));
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusOption(root, currentIndex < 0 ? 0 : currentIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusOption(root, currentIndex < 0 ? options.length - 1 : currentIndex - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusOption(root, 0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusOption(root, options.length - 1);
      }
    });
  }

  function init() {
    document.querySelectorAll(".lang-menu").forEach(bind);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".lang-menu")) return;
    closeAll();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.setupLanguageSwitcher = init;
})();
