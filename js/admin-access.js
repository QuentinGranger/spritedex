(() => {
  const francophoneRegions = new Set(["BJ", "BI", "CM", "KM", "CI", "DJ", "GA", "GN", "GQ", "MG", "CF", "CD", "CG", "RW", "SN", "SC", "TD", "TG", "DZ", "BF", "ML", "MA", "MU", "MR", "NE", "TN", "BE", "FR", "LU", "MC", "CH", "AD", "CA", "HT", "LB", "VU"]);
  const forcedLanguage = new URLSearchParams(location.search).get("lang");
  const locales = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  const french = forcedLanguage === "fr" || (forcedLanguage !== "en" && locales.some((locale) => {
    const [language, region] = String(locale).replace(/_/g, "-").split("-");
    return language.toLowerCase() === "fr" || francophoneRegions.has(String(region || "").toUpperCase());
  }));
  const english = !french;
  const copy = english ? {
    eyebrow: "ADMIN ACCESS", title: "Secure verification", loading: "Preparing your secure session…",
    note: "This link is single-use and is never kept in your browsing history.",
    missing: "This secure link is missing or has expired. Generate a new one from your terminal.",
    invalid: "This secure link is invalid or has expired. Generate a new one from your terminal."
  } : {
    eyebrow: "ACCÈS ADMINISTRATEUR", title: "Vérification sécurisée", loading: "Préparation de votre session sécurisée…",
    note: "Ce lien est à usage unique et n’est jamais enregistré dans votre historique.",
    missing: "Ce lien sécurisé est absent ou expiré. Générez-en un nouveau depuis votre terminal.",
    invalid: "Ce lien sécurisé est invalide ou expiré. Générez-en un nouveau depuis votre terminal."
  };

  document.documentElement.lang = english ? "en" : "fr";
  document.title = "SPRITE-INDEX — Backoffice";
  document.querySelectorAll("[data-copy]").forEach((node) => { node.textContent = copy[node.dataset.copy] || node.textContent; });
  const message = document.getElementById("accessMessage");
  const ticket = location.hash.slice(1);
  history.replaceState(null, "", `${location.pathname}${location.search}`);

  if (!/^[a-f0-9]{64}$/i.test(ticket)) {
    message.textContent = copy.missing;
    return;
  }

  fetch("/api/admin/terminal/consume", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ ticket })
  }).then((response) => {
    if (!response.ok) throw new Error("invalid");
    location.replace(`/admin${location.search}`);
  }).catch(() => {
    message.textContent = copy.invalid;
  });
})();
