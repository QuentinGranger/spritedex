function itemMatchesMissingEventFilter(item, filter) {
  if (!filter) return true;
  if (Array.isArray(filter.variantIds) && filter.variantIds.length) {
    const id = String(item.id || item.variantId || "");
    if (filter.variantIds.map(String).includes(id)) return true;
  }
  if (filter.eventId) {
    const sprite = SPRITES.find(s => s.id === item.spriteId);
    return !!(sprite && String(sprite.eventId) === String(filter.eventId));
  }
  return true;
}

function missingPriorityValue(entry) {
  if (entry.priority && entry.priority !== "none" && entry.priority !== "ignored") return entry.priority;
  // A status selected from Swipe has no granular priority yet. Keep it visible
  // in the farm plan, with a sensible neutral default.
  return entry.status === "priority" ? "medium" : "none";
}

function isMissingPriority(entry) {
  return missingPriorityValue(entry) !== "none";
}

function sortMissingItems(items) {
  const rarityOrder = { mythic: 0, legendary: 1, epic: 2, rare: 3, uncommon: 4, common: 5, base: 6 };
  const sort = state.missingSort || "priority";
  return [...items].sort((a, b) => {
    if (sort === "priority") {
      const byPriority = priorityOrder(missingPriorityValue(getEntry(a.id))) - priorityOrder(missingPriorityValue(getEntry(b.id)));
      if (byPriority) return byPriority;
    } else if (sort === "rarity") {
      const byRarity = (rarityOrder[String(a.rarity || "").toLowerCase()] ?? 99) - (rarityOrder[String(b.rarity || "").toLowerCase()] ?? 99);
      if (byRarity) return byRarity;
    } else if (sort === "variant") {
      const byVariant = String(a.variant || "").localeCompare(String(b.variant || ""), "fr");
      if (byVariant) return byVariant;
    }
    return String(a.spriteName || "").localeCompare(String(b.spriteName || ""), "fr");
  });
}

function getVisibleMissingItems() {
  const eventFilter = state.missingEventFilter;
  const query = String(state.missingSearch || "").trim().toLocaleLowerCase("fr");
  const filter = state.missingFilter || "all";
  return sortMissingItems(getAllItems().filter((item) => {
    const entry = getEntry(item.id);
    if (!isCollectibleMissingStatus(entry.status)) return false;
    if (eventFilter && (!isMissingPriority(entry) || !itemMatchesMissingEventFilter(item, eventFilter))) return false;
    if (filter === "priority" && !isMissingPriority(entry)) return false;
    if (filter === "spotted" && entry.status !== "spotted") return false;
    if (filter === "missing" && entry.status !== "missing") return false;
    if (!query) return true;
    return [item.spriteName, item.variant, item.rarity, item.effect].some(value => String(value || "").toLocaleLowerCase("fr").includes(query));
  }));
}

