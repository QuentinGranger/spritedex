(() => {
  "use strict";

  function openPrivacyPurgeDialog({
    userId = null,
    label = "",
    username = "",
    ready = true,
    batch = false,
    volume = 0
  } = {}) {
    state.privacyPurge = {
      userId,
      label,
      username: username || String(label || "").replace(/^@/, ""),
      ready,
      batch,
      volume
    };
    $("#privacyPurgeTitle").textContent = batch
      ? english
        ? "Purge ready accounts"
        : "Purger les comptes prêts"
      : english
        ? "Purge account permanently"
        : "Purger définitivement le compte";
    $("#privacyPurgeSummary").textContent = batch
      ? english
        ? "Every account past the retention window will be deleted permanently."
        : "Tous les comptes hors délai de rétention seront définitivement supprimés."
      : `${label || `#${userId}`}${volume ? ` · ${formatNumber(volume)} ${english ? "collection entries" : "entrées collection"}` : ""}`;
    $("#privacyPurgeImpact").textContent = english
      ? "This cannot be undone. Export the account first if you still need a GDPR archive."
      : "Cette action est irréversible. Exportez d’abord le compte si une archive RGPD est encore nécessaire.";
    $("#privacyPurgeForceField").hidden = batch || ready;
    $("#privacyPurgeForce").checked = false;
    $("#privacyPurgeForceLabel").textContent = english
      ? "Force purge before the retention window ends"
      : "Forcer la purge avant la fin du délai de rétention";
    const confirmField = $("#privacyPurgeConfirmField");
    confirmField.hidden = batch;
    $("#privacyPurgeConfirm").value = "";
    $("#privacyPurgeConfirmLabel").textContent = english
      ? `Type ${state.privacyPurge.username || "username"} to confirm`
      : `Tapez ${state.privacyPurge.username || "le username"} pour confirmer`;
    $("#privacyPurgeReason").value = "";
    if ($("#privacyPurgeMfa")) $("#privacyPurgeMfa").value = "";
    $("#privacyPurgeError").hidden = true;
    applyAuthz();
    $("#privacyPurgeDialog").showModal();
    $("#privacyPurgeReason").focus();
  }

  function closePrivacyPurgeDialog() {
    const dialog = $("#privacyPurgeDialog");
    if (dialog?.open) dialog.close();
    state.privacyPurge = null;
  }

  async function submitPrivacyPurge(event) {
    event.preventDefault();
    const operation = state.privacyPurge;
    if (!operation) return;
    const errorNode = $("#privacyPurgeError");
    const reasonValue = $("#privacyPurgeReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    if (!operation.batch) {
      const expected = String(operation.username || "")
        .trim()
        .toLowerCase();
      const typed = $("#privacyPurgeConfirm").value.trim().toLowerCase();
      if (!expected || typed !== expected) {
        errorNode.textContent = english
          ? "Confirmation username does not match."
          : "Le username de confirmation ne correspond pas.";
        errorNode.hidden = false;
        return;
      }
    }
    const force = !operation.batch && !operation.ready && $("#privacyPurgeForce").checked;
    if (!operation.batch && !operation.ready && !force) {
      errorNode.textContent = english
        ? "This account is still inside the retention window. Enable force purge or wait."
        : "Ce compte est encore dans le délai de rétention. Cochez la purge forcée ou attendez.";
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyPurgeMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyPurgeSubmit");
    submit.disabled = true;
    try {
      const payload = { reason: reasonValue, force, totp: mfaCode || undefined };
      if (operation.userId) payload.userId = Number(operation.userId);
      else payload.limit = 25;
      const result = await adminFetch("/api/admin/privacy/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) },
        body: JSON.stringify(payload)
      });
      closePrivacyPurgeDialog();
      setNotice(
        english
          ? `${formatNumber(result.count || 0)} account(s) purged.`
          : `${formatNumber(result.count || 0)} compte(s) purgé(s).`
      );
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openPrivacyExportDialog({ userId = null, label = "" } = {}) {
    state.privacyExport = { userId, preview: null };
    $("#privacyExportTarget").value = userId ? String(userId) : $("#privacyExportSearch")?.value || "";
    $("#privacyExportReason").value = "";
    if ($("#privacyExportMfa")) $("#privacyExportMfa").value = "";
    $("#privacyExportSummary").textContent = label
      ? english
        ? `Export personal data for ${label}.`
        : `Exporter les données personnelles de ${label}.`
      : english
        ? "Generate an administrative JSON export for a GDPR request or internal review."
        : "Génère un JSON administratif pour une demande RGPD ou un contrôle interne.";
    $("#privacyExportPreview").hidden = true;
    $("#privacyExportPreview").textContent = "";
    $("#privacyExportError").hidden = true;
    applyAuthz();
    $("#privacyExportDialog").showModal();
    (userId ? $("#privacyExportReason") : $("#privacyExportTarget")).focus();
    if (userId) previewPrivacyExportTarget().catch(() => {});
  }

  function closePrivacyExportDialog() {
    const dialog = $("#privacyExportDialog");
    if (dialog?.open) dialog.close();
    state.privacyExport = null;
  }

  async function resolvePrivacyExportUserId(raw) {
    const value = String(raw || "")
      .trim()
      .replace(/^#/, "");
    if (!value) throw new Error(english ? "Account is required." : "Le compte est requis.");
    const data = await adminFetch(`/api/admin/privacy/lookup?q=${encodeURIComponent(value)}`);
    const items = data.items || [];
    if (!items.length) throw new Error(english ? "No account found." : "Aucun compte trouvé.");
    if (items.length === 1 || /^\d+$/.test(value)) return items[0];
    const exact = items.find((item) => String(item.username || "").toLowerCase() === value.toLowerCase());
    if (exact) return exact;
    throw new Error(
      english
        ? "Multiple accounts match. Use the numeric id."
        : "Plusieurs comptes correspondent. Utilisez l’identifiant numérique."
    );
  }

  async function previewPrivacyExportTarget() {
    const preview = $("#privacyExportPreview");
    const account = await resolvePrivacyExportUserId($("#privacyExportTarget").value);
    state.privacyExport = { ...(state.privacyExport || {}), userId: account.id, preview: account };
    preview.hidden = false;
    preview.textContent = english
      ? `@${account.username} · #${account.id}${account.deletedAt ? " · deleted" : ""} · ${formatNumber(account.collectionEntries)} entries · ${formatNumber(account.activeSquads)} squad(s)`
      : `@${account.username} · #${account.id}${account.deletedAt ? " · supprimé" : ""} · ${formatNumber(account.collectionEntries)} entrées · ${formatNumber(account.activeSquads)} squad(s)`;
    return account;
  }

  async function submitPrivacyExport(event) {
    event.preventDefault();
    const errorNode = $("#privacyExportError");
    const reasonValue = $("#privacyExportReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyExportMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyExportSubmit");
    submit.disabled = true;
    try {
      const account = state.privacyExport?.preview?.id
        ? state.privacyExport.preview
        : await previewPrivacyExportTarget();
      const params = new URLSearchParams({ reason: reasonValue });
      const payload = await adminFetch(`/api/admin/privacy/export/${encodeURIComponent(account.id)}?${params}`, {
        headers: { ...stepUpHeaders(mfaCode) }
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sprite-index_admin_export_${account.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      closePrivacyExportDialog();
      setNotice(
        english ? `Export downloaded for @${account.username}.` : `Export téléchargé pour @${account.username}.`
      );
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openPrivacyRestoreDialog(button) {
    state.privacyRestore = { id: button.dataset.privacyRestore, label: button.dataset.privacyLabel || "" };
    $("#privacyRestoreSummary").textContent = state.privacyRestore.label;
    $("#privacyRestoreReason").value = "";
    if ($("#privacyRestoreMfa")) $("#privacyRestoreMfa").value = "";
    $("#privacyRestoreError").hidden = true;
    applyAuthz();
    $("#privacyRestoreDialog").showModal();
    $("#privacyRestoreReason").focus();
  }

  function closePrivacyRestoreDialog() {
    const dialog = $("#privacyRestoreDialog");
    if (dialog?.open) dialog.close();
    state.privacyRestore = null;
  }

  async function submitPrivacyRestore(event) {
    event.preventDefault();
    const operation = state.privacyRestore;
    if (!operation) return;
    const errorNode = $("#privacyRestoreError");
    const reasonValue = $("#privacyRestoreReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyRestoreMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyRestoreSubmit");
    submit.disabled = true;
    try {
      const result = await adminFetch("/api/admin/privacy/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) },
        body: JSON.stringify({ userId: Number(operation.id), reason: reasonValue, totp: mfaCode || undefined })
      });
      closePrivacyRestoreDialog();
      setNotice(
        english
          ? `Account @${result.user?.username || operation.label} restored.`
          : `Compte @${result.user?.username || operation.label} restauré.`
      );
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openPrivacyRevokeLinksDialog() {
    $("#privacyRevokeLinksReason").value = "";
    if ($("#privacyRevokeLinksMfa")) $("#privacyRevokeLinksMfa").value = "";
    $("#privacyRevokeLinksError").hidden = true;
    applyAuthz();
    $("#privacyRevokeLinksDialog").showModal();
    $("#privacyRevokeLinksReason").focus();
  }

  function closePrivacyRevokeLinksDialog() {
    const dialog = $("#privacyRevokeLinksDialog");
    if (dialog?.open) dialog.close();
  }

  async function submitPrivacyRevokeLinks(event) {
    event.preventDefault();
    const errorNode = $("#privacyRevokeLinksError");
    const reasonValue = $("#privacyRevokeLinksReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyRevokeLinksMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyRevokeLinksSubmit");
    submit.disabled = true;
    try {
      const result = await adminFetch("/api/admin/privacy/revoke-share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) },
        body: JSON.stringify({ reason: reasonValue, totp: mfaCode || undefined })
      });
      closePrivacyRevokeLinksDialog();
      const revoked = result.revoked || {};
      setNotice(
        english
          ? `Revoked ${formatNumber(revoked.passportLinks)} passport, ${formatNumber(revoked.compareLinks)} compare, ${formatNumber(revoked.friendInviteLinks)} invite link(s).`
          : `Révoqué ${formatNumber(revoked.passportLinks)} passeport(s), ${formatNumber(revoked.compareLinks)} comparaison(s), ${formatNumber(revoked.friendInviteLinks)} invitation(s).`
      );
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  Object.assign(window, {
    openPrivacyPurgeDialog,
    closePrivacyPurgeDialog,
    submitPrivacyPurge,
    openPrivacyExportDialog,
    closePrivacyExportDialog,
    resolvePrivacyExportUserId,
    previewPrivacyExportTarget,
    submitPrivacyExport,
    openPrivacyRestoreDialog,
    closePrivacyRestoreDialog,
    submitPrivacyRestore,
    openPrivacyRevokeLinksDialog,
    closePrivacyRevokeLinksDialog,
    submitPrivacyRevokeLinks
  });
})();
