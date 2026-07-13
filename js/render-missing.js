function renderMissing() {
  const allItems = getAllItems();
  const notOwned = allItems.filter(item => {
    const status = getEntry(item.id).status;
    return status !== "owned" && status !== "unavailable";
  });

  if (!notOwned.length) {
    els.missingList.innerHTML = `<p class="empty-state">GG ! Tu as tout collecté.</p>`;
    return;
  }

  const withPrio = notOwned.filter(item => {
    const p = getEntry(item.id).priority;
    return p && p !== "none" && p !== "ignored";
  }).sort((a, b) => priorityOrder(getEntry(a.id).priority) - priorityOrder(getEntry(b.id).priority));

  const urgent = withPrio.filter(item => getEntry(item.id).priority === "urgent");
  const important = withPrio.filter(item => getEntry(item.id).priority === "important");
  const mediumPrio = withPrio.filter(item => getEntry(item.id).priority === "medium");
  const lowPrio = withPrio.filter(item => getEntry(item.id).priority === "low");
  const spotted = notOwned.filter(item => getEntry(item.id).status === "spotted" && !withPrio.includes(item));

  const prioritizedIds = new Set([...withPrio.map(i => i.id), ...spotted.map(i => i.id)]);
  const rest = notOwned.filter(item => !prioritizedIds.has(item.id));
  const variantGroups = {};
  for (const item of rest) {
    if (!variantGroups[item.variant]) variantGroups[item.variant] = [];
    variantGroups[item.variant].push(item);
  }

  const total = allItems.length;
  const owned = allItems.filter(item => getEntry(item.id).status === "owned").length;

  let html = `
    <div class="farm-summary">
      <div class="farm-summary__count">
        <strong>${notOwned.length}</strong> variantes à obtenir
      </div>
      <div class="farm-summary__bar">
        <div class="farm-summary__fill" style="width:${total ? Math.round((owned / total) * 100) : 0}%"></div>
      </div>
      <p class="farm-summary__pct">${owned}/${total} collectés · ${total ? Math.round((owned / total) * 100) : 0}%</p>
    </div>
  `;

  if (urgent.length) {
    html += renderMissingSection("Urgent — À farmer maintenant", "urgent", urgent);
  }
  if (important.length) {
    html += renderMissingSection("Important — À récupérer bientôt", "important", important);
  }
  if (mediumPrio.length) {
    html += renderMissingSection("Moyen — Pas prioritaire", "medium", mediumPrio);
  }
  if (lowPrio.length) {
    html += renderMissingSection("Faible — Bonus", "low", lowPrio);
  }

  if (spotted.length) {
    html += renderMissingSection("Rares trouvés (vus mais pas obtenus)", "spotted", spotted);
  }

  const variantOrder = Object.keys(VARIANT_META);
  for (const vName of variantOrder) {
    if (variantGroups[vName] && variantGroups[vName].length) {
      const label = VARIANT_META[vName]?.label || vName;
      html += renderMissingSection(`Variantes ${label} manquantes`, vName.toLowerCase(), variantGroups[vName]);
      delete variantGroups[vName];
    }
  }
  for (const [vName, items] of Object.entries(variantGroups)) {
    if (items.length) {
      html += renderMissingSection(`Variantes ${vName} manquantes`, "other", items);
    }
  }

  els.missingList.innerHTML = html;
}

function renderMissingSection(title, type, items) {
  return `
    <div class="farm-section farm-section--${type}">
      <h3 class="farm-section__title">${title} <span class="farm-section__count">${items.length}</span></h3>
      <div class="farm-section__list">
        ${items.map(item => {
          const entry = getEntry(item.id);
          const img = item.img;
          const prio = entry.priority || "none";
          const prioBadge = prio !== "none" && prio !== "ignored"
            ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(prio)}">${priorityLabel(prio)}</span>`
            : "";
          return `
            <div class="farm-item" data-id="${item.id}">
              <div class="farm-item__avatar">${img ? `<img src="${img}" class="farm-item__img" />` : `<span>?</span>`}</div>
              <div class="farm-item__info">
                <span class="farm-item__name">${item.spriteName}</span>
                <span class="farm-item__variant">${item.variant} ${prioBadge}</span>
              </div>
              <span class="farm-item__rarity">${item.rarity}</span>
              <div class="farm-item__status">${statusEmoji(entry.status)}</div>
              <button class="farm-item__mark" data-id="${item.id}" data-status="owned" title="Marquer possédé">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}
