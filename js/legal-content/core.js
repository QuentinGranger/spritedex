"use strict";

(function initialiseLegalCore(global) {
  const LEGAL_VERSION = "2026.07.18-1";
  const LEGAL_LAST_UPDATED_ISO = "2026-07-18";
  const LEGAL_LAST_UPDATED_FR = "18 juillet 2026";
  const LEGAL_LAST_UPDATED_EN = "18 July 2026";
  const LEGAL_LAST_UPDATED_NL = "18 juli 2026";

  const LEGAL_CONFIG = Object.freeze({
    APP_NAME: "SPRITE-INDEX",
    EDITOR_NAME: "Quentin SAVIGNY",
    EDITOR_STATUS: "éditeur individuel non professionnel",
    CONTACT_EMAIL: "contact@sprite-index.com",
    SUPPORT_EMAIL: "contact@sprite-index.com",
    PRIVACY_EMAIL: "contact@sprite-index.com",
    REPORT_EMAIL: "contact@sprite-index.com",

    HOST_NAME: "Render Services, Inc.",
    HOST_ADDRESS: "525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis",
    HOST_PHONE: "+1 415 881 5869",
    HOST_WEBSITE: "https://render.com",
    HOST_SUPPORT: "https://render.com/support",
    HOST_LEGAL_EMAIL: "legal@render.com",

    CNIL_URL: "https://www.cnil.fr",
    EPIC_FAN_POLICY_URL: "https://legal.epicgames.com/epicgames/fan-art-policy?lang=fr",

    ACCOUNT_MINIMUM_AGE: "15",
    ACCOUNT_DELETION_DELAY: "30 jours maximum",
    SECURITY_LOG_RETENTION: "12 mois maximum",
    CONSENT_CHOICE_RETENTION: "6 mois",
    OPTIONAL_TRACKER_RETENTION: "13 mois maximum"
  });

  const LEGAL_CONFIG_EN = Object.freeze({
    ...LEGAL_CONFIG,
    EDITOR_STATUS: "individual non-professional publisher",
    HOST_ADDRESS: "525 Brannan Street, Suite 300, San Francisco, CA 94107, United States",
    EPIC_FAN_POLICY_URL: "https://legal.epicgames.com/epicgames/fan-art-policy?lang=en",
    ACCOUNT_DELETION_DELAY: "30 days maximum",
    SECURITY_LOG_RETENTION: "12 months maximum",
    CONSENT_CHOICE_RETENTION: "6 months",
    OPTIONAL_TRACKER_RETENTION: "13 months maximum"
  });

  const LEGAL_CONFIG_NL = Object.freeze({
    ...LEGAL_CONFIG,
    EDITOR_STATUS: "individuele niet-professionele uitgever",
    HOST_ADDRESS: "525 Brannan Street, Suite 300, San Francisco, CA 94107, Verenigde Staten",
    EPIC_FAN_POLICY_URL: "https://legal.epicgames.com/epicgames/fan-art-policy?lang=en",
    ACCOUNT_DELETION_DELAY: "maximaal 30 dagen",
    SECURITY_LOG_RETENTION: "maximaal 12 maanden",
    CONSENT_CHOICE_RETENTION: "6 maanden",
    OPTIONAL_TRACKER_RETENTION: "maximaal 13 maanden"
  });

  const EPIC_DISCLAIMER =
    "Des parties des supports utilisés sont des marques déposées et/ou des travaux soumis aux droits d’auteur d’Epic Games, Inc. Tous droits réservés par Epic. Ce produit n’est pas officiel et n’a pas l’approbation d’Epic.";

  const EPIC_DISCLAIMER_EN =
    "Portions of the materials used are trademarks and/or copyrighted works of Epic Games, Inc. All rights reserved by Epic. This product is not official and is not endorsed by Epic.";

  const EPIC_DISCLAIMER_NL =
    "Delen van het gebruikte materiaal zijn handelsmerken en/of auteursrechtelijk beschermde werken van Epic Games, Inc. Alle rechten voorbehouden door Epic. Dit product is niet officieel en wordt niet onderschreven door Epic.";

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeLegalLang(lang) {
    const locale = String(lang || "fr")
      .toLowerCase()
      .slice(0, 2);
    return locale === "en" || locale === "nl" ? locale : "fr";
  }

  function renderLegalTemplate(template, lang = "fr") {
    const locale = normalizeLegalLang(lang);
    const isEn = locale === "en";
    const isNl = locale === "nl";
    const cfg = isEn ? LEGAL_CONFIG_EN : isNl ? LEGAL_CONFIG_NL : LEGAL_CONFIG;
    const lastUpdatedLabel = isEn ? LEGAL_LAST_UPDATED_EN : isNl ? LEGAL_LAST_UPDATED_NL : LEGAL_LAST_UPDATED_FR;
    const replacements = {
      APP_NAME: cfg.APP_NAME,
      EDITOR_NAME: cfg.EDITOR_NAME,
      EDITOR_STATUS: cfg.EDITOR_STATUS,
      CONTACT_EMAIL: cfg.CONTACT_EMAIL,
      SUPPORT_EMAIL: cfg.SUPPORT_EMAIL,
      PRIVACY_EMAIL: cfg.PRIVACY_EMAIL,
      REPORT_EMAIL: cfg.REPORT_EMAIL,
      HOST_NAME: cfg.HOST_NAME,
      HOST_ADDRESS: cfg.HOST_ADDRESS,
      HOST_PHONE: cfg.HOST_PHONE,
      HOST_WEBSITE: cfg.HOST_WEBSITE,
      HOST_SUPPORT: cfg.HOST_SUPPORT,
      HOST_LEGAL_EMAIL: cfg.HOST_LEGAL_EMAIL,
      CNIL_URL: cfg.CNIL_URL,
      EPIC_FAN_POLICY_URL: cfg.EPIC_FAN_POLICY_URL,
      ACCOUNT_MINIMUM_AGE: cfg.ACCOUNT_MINIMUM_AGE,
      ACCOUNT_DELETION_DELAY: cfg.ACCOUNT_DELETION_DELAY,
      SECURITY_LOG_RETENTION: cfg.SECURITY_LOG_RETENTION,
      CONSENT_CHOICE_RETENTION: cfg.CONSENT_CHOICE_RETENTION,
      OPTIONAL_TRACKER_RETENTION: cfg.OPTIONAL_TRACKER_RETENTION,
      EPIC_DISCLAIMER: isEn ? EPIC_DISCLAIMER_EN : isNl ? EPIC_DISCLAIMER_NL : EPIC_DISCLAIMER,
      LEGAL_VERSION,
      LEGAL_LAST_UPDATED_FR: lastUpdatedLabel,
      LEGAL_LAST_UPDATED: lastUpdatedLabel
    };

    let result = String(template);

    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(`\\[${key}\\]`, "g"), escapeHtml(value));
    }

    const unresolvedPlaceholders = result.match(/\[[A-Z0-9_]+\]/g);
    if (unresolvedPlaceholders) {
      throw new Error(`Placeholders juridiques non remplacés : ${[...new Set(unresolvedPlaceholders)].join(", ")}`);
    }

    return result.trim();
  }

  function legalDocument({ id, title, short, content }, lang = "fr") {
    const locale = normalizeLegalLang(lang);
    return Object.freeze({
      id,
      title,
      short,
      version: LEGAL_VERSION,
      lastUpdated: LEGAL_LAST_UPDATED_ISO,
      lastUpdatedLabel:
        locale === "en" ? LEGAL_LAST_UPDATED_EN : locale === "nl" ? LEGAL_LAST_UPDATED_NL : LEGAL_LAST_UPDATED_FR,
      content: renderLegalTemplate(content, locale)
    });
  }

  global.__SPRITE_INDEX_LEGAL_CORE__ = Object.freeze({
    LEGAL_VERSION,
    LEGAL_LAST_UPDATED_ISO,
    LEGAL_LAST_UPDATED_FR,
    LEGAL_LAST_UPDATED_EN,
    LEGAL_LAST_UPDATED_NL,
    LEGAL_CONFIG,
    LEGAL_CONFIG_EN,
    LEGAL_CONFIG_NL,
    EPIC_DISCLAIMER,
    EPIC_DISCLAIMER_EN,
    EPIC_DISCLAIMER_NL,
    normalizeLegalLang,
    renderLegalTemplate,
    legalDocument
  });
})(typeof window !== "undefined" ? window : globalThis);
