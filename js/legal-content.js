"use strict";

// Compatibility facade. Shared legal configuration and each French document are loaded separately.
const legalGlobal = typeof window !== "undefined" ? window : globalThis;
if (typeof module !== "undefined" && module.exports) {
  require("./legal-content/core");
  require("./legal-content/fr/mentions-legales");
  require("./legal-content/fr/politique-confidentialite");
  require("./legal-content/fr/cgu");
  require("./legal-content/fr/regles-communautaires");
  require("./legal-content/fr/cookies");
  require("./legal-content/fr/donnees-personnelles");
  require("./legal-content/fr/suppression-compte");
  require("./legal-content/fr/contact");
  require("./legal-content/fr/signalement");
  require("./legal-content/fr/licences");
}

const {
  LEGAL_CONFIG,
  LEGAL_CONFIG_EN,
  LEGAL_VERSION,
  LEGAL_LAST_UPDATED_ISO,
  LEGAL_LAST_UPDATED_FR,
  LEGAL_LAST_UPDATED_EN,
  LEGAL_LAST_UPDATED_NL,
  EPIC_DISCLAIMER,
  EPIC_DISCLAIMER_EN,
  EPIC_DISCLAIMER_NL,
  normalizeLegalLang,
  renderLegalTemplate,
  legalDocument
} = legalGlobal.__SPRITE_INDEX_LEGAL_CORE__;

const LEGAL_DOCUMENTS = Object.freeze(Object.assign({}, ...(legalGlobal.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [])));

const LEGAL_MENU = Object.freeze([
  Object.freeze({ docId: "mentions-legales" }),
  Object.freeze({ docId: "politique-confidentialite" }),
  Object.freeze({ docId: "cgu" }),
  Object.freeze({ docId: "regles-communautaires" }),
  Object.freeze({ docId: "cookies" }),
  Object.freeze({ docId: "donnees-personnelles" }),
  Object.freeze({ docId: "suppression-compte" }),
  Object.freeze({ docId: "contact" }),
  Object.freeze({ docId: "signalement" }),
  Object.freeze({ docId: "licences" })
]);

const LEGAL_FOOTER = Object.freeze({
  version: LEGAL_VERSION,
  lastUpdated: LEGAL_LAST_UPDATED_ISO,
  epicDisclaimer: EPIC_DISCLAIMER,
  epicPolicyUrl: LEGAL_CONFIG.EPIC_FAN_POLICY_URL,
  links: LEGAL_MENU
});

function buildLegalDocumentsFromSource(sourceMap, lang) {
  const locale = normalizeLegalLang(lang);
  const out = {};
  for (const [id, raw] of Object.entries(sourceMap || {})) {
    if (!raw || typeof raw !== "object") continue;
    out[id] = legalDocument(
      {
        id,
        title: raw.title,
        short: raw.short,
        content: raw.content
      },
      locale
    );
  }
  return Object.freeze(out);
}

const LEGAL_DOCUMENTS_EN_SOURCE = typeof LEGAL_DOCUMENTS_EN !== "undefined"
  ? LEGAL_DOCUMENTS_EN
  : (typeof module !== "undefined" && module.exports ? require("./legal-content-en").LEGAL_DOCUMENTS_EN : null);
const LEGAL_DOCUMENTS_NL_SOURCE = typeof LEGAL_DOCUMENTS_NL !== "undefined"
  ? LEGAL_DOCUMENTS_NL
  : (typeof module !== "undefined" && module.exports ? require("./legal-content-nl").LEGAL_DOCUMENTS_NL : null);

const LEGAL_DOCUMENTS_EN_RESOLVED = LEGAL_DOCUMENTS_EN_SOURCE
  ? buildLegalDocumentsFromSource(LEGAL_DOCUMENTS_EN_SOURCE, "en")
  : Object.freeze({});
const LEGAL_DOCUMENTS_NL_RESOLVED = LEGAL_DOCUMENTS_NL_SOURCE
  ? buildLegalDocumentsFromSource(LEGAL_DOCUMENTS_NL_SOURCE, "nl")
  : Object.freeze({});

function getLegalDocument(docId, lang = "fr") {
  const locale = normalizeLegalLang(lang);
  if (locale === "en" && LEGAL_DOCUMENTS_EN_RESOLVED[docId]) {
    return LEGAL_DOCUMENTS_EN_RESOLVED[docId];
  }
  if (locale === "nl" && LEGAL_DOCUMENTS_NL_RESOLVED[docId]) {
    return LEGAL_DOCUMENTS_NL_RESOLVED[docId];
  }
  return LEGAL_DOCUMENTS[docId] || null;
}

