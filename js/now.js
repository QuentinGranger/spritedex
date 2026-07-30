// ── Accueil : les prochaines actions utiles, sans obliger à explorer l'app. ──
const nowState = {
  recommendation: null,
  recommendationUserId: null,
  recommendationLoading: false
};

function nowDaysUntil(endDate) {
  const time = new Date(endDate || "").getTime();
  return Number.isFinite(time) ? Math.ceil((time - Date.now()) / 86400000) : null;
}

function nowPriorityItems() {
  const rarityImpact = { Mythique: 16, "Légendaire": 12, "Épique": 8, Rare: 5 };
  return getReleasedCollectionItems(getAllItems())
    .filter((item) => {
      const entry = getEntry(item.id);
      return entry.status === "priority" || (entry.priority && entry.priority !== "none" && entry.priority !== "ignored");
    })
    .map((item) => {
      const entry = getEntry(item.id);
      const sprite = SPRITES.find((candidate) => candidate.id === item.spriteId);
      const event = sprite?.eventId ? EVENTS?.[sprite.eventId] : null;
      const days = nowDaysUntil(event?.endDate);
      const priorityImpact = entry.priority === "urgent" ? 48
        : entry.priority === "important" ? 38
          : entry.priority === "medium" ? 30
            : entry.priority === "low" ? 20
              : entry.status === "priority" ? 28 : 14;
      const timeImpact = days == null || days > 30 ? 0
        : days <= 1 ? 38
          : days <= 3 ? 30
            : days <= 7 ? 22
              : days <= 14 ? 12 : 5;
      const availability = String(sprite?.availability?.status || sprite?.availabilityStatus || "").toLowerCase();
      const availabilityImpact = availability === "unavailable" || sprite?.available === false ? -30
        : availability === "available" ? 10 : 0;
      return {
        ...item,
        nowEvent: event || null,
        nowDays: days,
        nowScore: priorityImpact + timeImpact + availabilityImpact + (rarityImpact[item.rarity] || 3)
      };
    })
    .sort((a, b) => b.nowScore - a.nowScore || priorityOrder(getEntry(a.id).priority) - priorityOrder(getEntry(b.id).priority));
}

function nowEndingEvent(priorityItems) {
  const now = Date.now();
  const priorityEventIds = new Set(priorityItems.map((item) => item.nowEvent?.id).filter(Boolean).map(String));
  const candidates = Object.values(EVENTS || {})
    .filter((event) => event?.endDate && new Date(event.endDate).getTime() > now)
    .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  // An unrelated deadline is useful context, never a primary recommendation.
  return candidates.find((event) => priorityEventIds.has(String(event.id))) || null;
}

function nowBadgeProgress(items) {
  const metrics = getCollectionMetrics(items);
  const total = metrics.releasedTotal;
  const owned = metrics.owned;
  const rate = total ? (owned / total) * 100 : 0;
  const threshold = [1, 25, 50, 75, 100].find((value) => rate < value);
  if (!threshold) return { label: t("home.badgeComplete"), detail: t("home.badgeCompleteDetail"), target: 100, owned, total };
  const targetOwned = Math.ceil((total * threshold) / 100);
  return {
    label: t("home.badgeProgress", { threshold }),
    detail: t("home.badgeNeed", { count: Math.max(0, targetOwned - owned), threshold }),
    target: threshold,
    owned,
    total
  };
}

function nowEventDetail(event) {
  if (!event) return { title: t("home.eventEmpty"), detail: t("home.eventEmptyDetail"), action: "" };
  const ms = Math.max(0, new Date(event.endDate).getTime() - Date.now());
  const days = Math.ceil(ms / 86400000);
  const suffix = days <= 1 ? t("home.eventToday") : t("home.eventDays", { count: days });
  return { title: event.name, detail: suffix, action: "event", eventId: event.id };
}

function nowRecommendationDetail() {
  if (!state.userId || !localStorage.getItem(TOKEN_KEY)) {
    return { title: t("home.socialGuest"), detail: t("home.socialGuestDetail"), action: "social" };
  }
  if (nowState.recommendationLoading) return { title: t("home.socialLoading"), detail: t("home.socialLoadingDetail"), action: "social" };
  const friend = nowState.recommendation;
  if (!friend) return { title: t("home.socialEmpty"), detail: t("home.socialEmptyDetail"), action: "social" };
  const name = friend.displayName || friend.username || t("friends.defaultUser");
  return {
    title: name,
    detail: t("home.socialMeta", { count: friend.missingCount || 0, score: Math.round(Number(friend.score) || 0) }),
    action: "social"
  };
}