function renderMissing() {
  const allItems = getAllItems();
  const eventFilter = state.missingEventFilter;
  const allMissing = allItems.filter(item => isCollectibleMissingStatus(getEntry(item.id).status));
  const notOwned = getVisibleMissingItems();
  const hasControls = Boolean(String(state.missingSearch || "").trim()) || state.missingFilter !== "all" || state.missingSort !== "priority";
  const search = document.getElementById("missingSearch");
  const sort = document.getElementById("missingSort");
  const reset = document.getElementById("clearMissingFilters");
  const copy = document.getElementById("copyMissing");
  const status = document.getElementById("missingResultsStatus");

  if (search && search.value !== state.missingSearch) search.value = state.missingSearch;
  if (sort) sort.value = state.missingSort || "priority";
  if (reset) reset.hidden = !hasControls;
  if (copy) copy.disabled = !notOwned.length;
  document.querySelectorAll("[data-missing-filter]").forEach((chip) => {
    const active = chip.dataset.missingFilter === (state.missingFilter || "all");
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  });
  if (status) status.textContent = `${notOwned.length} variante${notOwned.length > 1 ? "s" : ""} affichée${notOwned.length > 1 ? "s" : ""}${notOwned.length !== allMissing.length ? ` sur ${allMissing.length} à obtenir` : " à obtenir"}.`;

  if (!notOwned.length) {
    const title = eventFilter
      ? "Aucune priorité manquante pour cet événement."
      : allMissing.length
        ? "Aucun résultat avec ces filtres."
        : "Collection terminée : aucune variante à farmer.";
    els.missingList.innerHTML = `
      <div class="missing-empty" role="status">
        <span class="missing-empty__icon" aria-hidden="true">${allMissing.length ? "⌕" : "✓"}</span>
        <h3>${escapeHtml(title)}</h3>
        <p>${allMissing.length ? "Essaie une autre recherche ou réinitialise tes filtres." : "Les prochaines variantes à sortir apparaîtront ici."}</p>
        <div class="missing-empty__actions">
          ${eventFilter ? '<button type="button" class="ghost-button" data-missing-action="clear-event">Voir tous les manquants</button>' : ""}
          ${hasControls ? '<button type="button" class="ghost-button" data-missing-action="reset">Réinitialiser les filtres</button>' : ""}
          ${!allMissing.length ? '<button type="button" class="ghost-button" data-missing-action="checklist">Voir la checklist</button>' : ""}
        </div>
      </div>`;
    return;
  }

  const withPrio = notOwned.filter(item => isMissingPriority(getEntry(item.id)));
  const urgent = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "urgent");
  const important = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "important");
  const mediumPrio = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "medium");
  const lowPrio = withPrio.filter(item => missingPriorityValue(getEntry(item.id)) === "low");
  const spotted = notOwned.filter(item => getEntry(item.id).status === "spotted" && !isMissingPriority(getEntry(item.id)));
  const prioritizedIds = new Set([...withPrio, ...spotted].map(i => i.id));
  const variantGroups = createSafeRecord();
  for (const item of notOwned.filter(item => !prioritizedIds.has(item.id))) {
    (variantGroups[item.variant] ||= []).push(item);
  }

  const total = allItems.length;
  const owned = allItems.filter(item => getEntry(item.id).status === "owned").length;
  const eventName = eventFilter && eventFilter.eventId && typeof EVENTS !== "undefined" ? (EVENTS[eventFilter.eventId]?.name || eventFilter.eventId) : null;
  let html = eventFilter ? `<div class="farm-event-filter" id="missingEventFilterBanner"><div class="farm-event-filter__text">Priorités manquantes${eventName ? ` · ${escapeHtml(eventName)}` : " pour l'événement"}</div><button type="button" class="ghost-button" data-missing-action="clear-event">Tout afficher</button></div>` : "";
  html += `<div class="farm-summary"><div class="farm-summary__count"><strong>${notOwned.length}</strong> ${eventFilter ? "priorités à farmer" : "variantes affichées"}</div><div class="farm-summary__bar" aria-label="Progression de collection : ${total ? Math.round((owned / total) * 100) : 0}%"><div class="farm-summary__fill" style="width:${total ? Math.round((owned / total) * 100) : 0}%"></div></div><p class="farm-summary__pct">${owned}/${total} collectés · ${total ? Math.round((owned / total) * 100) : 0}%${notOwned.length !== allMissing.length ? ` · ${allMissing.length} à obtenir au total` : ""}</p></div>`;

  [["Urgent — À farmer maintenant", "urgent", urgent], ["Important — À récupérer bientôt", "important", important], ["Moyen — À planifier", "medium", mediumPrio], ["Faible — Bonus", "low", lowPrio], ["Rares trouvés (vus mais pas obtenus)", "spotted", spotted]].forEach(([title, type, items]) => { if (items.length) html += renderMissingSection(title, type, items); });
  Object.keys(VARIANT_META).forEach((name) => { if (variantGroups[name]?.length) { html += renderMissingSection(`Variantes ${VARIANT_META[name]?.label || name} manquantes`, name.toLowerCase(), variantGroups[name]); delete variantGroups[name]; } });
  Object.entries(variantGroups).forEach(([name, items]) => { if (items.length) html += renderMissingSection(`Variantes ${name} manquantes`, "other", items); });
  els.missingList.innerHTML = html;
}

