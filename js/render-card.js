function renderSummary() {
  const stats = getStats();
  els.ownedCount.textContent = stats.owned;
  els.totalCount.textContent = stats.total;
  els.percentCount.textContent = `${stats.percent}%`;
  els.ring.style.setProperty("--progress", `${stats.percent * 3.6}deg`);
}

function buildDeck() {
  const filter = els.deckFilter.value;
  let deck = getAllItems();
  if (filter !== "all") {
    deck = deck.filter((item) => getEntry(item.id).status === filter);
  }
  state.currentDeck = deck;
  if (state.currentIndex >= deck.length) state.currentIndex = 0;
  renderCard();
}

function shuffleDeck() {
  for (let i = state.currentDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.currentDeck[i], state.currentDeck[j]] = [state.currentDeck[j], state.currentDeck[i]];
  }
  state.currentIndex = 0;
  renderCard();
  toast("Deck mélangé");
}

function currentItem() {
  return state.currentDeck[state.currentIndex];
}

function renderCard() {
  const item = currentItem();
  els.card.classList.remove("out", "out-left", "out-right", "out-up", "out-down");
  els.card.style.setProperty("--tx", "0px");
  els.card.style.setProperty("--ty", "0px");
  els.card.style.setProperty("--rot", "0deg");
  els.swipeBadge.classList.remove("visible");
  els.card.style.animation = "none";
  els.card.offsetHeight;
  els.card.style.animation = "";

  if (!item) {
    els.cardAvatar.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/><circle cx="12" cy="12" r="10"/></svg>';
    els.cardRarity.textContent = "Terminé";
    els.cardName.textContent = "Deck vide";
    els.cardVariant.textContent = "Change le filtre";
    els.cardEffect.textContent = "Aucune carte à afficher avec ce filtre.";
    els.cardStatus.textContent = "Statut : —";
    els.cardIndex.textContent = "0/0";
    els.cardProgress.style.display = "none";
    els.card.style.setProperty("--card-color", "rgba(141, 124, 255, 0.42)");
    return;
  }

  const entry = getEntry(item.id);
  els.cardAvatar.innerHTML = item.img ? `<img src="${item.img}" alt="${item.spriteName}" class="avatar-img" />` : `<span class="avatar-placeholder">?</span>`;
  els.cardRarity.textContent = item.rarity;
  els.cardRarity.setAttribute("data-rarity", item.rarity);
  els.card.setAttribute("data-rarity", item.rarity);
  els.cardName.textContent = item.spriteName;
  els.cardVariant.textContent = item.variant;
  els.cardEffect.textContent = `${item.effect} ${item.variant !== "Base" ? `Bonus variante : ${item.variantBonus}` : ""}`;
  els.cardStatus.innerHTML = `${statusEmoji(entry.status)} ${statusLabel(entry.status)}`;
  els.cardIndex.textContent = `${state.currentIndex + 1}/${state.currentDeck.length}`;
  els.card.style.setProperty("--card-color", item.color);

  const sprite = SPRITES.find(s => s.id === item.spriteId);
  if (sprite) {
    const totalVariants = sprite.variants.length;
    const ownedVariants = sprite.variants.filter(v => getEntry(variantId(sprite.id, v)).status === "owned").length;
    const pct = totalVariants ? Math.round((ownedVariants / totalVariants) * 100) : 0;
    els.cardProgressText.textContent = `${ownedVariants} / ${totalVariants}`;
    els.cardProgressFill.style.width = `${pct}%`;
    els.cardProgress.style.display = "";
  }
}

function nextCard() {
  if (!state.currentDeck.length) return;
  state.currentIndex = (state.currentIndex + 1) % state.currentDeck.length;
  renderCard();
}

function setBadge(label, color) {
  els.swipeBadge.textContent = label;
  els.swipeBadge.style.setProperty("--swipe-color", color);
  els.swipeBadge.classList.add("visible");
}

function clearBadge() {
  els.swipeBadge.classList.remove("visible");
}

function markCurrent(status) {
  const item = currentItem();
  if (!item) return;
  setEntry(item.id, { status });
  toast(`${item.spriteName} ${item.variant} : ${statusLabel(status)}`);

  if (status === "owned") {
    state.currentDeck.splice(state.currentIndex, 1);
    if (state.currentIndex >= state.currentDeck.length) state.currentIndex = 0;
  } else {
    const [moved] = state.currentDeck.splice(state.currentIndex, 1);
    state.currentDeck.push(moved);
    if (state.currentIndex >= state.currentDeck.length) state.currentIndex = 0;
  }

  renderSummary();
  renderChecklist();
  renderMissing();
  renderStats();
  setTimeout(() => renderCard(), 80);
}

function animateAndMark(status, direction) {
  const item = currentItem();
  if (!item) return;
  const cfg = SWIPE_CONFIG[direction ?? status];
  setBadge(cfg.label, cfg.color);
  els.card.classList.add("out", cfg.dir);
  els.card.style.setProperty("--tx", `${cfg.x}px`);
  els.card.style.setProperty("--ty", `${cfg.y}px`);
  els.card.style.setProperty("--rot", `${cfg.rot}deg`);
  setTimeout(() => markCurrent(status), 320);
}
