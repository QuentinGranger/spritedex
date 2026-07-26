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
    ? `Rareté officielle : ${item.rarity}`
    : "Rareté officielle : —";
  els.dialogTitle.textContent = item.spriteName;
  els.dialogVariant.textContent = `${item.variant} · ${statusLabel(entry.status)}`;
  els.dialogEffect.textContent = `${item.effect} ${item.variant !== "Base" ? `Bonus variante : ${item.variantBonus}` : ""}`;
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

  const variantTypes = Object.keys(sprite.variantDetails || {});
  const rawVariants = variantTypes.length > 0 ? variantTypes : (sprite.variants || ["Base"]);
  const variants = rawVariants.map(v => ({
    id: variantId(sprite.id, v),
    name: v,
    entry: getEntry(variantId(sprite.id, v)),
    img: getSpriteImg(sprite.id, v)
  }));
  const owned = variants.filter(v => v.entry.status === "owned").length;
  const total = variants.length;
  const pct = total ? Math.round((owned / total) * 100) : 0;
  const baseImg = safeImageUrl(getSpriteImg(sprite.id, "Base"));
  const isFavorite = state.collection[`fav_${sprite.id}`] === true;

  els.spriteDetailContent.innerHTML = `
    <div class="sd-header" style="--card-color:${safeCssColor(sprite.color)}">
      <div class="sd-avatar">${baseImg ? `<img src="${escapeHtml(baseImg)}" class="sd-avatar__img" />` : `<span>?</span>`}</div>
      <div class="sd-header__info">
        <h2 class="sd-title">${escapeHtml(sprite.name)}</h2>
        <div class="sd-meta">
          <span class="sd-rarity" title="Rareté catalogue Fortnite (officielle)">${escapeHtml(sprite.rarity ? `Rareté officielle : ${sprite.rarity}` : "Rareté officielle : —")}</span>
          ${sprite.confidence ? `<span class="sd-confidence sd-confidence--${confidenceClass(sprite.confidence)}">${escapeHtml(sprite.confidence)}</span>` : ""}
        </div>
        <button type="button" class="sd-fav ${isFavorite ? "active" : ""}" data-fav="${escapeHtml(String(sprite.id || ""))}" title="Favori">
          <svg viewBox="0 0 24 24" fill="${isFavorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
    </div>

    <div class="sd-effect">
      <strong>Effet :</strong> ${escapeHtml(sprite.effect)}
    </div>

    ${sprite.season ? `
    <div class="sd-season">
      <strong>Saison :</strong>
      <span class="sd-season__name">${escapeHtml(sprite.season.name || `Chapitre ${sprite.season.chapter} — Saison ${sprite.season.season}`)}</span>
      ${sprite.season.startDate ? `<span class="sd-season__dates">${new Date(sprite.season.startDate).toLocaleDateString("fr-FR")}${sprite.season.endDate ? ` → ${new Date(sprite.season.endDate).toLocaleDateString("fr-FR")}` : ""}</span>` : ""}
    </div>
    ` : ""}

    ${sprite.event ? `
    <div class="sd-event">
      <strong>Événement :</strong>
      <span class="sd-event__name">${escapeHtml(sprite.event.name || sprite.event.id)}</span>
      ${sprite.event.type ? `<span class="sd-event__type">${escapeHtml(sprite.event.type)}</span>` : ""}
      ${sprite.event.startDate ? `<span class="sd-event__dates">${new Date(sprite.event.startDate).toLocaleDateString("fr-FR")}${sprite.event.endDate ? ` → ${new Date(sprite.event.endDate).toLocaleDateString("fr-FR")}` : ""}</span>` : ""}
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
        <strong>Disponibilité :</strong>
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
      const loc = acq.location ? `<span class="sd-acquisition__loc">Lieu : ${escapeHtml(acq.location)}</span>` : "";
      return `
      <div class="sd-acquisition sd-conf--${conf}">
        <strong>Obtention :</strong>
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
        <strong>Récurrence :</strong>
        <span class="sd-recurrence__text">${escapeHtml(recurrencePhrase(r))}</span>
      </div>
      `;
    })()}

    ${(() => {
      const status = sprite.dataStatus;
      const safeStatus = ["incomplete", "needs_review", "unverified", "disputed", "archived"].includes(status) ? status : "unknown";
      if (status === "complete") return "";
      const label = {
        incomplete: "Fiche incomplète",
        needs_review: "À réviser",
        unverified: "Non vérifié",
        disputed: "Contesté",
        archived: "Archivé"
      }[status] || `Statut : ${safeText(status, "inconnu")}`;
      const missing = (sprite.missingFields || []).join(", ") || "informations incomplètes";
      return `
      <div class="sd-data-status sd-data-status--${safeStatus}">
        <strong>${escapeHtml(label)}</strong>
        <span class="sd-data-status__missing">Champs manquants : ${escapeHtml(missing)}</span>
      </div>
      `;
    })()}

    ${(() => {
      // Étape 20 — Dates de vérification affichées honnêtement.
      const dates = sprite.dates || {};
      const last = formatDateFr(dates.lastVerifiedAt);
      const official = formatDateFr(dates.officiallyAnnouncedAt);
      const first = formatDateFr(dates.firstObservedAt);
      return `
      <div class="sd-dates">
        <strong>Vérifications :</strong>
        ${last ? `<span class="sd-dates__item sd-dates__last">Dernière vérification : ${last}</span>` : ""}
        ${official ? `<span class="sd-dates__item">Annonce officielle : ${official}</span>` : ""}
        ${first ? `<span class="sd-dates__item">Première observation : ${first}</span>` : ""}
        ${!last && !official && !first ? `<span class="sd-dates__item sd-dates__unknown">Aucune date de vérification connue</span>` : ""}
      </div>
      `;
    })()}

    ${(() => {
      // Étape 20 — Sources et fiabilité.
      const sources = sprite.sources || [];
      if (!sources.length) {
        return `
        <div class="sd-sources sd-conf--unknown">
          <strong>Sources :</strong>
          <span class="sd-sources__list">Aucune source référencée</span>
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
        <strong>Sources :</strong>
        <span class="sd-sources__list">${items}</span>
      </div>
      `;
    })()}

    <div class="sd-progress">
      <div class="sd-progress__text">${owned} / ${total} variantes possédées</div>
      <div class="sd-progress__bar">
        <div class="sd-progress__fill" style="width:${pct}%"></div>
      </div>
      <span class="sd-progress__pct">${pct}%</span>
    </div>

    <div id="spriteDetailCommunity" class="sg-community-mount"></div>

    <div class="sd-variants">
      <h3 class="sd-section-title">Variantes</h3>
      ${variants.map(v => {
        const prio = v.entry.priority || "none";
        const masteryLevel = masteryLevelFor(v.entry);
        const prioBadge = prio !== "none" && prio !== "ignored"
          ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(prio)}">${priorityLabel(prio)}</span>`
          : "";
        const dateObt = v.entry.obtainedAt
          ? `<span class="sd-variant__date">${new Date(v.entry.obtainedAt).toLocaleDateString("fr-FR")}</span>`
          : "";
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
                <span class="sd-variant__mastery-label">${masteryLevel === 5 ? "♛ Master" : `Niv. ${masteryLevel}/5`}</span>
                <div class="sd-variant__mastery-levels" role="group" aria-label="Choisir un niveau de maîtrise">
                  ${Array.from({ length: 5 }, (_, index) => {
                    const level = index + 1;
                    const isMaster = level === 5;
                    return `<button type="button" class="sd-mastery-btn ${level <= masteryLevel ? "is-active" : ""} ${isMaster ? "is-master" : ""}" data-id="${escapeHtml(String(v.id || ""))}" data-detail-mastery-level="${level}" title="${isMaster ? "Niveau Master" : `Niveau ${level}`}" aria-label="${isMaster ? "Niveau Master" : `Niveau ${level}`}" aria-pressed="${level === masteryLevel}">${isMaster ? "♛" : level}</button>`;
                  }).join("")}
                </div>
              </div>
            ` : ""}
            <div class="sd-variant__actions">
              <select class="sd-status-select" data-id="${escapeHtml(String(v.id || ""))}">
                <option value="new" ${v.entry.status === "new" ? "selected" : ""}>Non classé</option>
                <option value="owned" ${v.entry.status === "owned" ? "selected" : ""}>Possédé</option>
                <option value="missing" ${v.entry.status === "missing" ? "selected" : ""}>Manquant</option>
                <option value="priority" ${v.entry.status === "priority" ? "selected" : ""}>Prioritaire</option>
                <option value="unsure" ${v.entry.status === "unsure" ? "selected" : ""}>À vérifier</option>
                <option value="unknown" ${v.entry.status === "unknown" ? "selected" : ""}>Inconnu</option>
                <option value="spotted" ${v.entry.status === "spotted" ? "selected" : ""}>Rare vu</option>
                <option value="unavailable" ${v.entry.status === "unavailable" ? "selected" : ""}>Indispo</option>
              </select>
              <select class="sd-prio-select" data-id="${escapeHtml(String(v.id || ""))}">
                <option value="none" ${prio === "none" ? "selected" : ""}>— Prio</option>
                <option value="urgent" ${prio === "urgent" ? "selected" : ""}>Urgent</option>
                <option value="important" ${prio === "important" ? "selected" : ""}>Important</option>
                <option value="medium" ${prio === "medium" ? "selected" : ""}>Moyen</option>
                <option value="low" ${prio === "low" ? "selected" : ""}>Faible</option>
                <option value="ignored" ${prio === "ignored" ? "selected" : ""}>Ignoré</option>
              </select>
              <button type="button" class="sd-date-btn" data-id="${escapeHtml(String(v.id || ""))}" title="Date d'obtention">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </button>
            </div>
          </div>
        `;
      }).join("")}
    </div>

    <div class="sd-notes">
      <h3 class="sd-section-title">Notes</h3>
      ${variants.filter(v => v.entry.note).map(v => `
        <div class="sd-note">
          <strong>${escapeHtml(v.name)} :</strong> ${escapeHtml(v.entry.note)}
        </div>
      `).join("") || `<p class="sd-empty">Aucune note pour ce sprite.</p>`}
    </div>

    <div class="sd-dates">
      <h3 class="sd-section-title">Dates d'obtention</h3>
      ${variants.filter(v => v.entry.obtainedAt).map(v => `
        <div class="sd-date-row">
          <span>${escapeHtml(v.name)}</span>
          <span>${new Date(v.entry.obtainedAt).toLocaleDateString("fr-FR")}</span>
        </div>
      `).join("") || `<p class="sd-empty">Aucune date enregistrée.</p>`}
    </div>
  `;

  if (!els.spriteDetailDialog.open) els.spriteDetailDialog.showModal();
  // Étape 77–80 — community block after modal open.
  if (typeof loadSpriteDetailCommunity === "function") {
    loadSpriteDetailCommunity(spriteId);
  }
}
