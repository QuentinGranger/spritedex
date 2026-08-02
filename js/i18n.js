/* I18n public API: compose catalogues and browser adapters. */
(function setupI18n() {
  const locale = window.SPRITE_INDEX_LOCALE || "fr";
  const MESSAGES = Object.freeze({
    fr: window.__SPRITE_INDEX_I18N_FR__ || {},
    en: window.__SPRITE_INDEX_I18N_EN__ || {},
    nl: window.__SPRITE_INDEX_I18N_NL__ || {}
  });

  const KEY_RE = /^[a-z][a-z0-9]*(?:\.[a-z0-9_]+)+$/i;

function isMessageKey(value) {
  return KEY_RE.test(String(value || ""));
}

function interpolate(template, params) {
  if (!params || typeof params !== "object") return template;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => (
    params[name] == null ? `{${name}}` : String(params[name])
  ));
}

function messageForKey(key, params) {
  const dict = MESSAGES[locale] || MESSAGES.fr;
  const fallback = MESSAGES.fr || {};
  const raw = (dict && dict[key]) || fallback[key];
  if (raw == null) return null;
  return interpolate(raw, params);
}

  function translate(value, params) {
    const source = String(value == null ? "" : value);
    if (!source) return source;
    if (isMessageKey(source)) {
      const keyed = messageForKey(source, params);
      return keyed == null ? source : keyed;
    }
    return window.SpriteIndexLegacyTranslation.translateLegacy(source);
  }

  window.t = translate;
  window.MESSAGES = MESSAGES;
  const dom = window.SpriteIndexI18nDom.install({
    locale,
    translateLegacy: window.SpriteIndexLegacyTranslation.translateLegacy,
    messageForKey
  });
  window.translateDocument = dom.translateDocument;
  window.applyI18n = dom.applyI18n;
  dom.start();
  window.SpriteIndexI18nFetch.install(locale);
})();
