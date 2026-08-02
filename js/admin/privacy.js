(() => {
  "use strict";

  async function loadPrivacy() {
    const deletionStatus = $("#privacyDeletionFilter")?.value || state.privacy?.deletionStatus || "all";
    state.privacy = { ...(state.privacy || {}), deletionStatus };
    if ($("#privacyDeletionFilter")) $("#privacyDeletionFilter").value = deletionStatus;
    const params = new URLSearchParams({ deletionStatus });
    const [data, accessSecurity] = await Promise.all([
      adminFetch(`/api/admin/privacy?${params}`),
      can("admins.manage") ? adminFetch("/api/admin/operators") : Promise.resolve({ operators: [], alerts: [] })
    ]);
    const p = data.privacy || {};
    const s = data.sharing || {};
    const deletions = data.deletions || { items: [], retentionDays: 30, summary: {} };
    const summary = deletions.summary || {};
    $("#privacyKpis").innerHTML = [
      kpi(english ? "Deletion queue" : "File de suppression", formatNumber(p.deletion_requests), `${formatNumber(summary.ready ?? p.ready_for_purge)} ${english ? "ready" : "prêtes"} · ${formatNumber(summary.pending || 0)} ${english ? "in retention" : "en rétention"}`, Number(p.ready_for_purge) ? "warning" : ""),
      kpi(english ? "Retention" : "Rétention", `${formatNumber(p.retentionDays || deletions.retentionDays || 30)} ${english ? "days" : "j"}`, english ? "before permanent purge" : "avant purge définitive"),
      kpi(english ? "Active share links" : "Liens actifs", formatNumber((Number(s.passport_links) || 0) + (Number(s.compare_links) || 0) + (Number(s.friend_invite_links) || 0)), `${formatNumber(s.passport_links)} / ${formatNumber(s.compare_links)} / ${formatNumber(s.friend_invite_links)}`, ((Number(s.passport_links) || 0) + (Number(s.compare_links) || 0) + (Number(s.friend_invite_links) || 0)) ? "" : "good"),
      kpi(english ? "Admin sessions" : "Sessions admin", formatNumber((data.sessions || []).length), `${data.roles?.role || "—"} · ${data.roles?.actor || "—"}`)
    ].join("");
    $("#privacyDeletionMeta").textContent = english
      ? `${formatNumber(summary.total || 0)} total · ${formatNumber((deletions.items || []).length)} shown`
      : `${formatNumber(summary.total || 0)} au total · ${formatNumber((deletions.items || []).length)} affichée(s)`;
    const purgeReadyBtn = $("#privacyPurgeReadyButton");
    if (purgeReadyBtn) purgeReadyBtn.disabled = !(Number(summary.ready ?? p.ready_for_purge) > 0);
    $("#privacyDeletionQueue").innerHTML = (deletions.items || []).length
      ? deletions.items.map((item) => {
        const ready = item.readyForPurge;
        return `<tr>
          <td><strong>@${escapeHtml(item.username || "—")}</strong><small>#${escapeHtml(item.id)} · ${escapeHtml(item.email || "—")}</small></td>
          <td>${formatDate(item.deletedAt)}</td>
          <td><strong>${formatNumber(item.collectionEntries)}</strong><small>${formatNumber(item.activeSquads)} ${english ? "squad(s)" : "squad(s)"}</small></td>
          <td>${ready
            ? status(english ? "Ready" : "Prêt", "warning")
            : status(english ? `${formatNumber(item.daysUntilPurge)}d left` : `${formatNumber(item.daysUntilPurge)} j restants`, "")}</td>
          <td><div class="admin-row-actions">
            ${can("privacy.export") ? `<button class="admin-row-button" type="button" data-privacy-export="${escapeHtml(item.id)}" data-privacy-label="@${escapeHtml(item.username || item.id)}">${english ? "Export" : "Exporter"}</button>` : ""}
            ${can("privacy.restore") ? `<button class="admin-row-button" type="button" data-privacy-restore="${escapeHtml(item.id)}" data-privacy-label="@${escapeHtml(item.username || item.id)}">${english ? "Restore" : "Restaurer"}</button>` : ""}
            ${can("privacy.purge") ? `<button class="admin-row-button ${ready ? "admin-row-button--danger" : ""}" type="button" data-privacy-purge="${escapeHtml(item.id)}" data-privacy-label="@${escapeHtml(item.username || item.id)}" data-privacy-username="${escapeHtml(item.username || "")}" data-privacy-ready="${ready ? "true" : "false"}" data-privacy-volume="${escapeHtml(item.collectionEntries || 0)}">${english ? "Purge" : "Purger"}</button>` : ""}
          </div></td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="5">${empty(english ? "No deletion requests in this filter." : "Aucune demande de suppression pour ce filtre.")}</td></tr>`;
    $("#privacyConsent").innerHTML = (data.consentVersions || []).map(item => `<div class="admin-status-row"><span>${escapeHtml(item.version)}</span><strong>${formatNumber(item.count)}</strong></div>`).join("") || empty();
    $("#privacySharing").innerHTML = [[english ? "Passport links" : "Liens passeport", s.passport_links], [english ? "Comparison links" : "Liens de comparaison", s.compare_links], [english ? "Friend invitation links" : "Liens d’invitation", s.friend_invite_links]].map(([name, value]) => `<div class="admin-status-row"><span>${escapeHtml(name)}</span><strong>${formatNumber(value)}</strong></div>`).join("");
    $("#privacySessions").innerHTML = (data.sessions || []).length
      ? data.sessions.map((item) => {
        const current = item.current || item.publicId === data.roles?.actor?.split(":")[1];
        const meta = [
          item.lastIp || item.createdIp || "—",
          formatDate(item.lastSeenAt || item.createdAt)
        ].join(" · ");
        return `<div class="admin-status-row admin-status-row--session"><div><strong>${escapeHtml(item.actor)}</strong><small>${escapeHtml(meta)}</small></div>${current ? `<em>${escapeHtml(tr("thisSession", "Cette session"))}</em>` : `<button class="admin-button admin-button--quiet" type="button" data-revoke-session="${escapeHtml(item.publicId)}">${escapeHtml(tr("revokeSession", "Révoquer"))}</button>`}</div>`;
      }).join("")
      : empty();
    const operatorsNode = $("#adminOperators");
    const postureNode = $("#adminAccessPosture");
    if (postureNode) {
      const namedCount = (accessSecurity.operators || []).filter((item) => item.active).length;
      const legacy = state.session?.authMode === "legacy_global";
      postureNode.innerHTML = `<div class="admin-access-posture__state ${legacy ? "is-warning" : "is-good"}"><span class="admin-access-posture__icon" aria-hidden="true">${legacy ? "!" : "✓"}</span><div><strong>${legacy ? (english ? "Transition still in progress" : "Transition encore en cours") : (english ? "Named access in use" : "Accès nominatif en service")}</strong><small>${legacy ? (english ? "Create and test a named account before removing the global secret." : "Créez et testez un compte nominatif avant de retirer le secret global.") : (english ? "Each admin session is attributable to a named operator." : "Chaque session admin est attribuable à un opérateur identifié.")}</small></div></div><div class="admin-access-posture__metrics"><span><b>${formatNumber(namedCount)}</b>${english ? " active account(s)" : " compte(s) actif(s)"}</span><span class="${state.session?.mfaConfigured ? "is-good" : "is-warning"}">${state.session?.mfaConfigured ? (english ? "MFA enabled" : "MFA actif") : (english ? "MFA to configure" : "MFA à configurer")}</span></div>`;
    }
    if (operatorsNode) {
      operatorsNode.innerHTML = (accessSecurity.operators || []).length ? accessSecurity.operators.map((item) => {
        const current = item.id === state.session?.operatorId;
        const initials = String(item.displayName || item.username || "A").trim().slice(0, 2).toUpperCase();
        const lastLogin = item.lastLoginAt ? `${english ? "Last sign-in" : "Dernière connexion"} ${formatDate(item.lastLoginAt)}` : (english ? "Never signed in" : "Jamais connecté");
        return `<div class="admin-operator-card ${item.active ? "" : "is-disabled"}"><div class="admin-operator-card__identity"><span class="admin-operator-card__avatar" aria-hidden="true">${escapeHtml(initials)}</span><div><strong>${escapeHtml(item.displayName)}</strong><small>@${escapeHtml(item.username)} · ${escapeHtml(item.role)}</small></div></div><div class="admin-operator-card__meta"><span>${current ? (english ? "Current session" : "Session actuelle") : (item.active ? (english ? "Active" : "Actif") : (english ? "Disabled" : "Désactivé"))}</span><small>${lastLogin}</small><small>${english ? "Secret rotated" : "Secret renouvelé"} ${formatDate(item.secretRotatedAt, false)}</small></div><div class="admin-operator-card__actions"><button class="admin-row-button" type="button" data-operator-rotate="${escapeHtml(item.id)}" data-operator-name="${escapeHtml(item.displayName)}">${english ? "Rotate secret" : "Tourner le secret"}</button><button class="admin-row-button ${item.active ? "admin-row-button--danger" : ""}" type="button" data-operator-toggle="${escapeHtml(item.id)}" data-operator-active="${item.active ? "true" : "false"}" data-operator-name="${escapeHtml(item.displayName)}" ${current && item.active ? "disabled title=\"Close this session first\"" : ""}>${item.active ? (english ? "Disable" : "Désactiver") : (english ? "Enable" : "Réactiver")}</button></div></div>`;
      }).join("") : empty(english ? "No named administrator yet. Create one before retiring the global secret." : "Aucun administrateur nominatif. Créez-en un avant de retirer le secret global.");
    }
    const alertsNode = $("#adminSecurityAlerts");
    if (alertsNode) {
      alertsNode.innerHTML = (accessSecurity.alerts || []).length ? accessSecurity.alerts.map((alert) => `<div class="admin-status-row admin-status-row--alert"><div><strong>${escapeHtml(alert.kind === "unusual_login" ? (english ? "Unusual connection" : "Connexion inhabituelle") : label(alert.kind))} <small>${escapeHtml(alert.username ? `@${alert.username}` : "—")}</small></strong><small>${formatDate(alert.created_at)}${alert.details?.ip ? ` · ${escapeHtml(alert.details.ip)}` : ""}${alert.acknowledged_at ? ` · ${english ? "reviewed" : "traitée"}` : ""}</small></div>${alert.acknowledged_at ? status(english ? "Reviewed" : "Traitée", "good") : `<button class="admin-row-button" type="button" data-security-alert-ack="${escapeHtml(alert.id)}">${english ? "Acknowledge" : "Traiter"}</button>`}</div>`).join("") : empty(english ? "No unusual connection alert." : "Aucune alerte de connexion inhabituelle.");
    }
    const auditPanel = $(".admin-audit-panel");
    if (auditPanel) auditPanel.hidden = !can("audit.read");
    if (can("audit.read")) await loadAudit();
  }

  Object.assign(window, { loadPrivacy });
})();
