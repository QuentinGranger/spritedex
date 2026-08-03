(() => {
  "use strict";

  async function loadPlayers() {
    const q = $("#playerSearch").value.trim(),
      stateFilter = $("#playerState").value;
    const params = new URLSearchParams({ page: String(state.players.page), pageSize: "20", state: stateFilter });
    if (q) params.set("q", q);
    const reportParams = new URLSearchParams({ status: "open", pageSize: "12" });
    if (state.players.reportPriority !== "all") reportParams.set("priority", state.players.reportPriority);
    const [data, reports] = await Promise.all([
      adminFetch(`/api/admin/players?${params}`),
      adminFetch(`/api/admin/reports?${reportParams}`)
    ]);
    $("#playersCount").textContent = `${formatNumber(data.total)} ${english ? "account(s)" : "compte(s)"}`;
    $("#playersList").innerHTML = data.items.length
      ? data.items
          .map((player) => {
            const suspended = player.suspendedUntil && new Date(player.suspendedUntil) > new Date();
            const reportTone = player.openReports ? "warning" : suspended ? "danger" : "good";
            const stateLabel = suspended
              ? player.suspensionSource === "admin"
                ? english
                  ? "Admin suspension"
                  : "Suspension admin"
                : english
                  ? "Voluntary pause"
                  : "Pause volontaire"
              : player.openReports
                ? `${player.openReports} ${english ? "report(s)" : "signalement(s)"}`
                : english
                  ? "Active"
                  : "Actif";
            const selected = String(state.players.selected) === String(player.id) ? " is-selected" : "";
            return `<tr class="admin-player-row${selected}" data-player-id="${player.id}"><td><strong>${escapeHtml(player.displayName || player.username)}</strong><small>@${escapeHtml(player.username)} · ${english ? "joined" : "inscrit"} ${formatDate(player.createdAt, false)}</small></td><td><strong>${formatPercent(player.collection.completionRate)}</strong><small>${formatNumber(player.collection.ownedVariants)} / ${formatNumber(player.collection.releasedVariants)} ${english ? "variants" : "variantes"}</small></td><td>${formatDate(player.lastActiveAt)}</td><td>${stateBadge(stateLabel, reportTone)}${suspended ? `<small>${english ? "until" : "jusqu’au"} ${formatDate(player.suspendedUntil)}</small>` : ""}</td><td><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-player="${player.id}">${english ? "Open" : "Ouvrir"}</button>${can("players.moderate") ? `<button class="admin-row-button ${suspended ? "" : "admin-row-button--danger"}" type="button" data-player-action="${suspended ? "unsuspend" : "suspend"}" data-player-id="${player.id}" data-player-name="${escapeHtml(player.username)}">${suspended ? tr("unsuspend", "Réactiver") : tr("suspend", "Suspendre")}</button>` : ""}</div></td></tr>`;
          })
          .join("")
      : `<tr><td colspan="5">${empty(english ? "No account found." : "Aucun compte trouvé.")}</td></tr>`;
    renderPagination("#playersPagination", data, "players");
    const counts = reports.facets?.priorityCounts || {};
    $("#reportTriage").innerHTML = ["urgent", "high", "normal", "low"]
      .map(
        (priority) =>
          `<button class="admin-triage-chip ${state.players.reportPriority === priority ? "is-active" : ""} admin-triage-chip--${priority}" type="button" data-report-priority-filter="${priority}" aria-pressed="${state.players.reportPriority === priority}"><span>${escapeHtml(reportPriorityLabel(priority))}</span><strong>${formatNumber(counts[priority] || 0)}</strong></button>`
      )
      .join("");
    $("#reportPriorityFilter").value = state.players.reportPriority;
    $("#reportsList").innerHTML = reports.items.length
      ? reports.items
          .map((report) => {
            const reporter = report.reporter || {};
            const reported = report.reported || {};
            const suspended = reported.suspendedUntil && new Date(reported.suspendedUntil) > new Date();
            const risky = Number(reporter.reportsFiledLast7d || 0) >= 5;
            const selected = String(state.players.focusReportId) === String(report.id) ? " is-selected" : "";
            const priority = report.priority || "normal";
            return `<article class="admin-report${selected}" data-report-id="${escapeHtml(report.id)}">
        <div class="admin-report__top"><div class="admin-report__identity"><strong>@${escapeHtml(reported.username || "—")}</strong><small>${escapeHtml(reported.displayName || "")}</small></div><span>${stateBadge(reportPriorityLabel(priority), reportPriorityTone(priority))}<time>${formatDate(report.createdAt, false)}</time></span></div>
        <p>${escapeHtml(report.reason || "—")}</p>
        ${reportContextMarkup(report.context)}
        <span class="admin-report__context">${english ? "Reported by" : "Signalé par"}
          <button type="button" data-open-player="${escapeHtml(reporter.id)}">@${escapeHtml(reporter.username || "—")}</button>
          · ${formatNumber(reporter.totalReportsFiled || 0)} ${english ? "report(s) filed" : "signalement(s) déposés"}
          ${reporter.openReportsFiled ? ` · ${formatNumber(reporter.openReportsFiled)} ${english ? "open" : "ouverts"}` : ""}
          ${reporter.reportsFiledLast7d ? ` · ${formatNumber(reporter.reportsFiledLast7d)} ${english ? "in 7 days" : "sur 7 jours"}` : ""}
        </span>
        ${risky ? `<span class="admin-report__risk">${english ? "High reporting volume" : "Volume de signalements élevé"}</span>` : ""}
        <small>${suspended ? (english ? "Account currently suspended" : "Compte actuellement suspendu") : english ? "Account active" : "Compte actif"}
          · ${formatNumber(reported.openReports || 0)} ${english ? "open report(s) on this account" : "signalement(s) ouverts sur ce compte"}</small>
        <div class="admin-report__actions">
          <button class="admin-row-button" type="button" data-open-player="${escapeHtml(reported.id)}" data-focus-report="${escapeHtml(report.id)}">${english ? "Review dossier" : "Voir le dossier"}</button>
          ${
            can("players.moderate")
              ? `<button class="admin-row-button" type="button" data-report-action="resolved" data-report-id="${report.id}" data-reported-id="${escapeHtml(reported.id)}" data-reported-name="${escapeHtml(reported.username || "")}" data-open-reports="${escapeHtml(reported.openReports || 0)}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("resolve", "Résoudre")}</button>
          <button class="admin-row-button admin-row-button--danger" type="button" data-report-action="resolved" data-report-suspend="true" data-report-id="${report.id}" data-reported-id="${escapeHtml(reported.id)}" data-reported-name="${escapeHtml(reported.username || "")}" data-open-reports="${escapeHtml(reported.openReports || 0)}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${english ? "Resolve + suspend" : "Résoudre + suspendre"}</button>
          <button class="admin-row-button" type="button" data-report-action="dismissed" data-report-id="${report.id}" data-reported-id="${escapeHtml(reported.id)}" data-reported-name="${escapeHtml(reported.username || "")}" data-open-reports="${escapeHtml(reported.openReports || 0)}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("dismiss", "Classer")}</button>`
              : ""
          }
        </div>
      </article>`;
          })
          .join("")
      : empty(tr("noReports", "Aucun signalement ouvert."));
    if (state.players.selected) {
      try {
        await selectPlayer(state.players.selected, { silent: true });
      } catch (_) {
        state.players.selected = null;
        renderPlayerDossierEmpty();
      }
    }
  }

  function renderPlayerDossierEmpty() {
    $("#playerDossier").innerHTML =
      `<p class="admin-empty">${escapeHtml(tr("playerPick", "Sélectionnez un joueur ou un signalement pour ouvrir la fiche de modération."))}</p>`;
  }

  async function selectPlayer(playerId, { silent = false, focusReportId = null } = {}) {
    state.players.selected = playerId;
    if (focusReportId != null) state.players.focusReportId = focusReportId;
    $("#playersList")
      ?.querySelectorAll("[data-player-id]")
      .forEach((node) => {
        node.classList.toggle("is-selected", String(node.dataset.playerId) === String(playerId));
      });
    if (!silent)
      $("#playerDossier").innerHTML = empty(english ? "Loading player dossier…" : "Chargement de la fiche joueur…");
    const data = await adminFetch(`/api/admin/players/${encodeURIComponent(playerId)}`);
    renderPlayerDossier(data);
    if (state.players.focusReportId) {
      const focused = $("#playerDossier")?.querySelector(
        `[data-dossier-report="${CSS.escape(String(state.players.focusReportId))}"]`
      );
      focused?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function closePlayerDossier() {
    state.players.selected = null;
    state.players.focusReportId = null;
    $("#playersList")
      ?.querySelectorAll("[data-player-id]")
      .forEach((node) => node.classList.remove("is-selected"));
    renderPlayerDossierEmpty();
  }

  function renderPlayerDossier(data) {
    const player = data.player || {};
    const moderation = data.moderation || {};
    const social = data.social || {};
    const sessions = data.sessions || {};
    const history = data.history || {};
    const suspended = player.suspendedUntil && new Date(player.suspendedUntil) > new Date();
    const suspensionLabel = suspended
      ? player.suspensionSource === "admin"
        ? english
          ? "Admin suspension"
          : "Suspension admin"
        : english
          ? "Voluntary pause"
          : "Pause volontaire"
      : english
        ? "Active"
        : "Actif";
    const received = moderation.reportsReceived || [];
    const filed = moderation.reportsFiled || [];
    const suspensions = history.suspensions || [];
    const actions = history.adminActions || [];
    const squads = social.squads || [];
    const openReceived = received.filter((item) => item.status === "open").length;

    $("#playerDossier").innerHTML = `
      <div class="admin-dossier__toolbar">
        <p class="admin-eyebrow">${english ? "PLAYER DOSSIER" : "FICHE JOUEUR"}</p>
        <button class="admin-button admin-button--quiet" type="button" data-close-dossier>${english ? "Close" : "Fermer"}</button>
      </div>
      <div class="admin-editor__header">
        <div>
          <h2>${escapeHtml(player.displayName || player.username || "—")}</h2>
          <p class="admin-editor__id">@${escapeHtml(player.username || "—")} · #${escapeHtml(player.id)}</p>
        </div>
        ${stateBadge(suspensionLabel, suspended ? "danger" : moderation.openReports ? "warning" : "good")}
      </div>
      <div class="admin-dossier__meta">
        <div class="admin-dossier__chip"><span>${english ? "Joined" : "Inscription"}</span><strong>${formatDate(player.createdAt, false)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Last active" : "Dernière activité"}</span><strong>${formatDate(player.lastActiveAt)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Collection" : "Collection"}</span><strong>${formatPercent(player.collection?.completionRate)} · ${formatNumber(player.collection?.ownedVariants || 0)}/${formatNumber(player.collection?.releasedVariants || 0)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Open reports" : "Signalements ouverts"}</span><strong>${formatNumber(moderation.openReports || 0)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Friends / sessions" : "Amis / sessions"}</span><strong>${formatNumber(social.friends || 0)} · ${formatNumber(sessions.active || 0)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Blocks" : "Blocages"}</span><strong>${formatNumber(moderation.blockedBy || 0)} ${english ? "against" : "reçus"} · ${formatNumber(moderation.blocking || 0)} ${english ? "issued" : "émis"}</strong></div>
      </div>
      ${suspended ? `<div class="admin-dialog__warning">${english ? "Suspended until" : "Suspendu jusqu’au"} ${formatDate(player.suspendedUntil)}${player.suspensionReason ? ` — ${escapeHtml(player.suspensionReason)}` : ""}</div>` : ""}
      <div class="admin-editor__footer">
        ${can("privacy.export") ? `<button class="admin-button admin-button--quiet" type="button" data-privacy-export="${escapeHtml(player.id)}" data-privacy-label="@${escapeHtml(player.username || player.id)}">${english ? "Export data" : "Exporter les données"}</button>` : ""}
        <button class="admin-button ${suspended ? "" : "admin-button--danger"}" type="button" data-player-action="${suspended ? "unsuspend" : "suspend"}" data-player-id="${player.id}" data-player-name="${escapeHtml(player.username || "")}">${suspended ? tr("unsuspend", "Réactiver") : tr("suspend", "Suspendre")}</button>
      </div>
      <section class="admin-editor__section">
        <h3>${english ? "Reports against this player" : "Signalements reçus"} (${received.length})</h3>
        <div>${
          received.length
            ? received
                .map((report) => {
                  const reporter = report.reporter || {};
                  const focused = String(state.players.focusReportId) === String(report.id);
                  const risky = Number(reporter.reportsFiledLast7d || 0) >= 5;
                  return `<article class="admin-dossier-report${focused ? " is-focused" : ""}" data-dossier-report="${escapeHtml(report.id)}">
            <div class="admin-dossier-report__top">
              <strong>${stateBadge(label(report.status), report.status === "open" ? "warning" : "good")} ${stateBadge(reportPriorityLabel(report.priority || "normal"), reportPriorityTone(report.priority || "normal"))}</strong>
              <time>${formatDate(report.createdAt)}</time>
            </div>
            <p>${escapeHtml(report.reason || "—")}</p>
            <small>${english ? "Reporter" : "Reporteur"}:
              <button class="admin-row-button" type="button" data-open-player="${escapeHtml(reporter.id)}">@${escapeHtml(reporter.username || "—")}</button>
              · ${formatNumber(reporter.totalReportsFiled || 0)} ${english ? "filed" : "déposés"}
              ${reporter.reportsFiledLast7d ? ` · ${formatNumber(reporter.reportsFiledLast7d)} ${english ? "in 7 days" : "sur 7 jours"}` : ""}
              ${reporter.openReportsFiled ? ` · ${formatNumber(reporter.openReportsFiled)} ${english ? "still open" : "encore ouverts"}` : ""}
            </small>
            ${risky ? `<span class="admin-report__risk">${english ? "High reporting volume" : "Volume de signalements élevé"}</span>` : ""}
            ${reportContextMarkup(report.context)}
            ${report.resolution ? `<small>${english ? "Resolution" : "Résolution"}: ${escapeHtml(report.resolution)}</small>` : ""}
            ${report.adminNotes ? `<div class="admin-report__internal"><strong>${english ? "Internal note" : "Note interne"}</strong><span>${escapeHtml(report.adminNotes)}</span></div>` : ""}
            ${report.appeal?.status && report.appeal.status !== "none" ? `<div class="admin-report__appeal"><strong>${english ? "Appeal" : "Recours"} · ${escapeHtml(label(report.appeal.status))}</strong>${report.appeal.message ? `<span>${escapeHtml(report.appeal.message)}</span>` : ""}${report.appeal.resolution ? `<small>${english ? "Decision" : "Décision"}: ${escapeHtml(report.appeal.resolution)}</small>` : ""}</div>` : ""}
            ${
              report.status === "open"
                ? `<div class="admin-report__actions">
              ${
                can("players.moderate")
                  ? `<button class="admin-row-button" type="button" data-report-action="resolved" data-report-id="${report.id}" data-reported-id="${player.id}" data-reported-name="${escapeHtml(player.username || "")}" data-open-reports="${openReceived}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("resolve", "Résoudre")}</button>
              <button class="admin-row-button admin-row-button--danger" type="button" data-report-action="resolved" data-report-suspend="true" data-report-id="${report.id}" data-reported-id="${player.id}" data-reported-name="${escapeHtml(player.username || "")}" data-open-reports="${openReceived}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${english ? "Resolve + suspend" : "Résoudre + suspendre"}</button>
              <button class="admin-row-button" type="button" data-report-action="dismissed" data-report-id="${report.id}" data-reported-id="${player.id}" data-reported-name="${escapeHtml(player.username || "")}" data-open-reports="${openReceived}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("dismiss", "Classer")}</button>`
                  : ""
              }
            </div>`
                : ""
            }
            ${can("players.moderate") && (!report.appeal?.status || report.appeal.status === "none" || report.appeal.status === "received") ? `<div class="admin-report__actions">${!report.appeal?.status || report.appeal.status === "none" ? `<button class="admin-row-button" type="button" data-report-appeal="received" data-report-id="${report.id}">${english ? "Record appeal" : "Enregistrer un recours"}</button>` : ""}${report.appeal?.status === "received" ? `<button class="admin-row-button" type="button" data-report-appeal="accepted" data-report-id="${report.id}">${english ? "Accept appeal" : "Accepter le recours"}</button><button class="admin-row-button admin-row-button--danger" type="button" data-report-appeal="rejected" data-report-id="${report.id}">${english ? "Reject appeal" : "Rejeter le recours"}</button>` : ""}</div>` : ""}
          </article>`;
                })
                .join("")
            : empty(english ? "No report against this account." : "Aucun signalement contre ce compte.")
        }</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Reports filed by this player" : "Signalements déposés"} (${filed.length})</h3>
        <div>${
          filed.length
            ? filed
                .map((report) => {
                  const reported = report.reported || {};
                  return `<article class="admin-dossier-report">
            <div class="admin-dossier-report__top"><strong>${stateBadge(label(report.status), report.status === "open" ? "warning" : "")}</strong><time>${formatDate(report.createdAt)}</time></div>
            <p>${escapeHtml(report.reason || "—")}</p>
            <small>${english ? "Target" : "Cible"}:
              <button class="admin-row-button" type="button" data-open-player="${escapeHtml(reported.id)}" data-focus-report="${escapeHtml(report.id)}">@${escapeHtml(reported.username || "—")}</button>
            </small>
          </article>`;
                })
                .join("")
            : empty(english ? "This player has not filed reports." : "Ce joueur n’a déposé aucun signalement.")
        }</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Suspension history" : "Historique des suspensions"}</h3>
        <div class="admin-status-list">${
          suspensions.length
            ? suspensions
                .map((item) => {
                  const applied = item.action === "player.suspended";
                  return `<div class="admin-status-row"><span><strong>${applied ? (english ? "Suspended" : "Suspension") : english ? "Reactivated" : "Réactivation"}</strong><small>${escapeHtml(item.actor || "—")} · ${escapeHtml(item.justification || "—")}</small></span><strong>${formatDate(item.created_at)}</strong></div>`;
                })
                .join("")
            : empty(english ? "No administrative suspension yet." : "Aucune suspension administrative.")
        }</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Squads" : "Squads"}</h3>
        <div class="admin-status-list">${squads.length ? squads.map((squad) => `<div class="admin-status-row"><span>${escapeHtml(squad.name)} <small>${escapeHtml(squad.code)} · ${escapeHtml(label(squad.role))}</small></span><strong>${escapeHtml(label(squad.status))}</strong></div>`).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Recent admin actions" : "Actions admin récentes"}</h3>
        <div class="admin-status-list">${actions.length ? actions.map((item) => `<div class="admin-status-row"><span><code>${escapeHtml(item.action)}</code><small>${escapeHtml(item.actor || "—")} · ${escapeHtml(item.justification || "—")}</small></span><strong>${formatDate(item.created_at)}</strong></div>`).join("") : empty()}</div>
      </section>`;
  }

  function renderPagination(selector, data, kind) {
    const node = $(selector);
    if (!node) return;
    node.innerHTML = `<span>${english ? "Page" : "Page"} ${data.page} / ${Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button type="button" data-page-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>‹</button><button type="button" data-page-kind="${kind}" data-page="${data.page + 1}" ${data.hasMore ? "" : "disabled"}>›</button>`;
  }

  Object.assign(window, {
    loadPlayers,
    renderPlayerDossierEmpty,
    selectPlayer,
    closePlayerDossier,
    renderPlayerDossier,
    renderPagination
  });
})();
