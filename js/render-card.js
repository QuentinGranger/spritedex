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

function startSwipeSession(total = state.currentDeck.length) {
  state.swipeSession = {
    active: true,
    paused: false,
    total: Math.max(0, Number(total) || 0),
    processed: 0,
    actions: [],
    counts: Object.create(null),
    startedAt: Date.now()
  };
  renderSwipeSession();
}

function swipeSessionIsPaused() {
  return Boolean(state.swipeSession?.active && state.swipeSession.paused);
}

function renderSwipeSession() {
  const session = state.swipeSession || {};
  const root = document.getElementById("swipeSession");
  const progress = document.getElementById("swipeSessionProgress");
  const fill = document.getElementById("swipeSessionFill");
  const pause = document.getElementById("swipeSessionPause");
  const undo = document.getElementById("swipeSessionUndo");
  const summary = document.getElementById("swipeSessionSummary");
  const summaryTitle = document.getElementById("swipeSessionSummaryTitle");
  const summaryDetail = document.getElementById("swipeSessionSummaryDetail");
  if (!root || !progress || !fill || !pause || !undo || !summary) return;
  const total = Math.max(0, Number(session.total) || 0);
  const processed = Math.min(total, Math.max(0, Number(session.processed) || 0));
  const remaining = Math.max(0, total - processed);
  const complete = Boolean(session.active && total > 0 && remaining === 0);
  root.hidden = complete;
  progress.textContent = t("swipe.sessionProgress", { processed, remaining });
  fill.style.width = `${total ? Math.round((processed / total) * 100) : 0}%`;
  root.classList.toggle("is-paused", Boolean(session.paused));
  root.classList.toggle("is-complete", complete);
  pause.textContent = session.paused ? t("swipe.resume") : t("swipe.pause");
  pause.setAttribute("aria-pressed", String(Boolean(session.paused)));
  pause.disabled = !session.active || complete;
  undo.disabled = !session.actions?.length || swipeCommitInProgress;
  document.querySelectorAll(".swipe-actions .action").forEach((button) => {
    button.disabled = Boolean(session.paused || complete);
  });
  summary.hidden = !complete;
  if (complete) document.getElementById("swipeShortcutGuide")?.setAttribute("hidden", "");
  if (complete) {
    const owned = Number(session.counts?.owned) || 0;
    const priority = Number(session.counts?.priority) || 0;
    const missing = Number(session.counts?.missing) || 0;
    const unsure = Number(session.counts?.unsure) || 0;
    summaryTitle.textContent = t("swipe.sessionSummary", { count: processed, plural: processed === 1 ? "" : "s" });
    summaryDetail.textContent = t("swipe.sessionSummaryDetail", { owned, missing, priority, unsure });
  }
}

function buildDeck({ restartSession = true } = {}) {
  const filter = els.deckFilter.value;
  let deck = getAllItems();
  // The swipe flow removes an owned card from the active deck immediately.
  // Keep that promise after a refresh too: "Tous" means every card still to
  // process, while the explicit "Possédés" filter remains available to review
  // the collection.
  if (filter === "all") {
    deck = deck.filter((item) => getEntry(item.id).status !== "owned");
  } else {
    deck = deck.filter((item) => getEntry(item.id).status === filter);
  }
  state.currentDeck = deck;
  if (state.currentIndex >= deck.length) state.currentIndex = 0;
  if (restartSession) startSwipeSession(deck.length);
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

function keepSwipeScrollPosition(position) {
  if (!position) return;
  const restore = () => {
    const root = document.scrollingElement;
    if (!root) return;
    if (Math.abs(root.scrollTop - position.top) > 2 || Math.abs(root.scrollLeft - position.left) > 2) {
      root.scrollTo(position.left, position.top);
    }
  };
  // Rendering the lists can make a mobile browser adjust its scroll anchor on
  // the next paint. Restore both sides of that paint, not just immediately.
  restore();
  requestAnimationFrame(restore);
  requestAnimationFrame(() => requestAnimationFrame(restore));
}

let cardRenderToken = 0;

function revealFreshCard() {
  const token = cardRenderToken;
  // Two frames ensure the new content is committed while the shell is hidden
  // before the entrance animation can make it visible.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (token !== cardRenderToken) return;
    els.card.classList.remove("is-refreshing");
    els.card.classList.add("card-entering", "revealing");
  }));
}

function renderCard() {
  const item = currentItem();
  cardRenderToken += 1;
  els.card.classList.add("is-refreshing");
  els.card.classList.remove(
    "out", "out-left", "out-right", "out-up", "out-down",
    "dragging", "drag-left", "drag-right", "drag-up", "drag-down",
    "confirming", "confirm-owned", "confirm-missing", "confirm-priority", "confirm-unsure",
    "card-entering", "revealing"
  );
  els.card.style.setProperty("--tx", "0px");
  els.card.style.setProperty("--ty", "0px");
  els.card.style.setProperty("--rot", "0deg");
  els.card.style.setProperty("--swipe-intensity", "0");
  els.swipeBadge.classList.remove("visible");
  renderSwipeSession();

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
    revealFreshCard();
    return;
  }

  const entry = getEntry(item.id);
  const imageUrl = safeImageUrl(item.img);
  els.cardAvatar.innerHTML = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.spriteName)}" class="avatar-img" />` : `<span class="avatar-placeholder">?</span>`;
  els.cardRarity.textContent = localizedRarity(item.rarity);
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
    const spriteItems = getReleasedCollectionItems(getAllItems().filter((candidate) => String(candidate.spriteId) === String(sprite.id)));
    const totalVariants = spriteItems.length;
    const ownedVariants = spriteItems.filter((candidate) => getEntry(candidate.id).status === "owned").length;
    const pct = collectionPercent(ownedVariants, totalVariants);
    if (totalVariants) {
      els.cardProgressText.textContent = `${ownedVariants} / ${totalVariants}`;
      els.cardProgressFill.style.width = `${pct}%`;
      els.cardProgress.style.display = "";
    } else {
      els.cardProgress.style.display = "none";
    }
  }

  revealFreshCard();
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

