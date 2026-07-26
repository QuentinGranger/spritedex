// Squad completion engine UI
let squadEngineReport = null;
let squadEngineTab = "overview";
let engineScenarioChanges = [];

const engineDefinitions = {
  collectiveCompletionRate: "Pourcentage des variantes sorties possédées par au moins un membre actif de la squad.",
  coveredVariantCount: "Nombre de variantes sorties et actives déjà présentes dans au moins une collection d'un membre.",
  totalMissing: "Nombre de variantes sorties et actives qu'aucun membre de la squad ne possède.",
  totalUnique: "Nombre de variantes possédées par exactement un membre de la squad.",
  totalShared: "Nombre de variantes possédées par au moins deux membres de la squad.",
  averageOwnershipRate: "Moyenne du taux de possession individuel des membres actifs de la squad.",
  includedMemberCount: "Nombre de collections partagées avec la squad et utilisées dans les calculs.",
  excludedPrivateCollections: "Nombre de collections privées exclues des calculs pour respecter la confidentialité.",
  mostComplementaryMember: "Membre apportant le plus grand nombre de variantes que les autres membres de la squad ne possèdent pas.",
  missingAll: "Variantes que personne dans la squad ne possède.",
  uniqueOwner: "Variantes possédées par un seul membre de la squad.",
  duplicates: "Variantes possédées par au moins deux membres de la squad.",
  availableNow: "Variantes actuellement disponibles dans le jeu.",
  priorities: "Variantes jugées prioritaires par le moteur d'acquisition collectif.",
  bestPair: "Paire de membres couvrant ensemble le plus grand nombre de variantes.",
  bestTeam: "Groupe de 2 à 4 membres couvrant ensemble le plus grand nombre de variantes.",
  minimumTeam: "Nombre minimal de membres permettant d’atteindre l’objectif de couverture choisi.",
  simulation: "Scénario temporaire : il ne modifie jamais les collections réelles."
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
    engineScenarioChanges = [];
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
  return safeFiniteNumber(n, 0, { min: -100, max: 100 }).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + "%";
}

function uniqueContributionCount(member) {
  if (!member) return 0;
  return safeFiniteNumber(member.uniqueVariantCount ?? member.uniqueCount ?? member.count, 0, { min: 0, max: 1000000 });
}

function priorityDisplay(p) {
  return p.display || p.impactDisplay || "";
}