function nowCard({ tone, icon, label, title, detail, action, eventId }) {
  const actionAttrs = action ? ` data-now-action="${escapeHtml(action)}"${eventId ? ` data-now-event="${escapeHtml(String(eventId))}"` : ""}` : "";
  return `
    <article class="now-card now-card--${tone}">
      <span class="now-card__icon" aria-hidden="true">${icon}</span>
      <div class="now-card__content">
        <p class="now-card__label">${escapeHtml(label)}</p>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(detail)}</p>
      </div>
      ${action ? `<button class="now-card__action" type="button"${actionAttrs}>${escapeHtml(t("home.open"))}<span aria-hidden="true">→</span></button>` : ""}
    </article>`;
}

function nowPrimaryAction(priorities, event, recommendation, badge) {
  const bestPriority = priorities[0] || null;
  const endingSoon = event && nowDaysUntil(event.endDate) <= 14;
  const candidates = [];

  if (endingSoon && bestPriority && String(bestPriority.nowEvent?.id || "") === String(event.id)) {
    candidates.push({
      score: bestPriority.nowScore + 28,
      tone: "event",
      icon: "◷",
      kicker: t("home.aiKicker"),
      title: t("home.aiEventTitle", { event: event.name }),
      detail: nowEventDetail(event).detail,
      reason: t("home.aiEventReason"),
      action: "event",
      eventId: event.id,
      actionLabel: t("home.aiEventAction")
    });
  }

  if (bestPriority) {
    candidates.push({
      score: bestPriority.nowScore,
      tone: "priority",
      icon: "★",
      kicker: t("home.aiKicker"),
      title: t("home.aiPriorityTitle", { name: bestPriority.spriteName, variant: bestPriority.variant }),
      detail: t("home.aiPriorityDetail", { count: priorities.length }),
      reason: t("home.aiPriorityReason"),
      action: "priorities",
      actionLabel: t("home.aiPriorityAction")
    });
  }

  if (recommendation?.missingCount > 0) {
    const name = recommendation.displayName || recommendation.username || t("friends.defaultUser");
    candidates.push({
      score: 34 + Math.min(26, Number(recommendation.missingCount || 0) * 2) + Math.min(24, Number(recommendation.priorityMatchCount || 0) * 6) + Math.min(12, Number(recommendation.availableMissingCount || 0)),
      tone: "social",
      icon: "◎",
      kicker: t("home.aiKicker"),
      title: t("home.aiSocialTitle", { name }),
      detail: t("home.socialMeta", { count: recommendation.missingCount, score: Math.round(Number(recommendation.score) || 0) }),
      reason: t("home.aiSocialReason"),
      action: "social",
      actionLabel: t("home.aiSocialAction")
    });
  }

  if (badge.target > 1) {
    const targetOwned = Math.ceil((badge.total * badge.target) / 100);
    const remaining = Math.max(0, targetOwned - badge.owned);
    candidates.push({
      score: remaining <= 1 ? 72 : remaining <= 3 ? 58 : remaining <= 8 ? 42 : 25,
      tone: "badge",
      icon: "✦",
      kicker: t("home.aiKicker"),
      title: t("home.aiProgressTitle", { threshold: badge.target }),
      detail: badge.detail,
      reason: t("home.aiProgressReason"),
      action: "swipe",
      actionLabel: t("home.resume")
    });
  }

  if (candidates.length) return candidates.sort((a, b) => b.score - a.score)[0];
  return {
    score: 20,
    tone: "starter",
    icon: "↗",
    kicker: t("home.aiKicker"),
    title: t("home.aiStartTitle"),
    detail: t("home.aiStartDetail"),
    reason: t("home.aiStartReason"),
    action: "swipe",
    actionLabel: t("home.resume")
  };
}

