function readEngineFilters() {
  const bar = document.getElementById("squadEngineFilterBar");
  if (!bar) return;
  bar.querySelectorAll("[data-engine-filter]").forEach(el => {
    const key = el.dataset.engineFilter;
    if (el.tagName === "INPUT" && el.type === "checkbox") {
      engineFilters[key] = el.checked;
    } else {
      engineFilters[key] = el.value;
    }
  });
}

function refreshEngineFilterResults() {
  readEngineFilters();
  const results = document.getElementById("squadEngineFilterResults");
  if (!results) return;
  results.innerHTML = renderEngineFilterResults(applyEngineFilters(getEngineAllVariants()));
}

function resetEngineFilters() {
  engineFilters.missingAll = false;
  engineFilters.uniqueOwner = false;
  engineFilters.duplicates = false;
  engineFilters.availableNow = false;
  engineFilters.priorities = false;
  engineFilters.rarity = "";
  engineFilters.season = "";
  engineFilters.event = "";
  engineFilters.variantType = "";
  refreshEngineFilterResults();
  if (squadEngineTab === "missing") renderSquadEngineTab("missing");
}

async function runEngineScenarioSimulation(changes = engineScenarioChanges) {
  const code = state.activeSquad;
  const resultEl = document.getElementById("squadEngineSimulateResult");
  if (!code || !resultEl || !changes.length) return;
  resultEl.innerHTML = `<p class="engine-empty">${t("engine.calculating")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/completion/simulate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ changes })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      resultEl.innerHTML = `<p class="engine-empty">${escapeHtml(data.error || t("engine.simFailed"))}</p>`;
      return;
    }
    const data = await res.json();
    resultEl.innerHTML = renderEngineSimulateResult(data);
  } catch (e) {
    console.error("[runEngineAcquisitionSimulate]", e);
    resultEl.innerHTML = `<p class="engine-empty">${t("common.networkError")}</p>`;
  }
}

async function loadEngineCombinations(size) {
  const resultEl = document.getElementById("squadEngineCombinationResult");
  if (!state.activeSquad || !resultEl) return;
  resultEl.innerHTML = `<p class="engine-empty">${t("engine.calculating")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/completion/combinations?size=${encodeURIComponent(size)}`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    resultEl.innerHTML = res.ok ? renderEngineCombinationResult(data) : `<p class="engine-empty">${escapeHtml(data.error || t("engine.calcFailed"))}</p>`;
  } catch (e) {
    console.error("[loadEngineCombinations]", e);
    resultEl.innerHTML = `<p class="engine-empty">${t("common.networkError")}</p>`;
  }
}

async function loadEngineMinimumTeam(target) {
  const resultEl = document.getElementById("squadEngineMinimumTeamResult");
  if (!state.activeSquad || !resultEl) return;
  resultEl.innerHTML = `<p class="engine-empty">${t("engine.calculating")}</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/minimum-team?targetType=coverage&target=${encodeURIComponent(target)}`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    resultEl.innerHTML = res.ok ? renderEngineMinimumTeamResult(data) : `<p class="engine-empty">${escapeHtml(data.error || t("engine.noTeamForTarget"))}</p>`;
  } catch (e) {
    console.error("[loadEngineMinimumTeam]", e);
    resultEl.innerHTML = `<p class="engine-empty">${t("common.networkError")}</p>`;
  }
}

function addEngineScenarioChange(change) {
  if (engineScenarioChanges.length >= 20) {
    toast(t("engine.scenarioLimit"));
    return;
  }
  engineScenarioChanges.push(change);
  renderEngineScenarioQueue(
    getEngineSimulateMembers(squadEngineReport || {}),
    getEngineSelectableVariants(squadEngineReport || {})
  );
}

function setupSquadEngine() {
  if (!els.squadEngineBtn) return;
  els.squadEngineBtn.addEventListener("click", showSquadEngine);
  if (els.squadEngineCloseBtn) {
    els.squadEngineCloseBtn.addEventListener("click", hideSquadEngine);
  }
  document.querySelectorAll(".squad-engine__tab").forEach(btn => {
    btn.addEventListener("click", () => switchSquadEngineTab(btn.dataset.engineTab));
  });
  const missingPanel = document.getElementById("squadEnginePanel-missing");
  if (missingPanel) {
    missingPanel.addEventListener("change", (e) => {
      const input = e.target.closest("[data-engine-filter]");
      if (input) refreshEngineFilterResults();
    });
    missingPanel.addEventListener("click", (e) => {
      if (e.target.closest("#squadEngineResetFilters")) resetEngineFilters();
    });
  }
  const optimizationPanel = document.getElementById("squadEnginePanel-optimization");
  if (optimizationPanel) {
    optimizationPanel.addEventListener("submit", (e) => {
      const form = e.target.closest("form");
      if (!form) return;
      e.preventDefault();
      const fd = new FormData(form);
      if (form.id === "squadEngineCombinationForm") {
        loadEngineCombinations(Math.max(2, Math.min(4, Number(fd.get("size")) || 3)));
        return;
      }
      if (form.id === "squadEngineMinimumTeamForm") {
        loadEngineMinimumTeam(Math.max(1, Math.min(100, Number(fd.get("target")) || 90)));
        return;
      }
      if (form.id === "squadEngineScenarioAcquireForm") {
        const memberId = String(fd.get("memberId") || "");
        const variantIds = fd.getAll("variantIds").map(String).filter(Boolean);
        if (!memberId || !variantIds.length) return;
        addEngineScenarioChange({ type: "acquire", memberId, variantIds });
        form.reset();
        return;
      }
      if (form.id === "squadEngineScenarioJoinForm") {
        const username = String(fd.get("username") || "").trim();
        const ownedVariantIds = fd.getAll("ownedVariantIds").map(String).filter(Boolean);
        addEngineScenarioChange({ type: "join", username: username || t("engine.newMember"), ownedVariantIds });
        form.reset();
        return;
      }
      if (form.id === "squadEngineScenarioLeaveForm") {
        const memberId = String(fd.get("memberId") || "");
        if (!memberId) return;
        addEngineScenarioChange({ type: "leave", memberId });
        form.reset();
      }
    });
    optimizationPanel.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-engine-scenario-remove]");
      if (remove) {
        const index = Number(remove.dataset.engineScenarioRemove);
        if (Number.isInteger(index) && index >= 0) {
          engineScenarioChanges.splice(index, 1);
          renderEngineScenarioQueue(
            getEngineSimulateMembers(squadEngineReport || {}),
            getEngineSelectableVariants(squadEngineReport || {})
          );
        }
        return;
      }
      if (e.target.closest("#squadEngineScenarioRun")) {
        runEngineScenarioSimulation();
      }
    });
  }
  if (els.squadEngine) {
    els.squadEngine.addEventListener("click", (e) => {
      const stat = e.target.closest(".engine-stat");
      if (!stat) return;
      const isActive = stat.classList.contains("active");
      document.querySelectorAll(".engine-stat").forEach(s => s.classList.remove("active"));
      if (!isActive) stat.classList.add("active");
    });
  }
}

setupSquadEngine();