function renderUniqueOwnersLeaderboard(uniqueOwners) {
  const byMember = (uniqueOwners && uniqueOwners.byMember) || [];
  if (!byMember.length) {
    return `<p class="engine-empty">Aucune contribution unique pour le moment.</p>`;
  }
  return `
    <ul class="engine-list engine-list--ranked">
      ${byMember.slice(0, 12).map((m, i) => `
        <li>
          <span class="engine-list__label"><span class="engine-rank">${i + 1}</span>${escapeHtml(m.username || m.userId)}</span>
          <span class="engine-list__count">${uniqueContributionCount(m)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderEngineOverview(r) {
  const s = r.summary || {};
  const a = r.analysis || {};
  const mc = a.mostComplementaryMember || {};
  const uniqueOwners = a.uniqueOwners || {};
  // Étape 83 — community context mounts asynchronously (no ranking).
  queueMicrotask(() => loadSquadCommunityContext(r.squadId || state.activeSquad));
  return `
    <div class="engine-grid engine-grid--4">
      <div class="engine-card">
        <div class="engine-card__value">${formatPct(s.collectiveCompletionRate)}</div>
        <div class="engine-card__label">${explain("Taux collectif", "collectiveCompletionRate")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${safeFiniteNumber(s.coveredVariantCount, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${explain("Variantes couvertes", "coveredVariantCount")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${safeFiniteNumber(s.totalMissing, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${explain("Variantes manquantes", "totalMissing")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${safeFiniteNumber(s.totalUnique, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${explain("Variantes uniques", "totalUnique")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.includedMemberCount != null ? safeFiniteNumber(s.includedMemberCount, 0, { min: 0, max: 1000000 }) : "—"}/${safeFiniteNumber(s.totalActiveMembers, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${explain("Collections utilisées", "includedMemberCount")}</div>
      </div>
      ${safeFiniteNumber(s.excludedPrivateCollections, 0, { min: 0, max: 1000000 }) > 0 ? `
        <div class="engine-card engine-card--warning">
          <div class="engine-card__value">${safeFiniteNumber(s.excludedPrivateCollections, 0, { min: 0, max: 1000000 })}</div>
          <div class="engine-card__label">${explain("Collections privées exclues", "excludedPrivateCollections")}</div>
        </div>
      ` : ""}
    </div>
    <div class="engine-section engine-section--community" id="squadCommunityContext" hidden>
      <h4 class="engine-section__title">Contexte communautaire</h4>
      <p class="engine-section__hint">Repères anonymes parmi des squads de taille comparable — pas de classement.</p>
      <div class="engine-community" id="squadCommunityLines"></div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${explain("Membre le plus complémentaire", "mostComplementaryMember")}</h4>
      ${mc.username ? `
        <div class="engine-card engine-card--member">
          <div class="engine-card__value">${escapeHtml(mc.username)}</div>
          <div class="engine-card__label">${uniqueContributionCount(mc)} variantes uniques apportées</div>
          ${mc.contributionDisplay ? `<div class="engine-card__sub">${escapeHtml(mc.contributionDisplay)}</div>` : ""}
        </div>
      ` : `<p class="engine-empty">Aucun membre complémentaire détecté.</p>`}
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${explain("Contributions uniques par membre", "uniqueOwner")}</h4>
      ${renderUniqueOwnersLeaderboard(uniqueOwners)}
    </div>
    <div class="engine-meta">
      <span>Généré le ${new Date(r.generatedAt).toLocaleString("fr-FR")}</span>
      <span>Catalogue : ${escapeHtml(r.catalogueVersion)}</span>
    </div>
    ${(r.warnings || []).length ? `<div class="engine-warnings">${r.warnings.map(w => `<p class="engine-warning">${escapeHtml(w)}</p>`).join("")}</div>` : ""}
  `;
}

/** Étape 83–84 — gentle peer averages (by size band), never a leaderboard. */
async function loadSquadCommunityContext(squadRef) {
  const mount = document.getElementById("squadCommunityContext");
  const linesEl = document.getElementById("squadCommunityLines");
  if (!mount || !linesEl || !squadRef) return;
  try {
    const res = await fetch(
      `${API_BASE}/sprite-graph/squads/${encodeURIComponent(squadRef)}/community`,
      { headers: typeof authHeaders === "function" ? authHeaders() : {} }
    );
    if (!res.ok) {
      mount.hidden = true;
      return;
    }
    const data = await res.json();
    const lines = (data.publicDisplay && data.publicDisplay.lines) || [];
    if (!lines.length) {
      mount.hidden = true;
      return;
    }
    linesEl.innerHTML = lines.map((line) => `
      <p class="engine-community__line">${escapeHtml(line)}</p>
    `).join("") + (data.publicDisplay?.disclaimer
      ? `<p class="engine-community__disclaimer">${escapeHtml(data.publicDisplay.disclaimer)}</p>`
      : "");
    mount.hidden = false;
  } catch (_e) {
    mount.hidden = true;
  }
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
    ${groups.map(g => `<li><span class="engine-list__label">${escapeHtml(g.label || g.key)}</span><span class="engine-list__count">${safeFiniteNumber(g.count, 0, { min: 0, max: 1000000 })}</span></li>`).join("")}
  </ul>`;
}

function getEngineAssignmentGroups(rec) {
  const planMembers = (rec.plan && rec.plan.members) || [];
  if (planMembers.length) {
    return planMembers.map(m => ({
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
      <h4 class="engine-section__title">Priorité par membre</h4>
      <p class="engine-section__hint">Répartition déterministe des recherches à fort impact entre les membres visibles.</p>
      <div class="engine-assignments">
        ${groups.length ? groups.slice(0, 20).map(a => `
          <div class="engine-assignment">
            <div class="engine-assignment__member">${escapeHtml(a.username || a.userId)}</div>
            <div class="engine-assignment__variants">${(a.variants || []).slice(0, 8).map(v => {
              const tip = (v.explanation && v.explanation.join(" ")) || priorityDisplay(v) || "";
              const gain = v.projectedCompletionGain != null ? ` · +${v.projectedCompletionGain}%` : (v.collectiveCoverageDelta != null ? ` · +${v.collectiveCoverageDelta}%` : "");
              return `<span class="engine-chip" title="${escapeHtml(tip)}">${escapeHtml(v.spriteName || v.variantId)}${gain ? `<small>${escapeHtml(gain)}</small>` : ""}</span>`;
            }).join("")}</div>
          </div>
        `).join("") : `<p class="engine-empty">Aucune assignation.</p>`}
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Acquisitions à fort impact (${priorities.length})</h4>
      <div class="engine-chip-list">
        ${priorities.slice(0, 20).map(p => {
          const tip = priorityDisplay(p);
          const delta = p.collectiveCoverageDelta != null ? ` · +${p.collectiveCoverageDelta}%` : "";
          return `<span class="engine-chip" title="${escapeHtml(tip)}">${escapeHtml(p.spriteName || p.variantId)}${delta ? `<small>${escapeHtml(delta)}</small>` : ""}</span>`;
        }).join("")}
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Objectifs suggérés (${goals.length})</h4>
      <div class="engine-goal-list">
        ${goals.length ? goals.map(g => `
          <div class="engine-goal-card">
            <div class="engine-goal-card__title">${escapeHtml(g.title)}</div>
            <div class="engine-goal-card__meta">${escapeHtml(g.reason || "")}</div>
            <div class="engine-goal-card__gain">Gain collectif : +${safePercentage(g.expectedCollectiveGain, 0)}%</div>
          </div>
        `).join("") : `<p class="engine-empty">Aucun objectif suggéré.</p>`}
      </div>
    </div>
  `;
}

function getEngineSimulateMembers(r) {
  const fromUnique = ((r.analysis && r.analysis.uniqueOwners && r.analysis.uniqueOwners.byMember) || [])
    .map(m => ({ userId: m.userId, username: m.username }));
  const fromState = (typeof state !== "undefined" && Array.isArray(state.squadMembers))
    ? state.squadMembers.map(m => ({ userId: m.userId, username: m.username }))
    : [];
  const fromPlan = (((r.recommendations || {}).plan || {}).members || [])
    .map(m => ({ userId: m.userId, username: m.username }));
  const map = new Map();
  for (const m of [...fromState, ...fromUnique, ...fromPlan]) {
    if (m.userId == null) continue;
    map.set(String(m.userId), { userId: m.userId, username: m.username || String(m.userId) });
  }
  if (typeof state !== "undefined" && state.userId != null) {
    map.set(String(state.userId), {
      userId: state.userId,
      username: state.username || "Moi"
    });
  }
  return Array.from(map.values()).sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

function getEngineSimulateVariants(r) {
  const missing = ((r.analysis && r.analysis.missing && r.analysis.missing.variants) || [])
    .filter(v => v.classification === "confirmed_missing" || v.isMissingAll);
  const priorities = (r.recommendations && r.recommendations.priorities) || [];
  const all = (r.analysis && r.analysis.allVariants) || [];
  const map = new Map();
  for (const v of [...priorities, ...missing, ...all.filter(x => x.isMissingAll || x.isPriority)]) {
    if (!v.variantId || map.has(v.variantId)) continue;
    map.set(v.variantId, {
      variantId: v.variantId,
      spriteName: v.spriteName || v.spriteId || v.variantId,
      variantName: v.variantName || "",
      score: v.score || 0,
      collectiveCoverageDelta: v.collectiveCoverageDelta
    });
  }
  return Array.from(map.values()).sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.spriteName).localeCompare(String(b.spriteName)));
}

function renderEngineSimulateResult(result) {
  if (!result) {
    return `<p class="engine-empty">Choisis un membre et une variante pour estimer l’impact collectif.</p>`;
  }
  const before = result.before || {};
  const after = result.after || {};
  const diff = result.difference || {};
  const rateDelta = Number(diff.completionRate || 0);
  const coveredDelta = Number(diff.coveredCount || 0);
  const rateClass = rateDelta > 0 ? "engine-sim__delta--up" : (rateDelta < 0 ? "engine-sim__delta--down" : "");
  return `
    <div class="engine-grid engine-grid--3">
      <div class="engine-card">
        <div class="engine-card__value">${formatPct(before.completionRate)}</div>
        <div class="engine-card__label">Avant</div>
        <div class="engine-card__sub">${safeFiniteNumber(before.coveredCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(before.totalVariantCount, 0, { min: 0, max: 1000000 })}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${formatPct(after.completionRate)}</div>
        <div class="engine-card__label">Après</div>
        <div class="engine-card__sub">${safeFiniteNumber(after.coveredCount, 0, { min: 0, max: 1000000 })} / ${safeFiniteNumber(after.totalVariantCount, 0, { min: 0, max: 1000000 })}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value ${rateClass}">${rateDelta > 0 ? "+" : ""}${formatPct(rateDelta)}</div>
        <div class="engine-card__label">Δ taux collectif</div>
        <div class="engine-card__sub">${coveredDelta > 0 ? "+" : ""}${coveredDelta} variante${Math.abs(coveredDelta) === 1 ? "" : "s"}</div>
      </div>
    </div>
    ${result.appliedChanges != null ? `<p class="engine-section__hint">${safeFiniteNumber(result.appliedChanges, 0, { min: 0, max: 20 })} changement${result.appliedChanges > 1 ? "s" : ""} simulé${result.appliedChanges > 1 ? "s" : ""}.</p>` : ""}
  `;
}

function getEngineSelectableVariants(r) {
  const variants = (r.analysis && r.analysis.allVariants) || [];
  return variants
    .filter(v => v && v.variantId)
    .slice()
    .sort((a, b) => String(a.spriteName || a.spriteId || "").localeCompare(String(b.spriteName || b.spriteId || ""))
      || String(a.variantName || a.variantId).localeCompare(String(b.variantName || b.variantId)));
}

function engineMemberOptions(members) {
  return members.map(m => `<option value="${escapeHtml(String(m.userId))}">${escapeHtml(m.username || String(m.userId))}</option>`).join("");
}

function engineVariantOptions(variants) {
  return variants.map(v => {
    const label = `${v.spriteName || v.spriteId || v.variantId}${v.variantName ? ` · ${v.variantName}` : ""}`;
    return `<option value="${escapeHtml(String(v.variantId))}">${escapeHtml(label)}</option>`;
  }).join("");
}

function describeEngineScenarioChange(change, members, variants) {
  const memberById = new Map(members.map(m => [String(m.userId), m.username || String(m.userId)]));
  const variantById = new Map(variants.map(v => [String(v.variantId), `${v.spriteName || v.spriteId || v.variantId}${v.variantName ? ` · ${v.variantName}` : ""}`]));
  if (change.type === "acquire") {
    const names = (change.variantIds || []).map(id => variantById.get(String(id)) || String(id));
    return `${memberById.get(String(change.memberId)) || change.memberId} obtient ${names.join(", ")}`;
  }
  if (change.type === "join") {
    const names = (change.ownedVariantIds || []).map(id => variantById.get(String(id)) || String(id));
    return `${change.username || "Nouveau membre"} rejoint${names.length ? ` avec ${names.join(", ")}` : " sans variante renseignée"}`;
  }
  if (change.type === "leave") return `${memberById.get(String(change.memberId)) || change.memberId} quitte la squad`;
  return "Changement simulé";
}

function engineScenarioQueueHtml(members, variants) {
  if (!engineScenarioChanges.length) return `<p class="engine-empty">Aucun changement dans le scénario.</p>`;
  return `<ol class="engine-scenario__queue">${engineScenarioChanges.map((change, index) => `
    <li><span>${escapeHtml(describeEngineScenarioChange(change, members, variants))}</span><button type="button" class="ghost-button engine-scenario__remove" data-engine-scenario-remove="${index}">Retirer</button></li>
  `).join("")}</ol>`;
}

function renderEngineScenarioQueue(members, variants) {
  const queue = document.getElementById("squadEngineScenarioQueue");
  if (queue) queue.innerHTML = engineScenarioQueueHtml(members, variants);
}

function renderEngineCombinationResult(data) {
  const team = data && (data.teams || [])[0];
  if (!team) return `<p class="engine-empty">Aucune combinaison trouvée.</p>`;
  const names = (team.members || []).map(m => escapeHtml(m.username || m.displayName || m.userId)).join(", ");
  return `<div class="engine-result"><strong>${formatPct(team.coverageRate)} de couverture</strong><span>${safeFiniteNumber(team.coveredVariantCount, 0, { min: 0, max: 1000000 })} variantes · ${names || "Membres indisponibles"}</span></div>`;
}

function renderEngineMinimumTeamResult(data) {
  if (!data) return `<p class="engine-empty">Aucune équipe ne peut atteindre cet objectif.</p>`;
  const names = (data.members || []).map(m => escapeHtml(m.username || m.displayName || m.userId)).join(", ");
  return `<div class="engine-result"><strong>${safeFiniteNumber(data.minPlayers, 0, { min: 0, max: 1000000 })} joueur${data.minPlayers > 1 ? "s" : ""}</strong><span>${escapeHtml(data.display || "")} ${names ? `· ${names}` : ""}</span></div>`;
}

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
        <div class="engine-card__label">${explain("Meilleure paire", "bestPair")}</div>
        <div class="engine-card__sub">${bp.userAName && bp.userBName ? `${escapeHtml(bp.userAName)} + ${escapeHtml(bp.userBName)}` : "Aucune"}</div>
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${explain("Meilleur groupe", "bestTeam")}</h4>
      <p class="engine-section__hint">Compare les groupes de 2, 3 ou 4 membres ayant la meilleure couverture collective.</p>
      <form class="engine-sim" id="squadEngineCombinationForm">
        <label class="engine-sim__field">
          <span>Taille du groupe</span>
          <select class="engine-select" name="size">
            <option value="2">2 joueurs</option>
            <option value="3" selected>3 joueurs</option>
            <option value="4">4 joueurs</option>
          </select>
        </label>
        <button type="submit" class="ghost-button engine-sim__submit">Calculer</button>
      </form>
      <div id="squadEngineCombinationResult"><p class="engine-empty">Choisis une taille de groupe.</p></div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${explain("Équipe minimale", "minimumTeam")}</h4>
      <p class="engine-section__hint">Trouve le plus petit nombre de membres nécessaire pour atteindre un objectif de couverture.</p>
      <form class="engine-sim" id="squadEngineMinimumTeamForm">
        <label class="engine-sim__field">
          <span>Objectif de couverture</span>
          <input class="engine-select" name="target" type="number" min="1" max="100" value="90" required>
        </label>
        <button type="submit" class="ghost-button engine-sim__submit">Calculer</button>
      </form>
      <div id="squadEngineMinimumTeamResult"><p class="engine-empty">Objectif par défaut : 90 %.</p></div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${explain("Scénario de squad", "simulation")}</h4>
      <p class="engine-section__hint">Ajoute plusieurs acquisitions, l’arrivée d’un membre ou le départ d’un membre, puis simule l’ensemble sans modifier les collections.</p>
      <div class="engine-scenario">
        <form class="engine-sim" id="squadEngineScenarioAcquireForm">
          <label class="engine-sim__field"><span>Membre</span><select class="engine-select" name="memberId" required ${members.length ? "" : "disabled"}><option value="">Choisir…</option>${memberOpts}</select></label>
          <label class="engine-sim__field"><span>Variantes obtenues</span><select class="engine-select engine-sim__multi" name="variantIds" multiple required ${variants.length ? "" : "disabled"}>${variantOpts}</select></label>
          <button type="submit" class="ghost-button engine-sim__submit" ${members.length && variants.length ? "" : "disabled"}>Ajouter acquisition</button>
        </form>
        <form class="engine-sim" id="squadEngineScenarioJoinForm">
          <label class="engine-sim__field"><span>Nouveau membre</span><input class="engine-select" name="username" maxlength="80" placeholder="Pseudo"></label>
          <label class="engine-sim__field"><span>Variantes possédées</span><select class="engine-select engine-sim__multi" name="ownedVariantIds" multiple>${variantOpts}</select></label>
          <button type="submit" class="ghost-button engine-sim__submit">Ajouter arrivée</button>
        </form>
        <form class="engine-sim" id="squadEngineScenarioLeaveForm">
          <label class="engine-sim__field"><span>Membre qui quitte</span><select class="engine-select" name="memberId" required ${members.length ? "" : "disabled"}><option value="">Choisir…</option>${memberOpts}</select></label>
          <button type="submit" class="ghost-button engine-sim__submit" ${members.length ? "" : "disabled"}>Ajouter départ</button>
        </form>
      </div>
      <div id="squadEngineScenarioQueue">${engineScenarioQueueHtml(members, variants)}</div>
      <button type="button" class="ghost-button engine-scenario__run" id="squadEngineScenarioRun">Simuler le scénario</button>
      <div id="squadEngineSimulateResult">${renderEngineSimulateResult(null)}</div>
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

async function runEngineScenarioSimulation(changes = engineScenarioChanges) {
  const code = state.activeSquad;
  const resultEl = document.getElementById("squadEngineSimulateResult");
  if (!code || !resultEl || !changes.length) return;
  resultEl.innerHTML = `<p class="engine-empty">Calcul en cours…</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/completion/simulate`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ changes })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      resultEl.innerHTML = `<p class="engine-empty">${escapeHtml(data.error || "Simulation impossible.")}</p>`;
      return;
    }
    const data = await res.json();
    resultEl.innerHTML = renderEngineSimulateResult(data);
  } catch (e) {
    console.error("[runEngineAcquisitionSimulate]", e);
    resultEl.innerHTML = `<p class="engine-empty">Erreur réseau</p>`;
  }
}

