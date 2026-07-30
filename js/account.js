function setupAccountPanel() {
  const panel = document.getElementById("accountPanel");
  const openBtn = document.getElementById("accountBtn");
  const closeBtn = document.getElementById("accountClose");
  const dashboard = document.getElementById("accountProfileOverview");
  const hero = dashboard?.querySelector(".profile-hero");
  const passport = document.getElementById("collectorPassport");
  const quickNav = document.querySelector(".account-section-nav");
  const profileActions = document.querySelector(".profile-actions");

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

  // ── Email verification banner ──
  const emailBanner = document.getElementById("emailBanner");
  const resendBtn = document.getElementById("resendVerification");

  function checkEmailVerified() {
    const emailVerified = localStorage.getItem("sprite-index_email_verified");
    emailBanner.style.display = (emailVerified === "true" || !state.userId) ? "none" : "";
  }

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true;
    resendBtn.textContent = t("account.sendingVerification");
    try {
      await fetch(`${API_BASE}/auth/resend-verification`, {
        method: "POST",
        headers: authHeadersOnly()
      });
      toast(t("account.verificationSent"));
    } catch {
      toast(t("account.errorRetryLater"));
    }
    resendBtn.disabled = false;
    resendBtn.textContent = t("account.resend");
  });

  // ── Populate all profile data ──
  function populateAccount() {
    checkEmailVerified();

    // Username & avatar
    document.getElementById("accountUsername").textContent = state.username || "—";
    document.getElementById("accountEditUsername").value = state.username || "";

    const avatarDisplay = document.getElementById("accountAvatarDisplay");
    const avatarUrl = localStorage.getItem("sprite-index_avatar") || "";
    renderAvatar(avatarDisplay, avatarUrl);

    // Stats
    const catalogueItems = getAllItems();
    const releasedItems = getReleasedCollectionItems(catalogueItems);
    const metrics = getCollectionMetrics(catalogueItems);
    const ownedVariants = metrics.owned;
    const totalVariants = metrics.releasedTotal;
    const percent = metrics.percent;
    panel.style.setProperty("--account-progress", `${Math.min(100, Math.max(0, percent))}%`);

    // Sprites completed = sprites where ALL variants are owned
    const spriteVariantMap = {};
    releasedItems.forEach((item) => {
      if (!spriteVariantMap[item.spriteId]) spriteVariantMap[item.spriteId] = { total: 0, owned: 0 };
      spriteVariantMap[item.spriteId].total++;
      if (getEntry(item.id).status === "owned") spriteVariantMap[item.spriteId].owned++;
    });
    const totalSprites = Object.keys(spriteVariantMap).length;
    const completedSprites = Object.values(spriteVariantMap).filter(s => s.owned === s.total && s.total > 0).length;

    // Priorities
    const priorities = releasedItems.filter((item) => getEntry(item.id).status === "priority").length;

    document.getElementById("accountPercent").textContent = percent + "%";
    document.getElementById("accountCompleted").textContent = `${completedSprites} / ${totalSprites}`;
    document.getElementById("accountVariants").textContent = `${ownedVariants} / ${totalVariants}`;
    document.getElementById("accountPriorities").textContent = priorities;

    // Privacy
    const privacyEl = document.getElementById("accountPrivacy");
    privacyEl.value = localStorage.getItem("sprite-index_privacy") || "squad_only";

    // Étape 68 — community stats opt-in (optional; never required for essentials).
    loadCommunityStatsOptIn();

    // Last sync
    const lastSync = localStorage.getItem("sprite-index_last_sync");
    document.getElementById("accountLastSync").textContent = lastSync
      ? new Date(lastSync).toLocaleString(uiLocale(), { dateStyle: "short", timeStyle: "short" })
      : t("account.neverSynced");

    // Member since
    const userRaw = localStorage.getItem(USER_KEY);
    if (userRaw) {
      try {
        const u = JSON.parse(userRaw);
        if (u.created_at) {
          document.getElementById("accountSince").textContent =
            t("account.memberSince", { date: new Date(u.created_at).toLocaleDateString(uiLocale(), { month: "long", year: "numeric" }) });
        }
      } catch {}
    }

    // Reflect whether an active share link exists (show/hide revoke button).
    refreshShareState();
    loadCollectorPassport();
    loadNotificationSettings();
  }

  function setAccountOverviewValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function renderAccountOverview(data) {
    const collection = data?.collection || {};
    const catalogue = data?.catalogue || {};
    const social = data?.social || {};
    const reliability = collection.reliability || {};
    const released = Math.max(0, Number(catalogue.releasedVariantCount) || 0);
    const owned = Math.max(0, Number(collection.ownedVariantCount) || 0);
    const completion = collection.completionRateDisplay != null
      ? Number(collection.completionRateDisplay)
      : (released ? (owned / released) * 100 : 0);
    const isEnglish = typeof window.appLocale === "function" && window.appLocale() === "en";
    const rate = Math.max(0, Math.min(100, Number.isFinite(completion) ? completion : 0));
    const rateLabel = `${rate.toLocaleString(isEnglish ? "en-US" : "fr-FR", { maximumFractionDigits: 1 })}%`;
    const ring = document.getElementById("accountOverviewRing");
    if (ring) {
      ring.style.setProperty("--account-overview-progress", `${rate}%`);
      ring.setAttribute("aria-label", t("account.collectionProgressAria", { rate: rateLabel }));
    }
    setAccountOverviewValue("accountOverviewPercent", rateLabel);
    setAccountOverviewValue("accountOverviewOwned", `${owned} / ${released}`);
    const remaining = Math.max(0, released - owned);
    setAccountOverviewValue("accountOverviewRemaining", released
      ? (remaining === 1 ? t("account.remainingVariantsOne") : t("account.remainingVariantsMany", { count: remaining }))
      : t("account.noCollectionData"));

    const badges = Array.isArray(data?.badgeProgress) && data.badgeProgress.length
      ? data.badgeProgress
      : (Array.isArray(data?.badges) ? data.badges.map((badge) => ({ ...badge, status: "unlocked" })) : []);
    globalThis.spriteIndexBadges = badges;
    const unlockedBadges = badges.filter((badge) => !badge.status || badge.status === "unlocked");
    const primarySquad = data?.primarySquad;
    setAccountOverviewValue("accountHeroBadges", String(unlockedBadges.length));
    setAccountOverviewValue("accountHeroSquad", primarySquad?.name ? String(primarySquad.memberCount || 1) : "0");
    const reliabilityRate = Math.max(0, Math.min(100, Number(reliability.rate) || 0));
    const reliabilityExplicit = Math.max(0, Number(reliability.explicitVariantCount) || 0);
    const reliabilityTotal = Math.max(0, Number(reliability.totalVariantCount) || released);
    const reliabilityLabel = reliabilityRate.toLocaleString(isEnglish ? "en-US" : "fr-FR", { maximumFractionDigits: 1 });
    setAccountOverviewValue("accountHeroReliability", `${reliabilityLabel}%`);
    setAccountOverviewValue("accountHeroReliabilityDetail", t("account.reliabilityDetail", { count: reliabilityExplicit, total: reliabilityTotal }));

    const events = data?.events || {};
    const completedEvents = Array.isArray(events.completed) ? events.completed : [];
    const inProgressEvents = Array.isArray(events.inProgress) ? events.inProgress : [];
    const activity = Array.isArray(data?.recentActivity) ? data.recentActivity : [];
    const addedVariants = activity.reduce((total, item) => {
      if ((item.activityType || item.type) !== "variants_owned") return total;
      return total + Math.max(1, Number(item.data?.count) || 1);
    }, 0);
    setAccountOverviewValue("accountOverviewEventsCompleted", String(completedEvents.length));
    setAccountOverviewValue("accountOverviewEventsInProgress", String(inProgressEvents.length));
    setAccountOverviewValue("accountOverviewNewBadges", String(unlockedBadges.length));
    setAccountOverviewValue("accountOverviewAddedVariants", String(addedVariants));

    const activityList = document.getElementById("accountOverviewActivityList");
    if (activityList) {
      activityList.replaceChildren();
      const recent = activity.slice(0, 3);
      if (!recent.length) {
        const empty = document.createElement("p");
        empty.textContent = t("account.noRecentActivity");
        activityList.append(empty);
      } else {
        const list = document.createElement("ul");
        recent.forEach((item) => {
          const row = document.createElement("li");
          const label = document.createElement("span");
          label.textContent = passportActivityLabel(item);
          const time = document.createElement("time");
          time.textContent = passportActivityDayLabel(item.createdAt || item.occurredAt);
          row.append(label, time);
          list.append(row);
        });
        activityList.append(list);
      }
    }

    const badgePreview = document.getElementById("accountBadgePreview");
    if (badgePreview) {
      badgePreview.replaceChildren();
      delete badgePreview.dataset.badgeCount;
      const preview = unlockedBadges.slice(0, 3);
      if (!preview.length) {
        const empty = document.createElement("p");
        empty.textContent = t("account.noBadge");
        badgePreview.append(empty);
      } else {
        badgePreview.dataset.badgeCount = String(unlockedBadges.length);
        const summary = document.createElement("div");
        summary.className = "account-badge-preview__summary";
        const count = document.createElement("strong");
        count.textContent = String(unlockedBadges.length);
        const countLabel = document.createElement("span");
        countLabel.textContent = unlockedBadges.length === 1
          ? t("account.badgePreviewCountOne")
          : t("account.badgePreviewCountMany");
        summary.append(count, countLabel);

        const tray = document.createElement("div");
        tray.className = "account-badge-preview__tray";
        tray.setAttribute("role", "list");
        preview.forEach((badge) => {
          const card = document.createElement("div");
          card.className = "account-badge-preview__item";
          card.setAttribute("role", "listitem");
          card.dataset.badgeCategory = badge.uiCategory || "progression";
          card.title = badge.label || badge.badgeCode || "Badge";
          const icon = document.createElement("span");
          if (badge.iconUrl) {
            const img = document.createElement("img");
            img.src = badge.iconUrl;
            img.alt = "";
            img.loading = "lazy";
            icon.append(img);
          } else {
            icon.textContent = String(badge.label || badge.badgeCode || "?").trim().slice(0, 1).toUpperCase();
          }
          const label = document.createElement("small");
          label.textContent = badge.label || badge.badgeCode || "Badge";
          card.append(icon, label);
          tray.append(card);
        });
        if (unlockedBadges.length > preview.length) {
          const rest = document.createElement("span");
          rest.className = "account-badge-preview__more";
          rest.textContent = `+${unlockedBadges.length - preview.length}`;
          rest.setAttribute("aria-label", t("account.badgePreviewMore", { count: unlockedBadges.length - preview.length }));
          tray.append(rest);
        }
        badgePreview.append(summary, tray);
      }
    }

    const squadMembers = Number(primarySquad?.memberCount) || 1;
    const squadLabel = primarySquad?.name
      ? `${primarySquad.name} · ${t("squad.memberCount", { count: squadMembers, s: squadMembers === 1 ? "" : "s" })}`
      : t("account.passport.noSquad");
    document.getElementById("accountHeroSquad")?.setAttribute("title", squadLabel);
    document.getElementById("accountHeroBadges")?.setAttribute("title", t("account.badgesObtainedTitle", { count: unlockedBadges.length }));
    document.getElementById("accountHeroReliability")?.setAttribute("title", t("account.reliabilityTitle", { percent: reliabilityLabel }));
    document.getElementById("accountHeroVariants")?.setAttribute("title", t("account.variantsOwnedTitle", { count: owned }));
    void social;
  }

  function withCurrentLocalCollection(data) {
    const metrics = getCollectionMetrics(getAllItems());
    const collection = data?.collection || {};
    const catalogue = data?.catalogue || {};
    return {
      ...data,
      collection: {
        ...collection,
        ownedVariantCount: metrics.owned,
        releasedVariantCount: metrics.releasedTotal,
        completionRate: metrics.percent,
        completionRatePrecise: metrics.precisePercent,
        completionRateDisplay: metrics.percent
      },
      catalogue: {
        ...catalogue,
        releasedVariantCount: metrics.releasedTotal
      }
    };
  }

  function refreshAccountQuickPreferences() {
    const value = (enabled) => enabled ? t("account.enabled") : t("account.disabled");
    setAccountOverviewValue("accountQuickPush", value(!!document.getElementById("notifChannelPush")?.checked));
    setAccountOverviewValue("accountQuickEmail", value(!!document.getElementById("notifChannelEmail")?.checked));
    setAccountOverviewValue("accountQuickFriends", value(!!document.querySelector('[data-notif-in-app="friend_request_accepted"]')?.checked));
  }

  function passportDate(value, fallback = "—", { withTime = true } = {}) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return withTime
      ? date.toLocaleString(uiLocale(), { dateStyle: "long", timeStyle: "short" })
      : date.toLocaleDateString(uiLocale(), { day: "numeric", month: "long", year: "numeric" });
  }

  function passportRelativeUpdate(value) {
    if (!value) return t("account.never");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const time = date.toLocaleTimeString(uiLocale(), { hour: "numeric", minute: "2-digit" });
    if (sameDay) return t("account.todayAt", { time });
    if (date.toDateString() === yesterday.toDateString()) return t("account.yesterdayAt", { time });
    return passportDate(value);
  }

  function passportReliabilityLabel(reliability) {
    const level = reliability && reliability.level;
    if (level === "complete") return t("account.collectionComplete");
    if (level === "usable") return t("account.collectionUsable");
    return t("account.collectionToComplete");
  }

  function passportSinceMonth(value) {
    if (!value) return t("account.joinDateHidden");
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return "—";
    const monthYear = start.toLocaleDateString(uiLocale(), { month: "long", year: "numeric" });
    return t("account.collectorSince", { monthYear });
  }

  function passportAvatarHtml(avatarUrl, username = "") {
    const url = typeof safeImageUrl === "function" ? safeImageUrl(avatarUrl) : "";
    const alt = username ? t("account.passport.avatarOf", { username }) : t("account.passport.avatarDefault");
    if (!url) {
      return `<div class="collector-passport__avatar collector-passport__avatar--empty" role="img" aria-label="${escapeHtml(alt)}"><svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>`;
    }
    return `<div class="collector-passport__avatar"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" referrerpolicy="no-referrer" loading="lazy"></div>`;
  }

  function formatCollectionProgressText(owned, released, rateDisplay) {
    if (typeof globalThis.PassportRender?.formatCollectionProgressText === "function") {
      return globalThis.PassportRender.formatCollectionProgressText(owned, released, rateDisplay);
    }
    const o = Math.max(0, Number(owned) || 0);
    const r = Math.max(0, Number(released) || 0);
    const rate = Number(rateDisplay);
    const rateStr = Number.isFinite(rate)
      ? formatUiNumber(rate, { minimumFractionDigits: 0, maximumFractionDigits: 1 })
      : "—";
    return uiLocale() === "en-US"
      ? `Collection progress: ${o} variant${o === 1 ? "" : "s"} out of ${r}, that is ${rateStr}%.`
      : `Progression de la collection : ${o} variante${o === 1 ? "" : "s"} sur ${r}, soit ${rateStr} %.`;
  }

  function formatBadgeAccessibleName(badge) {
    if (typeof globalThis.PassportRender?.formatBadgeAccessibleName === "function") {
      return globalThis.PassportRender.formatBadgeAccessibleName(badge);
    }
    const label = badge.label || badge.badgeCode || "Badge";
    const unlocked = !badge.status || badge.status === "unlocked";
    return unlocked ? t("account.badge.accessibleUnlocked", { label }) : t("account.badge.accessibleLocked", { label });
  }

  function logPassportAnalytics(event, details = {}) {
    try {
      fetch(`${API_BASE}/analytics/product`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ event, details })
      }).catch(() => {});
    } catch (_) {}
  }

  function announcePassportStatus(message) {
    const live = document.getElementById("passportA11yStatus")
      || document.getElementById("passportDialogA11yStatus");
    if (!live || !message) return;
    live.textContent = "";
    window.setTimeout(() => { live.textContent = message; }, 30);
  }

  function passportSeniority(value) {
    if (!value) return t("account.joinDateHidden");
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return "—";
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    if (now.getDate() < start.getDate()) months--;
    if (months < 1) return t("account.seniorityLessThanMonth");
    if (months < 12) return t("account.seniorityMonths", { months });
    const years = Math.floor(months / 12);
    return years > 1 ? t("account.seniorityYears", { years }) : t("account.seniorityYear", { years });
  }

  function passportActivityLabel(item) {
    const type = item.activityType || item.type;
    const data = item.data || {};
    switch (type) {
      case "variants_owned": {
        const count = Number(data.count) || 1;
        if (data.label || data.variantName) {
          return count > 1
            ? t("account.activity.variantsAddedNamed", { label: data.label || data.variantName })
            : t("account.activity.variantAddedNamed", { label: data.label || data.variantName });
        }
        return count > 1
          ? t("account.activity.variantsAdded", { count })
          : t("account.activity.variantAdded");
      }
      case "badge_unlocked":
        return data.label ? t("account.activity.badgeUnlockedLabel", { label: data.label }) : t("account.activity.badgeUnlocked");
      case "event_completed":
        return data.eventName ? t("account.activity.eventCompletedName", { name: data.eventName }) : t("account.activity.eventCompleted");
      case "squad_joined":
        return data.squadName ? t("account.activity.squadJoined", { name: data.squadName }) : t("account.activity.squadJoinedDefault");
      case "squad_created":
        return data.squadName ? t("account.activity.squadCreated", { name: data.squadName }) : t("account.activity.squadCreatedDefault");
      case "completion_milestone":
        return data.percent != null ? t("account.activity.milestonePercent", { percent: data.percent }) : t("account.activity.milestone");
      case "collective_goal_completed":
        return data.goalTitle
          ? t("account.activity.goalReached", { squad: data.squadName || t("account.activity.squadDefault"), goal: data.goalTitle })
          : (data.squadName
            ? t("account.activity.squadProgress", { squad: data.squadName })
            : t("account.activity.goalCompleted"));
      case "account_created":
        return t("account.activity.accountCreated");
      default:
        return type || t("account.activity.default");
    }
  }

  function passportActivityDayLabel(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startToday - startThat) / 86400000);
    if (diffDays === 0) return t("account.today");
    if (diffDays === 1) return t("account.yesterday");
    return d.toLocaleDateString(uiLocale(), { day: "numeric", month: "long", year: startThat.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  }

  function groupPassportActivityByDay(items) {
    const groups = [];
    const map = new Map();
    for (const item of items || []) {
      const raw = item.createdAt || item.occurredAt;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(key)) {
        const group = { key, label: passportActivityDayLabel(raw), items: [] };
        map.set(key, group);
        groups.push(group);
      }
      map.get(key).items.push(item);
    }
    return groups;
  }

  function passportVerificationLabel(status) {
    const map = {
      declared: t("account.verification.declared"),
      system_confirmed: t("account.verification.systemConfirmed"),
      community_verified: t("account.verification.communityVerified"),
      officially_verified: t("account.verification.officiallyVerified")
    };
    return map[status] || status || "—";
  }

  function passportBadgeCategoryLabel(cat) {
    return ({
      progression: t("account.badgeCategory.progression"),
      social: t("account.badgeCategory.social"),
      squads: t("account.badgeCategory.squads"),
      events: t("account.badgeCategory.events"),
      historique: t("account.badgeCategory.historique")
    })[cat] || t("account.badgeCategory.progression");
  }

  function openPassportCollectionFilter(filter) {
    closeAccount();
    const dialog = document.getElementById("passportDialog");
    if (dialog && dialog.open) dialog.close();
    state.passportMissingVariantIds = null;
    state.checklistFilter = filter || "all";
    state.expandedSprite = null;
    if (typeof activateMainView === "function") activateMainView("checklist", { force: true });
    const bar = document.getElementById("filterChipsBar") || document.querySelector(".filter-chips");
    if (bar) {
      if (typeof buildFilterChips === "function") buildFilterChips();
      bar.querySelectorAll(".filter-chip").forEach((chip) => {
        chip.classList.toggle("active", chip.dataset.filter === state.checklistFilter);
      });
    }
    if (typeof renderChecklist === "function") renderChecklist();
  }

  function openPassportEventMissing(missingIds) {
    const ids = Array.isArray(missingIds) ? missingIds.map(String).filter(Boolean) : [];
    closeAccount();
    const dialog = document.getElementById("passportDialog");
    if (dialog && dialog.open) dialog.close();
    state.passportMissingVariantIds = ids;
    state.checklistFilter = "missing";
    state.expandedSprite = null;
    if (typeof activateMainView === "function") activateMainView("checklist", { force: true });
    const bar = document.getElementById("filterChipsBar") || document.querySelector(".filter-chips");
    if (bar) {
      bar.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.remove("active"));
    }
    if (typeof renderChecklist === "function") renderChecklist();
    if (ids.length) toast(ids.length === 1 ? t("account.missingVariant", { count: ids.length }) : t("account.missingVariants", { count: ids.length }));
  }

  function passportEventEndLabel(ev) {
    if (ev.daysRemaining == null && !ev.endDate) return "";
    const days = ev.daysRemaining;
    if (days == null) {
      return `Fin : ${passportDate(ev.endDate, "—", { withTime: false })}`;
    }
    if (days <= 0) return t("account.event.endsToday");
    return days > 1 ? t("account.event.endsInDaysPlural", { days }) : t("account.event.endsInDays", { days });
  }

  function renderCollectorPassportBody(data) {
    const c = data.collection || {};
    const cat = data.catalogue || {};
    const social = data.social || {};
    const reliability = c.reliability || {};
    const identity = data.identity || {};
    const activity = Array.isArray(data.recentActivity) ? data.recentActivity : [];
    const createdAt = (identity.createdAt != null ? identity.createdAt : (data.user && data.user.createdAt));
    const sinceExact = passportSinceMonth(createdAt);
    const sinceDuration = createdAt ? passportSeniority(createdAt) : "";
    const released = safeFiniteNumber(cat.releasedVariantCount, 0, { min: 0, max: 1000000 });
    const releasedSprites = safeFiniteNumber(cat.releasedSpriteCount, 0, { min: 0, max: 1000000 });
    const discovered = safeFiniteNumber(c.discoveredSpriteCount, 0, { min: 0, max: 1000000 });
    const reliabilityWarning = reliability.level === "insufficient"
      ? `<p class="collector-passport__warning">${t("account.passport.reliabilityWarning", { rate: safePercentage(reliability.rate, 0) })}</p>`
      : "";
    const statsHidden = !data.collection;
    const owned = safeFiniteNumber(c.ownedVariantCount, 0, { min: 0, max: 1000000 });
    const displayRate = c.completionRateDisplay != null
      ? safeFiniteNumber(c.completionRateDisplay, 0, { min: 0, max: 100 })
      : Math.round(safePercentage(c.completionRate, 0) * 10) / 10;
    const nextStep = (c.progress && c.progress.nextStep) || null;
    const barWidth = Math.max(0, Math.min(100, displayRate));
    const peak = c.personalRecord || c.historicalPeak || (c.progress && c.progress.historicalPeak) || null;
    const showPeak = !!(peak && Number.isFinite(Number(peak.completionRateDisplay)));
    const qualityLabel = c.reliabilityQuality || passportReliabilityLabel(reliability);
    const badgeProgress = Array.isArray(data.badgeProgress) ? data.badgeProgress : [];
    const badges = badgeProgress.length
      ? badgeProgress
      : (Array.isArray(data.badges) ? data.badges.map((b) => ({ ...b, badgeCode: b.code || b.id, status: "unlocked" })) : []);
    globalThis.spriteIndexBadges = badges;
    const unlockedBadges = badges.filter((b) => !b.status || b.status === "unlocked");
    const featuredBadge = data.featuredBadge || identity.featuredBadge || null;
    const featuredId = featuredBadge && featuredBadge.badgeId ? String(featuredBadge.badgeId) : "";
    const events = data.events || {};
    const completedEvents = Array.isArray(events.completed) ? events.completed : [];
    const inProgressEvents = Array.isArray(events.inProgress) ? events.inProgress : [];
    const historicalEvents = Array.isArray(events.historical) ? events.historical : [];
    const completedEventCount = safeFiniteNumber(data.eventsCompleted != null ? data.eventsCompleted : completedEvents.length, 0, { min: 0, max: 1000000 });
    const officialRarity = c.highestOfficialRarity || null;
    const specialVariant = c.rarestSpecialVariant || null;
    const rarityLabel = officialRarity
      ? localizedRarity(officialRarity.label)
      : (c.highestRarity || t("account.passport.noRarityUnlocked"));
    const rarityCount = officialRarity && officialRarity.ownedCountAtRarity
      ? (() => {
          const n = safeFiniteNumber(officialRarity.ownedCountAtRarity, 0, { min: 0, max: 1000000 });
          const key = String(officialRarity.key || "").toLowerCase();
          const adjective = {
            common: t("account.passport.rarityAdj.common"),
            uncommon: t("account.passport.rarityAdj.uncommon"),
            rare: t("account.passport.rarityAdj.rare"),
            epic: t("account.passport.rarityAdj.epic"),
            legendary: t("account.passport.rarityAdj.legendary"),
            mythic: t("account.passport.rarityAdj.mythic")
          }[key] || localizedRarity(officialRarity.label).toLowerCase();
          return n === 1
            ? t("account.passport.rarityCountOne", { adjective })
            : t("account.passport.rarityCountMany", { count: n, adjective });
        })()
      : "";
    const isSelf = !!(data.user && data.user.isSelf);
    const username = identity.username || (data.user && data.user.username) || "";
    const displayName = identity.displayName || (data.user && data.user.displayName) || username;
    const avatarUrl = identity.avatarUrl || (data.user && data.user.avatarUrl) || "";
    const primarySquad = data.primarySquad;
    let primarySquadLine = t("account.passport.noSquad");
    let primarySquadHtml = t("account.passport.noSquad");
    if (primarySquad && primarySquad.private) {
      primarySquadLine = t("account.passport.privateSquad");
      primarySquadHtml = t("account.passport.privateSquad");
    } else if (primarySquad && primarySquad.name) {
      primarySquadLine = primarySquad.name;
      const members = safeFiniteNumber(primarySquad.memberCount, 0, { min: 0, max: 1000000 });
      const collective = primarySquad.collectiveCompletionDisplay != null
        ? formatUiNumber(Number(primarySquad.collectiveCompletionDisplay), { minimumFractionDigits: 0, maximumFractionDigits: 1 })
        : null;
      const meta = [
        members ? t("squad.memberCount", { count: members, s: members === 1 ? "" : "s" }) : null,
        collective != null ? t("account.passport.collectiveCompletion", { rate: collective }) : null,
        primarySquad.role || null
      ].filter(Boolean).join(" · ");
      primarySquadHtml = `${escapeHtml(primarySquad.name)}${meta ? `<br><small>${escapeHtml(meta)}</small>` : ""}`;
    } else if (isSelf) {
      primarySquadHtml = `${t("account.passport.noSquad")}<br><button type="button" class="ghost-button collector-passport__choose-squad" data-passport-action="choose-squad">${t("account.passport.chooseSquad")}</button>`;
    }
    const comparisonCount = social.comparisonCount;
    const distinctCompared = social.distinctCollectorsCompared;
    let comparisonsHtml = t("account.passport.hidden");
    if (comparisonCount != null) {
      const n = safeFiniteNumber(comparisonCount, 0, { min: 0, max: 1000000 });
      const distinct = distinctCompared == null
        ? null
        : safeFiniteNumber(distinctCompared, 0, { min: 0, max: 1000000 });
      comparisonsHtml = n === 1 ? t("account.passport.comparisonsOne") : t("account.passport.comparisonsMany", { count: n });
      if (distinct != null) {
        comparisonsHtml += `<br><small>${distinct === 1 ? t("account.passport.distinctCollectorsOne") : t("account.passport.distinctCollectorsMany", { count: distinct })}</small>`;
      }
    }
    const ownerId = data.user && data.user.id;
    const compareLabel = isSelf ? t("account.action.comparePlayer") : t("account.action.compareCollections");
    const compareAction = isSelf
      ? `data-passport-action="compare"`
      : `data-passport-action="compare-user" data-id="${escapeHtml(String(ownerId))}" data-name="${escapeHtml(displayName || username)}"`;

    const recentlyCompleted = Array.isArray(events.recentlyCompleted)
      ? events.recentlyCompleted
      : completedEvents.slice(0, 5);
    const rarityBreakdown = Array.isArray(c.rarityBreakdown) ? c.rarityBreakdown : [];
    const variantTypeBreakdown = Array.isArray(c.variantTypeBreakdown) ? c.variantTypeBreakdown : [];
    const activityGroups = groupPassportActivityByDay(activity);

    const renderEventItem = (ev, kind) => {
      const rate = ev.progressRate != null
        ? Number(ev.progressRate)
        : (ev.requiredCount
          ? Math.round((safeFiniteNumber(ev.ownedCount, 0) / safeFiniteNumber(ev.requiredCount, 1)) * 1000) / 10
          : null);
      const endLabel = kind === "progress" ? passportEventEndLabel(ev) : "";
      const missingAction = kind === "progress" && Array.isArray(ev.missingVariantIds) && ev.missingVariantIds.length
        ? `<button type="button" class="collector-passport__link-btn" data-passport-action="event-missing" data-missing="${escapeHtml(ev.missingVariantIds.join(","))}">${t("account.passport.viewMissing")}</button>`
        : "";
      if (kind === "completed" || kind === "historical") {
        return `<li>
          <div>
            <strong>${escapeHtml(ev.eventName || ev.eventId)}</strong>
            <span>${t("account.passport.variantCount", { owned: safeFiniteNumber(ev.ownedCount, 0, { min: 0, max: 1000000 }), total: safeFiniteNumber(ev.requiredCount, 0, { min: 0, max: 1000000 }) })}</span>
            <small>${t("account.passport.completedOn", { date: escapeHtml(passportDate(ev.completedAt, "—", { withTime: false })) })}${ev.catalogueVersion ? ` · catalogue ${escapeHtml(ev.catalogueVersion)}` : ""}${ev.version ? ` · v${escapeHtml(String(ev.version))}` : ""}</small>
          </div>
        </li>`;
      }
      return `<li>
        <div>
          <strong>${escapeHtml(ev.eventName || ev.eventId)}</strong>
          <span>${t("account.passport.variantCount", { owned: safeFiniteNumber(ev.ownedCount, 0, { min: 0, max: 1000000 }), total: safeFiniteNumber(ev.requiredCount, 0, { min: 0, max: 1000000 }) })}${rate != null ? ` · ${formatUiPercent(rate, { maximumFractionDigits: 1 })}` : ""}</span>
          <small>${endLabel || t("account.event.remaining", { count: safeFiniteNumber(ev.remainingCount, 0, { min: 0, max: 1000000 }) })}</small>
          ${missingAction}
        </div>
      </li>`;
    };

    const BADGE_UI_ORDER = ["progression", "social", "squads", "events", "historique"];
    const renderBadgeCard = (b) => {
      const status = b.status || "unlocked";
      const unlocked = status === "unlocked";
      const threshold = b.threshold != null ? safeFiniteNumber(b.threshold, 0, { min: 0, max: 100 }) : null;
      const releasedAt = b.releasedVariantCountAtUnlock != null
        ? safeFiniteNumber(b.releasedVariantCountAtUnlock, 0, { min: 0, max: 1000000 })
        : null;
      const progressValue = b.progressValue != null ? safeFiniteNumber(b.progressValue, 0, { min: 0, max: 1000000 }) : null;
      const targetValue = b.targetValue != null ? safeFiniteNumber(b.targetValue, 0, { min: 0, max: 1000000 }) : null;
      const remaining = b.remaining != null ? safeFiniteNumber(b.remaining, 0, { min: 0, max: 1000000 }) : null;
      const progressRate = b.progressRate != null ? safeFiniteNumber(b.progressRate, 0, { min: 0, max: 100 }) : null;
      const isFeatured = unlocked && featuredId && String(b.badgeId) === featuredId;
      const uiCat = b.uiCategory || "progression";
      let progressLine = "";
      if (unlocked) {
        const historical = b.isHistoricalProgression && threshold != null
          ? `${t("account.badge.thresholdDate", { threshold, date: passportDate(b.unlockedAt, "—", { withTime: false }) })}${releasedAt != null ? ` · ${releasedAt === 1 ? t("account.badge.catalogueOfOne", { count: releasedAt }) : t("account.badge.catalogueOfMany", { count: releasedAt })}` : ""}`
          : "";
        progressLine = historical || (b.unlockedAt ? t("account.badge.obtainedOn", { date: passportDate(b.unlockedAt, "—", { withTime: false }) }) : t("account.badge.unlocked"));
      } else if (progressValue != null && targetValue != null) {
        progressLine = [
          progressRate != null ? formatUiPercent(progressRate, { maximumFractionDigits: 2 }) : null,
          `${progressValue} / ${targetValue}`,
          remaining != null && remaining > 0 ? (remaining === 1 ? t("account.badge.remainingOne") : t("account.badge.remainingMany", { count: remaining })) : null
        ].filter(Boolean).join(" · ");
      }
      const pinBtn = isSelf && unlocked && b.badgeId
        ? `<button type="button" class="collector-passport__pin" data-passport-action="pin-badge" data-badge-id="${escapeHtml(String(b.badgeId))}" aria-pressed="${isFeatured ? "true" : "false"}">${isFeatured ? t("account.badge.pinned") : t("account.badge.pin")}</button>`
        : "";
      const iconChar = escapeHtml(String(b.label || b.badgeCode || "?").slice(0, 1).toUpperCase());
      const iconHtml = b.iconUrl
        ? `<img class="collector-passport__badge-icon collector-passport__badge-icon--art" src="${escapeHtml(b.iconUrl)}" alt="" loading="lazy" aria-hidden="true">`
        : `<div class="collector-passport__badge-icon collector-passport__badge-icon--fallback" aria-hidden="true">${iconChar}</div>`;
      const a11yName = formatBadgeAccessibleName(b);
      const statusLabel = unlocked ? t("account.badge.unlocked") : t("account.badge.locked");
      const barWidth = unlocked
        ? 100
        : Math.max(0, Math.min(100, progressRate != null ? progressRate : (targetValue ? Math.round((progressValue / targetValue) * 100) : 0)));
      const showProgress = !unlocked && targetValue != null;
      const verifyRaw = passportVerificationLabel(b.verificationStatus || (unlocked ? "declared" : "—"));
      const showVerify = verifyRaw && verifyRaw !== "—" && verifyRaw !== "-";
      return `<article class="collector-passport__badge-card collector-passport__badge-card--${unlocked ? "unlocked" : "locked"}${isFeatured ? " collector-passport__badge-card--featured" : ""}${b.iconUrl ? " collector-passport__badge-card--art" : ""}" tabindex="0" role="listitem" aria-label="${escapeHtml(a11yName)}" data-passport-action="badge-open" data-badge-code="${escapeHtml(b.badgeCode || "")}" data-badge-status="${unlocked ? "unlocked" : "locked"}" data-badge-category="${escapeHtml(uiCat)}"${unlocked ? "" : " hidden"}>
        <div class="collector-passport__badge-medal${b.iconUrl ? " collector-passport__badge-medal--art" : ""}">${iconHtml}</div>
        <div class="collector-passport__badge-body">
          <div class="collector-passport__badge-topline">
            <strong>${escapeHtml(b.label || b.badgeCode || b.id)}</strong>
            <span class="collector-passport__badge-status">${statusLabel}${isFeatured ? t("account.badge.pinnedSuffix") : ""}</span>
          </div>
          ${b.description ? `<p class="collector-passport__badge-desc">${escapeHtml(b.description)}</p>` : ""}
          ${showProgress ? `
            <div class="collector-passport__badge-progress" aria-hidden="true">
              <div class="collector-passport__badge-progress-track">
                <div class="collector-passport__badge-progress-fill" style="width:${barWidth}%"></div>
              </div>
              <span class="collector-passport__badge-progress-label">${escapeHtml(progressLine || `${barWidth} %`)}</span>
            </div>
          ` : (progressLine ? `<p class="collector-passport__badge-meta">${escapeHtml(progressLine)}</p>` : "")}
          ${(showVerify || pinBtn) ? `
          <div class="collector-passport__badge-foot">
            ${showVerify ? `<small class="collector-passport__badge-verify">${t("account.badge.verificationPrefix")}${escapeHtml(verifyRaw)}</small>` : ""}
            ${pinBtn}
          </div>` : ""}
        </div>
      </article>`;
    };

    const badgesByCategory = BADGE_UI_ORDER.map((cat) => ({
      cat,
      label: passportBadgeCategoryLabel(cat),
      items: badges.filter((b) => (b.uiCategory || "progression") === cat)
    })).filter((group) => group.items.length);

    return `
      <section class="collector-passport__section collector-passport__section--identity" aria-labelledby="passport-identity-heading">
        <h4 id="passport-identity-heading">${t("account.passport.identity")}</h4>
        <div class="collector-passport__identity">
          ${passportAvatarHtml(avatarUrl, username || displayName)}
          <div class="collector-passport__identity-text">
            <p class="collector-passport__username">${escapeHtml(username || "—")}</p>
            ${displayName && displayName !== username ? `<p class="collector-passport__displayname">${escapeHtml(displayName)}</p>` : ""}
            <p class="collector-passport__since">${escapeHtml(sinceExact)}${sinceDuration && createdAt ? `<br><small>${escapeHtml(sinceDuration)}</small>` : ""}</p>
            <p class="collector-passport__identity-meta">${t("account.passport.mainSquadLabel", { name: escapeHtml(primarySquadLine) })}${isSelf && !(primarySquad && primarySquad.name) && !(primarySquad && primarySquad.private) ? ` <button type="button" class="ghost-button collector-passport__choose-squad" data-passport-action="choose-squad">${t("account.passport.chooseSquadShort")}</button>` : ""}</p>
            <p class="collector-passport__identity-meta">${t("account.passport.featuredBadgeLabel", { label: escapeHtml((featuredBadge && featuredBadge.label) || t("account.passport.noneM")) })}</p>
            <button type="button" class="collector-passport__compare-btn" ${compareAction}>${escapeHtml(compareLabel)}</button>
          </div>
        </div>
      </section>

      ${statsHidden ? `<p class="collector-passport__empty" role="status">${t("account.passport.statsHidden")}</p>` : `
      <section class="collector-passport__section collector-passport__section--progress" aria-labelledby="passport-progress-heading">
        <h4 id="passport-progress-heading">${t("account.passport.progress")}</h4>
        <div class="collector-passport__grid collector-passport__grid--progress">
          <div><strong>${discovered} / ${releasedSprites}</strong><span>${t("account.passport.spritesDiscovered")}</span></div>
          <div><strong>${owned} / ${released}</strong><span>${t("account.passport.variantsOwned")}</span></div>
          <div><strong>${formatUiPercent(displayRate, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}</strong><span>${t("account.passport.completion")}</span></div>
        </div>
        <div class="collector-passport__progress">
          <div class="collector-passport__progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(String(barWidth))}" aria-valuetext="${escapeHtml(formatCollectionProgressText(owned, released, displayRate))}" aria-describedby="passport-progress-text">
            <div class="collector-passport__progress-fill" style="width:${barWidth}%"></div>
          </div>
          <p id="passport-progress-text" class="collector-passport__progress-text">${escapeHtml(formatCollectionProgressText(owned, released, displayRate))}</p>
          ${showPeak ? `<p class="collector-passport__progress-peak">${t("account.passport.peakRecord", { peak: formatUiNumber(Number(peak.completionRateDisplay), { minimumFractionDigits: 0, maximumFractionDigits: 1 }), current: formatUiNumber(displayRate, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) })}</p>` : `<p class="collector-passport__progress-peak">${t("account.passport.currentRate", { current: formatUiNumber(displayRate, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) })}</p>`}
          ${nextStep ? `<p class="collector-passport__progress-next">${escapeHtml(nextStep.label)}</p>` : ""}
          <p class="collector-passport__progress-meta">${t("account.passport.lastUpdate", { date: escapeHtml(passportRelativeUpdate(c.lastUpdatedAt)), quality: escapeHtml(qualityLabel), rate: safePercentage(reliability.rate, 0) })}</p>
        </div>
        ${reliabilityWarning}
      </section>

      <details class="collector-passport__section collector-passport__disclosure collector-passport__section--collection">
        <summary aria-labelledby="passport-collection-heading">
          <span><strong id="passport-collection-heading">${t("account.passport.collection")}</strong><small>${t("account.passport.collectionSummary")}</small></span>
          <span class="collector-passport__disclosure-icon" aria-hidden="true"></span>
        </summary>
        <div class="collector-passport__disclosure-body">
          <div class="collector-passport__breakdown">
          <h5>${t("account.passport.rarities")}</h5>
          <ul class="collector-passport__filter-list">${rarityBreakdown.length ? rarityBreakdown.map((row) => `
            <li><button type="button" class="collector-passport__filter-row" data-passport-action="open-filter" data-filter="${escapeHtml(row.filter)}">
              <span>${escapeHtml(row.label)}</span>
              <strong>${safeFiniteNumber(row.ownedCount, 0, { min: 0, max: 1000000 })} ${t("account.passport.variantsSuffix")}</strong>
            </button></li>`).join("") : `<li><em>${t("account.passport.noRarities")}</em></li>`}</ul>
          <h5>${t("account.passport.variantTypes")}</h5>
          <ul class="collector-passport__filter-list">${variantTypeBreakdown.length ? variantTypeBreakdown.map((row) => `
            <li><button type="button" class="collector-passport__filter-row" data-passport-action="open-filter" data-filter="${escapeHtml(row.filter)}">
              <span>${escapeHtml(row.label)}</span>
              <strong>${safeFiniteNumber(row.ownedCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(row.releasedCount, 0, { min: 0, max: 1000000 })}</strong>
            </button></li>`).join("") : `<li><em>${t("account.passport.noTypes")}</em></li>`}</ul>
          </div>
          <dl class="collector-passport__details">
          <div><dt>${t("account.passport.highestRarity")}</dt><dd>${escapeHtml(rarityLabel)}${rarityCount ? `<br><small>${escapeHtml(rarityCount)}</small>` : ""}</dd></div>
          <div><dt>${t("account.passport.rarestSpecial")}</dt><dd>${escapeHtml((specialVariant && specialVariant.label) || t("account.passport.noneF"))}</dd></div>
          <div><dt>${t("account.passport.mainSquad")}</dt><dd>${primarySquadHtml}</dd></div>
          <div><dt>${t("account.passport.socialActivity")}</dt><dd>${t("squad.friendCount", { count: safeFiniteNumber(social.friendCount, 0, { min: 0, max: 1000000 }), s: safeFiniteNumber(social.friendCount, 0, { min: 0, max: 1000000 }) === 1 ? "" : "s" })} · ${t("account.passport.squadCount", { count: safeFiniteNumber(social.squadCount, 0, { min: 0, max: 1000000 }), s: safeFiniteNumber(social.squadCount, 0, { min: 0, max: 1000000 }) === 1 ? "" : "s" })}</dd></div>
          <div><dt>${t("account.passport.comparisons")}</dt><dd>${comparisonsHtml}</dd></div>
          <div><dt>${t("account.passport.reliability")}</dt><dd>${formatUiPercent(reliability.rate, { maximumFractionDigits: 0 })} (${safeFiniteNumber(reliability.explicitVariantCount, 0, { min: 0, max: 1000000 })}/${safeFiniteNumber(reliability.totalVariantCount, 0, { min: 0, max: 1000000 })})</dd></div>
          </dl>
          <p class="collector-passport__footnote">${released === 1 ? t("account.passport.footnoteOne") : t("account.passport.footnoteMany", { count: released })}${c.catalogueVersion || cat.version ? ` · catalogue ${escapeHtml(c.catalogueVersion || cat.version)}` : ""}.</p>
          <p class="collector-passport__disclaimer">${t("account.passport.userDeclared")}</p>
        </div>
      </details>

      <details class="collector-passport__section collector-passport__disclosure collector-passport__section--events"${inProgressEvents.length ? " open" : ""}>
        <summary aria-labelledby="passport-events-heading">
          <span><strong id="passport-events-heading">${t("account.passport.events")}</strong><small>${t("account.passport.eventsSummary", { count: completedEventCount })}</small></span>
          <span class="collector-passport__disclosure-icon" aria-hidden="true"></span>
        </summary>
        <div class="collector-passport__disclosure-body">
          <p class="collector-passport__events-summary">${completedEventCount === 1 ? `<strong>1</strong> ${t("account.passport.eventsCompletedOne").replace("1 ", "")}` : `<strong>${completedEventCount}</strong> ${t("account.passport.eventsCompletedMany", { count: completedEventCount }).replace(`${completedEventCount} `, "")}`}</p>
          <div class="collector-passport__block">
          <h5>${t("account.passport.recentlyCompleted")}</h5>
          <ul class="collector-passport__events">${recentlyCompleted.length ? recentlyCompleted.map((ev) => renderEventItem(ev, "completed")).join("") : `<li><em>${t("account.passport.noRecentEvents")}</em></li>`}</ul>
          </div>
          <div class="collector-passport__block">
          <h5>${t("account.passport.inProgress", { count: inProgressEvents.length })}</h5>
          <ul class="collector-passport__events">${inProgressEvents.length ? inProgressEvents.map((ev) => renderEventItem(ev, "progress")).join("") : `<li><em>${t("account.passport.noEventsInProgress")}</em></li>`}</ul>
          </div>
          <div class="collector-passport__block">
          <h5>${t("account.passport.historical", { count: historicalEvents.length })}</h5>
          <ul class="collector-passport__events">${historicalEvents.length ? historicalEvents.map((ev) => renderEventItem(ev, "historical")).join("") : `<li><em>${t("account.passport.noHistoricalEvents")}</em></li>`}</ul>
          </div>
        </div>
      </details>`}

      <section class="collector-passport__section collector-passport__section--badges" aria-labelledby="passport-badges-heading">
        <h4 id="passport-badges-heading">${t("account.passport.badgesCount", { count: unlockedBadges.length })}</h4>
        <div class="collector-passport__badge-filters" role="toolbar" aria-label="${t("account.passport.badgeFiltersLabel")}">
          ${[
            ["unlocked", t("account.badge.filterUnlocked")],
            ["all", t("account.badge.filterAll")],
            ["locked", t("account.badge.filterLocked")],
            ["progression", passportBadgeCategoryLabel("progression")],
            ["social", passportBadgeCategoryLabel("social")],
            ["events", passportBadgeCategoryLabel("events")]
          ].map(([value, label], i) =>
            `<button type="button" class="collector-passport__badge-filter${i === 0 ? " is-active" : ""}" data-passport-action="badge-filter" data-badge-filter="${value}" aria-pressed="${i === 0 ? "true" : "false"}">${label}</button>`
          ).join("")}
        </div>
        <div class="collector-passport__badge-grid" role="list" data-badge-grid>
          ${badgesByCategory.length ? badgesByCategory.map((group) => `
            <div class="collector-passport__badge-group" data-badge-group="${escapeHtml(group.cat)}"${group.items.some((badge) => !badge.status || badge.status === "unlocked") ? "" : " hidden"}>
              <h5>${escapeHtml(group.label)}</h5>
              <div class="collector-passport__badge-cards" role="presentation">${group.items.map(renderBadgeCard).join("")}</div>
            </div>`).join("") : `<em>${t("account.passport.noBadges")}</em>`}
        </div>
      </section>

      <details class="collector-passport__section collector-passport__disclosure collector-passport__section--activity">
        <summary aria-labelledby="passport-activity-heading">
          <span><strong id="passport-activity-heading">${t("account.passport.recentActivity")}</strong><small>${t("account.passport.activitySummary")}</small></span>
          <span class="collector-passport__disclosure-icon" aria-hidden="true"></span>
        </summary>
        <div class="collector-passport__disclosure-body">
          ${activityGroups.length ? activityGroups.map((group) => `
          <div class="collector-passport__activity-day">
            <h5>${escapeHtml(group.label)}</h5>
            <ul class="collector-passport__activity">${group.items.map((a) =>
              `<li><span>${escapeHtml(passportActivityLabel(a))}</span></li>`
            ).join("")}</ul>
          </div>`).join("") : `<p class="collector-passport__empty" role="status">${t("account.passport.noRecentActivity")}</p>`}
        </div>
      </details>
    `;
  }

  function wirePassportActions(actionsEl, data, { isSelf }) {
    if (!actionsEl) return;
    const actions = Array.isArray(data.actions) && data.actions.length
      ? data.actions
      : (isSelf
        ? ["edit_profile", "manage_privacy", "choose_primary_squad", "pin_badge", "share_passport", "update_collection"]
        : []);
    const labels = {
      edit_profile: t("account.action.editProfile"),
      manage_privacy: t("account.action.managePrivacy"),
      choose_primary_squad: t("account.action.chooseSquad"),
      pin_badge: t("account.action.pinBadge"),
      share_passport: t("account.action.sharePassport"),
      update_collection: t("account.action.updateCollection"),
      compare_collections: t("account.action.compareCollections"),
      invite_to_squad: t("account.action.inviteToSquad"),
      create_shared_goal: t("account.action.createGoal"),
      view_public_collection: t("account.action.viewPublicCollection"),
      add_friend: t("account.action.addFriend")
    };
    actionsEl.innerHTML = actions
      .filter((key) => labels[key])
      .map((key) => `<button type="button" class="ghost-button" data-passport-action="${escapeHtml(key)}">${labels[key]}</button>`)
      .join("");

    const ownerId = data.user && data.user.id;
    const ownerName = (data.user && (data.user.displayName || data.user.username)) || t("account.player");
    const username = data.user && data.user.username;

    actionsEl.querySelectorAll("[data-passport-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.passportAction;
        if (action === "edit_profile") {
          openAccount();
          document.getElementById("accountEditUsernameBtn")?.click();
          return;
        }
        if (action === "manage_privacy") {
          openAccount();
          const privacy = document.getElementById("accountPrivacy");
          const settings = document.querySelector("#collectorPassportContent .collector-passport__settings");
          if (settings) {
            settings.open = true;
            settings.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          privacy?.focus();
          return;
        }
        if (action === "choose_primary_squad") {
          const content = document.getElementById("collectorPassportContent")
            || document.getElementById("passportDialogContent");
          content?.querySelector('[data-passport-action="choose-squad"]')?.click();
          if (content) {
            const details = content.querySelector(".collector-passport__settings");
            if (details) {
              details.open = true;
              details.querySelector('[data-passport-setting="primarySquadId"]')?.focus();
            }
          }
          return;
        }
        if (action === "pin_badge") {
          const content = document.getElementById("collectorPassportContent")
            || document.getElementById("passportDialogContent");
          const pinBtn = content?.querySelector('[data-passport-action="pin-badge"]');
          if (pinBtn) {
            pinBtn.scrollIntoView({ behavior: "smooth", block: "center" });
            pinBtn.focus();
            toast(t("account.pinBadgePrompt"));
          } else {
            toast(t("account.noBadgeToPin"));
          }
          return;
        }
        if (action === "share_passport") {
          logPassportAnalytics("passport_shared", { source: "share_action" });
          openPassportSharePreview(data);
          return;
        }
        if (action === "update_collection") {
          closeAccount();
          document.getElementById("passportDialog")?.close?.();
          document.getElementById("accountGoCollection")?.click();
          return;
        }
        if (action === "compare_collections") {
          document.getElementById("passportDialog")?.close?.();
          closeAccount();
          logPassportAnalytics("passport_comparison_started", {
            source: "passport_action",
            targetId: ownerId != null ? String(ownerId) : null
          });
          if (typeof compareWithFriend === "function" && ownerId) {
            await compareWithFriend(ownerId, ownerName, { source: "passport" });
          }
          return;
        }
        if (action === "invite_to_squad") {
          document.getElementById("passportDialog")?.close?.();
          if (typeof openSquadInviteDialog === "function" && ownerId) {
            await openSquadInviteDialog(ownerId, ownerName);
          } else {
            toast(t("account.inviteNeedSquad"));
          }
          return;
        }
        if (action === "create_shared_goal") {
          document.getElementById("passportDialog")?.close?.();
          closeAccount();
          if (typeof activateMainView === "function") activateMainView("social");
          if (typeof setSocialTab === "function") setSocialTab("squad");
          toast(t("account.createGoalInSquad"));
          return;
        }
        if (action === "view_public_collection") {
          document.getElementById("passportDialog")?.close?.();
          if (username) {
            location.href = `${webOrigin()}/u/${encodeURIComponent(username)}`;
          } else if (data.publicUrl) {
            location.href = `${webOrigin()}${data.publicUrl}`;
          }
          return;
        }
        if (action === "add_friend") {
          if (!state.userId) {
            toast(t("account.loginToAddFriend"));
            return;
          }
          if (typeof sendFriendRequest === "function" && ownerId) {
            await sendFriendRequest(ownerId);
          }
        }
      });
    });
  }

  function passportShareDefaults(card) {
    const avail = (card && card.availableFields) || {};
    return {
      showSquad: avail.squad !== false && !!card.primarySquadName,
      showBadges: avail.badges !== false && !!card.featuredBadgeLabel,
      showJoinedAt: avail.joinedAt !== false && !!card.joinedAt,
      showCompletion: avail.completion !== false,
      showEvents: avail.events !== false && card.completedEventCount != null,
      includeInvite: false
    };
  }

  function formatPassportJoinDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(uiLocale(), { day: "numeric", month: "long", year: "numeric" });
  }

  function buildPassportCardLines(card, opts) {
    const lines = [];
    const name = card.displayName || card.username || "";
    lines.push({ kind: "title", text: name });
    if (card.username && card.displayName && card.username !== card.displayName) {
      lines.push({ kind: "sub", text: `@${card.username}` });
    }
    if (opts.showCompletion && card.completionRateDisplay != null) {
      const rate = formatUiNumber(card.completionRateDisplay, { maximumFractionDigits: 1 });
      lines.push({ kind: "stat", text: t("account.share.completionRate", { rate }) });
    }
    if (opts.showCompletion && card.ownedVariantCount != null && card.releasedVariantCount != null) {
      lines.push({ kind: "stat", text: t("account.share.variantsOf", { owned: card.ownedVariantCount, total: card.releasedVariantCount }) });
    }
    if (opts.showEvents && card.completedEventCount != null) {
      const n = Number(card.completedEventCount) || 0;
      lines.push({ kind: "stat", text: n === 1 ? t("account.passport.eventsShareOne") : t("account.passport.eventsShareMany", { count: n }) });
    }
    if (opts.showBadges && card.featuredBadgeLabel) {
      lines.push({ kind: "meta", text: t("account.share.badge", { label: card.featuredBadgeLabel }) });
    }
    if (opts.showSquad && card.primarySquadName) {
      lines.push({ kind: "meta", text: t("account.share.squad", { name: card.primarySquadName }) });
    }
    if (opts.showJoinedAt && card.joinedAt) {
      lines.push({ kind: "meta", text: t("account.share.joinedOn", { date: formatPassportJoinDate(card.joinedAt) }) });
    }
    if (opts.includeInvite) {
      lines.push({ kind: "meta", text: t("passport.shareInviteCardLine") });
    }
    return lines;
  }

  function renderPassportSharePreviewBody(card, opts) {
    const lines = buildPassportCardLines(card, opts);
    const shareTarget = opts.includeInvite
      ? t("passport.shareInvitePreviewUrl")
      : ((card.publicUrl && `${webOrigin()}${card.publicUrl}`) || "");
    return `
      <ul class="passport-share-preview__list">
        ${lines.map((l) => `<li class="passport-share-preview__${escapeHtml(l.kind)}">${escapeHtml(l.text)}</li>`).join("")}
      </ul>
      <p class="passport-share-preview__url">${escapeHtml(shareTarget)}</p>
      <p class="passport-share-preview__note">${t("account.passportShareNote")}</p>
    `;
  }

  async function fetchPassportCardPayload(username) {
    const res = await fetch(`${API_BASE}/u/${encodeURIComponent(username)}/passport/card`, {
      headers: authHeadersOnly()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t("account.cardUnavailable"));
    return data;
  }

  let passportSharePreviewUrl = "";

  function resetPassportShareResult() {
    const result = document.getElementById("passportShareResult");
    const image = document.getElementById("passportShareResultImage");
    if (passportSharePreviewUrl) URL.revokeObjectURL(passportSharePreviewUrl);
    passportSharePreviewUrl = "";
    if (image) image.removeAttribute("src");
    if (result) result.hidden = true;
  }

  function showPassportShareResult(result) {
    const root = document.getElementById("passportShareResult");
    const image = document.getElementById("passportShareResultImage");
    const download = document.getElementById("passportShareDownload");
    const copy = document.getElementById("passportShareCopyLink");
    const nativeShare = document.getElementById("passportShareNative");
    if (!root || !image || !result) return;

    resetPassportShareResult();
    passportSharePreviewUrl = URL.createObjectURL(result.blob);
    image.src = passportSharePreviewUrl;
    image.alt = t("passport.shareReadyTitle");
    root.hidden = false;

    if (download) {
      download.onclick = () => {
        const url = URL.createObjectURL(result.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      };
    }
    if (copy) {
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(result.shareUrl);
          toast(t("passport.shareLinkCopied"));
        } catch (_) {
          toast(result.shareUrl);
        }
      };
    }
    const nativeSupported = !!(navigator.canShare && navigator.canShare({ files: [result.file] }));
    if (nativeShare) {
      nativeShare.hidden = !nativeSupported;
      nativeShare.onclick = nativeSupported ? async () => {
        try {
          await navigator.share({
            title: result.title,
            text: result.text,
            url: result.shareUrl,
            files: [result.file]
          });
        } catch (err) {
          if (err?.name !== "AbortError") toastError(err, "account.cantGenerateCard");
        }
      } : null;
    }
  }

  function openPassportSharePreview(passportData) {
    const username = passportData.user && passportData.user.username;
    if (!username) {
      toast(t("account.missingUsername"));
      return;
    }
    const dialog = document.getElementById("passportShareDialog");
    const preview = document.getElementById("passportSharePreview");
    const generateBtn = document.getElementById("passportShareGenerate");
    if (!dialog || !preview) return;

    resetPassportShareResult();
    preview.innerHTML = `<p class="collector-passport__empty">${t("account.sharePreviewLoading")}</p>`;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    fetchPassportCardPayload(username).then((card) => {
      const opts = passportShareDefaults(card);
      let invitation = null;
      const sync = () => {
        opts.showSquad = !!document.getElementById("passportShareOptSquad")?.checked;
        opts.showBadges = !!document.getElementById("passportShareOptBadges")?.checked;
        opts.showJoinedAt = !!document.getElementById("passportShareOptJoined")?.checked;
        opts.showCompletion = !!document.getElementById("passportShareOptCompletion")?.checked;
        opts.showEvents = !!document.getElementById("passportShareOptEvents")?.checked;
        opts.includeInvite = !!document.getElementById("passportShareOptInvite")?.checked;
        preview.innerHTML = renderPassportSharePreviewBody(card, opts);
      };
      const squadEl = document.getElementById("passportShareOptSquad");
      const badgesEl = document.getElementById("passportShareOptBadges");
      const joinedEl = document.getElementById("passportShareOptJoined");
      const completionEl = document.getElementById("passportShareOptCompletion");
      const eventsEl = document.getElementById("passportShareOptEvents");
      const inviteEl = document.getElementById("passportShareOptInvite");
      if (squadEl) {
        squadEl.checked = opts.showSquad;
        squadEl.disabled = !card.primarySquadName;
      }
      if (badgesEl) {
        badgesEl.checked = opts.showBadges;
        badgesEl.disabled = !card.featuredBadgeLabel;
      }
      if (joinedEl) {
        joinedEl.checked = opts.showJoinedAt;
        joinedEl.disabled = !card.joinedAt;
      }
      if (completionEl) completionEl.checked = opts.showCompletion;
      if (eventsEl) {
        eventsEl.checked = opts.showEvents;
        eventsEl.disabled = card.completedEventCount == null;
      }
      if (inviteEl) inviteEl.checked = false;
      ["passportShareOptSquad", "passportShareOptBadges", "passportShareOptJoined", "passportShareOptCompletion", "passportShareOptEvents", "passportShareOptInvite"]
        .forEach((id) => document.getElementById(id)?.addEventListener("change", sync));
      sync();

      if (generateBtn) {
        generateBtn.onclick = async () => {
          sync();
          const format = document.getElementById("passportShareFormat")?.value || "1080x1080";
          const originalLabel = generateBtn.textContent;
          generateBtn.disabled = true;
          generateBtn.textContent = t("passport.shareGenerating");
          try {
            if (opts.includeInvite && !invitation) invitation = await createPassportShareInvitation();
            const result = await generateAndSharePassportCard(card, opts, format, opts.includeInvite ? invitation : null);
            showPassportShareResult(result);
          } catch (err) {
            toastError(err, "account.cantGenerateCard");
          } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = originalLabel;
          }
        };
      }
    }).catch((err) => {
      preview.innerHTML = `<p class="collector-passport__empty">${escapeHtml(err.message ? t(err.message) : t("account.sharePreviewUnavailable"))}</p>`;
    });
  }

  function passportCardSize(format) {
    if (format === "1080x1920") return { w: 1080, h: 1920 };
    if (format === "1200x630") return { w: 1200, h: 630 };
    return { w: 1080, h: 1080 };
  }

  async function createPassportShareInvitation() {
    const res = await fetch(`${API_BASE}/friends/invite-links`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ duration: "permanent" })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error || t("passport.shareInviteFailed"));
    return { token: String(data.token) };
  }

  function passportShareUrl(card, invitation) {
    const base = new URL(card.publicUrl || "/", webOrigin());
    if (invitation?.token) base.searchParams.set("invite", invitation.token);
    return base.toString();
  }

  async function generateAndSharePassportCard(card, opts, format, invitation = null) {
    try {
      await fetch(`${API_BASE}/passport/share-card`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          format,
          showSquad: !!opts.showSquad,
          showBadges: !!opts.showBadges,
          showJoinedAt: !!opts.showJoinedAt,
          showCompletion: opts.showCompletion !== false,
          showEvents: !!opts.showEvents,
          includesInvitation: !!invitation
        })
      });
    } catch (_) {}

    const shareUrl = passportShareUrl(card, invitation);
    const { w, h } = passportCardSize(format);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");

    const s = w / 1080;
    const isWide = h / w < 0.78;
    const isTall = h / w > 1.35;
    const px = (value) => Math.round(value * s);
    const roundRect = (x, y, width, height, radius) => {
      const r = Math.min(radius, width / 2, height / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + width, y, x + width, y + height, r);
      ctx.arcTo(x + width, y + height, x, y + height, r);
      ctx.arcTo(x, y + height, x, y, r);
      ctx.arcTo(x, y, x + width, y, r);
      ctx.closePath();
    };
    const ellipsis = (value, maxWidth) => {
      const text = String(value || "");
      if (ctx.measureText(text).width <= maxWidth) return text;
      let out = text;
      while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
      return `${out}…`;
    };
    const panel = (x, y, width, height, fill, stroke = "rgba(186,224,255,0.14)") => {
      roundRect(x, y, width, height, px(24));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = px(1);
      ctx.stroke();
    };
    const line = (x1, y1, x2, y2, color, width = 1) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color;
      ctx.lineWidth = px(width);
      ctx.stroke();
    };
    const spark = (cx, cy, radius, color, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius);
      ctx.quadraticCurveTo(cx + radius * 0.18, cy - radius * 0.18, cx + radius, cy);
      ctx.quadraticCurveTo(cx + radius * 0.18, cy + radius * 0.18, cx, cy + radius);
      ctx.quadraticCurveTo(cx - radius * 0.18, cy + radius * 0.18, cx - radius, cy);
      ctx.quadraticCurveTo(cx - radius * 0.18, cy - radius * 0.18, cx, cy - radius);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    };
    const hexagon = (cx, cy, radius, fill, stroke) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + i * Math.PI / 3;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = px(2); ctx.stroke(); }
    };
    const idIcon = (x, y, size, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = px(1.8);
      roundRect(x, y, size, size * 0.72, px(3)); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + size * 0.27, y + size * 0.28, size * 0.1, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + size * 0.27, y + size * 0.5, size * 0.16, Math.PI, 0); ctx.stroke();
      line(x + size * 0.53, y + size * 0.27, x + size * 0.78, y + size * 0.27, color, 1.4);
      line(x + size * 0.53, y + size * 0.47, x + size * 0.72, y + size * 0.47, color, 1.4);
    };
    const factIcon = (kind, x, y, size, color) => {
      const midX = x + size / 2;
      const midY = y + size / 2;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = px(2);
      if (kind === "badge") {
        hexagon(midX, midY, size * 0.28, "rgba(255,215,109,0.12)", color);
        spark(midX, midY, size * 0.15, color);
      } else if (kind === "events") {
        roundRect(x + size * 0.22, y + size * 0.22, size * 0.56, size * 0.56, px(4)); ctx.stroke();
        line(x + size * 0.22, y + size * 0.4, x + size * 0.78, y + size * 0.4, color, 1.8);
        line(x + size * 0.38, y + size * 0.57, x + size * 0.47, y + size * 0.65, color, 1.8);
        line(x + size * 0.47, y + size * 0.65, x + size * 0.66, y + size * 0.48, color, 1.8);
      } else if (kind === "member") {
        ctx.beginPath(); ctx.arc(midX, y + size * 0.38, size * 0.14, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(midX, y + size * 0.82, size * 0.27, Math.PI, 0); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(midX, midY, size * 0.2, 0, Math.PI * 2); ctx.stroke();
      }
    };

    const backdrop = ctx.createLinearGradient(0, 0, w, h);
    backdrop.addColorStop(0, "#050a1b");
    backdrop.addColorStop(0.52, "#111d46");
    backdrop.addColorStop(1, "#160d31");
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * 0.8, h * 0.13, 0, w * 0.8, h * 0.13, w * 0.7);
    glow.addColorStop(0, "rgba(85, 77, 255, 0.2)");
    glow.addColorStop(1, "rgba(0,225,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const inset = px(isWide ? 32 : 42);
    const cardX = inset;
    const cardY = inset;
    const cardW = w - inset * 2;
    const cardH = h - inset * 2;
    panel(cardX, cardY, cardW, cardH, "rgba(5, 13, 36, 0.82)", "rgba(80, 166, 255, 0.3)");

    // Sparse stars keep the card alive without competing with the information.
    [[0.21, 0.08, 2], [0.66, 0.04, 1.5], [0.9, 0.16, 2], [0.83, 0.42, 1.5], [0.12, 0.83, 1.5]].forEach(([rx, ry, r]) => {
      spark(cardX + cardW * rx, cardY + cardH * ry, px(r), "#5f8dff", 0.42);
    });

    const contentX = cardX + px(isWide ? 38 : 52);
    const contentW = cardW - px(isWide ? 76 : 104);
    let y = cardY + px(isWide ? 45 : 58);
    const brandSize = px(isWide ? 16 : 19);
    const nameSize = px(isWide ? 42 : 55);
    const markSize = px(isWide ? 15 : 18);
    hexagon(contentX + markSize, y - markSize * 0.35, markSize, "rgba(46, 108, 255, 0.24)", "#557eff");
    spark(contentX + markSize, y - markSize * 0.35, markSize * 0.48, "#d9faff");
    ctx.font = `800 ${brandSize}px system-ui, sans-serif`;
    const brandX = contentX + markSize * 2 + px(10);
    const brandPrefix = "SPRITE-INDEX";
    ctx.fillStyle = "#42e9ff";
    ctx.fillText(brandPrefix, brandX, y);
    const prefixWidth = ctx.measureText(brandPrefix).width;
    ctx.fillStyle = "#c8d5ff";
    ctx.fillText(" · ", brandX + prefixWidth, y);
    ctx.fillStyle = "#ae83ff";
    ctx.fillText("PASSEPORT", brandX + prefixWidth + ctx.measureText(" · ").width, y);
    const status = invitation ? t("passport.cardInvite") : t("passport.cardPublic");
    ctx.font = `700 ${px(isWide ? 14 : 16)}px system-ui, sans-serif`;
    const statusW = ctx.measureText(status).width + px(52);
    const statusX = contentX + contentW - statusW;
    panel(statusX, y - px(25), statusW, px(34), invitation ? "rgba(100, 238, 190, 0.13)" : "rgba(126, 102, 255, 0.15)", invitation ? "rgba(100, 238, 190, 0.35)" : "rgba(162, 143, 255, 0.5)");
    ctx.fillStyle = invitation ? "#a3ffe2" : "#cdc4ff";
    idIcon(statusX + px(12), y - px(16), px(19), ctx.fillStyle);
    ctx.fillText(status, statusX + px(39), y - px(1));

    y += px(isWide ? 49 : 61);
    const name = card.displayName || card.username || "SPRITE-INDEX";
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 ${nameSize}px system-ui, sans-serif`;
    ctx.fillText(ellipsis(name, contentW), contentX, y);
    if (card.username && card.username !== name) {
      y += px(isWide ? 27 : 31);
      ctx.fillStyle = "rgba(216, 231, 255, 0.65)";
      ctx.font = `600 ${px(isWide ? 17 : 20)}px system-ui, sans-serif`;
      ctx.fillText(ellipsis(`@${card.username}`, contentW), contentX, y);
    }

    const progressY = y + px(isWide ? 25 : 32);
    const progressH = px(isWide ? 158 : (isTall ? 274 : 232));
    const progressBg = ctx.createLinearGradient(contentX, progressY, contentX + contentW, progressY + progressH);
    progressBg.addColorStop(0, "rgba(12, 61, 121, 0.96)");
    progressBg.addColorStop(0.55, "rgba(16, 43, 104, 0.95)");
    progressBg.addColorStop(1, "rgba(48, 20, 112, 0.96)");
    panel(contentX, progressY, contentW, progressH, progressBg, "rgba(104, 216, 255, 0.72)");

    const emblemX = contentX + px(isWide ? 62 : 94);
    const emblemY = progressY + px(isWide ? 65 : 91);
    const emblemR = px(isWide ? 32 : 48);
    const emblemGlow = ctx.createRadialGradient(emblemX, emblemY, 0, emblemX, emblemY, emblemR * 1.8);
    emblemGlow.addColorStop(0, "rgba(44, 234, 255, 0.35)"); emblemGlow.addColorStop(1, "rgba(44, 234, 255, 0)");
    ctx.fillStyle = emblemGlow; ctx.fillRect(emblemX - emblemR * 2, emblemY - emblemR * 2, emblemR * 4, emblemR * 4);
    hexagon(emblemX, emblemY, emblemR, "rgba(6, 40, 98, 0.7)", "#5ad9ff");
    hexagon(emblemX, emblemY, emblemR * 0.78, null, "rgba(119, 137, 255, 0.65)");
    spark(emblemX, emblemY, emblemR * 0.62, "#dcffff");
    const dividerX = contentX + px(isWide ? 126 : 182);
    line(dividerX, progressY + px(isWide ? 27 : 44), dividerX, progressY + progressH - px(isWide ? 42 : 60), "rgba(109, 208, 255, 0.42)", 1);

    const rate = Number(card.completionRateDisplay);
    const safeRate = Number.isFinite(rate) ? Math.max(0, Math.min(100, rate)) : 0;
    const statsX = dividerX + px(isWide ? 25 : 42);
    ctx.fillStyle = "#f8fcff";
    ctx.font = `800 ${px(isWide ? 52 : 76)}px system-ui, sans-serif`;
    ctx.fillText(opts.showCompletion ? formatUiPercent(safeRate, { maximumFractionDigits: 1 }) : "—", statsX, progressY + px(isWide ? 70 : 96));
    ctx.fillStyle = "#58d8ff";
    ctx.font = `800 ${px(isWide ? 14 : 19)}px system-ui, sans-serif`;
    ctx.fillText(t("passport.cardCollection"), statsX, progressY + px(isWide ? 96 : 127));
    if (opts.showCompletion && card.ownedVariantCount != null && card.releasedVariantCount != null) {
      ctx.fillStyle = "rgba(233, 247, 255, 0.82)";
      ctx.font = `600 ${px(isWide ? 15 : 19)}px system-ui, sans-serif`;
      ctx.fillText(t("account.share.variantsOf", { owned: card.ownedVariantCount, total: card.releasedVariantCount }), statsX, progressY + px(isWide ? 120 : 164));
    }
    const orbitX = contentX + contentW - px(isWide ? 88 : 143);
    const orbitY = progressY + progressH * 0.46;
    ctx.save(); ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "#7756ff"; ctx.lineWidth = px(1);
    [px(isWide ? 28 : 50), px(isWide ? 46 : 78)].forEach((radius) => { ctx.beginPath(); ctx.arc(orbitX, orbitY, radius, 0, Math.PI * 2); ctx.stroke(); });
    ctx.beginPath(); ctx.ellipse(orbitX, orbitY, px(isWide ? 58 : 100), px(isWide ? 19 : 34), -0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    spark(orbitX, orbitY, px(isWide ? 15 : 25), "#8d70ff", 0.7);
    ctx.fillStyle = "#346ddc"; ctx.beginPath(); ctx.arc(orbitX - px(isWide ? 46 : 86), orbitY + px(isWide ? 9 : 15), px(5), 0, Math.PI * 2); ctx.fill();

    const barX = contentX + px(isWide ? 24 : 34);
    const barY = progressY + progressH - px(isWide ? 30 : 39);
    const barW = contentW - px(isWide ? 48 : 68);
    const barH = px(isWide ? 13 : 18);
    panel(barX, barY, barW, barH, "rgba(2, 10, 41, 0.56)", "rgba(170, 217, 255, 0.17)");
    if (opts.showCompletion && safeRate > 0) {
      const fillW = Math.max(barH, barW * (safeRate / 100));
      const fill = ctx.createLinearGradient(barX, barY, barX + fillW, barY);
      fill.addColorStop(0, "#00e1ff");
      fill.addColorStop(0.55, "#2586ff");
      fill.addColorStop(1, "#9a6dff");
      panel(barX, barY, fillW, barH, fill, "rgba(255,255,255,0)");
      const tipGlow = ctx.createRadialGradient(barX + fillW, barY + barH / 2, 0, barX + fillW, barY + barH / 2, barH * 1.5);
      tipGlow.addColorStop(0, "rgba(231, 207, 255, 0.9)"); tipGlow.addColorStop(1, "rgba(157, 110, 255, 0)");
      ctx.fillStyle = tipGlow; ctx.fillRect(barX + fillW - barH * 1.5, barY - barH, barH * 3, barH * 3);
    }

    const facts = [];
    if (opts.showBadges && card.featuredBadgeLabel) facts.push({ kind: "badge", label: t("passport.cardBadge"), value: card.featuredBadgeLabel, color: "#ffd560" });
    if (opts.showEvents && card.completedEventCount != null) facts.push({ kind: "events", label: t("passport.cardEvents"), value: String(card.completedEventCount), color: "#74ec9d" });
    if (opts.showJoinedAt && card.joinedAt) facts.push({ kind: "member", label: t("passport.cardMemberSince"), value: formatPassportJoinDate(card.joinedAt), color: "#af83ff" });
    if (opts.showSquad && card.primarySquadName) facts.push({ kind: "squad", label: t("passport.cardSquad"), value: card.primarySquadName, color: "#72dcff" });
    if (invitation) facts.push({ kind: "invite", label: t("passport.cardInvite"), value: t("passport.cardInviteValue"), color: "#8ff9e1" });

    const factsY = progressY + progressH + px(isWide ? 20 : 26);
    const maxFacts = isWide ? 4 : 5;
    const displayedFacts = facts.slice(0, maxFacts);
    const columns = isWide ? 2 : 1;
    const factGap = px(10);
    const factW = columns === 2 ? (contentW - factGap) / 2 : contentW;
    const factH = px(isWide ? 58 : 78);
    displayedFacts.forEach((fact, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = contentX + col * (factW + factGap);
      const fy = factsY + row * (factH + factGap);
      panel(x, fy, factW, factH, "rgba(11, 29, 69, 0.78)", "rgba(112, 167, 255, 0.22)");
      const iconSize = px(isWide ? 39 : 54);
      const iconX = x + px(isWide ? 9 : 14);
      const iconY = fy + (factH - iconSize) / 2;
      panel(iconX, iconY, iconSize, iconSize, "rgba(18, 41, 86, 0.86)", `${fact.color}66`);
      factIcon(fact.kind, iconX, iconY, iconSize, fact.color);
      const factDividerX = iconX + iconSize + px(isWide ? 11 : 18);
      line(factDividerX, fy + px(12), factDividerX, fy + factH - px(12), "rgba(115, 180, 255, 0.26)", 1);
      const factTextX = factDividerX + px(isWide ? 12 : 22);
      ctx.fillStyle = fact.color;
      ctx.font = `800 ${px(isWide ? 12 : 14)}px system-ui, sans-serif`;
      ctx.fillText(ellipsis(fact.label.toUpperCase(), factW - (factTextX - x) - px(42)), factTextX, fy + px(isWide ? 22 : 29));
      ctx.fillStyle = "rgba(248, 252, 255, 0.93)";
      ctx.font = `700 ${px(isWide ? 16 : 19)}px system-ui, sans-serif`;
      ctx.fillText(ellipsis(fact.value, factW - (factTextX - x) - px(42)), factTextX, fy + factH - px(isWide ? 15 : 18));
      spark(x + factW - px(isWide ? 19 : 34), fy + factH / 2, px(isWide ? 7 : 10), fact.color, 0.46);
    });

    const footerY = cardY + cardH - px(isWide ? 32 : 40);
    ctx.fillStyle = "rgba(211, 231, 255, 0.55)";
    ctx.font = `600 ${px(isWide ? 14 : 16)}px system-ui, sans-serif`;
    const footer = invitation ? t("passport.shareInviteCardFooter") : t("passport.cardFooter");
    ctx.fillText(ellipsis(footer, contentW), contentX, footerY);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("account.cardExportFailed")))), "image/png");
    });
    const fileName = `sprite-index-passeport-${card.username || "carte"}-${w}x${h}.png`;
    const file = new File([blob], fileName, { type: "image/png" });
    return {
      blob,
      file,
      fileName,
      shareUrl,
      title: t("passport.shareNativeTitle", { name: card.displayName || card.username }),
      text: invitation ? t("passport.shareNativeTextInvite") : t("passport.shareNativeText")
    };
  }

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
    if (!state.userId) { toast(t("account.loginFirst")); return; }
    let token;
    try {
      const res = await fetch(`${API_BASE}/profile/${state.userId}/share-link`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({})
      });
      if (!res.ok) { toast(t("account.shareLinkError")); return; }
      token = (await res.json()).token;
      const revokeBtn = document.getElementById("accountRevokeShare");
      if (revokeBtn) revokeBtn.style.display = "";
    } catch {
      toast(t("account.networkError"));
      return;
    }
    const url = `${webOrigin()}/?share=${token}`;
    if (navigator.share) {
      try { await navigator.share({ title: t("passport.shareNativeTitle", { name: state.username }), url }); } catch {}
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
    if (!state.userId) { toast(t("account.loginFirst")); return; }
    await fullSync();
    localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
    document.getElementById("accountLastSync").textContent =
      new Date().toLocaleString(uiLocale(), { dateStyle: "short", timeStyle: "short" });
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
}

async function openCollectorPassportByUsername(username, displayName = "") {
  if (!username) return;
  try {
    const res = await fetch(`${API_BASE}/u/${encodeURIComponent(username)}/passport`, {
      headers: typeof authHeadersOnly === "function" ? authHeadersOnly() : {}
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t("passport.notAccessible"));
    const userId = data.user && (data.user.numericId || data.user.id);
    const name = displayName || (data.user && (data.user.displayName || data.user.username)) || username;
    if (state.userId && userId && String(userId).match(/^\d+$/) && typeof window.openCollectorPassport === "function") {
      await window.openCollectorPassport(userId, name);
      return;
    }
    renderPublicPassportOverlay(data);
  } catch (err) {
    toastError(err, "passport.unavailable");
    renderPublicPassportError(err.message);
  }
}

function renderPublicPassportOverlay(normalized) {
  document.querySelector(".public-passport-view")?.remove();
  const u = normalized.user || {};
  const p = normalized.passport || {};
  const stats = p.statistics || {};
  const overlay = document.createElement("div");
  overlay.className = "shared-view public-passport-view";
  const rate = stats.completionRateDisplay != null
    ? stats.completionRateDisplay
    : (stats.completionRate != null ? Math.round(stats.completionRate * 10) / 10 : null);
  const squad = p.primarySquad && !p.primarySquad.private ? p.primarySquad.name : null;
  const badge = p.featuredBadge ? p.featuredBadge.label : null;
  const actions = Array.isArray(normalized.actions) ? normalized.actions : [];
  let invitationPending = false;
  try { invitationPending = !!sessionStorage.getItem("sprite-index_pending_friend_invite"); } catch (_) { /* storage unavailable */ }
  const actionLabels = {
    view_public_collection: t("account.action.viewPublicCollection"),
    add_friend: t("account.action.addFriend"),
    compare_collections: t("account.action.compareCollections")
  };
  overlay.innerHTML = `
    <div class="shared-view__card">
      <div class="shared-view__header">
        <div class="shared-view__id">
          <p class="collector-passport__eyebrow">sprite-index</p>
          <h1 class="shared-view__name">${escapeHtml(u.displayName || u.username || t("shared.defaultPlayer"))}</h1>
          <p class="shared-view__sub">@${escapeHtml(u.username || "")} · ${t("account.passport.publicPassport")}</p>
          <p class="collector-passport__disclaimer">${t("account.passport.userDeclared")}</p>
        </div>
      </div>
      <div class="shared-view__overall">
        <div class="shared-view__overall-top">
          <span class="shared-view__overall-pct">${rate != null ? `${escapeHtml(String(rate))} %` : "—"}</span>
          <span class="shared-view__overall-count">${
            stats.ownedVariantCount != null && stats.releasedVariantCount != null
              ? t("account.passport.variantCount", { owned: stats.ownedVariantCount, total: stats.releasedVariantCount })
              : ""
          }</span>
        </div>
      </div>
      <div class="shared-view__section">
        ${squad ? `<p>${t("account.passport.squadLine", { name: escapeHtml(squad) })}</p>` : ""}
        ${badge ? `<p>${t("account.passport.badgeLine", { label: escapeHtml(badge) })}</p>` : ""}
        ${stats.completedEventCount != null ? `<p>${Number(stats.completedEventCount) === 1 ? t("account.passport.eventsShareOne") : t("account.passport.eventsShareMany", { count: stats.completedEventCount })}</p>` : ""}
      </div>
      <div class="collector-passport__actions public-passport-view__actions">
        ${actions.filter((a) => actionLabels[a]).map((a) =>
          `<button type="button" class="ghost-button" data-public-passport-action="${escapeHtml(a)}">${actionLabels[a]}</button>`
        ).join("")}
      </div>
      ${invitationPending ? `<p class="public-passport-view__invite">${t("passport.publicInviteHint")}</p>` : ""}
      <a href="${webOrigin()}/" class="shared-view__cta">${invitationPending ? t("passport.publicInviteCta") : t("account.passport.openApp")}</a>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-public-passport-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.publicPassportAction;
      const id = u.numericId;
      if (action === "add_friend") {
        if (!state.userId) { toast(t("account.loginToAddFriend")); return; }
        if (typeof sendFriendRequest === "function" && id) await sendFriendRequest(id);
      } else if (action === "compare_collections") {
        if (!state.userId) { toast(t("account.loginToCompare")); return; }
        if (typeof compareWithFriend === "function" && id) {
          await compareWithFriend(id, u.displayName || u.username, { source: "passport" });
        }
      } else if (action === "view_public_collection") {
        toast(t("account.visibleViaPassport"));
      }
    });
  });
}

function renderPublicPassportError(message) {
  document.querySelector(".public-passport-view")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "shared-view public-passport-view";
  overlay.innerHTML = `
    <div class="shared-view__card shared-view__card--error">
      <h1 class="shared-view__name">${escapeHtml(t("passport.unavailable"))}</h1>
      <p class="shared-view__sub">${escapeHtml(message ? t(message) : t("passport.notAccessibleBody"))}</p>
      <a href="${webOrigin()}/" class="shared-view__cta">${t("account.passport.openApp")}</a>
    </div>`;
  document.body.appendChild(overlay);
}

window.openCollectorPassportByUsername = openCollectorPassportByUsername;
window.renderPublicPassportOverlay = renderPublicPassportOverlay;
window.renderPublicPassportError = renderPublicPassportError;

function getNotifPref(_key) {
  // Legacy helper — contextual prefs live on the server (Étape 49).
  return true;
}
