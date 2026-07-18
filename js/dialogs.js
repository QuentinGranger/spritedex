function openDetail(itemId) {
  const item = getAllItems().find((candidate) => candidate.id === itemId);
  if (!item) return;
  const entry = getEntry(item.id);
  state.activeDetailId = item.id;
  els.dialogAvatar.innerHTML = item.img ? `<img src="${item.img}" alt="${item.spriteName}" class="avatar-img" />` : `<span class="avatar-placeholder">?</span>`;
  els.dialogAvatar.style.setProperty("--card-color", item.color);
  els.dialogRarity.textContent = item.rarity;
  els.dialogTitle.textContent = item.spriteName;
  els.dialogVariant.textContent = `${item.variant} · ${statusLabel(entry.status)}`;
  els.dialogEffect.textContent = `${item.effect} ${item.variant !== "Base" ? `Bonus variante : ${item.variantBonus}` : ""}`;
  els.dialogNote.value = entry.note ?? "";

  document.querySelectorAll("#dialogPriorityBar .prio-chip").forEach(chip => {
    chip.classList.toggle("active", chip.dataset.prio === (entry.priority || "none"));
  });

  els.dialog.showModal();
}

function saveDialogNote() {
  if (!state.activeDetailId) return;
  setEntry(state.activeDetailId, { note: els.dialogNote.value });
}

