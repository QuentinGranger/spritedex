(() => {
  "use strict";

  window.SpriteIndexAccount.register("passport-foundation", function initializeAccountFeature() {
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
      const value = (enabled) => (enabled ? t("account.enabled") : t("account.disabled"));
      setAccountOverviewValue("accountQuickPush", value(!!document.getElementById("notifChannelPush")?.checked));
      setAccountOverviewValue("accountQuickEmail", value(!!document.getElementById("notifChannelEmail")?.checked));
      setAccountOverviewValue(
        "accountQuickFriends",
        value(!!document.querySelector('[data-notif-in-app="friend_request_accepted"]')?.checked)
      );
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
      return unlocked
        ? t("account.badge.accessibleUnlocked", { label })
        : t("account.badge.accessibleLocked", { label });
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
      const live = document.getElementById("passportA11yStatus") || document.getElementById("passportDialogA11yStatus");
      if (!live || !message) return;
      live.textContent = "";
      window.setTimeout(() => {
        live.textContent = message;
      }, 30);
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
          return count > 1 ? t("account.activity.variantsAdded", { count }) : t("account.activity.variantAdded");
        }
        case "badge_unlocked":
          return data.label
            ? t("account.activity.badgeUnlockedLabel", { label: data.label })
            : t("account.activity.badgeUnlocked");
        case "event_completed":
          return data.eventName
            ? t("account.activity.eventCompletedName", { name: data.eventName })
            : t("account.activity.eventCompleted");
        case "squad_joined":
          return data.squadName
            ? t("account.activity.squadJoined", { name: data.squadName })
            : t("account.activity.squadJoinedDefault");
        case "squad_created":
          return data.squadName
            ? t("account.activity.squadCreated", { name: data.squadName })
            : t("account.activity.squadCreatedDefault");
        case "completion_milestone":
          return data.percent != null
            ? t("account.activity.milestonePercent", { percent: data.percent })
            : t("account.activity.milestone");
        case "collective_goal_completed":
          return data.goalTitle
            ? t("account.activity.goalReached", {
                squad: data.squadName || t("account.activity.squadDefault"),
                goal: data.goalTitle
              })
            : data.squadName
              ? t("account.activity.squadProgress", { squad: data.squadName })
              : t("account.activity.goalCompleted");
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
      return d.toLocaleDateString(uiLocale(), {
        day: "numeric",
        month: "long",
        year: startThat.getFullYear() !== now.getFullYear() ? "numeric" : undefined
      });
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
      return (
        {
          progression: t("account.badgeCategory.progression"),
          social: t("account.badgeCategory.social"),
          squads: t("account.badgeCategory.squads"),
          events: t("account.badgeCategory.events"),
          historique: t("account.badgeCategory.historique")
        }[cat] || t("account.badgeCategory.progression")
      );
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
      if (ids.length)
        toast(
          ids.length === 1
            ? t("account.missingVariant", { count: ids.length })
            : t("account.missingVariants", { count: ids.length })
        );
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

    Object.assign(globalThis, {
      withCurrentLocalCollection,
      refreshAccountQuickPreferences,
      passportDate,
      passportRelativeUpdate,
      passportReliabilityLabel,
      passportSinceMonth,
      passportAvatarHtml,
      formatCollectionProgressText,
      formatBadgeAccessibleName,
      logPassportAnalytics,
      announcePassportStatus,
      passportSeniority,
      passportActivityLabel,
      passportActivityDayLabel,
      groupPassportActivityByDay,
      passportVerificationLabel,
      passportBadgeCategoryLabel,
      openPassportCollectionFilter,
      openPassportEventMissing,
      passportEventEndLabel
    });
  });
})();