function renderMissingSection(title, type, items) {
  const safeType = /^[a-z0-9_-]{1,40}$/i.test(type) ? type : "other";
  const sectionId = `missing-section-${safeType}`;
  const collapsed = Boolean(state.missingCollapsedSections[sectionId]);
  return `<section class="farm-section farm-section--${safeType}"><h3 class="farm-section__title"><button type="button" class="farm-section__toggle" data-missing-section="${safeType}" aria-expanded="${!collapsed}" aria-controls="${sectionId}">${escapeHtml(title)} <span class="farm-section__count">${items.length}</span><span class="sr-only">${collapsed ? "Développer" : "Réduire"} cette section</span></button></h3><div class="farm-section__list" id="${sectionId}" ${collapsed ? "hidden" : ""}>${items.map(renderMissingItem).join("")}</div></section>`;
}

function renderMissingItem(item) {
  const entry = getEntry(item.id);
  const img = safeImageUrl(item.img);
  const priority = missingPriorityValue(entry);
  const prioBadge = priority !== "none" ? `<span class="farm-item__prio" style="--prio-color:${priorityColor(priority)}">${escapeHtml(priorityLabel(priority))}</span>` : "";
  const label = `${item.spriteName} · ${item.variant}`;
  return `<article class="farm-item" data-id="${escapeHtml(String(item.id || ""))}"><div class="farm-item__avatar">${img ? `<img src="${escapeHtml(img)}" class="farm-item__img" alt="" />` : "<span aria-hidden=\"true\">?</span>"}</div><div class="farm-item__info"><span class="farm-item__name">${escapeHtml(item.spriteName)}</span><span class="farm-item__variant">${escapeHtml(item.variant)} ${prioBadge}</span></div><span class="farm-item__rarity">${escapeHtml(item.rarity)}</span><div class="farm-item__status" aria-label="Statut : ${escapeHtml(statusLabel(entry.status))}">${statusEmoji(entry.status)}</div><div class="farm-item__actions"><button class="farm-item__detail" type="button" data-missing-detail="${escapeHtml(String(item.id || ""))}" aria-label="Voir la fiche de ${escapeHtml(label)}">Détails</button><button class="farm-item__priority" type="button" data-missing-priority="${escapeHtml(String(item.id || ""))}" aria-pressed="${priority !== "none"}" title="${priority === "none" ? "Ajouter aux priorités" : "Retirer des priorités"}">${priority === "none" ? "☆" : "★"}<span class="sr-only">${priority === "none" ? "Ajouter" : "Retirer"} ${escapeHtml(label)} des priorités</span></button><button class="farm-item__mark" type="button" data-id="${escapeHtml(String(item.id || ""))}" data-status="owned" title="Marquer ${escapeHtml(label)} comme possédé" aria-label="Marquer ${escapeHtml(label)} comme possédé"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></button></div></article>`;
}

function resetMissingControls() {
  state.missingSearch = "";
  state.missingFilter = "all";
  state.missingSort = "priority";
  renderMissing();
}

function copyCurrentMissingList() {
  const items = getVisibleMissingItems();
  const lines = [`Liste Sprite Index — ${items.length} variante${items.length > 1 ? "s" : ""} à obtenir`, "", ...items.map((item) => `- ${item.spriteName} · ${item.variant}${isMissingPriority(getEntry(item.id)) ? ` (${priorityLabel(missingPriorityValue(getEntry(item.id)))})` : ""}`)];
  if (!navigator.clipboard?.writeText) {
    toast("Copie impossible sur ce navigateur");
    return;
  }
  navigator.clipboard.writeText(lines.join("\n")).then(
    () => toast("Liste visible copiée"),
    () => toast("Copie impossible sur ce navigateur")
  );
}