function openSpriteDetail(spriteId) {
  const sprite = SPRITES.find(s => s.id === spriteId);
  if (!sprite) return;

  const variants = sprite.variants.map(v => ({
    id: variantId(sprite.id, v),
    name: v,
    entry: getEntry(variantId(sprite.id, v)),
    img: getSpriteImg(sprite.id, v)
  }));
  const owned = variants.filter(v => v.entry.status === "owned").length;
  const total = variants.length;
  const pct = total ? Math.round((owned / total) * 100) : 0;
  const baseImg = getSpriteImg(sprite.id, "Base");
  const isFavorite = state.collection[`fav_${sprite.id}`] === true;

  els.spriteDetailContent.innerHTML = `
    <div class="sd-header" style="--card-color:${sprite.color}">
      <div class="sd-avatar">${baseImg ? `<img src="${baseImg}" class="sd-avatar__img" />` : `<span>?</span>`}</div>
      <div class="sd-header__info">
        <h2 class="sd-title">${sprite.name}</h2>
        <div class="sd-meta">
          <span class="sd-rarity">${sprite.rarity}</span>
          ${sprite.confidence ? `<span class="sd-confidence sd-confidence--${sprite.confidence}">${sprite.confidence}</span>` : ""}
        </div>
        <button type="button" class="sd-fav ${isFavorite ? "active" : ""}" data-fav="${sprite.id}" title="Favori">
          <svg viewBox="0 0 24 24" fill="${isFavorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
      </div>
    </div>

    <div class="sd-effect">
      <strong>Effet :</strong> ${sprite.effect}
    </div>

    ${sprite.season ? `
    <div class="sd-season">
      <strong>Saison :</strong>
      <span class="sd-season__name">${sprite.season.name || `Chapitre ${sprite.season.chapter} — Saison ${sprite.season.season}`}</span>
      ${sprite.season.startDate ? `<span class="sd-season__dates">${new Date(sprite.season.startDate).toLocaleDateString("fr-FR")}${sprite.season.endDate ? ` → ${new Date(sprite.season.endDate).toLocaleDateString("fr-FR")}` : ""}</span>` : ""}
    </div>
    ` : ""}

    ${sprite.event ? `
    <div class="sd-event">
      <strong>Événement :</strong>
      <span class="sd-event__name">${sprite.event.name || sprite.event.id}</span>
      ${sprite.event.type ? `<span class="sd-event__type">${sprite.event.type}</span>` : ""}
      ${sprite.event.startDate ? `<span class="sd-event__dates">${new Date(sprite.event.startDate).toLocaleDateString("fr-FR")}${sprite.event.endDate ? ` → ${new Date(sprite.event.endDate).toLocaleDateString("fr-FR")}` : ""}</span>` : ""}
    </div>
    ` : ""}

    ${(() => {
      const r = sprite.recurrence;
      if (!r || r.status === "unknown") return "";
      let text = "Récurrence inconnue.";
      if (r.status === "confirmed_recurring" && r.officiallyConfirmed) text = "Retour confirmé par Epic Games.";
      else if (r.status === "confirmed_recurring") text = "Retour probable.";
      else if (r.status === "possible_return") text = "Retour possible, mais non confirmé par Epic Games.";
      else if (r.status === "not_confirmed") text = "Aucun retour prévu ou confirmé.";
      return `
      <div class="sd-recurrence">
        <strong>Récurrence :</strong>
        <span class="sd-recurrence__text">${text}</span>
      </div>
      `;
    })()}

    ${(() => {
      const status = sprite.dataStatus;
      if (status === "complete") return "";
      const label = {
        incomplete: "Fiche incomplète",
        needs_review: "À réviser",
        unverified: "Non vérifié",
        disputed: "Contesté",
        archived: "Archivé"
      }[status] || `Statut : ${status}`;
      const missing = (sprite.missingFields || []).join(", ") || "informations incomplètes";
      return `
      <div class="sd-data-status sd-data-status--${status}">
        <strong>${label}</strong>
        <span class="sd-data-status__missing">Champs manquants : ${missing}</span>
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

    <div class="sd-variants">
      <h3 class="sd-section-title">Variantes</h3>
      ${variants.map(v => {
        const prio = v.entry.priority || "none";
        const prioBadge = prio !== "none" && prio !== "ignored"
          ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(prio)}">${priorityLabel(prio)}</span>`
          : "";
        const dateObt = v.entry.obtainedAt
          ? `<span class="sd-variant__date">${new Date(v.entry.obtainedAt).toLocaleDateString("fr-FR")}</span>`
          : "";
        return `
          <div class="sd-variant ${v.entry.status === "owned" ? "sd-variant--owned" : ""}">
            <div class="sd-variant__thumb">${v.img ? `<img src="${v.img}" class="sd-variant__img" />` : `<span>?</span>`}</div>
            <div class="sd-variant__info">
              <span class="sd-variant__name">${v.name} ${prioBadge}</span>
              <div class="sd-variant__meta">
                ${statusEmoji(v.entry.status)} <span>${statusLabel(v.entry.status)}</span>
                ${dateObt}
              </div>
            </div>
            <div class="sd-variant__actions">
              <select class="sd-status-select" data-id="${v.id}">
                <option value="new" ${v.entry.status === "new" ? "selected" : ""}>Non classé</option>
                <option value="owned" ${v.entry.status === "owned" ? "selected" : ""}>Possédé</option>
                <option value="missing" ${v.entry.status === "missing" ? "selected" : ""}>Manquant</option>
                <option value="priority" ${v.entry.status === "priority" ? "selected" : ""}>Prioritaire</option>
                <option value="unsure" ${v.entry.status === "unsure" ? "selected" : ""}>À vérifier</option>
                <option value="spotted" ${v.entry.status === "spotted" ? "selected" : ""}>Rare vu</option>
                <option value="unavailable" ${v.entry.status === "unavailable" ? "selected" : ""}>Indispo</option>
              </select>
              <select class="sd-prio-select" data-id="${v.id}">
                <option value="none" ${prio === "none" ? "selected" : ""}>— Prio</option>
                <option value="urgent" ${prio === "urgent" ? "selected" : ""}>Urgent</option>
                <option value="important" ${prio === "important" ? "selected" : ""}>Important</option>
                <option value="medium" ${prio === "medium" ? "selected" : ""}>Moyen</option>
                <option value="low" ${prio === "low" ? "selected" : ""}>Faible</option>
                <option value="ignored" ${prio === "ignored" ? "selected" : ""}>Ignoré</option>
              </select>
              <button type="button" class="sd-date-btn" data-id="${v.id}" title="Date d'obtention">
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
          <strong>${v.name} :</strong> ${v.entry.note}
        </div>
      `).join("") || `<p class="sd-empty">Aucune note pour ce sprite.</p>`}
    </div>

    <div class="sd-dates">
      <h3 class="sd-section-title">Dates d'obtention</h3>
      ${variants.filter(v => v.entry.obtainedAt).map(v => `
        <div class="sd-date-row">
          <span>${v.name}</span>
          <span>${new Date(v.entry.obtainedAt).toLocaleDateString("fr-FR")}</span>
        </div>
      `).join("") || `<p class="sd-empty">Aucune date enregistrée.</p>`}
    </div>
  `;

  els.spriteDetailDialog.showModal();
}
