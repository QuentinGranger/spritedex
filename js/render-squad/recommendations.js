"use strict";

// ── Squad : Recommendations view (complementarity engine) ──
async function renderSquadRecommendations() {
  if (!state.activeSquad) return;
  els.squadCounter.innerHTML = `<span class="squad-counter__text">${t("squad.recommendations")}</span>`;
  els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.recsLoading")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/recommendations`, { headers: authHeadersOnly() });
    if (!res.ok) throw new Error("recommendations failed");
    const data = await res.json();
    const parts = [];
    parts.push(`<div class="recommendations-view">`);
    const ownedCount = safeFiniteNumber(data.ownedCount, 0, { min: 0, max: 1000000 });
    const totalVariants = safeFiniteNumber(data.totalVariants, 0, { min: 0, max: 1000000 });
    const ownedRate = safePercentage(data.ownedRate, 0);
    parts.push(
      `<div class="recommendations-header"><h3 class="recommendations-title">${t("squad.recTitle")}</h3><p class="recommendations-subtitle">${t("squad.recSubtitle", { owned: ownedCount, total: totalVariants, rate: ownedRate })}</p></div>`
    );
    parts.push(
      `<div class="recommendations-engine-cta"><button type="button" class="ghost-button" id="openSquadEngineFromRecs">${t("squad.openEngineFromRecs")}</button></div>`
    );

    if (data.mostComplementary) {
      const m = data.mostComplementary;
      const rarityParts = Object.entries(m.jointCoverageByRarity || {})
        .sort((a, b) => (b[1].coverage || 0) - (a[1].coverage || 0))
        .slice(0, 3)
        .map(
          ([r, info]) =>
            `<span class="recommendation-rarity">${escapeHtml(localizedRarity(r))} : <strong>${formatUiPercent(info.coverage, { maximumFractionDigits: 0 })}</strong> (${safeFiniteNumber(info.owned, 0, { min: 0, max: 1000000 })}/${safeFiniteNumber(info.total, 0, { min: 0, max: 1000000 })})</span>`
        )
        .join(" · ");
      parts.push(`<div class="recommendation-card recommendation-card--highlight">`);
      parts.push(`<div class="recommendation-card__header">`);
      parts.push(`<span class="recommendation-card__name">${escapeHtml(m.displayName || m.username)}</span>`);
      parts.push(`<span class="recommendation-card__badge">${t("squad.mostComplementaryBadge")}</span>`);
      parts.push(`</div>`);
      parts.push(`<div class="recommendation-card__body">`);
      parts.push(
        `<p>${t("squad.recMemberMissing", { name: escapeHtml(m.displayName || m.username), count: safeFiniteNumber(m.missingCount, 0, { min: 0, max: 1000000 }), priority: safeFiniteNumber(m.priorityMatchCount, 0, { min: 0, max: 1000000 }) })}</p>`
      );
      parts.push(`<p>${t("squad.recJointCoverage", { pct: safePercentage(m.jointCoverage, 0) })}</p>`);
      if (rarityParts) parts.push(`<p class="recommendation-rarities">${rarityParts}</p>`);
      parts.push(`</div></div>`);
    }

    if (data.friends && data.friends.length > 0) {
      parts.push(`<h4 class="recommendations-section-title">${t("squad.friendsAndMembers")}</h4>`);
      parts.push(`<div class="recommendation-list">`);
      for (const f of data.friends) {
        parts.push(`<div class="recommendation-card">
          <div class="recommendation-card__header">
            <span class="recommendation-card__name">${escapeHtml(f.displayName || f.username)}</span>
            <span class="recommendation-card__score">score ${safeFiniteNumber(f.score, 0, { min: 0, max: 1000000 })}</span>
          </div>
          <div class="recommendation-card__body">
            <p>${t("squad.recFriendStats", { count: safeFiniteNumber(f.missingCount, 0, { min: 0, max: 1000000 }), priority: safeFiniteNumber(f.priorityMatchCount, 0, { min: 0, max: 1000000 }), pct: safePercentage(f.jointCoverage, 0) })}</p>
          </div>
        </div>`);
      }
      parts.push(`</div>`);
    }

    if (data.squadAdditions && data.squadAdditions.length > 0) {
      parts.push(`<h4 class="recommendations-section-title">${t("squad.strengthenSquad")}</h4>`);
      parts.push(`<div class="recommendation-list">`);
      for (const s of data.squadAdditions) {
        parts.push(`<div class="recommendation-card">
          <div class="recommendation-card__header">
            <span class="recommendation-card__name">${escapeHtml(s.name)}</span>
            <span class="recommendation-card__gain">+${safePercentage(s.gain, 0)}%</span>
          </div>
          <div class="recommendation-card__body">
            <p>${t("squad.addBoostsCoverage", { name: `<strong>${escapeHtml(s.candidate.displayName || s.candidate.username)}</strong>`, from: `<strong>${safePercentage(s.currentRate, 0)}%</strong>`, to: `<strong>${safePercentage(s.newRate, 0)}%</strong>` })}</p>
          </div>
        </div>`);
      }
      parts.push(`</div>`);
    }

    parts.push(`</div>`);
    els.squadTableWrap.innerHTML = parts.join("");
    const engineCta = document.getElementById("openSquadEngineFromRecs");
    if (engineCta && typeof showSquadEngine === "function") {
      engineCta.addEventListener("click", () => {
        showSquadEngine();
        if (typeof switchSquadEngineTab === "function") switchSquadEngineTab("recommendations");
      });
    }
  } catch (e) {
    console.error("[renderSquadRecommendations]", e);
    els.squadTableWrap.innerHTML = `<p class="squad-empty">${t("squad.recLoadFailed")}</p>`;
  }
}

