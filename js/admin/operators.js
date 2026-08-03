(() => {
  "use strict";

  function openAdminOperatorDialog({ operatorId = null, name = "" } = {}) {
    state.adminOperator = { operatorId, name };
    const rotating = !!operatorId;
    $("#adminOperatorTitle").textContent = rotating
      ? english
        ? "Rotate an admin secret"
        : "Tourner un secret administrateur"
      : english
        ? "Create an admin account"
        : "Créer un compte administrateur";
    $("#adminOperatorSummary").textContent = rotating
      ? english
        ? `Every active session for ${name} will be revoked.`
        : `Toutes les sessions actives de ${name} seront révoquées.`
      : english
        ? "Use a unique identifier and a secret known only by this operator."
        : "Utilisez un identifiant unique et un secret connu uniquement de cet administrateur.";
    ["#adminOperatorUsernameField", "#adminOperatorDisplayNameField", "#adminOperatorRoleField"].forEach((selector) => {
      $(selector).hidden = rotating;
    });
    $("#adminOperatorUsername").value = "";
    $("#adminOperatorDisplayName").value = "";
    $("#adminOperatorRole").value = "owner";
    $("#adminOperatorPassword").value = "";
    $("#adminOperatorPasswordConfirm").value = "";
    $("#adminOperatorReason").value = "";
    $("#adminOperatorMfa").value = "";
    $("#adminOperatorPasswordLabel").textContent = rotating
      ? english
        ? "Replacement secret"
        : "Secret de remplacement"
      : english
        ? "Initial secret"
        : "Secret initial";
    $("#adminOperatorSubmit").textContent = rotating
      ? english
        ? "Rotate and revoke sessions"
        : "Tourner et révoquer les sessions"
      : english
        ? "Create account"
        : "Créer le compte";
    $("#adminOperatorError").hidden = true;
    $("#adminOperatorDialog").showModal();
    requestAnimationFrame(() => $(rotating ? "#adminOperatorPassword" : "#adminOperatorUsername").focus());
  }

  function closeAdminOperatorDialog() {
    if ($("#adminOperatorDialog")?.open) $("#adminOperatorDialog").close();
    state.adminOperator = null;
  }

  async function submitAdminOperatorDialog(event) {
    event.preventDefault();
    const operation = state.adminOperator;
    if (!operation) return;
    const errorNode = $("#adminOperatorError");
    const password = $("#adminOperatorPassword").value;
    const reason = $("#adminOperatorReason").value.trim();
    const mfaCode = readStepUpCode("#adminOperatorMfa");
    if (
      password.length < 12 ||
      password !== $("#adminOperatorPasswordConfirm").value ||
      !reason ||
      !assertStepUp(mfaCode, errorNode)
    ) {
      if (!errorNode.textContent)
        errorNode.textContent =
          password !== $("#adminOperatorPasswordConfirm").value
            ? english
              ? "The two secrets do not match."
              : "Les deux secrets ne correspondent pas."
            : english
              ? "A secret of at least 12 characters and a justification are required."
              : "Un secret d’au moins 12 caractères et une justification sont requis.";
      errorNode.hidden = false;
      return;
    }
    const creating = !operation.operatorId;
    const payload = creating
      ? {
          username: $("#adminOperatorUsername").value.trim(),
          displayName: $("#adminOperatorDisplayName").value.trim(),
          role: $("#adminOperatorRole").value,
          password,
          reason,
          totp: mfaCode || undefined
        }
      : { password, reason, totp: mfaCode || undefined };
    const submit = $("#adminOperatorSubmit");
    submit.disabled = true;
    try {
      await adminFetch(
        creating
          ? "/api/admin/operators"
          : `/api/admin/operators/${encodeURIComponent(operation.operatorId)}/rotate-secret`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) },
          body: JSON.stringify(payload)
        }
      );
      closeAdminOperatorDialog();
      setNotice(
        creating
          ? english
            ? "Named admin account created."
            : "Compte administrateur nominatif créé."
          : english
            ? "Secret rotated and sessions revoked."
            : "Secret renouvelé et sessions révoquées."
      );
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  async function toggleAdminOperator(button) {
    const active = button.dataset.operatorActive !== "true";
    const reason = await requestReason(
      active
        ? english
          ? "Why reactivate this account?"
          : "Pourquoi réactiver ce compte ?"
        : english
          ? "Why disable this account?"
          : "Pourquoi désactiver ce compte ?"
    );
    if (!reason) return;
    try {
      await adminFetch(`/api/admin/operators/${encodeURIComponent(button.dataset.operatorToggle)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active, reason })
      });
      setNotice(
        active
          ? english
            ? "Admin account reactivated."
            : "Compte administrateur réactivé."
          : english
            ? "Admin account disabled and sessions revoked."
            : "Compte administrateur désactivé et sessions révoquées."
      );
      await loadTab("privacy", true);
    } catch (error) {
      setAlert(error.message || tr("saveFailed"));
    }
  }

  async function acknowledgeSecurityAlert(button) {
    try {
      await adminFetch(
        `/api/admin/security-alerts/${encodeURIComponent(button.dataset.securityAlertAck)}/acknowledge`,
        { method: "POST" }
      );
      setNotice(english ? "Security alert acknowledged." : "Alerte de sécurité traitée.");
      await loadTab("privacy", true);
    } catch (error) {
      setAlert(error.message || tr("saveFailed"));
    }
  }

  Object.assign(window, {
    openAdminOperatorDialog,
    closeAdminOperatorDialog,
    submitAdminOperatorDialog,
    toggleAdminOperator,
    acknowledgeSecurityAlert
  });
})();
