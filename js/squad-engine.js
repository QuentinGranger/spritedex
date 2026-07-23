// Squad completion engine UI
let squadEngineReport = null;
let squadEngineTab = "overview";

const engineDefinitions = {
  collectiveCompletionRate: "Pourcentage des variantes sorties possédées par au moins un membre actif de la squad.",
  coveredVariantCount: "Nombre de variantes sorties et actives déjà présentes dans au moins une collection d'un membre.",
  totalMissing: "Nombre de variantes sorties et actives qu'aucun membre de la squad ne possède.",
  totalUnique: "Nombre de variantes possédées par exactement un membre de la squad.",
  totalShared: "Nombre de variantes possédées par au moins deux membres de la squad.",
  averageOwnershipRate: "Moyenne du taux de possession individuel des membres actifs de la squad.",
  mostComplementaryMember: "Membre apportant le plus grand nombre de variantes que les autres membres de la squad ne possèdent pas.",
  missingAll: "Variantes que personne dans la squad ne possède.",
  uniqueOwner: "Variantes possédées par un seul membre de la squad.",
  duplicates: "Variantes possédées par au moins deux membres de la squad.",
  availableNow: "Variantes actuellement disponibles dans le jeu.",
  priorities: "Variantes jugées prioritaires par le moteur d'acquisition collectif.",
  bestPair: "Paire de membres couvrant ensemble le plus grand nombre de variantes.",
  bestTeam: "Groupe de 3 membres couvrant ensemble le plus grand nombre de variantes."
};

function explain(text, key) {
  const def = engineDefinitions[key];
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
  document.querySelectorAll(".squad-engine__tab").forEach(b => {
    b.classList.toggle("active", b.dataset.engineTab === tab);
  });
  document.querySelectorAll(".squad-engine__panel").forEach(p => {
    p.classList.toggle("active", p.id === `squadEnginePanel-${tab}`);
  });
  if (squadEngineReport) renderSquadEngineTab(tab);
}

