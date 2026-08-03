function getEngineSimulateMembers(r) {
  const fromUnique = ((r.analysis && r.analysis.uniqueOwners && r.analysis.uniqueOwners.byMember) || []).map((m) => ({
    userId: m.userId,
    username: m.username
  }));
  const fromState =
    typeof state !== "undefined" && Array.isArray(state.squadMembers)
      ? state.squadMembers.map((m) => ({ userId: m.userId, username: m.username }))
      : [];
  const fromPlan = (((r.recommendations || {}).plan || {}).members || []).map((m) => ({
    userId: m.userId,
    username: m.username
  }));
  const map = new Map();
  for (const m of [...fromState, ...fromUnique, ...fromPlan]) {
    if (m.userId == null) continue;
    map.set(String(m.userId), { userId: m.userId, username: m.username || String(m.userId) });
  }
  if (typeof state !== "undefined" && state.userId != null) {
    map.set(String(state.userId), {
      userId: state.userId,
      username: state.username || t("squad.me")
    });
  }
  return Array.from(map.values()).sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

function getEngineSimulateVariants(r) {
  const missing = ((r.analysis && r.analysis.missing && r.analysis.missing.variants) || []).filter(
    (v) => v.classification === "confirmed_missing" || v.isMissingAll
  );
  const priorities = (r.recommendations && r.recommendations.priorities) || [];
  const all = (r.analysis && r.analysis.allVariants) || [];
  const map = new Map();
  for (const v of [...priorities, ...missing, ...all.filter((x) => x.isMissingAll || x.isPriority)]) {
    if (!v.variantId || map.has(v.variantId)) continue;
    map.set(v.variantId, {
      variantId: v.variantId,
      spriteName: v.spriteName || v.spriteId || v.variantId,
      variantName: v.variantName || "",
      score: v.score || 0,
      collectiveCoverageDelta: v.collectiveCoverageDelta
    });
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.score || 0) - (a.score || 0) || String(a.spriteName).localeCompare(String(b.spriteName))
  );
}

function renderEngineSimulateResult(result) {
  if (!result) {
    return `<p class="engine-empty">${t("engine.simHint")}</p>`;
  }
  const before = result.before || {};
  const after = result.after || {};
  const diff = result.difference || {};
  const rateDelta = Number(diff.completionRate || 0);
  const coveredDelta = Number(diff.coveredCount || 0);
  const rateClass = rateDelta > 0 ? "engine-sim__delta--up" : rateDelta < 0 ? "engine-sim__delta--down" : "";
  return `
    <div class="engine-grid engine-grid--3">
      <div class="engine-card">
        <div class="engine-card__value">${formatPct(before.completionRate)}</div>
        <div class="engine-card__label">${t("engine.before")}</div>
        <div class="engine-card__sub">${safeFiniteNumber(before.coveredCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(before.totalVariantCount, 0, { min: 0, max: 1000000 })}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${formatPct(after.completionRate)}</div>
        <div class="engine-card__label">${t("engine.after")}</div>
        <div class="engine-card__sub">${safeFiniteNumber(after.coveredCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(after.totalVariantCount, 0, { min: 0, max: 1000000 })}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value ${rateClass}">${rateDelta > 0 ? "+" : ""}${formatPct(rateDelta)}</div>
        <div class="engine-card__label">Δ ${t("engine.label.collectiveCompletionRate")}</div>
        <div class="engine-card__sub">${t("engine.variantsDelta", { delta: (coveredDelta > 0 ? "+" : "") + coveredDelta, count: Math.abs(coveredDelta) })}</div>
      </div>
    </div>
    ${result.appliedChanges != null ? `<p class="engine-section__hint">${t("engine.appliedChanges", { count: safeFiniteNumber(result.appliedChanges, 0, { min: 0, max: 20 }) })}</p>` : ""}
  `;
}

