// Squad completion engine UI
let squadEngineReport = null;
let squadEngineTab = "overview";
let engineScenarioChanges = [];

function getEngineDefinitions() {
  return {
    collectiveCompletionRate: t("engine.def.collectiveCompletionRate"),
    coveredVariantCount: t("engine.def.coveredVariantCount"),
    totalMissing: t("engine.def.totalMissing"),
    totalUnique: t("engine.def.totalUnique"),
    totalShared: t("engine.def.totalShared"),
    averageOwnershipRate: t("engine.def.averageOwnershipRate"),
    includedMemberCount: t("engine.def.includedMemberCount"),
    excludedPrivateCollections: t("engine.def.excludedPrivateCollections"),
    mostComplementaryMember: t("engine.def.mostComplementaryMember"),
    missingAll: t("engine.def.missingAll"),
    uniqueOwner: t("engine.def.uniqueOwner"),
    duplicates: t("engine.def.duplicates"),
    availableNow: t("engine.def.availableNow"),
    priorities: t("engine.def.priorities"),
    bestPair: t("engine.def.bestPair"),
    bestTeam: t("engine.def.bestTeam"),
    minimumTeam: t("engine.def.minimumTeam"),
    simulation: t("engine.def.simulation")
  };
}

function explain(text, key) {
  const defs = getEngineDefinitions();
  const def = defs[key];
  if (!def) return escapeHtml(text);
  return `<span class="engine-stat" data-definition="${escapeHtml(def)}">${escapeHtml(text)} <span class="engine-stat__icon" aria-hidden="true">?</span><span class="engine-stat__tip">${escapeHtml(def)}</span></span>`;
}

function showSquadEngine() {
  if (!state.activeSquad) return;
  els.squadActive.classList.add("squad-active--engine");
  loadSquadEngine(state.activeSquad);
}

function hideSquadEngine() {
  els.squadActive.classList.remove("squad-active--engine");
}

function switchSquadEngineTab(tab) {
  squadEngineTab = tab;
  document.querySelectorAll(".squad-engine__tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.engineTab === tab);
  });
  document.querySelectorAll(".squad-engine__panel").forEach((p) => {
    p.classList.toggle("active", p.id === `squadEnginePanel-${tab}`);
  });
  if (squadEngineReport) renderSquadEngineTab(tab);
}

async function loadSquadEngine(code) {
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/completion/report`, {
      headers: authHeaders()
    });
    if (!res.ok) {
      toast(t("engine.loadFailed"));
      return;
    }
    squadEngineReport = await res.json();
    engineScenarioChanges = [];
    if (els.squadEngineVersion) {
      els.squadEngineVersion.textContent = `v${squadEngineReport.engineVersion} · ${squadEngineReport.catalogueVersion}`;
    }
    renderSquadEngineTab(squadEngineTab);
  } catch (e) {
    console.error("[loadSquadEngine]", e);
    toast(t("common.networkError"));
  }
}

function renderSquadEngineTab(tab) {
  if (!squadEngineReport) return;
  const panel = document.getElementById(`squadEnginePanel-${tab}`);
  if (!panel) return;
  switch (tab) {
    case "overview":
      panel.innerHTML = renderEngineOverview(squadEngineReport);
      break;
    case "missing":
      panel.innerHTML = renderEngineMissing(squadEngineReport);
      break;
    case "recommendations":
      panel.innerHTML = renderEngineRecommendations(squadEngineReport);
      break;
    case "optimization":
      panel.innerHTML = renderEngineOptimization(squadEngineReport);
      break;
  }
}