function renderNowPrimary(primary, badge) {
  const target = primary.action ? ` data-now-action="${escapeHtml(primary.action)}"${primary.eventId ? ` data-now-event="${escapeHtml(String(primary.eventId))}"` : ""}` : "";
  return `
    <div class="now-primary now-primary--${primary.tone}">
      <div class="now-primary__orb" aria-hidden="true">${primary.icon}</div>
      <div class="now-primary__content">
        <p class="now-primary__kicker"><span></span>${escapeHtml(primary.kicker)}</p>
        <h3>${escapeHtml(primary.title)}</h3>
        <p>${escapeHtml(primary.detail)}</p>
        <p class="now-primary__reason">${escapeHtml(primary.reason)}</p>
      </div>
      <div class="now-primary__aside">
        <div class="now-primary__milestone"><span>${escapeHtml(t("home.badgeLabel"))}</span><strong>${escapeHtml(badge.label)}</strong><div><i style="width:${Math.min(100, (badge.owned / Math.max(1, badge.total)) * 100)}%"></i></div></div>
        <button class="now-primary__action" type="button"${target}>${escapeHtml(primary.actionLabel)} <span aria-hidden="true">→</span></button>
      </div>
    </div>`;
}

function renderNow() {
  const grid = document.getElementById("nowDashboardGrid");
  const intro = document.getElementById("nowIntro");
  const primarySlot = document.getElementById("nowPrimary");
  if (!grid || !intro || !primarySlot) return;
  const items = getAllItems();
  const stats = getStats(items);
  const priorities = nowPriorityItems();
  const event = nowEndingEvent(priorities);
  const badge = nowBadgeProgress(items);
  const recommendation = nowRecommendationDetail();
  const primary = nowPrimaryAction(priorities, event, nowState.recommendation, badge);
  const priorityTitle = priorities.length
    ? t("home.priorityCount", { count: priorities.length })
    : t("home.priorityEmpty");
  const priorityDetail = priorities.length
    ? priorities.slice(0, 3).map((item) => `${item.spriteName} · ${item.variant}`).join(" · ")
    : t("home.priorityEmptyDetail");

  intro.textContent = t("home.intro", { owned: stats.owned, total: stats.total, percent: stats.percent });
  primarySlot.innerHTML = renderNowPrimary(primary, badge);
  grid.innerHTML = [
    nowCard({ tone: "priority", icon: "★", label: t("home.priorityLabel"), title: priorityTitle, detail: priorityDetail, action: "priorities" }),
    nowCard({ tone: "event", icon: "◷", label: t("home.eventLabel"), ...nowEventDetail(event) }),
    nowCard({ tone: "social", icon: "◎", label: t("home.socialLabel"), ...recommendation })
  ].join("");

  void loadNowRecommendation();
}

async function loadNowRecommendation() {
  const userId = state.userId;
  if (!userId || !localStorage.getItem(TOKEN_KEY) || nowState.recommendationLoading || nowState.recommendationUserId === userId) return;
  nowState.recommendationLoading = true;
  renderNow();
  try {
    const response = await fetch(`${API_BASE}/recommendations`, { headers: authHeadersOnly(), cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    nowState.recommendation = data?.mostComplementary || null;
    nowState.recommendationUserId = userId;
  } catch {
    nowState.recommendation = null;
    nowState.recommendationUserId = userId;
  } finally {
    nowState.recommendationLoading = false;
    renderNow();
  }
}

function setupNowDashboard() {
  const dashboard = document.getElementById("nowDashboard");
  if (!dashboard || dashboard.dataset.ready) return;
  dashboard.dataset.ready = "true";
  dashboard.addEventListener("click", (event) => {
    const control = event.target.closest("[data-now-action]");
    if (!control) return;
    const action = control.dataset.nowAction;
    if (action === "swipe") {
      activateMainView("swipe");
    } else if (action === "priorities") {
      state.missingFilter = "priority";
      state.collectionViewDirty.missing = true;
      activateMainView("missing");
    } else if (action === "event") {
      state.missingEventFilter = { eventId: control.dataset.nowEvent || "" };
      state.missingFilter = "priority";
      state.collectionViewDirty.missing = true;
      activateMainView("missing");
    } else if (action === "social") {
      activateMainView("social");
      if (typeof setSocialTab === "function") setSocialTab("friends");
    } else if (action === "badge") {
      document.getElementById("accountBtn")?.click();
    }
  });
}
