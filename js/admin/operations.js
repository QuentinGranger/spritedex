(() => {
  "use strict";

  async function repairReferences() { const why = await requestReason(english ? "Why run the safe sprite-reference repair?" : "Pourquoi exécuter la correction sûre des références Sprite ?"); if (!why) return; await request("/api/admin/collections/integrity/repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "backfill-sprite-references", reason: why }) }, { refresh: "collections" }); }
  function openSquadAccessDialog(button) {
    state.squadAccess = {
      id: button.dataset.squadToggle,
      open: button.dataset.squadOpen !== "true",
      name: button.dataset.squadName || button.dataset.squadToggle
    };
    const opening = state.squadAccess.open;
    $("#squadAccessTitle").textContent = opening
      ? (english ? "Reopen public joining" : "Rouvrir l’accès public")
      : (english ? "Close public joining" : "Fermer l’accès public");
    $("#squadAccessSummary").textContent = `${state.squadAccess.name}`;
    $("#squadAccessImpact").textContent = opening
      ? (english ? "Anyone with the code will be able to join this squad again." : "Toute personne disposant du code pourra rejoindre cette squad.")
      : (english ? "New joins via code will be blocked until the access is reopened." : "Les nouvelles inscriptions via code seront bloquées jusqu’à réouverture.");
    $("#squadAccessReason").value = "";
    $("#squadAccessError").hidden = true;
    $("#squadAccessSubmit").textContent = opening
      ? (english ? "Confirm reopen" : "Confirmer la réouverture")
      : (english ? "Confirm close" : "Confirmer la fermeture");
    $("#squadAccessDialog").showModal();
    $("#squadAccessReason").focus();
  }

  function closeSquadAccessDialog() {
    const dialog = $("#squadAccessDialog");
    if (dialog?.open) dialog.close();
    state.squadAccess = null;
  }

  async function submitSquadAccess(event) {
    event.preventDefault();
    const operation = state.squadAccess;
    if (!operation) return;
    const errorNode = $("#squadAccessError");
    const reasonValue = $("#squadAccessReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#squadAccessSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/social/squads/${encodeURIComponent(operation.id)}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinOpen: operation.open, reason: reasonValue })
      });
      closeSquadAccessDialog();
      setNotice(operation.open
        ? (english ? "Public joining reopened." : "Accès public rouvert.")
        : (english ? "Public joining closed." : "Accès public fermé."));
      await loadTab("social", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openSquadInviteCancelDialog(button) {
    state.squadInviteCancel = {
      id: button.dataset.cancelInvite,
      label: button.dataset.inviteLabel || button.dataset.cancelInvite
    };
    $("#squadInviteCancelSummary").textContent = state.squadInviteCancel.label;
    $("#squadInviteCancelReason").value = "";
    $("#squadInviteCancelError").hidden = true;
    $("#squadInviteCancelDialog").showModal();
    $("#squadInviteCancelReason").focus();
  }

  function closeSquadInviteCancelDialog() {
    const dialog = $("#squadInviteCancelDialog");
    if (dialog?.open) dialog.close();
    state.squadInviteCancel = null;
  }

  async function submitSquadInviteCancel(event) {
    event.preventDefault();
    const operation = state.squadInviteCancel;
    if (!operation) return;
    const errorNode = $("#squadInviteCancelError");
    const reasonValue = $("#squadInviteCancelReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#squadInviteCancelSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/social/invitations/${encodeURIComponent(operation.id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reasonValue })
      });
      closeSquadInviteCancelDialog();
      setNotice(english ? "Invitation cancelled." : "Invitation annulée.");
      await loadTab("social", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }


  async function retryNotification(button) { const why = await requestReason(english ? "Why retry this delivery?" : "Pourquoi relancer cette livraison ?"); if (!why) return; await request(`/api/admin/notifications/queue/${button.dataset.retryJob}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) }, { refresh: "notifications" }); }
  async function processNotifications() { const why = await requestReason(english ? "Why process the queue now?" : "Pourquoi traiter la file maintenant ?"); if (!why) return; await request("/api/admin/notifications/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) }, { refresh: "notifications" }); }
  async function queuePassports(scope) { const why = await requestReason(scope === "all" ? (english ? "Why queue all passports?" : "Pourquoi planifier tous les passeports ?") : (english ? "Why queue stale passports?" : "Pourquoi planifier les passeports obsolètes ?")); if (!why) return; await request("/api/admin/passports/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, reason: why }) }, { refresh: "passports" }); }
  async function setMetricFlag(input) {
    const disabled = input.checked;
    const key = input.dataset.metricFlag;
    const why = await requestReason(disabled
      ? (english ? `Why suspend ${key}?` : `Pourquoi suspendre ${key} ?`)
      : (english ? `Why restore ${key}?` : `Pourquoi rétablir ${key} ?`));
    if (!why) { input.checked = !disabled; return; }
    try {
      await adminFetch("/api/admin/sprite-graph/flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metricKey: key, disabled, reason: why })
      });
      await loadTab("intelligence", true);
    } catch (error) {
      input.checked = !disabled;
      setAlert(error.message || tr("saveFailed"));
    }
  }
  async function exportAggregates() { try { const payload = await adminFetch("/api/admin/sprite-graph/export/aggregates?limit=2000"); const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = english ? "sprite-index-aggregates.json" : "sprite-index-agregats.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); } catch (error) { setAlert(error.message || tr("saveFailed")); } }

  Object.assign(window, { repairReferences, openSquadAccessDialog, closeSquadAccessDialog, submitSquadAccess, openSquadInviteCancelDialog, closeSquadInviteCancelDialog, submitSquadInviteCancel, retryNotification, processNotifications, queuePassports, setMetricFlag, exportAggregates });
})();
