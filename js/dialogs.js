function openDetail(itemId) {
  const item = getAllItems().find((candidate) => candidate.id === itemId);
  if (!item) return;
  const entry = getEntry(item.id);
  state.activeDetailId = item.id;
  const imageUrl = safeImageUrl(item.img);
  els.dialogAvatar.innerHTML = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.spriteName)}" class="avatar-img" />` : `<span class="avatar-placeholder">?</span>`;
  els.dialogAvatar.style.setProperty("--card-color", safeCssColor(item.color));
  // Étape 79 — label official rarity separately from community ownership.
  els.dialogRarity.textContent = item.rarity
    ? t("dialog.officialRarity", { rarity: localizedRarity(item.rarity) })
    : t("dialog.officialRarityEmpty");
  els.dialogTitle.textContent = item.spriteName;
  els.dialogVariant.textContent = `${item.variant} · ${statusLabel(entry.status)}`;
  els.dialogEffect.textContent = `${item.effect} ${item.variant !== "Base" ? t("swipe.variantBonus", { bonus: item.variantBonus }) : ""}`;
  els.dialogNote.value = entry.note ?? "";

  document.querySelectorAll("#dialogPriorityBar .prio-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.prio === (entry.priority || "none"));
  });

  els.dialog.showModal();
  // Étape 77/80 — community stats on variant fiche (async, non-blocking).
  if (typeof loadDetailCommunityStats === "function") {
    loadDetailCommunityStats(item.id);
  }
}

function saveDialogNote() {
  if (!state.activeDetailId) return;
  setEntry(state.activeDetailId, { note: els.dialogNote.value });
}

