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
    const avatarUrl = localStorage.getItem("sprite-index_avatar") || "";
    renderAvatar(avatarDisplay, avatarUrl);

    // Stats
    const coll = state.collection || {};
    const entries = Object.values(coll);
    const ownedVariants = entries.filter(e => e.status === "owned").length;
    const totalVariants = SPRITES.reduce((sum, s) => sum + (Object.keys(s.variantDetails || {}).length || (Array.isArray(s.variants) ? s.variants.length : 1)), 0);
    const percent = totalVariants ? Math.round((ownedVariants / totalVariants) * 100) : 0;
    panel.style.setProperty("--account-progress", `${Math.min(100, Math.max(0, percent))}%`);

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
    privacyEl.value = localStorage.getItem("sprite-index_privacy") || "squad_only";

    // Étape 68 — community stats opt-in (optional; never required for essentials).
    loadCommunityStatsOptIn();

    // Last sync
    const lastSync = localStorage.getItem("sprite-index_last_sync");
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
      ring.setAttribute("aria-label", `Progression de la collection : ${rateLabel}`);
    }
    setAccountOverviewValue("accountOverviewPercent", rateLabel);
    setAccountOverviewValue("accountOverviewOwned", `${owned} / ${released}`);
    const remaining = Math.max(0, released - owned);
    setAccountOverviewValue("accountOverviewRemaining", released
      ? (isEnglish
        ? `${remaining} variant${remaining === 1 ? "" : "s"} left to discover`
        : `${remaining} variante${remaining === 1 ? "" : "s"} à découvrir`)
      : "Catalogue indisponible");

    const badges = Array.isArray(data?.badgeProgress) && data.badgeProgress.length
      ? data.badgeProgress
      : (Array.isArray(data?.badges) ? data.badges.map((badge) => ({ ...badge, status: "unlocked" })) : []);
    const unlockedBadges = badges.filter((badge) => !badge.status || badge.status === "unlocked");
    const primarySquad = data?.primarySquad;
    setAccountOverviewValue("accountHeroBadges", String(unlockedBadges.length));
    setAccountOverviewValue("accountHeroSquad", primarySquad?.name ? String(primarySquad.memberCount || 1) : "0");
    setAccountOverviewValue("accountHeroReliability", `${Math.round(Math.max(0, Math.min(100, Number(reliability.rate) || 0)))}%`);

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
        empty.textContent = "Aucun événement récent.";
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
      const preview = unlockedBadges.slice(0, 4);
      if (!preview.length) {
        const empty = document.createElement("p");
        empty.textContent = "Aucun badge débloqué.";
        badgePreview.append(empty);
      } else {
        preview.forEach((badge) => {
          const card = document.createElement("div");
          card.className = "account-badge-preview__item";
          card.dataset.badgeCategory = badge.uiCategory || "progression";
          card.title = badge.label || badge.badgeCode || "Badge";
          const icon = document.createElement("span");
          icon.textContent = String(badge.label || badge.badgeCode || "?").trim().slice(0, 1).toUpperCase();
          const label = document.createElement("small");
          label.textContent = badge.label || badge.badgeCode || "Badge";
          card.append(icon, label);
          badgePreview.append(card);
        });
      }
      if (unlockedBadges.length > 4) {
        const rest = document.createElement("span");
        rest.className = "account-badge-preview__more";
        rest.textContent = `+${unlockedBadges.length - 4}`;
        badgePreview.append(rest);
      }
    }

    const squadLabel = primarySquad?.name
      ? `${primarySquad.name} · ${Number(primarySquad.memberCount) || 1} membre${Number(primarySquad.memberCount) === 1 ? "" : "s"}`
      : "Aucune squad principale";
    document.getElementById("accountHeroSquad")?.setAttribute("title", squadLabel);
    document.getElementById("accountHeroBadges")?.setAttribute("title", `${unlockedBadges.length} badge(s) obtenu(s)`);
    document.getElementById("accountHeroReliability")?.setAttribute("title", `${Math.round(Math.max(0, Math.min(100, Number(reliability.rate) || 0)))} % de la collection renseignée`);
    document.getElementById("accountHeroVariants")?.setAttribute("title", `${owned} variantes possédées`);
    void social;
  }

  function refreshAccountQuickPreferences() {
    const value = (enabled) => enabled ? "Activé" : "Désactivé";
    setAccountOverviewValue("accountQuickPush", value(!!document.getElementById("notifChannelPush")?.checked));
    setAccountOverviewValue("accountQuickEmail", value(!!document.getElementById("notifChannelEmail")?.checked));
    setAccountOverviewValue("accountQuickFriends", value(!!document.querySelector('[data-notif-in-app="friend_request_accepted"]')?.checked));
  }

  function passportDate(value, fallback = "—", { withTime = true } = {}) {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return withTime
      ? date.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })
      : date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function passportRelativeUpdate(value) {
    if (!value) return "jamais";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const time = date.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" }).replace(":", " h ");
    if (sameDay) return `aujourd’hui à ${time}`;
    if (date.toDateString() === yesterday.toDateString()) return `hier à ${time}`;
    return passportDate(value);
  }

  function passportReliabilityLabel(reliability) {
    const level = reliability && reliability.level;
    if (level === "complete") return "Collection complète";
    if (level === "usable") return "Collection exploitable";
    return "Collection à compléter";
  }

  function passportSinceMonth(value) {
    if (!value) return "Date d’inscription masquée";
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return "—";
    const monthYear = start.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return `Collectionneur depuis ${monthYear}`;
  }

  function passportAvatarHtml(avatarUrl, username = "") {
    const url = typeof safeImageUrl === "function" ? safeImageUrl(avatarUrl) : "";
    const alt = username ? `Avatar de ${username}` : "Avatar du collectionneur";
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
      ? rate.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })
      : "—";
    return `Progression de la collection : ${o} variante${o === 1 ? "" : "s"} sur ${r}, soit ${rateStr} %.`;
  }

  function formatBadgeAccessibleName(badge) {
    if (typeof globalThis.PassportRender?.formatBadgeAccessibleName === "function") {
      return globalThis.PassportRender.formatBadgeAccessibleName(badge);
    }
    const label = badge.label || badge.badgeCode || "Badge";
    const unlocked = !badge.status || badge.status === "unlocked";
    return `Badge ${label}, ${unlocked ? "débloqué" : "verrouillé"}`;
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
    if (!value) return "Date d’inscription masquée";
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return "—";
    const now = new Date();
    let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
    if (now.getDate() < start.getDate()) months--;
    if (months < 1) return "Collectionneur depuis moins d’un mois";
    if (months < 12) return `Collectionneur depuis ${months} mois`;
    const years = Math.floor(months / 12);
    return `Collectionneur depuis ${years} an${years > 1 ? "s" : ""}`;
  }

  function passportActivityLabel(item) {
    const type = item.activityType || item.type;
    const data = item.data || {};
    switch (type) {
      case "variants_owned": {
        const count = Number(data.count) || 1;
        if (data.label || data.variantName) {
          return `${data.label || data.variantName} ajouté${count > 1 ? "s" : ""} à la collection.`;
        }
        return count > 1
          ? `A ajouté ${count} variantes à sa collection.`
          : "Variante ajoutée à la collection.";
      }
      case "badge_unlocked":
        return data.label ? `Badge ${data.label} débloqué.` : "Badge débloqué.";
      case "event_completed":
        return data.eventName ? `Événement complété : ${data.eventName}.` : "Événement complété.";
      case "squad_joined":
        return data.squadName ? `A rejoint la squad ${data.squadName}.` : "Squad rejointe.";
      case "squad_created":
        return data.squadName ? `A créé la squad ${data.squadName}.` : "Squad créée.";
      case "completion_milestone":
        return data.percent != null ? `Palier ${data.percent} % atteint.` : "Palier de complétion.";
      case "collective_goal_completed":
        return data.goalTitle
          ? `${data.squadName || "La squad"} a atteint un objectif : ${data.goalTitle}.`
          : (data.squadName
            ? `${data.squadName} a progressé collectivement.`
            : "Objectif collectif complété.");
      case "account_created":
        return "Inscription à sprite-index.";
      default:
        return type || "Activité";
    }
  }

  function passportActivityDayLabel(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((startToday - startThat) / 86400000);
    if (diffDays === 0) return "Aujourd’hui";
    if (diffDays === 1) return "Hier";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: startThat.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
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
      declared: "Déclaré",
      system_confirmed: "Confirmé système",
      community_verified: "Vérifié communauté",
      officially_verified: "Vérifié officiel"
    };
    return map[status] || status || "—";
  }

  function passportBadgeCategoryLabel(cat) {
    return ({
      progression: "Progression",
      social: "Social",
      squads: "Squads",
      events: "Événements",
      historique: "Historique"
    })[cat] || "Progression";
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
    if (ids.length) toast(`${ids.length} variante${ids.length > 1 ? "s" : ""} manquante${ids.length > 1 ? "s" : ""}`);
  }

  function passportEventEndLabel(ev) {
    if (ev.daysRemaining == null && !ev.endDate) return "";
    const days = ev.daysRemaining;
    if (days == null) {
      return `Fin : ${passportDate(ev.endDate, "—", { withTime: false })}`;
    }
    if (days <= 0) return "Se termine aujourd’hui";
    return `Se termine dans ${days} jour${days > 1 ? "s" : ""}`;
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
      ? `<p class="collector-passport__warning">Cette collection n’est renseignée qu’à ${safePercentage(reliability.rate, 0)} %. Certaines statistiques peuvent être incomplètes.</p>`
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
    const unlockedBadges = badges.filter((b) => !b.status || b.status === "unlocked");
    const featuredBadge = data.featuredBadge || identity.featuredBadge || null;
    const featuredId = featuredBadge && featuredBadge.badgeId ? String(featuredBadge.badgeId) : "";
    const events = data.events || {};
    const completedEvents = Array.isArray(events.completed) ? events.completed : [];
    const inProgressEvents = Array.isArray(events.inProgress) ? events.inProgress : [];
    const historicalEvents = Array.isArray(events.historical) ? events.historical : [];
    const officialRarity = c.highestOfficialRarity || null;
    const specialVariant = c.rarestSpecialVariant || null;
    const rarityLabel = officialRarity
      ? officialRarity.label
      : (c.highestRarity || "Aucune rareté débloquée");
    const rarityCount = officialRarity && officialRarity.ownedCountAtRarity
      ? (() => {
          const n = safeFiniteNumber(officialRarity.ownedCountAtRarity, 0, { min: 0, max: 1000000 });
          const key = String(officialRarity.key || "").toLowerCase();
          const adjective = {
            common: "communes",
            uncommon: "peu communes",
            rare: "rares",
            epic: "épiques",
            legendary: "légendaires",
            mythic: "mythiques"
          }[key] || String(officialRarity.label || "").toLowerCase();
          return `${n} variante${n > 1 ? "s" : ""} ${adjective} possédée${n > 1 ? "s" : ""}`;
        })()
      : "";
    const isSelf = !!(data.user && data.user.isSelf);
    const username = identity.username || (data.user && data.user.username) || "";
    const displayName = identity.displayName || (data.user && data.user.displayName) || username;
    const avatarUrl = identity.avatarUrl || (data.user && data.user.avatarUrl) || "";
    const primarySquad = data.primarySquad;
    let primarySquadLine = "Aucune squad principale";
    let primarySquadHtml = "Aucune squad principale";
    if (primarySquad && primarySquad.private) {
      primarySquadLine = "Squad privée";
      primarySquadHtml = "Squad privée";
    } else if (primarySquad && primarySquad.name) {
      primarySquadLine = primarySquad.name;
      const members = safeFiniteNumber(primarySquad.memberCount, 0, { min: 0, max: 1000000 });
      const collective = primarySquad.collectiveCompletionDisplay != null
        ? Number(primarySquad.collectiveCompletionDisplay).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })
        : null;
      const meta = [
        members ? `${members} membre${members === 1 ? "" : "s"}` : null,
        collective != null ? `${collective} % de complétion collective` : null,
        primarySquad.role || null
      ].filter(Boolean).join(" · ");
      primarySquadHtml = `${escapeHtml(primarySquad.name)}${meta ? `<br><small>${escapeHtml(meta)}</small>` : ""}`;
    } else if (isSelf) {
      primarySquadHtml = `Aucune squad principale<br><button type="button" class="ghost-button collector-passport__choose-squad" data-passport-action="choose-squad">Choisir une squad</button>`;
    }
    const comparisonCount = social.comparisonCount;
    const distinctCompared = social.distinctCollectorsCompared;
    let comparisonsHtml = "Masqué";
    if (comparisonCount != null) {
      const n = safeFiniteNumber(comparisonCount, 0, { min: 0, max: 1000000 });
      const distinct = distinctCompared == null
        ? null
        : safeFiniteNumber(distinctCompared, 0, { min: 0, max: 1000000 });
      comparisonsHtml = `${n} comparaison${n === 1 ? "" : "s"} réalisée${n === 1 ? "" : "s"}`;
      if (distinct != null) {
        comparisonsHtml += `<br><small>${distinct} collectionneur${distinct === 1 ? "" : "s"} différent${distinct === 1 ? "" : "s"} comparé${distinct === 1 ? "" : "s"}</small>`;
      }
    }
    const ownerId = data.user && data.user.id;
    const compareLabel = isSelf ? "Comparer un joueur" : "Comparer nos collections";
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
        ? `<button type="button" class="collector-passport__link-btn" data-passport-action="event-missing" data-missing="${escapeHtml(ev.missingVariantIds.join(","))}">Voir les variantes manquantes</button>`
        : "";
      if (kind === "completed" || kind === "historical") {
        return `<li>
          <div>
            <strong>${escapeHtml(ev.eventName || ev.eventId)}</strong>
            <span>${safeFiniteNumber(ev.ownedCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(ev.requiredCount, 0, { min: 0, max: 1000000 })} variantes</span>
            <small>Complété le ${escapeHtml(passportDate(ev.completedAt, "—", { withTime: false }))}${ev.catalogueVersion ? ` · catalogue ${escapeHtml(ev.catalogueVersion)}` : ""}${ev.version ? ` · v${escapeHtml(String(ev.version))}` : ""}</small>
          </div>
        </li>`;
      }
      return `<li>
        <div>
          <strong>${escapeHtml(ev.eventName || ev.eventId)}</strong>
          <span>${safeFiniteNumber(ev.ownedCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(ev.requiredCount, 0, { min: 0, max: 1000000 })} variantes${rate != null ? ` · ${rate.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : ""}</span>
          <small>${endLabel || `Plus que ${safeFiniteNumber(ev.remainingCount, 0, { min: 0, max: 1000000 })}`}</small>
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
          ? `${threshold} % atteint le ${passportDate(b.unlockedAt, "—", { withTime: false })}${releasedAt != null ? ` · Catalogue de ${releasedAt} variante${releasedAt === 1 ? "" : "s"}` : ""}`
          : "";
        progressLine = historical || (b.unlockedAt ? `Obtenu le ${passportDate(b.unlockedAt, "—", { withTime: false })}` : "Débloqué");
      } else if (progressValue != null && targetValue != null) {
        progressLine = [
          progressRate != null ? `${progressRate.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : null,
          `${progressValue} / ${targetValue}`,
          remaining != null && remaining > 0 ? `${remaining} restante${remaining === 1 ? "" : "s"}` : null
        ].filter(Boolean).join(" · ");
      }
      const pinBtn = isSelf && unlocked && b.badgeId
        ? `<button type="button" class="collector-passport__pin" data-passport-action="pin-badge" data-badge-id="${escapeHtml(String(b.badgeId))}" aria-pressed="${isFeatured ? "true" : "false"}">${isFeatured ? "Épinglé" : "Épingler"}</button>`
        : "";
      const iconChar = escapeHtml(String(b.label || b.badgeCode || "?").slice(0, 1).toUpperCase());
      const a11yName = formatBadgeAccessibleName(b);
      const statusLabel = unlocked ? "Débloqué" : "Verrouillé";
      return `<article class="collector-passport__badge-card collector-passport__badge-card--${unlocked ? "unlocked" : "locked"}${isFeatured ? " collector-passport__badge-card--featured" : ""}" tabindex="0" role="listitem" aria-label="${escapeHtml(a11yName)}" data-passport-action="badge-open" data-badge-code="${escapeHtml(b.badgeCode || "")}" data-badge-status="${unlocked ? "unlocked" : "locked"}" data-badge-category="${escapeHtml(uiCat)}">
        <div class="collector-passport__badge-icon" aria-hidden="true">${iconChar}</div>
        <div class="collector-passport__badge-body">
          <strong>${escapeHtml(b.label || b.badgeCode || b.id)}</strong>
          <span class="collector-passport__badge-status">${statusLabel}${isFeatured ? " · Épinglé" : ""}</span>
          <p>${escapeHtml(b.description || "")}</p>
          <small>${escapeHtml(progressLine || (unlocked ? "Débloqué" : "Verrouillé"))}</small>
          <small class="collector-passport__badge-verify">Vérification : ${escapeHtml(passportVerificationLabel(b.verificationStatus || (unlocked ? "declared" : "—")))}</small>
          <small class="collector-passport__badge-declared">Calculé à partir de la collection déclarée</small>
          ${pinBtn}
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
        <h4 id="passport-identity-heading">Identité</h4>
        <div class="collector-passport__identity">
          ${passportAvatarHtml(avatarUrl, username || displayName)}
          <div class="collector-passport__identity-text">
            <p class="collector-passport__username">${escapeHtml(username || "—")}</p>
            ${displayName && displayName !== username ? `<p class="collector-passport__displayname">${escapeHtml(displayName)}</p>` : ""}
            <p class="collector-passport__since">${escapeHtml(sinceExact)}${sinceDuration && createdAt ? `<br><small>${escapeHtml(sinceDuration)}</small>` : ""}</p>
            <p class="collector-passport__identity-meta">Squad principale : <strong>${escapeHtml(primarySquadLine)}</strong>${isSelf && !(primarySquad && primarySquad.name) && !(primarySquad && primarySquad.private) ? ` <button type="button" class="ghost-button collector-passport__choose-squad" data-passport-action="choose-squad">Choisir</button>` : ""}</p>
            <p class="collector-passport__identity-meta">Badge épinglé : <strong>${escapeHtml((featuredBadge && featuredBadge.label) || "Aucun")}</strong></p>
            <button type="button" class="collector-passport__compare-btn" ${compareAction}>${escapeHtml(compareLabel)}</button>
          </div>
        </div>
      </section>

      ${statsHidden ? `<p class="collector-passport__empty" role="status">Les statistiques de ce passeport sont masquées.</p>` : `
      <section class="collector-passport__section collector-passport__section--progress" aria-labelledby="passport-progress-heading">
        <h4 id="passport-progress-heading">Progression</h4>
        <div class="collector-passport__grid collector-passport__grid--progress">
          <div><strong>${discovered} / ${releasedSprites}</strong><span>Sprites découverts</span></div>
          <div><strong>${owned} / ${released}</strong><span>Variantes possédées</span></div>
          <div><strong>${displayRate.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %</strong><span>Complétion</span></div>
        </div>
        <div class="collector-passport__progress">
          <div class="collector-passport__progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(String(barWidth))}" aria-valuetext="${escapeHtml(formatCollectionProgressText(owned, released, displayRate))}" aria-describedby="passport-progress-text">
            <div class="collector-passport__progress-fill" style="width:${barWidth}%"></div>
          </div>
          <p id="passport-progress-text" class="collector-passport__progress-text">${escapeHtml(formatCollectionProgressText(owned, released, displayRate))}</p>
          ${showPeak ? `<p class="collector-passport__progress-peak">Record personnel : ${Number(peak.completionRateDisplay).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} % · Taux actuel : ${displayRate.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %</p>` : `<p class="collector-passport__progress-peak">Taux actuel : ${displayRate.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %</p>`}
          ${nextStep ? `<p class="collector-passport__progress-next">${escapeHtml(nextStep.label)}</p>` : ""}
          <p class="collector-passport__progress-meta">Mise à jour : ${escapeHtml(passportRelativeUpdate(c.lastUpdatedAt))} · Qualité : ${escapeHtml(qualityLabel)} (${safePercentage(reliability.rate, 0)} %)</p>
        </div>
        ${reliabilityWarning}
      </section>

      <section class="collector-passport__section collector-passport__section--collection" aria-labelledby="passport-collection-heading">
        <h4 id="passport-collection-heading">Collection</h4>
        <div class="collector-passport__breakdown">
          <h5>Raretés</h5>
          <ul class="collector-passport__filter-list">${rarityBreakdown.length ? rarityBreakdown.map((row) => `
            <li><button type="button" class="collector-passport__filter-row" data-passport-action="open-filter" data-filter="${escapeHtml(row.filter)}">
              <span>${escapeHtml(row.label)}</span>
              <strong>${safeFiniteNumber(row.ownedCount, 0, { min: 0, max: 1000000 })} variante${safeFiniteNumber(row.ownedCount, 0) === 1 ? "" : "s"}</strong>
            </button></li>`).join("") : "<li><em>Aucune rareté pour le moment.</em></li>"}</ul>
          <h5>Types de variantes</h5>
          <ul class="collector-passport__filter-list">${variantTypeBreakdown.length ? variantTypeBreakdown.map((row) => `
            <li><button type="button" class="collector-passport__filter-row" data-passport-action="open-filter" data-filter="${escapeHtml(row.filter)}">
              <span>${escapeHtml(row.label)}</span>
              <strong>${safeFiniteNumber(row.ownedCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(row.releasedCount, 0, { min: 0, max: 1000000 })}</strong>
            </button></li>`).join("") : "<li><em>Aucun type pour le moment.</em></li>"}</ul>
        </div>
        <dl class="collector-passport__details">
          <div><dt>Rareté la plus élevée</dt><dd>${escapeHtml(rarityLabel)}${rarityCount ? `<br><small>${escapeHtml(rarityCount)}</small>` : ""}</dd></div>
          <div><dt>Variante spéciale la plus rare</dt><dd>${escapeHtml((specialVariant && specialVariant.label) || "Aucune")}</dd></div>
          <div><dt>Squad principale</dt><dd>${primarySquadHtml}</dd></div>
          <div><dt>Activité sociale</dt><dd>${safeFiniteNumber(social.friendCount, 0, { min: 0, max: 1000000 })} ami${safeFiniteNumber(social.friendCount, 0, { min: 0, max: 1000000 }) === 1 ? "" : "s"} · ${safeFiniteNumber(social.squadCount, 0, { min: 0, max: 1000000 })} squad${safeFiniteNumber(social.squadCount, 0, { min: 0, max: 1000000 }) === 1 ? "" : "s"}</dd></div>
          <div><dt>Comparaisons</dt><dd>${comparisonsHtml}</dd></div>
          <div><dt>Fiabilité</dt><dd>${safePercentage(reliability.rate, 0)} % (${safeFiniteNumber(reliability.explicitVariantCount, 0, { min: 0, max: 1000000 })}/${safeFiniteNumber(reliability.totalVariantCount, 0, { min: 0, max: 1000000 })})</dd></div>
        </dl>
        <p class="collector-passport__footnote">Collection calculée sur ${released} variante${released === 1 ? "" : "s"} sortie${released === 1 ? "" : "s"}${c.catalogueVersion || cat.version ? ` · catalogue ${escapeHtml(c.catalogueVersion || cat.version)}` : ""}.</p>
        <p class="collector-passport__disclaimer">Collection déclarée par l’utilisateur</p>
      </section>

      <section class="collector-passport__section collector-passport__section--events" aria-labelledby="passport-events-heading">
        <h4 id="passport-events-heading">Événements</h4>
        <p class="collector-passport__events-summary"><strong>${safeFiniteNumber(data.eventsCompleted != null ? data.eventsCompleted : completedEvents.length, 0, { min: 0, max: 1000000 })}</strong> événement${safeFiniteNumber(data.eventsCompleted != null ? data.eventsCompleted : completedEvents.length, 0) === 1 ? "" : "s"} terminé${safeFiniteNumber(data.eventsCompleted != null ? data.eventsCompleted : completedEvents.length, 0) === 1 ? "" : "s"}</p>
        <div class="collector-passport__block">
          <h5>Terminés récemment</h5>
          <ul class="collector-passport__events">${recentlyCompleted.length ? recentlyCompleted.map((ev) => renderEventItem(ev, "completed")).join("") : "<li><em>Aucun événement terminé récemment.</em></li>"}</ul>
        </div>
        <div class="collector-passport__block">
          <h5>En cours (${inProgressEvents.length})</h5>
          <ul class="collector-passport__events">${inProgressEvents.length ? inProgressEvents.map((ev) => renderEventItem(ev, "progress")).join("") : "<li><em>Aucun événement en cours.</em></li>"}</ul>
        </div>
        <div class="collector-passport__block">
          <h5>Historiques (${historicalEvents.length})</h5>
          <ul class="collector-passport__events">${historicalEvents.length ? historicalEvents.map((ev) => renderEventItem(ev, "historical")).join("") : "<li><em>Aucun accomplissement sur une ancienne version.</em></li>"}</ul>
        </div>
      </section>`}

      <section class="collector-passport__section collector-passport__section--badges" aria-labelledby="passport-badges-heading">
        <h4 id="passport-badges-heading">Badges (${unlockedBadges.length})</h4>
        <div class="collector-passport__badge-filters" role="toolbar" aria-label="Filtres badges">
          ${[
            ["all", "Tous"],
            ["unlocked", "Débloqués"],
            ["locked", "À débloquer"],
            ["progression", "Progression"],
            ["social", "Social"],
            ["events", "Événements"]
          ].map(([value, label], i) =>
            `<button type="button" class="collector-passport__badge-filter${i === 0 ? " is-active" : ""}" data-passport-action="badge-filter" data-badge-filter="${value}" aria-pressed="${i === 0 ? "true" : "false"}">${label}</button>`
          ).join("")}
        </div>
        <div class="collector-passport__badge-grid" role="list" data-badge-grid>
          ${badgesByCategory.length ? badgesByCategory.map((group) => `
            <div class="collector-passport__badge-group" data-badge-group="${escapeHtml(group.cat)}">
              <h5>${escapeHtml(group.label)}</h5>
              <div class="collector-passport__badge-cards" role="presentation">${group.items.map(renderBadgeCard).join("")}</div>
            </div>`).join("") : "<em>Aucun badge pour le moment.</em>"}
        </div>
      </section>

      <section class="collector-passport__section collector-passport__section--activity" aria-labelledby="passport-activity-heading">
        <h4 id="passport-activity-heading">Activité récente</h4>
        ${activityGroups.length ? activityGroups.map((group) => `
          <div class="collector-passport__activity-day">
            <h5>${escapeHtml(group.label)}</h5>
            <ul class="collector-passport__activity">${group.items.map((a) =>
              `<li><span>${escapeHtml(passportActivityLabel(a))}</span></li>`
            ).join("")}</ul>
          </div>`).join("") : "<p class=\"collector-passport__empty\" role=\"status\">Aucune activité récente.</p>"}
      </section>
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
      edit_profile: "Modifier mon profil",
      manage_privacy: "Gérer la confidentialité",
      choose_primary_squad: "Choisir ma squad principale",
      pin_badge: "Épingler un badge",
      share_passport: "Partager mon passeport",
      update_collection: "Mettre à jour ma collection",
      compare_collections: "Comparer nos collections",
      invite_to_squad: "Inviter dans une squad",
      create_shared_goal: "Créer un objectif commun",
      view_public_collection: "Voir la collection publique",
      add_friend: "Ajouter comme ami"
    };
    actionsEl.innerHTML = actions
      .filter((key) => labels[key])
      .map((key) => `<button type="button" class="ghost-button" data-passport-action="${escapeHtml(key)}">${labels[key]}</button>`)
      .join("");

    const ownerId = data.user && data.user.id;
    const ownerName = (data.user && (data.user.displayName || data.user.username)) || "Joueur";
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
            toast("Choisis un badge à épingler dans la grille.");
          } else {
            toast("Aucun badge à épingler pour le moment.");
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
            toast("Connecte-toi et crée une squad pour inviter.");
          }
          return;
        }
        if (action === "create_shared_goal") {
          document.getElementById("passportDialog")?.close?.();
          closeAccount();
          if (typeof activateMainView === "function") activateMainView("social");
          if (typeof setSocialTab === "function") setSocialTab("squad");
          toast("Crée un objectif collectif dans une squad commune.");
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
            toast("Connecte-toi pour ajouter un ami.");
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
      showEvents: avail.events !== false && card.completedEventCount != null
    };
  }

  function formatPassportJoinDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function buildPassportCardLines(card, opts) {
    const lines = [];
    const name = card.displayName || card.username || "";
    lines.push({ kind: "title", text: name });
    if (card.username && card.displayName && card.username !== card.displayName) {
      lines.push({ kind: "sub", text: `@${card.username}` });
    }
    if (opts.showCompletion && card.completionRateDisplay != null) {
      const rate = String(card.completionRateDisplay).replace(".", ",");
      lines.push({ kind: "stat", text: `${rate} % de complétion` });
    }
    if (opts.showCompletion && card.ownedVariantCount != null && card.releasedVariantCount != null) {
      lines.push({ kind: "stat", text: `${card.ownedVariantCount} variantes sur ${card.releasedVariantCount}` });
    }
    if (opts.showEvents && card.completedEventCount != null) {
      const n = Number(card.completedEventCount) || 0;
      lines.push({ kind: "stat", text: `${n} événement${n > 1 ? "s" : ""} complété${n > 1 ? "s" : ""}` });
    }
    if (opts.showBadges && card.featuredBadgeLabel) {
      lines.push({ kind: "meta", text: `Badge : ${card.featuredBadgeLabel}` });
    }
    if (opts.showSquad && card.primarySquadName) {
      lines.push({ kind: "meta", text: `Squad : ${card.primarySquadName}` });
    }
    if (opts.showJoinedAt && card.joinedAt) {
      lines.push({ kind: "meta", text: `Inscrit le ${formatPassportJoinDate(card.joinedAt)}` });
    }
    return lines;
  }

  function renderPassportSharePreviewBody(card, opts) {
    const lines = buildPassportCardLines(card, opts);
    return `
      <ul class="passport-share-preview__list">
        ${lines.map((l) => `<li class="passport-share-preview__${escapeHtml(l.kind)}">${escapeHtml(l.text)}</li>`).join("")}
      </ul>
      <p class="passport-share-preview__url">${escapeHtml((card.publicUrl && `${webOrigin()}${card.publicUrl}`) || "")}</p>
      <p class="passport-share-preview__note">Jamais inclus : e-mail, notes, amis, données privées, activité masquée.</p>
    `;
  }

  async function fetchPassportCardPayload(username) {
    const res = await fetch(`${API_BASE}/u/${encodeURIComponent(username)}/passport/card`, {
      headers: authHeadersOnly()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Carte indisponible");
    return data;
  }

  function openPassportSharePreview(passportData) {
    const username = passportData.user && passportData.user.username;
    if (!username) {
      toast("Pseudo manquant pour le partage");
      return;
    }
    const dialog = document.getElementById("passportShareDialog");
    const preview = document.getElementById("passportSharePreview");
    const generateBtn = document.getElementById("passportShareGenerate");
    if (!dialog || !preview) return;

    preview.innerHTML = `<p class="collector-passport__empty">Chargement de l’aperçu…</p>`;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    fetchPassportCardPayload(username).then((card) => {
      const opts = passportShareDefaults(card);
      const sync = () => {
        opts.showSquad = !!document.getElementById("passportShareOptSquad")?.checked;
        opts.showBadges = !!document.getElementById("passportShareOptBadges")?.checked;
        opts.showJoinedAt = !!document.getElementById("passportShareOptJoined")?.checked;
        opts.showCompletion = !!document.getElementById("passportShareOptCompletion")?.checked;
        opts.showEvents = !!document.getElementById("passportShareOptEvents")?.checked;
        preview.innerHTML = renderPassportSharePreviewBody(card, opts);
      };
      const squadEl = document.getElementById("passportShareOptSquad");
      const badgesEl = document.getElementById("passportShareOptBadges");
      const joinedEl = document.getElementById("passportShareOptJoined");
      const completionEl = document.getElementById("passportShareOptCompletion");
      const eventsEl = document.getElementById("passportShareOptEvents");
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
      ["passportShareOptSquad", "passportShareOptBadges", "passportShareOptJoined", "passportShareOptCompletion", "passportShareOptEvents"]
        .forEach((id) => document.getElementById(id)?.addEventListener("change", sync));
      sync();

      if (generateBtn) {
        generateBtn.onclick = async () => {
          sync();
          const format = document.getElementById("passportShareFormat")?.value || "1080x1080";
          generateBtn.disabled = true;
          try {
            await generateAndSharePassportCard(card, opts, format);
          } catch (err) {
            toast(err.message || "Impossible de générer la carte");
          } finally {
            generateBtn.disabled = false;
          }
        };
      }
    }).catch((err) => {
      preview.innerHTML = `<p class="collector-passport__empty">${escapeHtml(err.message || "Aperçu indisponible")}</p>`;
    });
  }

  function passportCardSize(format) {
    if (format === "1080x1920") return { w: 1080, h: 1920 };
    if (format === "1200x630") return { w: 1200, h: 630 };
    return { w: 1080, h: 1080 };
  }

  async function generateAndSharePassportCard(card, opts, format) {
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
          showEvents: !!opts.showEvents
        })
      });
    } catch (_) {}

    const { w, h } = passportCardSize(format);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponible");

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#0b1220");
    grad.addColorStop(0.55, "#14233a");
    grad.addColorStop(1, "#1a1030");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(Math.round(w * 0.06), Math.round(h * 0.08), Math.round(w * 0.88), Math.round(h * 0.84));

    const lines = buildPassportCardLines(card, opts);
    const padX = w * 0.12;
    let y = h * (h > w * 1.2 ? 0.22 : 0.28);
    const titleSize = Math.round(w * (format === "1200x630" ? 0.055 : 0.07));
    const bodySize = Math.round(w * (format === "1200x630" ? 0.032 : 0.038));

    ctx.fillStyle = "#9ec5ff";
    ctx.font = `600 ${Math.round(bodySize * 0.85)}px system-ui, sans-serif`;
    ctx.fillText("sprite-index · Passeport", padX, y - bodySize * 1.6);

    for (const line of lines) {
      if (line.kind === "title") {
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
        ctx.fillText(line.text, padX, y);
        y += titleSize * 1.25;
      } else if (line.kind === "sub") {
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.font = `500 ${bodySize}px system-ui, sans-serif`;
        ctx.fillText(line.text, padX, y);
        y += bodySize * 1.4;
      } else if (line.kind === "stat") {
        ctx.fillStyle = "#e8f0ff";
        ctx.font = `600 ${bodySize}px system-ui, sans-serif`;
        ctx.fillText(line.text, padX, y);
        y += bodySize * 1.45;
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.font = `500 ${Math.round(bodySize * 0.92)}px system-ui, sans-serif`;
        ctx.fillText(line.text, padX, y);
        y += bodySize * 1.35;
      }
    }

    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `500 ${Math.round(bodySize * 0.7)}px system-ui, sans-serif`;
    const url = card.publicUrl ? `${location.host}${card.publicUrl}` : "sprite-index";
    ctx.fillText(url, padX, h * 0.9);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export image échoué"))), "image/png");
    });
    const fileName = `sprite-index-passeport-${card.username || "carte"}-${w}x${h}.png`;
    const file = new File([blob], fileName, { type: "image/png" });
    const shareUrl = card.publicUrl ? `${webOrigin()}${card.publicUrl}` : webOrigin();

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          title: `Passeport ${card.displayName || card.username}`,
          text: "Mon passeport collectionneur sprite-index",
          url: shareUrl,
          files: [file]
        });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(objectUrl);
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast("Carte téléchargée · lien copié");
        return;
      } catch {}
    }
    toast("Carte téléchargée");
  }

  async function fetchCollectorPassport(userId) {
    const res = await fetch(`${API_BASE}/profile/${encodeURIComponent(userId)}/passport`, { headers: authHeadersOnly() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Passeport indisponible");
    return data;
  }

  async function loadCollectorPassport() {
    const content = document.getElementById("collectorPassportContent");
    const reliabilityEl = document.getElementById("passportReliability");
    const actionsEl = document.getElementById("collectorPassportActions");
    if (!content || !state.userId) return;
    content.innerHTML = `<p class="collector-passport__empty">Calcul du passeport…</p>`;
    if (actionsEl) actionsEl.innerHTML = "";
    try {
      const data = await fetchCollectorPassport(state.userId);
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
      if (reliabilityEl) reliabilityEl.textContent = "Indisponible";
      content.innerHTML = `<p class="collector-passport__empty">Impossible de charger le passeport.</p>`;
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
    if (titleEl) titleEl.textContent = displayName ? `Passeport · ${displayName}` : "Passeport du collectionneur";
    content.innerHTML = `<p class="collector-passport__empty">Calcul du passeport…</p>`;
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
      content.innerHTML = `<p class="collector-passport__empty">${escapeHtml(error.message || "Passeport indisponible")}</p>`;
    }
  }

  window.openCollectorPassport = openCollectorPassport;

  function wirePassportBodyActions(content, data = null) {
    if (!content) return;
    const passportData = data || {};
    const ownerId = passportData.user && passportData.user.id;
    const name = (passportData.user && (passportData.user.displayName || passportData.user.username)) || "Joueur";

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
            throw new Error(err.error || "Impossible d’épingler ce badge");
          }
          toast(nextId ? "Badge épinglé" : "Badge retiré de la mise en avant");
          loadCollectorPassport();
        } catch (err) {
          toast(err.message || "Impossible d’épingler ce badge");
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
      const options = (selected) => ["private", "friends", "squad", "public"].map(value => `<option value="${value}" ${selected === value ? "selected" : ""}>${({ private: "Privé", friends: "Amis", squad: "Squad", public: "Public" })[value]}</option>`).join("");
      const squadOptions = [`<option value="">Aucune</option>`, ...((settings.availableSquads || []).map(s => `<option value="${escapeHtml(String(s.id))}" ${String(settings.primarySquadId) === String(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`))].join("");
      const featuredOptions = [
        `<option value="">Aucun</option>`,
        ...((settings.availableFeaturedBadges || []).map((b) =>
          `<option value="${escapeHtml(String(b.id))}" ${String(settings.featuredBadgeId) === String(b.id) ? "selected" : ""}>${escapeHtml(b.label || b.code)}</option>`
        ))
      ].join("");
      content.insertAdjacentHTML("beforeend", `
        <details class="collector-passport__settings"><summary>Réglages de visibilité</summary>
          <p>Chaque section est filtrée par le serveur avant son envoi.</p>
          <label>Squad principale<select data-passport-setting="primarySquadId">${squadOptions}</select></label>
          <label>Badge épinglé<select data-passport-setting="featuredBadgeId">${featuredOptions}</select></label>
          <label>Passeport général<select data-passport-setting="passportVisibility">${options(settings.passportVisibility)}</select></label>
          <label>Statistiques<select data-passport-setting="statisticsVisibility">${options(settings.statisticsVisibility)}</select></label>
          <label>Badges<select data-passport-setting="badgesVisibility">${options(settings.badgesVisibility)}</select></label>
          <label>Activité récente<select data-passport-setting="activityVisibility">${options(settings.activityVisibility)}</select></label>
          <label>Comparaisons<select data-passport-setting="comparisonsVisibility">${options(settings.comparisonsVisibility)}</select></label>
          <label class="collector-passport__check"><input type="checkbox" data-passport-setting="showJoinDate" ${settings.showJoinDate ? "checked" : ""}> Afficher la date d’inscription</label>
          <label class="collector-passport__check"><input type="checkbox" data-passport-setting="showLastActivity" ${settings.showLastActivity ? "checked" : ""}> Afficher l’activité récente</label>
          <button type="button" class="account-save-btn" id="passportSaveSettings">Enregistrer</button>
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
          toast("Réglages du passeport enregistrés");
          loadCollectorPassport();
        } catch {
          toast("Impossible d’enregistrer les réglages");
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
        toast("Impossible d'enregistrer le consentement");
        return;
      }
      toast(optIn
        ? "Participation aux stats communautaires activée"
        : "Participation aux stats communautaires désactivée");
    } catch {
      ev.target.checked = !optIn;
      toast("Erreur de sauvegarde");
    }
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
        localStorage.setItem("sprite-index_privacy", privacy);
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
          localStorage.setItem("sprite-index_avatar", avatarUrl);
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

  document.getElementById("accountGoCompare").addEventListener("click", () => {
    closeAccount();
    if (typeof activateMainView === "function") activateMainView("social");
    if (typeof setSocialTab === "function") setSocialTab("compare");
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
    localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
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
      a.download = `sprite-index_export_${data.profile?.username || state.username || "user"}.json`;
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
      refreshAccountQuickPreferences();
      notifSettingsReady = true;
      setNotifSettingsStatus("");
    } catch {
      refreshAccountQuickPreferences();
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
      refreshAccountQuickPreferences();
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
    if (!res.ok) throw new Error(data.error || "Passeport non accessible");
    const userId = data.user && (data.user.numericId || data.user.id);
    const name = displayName || (data.user && (data.user.displayName || data.user.username)) || username;
    if (state.userId && userId && String(userId).match(/^\d+$/) && typeof window.openCollectorPassport === "function") {
      await window.openCollectorPassport(userId, name);
      return;
    }
    renderPublicPassportOverlay(data);
  } catch (err) {
    toast(err.message || "Passeport indisponible");
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
  const actionLabels = {
    view_public_collection: "Voir la collection",
    add_friend: "Ajouter comme ami",
    compare_collections: "Comparer"
  };
  overlay.innerHTML = `
    <div class="shared-view__card">
      <div class="shared-view__header">
        <div class="shared-view__id">
          <p class="collector-passport__eyebrow">sprite-index</p>
          <h1 class="shared-view__name">${escapeHtml(u.displayName || u.username || "Joueur")}</h1>
          <p class="shared-view__sub">@${escapeHtml(u.username || "")} · Passeport public</p>
          <p class="collector-passport__disclaimer">Collection déclarée par l’utilisateur</p>
        </div>
      </div>
      <div class="shared-view__overall">
        <div class="shared-view__overall-top">
          <span class="shared-view__overall-pct">${rate != null ? `${escapeHtml(String(rate))} %` : "—"}</span>
          <span class="shared-view__overall-count">${
            stats.ownedVariantCount != null && stats.releasedVariantCount != null
              ? `${stats.ownedVariantCount} / ${stats.releasedVariantCount} variantes`
              : ""
          }</span>
        </div>
      </div>
      <div class="shared-view__section">
        ${squad ? `<p>Squad : ${escapeHtml(squad)}</p>` : ""}
        ${badge ? `<p>Badge : ${escapeHtml(badge)}</p>` : ""}
        ${stats.completedEventCount != null ? `<p>${stats.completedEventCount} événements complétés</p>` : ""}
      </div>
      <div class="collector-passport__actions public-passport-view__actions">
        ${actions.filter((a) => actionLabels[a]).map((a) =>
          `<button type="button" class="ghost-button" data-public-passport-action="${escapeHtml(a)}">${actionLabels[a]}</button>`
        ).join("")}
      </div>
      <a href="${webOrigin()}/" class="shared-view__cta">Ouvrir sprite-index</a>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-public-passport-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.publicPassportAction;
      const id = u.numericId;
      if (action === "add_friend") {
        if (!state.userId) { toast("Connecte-toi pour ajouter un ami."); return; }
        if (typeof sendFriendRequest === "function" && id) await sendFriendRequest(id);
      } else if (action === "compare_collections") {
        if (!state.userId) { toast("Connecte-toi pour comparer."); return; }
        if (typeof compareWithFriend === "function" && id) {
          await compareWithFriend(id, u.displayName || u.username, { source: "passport" });
        }
      } else if (action === "view_public_collection") {
        toast("Collection visible via le passeport public.");
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
      <h1 class="shared-view__name">Passeport indisponible</h1>
      <p class="shared-view__sub">${escapeHtml(message || "Ce passeport n’est pas accessible.")}</p>
      <a href="${webOrigin()}/" class="shared-view__cta">Ouvrir sprite-index</a>
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
