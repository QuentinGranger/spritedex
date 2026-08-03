function renderGroupList(groups) {
  if (!groups || !groups.length) return `<p class="engine-empty">${t("engine.noGroup")}</p>`;
  return `<ul class="engine-list">
    ${groups.map((g) => `<li><span class="engine-list__label">${escapeHtml(g.label || g.key)}</span><span class="engine-list__count">${safeFiniteNumber(g.count, 0, { min: 0, max: 1000000 })}</span></li>`).join("")}
  </ul>`;
}

function getEngineAssignmentGroups(rec) {
  const planMembers = (rec.plan && rec.plan.members) || [];
  if (planMembers.length) {
    return planMembers.map((m) => ({
      userId: m.userId,
      username: m.username,
      variants: m.recommendations || []
    }));
  }
  const grouped = new Map();
  for (const a of rec.assignments || []) {
    const responsible = a.responsible || a.recommendedMember;
    if (!responsible) continue;
    const key = String(responsible.userId);
    if (!grouped.has(key)) {
      grouped.set(key, { userId: responsible.userId, username: responsible.username, variants: [] });
    }
    grouped.get(key).variants.push(a);
  }
  return Array.from(grouped.values());
}

function renderEngineRecommendations(r) {
  const rec = r.recommendations || {};
  const goals = rec.recommendedGoals || [];
  const groups = getEngineAssignmentGroups(rec);
  const priorities = rec.priorities || [];
  return `
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.priorityByMember")}</h4>
      <p class="engine-section__hint">${t("engine.priorityHint")}</p>
      <div class="engine-assignments">
        ${
          groups.length
            ? groups
                .slice(0, 20)
                .map(
                  (a) => `
          <div class="engine-assignment">
            <div class="engine-assignment__member">${escapeHtml(a.username || a.userId)}</div>
            <div class="engine-assignment__variants">${(a.variants || [])
              .slice(0, 8)
              .map((v) => {
                const tip = (v.explanation && v.explanation.join(" ")) || priorityDisplay(v) || "";
                const gain =
                  v.projectedCompletionGain != null
                    ? ` · +${v.projectedCompletionGain}%`
                    : v.collectiveCoverageDelta != null
                      ? ` · +${v.collectiveCoverageDelta}%`
                      : "";
                return `<button type="button" class="engine-chip engine-chip--action" data-graph-recommendation="assignment" title="${escapeHtml(tip)}">${escapeHtml(v.spriteName || v.variantId)}${gain ? `<small>${escapeHtml(gain)}</small>` : ""}</button>`;
              })
              .join("")}</div>
          </div>
        `
                )
                .join("")
            : `<p class="engine-empty">${t("engine.noAssignments")}</p>`
        }
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.highImpactAcquisitions", { count: priorities.length })}</h4>
      <div class="engine-chip-list">
        ${priorities
          .slice(0, 20)
          .map((p) => {
            const tip = priorityDisplay(p);
            const delta = p.collectiveCoverageDelta != null ? ` · +${p.collectiveCoverageDelta}%` : "";
            return `<button type="button" class="engine-chip engine-chip--action" data-graph-recommendation="priority" title="${escapeHtml(tip)}">${escapeHtml(p.spriteName || p.variantId)}${delta ? `<small>${escapeHtml(delta)}</small>` : ""}</button>`;
          })
          .join("")}
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.suggestedGoals", { count: goals.length })}</h4>
      <div class="engine-goal-list">
        ${
          goals.length
            ? goals
                .map(
                  (g) => `
          <button type="button" class="engine-goal-card engine-goal-card--action" data-graph-recommendation="goal">
            <div class="engine-goal-card__title">${escapeHtml(g.title)}</div>
            <div class="engine-goal-card__meta">${escapeHtml(g.reason || "")}</div>
            <div class="engine-goal-card__gain">${t("engine.collectiveGain", { pct: safePercentage(g.expectedCollectiveGain, 0) })}</div>
          </button>
        `
                )
                .join("")
            : `<p class="engine-empty">${t("engine.noGoals")}</p>`
        }
      </div>
    </div>
  `;
}

document.addEventListener("click", (event) => {
  const recommendation = event.target.closest("[data-graph-recommendation]");
  if (!recommendation || typeof trackSpriteGraphInteraction !== "function") return;
  trackSpriteGraphInteraction("recommendation.clicked", {
    surface: "squad_engine",
    recommendationKey: recommendation.dataset.graphRecommendation
  });
});
