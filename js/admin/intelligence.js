(() => {
  "use strict";

  async function loadIntelligence() {
    const [board, catalog, readiness, formulas] = await Promise.all([
      adminFetch("/api/admin/sprite-graph/control-board"),
      adminFetch("/api/admin/sprite-graph/metrics-catalog?surface=public"),
      adminFetch("/api/admin/sprite-graph/v1-readiness"),
      adminFetch("/api/admin/sprite-graph/formulas")
    ]);
    state.graph = { board, catalog, readiness, formulas };
    const technical = board.technical || {};
    $("#graphKpis").innerHTML = [
      kpi(
        english ? "Events · 24h" : "Événements · 24 h",
        formatNumber(board.eventsLast24h),
        english ? "recorded graph events" : "événements Graph enregistrés"
      ),
      kpi(
        english ? "Ingestion" : "Ingestion",
        `${formatNumber(technical.eventsPerMinute)}/min`,
        english ? "events per minute" : "événements par minute"
      ),
      kpi(
        english ? "Worker lag" : "Retard du worker",
        formatDuration(technical.workerLagSeconds),
        english ? "oldest pending item" : "plus ancien élément en attente"
      ),
      kpi(
        english ? "Rejected · 24h" : "Rejets · 24 h",
        formatNumber(board.rejectedEventsLast24h),
        english ? "errors and failed messages" : "erreurs et messages en échec",
        Number(board.rejectedEventsLast24h) ? "warning" : ""
      )
    ].join("");
    const consolidation = board.lastConsolidation?.publishedAt;
    $("#adminConsolidation").textContent = consolidation
      ? `${english ? "Last consolidation:" : "Dernière consolidation :"} ${formatDate(consolidation)}`
      : english
        ? "No consolidation published yet"
        : "Aucune consolidation publiée";
    $("#adminEvents").innerHTML = (board.eventsByType || []).length
      ? board.eventsByType
          .map(
            (event) =>
              `<div class="admin-event"><code>${escapeHtml(event.eventType)}</code><strong>${formatNumber(event.count)}</strong></div>`
          )
          .join("")
      : empty();
    $("#adminHealth").innerHTML = healthRows([
      [english ? "Pending outbox" : "Outbox en attente", formatNumber(technical.pendingOutbox)],
      [english ? "Failed outbox" : "Outbox en échec", formatNumber(technical.failedOutbox)],
      [english ? "Graph rows" : "Lignes Graph", formatNumber(technical.table?.rowCount)],
      [english ? "Today's samples" : "Échantillons du jour", formatNumber(board.sampleSizes?.rows)]
    ]);
    const isReady = readiness.ready === true;
    const readinessNode = $("#adminReadinessStatus");
    readinessNode.textContent = isReady ? (english ? "Ready" : "Prêt") : english ? "Needs attention" : "À surveiller";
    readinessNode.className = `admin-readiness ${isReady ? "admin-readiness--ready" : "admin-readiness--blocked"}`;
    $("#adminReadiness").innerHTML = (readiness.criteria || [])
      .map(
        (item) => `<li class="${item.ok ? "is-ok" : ""}">${escapeHtml(String(item.id || "").replace(/_/g, " "))}</li>`
      )
      .join("");
    const flags = new Map((board.metricFlags || []).map((flag) => [flag.key, flag]));
    $("#adminMetrics").innerHTML =
      (catalog.metrics || [])
        .map((metric) => {
          const flag = flags.get(metric.id),
            disabled = flag?.disabled === true;
          return `<article class="admin-metric"><div class="admin-metric__copy"><strong>${escapeHtml(metric.name || metric.id)}</strong><small>${escapeHtml(disabled ? (english ? "Public display suspended" : "Affichage public suspendu") : english ? "Public display active" : "Affichage public actif")}</small>${disabled && flag.reason ? `<small class="admin-metric__reason">${escapeHtml(flag.reason)}</small>` : ""}</div>${can("intelligence.write") ? `<label><input type="checkbox" data-metric-flag="${escapeHtml(metric.id)}" ${disabled ? "checked" : ""}><span></span></label>` : `<em class="admin-metric__ro">${escapeHtml(disabled ? (english ? "Suspended" : "Suspendu") : english ? "Active" : "Actif")}</em>`}</article>`;
        })
        .join("") || empty();
    const entries = Object.entries(formulas.current || {});
    $("#adminFormulas").innerHTML = entries.length
      ? entries
          .map(
            ([key, version]) =>
              `<div class="admin-formula"><span>${escapeHtml(key)}</span><code>${escapeHtml(version)}</code></div>`
          )
          .join("")
      : empty();
  }

  Object.assign(window, { loadIntelligence });
})();
