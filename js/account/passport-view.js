(() => {
  "use strict";

  window.SpriteIndexAccount.register("passport-view", function initializeAccountFeature() {
    function renderCollectorPassportBody(data) {
      const c = data.collection || {};
      const cat = data.catalogue || {};
      const social = data.social || {};
      const reliability = c.reliability || {};
      const identity = data.identity || {};
      const activity = Array.isArray(data.recentActivity) ? data.recentActivity : [];
      const createdAt = identity.createdAt != null ? identity.createdAt : data.user && data.user.createdAt;
      const sinceExact = passportSinceMonth(createdAt);
      const sinceDuration = createdAt ? passportSeniority(createdAt) : "";
      const released = safeFiniteNumber(cat.releasedVariantCount, 0, { min: 0, max: 1000000 });
      const releasedSprites = safeFiniteNumber(cat.releasedSpriteCount, 0, { min: 0, max: 1000000 });
      const discovered = safeFiniteNumber(c.discoveredSpriteCount, 0, { min: 0, max: 1000000 });
      const reliabilityWarning =
        reliability.level === "insufficient"
          ? `<p class="collector-passport__warning">${t("account.passport.reliabilityWarning", { rate: safePercentage(reliability.rate, 0) })}</p>`
          : "";
      const statsHidden = !data.collection;
      const owned = safeFiniteNumber(c.ownedVariantCount, 0, { min: 0, max: 1000000 });
      const displayRate =
        c.completionRateDisplay != null
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
        : Array.isArray(data.badges)
          ? data.badges.map((b) => ({ ...b, badgeCode: b.code || b.id, status: "unlocked" }))
          : [];
      globalThis.spriteIndexBadges = badges;
      const unlockedBadges = badges.filter((b) => !b.status || b.status === "unlocked");
      const featuredBadge = data.featuredBadge || identity.featuredBadge || null;
      const featuredId = featuredBadge && featuredBadge.badgeId ? String(featuredBadge.badgeId) : "";
      const events = data.events || {};
      const completedEvents = Array.isArray(events.completed) ? events.completed : [];
      const inProgressEvents = Array.isArray(events.inProgress) ? events.inProgress : [];
      const historicalEvents = Array.isArray(events.historical) ? events.historical : [];
      const completedEventCount = safeFiniteNumber(
        data.eventsCompleted != null ? data.eventsCompleted : completedEvents.length,
        0,
        { min: 0, max: 1000000 }
      );
      const officialRarity = c.highestOfficialRarity || null;
      const specialVariant = c.rarestSpecialVariant || null;
      const rarityLabel = officialRarity
        ? localizedRarity(officialRarity.label)
        : c.highestRarity || t("account.passport.noRarityUnlocked");
      const rarityCount =
        officialRarity && officialRarity.ownedCountAtRarity
          ? (() => {
              const n = safeFiniteNumber(officialRarity.ownedCountAtRarity, 0, { min: 0, max: 1000000 });
              const key = String(officialRarity.key || "").toLowerCase();
              const adjective =
                {
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
        const collective =
          primarySquad.collectiveCompletionDisplay != null
            ? formatUiNumber(Number(primarySquad.collectiveCompletionDisplay), {
                minimumFractionDigits: 0,
                maximumFractionDigits: 1
              })
            : null;
        const meta = [
          members ? t("squad.memberCount", { count: members, s: members === 1 ? "" : "s" }) : null,
          collective != null ? t("account.passport.collectiveCompletion", { rate: collective }) : null,
          primarySquad.role || null
        ]
          .filter(Boolean)
          .join(" · ");
        primarySquadHtml = `${escapeHtml(primarySquad.name)}${meta ? `<br><small>${escapeHtml(meta)}</small>` : ""}`;
      } else if (isSelf) {
        primarySquadHtml = `${t("account.passport.noSquad")}<br><button type="button" class="ghost-button collector-passport__choose-squad" data-passport-action="choose-squad">${t("account.passport.chooseSquad")}</button>`;
      }
      const comparisonCount = social.comparisonCount;
      const distinctCompared = social.distinctCollectorsCompared;
      let comparisonsHtml = t("account.passport.hidden");
      if (comparisonCount != null) {
        const n = safeFiniteNumber(comparisonCount, 0, { min: 0, max: 1000000 });
        const distinct =
          distinctCompared == null ? null : safeFiniteNumber(distinctCompared, 0, { min: 0, max: 1000000 });
        comparisonsHtml =
          n === 1 ? t("account.passport.comparisonsOne") : t("account.passport.comparisonsMany", { count: n });
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
        const rate =
          ev.progressRate != null
            ? Number(ev.progressRate)
            : ev.requiredCount
              ? Math.round((safeFiniteNumber(ev.ownedCount, 0) / safeFiniteNumber(ev.requiredCount, 1)) * 1000) / 10
              : null;
        const endLabel = kind === "progress" ? passportEventEndLabel(ev) : "";
        const missingAction =
          kind === "progress" && Array.isArray(ev.missingVariantIds) && ev.missingVariantIds.length
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
        const releasedAt =
          b.releasedVariantCountAtUnlock != null
            ? safeFiniteNumber(b.releasedVariantCountAtUnlock, 0, { min: 0, max: 1000000 })
            : null;
        const progressValue =
          b.progressValue != null ? safeFiniteNumber(b.progressValue, 0, { min: 0, max: 1000000 }) : null;
        const targetValue = b.targetValue != null ? safeFiniteNumber(b.targetValue, 0, { min: 0, max: 1000000 }) : null;
        const remaining = b.remaining != null ? safeFiniteNumber(b.remaining, 0, { min: 0, max: 1000000 }) : null;
        const progressRate = b.progressRate != null ? safeFiniteNumber(b.progressRate, 0, { min: 0, max: 100 }) : null;
        const isFeatured = unlocked && featuredId && String(b.badgeId) === featuredId;
        const uiCat = b.uiCategory || "progression";
        let progressLine = "";
        if (unlocked) {
          const historical =
            b.isHistoricalProgression && threshold != null
              ? `${t("account.badge.thresholdDate", { threshold, date: passportDate(b.unlockedAt, "—", { withTime: false }) })}${releasedAt != null ? ` · ${releasedAt === 1 ? t("account.badge.catalogueOfOne", { count: releasedAt }) : t("account.badge.catalogueOfMany", { count: releasedAt })}` : ""}`
              : "";
          progressLine =
            historical ||
            (b.unlockedAt
              ? t("account.badge.obtainedOn", { date: passportDate(b.unlockedAt, "—", { withTime: false }) })
              : t("account.badge.unlocked"));
        } else if (progressValue != null && targetValue != null) {
          progressLine = [
            progressRate != null ? formatUiPercent(progressRate, { maximumFractionDigits: 2 }) : null,
            `${progressValue} / ${targetValue}`,
            remaining != null && remaining > 0
              ? remaining === 1
                ? t("account.badge.remainingOne")
                : t("account.badge.remainingMany", { count: remaining })
              : null
          ]
            .filter(Boolean)
            .join(" · ");
        }
        const pinBtn =
          isSelf && unlocked && b.badgeId
            ? `<button type="button" class="collector-passport__pin" data-passport-action="pin-badge" data-badge-id="${escapeHtml(String(b.badgeId))}" aria-pressed="${isFeatured ? "true" : "false"}">${isFeatured ? t("account.badge.pinned") : t("account.badge.pin")}</button>`
            : "";
        const iconChar = escapeHtml(
          String(b.label || b.badgeCode || "?")
            .slice(0, 1)
            .toUpperCase()
        );
        const iconHtml = b.iconUrl
          ? `<img class="collector-passport__badge-icon collector-passport__badge-icon--art" src="${escapeHtml(b.iconUrl)}" alt="" loading="lazy" aria-hidden="true">`
          : `<div class="collector-passport__badge-icon collector-passport__badge-icon--fallback" aria-hidden="true">${iconChar}</div>`;
        const a11yName = formatBadgeAccessibleName(b);
        const statusLabel = unlocked ? t("account.badge.unlocked") : t("account.badge.locked");
        const barWidth = unlocked
          ? 100
          : Math.max(
              0,
              Math.min(
                100,
                progressRate != null ? progressRate : targetValue ? Math.round((progressValue / targetValue) * 100) : 0
              )
            );
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
          ${
            showProgress
              ? `
            <div class="collector-passport__badge-progress" aria-hidden="true">
              <div class="collector-passport__badge-progress-track">
                <div class="collector-passport__badge-progress-fill" style="width:${barWidth}%"></div>
              </div>
              <span class="collector-passport__badge-progress-label">${escapeHtml(progressLine || `${barWidth} %`)}</span>
            </div>
          `
              : progressLine
                ? `<p class="collector-passport__badge-meta">${escapeHtml(progressLine)}</p>`
                : ""
          }
          ${
            showVerify || pinBtn
              ? `
          <div class="collector-passport__badge-foot">
            ${showVerify ? `<small class="collector-passport__badge-verify">${t("account.badge.verificationPrefix")}${escapeHtml(verifyRaw)}</small>` : ""}
            ${pinBtn}
          </div>`
              : ""
          }
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

      ${
        statsHidden
          ? `<p class="collector-passport__empty" role="status">${t("account.passport.statsHidden")}</p>`
          : `
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
          <ul class="collector-passport__filter-list">${
            rarityBreakdown.length
              ? rarityBreakdown
                  .map(
                    (row) => `
            <li><button type="button" class="collector-passport__filter-row" data-passport-action="open-filter" data-filter="${escapeHtml(row.filter)}">
              <span>${escapeHtml(row.label)}</span>
              <strong>${safeFiniteNumber(row.ownedCount, 0, { min: 0, max: 1000000 })} ${t("account.passport.variantsSuffix")}</strong>
            </button></li>`
                  )
                  .join("")
              : `<li><em>${t("account.passport.noRarities")}</em></li>`
          }</ul>
          <h5>${t("account.passport.variantTypes")}</h5>
          <ul class="collector-passport__filter-list">${
            variantTypeBreakdown.length
              ? variantTypeBreakdown
                  .map(
                    (row) => `
            <li><button type="button" class="collector-passport__filter-row" data-passport-action="open-filter" data-filter="${escapeHtml(row.filter)}">
              <span>${escapeHtml(row.label)}</span>
              <strong>${safeFiniteNumber(row.ownedCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(row.releasedCount, 0, { min: 0, max: 1000000 })}</strong>
            </button></li>`
                  )
                  .join("")
              : `<li><em>${t("account.passport.noTypes")}</em></li>`
          }</ul>
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
      </details>`
      }

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
          ]
            .map(
              ([value, label], i) =>
                `<button type="button" class="collector-passport__badge-filter${i === 0 ? " is-active" : ""}" data-passport-action="badge-filter" data-badge-filter="${value}" aria-pressed="${i === 0 ? "true" : "false"}">${label}</button>`
            )
            .join("")}
        </div>
        <div class="collector-passport__badge-grid" role="list" data-badge-grid>
          ${
            badgesByCategory.length
              ? badgesByCategory
                  .map(
                    (group) => `
            <div class="collector-passport__badge-group" data-badge-group="${escapeHtml(group.cat)}"${group.items.some((badge) => !badge.status || badge.status === "unlocked") ? "" : " hidden"}>
              <h5>${escapeHtml(group.label)}</h5>
              <div class="collector-passport__badge-cards" role="presentation">${group.items.map(renderBadgeCard).join("")}</div>
            </div>`
                  )
                  .join("")
              : `<em>${t("account.passport.noBadges")}</em>`
          }
        </div>
      </section>

      <details class="collector-passport__section collector-passport__disclosure collector-passport__section--activity">
        <summary aria-labelledby="passport-activity-heading">
          <span><strong id="passport-activity-heading">${t("account.passport.recentActivity")}</strong><small>${t("account.passport.activitySummary")}</small></span>
          <span class="collector-passport__disclosure-icon" aria-hidden="true"></span>
        </summary>
        <div class="collector-passport__disclosure-body">
          ${
            activityGroups.length
              ? activityGroups
                  .map(
                    (group) => `
          <div class="collector-passport__activity-day">
            <h5>${escapeHtml(group.label)}</h5>
            <ul class="collector-passport__activity">${group.items
              .map((a) => `<li><span>${escapeHtml(passportActivityLabel(a))}</span></li>`)
              .join("")}</ul>
          </div>`
                  )
                  .join("")
              : `<p class="collector-passport__empty" role="status">${t("account.passport.noRecentActivity")}</p>`
          }
        </div>
      </details>
    `;
    }

    function wirePassportActions(actionsEl, data, { isSelf }) {
      if (!actionsEl) return;
      const actions =
        Array.isArray(data.actions) && data.actions.length
          ? data.actions
          : isSelf
            ? [
                "edit_profile",
                "manage_privacy",
                "choose_primary_squad",
                "pin_badge",
                "share_passport",
                "update_collection"
              ]
            : [];
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
        .map(
          (key) =>
            `<button type="button" class="ghost-button" data-passport-action="${escapeHtml(key)}">${labels[key]}</button>`
        )
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
            const content =
              document.getElementById("collectorPassportContent") || document.getElementById("passportDialogContent");
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
            const content =
              document.getElementById("collectorPassportContent") || document.getElementById("passportDialogContent");
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

    Object.assign(globalThis, { renderCollectorPassportBody, wirePassportActions });
  });
})();