async function handleRecommendedFriendInvite(e) {
  const btn = e.target.closest("[data-recommended-id]");
  if (!btn) return;
  const friendId = btn.dataset.recommendedId;
  const code = state.activeSquad;
  if (!code || !friendId) return;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/invite/${encodeURIComponent(friendId)}`, {
      method: "POST",
      headers: authHeaders()
    });
    if (res.ok) {
      toast(t("squad.inviteSent"));
      btn.disabled = true;
      btn.textContent = t("squad.invited");
    } else {
      const data = await res.json().catch(() => ({}));
      toastError(data, "squad.inviteFailed");
    }
  } catch (e) {
    console.error("[invite recommended]", e);
    toast(t("common.networkError"));
  }
}

async function renderSquadRecommendedFriends() {
  if (!els.squadRecommendedFriends) return;
  if (!state.activeSquad) {
    els.squadRecommendedFriends.innerHTML = "";
    return;
  }
  els.squadRecommendedFriends.innerHTML = `<p class="squad-empty">${t("squad.loading")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/recommended-friends`, {
      headers: authHeadersOnly()
    });
    if (!res.ok) throw new Error("recommended friends failed");
    const data = await res.json();
    const candidates = data.candidates || [];
    if (candidates.length === 0) {
      els.squadRecommendedFriends.innerHTML = "";
      return;
    }
    const squadName = escapeHtml(data.squadName || els.squadActiveName?.textContent || "l'escouade");
    const parts = [];
    parts.push(
      `<div class="recommended-friends-section"><h4 class="recommended-friends__title">${t("squad.recommendedFriendsTitle")}</h4><div class="recommended-friends__list">`
    );
    for (const c of candidates) {
      const btn = c.canInvite
        ? `<button type="button" class="login-btn" data-recommended-id="${encodeURIComponent(c.userId)}" data-action="invite-recommended">${t("squad.inviteBtn")}</button>`
        : `<button type="button" class="ghost-button" disabled>${t("squad.inviteBtn")}</button>`;
      const contrib = safeFiniteNumber(c.potentialContribution || c.newVariantsForSquad, 0, { min: 0, max: 1000000 });
      const contributionLine =
        contrib > 0
          ? `<span class="recommended-friend__stat recommended-friend__stat--contribution">${t("squad.recContrib", { name: escapeHtml(c.displayName || c.username), count: contrib, squad: squadName })}</span>`
          : "";
      parts.push(`<div class="recommended-friend">
        <div class="recommended-friend__info">
          <span class="recommended-friend__name">${escapeHtml(c.displayName || c.username)}</span>
          <span class="recommended-friend__meta">
            <span class="recommended-friend__stat">+${safeFiniteNumber(c.newVariantsForSquad, 0, { min: 0, max: 1000000 })} ${t("squad.newVariants")}</span>
            <span class="recommended-friend__stat">${safeFiniteNumber(c.mythicNewVariants, 0, { min: 0, max: 1000000 })} ${t("squad.mythicMissing")}</span>
            <span class="recommended-friend__stat">${t("squad.complementarityScoreLabel", { pct: safePercentage(c.complementarityScore, 0) })}</span>
            ${contributionLine}
          </span>
        </div>
        ${btn}
      </div>`);
    }
    parts.push(`</div></div>`);
    els.squadRecommendedFriends.innerHTML = parts.join("");
    els.squadRecommendedFriends.querySelectorAll("[data-action='invite-recommended']").forEach((btn) => {
      btn.addEventListener("click", handleRecommendedFriendInvite);
    });
  } catch (e) {
    console.error("[renderSquadRecommendedFriends]", e);
    els.squadRecommendedFriends.innerHTML = `<p class="squad-empty">${t("squad.recommendedFriendsFailed")}</p>`;
  }
}

async function renderSquadComplementaryPairs() {
  if (!els.squadComplementaryPairs) return;
  if (!state.activeSquad) {
    els.squadComplementaryPairs.innerHTML = "";
    return;
  }
  els.squadComplementaryPairs.innerHTML = `<p class="squad-empty">${t("squad.loading")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/complementary-pairs`, {
      headers: authHeadersOnly()
    });
    if (!res.ok) throw new Error("complementary pairs failed");
    const data = await res.json();
    const pairs = data.pairs || [];
    if (pairs.length === 0) {
      els.squadComplementaryPairs.innerHTML = "";
      return;
    }
    const parts = [];
    parts.push(
      `<div class="complementary-pairs-section"><h4 class="complementary-pairs__title">${t("squad.complementaryTitle")}</h4><div class="complementary-pairs__list">`
    );
    for (const p of pairs) {
      parts.push(`<button type="button" class="complementary-pair" data-user-a-id="${encodeURIComponent(p.userAId)}" data-user-a-name="${escapeHtml(p.userAName)}" data-user-b-id="${encodeURIComponent(p.userBId)}" data-user-b-name="${escapeHtml(p.userBName)}">
        <span class="complementary-pair__names">${escapeHtml(p.userAName)} <span class="complementary-pair__cross">×</span> ${escapeHtml(p.userBName)}</span>
        <span class="complementary-pair__score">${safePercentage(p.complementarityScore, 0)}%</span>
      </button>`);
    }
    parts.push(`</div></div>`);
    els.squadComplementaryPairs.innerHTML = parts.join("");
    els.squadComplementaryPairs.querySelectorAll(".complementary-pair").forEach((btn) => {
      btn.addEventListener("click", handleComplementaryPairClick);
    });
  } catch (e) {
    console.error("[renderSquadComplementaryPairs]", e);
    els.squadComplementaryPairs.innerHTML = `<p class="squad-empty">${t("squad.complementaryPairsFailed")}</p>`;
  }
}

function handleComplementaryPairClick(e) {
  const btn = e.target.closest(".complementary-pair");
  if (!btn) return;
  const userAId = btn.dataset.userAId;
  const userAName = btn.dataset.userAName;
  const userBId = btn.dataset.userBId;
  const userBName = btn.dataset.userBName;
  if (typeof comparePair === "function") {
    comparePair(userAId, userAName, userBId, userBName);
  }
}

// ── Squad : Summary ──