async function loadSquadEngine(code) {
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/completion/report`, { headers: authHeaders() });
    if (!res.ok) {
      toast("Impossible de charger le moteur.");
      return;
    }
    squadEngineReport = await res.json();
    if (els.squadEngineVersion) {
      els.squadEngineVersion.textContent = `v${squadEngineReport.engineVersion} · ${squadEngineReport.catalogueVersion}`;
    }
    renderSquadEngineTab(squadEngineTab);
  } catch (e) {
    console.error("[loadSquadEngine]", e);
    toast("Erreur réseau");
  }
}

function renderSquadEngineTab(tab) {
  if (!squadEngineReport) return;
  const panel = document.getElementById(`squadEnginePanel-${tab}`);
  if (!panel) return;
  switch (tab) {
    case "overview": panel.innerHTML = renderEngineOverview(squadEngineReport); break;
    case "missing": panel.innerHTML = renderEngineMissing(squadEngineReport); break;
    case "recommendations": panel.innerHTML = renderEngineRecommendations(squadEngineReport); break;
    case "optimization": panel.innerHTML = renderEngineOptimization(squadEngineReport); break;
  }
}

function formatPct(n) {
  return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + "%";
}

function renderEngineOverview(r) {
  const s = r.summary || {};
  const a = r.analysis || {};
  const mc = a.mostComplementaryMember || {};
  return `
    <div class="engine-grid engine-grid--4">
      <div class="engine-card">
        <div class="engine-card__value">${formatPct(s.collectiveCompletionRate)}</div>
        <div class="engine-card__label">${explain("Taux collectif", "collectiveCompletionRate")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.coveredVariantCount || 0}</div>
        <div class="engine-card__label">${explain("Variantes couvertes", "coveredVariantCount")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.totalMissing || 0}</div>
        <div class="engine-card__label">${explain("Variantes manquantes", "totalMissing")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.totalUnique || 0}</div>
        <div class="engine-card__label">${explain("Variantes uniques", "totalUnique")}</div>
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${explain("Membre le plus complémentaire", "mostComplementaryMember")}</h4>
      ${mc.username ? `
        <div class="engine-card engine-card--member">
          <div class="engine-card__value">${escapeHtml(mc.username)}</div>
          <div class="engine-card__label">${mc.uniqueCount || 0} variantes uniques apportées</div>
        </div>
      ` : `<p class="engine-empty">Aucun membre complémentaire détecté.</p>`}
    </div>
    <div class="engine-meta">
      <span>Généré le ${new Date(r.generatedAt).toLocaleString("fr-FR")}</span>
      <span>Catalogue : ${escapeHtml(r.catalogueVersion)}</span>
    </div>
    ${(r.warnings || []).length ? `<div class="engine-warnings">${r.warnings.map(w => `<p class="engine-warning">${escapeHtml(w)}</p>`).join("")}</div>` : ""}
  `;
}

const engineFilters = {
  missingAll: false,
  uniqueOwner: false,
  duplicates: false,
  availableNow: false,
  priorities: false,
  rarity: "",
  season: "",
  event: "",
  variantType: ""
};

function getEngineAllVariants() {
  return (squadEngineReport && squadEngineReport.analysis && squadEngineReport.analysis.allVariants) || [];
}

function applyEngineFilters(variants) {
  const f = engineFilters;
  const hasCategory = f.missingAll || f.uniqueOwner || f.duplicates;
  return variants.filter(v => {
    if (hasCategory) {
      const categoryOk = (f.missingAll && v.isMissingAll) || (f.uniqueOwner && v.isUniqueOwner) || (f.duplicates && v.isDuplicate);
      if (!categoryOk) return false;
    }
    if (f.availableNow && !v.isAvailableNow) return false;
    if (f.priorities && !v.isPriority) return false;
    if (f.rarity && v.rarity !== f.rarity) return false;
    if (f.season && v.seasonId !== f.season) return false;
    if (f.event && v.eventId !== f.event) return false;
    if (f.variantType && v.variantType !== f.variantType) return false;
    return true;
  });
}

function engineFilterControl() {
  const all = getEngineAllVariants();
  const rarityOptions = distinctOptions(all, "rarity", r => r ? `Rareté ${r}` : "Rareté inconnue");
  const seasonOptions = distinctOptions(all, "seasonId", id => id ? (SEASONS[id]?.name || id) : "Hors saison");
  const eventOptions = distinctOptions(all, "eventId", id => id ? (EVENTS[id]?.name || id) : "Hors événement");
  const typeOptions = distinctOptions(all, "variantType", t => t || "Type inconnu");
  return `
    <div class="engine-filter-bar" id="squadEngineFilterBar">
      <div class="engine-filter-group">
        <label class="engine-filter-toggle" title="${escapeHtml(engineDefinitions.missingAll)}"><input type="checkbox" data-engine-filter="missingAll" ${engineFilters.missingAll ? "checked" : ""}> Manque à toute la squad</label>
        <label class="engine-filter-toggle" title="${escapeHtml(engineDefinitions.uniqueOwner)}"><input type="checkbox" data-engine-filter="uniqueOwner" ${engineFilters.uniqueOwner ? "checked" : ""}> Propriétaire unique</label>
        <label class="engine-filter-toggle" title="${escapeHtml(engineDefinitions.duplicates)}"><input type="checkbox" data-engine-filter="duplicates" ${engineFilters.duplicates ? "checked" : ""}> Doublons</label>
        <label class="engine-filter-toggle" title="${escapeHtml(engineDefinitions.availableNow)}"><input type="checkbox" data-engine-filter="availableNow" ${engineFilters.availableNow ? "checked" : ""}> Disponibles actuellement</label>
        <label class="engine-filter-toggle" title="${escapeHtml(engineDefinitions.priorities)}"><input type="checkbox" data-engine-filter="priorities" ${engineFilters.priorities ? "checked" : ""}> Priorités</label>
      </div>
      <div class="engine-filter-group engine-filter-group--selects">
        <select class="engine-select" data-engine-filter="rarity"><option value="">Toutes raretés</option>${rarityOptions}</select>
        <select class="engine-select" data-engine-filter="season"><option value="">Toutes saisons</option>${seasonOptions}</select>
        <select class="engine-select" data-engine-filter="event"><option value="">Tous événements</option>${eventOptions}</select>
        <select class="engine-select" data-engine-filter="variantType"><option value="">Tous types</option>${typeOptions}</select>
      </div>
      <button type="button" class="ghost-button" id="squadEngineResetFilters">Réinitialiser</button>
    </div>
  `;
}

function distinctOptions(arr, key, labelFn) {
  const map = new Map();
  for (const item of arr) {
    const raw = item[key];
    const value = (raw === null || raw === undefined || raw === "") ? "_none" : String(raw);
    if (!map.has(value)) map.set(value, labelFn(raw));
  }
  return Array.from(map.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([value, label]) => `<option value="${escapeHtml(value)}" ${engineFilters[key] === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderEngineFilterResults(filtered) {
  return `
    <div class="engine-section">
      <h4 class="engine-section__title">Résultats filtrés (${filtered.length})</h4>
      <div class="engine-chip-list">
        ${filtered.slice(0, 60).map(v => `<span class="engine-chip" title="${escapeHtml(v.variantId)}">${escapeHtml(v.spriteName || v.spriteId)} <small>· ${escapeHtml(v.variantName || v.variantId)}</small></span>`).join("")}
        ${filtered.length > 60 ? `<span class="engine-chip">+${filtered.length - 60} autres</span>` : ""}
      </div>
    </div>
  `;
}

function renderEngineMissing(r) {
  const m = (r.analysis && r.analysis.missing) || {};
  const variants = m.variants || [];
  const confirmed = variants.filter(v => v.classification === "confirmed_missing");
  const maybe = variants.filter(v => v.classification !== "confirmed_missing");
  const all = getEngineAllVariants();
  const filtered = applyEngineFilters(all);
  return `
    ${engineFilterControl()}
    <div id="squadEngineFilterResults">${renderEngineFilterResults(filtered)}</div>
    <div class="engine-grid engine-grid--4">
      <div class="engine-card">
        <div class="engine-card__value">${confirmed.length}</div>
        <div class="engine-card__label">${explain("Totalement absents", "missingAll")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${maybe.length}</div>
        <div class="engine-card__label">${explain("Peut-être absents", "totalMissing")}</div>
      </div>
    </div>
    <div class="engine-columns">
      <div class="engine-column">
        <h4 class="engine-section__title">Par rareté</h4>
        ${renderGroupList(m.byRarity)}
      </div>
      <div class="engine-column">
        <h4 class="engine-section__title">Par événement</h4>
        ${renderGroupList(m.byEvent)}
      </div>
      <div class="engine-column">
        <h4 class="engine-section__title">Par disponibilité</h4>
        ${renderGroupList(m.byAvailability)}
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Variantes manquantes (${variants.length})</h4>
      <div class="engine-chip-list">
        ${variants.slice(0, 60).map(v => `<span class="engine-chip" title="${escapeHtml(v.display || "")}">${escapeHtml(v.spriteName || v.spriteId)} <small>· ${escapeHtml(v.variantName || v.variantId)}</small></span>`).join("")}
        ${variants.length > 60 ? `<span class="engine-chip">+${variants.length - 60} autres</span>` : ""}
      </div>
    </div>
  `;
}

function renderGroupList(groups) {
  if (!groups || !groups.length) return `<p class="engine-empty">Aucun groupe</p>`;
  return `<ul class="engine-list">
    ${groups.map(g => `<li><span class="engine-list__label">${escapeHtml(g.label || g.key)}</span><span class="engine-list__count">${g.count}</span></li>`).join("")}
  </ul>`;
}

function renderEngineRecommendations(r) {
  const rec = r.recommendations || {};
  const goals = rec.recommendedGoals || [];
  const assignments = rec.assignments || [];
  const priorities = rec.priorities || [];
  return `
    <div class="engine-section">
      <h4 class="engine-section__title">Priorité par membre</h4>
      <div class="engine-assignments">
        ${assignments.length ? assignments.slice(0, 20).map(a => `
          <div class="engine-assignment">
            <div class="engine-assignment__member">${escapeHtml(a.username || a.userId)}</div>
            <div class="engine-assignment__variants">${(a.variants || []).map(v => `<span class="engine-chip">${escapeHtml(v.spriteName || v.variantId)}</span>`).join("")}</div>
          </div>
        `).join("") : `<p class="engine-empty">Aucune assignation.</p>`}
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Acquisitions à fort impact (${priorities.length})</h4>
      <div class="engine-chip-list">
        ${priorities.slice(0, 20).map(p => `<span class="engine-chip" title="${escapeHtml(p.impactDisplay || "")}">${escapeHtml(p.spriteName || p.variantId)}</span>`).join("")}
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Objectifs suggérés (${goals.length})</h4>
      <div class="engine-goal-list">
        ${goals.map(g => `
          <div class="engine-goal-card">
            <div class="engine-goal-card__title">${escapeHtml(g.title)}</div>
            <div class="engine-goal-card__meta">${escapeHtml(g.reason || "")}</div>
            <div class="engine-goal-card__gain">Gain collectif : +${g.expectedCollectiveGain || 0}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderEngineOptimization(r) {
  const o = r.optimization || {};
  const bp = (r.analysis && r.analysis.bestPair) || {};
  const bt = o.bestTeam || {};
  const teams = bt.teams || [];
  return `
    <div class="engine-grid engine-grid--2">
      <div class="engine-card">
        <div class="engine-card__value">${bp.coverageRate != null ? formatPct(bp.coverageRate) : "—"}</div>
        <div class="engine-card__label">${explain("Meilleure paire", "bestPair")}</div>
        <div class="engine-card__sub">${bp.userAName && bp.userBName ? `${escapeHtml(bp.userAName)} + ${escapeHtml(bp.userBName)}` : "Aucune"}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${teams.length ? `${teams[0].coverageRate != null ? formatPct(teams[0].coverageRate) : "—"}` : "—"}</div>
        <div class="engine-card__label">${explain(`Meilleur groupe de ${bt.teamSize || 3}`, "bestTeam")}</div>
        <div class="engine-card__sub">${teams.length ? (teams[0].members || []).map(m => escapeHtml(m.username || m.userId)).join(", ") : "Aucun"}</div>
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Simulations</h4>
      <p class="engine-empty">Utilise l'API <code>POST /api/squads/:squadId/completion/simulate</code> pour tester des acquisitions ou des arrivées de membres.</p>
    </div>
  `;
}

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
