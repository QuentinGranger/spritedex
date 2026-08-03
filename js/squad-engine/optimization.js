function renderEngineOptimization(r) {
  const bp = (r.analysis && r.analysis.bestPair) || {};
  const members = getEngineSimulateMembers(r);
  const variants = getEngineSelectableVariants(r);
  const memberOpts = engineMemberOptions(members);
  const variantOpts = engineVariantOptions(variants);
  return `
    <div class="engine-grid engine-grid--2">
      <div class="engine-card">
        <div class="engine-card__value">${bp.coverageRate != null ? formatPct(bp.coverageRate) : "—"}</div>
        <div class="engine-card__label">${t("engine.label.bestPair")}</div>
        <div class="engine-card__sub">${bp.userAName && bp.userBName ? `${escapeHtml(bp.userAName)} + ${escapeHtml(bp.userBName)}` : t("engine.none")}</div>
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.label.bestTeam")}</h4>
      <p class="engine-section__hint">${t("engine.hint.combinations")}</p>
      <form class="engine-sim" id="squadEngineCombinationForm">
        <label class="engine-sim__field">
          <span>${t("engine.groupSize")}</span>
          <select class="engine-select" name="size">
            <option value="2">2 ${t("engine.players2")}</option>
            <option value="3" selected>3 ${t("engine.players2")}</option>
            <option value="4">4 ${t("engine.players2")}</option>
          </select>
        </label>
        <button type="submit" class="ghost-button engine-sim__submit">${t("engine.calcBtn")}</button>
      </form>
      <div id="squadEngineCombinationResult"><p class="engine-empty">${t("engine.chooseGroupSize")}</p></div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.label.minimumTeam")}</h4>
      <p class="engine-section__hint">${t("engine.hint.minimumTeam")}</p>
      <form class="engine-sim" id="squadEngineMinimumTeamForm">
        <label class="engine-sim__field">
          <span>${t("engine.coverageTarget")}</span>
          <input class="engine-select" name="target" type="number" min="1" max="100" value="90" required>
        </label>
        <button type="submit" class="ghost-button engine-sim__submit">${t("engine.calcBtn")}</button>
      </form>
      <div id="squadEngineMinimumTeamResult"><p class="engine-empty">${t("engine.defaultTarget")}</p></div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.label.simulation")}</h4>
      <p class="engine-section__hint">${t("engine.hint.simulation")}</p>
      <div class="engine-scenario">
        <form class="engine-sim" id="squadEngineScenarioAcquireForm">
          <label class="engine-sim__field"><span>${t("engine.member")}</span><select class="engine-select" name="memberId" required ${members.length ? "" : "disabled"}><option value="">${t("engine.choose")}</option>${memberOpts}</select></label>
          <label class="engine-sim__field"><span>${t("engine.variantsObtained")}</span><select class="engine-select engine-sim__multi" name="variantIds" multiple required ${variants.length ? "" : "disabled"}>${variantOpts}</select></label>
          <button type="submit" class="ghost-button engine-sim__submit" ${members.length && variants.length ? "" : "disabled"}>${t("engine.addAcquisition")}</button>
        </form>
        <form class="engine-sim" id="squadEngineScenarioJoinForm">
          <label class="engine-sim__field"><span>${t("engine.newMember")}</span><input class="engine-select" name="username" maxlength="80" placeholder="${t("engine.usernamePlaceholder")}"></label>
          <label class="engine-sim__field"><span>${t("engine.variantsOwned")}</span><select class="engine-select engine-sim__multi" name="ownedVariantIds" multiple>${variantOpts}</select></label>
          <button type="submit" class="ghost-button engine-sim__submit">${t("engine.addJoin")}</button>
        </form>
        <form class="engine-sim" id="squadEngineScenarioLeaveForm">
          <label class="engine-sim__field"><span>${t("engine.memberLeaving")}</span><select class="engine-select" name="memberId" required ${members.length ? "" : "disabled"}><option value="">${t("engine.choose")}</option>${memberOpts}</select></label>
          <button type="submit" class="ghost-button engine-sim__submit" ${members.length ? "" : "disabled"}>${t("engine.addLeave")}</button>
        </form>
      </div>
      <div id="squadEngineScenarioQueue">${engineScenarioQueueHtml(members, variants)}</div>
      <button type="button" class="ghost-button engine-scenario__run" id="squadEngineScenarioRun">${t("engine.simulateBtn")}</button>
      <div id="squadEngineSimulateResult">${renderEngineSimulateResult(null)}</div>
    </div>
  `;
}
