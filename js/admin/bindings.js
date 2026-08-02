(() => {
  "use strict";

  document.addEventListener("click", (event) => {
    if (event.target.closest("#adminUniversalSearch")) { openUniversalSearch(); return; }
    const universalFilter = event.target.closest("[data-universal-filter]");
    if (universalFilter) { state.universalSearch.activeGroup = universalFilter.dataset.universalFilter; state.universalSearch.activeIndex = 0; renderUniversalSearch(); return; }
    const universalResult = event.target.closest("[data-universal-result]"); if (universalResult) { openUniversalResult(universalResult); return; }
    const tab = event.target.closest("[data-admin-tab]"); if (tab) { setTab(tab.dataset.adminTab); return; }
    const go = event.target.closest("[data-go-tab]"); if (go) { setTab(go.dataset.goTab); return; }
    const openPlayer = event.target.closest("[data-open-player]");
    if (openPlayer) {
      const open = () => selectPlayer(openPlayer.dataset.openPlayer, {
        focusReportId: openPlayer.dataset.focusReport || null
      }).catch((error) => setAlert(error.message || tr("loadFailed")));
      if (state.tab !== "players") setTab("players");
      open();
      return;
    }
    if (event.target.closest("[data-close-dossier]")) {
      closePlayerDossier();
      return;
    }
    const playerRow = event.target.closest("tr[data-player-id]");
    if (playerRow && !event.target.closest("button")) {
      state.players.focusReportId = null;
      selectPlayer(playerRow.dataset.playerId).catch((error) => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const player = event.target.closest("[data-player-action]"); if (player) { handlePlayerAction(player); return; }
    const report = event.target.closest("[data-report-action]"); if (report) { handleReportAction(report); return; }
    const reportAppeal = event.target.closest("[data-report-appeal]"); if (reportAppeal) { handleReportAppeal(reportAppeal); return; }
    const reportPriority = event.target.closest("[data-report-priority-filter]");
    if (reportPriority) {
      state.players.reportPriority = state.players.reportPriority === reportPriority.dataset.reportPriorityFilter ? "all" : reportPriority.dataset.reportPriorityFilter;
      loadTab("players", true);
      return;
    }
    const catalog = event.target.closest("[data-catalog-id]"); if (catalog) { selectCatalog(catalog.dataset.catalogId); return; }
    if (event.target.closest("#eventsBulkSelectPage")) { toggleBulkPage("events", event.target.checked); return; }
    if (event.target.closest("[data-notification-select-page]")) {
      const allSelected = state.notifications.visibleItems.length && state.notifications.visibleItems.every((job) => state.notifications.bulkIds.has(String(job.id)));
      state.notifications.visibleItems.forEach((job) => { if (allSelected) state.notifications.bulkIds.delete(String(job.id)); else state.notifications.bulkIds.add(String(job.id)); });
      loadTab("notifications", true); return;
    }
    if (event.target.closest("[data-notification-bulk-apply]")) { openBulkAction("notifications"); return; }
    const notificationToggle = event.target.closest("[data-bulk-notification-toggle]"); if (notificationToggle) { notificationToggle.checked ? state.notifications.bulkIds.add(notificationToggle.dataset.bulkNotificationToggle) : state.notifications.bulkIds.delete(notificationToggle.dataset.bulkNotificationToggle); loadTab("notifications", true); return; }
    if (event.target.closest("[data-collection-select-page]")) {
      const allSelected = state.collections.visibleItems.length && state.collections.visibleItems.every((entry) => state.collections.bulkIds.has(String(entry.id)));
      state.collections.visibleItems.forEach((entry) => { if (allSelected) state.collections.bulkIds.delete(String(entry.id)); else state.collections.bulkIds.add(String(entry.id)); });
      loadTab("collections", true); return;
    }
    if (event.target.closest("[data-collection-bulk-apply]")) { openBulkAction("collections"); return; }
    const collectionToggle = event.target.closest("[data-bulk-collection-toggle]"); if (collectionToggle) { collectionToggle.checked ? state.collections.bulkIds.add(collectionToggle.dataset.bulkCollectionToggle) : state.collections.bulkIds.delete(collectionToggle.dataset.bulkCollectionToggle); loadTab("collections", true); return; }
    const catalogToggle = event.target.closest("[data-bulk-catalog-toggle]"); if (catalogToggle) { catalogToggle.checked ? state.catalog.bulkIds.add(catalogToggle.dataset.bulkCatalogToggle) : state.catalog.bulkIds.delete(catalogToggle.dataset.bulkCatalogToggle); renderBulkBar("catalog"); return; }
    const eventToggle = event.target.closest("[data-bulk-event-toggle]"); if (eventToggle) { eventToggle.checked ? state.events.bulkIds.add(eventToggle.dataset.bulkEventToggle) : state.events.bulkIds.delete(eventToggle.dataset.bulkEventToggle); renderBulkBar("events"); return; }
    if (event.target.closest("#catalogBulkApply")) { openBulkAction("catalog"); return; }
    if (event.target.closest("#eventsBulkApply")) { openBulkAction("events"); return; }
    if (event.target.closest("[data-catalog-show-issues]")) { $("#catalogState").value = "data_issues"; state.catalog.page = 1; loadTab("catalog", true); return; }
    if (event.target.closest("#catalogBulkClear")) { state.catalog.bulkIds.clear(); loadTab("catalog", true); return; }
    if (event.target.closest("#eventsBulkClear")) { state.events.bulkIds.clear(); loadTab("events", true); return; }
    const workflow = event.target.closest("[data-catalog-workflow]"); if (workflow) { setCatalogWorkflow(workflow); return; }
    const variantWorkflow = event.target.closest("[data-variant-workflow]"); if (variantWorkflow) { setVariantWorkflow(variantWorkflow); return; }
    const rollback = event.target.closest("[data-catalog-rollback]"); if (rollback) { rollbackCatalogHistory(rollback); return; }
    const variant = event.target.closest("[data-edit-variant]"); if (variant) { openVariantEditor(variant); return; }
    const availability = event.target.closest("#addAvailability"); if (availability) { openAvailabilityEditor(availability); return; }
    const eventEdit = event.target.closest("[data-edit-event]"); if (eventEdit) { editEvent(eventEdit); return; }
    const newsEdit = event.target.closest("[data-edit-news]"); if (newsEdit) { editNews(newsEdit); return; }
    const news = event.target.closest("[data-news-action]"); if (news) { updateNewsStatus(news); return; }
    const openSquad = event.target.closest("[data-open-squad]");
    if (openSquad) {
      selectSquad(openSquad.dataset.openSquad).catch((error) => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const squadRow = event.target.closest("tr[data-squad-id]");
    if (squadRow && !event.target.closest("button")) {
      selectSquad(squadRow.dataset.squadId).catch((error) => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const cancelInvite = event.target.closest("[data-cancel-invite]");
    if (cancelInvite) { openSquadInviteCancelDialog(cancelInvite); return; }
    if (event.target.closest("[data-close-squad]")) { state.social.selected = null; renderSquadDossierEmpty(); $("#squadsList")?.querySelectorAll("tr[data-squad-id]").forEach(node => node.classList.remove("is-selected")); return; }
    const squad = event.target.closest("[data-squad-toggle]"); if (squad) { openSquadAccessDialog(squad); return; }
    const retry = event.target.closest("[data-retry-job]"); if (retry) { retryNotification(retry); return; }
    const scope = event.target.closest("[data-passport-scope]"); if (scope) { queuePassports(scope.dataset.passportScope); return; }
    const page = event.target.closest("[data-page-kind]"); if (page && !page.disabled) { state[page.dataset.pageKind].page = Number(page.dataset.page); loadTab(page.dataset.pageKind, true); return; }
    const privacyExport = event.target.closest("[data-privacy-export]");
    if (privacyExport) {
      openPrivacyExportDialog({ userId: privacyExport.dataset.privacyExport, label: privacyExport.dataset.privacyLabel || "" });
      return;
    }
    const privacyPurge = event.target.closest("[data-privacy-purge]");
    if (privacyPurge) {
      openPrivacyPurgeDialog({
        userId: privacyPurge.dataset.privacyPurge,
        label: privacyPurge.dataset.privacyLabel || "",
        username: privacyPurge.dataset.privacyUsername || "",
        ready: privacyPurge.dataset.privacyReady === "true",
        volume: Number(privacyPurge.dataset.privacyVolume) || 0
      });
      return;
    }
    const privacyRestore = event.target.closest("[data-privacy-restore]");
    if (privacyRestore) { openPrivacyRestoreDialog(privacyRestore); return; }
    if (event.target.closest("#privacyExportButton")) {
      openPrivacyExportDialog({ label: $("#privacyExportSearch")?.value || "" });
      return;
    }
    if (event.target.closest("#privacyPurgeReadyButton")) {
      openPrivacyPurgeDialog({ batch: true, ready: true });
      return;
    }
    if (event.target.closest("#privacyRevokeLinksButton")) {
      openPrivacyRevokeLinksDialog();
      return;
    }
    if (event.target.closest("#createAdminOperator")) { openAdminOperatorDialog(); return; }
    const operatorRotate = event.target.closest("[data-operator-rotate]"); if (operatorRotate) { openAdminOperatorDialog({ operatorId: operatorRotate.dataset.operatorRotate, name: operatorRotate.dataset.operatorName || "" }); return; }
    const operatorToggle = event.target.closest("[data-operator-toggle]"); if (operatorToggle) { toggleAdminOperator(operatorToggle); return; }
    const securityAlert = event.target.closest("[data-security-alert-ack]"); if (securityAlert) { acknowledgeSecurityAlert(securityAlert); return; }
    if (event.target.closest("#retryFailedNotifications")) { retryFailedNotifications(); return; }
    const auditDetail = event.target.closest("[data-audit-detail]");
    if (auditDetail) { openAuditDetail(auditDetail.dataset.auditDetail); return; }
    const auditRange = event.target.closest("[data-audit-range]");
    if (auditRange) { setAuditRange(auditRange.dataset.auditRange); return; }
    const auditPage = event.target.closest("[data-audit-page]");
    if (auditPage) {
      state.audit.page += auditPage.dataset.auditPage === "next" ? 1 : -1;
      state.audit.page = Math.max(1, state.audit.page);
      loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
      return;
    }
    if (event.target.closest("#auditExportButton")) { exportAudit(); return; }
    if (event.target.closest("#auditResetButton")) {
      state.audit = { ...state.audit, page: 1, q: "", action: "", targetType: "", from: "", to: "", range: "all" };
      ["#auditSearch", "#auditFrom", "#auditTo"].forEach(id => { if ($(id)) $(id).value = ""; });
      ["#auditActionFilter", "#auditTargetFilter"].forEach(id => { if ($(id)) $(id).value = ""; });
      loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const revoke = event.target.closest("[data-revoke-session]"); if (revoke) { request(`/api/admin/sessions/${encodeURIComponent(revoke.dataset.revokeSession)}`, { method: "DELETE" }, { refresh: "privacy" }); return; }
    if (event.target.closest("#createEvent")) { createEvent(); return; } if (event.target.closest("#createNews")) { createNews(); return; } if (event.target.closest("#repairSpriteReferences")) { openBulkAction("collections"); return; } if (event.target.closest("#processNotifications")) { processNotifications(); return; } if (event.target.closest("#adminExport")) { exportAggregates(); return; }
  });
  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("admin-sprite-image")) return;
    const holder = image.parentElement;
    if (!holder) return;
    holder.classList.add("is-image-missing");
    holder.textContent = "✦";
  }, true);
  document.addEventListener("change", event => {
    const metric = event.target.closest("[data-metric-flag]");
    if (metric) { setMetricFlag(metric); return; }
    if (event.target.id === "newsStatusFilter") {
      state.events.newsStatus = event.target.value;
      loadTab("events", true);
      return;
    }
    if (event.target.id === "auditActionFilter" || event.target.id === "auditTargetFilter" || event.target.id === "auditFrom" || event.target.id === "auditTo") {
      state.audit.action = $("#auditActionFilter")?.value || "";
      state.audit.targetType = $("#auditTargetFilter")?.value || "";
      state.audit.from = $("#auditFrom")?.value || "";
      state.audit.to = $("#auditTo")?.value || "";
      state.audit.range = "custom";
      state.audit.page = 1;
      loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
      return;
    }
    if (event.target.closest("#newsEditorForm")) syncNewsEditorChrome();
  });
  document.addEventListener("input", event => {
    if (event.target.id === "adminSearchInput") {
      clearTimeout(state.universalSearch.timer);
      state.universalSearch.timer = setTimeout(() => searchUniversally(event.target.value), 180);
      return;
    }
    if (event.target.id === "auditSearch") {
      state.audit.q = event.target.value || "";
      state.audit.page = 1;
      clearTimeout(state.audit.searchTimer);
      state.audit.searchTimer = setTimeout(() => loadAudit().catch(error => setAlert(error.message || tr("loadFailed"))), 220);
      return;
    }
    if (event.target.closest("#newsEditorForm")) refreshNewsPreview();
  });
  document.addEventListener("submit", event => {
    if (event.target.id === "catalogEditForm") { event.preventDefault(); saveCatalogForm(event.target); }
    if (event.target.id === "playerSuspensionForm") submitPlayerSuspension(event);
    if (event.target.id === "reportDecisionForm") submitReportDecision(event);
    if (event.target.id === "eventEditorForm") submitEventEditor(event);
    if (event.target.id === "newsEditorForm") submitNewsEditor(event);
    if (event.target.id === "variantEditorForm") submitVariantEditor(event);
    if (event.target.id === "availabilityEditorForm") submitAvailabilityEditor(event);
    if (event.target.id === "squadAccessForm") submitSquadAccess(event);
    if (event.target.id === "squadInviteCancelForm") submitSquadInviteCancel(event);
    if (event.target.id === "privacyPurgeForm") submitPrivacyPurge(event);
    if (event.target.id === "adminOperatorForm") submitAdminOperatorDialog(event);
    if (event.target.id === "bulkActionForm") submitBulkAction(event);
    if (event.target.id === "privacyExportForm") submitPrivacyExport(event);
    if (event.target.id === "privacyRestoreForm") submitPrivacyRestore(event);
    if (event.target.id === "privacyRevokeLinksForm") submitPrivacyRevokeLinks(event);
  });
  $("#adminRefresh").addEventListener("click", () => loadTab(state.tab, true));
  $("#adminSearchClose")?.addEventListener("click", closeUniversalSearch);
  $("#adminSearchDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeUniversalSearch(); });
  $("#adminSearchInput")?.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); moveUniversalSelection(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveUniversalSelection(-1); }
    else if (event.key === "Enter") {
      const active = document.querySelector(`.admin-search-result[data-universal-index="${state.universalSearch.activeIndex}"]`);
      if (active) { event.preventDefault(); openUniversalResult(active); }
    }
  });
  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openUniversalSearch(); }
  });
  $("#playerSearchButton").addEventListener("click", () => { state.players.page = 1; loadTab("players", true); });
  $("#reportPriorityFilter").addEventListener("change", event => { state.players.reportPriority = event.target.value; loadTab("players", true); });
  $("#privacyExportSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") openPrivacyExportDialog({ label: event.target.value || "" });
  });
  $("#privacyDeletionFilter")?.addEventListener("change", () => loadTab("privacy", true));
  $("#privacyExportLookup")?.addEventListener("click", async () => {
    try {
      $("#privacyExportError").hidden = true;
      await previewPrivacyExportTarget();
    } catch (error) {
      $("#privacyExportError").textContent = error.message || tr("loadFailed");
      $("#privacyExportError").hidden = false;
    }
  });
  [
    ["#privacyPurgeClose", closePrivacyPurgeDialog],
    ["#privacyPurgeCancel", closePrivacyPurgeDialog],
    ["#privacyExportClose", closePrivacyExportDialog],
    ["#privacyExportCancel", closePrivacyExportDialog],
    ["#privacyRestoreClose", closePrivacyRestoreDialog],
    ["#privacyRestoreCancel", closePrivacyRestoreDialog],
    ["#privacyRevokeLinksClose", closePrivacyRevokeLinksDialog],
    ["#privacyRevokeLinksCancel", closePrivacyRevokeLinksDialog]
  ].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#privacyPurgeDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyPurgeDialog(); });
  [["#adminOperatorClose", closeAdminOperatorDialog], ["#adminOperatorCancel", closeAdminOperatorDialog]].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#adminOperatorDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeAdminOperatorDialog(); });
  [["#bulkActionClose", closeBulkAction], ["#bulkActionCancel", closeBulkAction]].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#bulkActionDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeBulkAction(); });
  $("#privacyExportDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyExportDialog(); });
  $("#privacyRestoreDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyRestoreDialog(); });
  $("#privacyRevokeLinksDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyRevokeLinksDialog(); });
  $("#adminReasonClose")?.addEventListener("click", () => closeReasonDialog(null));
  $("#adminReasonCancel")?.addEventListener("click", () => closeReasonDialog(null));
  $("#adminReasonDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeReasonDialog(null); });
  $("#adminReasonForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const input = $("#adminReasonInput");
    const error = $("#adminReasonError");
    const value = String(input?.value || "").trim();
    if (!value) {
      error.textContent = tr("reasonRequired");
      error.hidden = false;
      input?.focus();
      return;
    }
    closeReasonDialog(value);
  });
  [["#auditDetailClose", closeAuditDetail], ["#auditDetailDone", closeAuditDetail]].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#auditDetailDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeAuditDetail(); });
  $("#squadSearchButton")?.addEventListener("click", () => { state.social.page = 1; loadTab("social", true); });
  $("#squadSearch")?.addEventListener("keydown", event => { if (event.key === "Enter") { state.social.page = 1; loadTab("social", true); } });
  $("#squadJoinFilter")?.addEventListener("change", () => { state.social.page = 1; loadTab("social", true); });
  [
    ["#squadAccessClose", closeSquadAccessDialog],
    ["#squadAccessCancel", closeSquadAccessDialog],
    ["#squadInviteCancelClose", closeSquadInviteCancelDialog],
    ["#squadInviteCancelCancel", closeSquadInviteCancelDialog]
  ].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#squadAccessDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeSquadAccessDialog(); });
  $("#squadInviteCancelDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeSquadInviteCancelDialog(); });
  $("#catalogSearchButton").addEventListener("click", () => { state.catalog.page = 1; state.catalog.selected = null; $("#catalogEditor").innerHTML = empty(tr("catalogPick", "Sélectionnez un sprite.")); loadTab("catalog", true); });
  $("#playerSearch").addEventListener("keydown", event => { if (event.key === "Enter") { state.players.page = 1; loadTab("players", true); } });
  $("#catalogSearch").addEventListener("keydown", event => { if (event.key === "Enter") { state.catalog.page = 1; loadTab("catalog", true); } });
  $("#playerSuspensionClose").addEventListener("click", closePlayerSuspensionDialog);
  $("#playerSuspensionCancel").addEventListener("click", closePlayerSuspensionDialog);
  $("#playerSuspensionDialog").addEventListener("cancel", event => { event.preventDefault(); closePlayerSuspensionDialog(); });
  $("#playerSuspensionDuration").addEventListener("change", event => {
    const custom = event.target.value === "custom";
    $("#playerSuspensionCustomField").hidden = !custom;
    if (custom && !$("#playerSuspensionUntil").value) {
      const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      $("#playerSuspensionUntil").value = date.toISOString().slice(0, 16);
    }
  });
  $("#reportDecisionClose").addEventListener("click", closeReportDecisionDialog);
  $("#reportDecisionCancel").addEventListener("click", closeReportDecisionDialog);
  $("#reportDecisionDialog").addEventListener("cancel", event => { event.preventDefault(); closeReportDecisionDialog(); });
  $("#reportDecisionDuration").addEventListener("change", event => {
    const custom = event.target.value === "custom";
    $("#reportDecisionCustomField").hidden = !custom;
    if (custom && !$("#reportDecisionUntil").value) {
      const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      $("#reportDecisionUntil").value = date.toISOString().slice(0, 16);
    }
  });
  [
    ["#eventEditorClose", "#eventEditorCancel", "#eventEditorDialog"],
    ["#newsEditorClose", "#newsEditorCancel", "#newsEditorDialog"],
    ["#variantEditorClose", "#variantEditorCancel", "#variantEditorDialog"],
    ["#availabilityEditorClose", "#availabilityEditorCancel", "#availabilityEditorDialog"]
  ].forEach(([closeId, cancelId, dialogId]) => {
    $(closeId)?.addEventListener("click", () => closeEditorialDialog(dialogId));
    $(cancelId)?.addEventListener("click", () => closeEditorialDialog(dialogId));
    $(dialogId)?.addEventListener("cancel", (event) => { event.preventDefault(); closeEditorialDialog(dialogId); });
  });
  $("#adminLogout").addEventListener("click", async () => { try { await adminFetch("/api/admin/logout", { method: "POST" }); } catch (_) {} location.replace(`/admin/access${location.search}`); });
  $("#revokeOtherSessions")?.addEventListener("click", async () => {
    const result = await request("/api/admin/sessions/revoke-others", { method: "POST" }, { refresh: "privacy" });
    if (result) setNotice(english ? `${formatNumber(result.revoked)} other session(s) revoked.` : `${formatNumber(result.revoked)} autre(s) session(s) révoquée(s).`);
  });

  applyStaticCopy();
  bootstrapSession().then(() => {
    const tab = state.session?.tabs?.[state.tab] === true ? state.tab : firstAllowedTab();
    setTab(tab);
  });
  setInterval(() => {
    renderSessionBadge();
    if (document.visibilityState === "visible") {
      bootstrapSession().then(() => loadTab(state.tab, true));
    }
  }, 30_000);
  setInterval(renderSessionBadge, 15_000);
})();
