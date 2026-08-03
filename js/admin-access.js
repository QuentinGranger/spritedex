(() => {
  const francophoneRegions = new Set([
    "BJ",
    "BI",
    "CM",
    "KM",
    "CI",
    "DJ",
    "GA",
    "GN",
    "GQ",
    "MG",
    "CF",
    "CD",
    "CG",
    "RW",
    "SN",
    "SC",
    "TD",
    "TG",
    "DZ",
    "BF",
    "ML",
    "MA",
    "MU",
    "MR",
    "NE",
    "TN",
    "BE",
    "FR",
    "LU",
    "MC",
    "CH",
    "AD",
    "CA",
    "HT",
    "LB",
    "VU"
  ]);
  const forcedLanguage = new URLSearchParams(location.search).get("lang");
  const locales =
    Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"];
  const french =
    forcedLanguage === "fr" ||
    (forcedLanguage !== "en" &&
      locales.some((locale) => {
        const [language, region] = String(locale).replace(/_/g, "-").split("-");
        return language.toLowerCase() === "fr" || francophoneRegions.has(String(region || "").toUpperCase());
      }));
  const english = !french;
  const copy = english
    ? {
        eyebrow: "ADMIN ACCESS",
        title: "Secure verification",
        loading: "Preparing your secure session…",
        note: "This link is single-use and is never kept in your browsing history.",
        missing: "This secure link is missing or has expired. Generate a new one from your terminal.",
        invalid: "This secure link is invalid or has expired. Generate a new one from your terminal.",
        mfaTitle: "Multi-factor authentication",
        mfaLead: "Enter the 6-digit code from your authenticator app to open this admin session.",
        mfaLabel: "Authentication code",
        mfaSubmit: "Open session",
        mfaInvalid: "Invalid or expired MFA code. Try again — the link stays valid until it expires.",
        mfaReplay: "This MFA code was already used. Wait for the next one."
      }
    : {
        eyebrow: "ACCÈS ADMINISTRATEUR",
        title: "Vérification sécurisée",
        loading: "Préparation de votre session sécurisée…",
        note: "Ce lien est à usage unique et n’est jamais enregistré dans votre historique.",
        missing: "Ce lien sécurisé est absent ou expiré. Générez-en un nouveau depuis votre terminal.",
        invalid: "Ce lien sécurisé est invalide ou expiré. Générez-en un nouveau depuis votre terminal.",
        mfaTitle: "Authentification multi-facteurs",
        mfaLead: "Saisissez le code à 6 chiffres de votre application d’authentification.",
        mfaLabel: "Code d’authentification",
        mfaSubmit: "Ouvrir la session",
        mfaInvalid: "Code MFA invalide ou expiré. Réessayez — le lien reste valide jusqu’à expiration.",
        mfaReplay: "Ce code MFA a déjà été utilisé. Attendez le suivant."
      };

  document.documentElement.lang = english ? "en" : "fr";
  document.title = "SPRITE-INDEX — Backoffice";
  document.querySelectorAll("[data-copy]").forEach((node) => {
    node.textContent = copy[node.dataset.copy] || node.textContent;
  });
  const message = document.getElementById("accessMessage");
  const loader = document.getElementById("accessLoader");
  const form = document.getElementById("accessMfaForm");
  const codeInput = document.getElementById("accessMfaCode");
  const errorNode = document.getElementById("accessMfaError");
  const title = document.getElementById("accessTitle");
  const ticket = location.hash.slice(1);
  history.replaceState(null, "", `${location.pathname}${location.search}`);

  function showError(text) {
    if (!errorNode) return;
    errorNode.hidden = !text;
    errorNode.textContent = text || "";
  }

  function consume(totp) {
    showError();
    return fetch("/api/admin/terminal/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ticket, totp: totp || undefined })
    }).then(async (response) => {
      if (response.ok) {
        location.replace(`/admin${location.search}`);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (payload.code === "ADMIN_MFA_INVALID" || payload.code === "ADMIN_MFA_REPLAY" || payload.mfaRequired) {
        throw Object.assign(new Error("mfa"), { payload });
      }
      throw new Error("invalid");
    });
  }

  function showMfaPrompt() {
    if (loader) loader.hidden = true;
    if (title) title.textContent = copy.mfaTitle;
    message.textContent = copy.mfaLead;
    form.hidden = false;
    codeInput.focus();
  }

  if (!/^[a-f0-9]{64}$/i.test(ticket)) {
    if (loader) loader.hidden = true;
    message.textContent = copy.missing;
    return;
  }

  fetch("/api/admin/terminal/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ ticket })
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("invalid");
      const challenge = await response.json();
      if (challenge.mfaRequired) {
        showMfaPrompt();
        return;
      }
      return consume();
    })
    .catch(() => {
      if (loader) loader.hidden = true;
      form.hidden = true;
      message.textContent = copy.invalid;
    });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const totp = String(codeInput.value || "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(totp)) {
      showError(copy.mfaInvalid);
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    consume(totp).catch((error) => {
      submit.disabled = false;
      if (error.message === "mfa") {
        showMfaPrompt();
        showError(error.payload?.code === "ADMIN_MFA_REPLAY" ? copy.mfaReplay : copy.mfaInvalid);
        codeInput.select();
        return;
      }
      if (loader) loader.hidden = true;
      form.hidden = true;
      message.textContent = copy.invalid;
    });
  });
})();
