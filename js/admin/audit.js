(() => {
  "use strict";

  function friendlyAuditAction(action) {
    const labels = {
      "privacy.export_generated": english ? "Data export" : "Export de données",
      "privacy.accounts_purged": english ? "Accounts purged" : "Comptes purgés",
      "privacy.account_purged": english ? "Account purged" : "Compte purgé",
      "privacy.account_force_purged": english ? "Account force-purged" : "Compte purgé (forcé)",
      "privacy.account_restored": english ? "Account restored" : "Compte restauré",
      "privacy.share_links_revoked": english ? "Share links revoked" : "Liens de partage révoqués",
      "graph.metric_suspended": english ? "Metric suspended" : "Métrique suspendue",
      "graph.metric_restored": english ? "Metric restored" : "Métrique rétablie",
      "notification.queue_process_requested": english ? "Queue processing requested" : "Traitement de file demandé",
      "notification.queue_processed": english ? "Queue processed" : "File traitée",
      "catalog.updated": english ? "Catalog updated" : "Catalogue modifié",
      "event.updated": english ? "Event updated" : "Événement modifié",
      "news.updated": english ? "News updated" : "Actualité modifiée",
      "player.suspended": english ? "Player suspended" : "Joueur suspendu",
      "player.unsuspended": english ? "Player reactivated" : "Joueur réactivé"
    };
    return labels[action] || String(action || "—").replace(/[._]/g, " ");
  }

  function auditValue(value) {
    if (value == null || value === "") return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function auditQuery() {
    const audit = state.audit;
    const params = new URLSearchParams({ page: String(audit.page), pageSize: String(audit.pageSize) });
    [["q", audit.q], ["action", audit.action], ["targetType", audit.targetType], ["from", audit.from], ["to", audit.to]].forEach(([key, value]) => { if (value) params.set(key, value); });
    return params;
  }

  function auditChangeSummary(item) {
    const changes = item?.details?.changes;
    const fields = changes && typeof changes === "object" ? Object.keys(changes) : (Array.isArray(item?.details?.fields) ? item.details.fields : []);
    return fields.length ? fields.slice(0, 2).join(", ") + (fields.length > 2 ? ` +${fields.length - 2}` : "") : "—";
  }

  function renderAuditRange() {
    $$('[data-audit-range]').forEach((button) => button.classList.toggle("is-active", button.dataset.auditRange === state.audit.range));
  }

  function isoDateOffset(days) {
    const value = new Date();
    value.setDate(value.getDate() + days);
    return value.toISOString().slice(0, 10);
  }

  function setAuditRange(range) {
    const today = isoDateOffset(0);
    const starts = { today, "7d": isoDateOffset(-6), "30d": isoDateOffset(-29) };
    state.audit.range = range;
    state.audit.from = starts[range] || "";
    state.audit.to = starts[range] ? today : "";
    state.audit.page = 1;
    if ($("#auditFrom")) $("#auditFrom").value = state.audit.from;
    if ($("#auditTo")) $("#auditTo").value = state.audit.to;
    renderAuditRange();
    loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
  }

  function renderAuditFacets(facets = {}) {
    const select = $("#auditActionFilter"), target = $("#auditTargetFilter");
    if (select) {
      const value = state.audit.action;
      select.innerHTML = `<option value="">${english ? "All actions" : "Toutes les actions"}</option>${(facets.actions || []).map((item) => `<option value="${escapeHtml(item.action)}">${escapeHtml(friendlyAuditAction(item.action))} · ${formatNumber(item.count)}</option>`).join("")}`;
      select.value = value;
    }
    if (target) {
      const value = state.audit.targetType;
      target.innerHTML = `<option value="">${english ? "All targets" : "Toutes les cibles"}</option>${(facets.targetTypes || []).map((item) => `<option value="${escapeHtml(item.target_type)}">${escapeHtml(label(item.target_type))} · ${formatNumber(item.count)}</option>`).join("")}`;
      target.value = value;
    }
  }

  async function loadAudit() {
    const data = await adminFetch(`/api/admin/audit?${auditQuery()}`);
    state.audit.data = data;
    renderAuditFacets(data.facets);
    const total = Number(data.total) || 0;
    const shown = (data.items || []).length;
    const changes = (data.items || []).filter((item) => auditChangeSummary(item) !== "—").length;
    const actions = new Set((data.items || []).map((item) => item.action)).size;
    $("#auditMeta").textContent = english
      ? `${formatNumber(total)} recorded action(s) · ${formatNumber(shown)} displayed`
      : `${formatNumber(total)} action(s) enregistrée(s) · ${formatNumber(shown)} affichée(s)`;
    $("#auditPulse").textContent = english
      ? `${formatNumber(changes)} change(s) visible · ${formatNumber(actions)} action type(s)`
      : `${formatNumber(changes)} modification(s) visible(s) · ${formatNumber(actions)} type(s) d’action`;
    renderAuditRange();
    $("#auditList").innerHTML = shown
      ? data.items.map((item) => {
        const change = auditChangeSummary(item);
        return `<tr><td><code>${escapeHtml(item.actor || "—")}</code></td><td><strong>${escapeHtml(friendlyAuditAction(item.action))}</strong><small>${escapeHtml(item.action || "")}</small></td><td><strong>${escapeHtml(label(item.target_type))}</strong><small>${escapeHtml(item.target_id || "—")}</small></td><td>${escapeHtml(item.justification || "—")}</td><td><span class="admin-audit-change ${change === "—" ? "admin-audit-change--none" : ""}">${escapeHtml(change)}</span></td><td>${formatDate(item.created_at)}</td><td><button class="admin-audit-detail-button" type="button" data-audit-detail="${escapeHtml(item.id)}">${english ? "Inspect" : "Détail"}</button></td></tr>`;
      }).join("")
      : `<tr><td colspan="7">${empty(english ? "No audit action matches these filters." : "Aucune action ne correspond à ces filtres.")}</td></tr>`;
    const previousDisabled = Number(data.page) <= 1;
    const nextDisabled = !data.hasMore;
    $("#auditPagination").innerHTML = `<span>${english ? `Page ${formatNumber(data.page)} of ${formatNumber(Math.max(1, Math.ceil(total / Math.max(1, data.pageSize))))}` : `Page ${formatNumber(data.page)} sur ${formatNumber(Math.max(1, Math.ceil(total / Math.max(1, data.pageSize))))}`}</span><button class="admin-button admin-button--quiet" type="button" data-audit-page="previous" ${previousDisabled ? "disabled" : ""}>${english ? "Previous" : "Précédent"}</button><button class="admin-button admin-button--quiet" type="button" data-audit-page="next" ${nextDisabled ? "disabled" : ""}>${english ? "Next" : "Suivant"}</button>`;
  }

  function openAuditDetail(id) {
    const item = (state.audit.data?.items || []).find((entry) => String(entry.id) === String(id));
    if (!item) return;
    const details = item.details && typeof item.details === "object" ? item.details : {};
    const changes = details.changes && typeof details.changes === "object" ? details.changes : null;
    const metadata = [[english ? "Actor" : "Acteur", item.actor], [english ? "Action" : "Action", friendlyAuditAction(item.action)], [english ? "Target" : "Cible", `${label(item.target_type)} · ${item.target_id || "—"}`], [english ? "Reason" : "Justification", item.justification], [english ? "Date" : "Date", formatDate(item.created_at)]];
    const metadataBlock = `<section class="admin-audit-detail__block"><h3>${english ? "Trace" : "Trace"}</h3><dl>${metadata.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(auditValue(value))}</dd>`).join("")}</dl></section>`;
    const changesBlock = changes && Object.keys(changes).length ? `<section class="admin-audit-detail__block"><h3>${english ? "Before / after" : "Avant / après"}</h3><div class="admin-audit-diff"><div class="admin-audit-diff__header">${english ? "Field" : "Champ"}</div><div class="admin-audit-diff__header admin-audit-diff__header--before">${english ? "Before" : "Avant"}</div><div class="admin-audit-diff__header admin-audit-diff__header--after">${english ? "After" : "Après"}</div>${Object.entries(changes).map(([field, change]) => `<div class="admin-audit-diff__field">${escapeHtml(field)}</div><div class="admin-audit-diff__before">${escapeHtml(auditValue(change?.before))}</div><div class="admin-audit-diff__after">${escapeHtml(auditValue(change?.after))}</div>`).join("")}</div></section>` : "";
    const operational = Object.fromEntries(Object.entries(details).filter(([key]) => key !== "changes"));
    const operationalBlock = Object.keys(operational).length ? `<section class="admin-audit-detail__block"><h3>${english ? "Operational details" : "Détails opérationnels"}</h3><dl>${Object.entries(operational).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(auditValue(value))}</dd>`).join("")}</dl></section>` : "";
    $("#auditDetailTitle").textContent = friendlyAuditAction(item.action);
    $("#auditDetailMeta").textContent = `${item.actor || "—"} · ${formatDate(item.created_at)}`;
    $("#auditDetailBody").innerHTML = metadataBlock + changesBlock + operationalBlock;
    $("#auditDetailDialog")?.showModal();
  }

  function closeAuditDetail() { $("#auditDetailDialog")?.close(); }

  async function exportAudit() {
    try {
      const response = await fetch(`/api/admin/audit/export?${auditQuery()}`, { credentials: "same-origin", headers: { Accept: "text/csv" } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || tr("saveFailed"));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "sprite-index-audit.csv"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(english ? "Audit export downloaded." : "Export du journal téléchargé.");
    } catch (error) { setAlert(error.message || tr("saveFailed")); }
  }

  Object.assign(window, { friendlyAuditAction, auditValue, auditQuery, auditChangeSummary, renderAuditRange, isoDateOffset, setAuditRange, renderAuditFacets, loadAudit, openAuditDetail, closeAuditDetail, exportAudit });
})();