function markCurrent(status, { alreadyPersisted = false, scrollPosition = null } = {}) {
  const item = currentItem();
  if (!item) return;
  if (!alreadyPersisted) setEntry(item.id, { status });
  toast(t("swipe.statusToast", { name: item.spriteName, variant: item.variant, status: statusLabel(status) }));

  const session = state.swipeSession;
  if (session?.active) {
    state.currentDeck.splice(state.currentIndex, 1);
    if (state.currentIndex >= state.currentDeck.length) state.currentIndex = 0;
    session.processed = Math.min(session.total, (Number(session.processed) || 0) + 1);
    session.counts[status] = (Number(session.counts[status]) || 0) + 1;
  } else if (status === "owned") {
    state.currentDeck.splice(state.currentIndex, 1);
    if (state.currentIndex >= state.currentDeck.length) state.currentIndex = 0;
  } else {
    const [moved] = state.currentDeck.splice(state.currentIndex, 1);
    state.currentDeck.push(moved);
    if (state.currentIndex >= state.currentDeck.length) state.currentIndex = 0;
  }

  renderSummary();
  if (typeof markCollectionViewsDirty === "function") {
    markCollectionViewsDirty();
    state.homeViewDirty = true;
  } else {
    // Safety net for standalone embeds that do not load the navigation module.
    renderChecklist();
    renderMissing();
    renderStats();
  }
  keepSwipeScrollPosition(scrollPosition);
  requestAnimationFrame(renderCard);
}

function recordSwipeSessionAction(item, status, previousEntry) {
  const session = state.swipeSession;
  if (!session?.active || !item) return;
  session.actions.push({ item: { ...item }, status, previousEntry: { ...previousEntry } });
  if (session.actions.length > 100) session.actions.shift();
  renderSwipeSession();
}

function undoSwipeSessionAction() {
  const session = state.swipeSession;
  if (!session?.actions?.length || swipeCommitInProgress) return;
  const action = session.actions.pop();
  if (!action?.item?.id) return;
  setEntry(action.item.id, action.previousEntry, { render: false });
  const insertAt = Math.min(Math.max(0, state.currentIndex), state.currentDeck.length);
  state.currentDeck.splice(insertAt, 0, action.item);
  state.currentIndex = insertAt;
  session.processed = Math.max(0, (Number(session.processed) || 0) - 1);
  session.counts[action.status] = Math.max(0, (Number(session.counts[action.status]) || 0) - 1);
  renderSummary();
  if (typeof markCollectionViewsDirty === "function") {
    markCollectionViewsDirty();
    state.homeViewDirty = true;
  }
  renderSwipeSession();
  renderCard();
  toast(t("swipe.undoDone"));
}

function toggleSwipeSessionPause() {
  const session = state.swipeSession;
  if (!session?.active || session.processed >= session.total) return;
  session.paused = !session.paused;
  renderSwipeSession();
  toast(session.paused ? t("swipe.paused") : t("swipe.resumed"));
}

let swipeCommitInProgress = false;

function animateAndMark(status, direction, gestureScrollPosition = null) {
  const item = currentItem();
  if (!item || swipeCommitInProgress || swipeSessionIsPaused()) return;
  swipeCommitInProgress = true;
  const pageScroll = document.scrollingElement;
  const scrollPosition = gestureScrollPosition || (pageScroll ? { top: pageScroll.scrollTop, left: pageScroll.scrollLeft } : null);

  // Persist before playing the exit animation. Previously the write happened
  // only after its 320 ms timeout, so refreshing during that small window
  // brought the just-swiped card back into the deck. Also skip renderAll here:
  // it would reset the exit animation and make the owned card snap back.
  const previousEntry = getEntry(item.id);
  recordSwipeSessionAction(item, status, previousEntry);
  setEntry(item.id, { status }, { render: false });
  const cfg = SWIPE_CONFIG[direction ?? status];
  setBadge(t(`status.${status}`), cfg.color);
  els.card.classList.remove("drag-left", "drag-right", "drag-up", "drag-down");
  els.card.classList.add("confirming", `confirm-${status}`, "out", cfg.dir);
  els.card.style.setProperty("--swipe-intensity", "1");
  els.card.style.setProperty("--tx", `${cfg.x}px`);
  els.card.style.setProperty("--ty", `${cfg.y}px`);
  els.card.style.setProperty("--rot", `${cfg.rot}deg`);
  let completed = false;
  let fallbackTimer = null;
  const finishSwipe = () => {
    if (completed) return;
    completed = true;
    els.card.removeEventListener("transitionend", onTransitionEnd);
    clearTimeout(fallbackTimer);
    // Release the interaction lock before the ancillary lists are rendered.
    // Those renders can be heavier than the card transition; keeping the lock
    // through them made a valid second button tap disappear on mobile.
    swipeCommitInProgress = false;
    markCurrent(status, { alreadyPersisted: true, scrollPosition });
  };
  const onTransitionEnd = (event) => {
    if (event.target === els.card && event.propertyName === "transform") finishSwipe();
  };
  els.card.addEventListener("transitionend", onTransitionEnd);
  // A fallback keeps the deck usable if a browser suppresses transition events
  // (for example when the app is backgrounded mid-swipe).
  fallbackTimer = setTimeout(finishSwipe, 320);
}