async function loadEngineCombinations(size) {
  const resultEl = document.getElementById("squadEngineCombinationResult");
  if (!state.activeSquad || !resultEl) return;
  resultEl.innerHTML = `<p class="engine-empty">Calcul en cours…</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/completion/combinations?size=${encodeURIComponent(size)}`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    resultEl.innerHTML = res.ok ? renderEngineCombinationResult(data) : `<p class="engine-empty">${escapeHtml(data.error || "Calcul impossible.")}</p>`;
  } catch (e) {
    console.error("[loadEngineCombinations]", e);
    resultEl.innerHTML = `<p class="engine-empty">Erreur réseau</p>`;
  }
}

async function loadEngineMinimumTeam(target) {
  const resultEl = document.getElementById("squadEngineMinimumTeamResult");
  if (!state.activeSquad || !resultEl) return;
  resultEl.innerHTML = `<p class="engine-empty">Calcul en cours…</p>`;
  try {
    const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/minimum-team?targetType=coverage&target=${encodeURIComponent(target)}`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    resultEl.innerHTML = res.ok ? renderEngineMinimumTeamResult(data) : `<p class="engine-empty">${escapeHtml(data.error || "Aucune équipe ne peut atteindre cet objectif.")}</p>`;
  } catch (e) {
    console.error("[loadEngineMinimumTeam]", e);
    resultEl.innerHTML = `<p class="engine-empty">Erreur réseau</p>`;
  }
}

function addEngineScenarioChange(change) {
  if (engineScenarioChanges.length >= 20) {
    toast("Un scénario est limité à 20 changements.");
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
        addEngineScenarioChange({ type: "join", username: username || "Nouveau membre", ownedVariantIds });
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