function getEngineSelectableVariants(r) {
  const variants = (r.analysis && r.analysis.allVariants) || [];
  return variants
    .filter((v) => v && v.variantId)
    .slice()
    .sort(
      (a, b) =>
        String(a.spriteName || a.spriteId || "").localeCompare(String(b.spriteName || b.spriteId || "")) ||
        String(a.variantName || a.variantId).localeCompare(String(b.variantName || b.variantId))
    );
}

function engineMemberOptions(members) {
  return members
    .map(
      (m) => `<option value="${escapeHtml(String(m.userId))}">${escapeHtml(m.username || String(m.userId))}</option>`
    )
    .join("");
}

function engineVariantOptions(variants) {
  return variants
    .map((v) => {
      const label = `${v.spriteName || v.spriteId || v.variantId}${v.variantName ? ` · ${v.variantName}` : ""}`;
      return `<option value="${escapeHtml(String(v.variantId))}">${escapeHtml(label)}</option>`;
    })
    .join("");
}

function describeEngineScenarioChange(change, members, variants) {
  const memberById = new Map(members.map((m) => [String(m.userId), m.username || String(m.userId)]));
  const variantById = new Map(
    variants.map((v) => [
      String(v.variantId),
      `${v.spriteName || v.spriteId || v.variantId}${v.variantName ? ` · ${v.variantName}` : ""}`
    ])
  );
  if (change.type === "acquire") {
    const names = (change.variantIds || []).map((id) => variantById.get(String(id)) || String(id));
    return t("engine.scenarioAcquires", {
      member: memberById.get(String(change.memberId)) || change.memberId,
      items: names.join(", ")
    });
  }
  if (change.type === "join") {
    const names = (change.ownedVariantIds || []).map((id) => variantById.get(String(id)) || String(id));
    return names.length
      ? t("engine.scenarioJoinsWith", { name: change.username || t("engine.newMember"), items: names.join(", ") })
      : t("engine.scenarioJoins", { name: change.username || t("engine.newMember") });
  }
  if (change.type === "leave")
    return t("engine.scenarioLeaves", { member: memberById.get(String(change.memberId)) || change.memberId });
  return t("engine.scenarioChange");
}

function engineScenarioQueueHtml(members, variants) {
  if (!engineScenarioChanges.length) return `<p class="engine-empty">${t("engine.scenarioEmpty")}</p>`;
  return `<ol class="engine-scenario__queue">${engineScenarioChanges
    .map(
      (change, index) => `
    <li><span>${escapeHtml(describeEngineScenarioChange(change, members, variants))}</span><button type="button" class="ghost-button engine-scenario__remove" data-engine-scenario-remove="${index}">${t("engine.removeBtn")}</button></li>
  `
    )
    .join("")}</ol>`;
}

function renderEngineScenarioQueue(members, variants) {
  const queue = document.getElementById("squadEngineScenarioQueue");
  if (queue) queue.innerHTML = engineScenarioQueueHtml(members, variants);
}

function renderEngineCombinationResult(data) {
  const team = data && (data.teams || [])[0];
  if (!team) return `<p class="engine-empty">${t("engine.noComboFound")}</p>`;
  const names = (team.members || []).map((m) => escapeHtml(m.username || m.displayName || m.userId)).join(", ");
  return `<div class="engine-result"><strong>${formatPct(team.coverageRate)} ${t("engine.coverage")}</strong><span>${safeFiniteNumber(team.coveredVariantCount, 0, { min: 0, max: 1000000 })} ${t("engine.variants")} · ${names || t("engine.membersUnavailable")}</span></div>`;
}

function renderEngineMinimumTeamResult(data) {
  if (!data) return `<p class="engine-empty">${t("engine.noTeamForTarget")}</p>`;
  const names = (data.members || []).map((m) => escapeHtml(m.username || m.displayName || m.userId)).join(", ");
  return `<div class="engine-result"><strong>${safeFiniteNumber(data.minPlayers, 0, { min: 0, max: 1000000 })} ${t("engine.players", { count: data.minPlayers })}</strong><span>${escapeHtml(data.display || "")} ${names ? `· ${names}` : ""}</span></div>`;
}
