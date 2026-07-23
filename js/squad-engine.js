// Squad completion engine UI
let squadEngineReport = null;
let squadEngineTab = "overview";

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
        <div class="engine-card__label">Taux collectif</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.coveredVariantCount || 0}</div>
        <div class="engine-card__label">Variantes couvertes</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.totalMissing || 0}</div>
        <div class="engine-card__label">Variantes manquantes</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.totalUnique || 0}</div>
        <div class="engine-card__label">Variantes uniques</div>
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Membre le plus complémentaire</h4>
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

function renderEngineMissing(r) {
  const m = (r.analysis && r.analysis.missing) || {};
  const variants = m.variants || [];
  const confirmed = variants.filter(v => v.classification === "confirmed_missing");
  const maybe = variants.filter(v => v.classification !== "confirmed_missing");
  return `
    <div class="engine-grid engine-grid--4">
      <div class="engine-card">
        <div class="engine-card__value">${confirmed.length}</div>
        <div class="engine-card__label">Totalement absents</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${maybe.length}</div>
        <div class="engine-card__label">Peut-être absents</div>
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
        <div class="engine-card__label">Meilleure paire</div>
        <div class="engine-card__sub">${bp.userAName && bp.userBName ? `${escapeHtml(bp.userAName)} + ${escapeHtml(bp.userBName)}` : "Aucune"}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${teams.length ? `${teams[0].coverageRate != null ? formatPct(teams[0].coverageRate) : "—"}` : "—"}</div>
        <div class="engine-card__label">Meilleur groupe de ${bt.teamSize || 3}</div>
        <div class="engine-card__sub">${teams.length ? (teams[0].members || []).map(m => escapeHtml(m.username || m.userId)).join(", ") : "Aucun"}</div>
      </div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">Simulations</h4>
      <p class="engine-empty">Utilise l'API <code>POST /api/squads/:squadId/completion/simulate</code> pour tester des acquisitions ou des arrivées de membres.</p>
    </div>
  `;
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
}

setupSquadEngine();
