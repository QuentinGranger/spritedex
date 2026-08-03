"use strict";

async function loadCompareSquads() {
  if (!state.compareTarget || !state.compareTarget.userId || !state.userId) {
    state.compareCommonSquads = [];
    renderCompareSquads();
    return;
  }
  try {
    const res = await fetch(
      `${API_BASE}/squads/common/${encodeURIComponent(state.userId)}/${encodeURIComponent(state.compareTarget.userId)}`,
      { headers: authHeadersOnly() }
    );
    if (!res.ok) throw new Error("common squads failed");
    const data = await res.json();
    state.compareCommonSquads = data.squads || [];
  } catch (e) {
    console.error("[compare] common squads error", e);
    state.compareCommonSquads = [];
  }
  renderCompareSquads();
}

function handleCompareSquadAction(e) {
  const btn = e.target.closest("[data-squad-action]");
  if (!btn) return;
  const code = decodeURIComponent(btn.dataset.squadCode);
  const action = btn.dataset.squadAction;
  if (!code) return;
  const socialTab = document.querySelector('.tab[data-view="social"]');
  if (socialTab) {
    socialTab.click();
    if (typeof setSocialTab === "function") setSocialTab("squad");
  }
  if (typeof setCompareMode === "function") setCompareMode("squad");
  if (typeof loadSquad === "function") loadSquad(code);
  if (action === "hunt" || action === "session") {
    state.squadView = action;
    document.querySelectorAll(".squad-view-btn").forEach((b) => b.classList.remove("active"));
    const activeBtn = document.querySelector(`.squad-view-btn[data-squad-view="${action}"]`);
    if (activeBtn) activeBtn.classList.add("active");
  }
}

function renderCompareSquads() {
  if (!els.compareSquads) return;
  const squads = state.compareCommonSquads;
  if (!squads || squads.length === 0) {
    els.compareSquads.innerHTML = "";
    return;
  }
  const cards = squads
    .map(
      (s) => `
    <div class="compare-squad-card">
      <span class="compare-squad-card__name">${escapeHtml(s.name)}</span>
      <div class="compare-squad-card__actions">
        <button type="button" class="ghost-button" data-squad-code="${encodeURIComponent(s.code)}" data-squad-action="view">${t("compare.viewSquad")}</button>
        <button type="button" class="login-btn" data-squad-code="${encodeURIComponent(s.code)}" data-squad-action="hunt">${t("compare.commonGoal")}</button>
        <button type="button" class="ghost-button" data-squad-code="${encodeURIComponent(s.code)}" data-squad-action="session">${t("compare.recommendationsTitle")}</button>
      </div>
    </div>`
    )
    .join("");
  els.compareSquads.innerHTML = `
    <div class="compare-section compare-section--squads">
      <h3 class="compare-section__title">${t("compare.commonSquads")}</h3>
      <p class="compare-squads__intro">${t("compare.bothMembers")}</p>
      <div class="compare-squads__list">${cards}</div>
    </div>`;
  els.compareSquads
    .querySelectorAll("[data-squad-action]")
    .forEach((b) => b.addEventListener("click", handleCompareSquadAction));
}

function renderCompare() {
  if (
    !els.compareResults ||
    !els.compareSummary ||
    !els.compareTable ||
    !els.compareRecommendations ||
    !els.compareActions ||
    !els.compareSquads
  )
    return;
  if (!state.compareTarget) {
    els.compareResults.style.display = "none";
    if (els.compareStatus) els.compareStatus.textContent = "";
    return;
  }
  els.compareResults.style.display = "block";
  const pairA = state.compareAsPair?.userA;
  const aName = pairA ? pairA.displayName : state.username || t("compare.me");
  const bName = state.compareTarget.username || t("compare.friend");
  if (els.comparePlayerAName) els.comparePlayerAName.textContent = aName;
  if (els.comparePlayerBName) els.comparePlayerBName.textContent = bName;
  const userA = pairA
    ? { id: pairA.id || "userA", displayName: pairA.displayName, collection: pairA.collection }
    : { id: state.userId || "userA", displayName: state.username || t("compare.me"), collection: state.collection };
  const userB = {
    id: state.compareTarget.userId || state.compareTarget.username || "userB",
    displayName: state.compareTarget.username || t("compare.friend"),
    collection: state.compareTarget.collection
  };
  const result = compareCollections(userA, userB, getCompareCatalogItems());
  state.lastCompareResult = result;
  renderCompareSummary(result, aName, bName);
  loadCompareCommunityContext(result, aName, bName);
  renderCompareSquads();
  renderCompareActions(result);
  renderCompareRecommendations(result, aName, bName);
  renderCompareTable(result, aName, bName);

  connectCompareWs();
  if (state.compareTarget.userId) sendCompareSubscribe(state.compareTarget.userId);
  if (state.compareTarget.userId) loadCompareSquads();
}

// ── Chargement et partage ───────────────────────────────────────────────────