function openSpriteDetail(spriteId) {
  const sprite = SPRITES.find(s => s.id === spriteId);
  if (!sprite) return;

  // Keep the detailed sprite view on the same released/active scope as the
  // header, checklist, stats and passport.
  const rawVariants = getSpriteCollectionItems(sprite.id).map((item) => item.variantType);
  const variants = rawVariants.map(v => ({
    id: variantId(sprite.id, v),
    name: v,
    entry: getEntry(variantId(sprite.id, v)),
    img: getSpriteImg(sprite.id, v)
  }));
  const owned = variants.filter(v => v.entry.status === "owned").length;
  const total = variants.length;
  const pct = collectionPercent(owned, total);
  const baseImg = safeImageUrl(getSpriteImg(sprite.id, "Base"));
  const isFavorite = state.collection[`fav_${sprite.id}`] === true;

  const rarityInline = sprite.rarity
    ? t("dialog.spriteRarityInline", { rarity: localizedRarity(sprite.rarity) })
    : t("dialog.spriteRarityEmpty");

  els.spriteDetailContent.innerHTML = `
    <div class="sd-header" style="--card-color:${safeCssColor(sprite.color)}">
      <div class="sd-avatar">${baseImg ? `<img src="${escapeHtml(baseImg)}" class="sd-avatar__img" />` : `<span>?</span>`}</div>
      <div class="sd-header__info">
        <h2 class="sd-title">${escapeHtml(sprite.name)}</h2>
        <div class="sd-meta">
          <span class="sd-rarity" title="${escapeHtml(t("dialog.spriteRarityTitle"))}">${escapeHtml(rarityInline)}</span>
          ${sprite.confidence ? `<span class="sd-confidence sd-confidence--${confidenceClass(sprite.confidence)}">${escapeHtml(sprite.confidence)}</span>` : ""}
        </div>
        <button type="button" class="sd-fav ${isFavorite ? "active" : ""}" data-fav="${escapeHtml(String(sprite.id || ""))}" title="${escapeHtml(t("dialog.favorite"))}">
          <svg viewBox="0 0 24 24" fill="${isFavorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
    </div>

    <div class="sd-effect">
      <strong>${escapeHtml(t("dialog.effect"))}</strong> ${escapeHtml(sprite.effect)}
    </div>

    ${sprite.season ? `
    <div class="sd-season">
      <strong>${escapeHtml(t("dialog.season"))}</strong>
      <span class="sd-season__name">${escapeHtml(sprite.season.name || `Chapitre ${sprite.season.chapter} — Saison ${sprite.season.season}`)}</span>
      ${sprite.season.startDate ? `<span class="sd-season__dates">${new Date(sprite.season.startDate).toLocaleDateString(uiLocale())}${sprite.season.endDate ? ` → ${new Date(sprite.season.endDate).toLocaleDateString(uiLocale())}` : ""}</span>` : ""}
    </div>
    ` : ""}

    ${sprite.event ? `
    <div class="sd-event">
      <strong>${escapeHtml(t("dialog.event"))}</strong>
      <span class="sd-event__name">${escapeHtml(sprite.event.name || sprite.event.id)}</span>
      ${sprite.event.type ? `<span class="sd-event__type">${escapeHtml(sprite.event.type)}</span>` : ""}
      ${sprite.event.startDate ? `<span class="sd-event__dates">${new Date(sprite.event.startDate).toLocaleDateString(uiLocale())}${sprite.event.endDate ? ` → ${new Date(sprite.event.endDate).toLocaleDateString(uiLocale())}` : ""}</span>` : ""}
    </div>
    ` : ""}

    ${(() => {
      // Étape 20 — Disponibilité formulée honnêtement (statut + source).
      // Étape 36 — estimated end dates show a non-affirmative disclaimer.
      const a = sprite.availability || {};
      const conf = confidenceClass(a.confidence);
      const phrase = availabilityPhrase(a);
      const endLine = typeof formatEndDateLine === "function"
        ? formatEndDateLine(a)
        : `Date de fin : ${formatDateFr(a.endDate) || "inconnue"}`;
      return `
      <div class="sd-availability sd-conf--${conf}">
        <strong>${escapeHtml(t("dialog.availability"))}</strong>
        <span class="sd-availability__text">${escapeHtml(phrase)}</span>
        <span class="sd-availability__end">${escapeHtml(endLine)}</span>
      </div>
      `;
    })()}

    ${(() => {
      // Étape 20 — Méthode d'obtention (« à confirmer » si incertaine).
      const acq = sprite.acquisitionMethod || {};
      const conf = confidenceClass(acq.confidence);
      const phrase = acquisitionPhrase(acq);
      const loc = acq.location ? `<span class="sd-acquisition__loc">${escapeHtml(t("dialog.location", { loc: acq.location }))}</span>` : "";
      return `
      <div class="sd-acquisition sd-conf--${conf}">
        <strong>${escapeHtml(t("dialog.acquisition"))}</strong>
        <span class="sd-acquisition__text">${escapeHtml(phrase)}</span>
        ${loc}
      </div>
      `;
    })()}

    ${(() => {
      // Étape 20 — Récurrence honnête (retour confirmé / possible / non confirmé).
      const r = sprite.recurrence || {};
      const conf = r.officiallyConfirmed ? "official" : "unknown";
      return `
      <div class="sd-recurrence sd-conf--${conf}">
        <strong>${escapeHtml(t("dialog.recurrence"))}</strong>
        <span class="sd-recurrence__text">${escapeHtml(recurrencePhrase(r))}</span>
      </div>
      `;
    })()}

    ${(() => {
      const status = sprite.dataStatus;
      const safeStatus = ["incomplete", "needs_review", "unverified", "disputed", "archived"].includes(status) ? status : "unknown";
      if (status === "complete") return "";
      const labelKeyMap = {
        incomplete: "dialog.dataIncomplete",
        needs_review: "dialog.dataNeedsReview",
        unverified: "dialog.dataUnverified",
        disputed: "dialog.dataDisputed",
        archived: "dialog.dataArchived"
      };
      const labelKey = labelKeyMap[status];
      const label = labelKey ? t(labelKey) : t("dialog.dataStatusUnknown", { status: safeText(status, "inconnu") });
      const missing = (sprite.missingFields || []).join(", ") || t("dialog.missingFieldsFallback");
      return `
      <div class="sd-data-status sd-data-status--${safeStatus}">
        <strong>${escapeHtml(label)}</strong>
        <span class="sd-data-status__missing">${escapeHtml(t("dialog.missingFields", { fields: missing }))}</span>
      </div>
      `;
    })()}

    ${(() => {
      // Étape 20 — Dates de vérification affichées honnêtement.
      const dates = sprite.dates || {};
      const dateLocale = uiLocale();
      const last = formatDateFr(dates.lastVerifiedAt);
      const official = formatDateFr(dates.officiallyAnnouncedAt);
      const first = formatDateFr(dates.firstObservedAt);
      return `
      <div class="sd-dates">
        <strong>${escapeHtml(t("dialog.verification"))}</strong>
        ${last ? `<span class="sd-dates__item sd-dates__last">${escapeHtml(t("dialog.lastVerified", { date: last }))}</span>` : ""}
        ${official ? `<span class="sd-dates__item">${escapeHtml(t("dialog.officialAnnounced", { date: official }))}</span>` : ""}
        ${first ? `<span class="sd-dates__item">${escapeHtml(t("dialog.firstObserved", { date: first }))}</span>` : ""}
        ${!last && !official && !first ? `<span class="sd-dates__item sd-dates__unknown">${escapeHtml(t("dialog.noDatesKnown"))}</span>` : ""}
      </div>
      `;
    })()}

    ${(() => {
      // Étape 20 — Sources et fiabilité.
      const sources = sprite.sources || [];
      if (!sources.length) {
        return `
        <div class="sd-sources sd-conf--unknown">
          <strong>${escapeHtml(t("dialog.sources"))}</strong>
          <span class="sd-sources__list">${escapeHtml(t("dialog.noSources"))}</span>
        </div>
        `;
      }
      const items = sources.map((src, i) => {
        const reliability = sourceReliabilityLabel(src);
        const confClass = confidenceClass(src.reliability || src.type);
        const sourceUrl = safeExternalUrl(src.url);
        const link = sourceUrl ? ` <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="sd-sources__link">${escapeHtml(src.title || src.id)}</a>` : ` <span class="sd-sources__name">${escapeHtml(src.title || src.id)}</span>`;
        return `<span class="sd-sources__item sd-conf--${confClass}">${link} — ${escapeHtml(reliability)}</span>`;
      }).join("");
      return `
      <div class="sd-sources">
        <strong>${escapeHtml(t("dialog.sources"))}</strong>
        <span class="sd-sources__list">${items}</span>
      </div>
      `;
    })()}

    <div class="sd-progress">
      <div class="sd-progress__text">${escapeHtml(t("dialog.variantsOwned", { owned, total }))}</div>
      <div class="sd-progress__bar">
        <div class="sd-progress__fill" style="width:${pct}%"></div>
      </div>
      <span class="sd-progress__pct">${pct}%</span>
    </div>

    <div id="spriteDetailCommunity" class="sg-community-mount"></div>

    <div class="sd-variants">
      <h3 class="sd-section-title">${escapeHtml(t("dialog.variantsSection"))}</h3>
      ${variants.map(v => {
        const prio = v.entry.priority || "none";
        const masteryLevel = masteryLevelFor(v.entry);
        const prioBadge = prio !== "none" && prio !== "ignored"
          ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(prio)}">${priorityLabel(prio)}</span>`
          : "";
        const dateLocale = uiLocale();
        const dateObt = v.entry.obtainedAt
          ? `<span class="sd-variant__date">${new Date(v.entry.obtainedAt).toLocaleDateString(dateLocale)}</span>`
          : "";
        const masteryNivLabel = masteryLevel === 5 ? "♛ Master" : t("dialog.masteryNiv", { level: masteryLevel });
        const masteryGroupAria = t("dialog.chooseMastery");
        return `
          <div class="sd-variant ${v.entry.status === "owned" ? "sd-variant--owned" : ""} ${masteryLevel === 5 ? "sd-variant--master" : ""}">
            <div class="sd-variant__thumb">${v.img ? `<img src="${escapeHtml(safeImageUrl(v.img))}" class="sd-variant__img" />` : `<span>?</span>`}</div>
            <div class="sd-variant__info">
              <span class="sd-variant__name">${escapeHtml(v.name)} ${prioBadge}</span>
              <div class="sd-variant__meta">
                ${statusEmoji(v.entry.status)} <span>${statusLabel(v.entry.status)}</span>
                ${dateObt}
              </div>
            </div>
            ${masteryLevel > 0 ? `
              <div class="sd-variant__mastery ${masteryLevel === 5 ? "sd-variant__mastery--master" : ""}" aria-label="${escapeHtml(masteryLabel(masteryLevel))}">
                <span class="sd-variant__mastery-label">${escapeHtml(masteryNivLabel)}</span>
                <div class="sd-variant__mastery-levels" role="group" aria-label="${escapeHtml(masteryGroupAria)}">
                  ${Array.from({ length: 5 }, (_, index) => {
                    const level = index + 1;
                    const isMaster = level === 5;
                    const levelAria = isMaster ? t("dialog.masteryMasterAria") : t("dialog.masteryLevelAria", { level });
                    const levelTitle = isMaster ? t("dialog.masteryMasterAria") : t("dialog.masteryLevelAria", { level });
                    return `<button type="button" class="sd-mastery-btn ${level <= masteryLevel ? "is-active" : ""} ${isMaster ? "is-master" : ""}" data-id="${escapeHtml(String(v.id || ""))}" data-detail-mastery-level="${level}" title="${escapeHtml(levelTitle)}" aria-label="${escapeHtml(levelAria)}" aria-pressed="${level === masteryLevel}">${isMaster ? "♛" : level}</button>`;
                  }).join("")}
                </div>
              </div>
            ` : ""}
            <div class="sd-variant__actions">
              <select class="sd-status-select" data-id="${escapeHtml(String(v.id || ""))}">
                <option value="new" ${v.entry.status === "new" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusNew"))}</option>
                <option value="owned" ${v.entry.status === "owned" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusOwned"))}</option>
                <option value="missing" ${v.entry.status === "missing" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusMissing"))}</option>
                <option value="priority" ${v.entry.status === "priority" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusPriority"))}</option>
                <option value="unsure" ${v.entry.status === "unsure" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusUnsure"))}</option>
                <option value="unknown" ${v.entry.status === "unknown" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusUnknown"))}</option>
                <option value="spotted" ${v.entry.status === "spotted" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusSpotted"))}</option>
                <option value="unavailable" ${v.entry.status === "unavailable" ? "selected" : ""}>${escapeHtml(t("dialog.selectStatusUnavailable"))}</option>
              </select>
              <select class="sd-prio-select" data-id="${escapeHtml(String(v.id || ""))}">
                <option value="none" ${prio === "none" ? "selected" : ""}>${escapeHtml(t("dialog.prioPicker"))}</option>
                <option value="urgent" ${prio === "urgent" ? "selected" : ""}>${escapeHtml(t("prio.urgent"))}</option>
                <option value="important" ${prio === "important" ? "selected" : ""}>${escapeHtml(t("prio.important"))}</option>
                <option value="medium" ${prio === "medium" ? "selected" : ""}>${escapeHtml(t("prio.medium"))}</option>
                <option value="low" ${prio === "low" ? "selected" : ""}>${escapeHtml(t("prio.low"))}</option>
                <option value="ignored" ${prio === "ignored" ? "selected" : ""}>${escapeHtml(t("prio.ignored"))}</option>
              </select>
              <button type="button" class="sd-date-btn" data-id="${escapeHtml(String(v.id || ""))}" title="${escapeHtml(t("dialog.dateObtained"))}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join("")}
    </div>

    <div class="sd-notes">
      <h3 class="sd-section-title">${escapeHtml(t("dialog.notesSection"))}</h3>
      ${variants.filter(v => v.entry.note).map(v => `
        <div class="sd-note">
          <strong>${escapeHtml(v.name)} :</strong> ${escapeHtml(v.entry.note)}
        </div>
      `).join("") || `<p class="sd-empty">${escapeHtml(t("dialog.noNotes"))}</p>`}
    </div>

    <div class="sd-dates">
      <h3 class="sd-section-title">${escapeHtml(t("dialog.datesSection"))}</h3>
      ${variants.filter(v => v.entry.obtainedAt).map(v => {
        const dateLocale = uiLocale();
        return `
        <div class="sd-date-row">
          <span>${escapeHtml(v.name)}</span>
          <span>${new Date(v.entry.obtainedAt).toLocaleDateString(dateLocale)}</span>
        </div>
        `;
      }).join("") || `<p class="sd-empty">${escapeHtml(t("dialog.noDates"))}</p>`}
    </div>
  `;

  if (!els.spriteDetailDialog.open) els.spriteDetailDialog.showModal();
  // Étape 77–80 — community block after modal open.
  if (typeof loadSpriteDetailCommunity === "function") {
    loadSpriteDetailCommunity(spriteId);
  }
}
