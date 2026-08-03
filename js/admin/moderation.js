(() => {
  "use strict";

  function renderSuspensionHistory(items) {
    const node = $("#playerSuspensionHistory");
    node.innerHTML = items.length
      ? `<div class="admin-dialog__history-list">${items
          .map((item) => {
            const suspended = item.action === "player.suspended";
            return `<article class="admin-dialog__history-item"><strong>${suspended ? (english ? "Suspended" : "Suspension appliquée") : english ? "Reactivated" : "Compte réactivé"}</strong><time>${formatDate(item.created_at)}</time><p>${escapeHtml(item.justification || "—")}</p></article>`;
          })
          .join("")}</div>`
      : empty(english ? "No previous administrative decision." : "Aucune décision administrative antérieure.");
  }

  async function handlePlayerAction(button) {
    const action = button.dataset.playerAction;
    const player = button.dataset.playerName;
    state.suspension = { id: button.dataset.playerId, action, player };
    const suspending = action === "suspend";
    $("#playerSuspensionTitle").textContent = suspending
      ? english
        ? "Suspend account"
        : "Suspendre le compte"
      : english
        ? "Reactivate account"
        : "Réactiver le compte";
    $("#playerSuspensionSummary").textContent = suspending
      ? english
        ? `Define the duration and document the decision for @${player}.`
        : `Définissez la durée et documentez la décision concernant @${player}.`
      : english
        ? `End the administrative suspension for @${player}.`
        : `Levez la suspension administrative de @${player}.`;
    $("#playerSuspensionImpact").textContent = suspending
      ? english
        ? "Active sessions will be revoked immediately and new logins blocked until the suspension ends."
        : "Les sessions actives seront immédiatement révoquées et toute nouvelle connexion sera bloquée jusqu’à la fin de la suspension."
      : english
        ? "The player will be able to sign in and use protected features again immediately."
        : "Le joueur pourra immédiatement se reconnecter et utiliser les fonctionnalités protégées.";
    $("#playerSuspensionDurationField").hidden = !suspending;
    $("#playerSuspensionCustomField").hidden = true;
    $("#playerSuspensionDuration").value = "24";
    $("#playerSuspensionUntil").value = "";
    $("#playerSuspensionReason").value = "";
    $("#playerSuspensionReasonLabel").textContent = suspending
      ? english
        ? "Mandatory suspension reason"
        : "Motif obligatoire de la suspension"
      : english
        ? "Mandatory reactivation reason"
        : "Motif obligatoire de la réactivation";
    $("#playerSuspensionSubmit").textContent = suspending
      ? english
        ? "Confirm suspension"
        : "Confirmer la suspension"
      : english
        ? "Reactivate account"
        : "Réactiver le compte";
    $("#playerSuspensionSubmit").classList.toggle("admin-button--danger", suspending);
    $("#playerSuspensionError").hidden = true;
    $("#playerSuspensionHistory").innerHTML = empty(english ? "Loading history…" : "Chargement de l’historique…");
    const dialog = $("#playerSuspensionDialog");
    dialog.showModal();
    $("#playerSuspensionReason").focus();
    try {
      const data = await adminFetch(`/api/admin/players/${encodeURIComponent(state.suspension.id)}/suspension-history`);
      if (state.suspension?.id === button.dataset.playerId) renderSuspensionHistory(data.history || []);
    } catch (error) {
      $("#playerSuspensionHistory").innerHTML = empty(error.message || tr("loadFailed"));
    }
  }

  function closePlayerSuspensionDialog() {
    const dialog = $("#playerSuspensionDialog");
    if (dialog.open) dialog.close();
    state.suspension = null;
  }

  async function submitPlayerSuspension(event) {
    event.preventDefault();
    if (!state.suspension) return;
    const operation = { ...state.suspension };
    const reasonValue = $("#playerSuspensionReason").value.trim();
    const errorNode = $("#playerSuspensionError");
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      $("#playerSuspensionReason").focus();
      return;
    }
    const suspended = operation.action === "suspend";
    let until = null;
    if (suspended) {
      const duration = $("#playerSuspensionDuration").value;
      if (duration === "custom") {
        const custom = new Date($("#playerSuspensionUntil").value);
        if (Number.isNaN(custom.getTime()) || custom <= new Date()) {
          errorNode.textContent = english ? "Choose a future end date." : "Choisissez une date de fin future.";
          errorNode.hidden = false;
          $("#playerSuspensionUntil").focus();
          return;
        }
        until = custom.toISOString();
      } else {
        until = new Date(Date.now() + Number(duration) * 60 * 60 * 1000).toISOString();
      }
    }
    const submit = $("#playerSuspensionSubmit");
    submit.disabled = true;
    errorNode.hidden = true;
    try {
      const result = await adminFetch(`/api/admin/players/${encodeURIComponent(operation.id)}/suspension`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended, until, reason: reasonValue })
      });
      const player = operation.player;
      if (state.suspension?.id === operation.id) closePlayerSuspensionDialog();
      setAlert();
      setNotice(
        suspended
          ? english
            ? `@${player} suspended. ${formatNumber(result.revokedSessions)} session(s) revoked.`
            : `@${player} suspendu. ${formatNumber(result.revokedSessions)} session(s) révoquée(s).`
          : english
            ? `@${player} reactivated.`
            : `@${player} réactivé.`
      );
      await loadTab("players", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  async function handleReportAction(button) {
    const action = button.dataset.reportAction;
    const suspend = button.dataset.reportSuspend === "true";
    const openReports = Math.max(1, Number(button.dataset.openReports) || 1);
    state.reportDecision = {
      id: button.dataset.reportId,
      action,
      suspend,
      reportedId: button.dataset.reportedId,
      reportedName: button.dataset.reportedName || "player",
      openReports
    };
    $("#reportDecisionPriority").value = button.dataset.reportPriority || "normal";
    $("#reportDecisionInternalNote").value = button.dataset.reportAdminNotes || "";
    const dismissing = action === "dismissed";
    $("#reportDecisionTitle").textContent = suspend
      ? english
        ? "Resolve and suspend"
        : "Résoudre et suspendre"
      : dismissing
        ? english
          ? "Dismiss report"
          : "Classer le signalement"
        : english
          ? "Resolve report"
          : "Résoudre le signalement";
    $("#reportDecisionSummary").textContent = suspend
      ? english
        ? `Close the report on @${state.reportDecision.reportedName} and apply an administrative suspension.`
        : `Clôturez le signalement sur @${state.reportDecision.reportedName} et appliquez une suspension administrative.`
      : english
        ? `Record the moderation decision for @${state.reportDecision.reportedName}.`
        : `Documentez la décision de modération pour @${state.reportDecision.reportedName}.`;
    $("#reportDecisionImpact").hidden = !suspend;
    $("#reportDecisionImpact").textContent = english
      ? "Active sessions will be revoked immediately. Related open reports can be closed in the same decision."
      : "Les sessions actives seront immédiatement révoquées. Les autres signalements ouverts peuvent être clôturés dans la même décision.";
    $("#reportDecisionDurationField").hidden = !suspend;
    $("#reportDecisionCustomField").hidden = true;
    $("#reportDecisionDuration").value = "24";
    $("#reportDecisionUntil").value = "";
    $("#reportDecisionRelatedField").hidden = openReports <= 1;
    $("#reportDecisionCloseRelated").checked = openReports > 1;
    $("#reportDecisionCloseRelatedLabel").textContent = english
      ? `Also close the other ${Math.max(0, openReports - 1)} open report(s) on this account`
      : `Classer aussi les ${Math.max(0, openReports - 1)} autre(s) signalement(s) ouvert(s) sur ce compte`;
    $("#reportDecisionReason").value = "";
    $("#reportDecisionReasonLabel").textContent = suspend
      ? english
        ? "Resolution / suspension reason"
        : "Motif de résolution / suspension"
      : english
        ? "Decision note"
        : "Note de décision";
    $("#reportDecisionSubmit").textContent = suspend
      ? english
        ? "Confirm resolve + suspend"
        : "Confirmer résoudre + suspendre"
      : dismissing
        ? english
          ? "Confirm dismissal"
          : "Confirmer le classement"
        : english
          ? "Confirm resolution"
          : "Confirmer la résolution";
    $("#reportDecisionSubmit").classList.toggle("admin-button--danger", suspend || dismissing);
    $("#reportDecisionError").hidden = true;
    $("#reportDecisionDialog").showModal();
    $("#reportDecisionReason").focus();
  }

  function closeReportDecisionDialog() {
    const dialog = $("#reportDecisionDialog");
    if (dialog?.open) dialog.close();
    state.reportDecision = null;
  }

  async function submitReportDecision(event) {
    event.preventDefault();
    if (!state.reportDecision) return;
    const operation = { ...state.reportDecision };
    const resolution = $("#reportDecisionReason").value.trim();
    const errorNode = $("#reportDecisionError");
    if (!resolution) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      $("#reportDecisionReason").focus();
      return;
    }
    const payload = {
      status: operation.action,
      resolution,
      priority: $("#reportDecisionPriority").value,
      adminNotes: $("#reportDecisionInternalNote").value.trim(),
      closeRelatedOpenReports: !$("#reportDecisionRelatedField").hidden && $("#reportDecisionCloseRelated").checked
    };
    if (operation.suspend) {
      payload.suspend = true;
      const duration = $("#reportDecisionDuration").value;
      if (duration === "custom") {
        const custom = new Date($("#reportDecisionUntil").value);
        if (Number.isNaN(custom.getTime()) || custom <= new Date()) {
          errorNode.textContent = english ? "Choose a future end date." : "Choisissez une date de fin future.";
          errorNode.hidden = false;
          $("#reportDecisionUntil").focus();
          return;
        }
        payload.until = custom.toISOString();
      } else {
        payload.until = new Date(Date.now() + Number(duration) * 60 * 60 * 1000).toISOString();
      }
    }
    const submit = $("#reportDecisionSubmit");
    submit.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/reports/${encodeURIComponent(operation.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      closeReportDecisionDialog();
      const closed = Number(result?.closedRelatedReports || 0);
      if (operation.suspend) {
        setNotice(
          english
            ? `Report resolved and @${operation.reportedName} suspended.${closed ? ` ${formatNumber(closed)} related report(s) closed.` : ""}`
            : `Signalement résolu et @${operation.reportedName} suspendu.${closed ? ` ${formatNumber(closed)} signalement(s) lié(s) classé(s).` : ""}`
        );
      } else if (closed) {
        setNotice(
          english
            ? `Decision recorded. ${formatNumber(closed)} related report(s) closed.`
            : `Décision enregistrée. ${formatNumber(closed)} signalement(s) lié(s) classé(s).`
        );
      } else {
        setNotice(english ? "Decision recorded." : "Décision enregistrée.");
      }
      await loadTab("players", true);
      if (state.players.selected || operation.reportedId) {
        await selectPlayer(state.players.selected || operation.reportedId, { silent: true });
      }
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  async function handleReportAppeal(button) {
    const appealStatus = button.dataset.reportAppeal;
    const prompt =
      appealStatus === "received"
        ? english
          ? "Appeal details"
          : "Détails du recours"
        : english
          ? "Decision reason"
          : "Motif de la décision";
    const reason = await requestReason(prompt);
    if (!reason) return;
    try {
      await adminFetch(`/api/admin/reports/${encodeURIComponent(button.dataset.reportId)}/appeal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appealStatus,
          appealMessage: appealStatus === "received" ? reason.trim() : undefined,
          resolution: appealStatus === "received" ? undefined : reason.trim(),
          reason: reason.trim()
        })
      });
      setNotice(english ? "Appeal history updated." : "Historique de recours mis à jour.");
      await loadTab("players", true);
      if (state.players.selected) await selectPlayer(state.players.selected, { silent: true });
    } catch (error) {
      setAlert(error.message || tr("saveFailed"));
    }
  }
  Object.assign(window, {
    renderSuspensionHistory,
    handlePlayerAction,
    closePlayerSuspensionDialog,
    submitPlayerSuspension,
    handleReportAction,
    closeReportDecisionDialog,
    submitReportDecision,
    handleReportAppeal
  });
})();