function validateLegalDocuments() {
  const errors = [];
  const menuIds = new Set();

  for (const item of LEGAL_MENU) {
    if (menuIds.has(item.docId)) {
      errors.push(`Document dupliqué dans LEGAL_MENU : ${item.docId}`);
    }
    menuIds.add(item.docId);

    if (!LEGAL_DOCUMENTS[item.docId]) {
      errors.push(`Document absent de LEGAL_DOCUMENTS : ${item.docId}`);
    }

    if (!LEGAL_DOCUMENTS_EN_SOURCE) {
      errors.push(`Sources EN absentes (LEGAL_DOCUMENTS_EN) pour : ${item.docId}`);
    } else if (!LEGAL_DOCUMENTS_EN_SOURCE[item.docId]) {
      errors.push(`Document EN absent de LEGAL_DOCUMENTS_EN : ${item.docId}`);
    } else if (!LEGAL_DOCUMENTS_EN_RESOLVED[item.docId]) {
      errors.push(`Document EN non résolu : ${item.docId}`);
    }

    if (!LEGAL_DOCUMENTS_NL_SOURCE) {
      errors.push(`Sources NL absentes (LEGAL_DOCUMENTS_NL) pour : ${item.docId}`);
    } else if (!LEGAL_DOCUMENTS_NL_SOURCE[item.docId]) {
      errors.push(`Document NL absent de LEGAL_DOCUMENTS_NL : ${item.docId}`);
    } else if (!LEGAL_DOCUMENTS_NL_RESOLVED[item.docId]) {
      errors.push(`Document NL non résolu : ${item.docId}`);
    }
  }

  for (const [key, document] of Object.entries(LEGAL_DOCUMENTS)) {
    if (key !== document.id) {
      errors.push(`Identifiant incohérent : clé ${key}, id ${document.id}`);
    }

    if (!document.title || !document.content) {
      errors.push(`Document incomplet : ${key}`);
    }

    if (/\[[A-Z0-9_]+\]/.test(document.content)) {
      errors.push(`Placeholder non remplacé dans : ${key}`);
    }
  }

  for (const [key, document] of Object.entries(LEGAL_DOCUMENTS_EN_RESOLVED)) {
    if (key !== document.id) {
      errors.push(`Identifiant EN incohérent : clé ${key}, id ${document.id}`);
    }

    if (!document.title || !document.content) {
      errors.push(`Document EN incomplet : ${key}`);
    }

    if (/\[[A-Z0-9_]+\]/.test(document.content)) {
      errors.push(`Placeholder EN non remplacé dans : ${key}`);
    }

    // Heuristic: rendered EN body should not keep common French legal phrasing.
    if (/\b(Dernière mise à jour|Mentions légales|Conditions générales|Politique de confidentialité)\b/.test(document.content)) {
      errors.push(`Document EN encore en français : ${key}`);
    }
  }

  for (const [key, document] of Object.entries(LEGAL_DOCUMENTS_NL_RESOLVED)) {
    if (key !== document.id) {
      errors.push(`Identifiant NL incohérent : clé ${key}, id ${document.id}`);
    }
    if (!document.title || !document.content) {
      errors.push(`Document NL incomplet : ${key}`);
    }
    if (/\[[A-Z0-9_]+\]/.test(document.content)) {
      errors.push(`Placeholder non remplacé dans le document NL : ${key}`);
    }
    if (/\b(Dernière mise à jour|Mentions légales|Conditions générales|Politique de confidentialité)\b/.test(document.content)) {
      errors.push(`Document NL encore en français : ${key}`);
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

const LEGAL_VALIDATION = validateLegalDocuments();

if (!LEGAL_VALIDATION.valid && typeof console !== "undefined") {
  console.error("Erreur de validation des documents juridiques SPRITE-INDEX", {
    errors: LEGAL_VALIDATION.errors
  });
}

const SPRITE_INDEX_LEGAL = Object.freeze({
  LEGAL_CONFIG,
  LEGAL_CONFIG_EN,
  LEGAL_VERSION,
  LEGAL_LAST_UPDATED_ISO,
  LEGAL_LAST_UPDATED_FR,
  LEGAL_LAST_UPDATED_EN,
  LEGAL_LAST_UPDATED_NL,
  EPIC_DISCLAIMER,
  EPIC_DISCLAIMER_EN,
  EPIC_DISCLAIMER_NL,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENTS_EN: LEGAL_DOCUMENTS_EN_RESOLVED,
  LEGAL_DOCUMENTS_NL: LEGAL_DOCUMENTS_NL_RESOLVED,
  LEGAL_MENU,
  LEGAL_FOOTER,
  LEGAL_VALIDATION,
  getLegalDocument,
  validateLegalDocuments,
  normalizeLegalLang,
  renderLegalTemplate
});

if (typeof window !== "undefined") {
  window.SPRITE_INDEXLegal = SPRITE_INDEX_LEGAL;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = SPRITE_INDEX_LEGAL;
}
