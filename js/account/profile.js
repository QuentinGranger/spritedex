(() => {
  "use strict";

  window.SpriteIndexAccount.register("profile", function initializeAccountFeature() {
    // ── Email verification banner ──
    const emailBanner = document.getElementById("emailBanner");
    const resendBtn = document.getElementById("resendVerification");

    function checkEmailVerified() {
      const emailVerified = localStorage.getItem("sprite-index_email_verified");
      emailBanner.style.display = emailVerified === "true" || !state.userId ? "none" : "";
    }

    resendBtn.addEventListener("click", async () => {
      if (resendBtn.disabled) return;
      const previous = resendBtn.textContent;
      resendBtn.disabled = true;
      resendBtn.textContent = t("account.sendingVerification");
      try {
        const res = await fetch(`${API_BASE}/auth/resend-verification`, {
          method: "POST",
          headers: authHeadersOnly()
        });
        if (!res.ok) throw new Error("resend_failed");
        toast(t("account.verificationSent"));
      } catch {
        toast(t("account.errorRetryLater"));
      }
      resendBtn.disabled = false;
      resendBtn.textContent = previous || t("account.resend");
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
      const completedSprites = Object.values(spriteVariantMap).filter((s) => s.owned === s.total && s.total > 0).length;

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
            document.getElementById("accountSince").textContent = t("account.memberSince", {
              date: new Date(u.created_at).toLocaleDateString(uiLocale(), { month: "long", year: "numeric" })
            });
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
      const completion =
        collection.completionRateDisplay != null
          ? Number(collection.completionRateDisplay)
          : released
            ? (owned / released) * 100
            : 0;
      const rate = Math.max(0, Math.min(100, Number.isFinite(completion) ? completion : 0));
      const rateLabel = `${rate.toLocaleString(uiLocale(), { maximumFractionDigits: 1 })}%`;
      const ring = document.getElementById("accountOverviewRing");
      if (ring) {
        ring.style.setProperty("--account-overview-progress", `${rate}%`);
        ring.setAttribute("aria-label", t("account.collectionProgressAria", { rate: rateLabel }));
      }
      setAccountOverviewValue("accountOverviewPercent", rateLabel);
      setAccountOverviewValue("accountOverviewOwned", `${owned} / ${released}`);
      const remaining = Math.max(0, released - owned);
      setAccountOverviewValue(
        "accountOverviewRemaining",
        released
          ? remaining === 1
            ? t("account.remainingVariantsOne")
            : t("account.remainingVariantsMany", { count: remaining })
          : t("account.noCollectionData")
      );

      const badges =
        Array.isArray(data?.badgeProgress) && data.badgeProgress.length
          ? data.badgeProgress
          : Array.isArray(data?.badges)
            ? data.badges.map((badge) => ({ ...badge, status: "unlocked" }))
            : [];
      globalThis.spriteIndexBadges = badges;
      const unlockedBadges = badges.filter((badge) => !badge.status || badge.status === "unlocked");
      const primarySquad = data?.primarySquad;
      setAccountOverviewValue("accountHeroBadges", String(unlockedBadges.length));
      setAccountOverviewValue("accountHeroSquad", primarySquad?.name ? String(primarySquad.memberCount || 1) : "0");
      const reliabilityRate = Math.max(0, Math.min(100, Number(reliability.rate) || 0));
      const reliabilityExplicit = Math.max(0, Number(reliability.explicitVariantCount) || 0);
      const reliabilityTotal = Math.max(0, Number(reliability.totalVariantCount) || released);
      const reliabilityLabel = reliabilityRate.toLocaleString(isEnglish ? "en-US" : "fr-FR", {
        maximumFractionDigits: 1
      });
      setAccountOverviewValue("accountHeroReliability", `${reliabilityLabel}%`);
      setAccountOverviewValue(
        "accountHeroReliabilityDetail",
        t("account.reliabilityDetail", { count: reliabilityExplicit, total: reliabilityTotal })
      );

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
          countLabel.textContent =
            unlockedBadges.length === 1 ? t("account.badgePreviewCountOne") : t("account.badgePreviewCountMany");
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
              icon.textContent = String(badge.label || badge.badgeCode || "?")
                .trim()
                .slice(0, 1)
                .toUpperCase();
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
            rest.setAttribute(
              "aria-label",
              t("account.badgePreviewMore", { count: unlockedBadges.length - preview.length })
            );
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
      document
        .getElementById("accountHeroBadges")
        ?.setAttribute("title", t("account.badgesObtainedTitle", { count: unlockedBadges.length }));
      document
        .getElementById("accountHeroReliability")
        ?.setAttribute("title", t("account.reliabilityTitle", { percent: reliabilityLabel }));
      document
        .getElementById("accountHeroVariants")
        ?.setAttribute("title", t("account.variantsOwnedTitle", { count: owned }));
      void social;
    }

    Object.assign(globalThis, { checkEmailVerified, populateAccount, setAccountOverviewValue, renderAccountOverview });
  });
})();
