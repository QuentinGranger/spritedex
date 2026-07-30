(() => {
  const queryLanguage = new URLSearchParams(location.search).get("lang");
  const francophoneRegions = new Set(["BJ", "BI", "CM", "KM", "CI", "DJ", "GA", "GN", "GQ", "MG", "CF", "CD", "CG", "RW", "SN", "SC", "TD", "TG", "DZ", "BF", "ML", "MA", "MU", "MR", "NE", "TN", "BE", "FR", "LU", "MC", "CH", "AD", "CA", "HT", "LB", "VU"]);
  const locales = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  const french = queryLanguage === "fr" || (queryLanguage !== "en" && locales.some((locale) => {
    const [language, region] = String(locale).replace(/_/g, "-").split("-");
    return language.toLowerCase() === "fr" || francophoneRegions.has(String(region || "").toUpperCase());
  }));
  const english = !french;
  const copy = english ? {
    backoffice: "BACKOFFICE", session: "Secure terminal session", logout: "End session",
    overviewEyebrow: "OPERATIONAL CONTROL", overviewTitle: "Sprite Graph at a glance.",
    overviewLead: "Monitor ingestion, consolidation and public metric availability.", refresh: "Refresh",
    events24h: "Events · 24h", eventsHint: "Recorded Graph events", ingestion: "Ingestion", ingestionHint: "Events per minute",
    workerLag: "Worker lag", workerHint: "Oldest pending item", rejected: "Rejected · 24h", rejectedHint: "Errors and failed messages",
    activityEyebrow: "ACTIVITY", activityTitle: "Last 24-hour flow", healthEyebrow: "HEALTH", healthTitle: "Pipeline",
    publicEyebrow: "SAFEGUARDS", metricsTitle: "Public metrics", metricsLead: "Temporarily suspend a metric when in doubt. A reason is required.",
    export: "Export aggregates", readinessEyebrow: "VALIDATION", readinessTitle: "Readiness", formulaEyebrow: "TRACEABILITY", formulaTitle: "Formula versions",
    loadingData: "Loading data…", updated: "Updated {time}", lastConsolidation: "Last consolidation: {time}", noConsolidation: "No consolidation published yet",
    pendingOutbox: "Pending outbox", failedOutbox: "Failed outbox", tableRows: "Graph rows", tableSize: "Storage", sampleSize: "Today's samples",
    noActivity: "No event recorded in the last 24 hours.", ready: "Ready", needsAttention: "Needs attention", disabled: "Public display suspended", active: "Public display active",
    disablePrompt: "Why suspend {metric}?", disableReasonRequired: "A reason is required to suspend a public metric.", updateFailed: "The change could not be saved.",
    loadFailed: "The backoffice data could not be loaded. Refresh to try again.", exportFailed: "The aggregate export could not be prepared.", exportName: "sprite-index-aggregates.json",
    collection: "Collection ownership", priority: "Missing-item priority", interest: "Community interest", trend: "Interest trend", squad: "Squad progress", sample: "Sample size", priorityAdds: "Priority adds · 7 days",
    metricOverview: "Operational indicators", noFormula: "No formula version available"
  } : {
    backoffice: "BACKOFFICE", session: "Session terminal sécurisée", logout: "Fermer la session",
    overviewEyebrow: "CONTRÔLE OPÉRATIONNEL", overviewTitle: "Sprite Graph, en un coup d’œil.",
    overviewLead: "Surveillez l’ingestion, les consolidations et la diffusion des métriques publiques.", refresh: "Actualiser",
    events24h: "Événements · 24 h", eventsHint: "Événements Graph enregistrés", ingestion: "Ingestion", ingestionHint: "Événements par minute",
    workerLag: "Retard du worker", workerHint: "Plus ancien élément en attente", rejected: "Rejets · 24 h", rejectedHint: "Erreurs et messages en échec",
    activityEyebrow: "ACTIVITÉ", activityTitle: "Flux des dernières 24 heures", healthEyebrow: "SANTÉ", healthTitle: "Pipeline",
    publicEyebrow: "GARDE-FOUS", metricsTitle: "Métriques publiques", metricsLead: "Suspendez temporairement une métrique en cas de doute. Une justification est demandée.",
    export: "Exporter les agrégats", readinessEyebrow: "VALIDATION", readinessTitle: "État de préparation", formulaEyebrow: "TRAÇABILITÉ", formulaTitle: "Versions de formules",
    loadingData: "Chargement des données…", updated: "Actualisé {time}", lastConsolidation: "Dernière consolidation : {time}", noConsolidation: "Aucune consolidation publiée",
    pendingOutbox: "Outbox en attente", failedOutbox: "Outbox en échec", tableRows: "Lignes Graph", tableSize: "Stockage", sampleSize: "Échantillons du jour",
    noActivity: "Aucun événement enregistré sur les dernières 24 heures.", ready: "Prêt", needsAttention: "À surveiller", disabled: "Affichage public suspendu", active: "Affichage public actif",
    disablePrompt: "Pourquoi suspendre {metric} ?", disableReasonRequired: "Une justification est requise pour suspendre une métrique publique.", updateFailed: "La modification n’a pas pu être enregistrée.",
    loadFailed: "Les données du backoffice n’ont pas pu être chargées. Actualisez pour réessayer.", exportFailed: "L’export des agrégats n’a pas pu être préparé.", exportName: "sprite-index-agregats.json",
    collection: "Possession communautaire", priority: "Priorité parmi les manquants", interest: "Intérêt communautaire", trend: "Tendance d’intérêt", squad: "Progression de squad", sample: "Taille d’échantillon", priorityAdds: "Ajouts en priorité · 7 jours",
    metricOverview: "Indicateurs opérationnels", noFormula: "Aucune version de formule disponible"
  };

  const metricNames = {
    ownership_rate: copy.collection, priority_rate: copy.priority, interest_score: copy.interest,
    interest_trend: copy.trend, squad_progress: copy.squad, sample_size: copy.sample,
    priority_adds_7d: copy.priorityAdds
  };
  const $ = (selector) => document.querySelector(selector);
  const number = new Intl.NumberFormat(english ? "en-US" : "fr-FR");
  const dateTime = new Intl.DateTimeFormat(english ? "en-US" : "fr-FR", { dateStyle: "medium", timeStyle: "short" });
  const state = { board: null, catalog: null, readiness: null, formulas: null, loading: false };

  function interpolate(text, params = {}) {
    return String(text).replace(/\{(\w+)\}/g, (_, key) => params[key] == null ? `{${key}}` : String(params[key]));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${number.format(Math.round(value))} ${english ? "sec" : "s"}`;
    if (value < 3600) return `${number.format(Math.round(value / 60))} ${english ? "min" : "min"}`;
    return `${number.format(Math.round(value / 3600))} ${english ? "h" : "h"}`;
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024 * 1024) return `${number.format(Math.round(value / 1024))} KB`;
    return `${number.format(Math.round((value / (1024 * 1024)) * 10) / 10)} MB`;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
  }

  function setAlert(message = "") {
    const alert = $("#adminAlert");
    alert.hidden = !message;
    alert.textContent = message;
  }

  async function adminFetch(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", ...options });
    if (response.status === 401) {
      location.replace(`/admin/access${location.search}`);
      throw new Error("unauthorized");
    }
    if (!response.ok) throw new Error("request_failed");
    return response.status === 204 ? null : response.json();
  }

  function renderBoard() {
    const board = state.board || {};
    const technical = board.technical || {};
    $("#kpiEvents").textContent = number.format(Number(board.eventsLast24h) || 0);
    $("#kpiIngestion").textContent = `${number.format(Number(technical.eventsPerMinute) || 0)}/min`;
    $("#kpiLag").textContent = formatDuration(technical.workerLagSeconds);
    $("#kpiRejected").textContent = number.format(Number(board.rejectedEventsLast24h) || 0);
    $("#adminUpdated").textContent = interpolate(copy.updated, { time: formatDate(board.asOf) });

    const consolidation = board.lastConsolidation?.publishedAt;
    $("#adminConsolidation").textContent = consolidation
      ? interpolate(copy.lastConsolidation, { time: formatDate(consolidation) })
      : copy.noConsolidation;

    const events = Array.isArray(board.eventsByType) ? board.eventsByType : [];
    $("#adminEvents").innerHTML = events.length
      ? events.map((event) => `<div class="admin-event"><code>${escapeHtml(event.eventType)}</code><strong>${number.format(Number(event.count) || 0)}</strong></div>`).join("")
      : `<p class="admin-empty">${escapeHtml(copy.noActivity)}</p>`;

    const health = [
      [copy.pendingOutbox, number.format(Number(technical.pendingOutbox) || 0)],
      [copy.failedOutbox, number.format(Number(technical.failedOutbox) || 0)],
      [copy.tableRows, number.format(Number(technical.table?.rowCount) || 0)],
      [copy.tableSize, formatBytes(technical.table?.sizeBytes)],
      [copy.sampleSize, number.format(Number(board.sampleSizes?.rows) || 0)]
    ];
    $("#adminHealth").innerHTML = health.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  }

  function renderMetrics() {
    const flags = new Map((state.board?.metricFlags || []).map((flag) => [flag.key, flag]));
    const metrics = state.catalog?.metrics || [];
    $("#adminMetrics").innerHTML = metrics.map((metric) => {
      const flag = flags.get(metric.id);
      const disabled = flag?.disabled === true;
      const reason = disabled && flag?.reason ? `<small class="admin-metric__reason">${escapeHtml(flag.reason)}</small>` : "";
      const name = metricNames[metric.id] || metric.id;
      return `<article class="admin-metric"><div class="admin-metric__copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(disabled ? copy.disabled : copy.active)}</small>${reason}</div><label title="${escapeHtml(name)}"><input type="checkbox" data-metric-flag="${escapeHtml(metric.id)}" ${disabled ? "checked" : ""}><span></span></label></article>`;
    }).join("") || `<p class="admin-empty">${escapeHtml(copy.loadingData)}</p>`;
  }

  function renderReadiness() {
    const readiness = state.readiness || {};
    const ready = readiness.ready === true;
    const status = $("#adminReadinessStatus");
    status.textContent = ready ? copy.ready : copy.needsAttention;
    status.className = `admin-readiness ${ready ? "admin-readiness--ready" : "admin-readiness--blocked"}`;
    $("#adminReadiness").innerHTML = (readiness.criteria || []).map((criterion) => (
      `<li class="${criterion.ok ? "is-ok" : ""}">${escapeHtml(String(criterion.id || "").replace(/_/g, " "))}</li>`
    )).join("");
  }

  function renderFormulas() {
    const formulas = state.formulas?.current || state.board?.formulas?.current || {};
    const entries = Object.entries(formulas);
    $("#adminFormulas").innerHTML = entries.length
      ? entries.map(([key, version]) => `<div class="admin-formula"><span>${escapeHtml(key)}</span><code>${escapeHtml(version)}</code></div>`).join("")
      : `<p class="admin-empty">${escapeHtml(copy.noFormula)}</p>`;
  }

  function render() {
    renderBoard();
    renderMetrics();
    renderReadiness();
    renderFormulas();
  }

  async function loadDashboard() {
    if (state.loading) return;
    state.loading = true;
    const refresh = $("#adminRefresh");
    refresh.disabled = true;
    setAlert();
    try {
      const [board, catalog, readiness, formulas] = await Promise.all([
        adminFetch("/api/admin/sprite-graph/control-board"),
        adminFetch("/api/admin/sprite-graph/metrics-catalog?surface=public"),
        adminFetch("/api/admin/sprite-graph/v1-readiness"),
        adminFetch("/api/admin/sprite-graph/formulas")
      ]);
      state.board = board;
      state.catalog = catalog;
      state.readiness = readiness;
      state.formulas = formulas;
      render();
    } catch (error) {
      if (error.message !== "unauthorized") setAlert(copy.loadFailed);
    } finally {
      refresh.disabled = false;
      state.loading = false;
    }
  }

  async function setMetricFlag(input) {
    const metricKey = input.dataset.metricFlag;
    const disabled = input.checked;
    const metric = state.catalog?.metrics?.find((item) => item.id === metricKey);
    const name = metricNames[metricKey] || metricKey;
    let reason = null;
    if (disabled) {
      reason = window.prompt(interpolate(copy.disablePrompt, { metric: name }), "");
      if (reason == null || !reason.trim()) {
        input.checked = false;
        if (reason !== null) setAlert(copy.disableReasonRequired);
        return;
      }
    }
    input.disabled = true;
    try {
      await adminFetch("/api/admin/sprite-graph/flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ metricKey, disabled, reason })
      });
      await loadDashboard();
    } catch (error) {
      input.checked = !disabled;
      if (error.message !== "unauthorized") setAlert(copy.updateFailed);
    } finally {
      input.disabled = false;
    }
  }

  async function exportAggregates() {
    const button = $("#adminExport");
    button.disabled = true;
    try {
      const payload = await adminFetch("/api/admin/sprite-graph/export/aggregates?limit=2000");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = copy.exportName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      if (error.message !== "unauthorized") setAlert(copy.exportFailed);
    } finally {
      button.disabled = false;
    }
  }

  document.documentElement.lang = english ? "en" : "fr";
  document.title = `SPRITE-INDEX — ${copy.backoffice}`;
  document.querySelectorAll("[data-copy]").forEach((node) => { node.textContent = copy[node.dataset.copy] || node.textContent; });
  document.querySelectorAll("[data-copy-aria]").forEach((node) => { node.setAttribute("aria-label", copy[node.dataset.copyAria] || node.getAttribute("aria-label")); });
  $("#adminRefresh").addEventListener("click", loadDashboard);
  $("#adminMetrics").addEventListener("change", (event) => {
    const input = event.target.closest("[data-metric-flag]");
    if (input) setMetricFlag(input);
  });
  $("#adminExport").addEventListener("click", exportAggregates);
  $("#adminLogout").addEventListener("click", async () => {
    try { await adminFetch("/api/admin/logout", { method: "POST" }); } catch (_) {}
    location.replace(`/admin/access${location.search}`);
  });

  loadDashboard();
  setInterval(() => { if (document.visibilityState === "visible") loadDashboard(); }, 30_000);
})();
