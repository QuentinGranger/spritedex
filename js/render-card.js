function renderSummary() {
  const stats = getStats();
  els.ownedCount.textContent = stats.owned;
  els.totalCount.textContent = stats.total;
  els.percentCount.textContent = `${stats.percent}%`;
  els.ring.style.setProperty("--progress", `${stats.percent * 3.6}deg`);

  const desktopOwned = document.getElementById("desktopOwnedCount");
  const desktopTotal = document.getElementById("desktopTotalCount");
  const desktopRemaining = document.getElementById("desktopRemainingCount");
  const desktopProgress = document.getElementById("desktopCollectionProgress");
  if (desktopOwned) desktopOwned.textContent = stats.owned;
  if (desktopTotal) desktopTotal.textContent = stats.total;
  if (desktopRemaining) desktopRemaining.textContent = Math.max(0, stats.total - stats.owned);
  if (desktopProgress) desktopProgress.style.width = `${stats.percent}%`;
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
  toast(t("swipe.shuffled"));
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
    els.cardRarity.textContent = t("swipe.done");
    els.cardName.textContent = t("swipe.emptyDeck");
    els.cardVariant.textContent = t("swipe.changeFilter");
    els.cardEffect.textContent = t("swipe.noCards");
    els.cardStatus.textContent = t("swipe.statusDash");
    els.cardIndex.textContent = "0/0";
    els.cardProgress.style.display = "none";
    if (els.cardMastery) els.cardMastery.hidden = true;
    els.card.style.setProperty("--card-color", "rgba(141, 124, 255, 0.42)");
    return;
  }

  const entry = getEntry(item.id);
  const imageUrl = safeImageUrl(item.img);
  els.cardAvatar.innerHTML = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.spriteName)}" class="avatar-img" />` : `<span class="avatar-placeholder">?</span>`;
  els.cardRarity.textContent = item.rarity;
  els.cardRarity.setAttribute("data-rarity", item.rarity);
  els.card.setAttribute("data-rarity", item.rarity);
  els.cardName.textContent = item.spriteName;
  els.cardVariant.textContent = item.variant;
  els.cardEffect.textContent = `${item.effect} ${item.variant !== "Base" ? t("swipe.variantBonus", { bonus: item.variantBonus }) : ""}`;
  els.cardStatus.innerHTML = `${statusEmoji(entry.status)} ${statusLabel(entry.status)}`;
  els.cardIndex.textContent = `${state.currentIndex + 1}/${state.currentDeck.length}`;
  els.card.style.setProperty("--card-color", safeCssColor(item.color));

  if (els.cardMastery && els.cardMasteryLabel && els.cardMasteryLevels) {
    const level = masteryLevelFor(entry);
    els.cardMastery.hidden = level === 0;
    if (level > 0) {
      const isMaster = level === 5;
      els.cardMastery.classList.toggle("card-mastery--master", isMaster);
      els.cardMasteryLabel.textContent = isMaster ? t("mastery.cardMaster") : t("mastery.levelOf", { level });
      els.cardMasteryLevels.innerHTML = Array.from({ length: 5 }, (_, index) => {
        const currentLevel = index + 1;
        const active = currentLevel <= level;
        const master = currentLevel === 5;
        const aria = master ? t("swipe.masteryAriaMaster", { level: currentLevel }) : t("swipe.masteryAriaLevel", { level: currentLevel });
        return `<button type="button" class="card-mastery__level ${active ? "is-active" : ""} ${master ? "is-master" : ""}" data-card-mastery="${currentLevel}" aria-label="${escapeHtml(aria)}" aria-pressed="${currentLevel === level}">${master ? "♛" : currentLevel}</button>`;
      }).join("");
    }
  }

  const sprite = SPRITES.find(s => s.id === item.spriteId);
  if (sprite) {
    const vList = (typeof getVariantList === "function") ? getVariantList(sprite) : (Object.keys(sprite.variantDetails || {}).length ? Object.keys(sprite.variantDetails) : (sprite.variants || ["Base"]));
    const totalVariants = vList.length;
    const ownedVariants = vList.filter(v => getEntry(variantId(sprite.id, v)).status === "owned").length;
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
  toast(t("swipe.statusToast", { name: item.spriteName, variant: item.variant, status: statusLabel(status) }));

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
