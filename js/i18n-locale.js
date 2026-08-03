/* Browser locale detection, independent from message catalogues. */
(function setupApplicationLanguage() {
const LOCALE_STORAGE_KEY = "sprite-index_locale";
const SUPPORTED = new Set(["fr", "en", "nl"]);

const FRANCOPHONE_REGIONS = new Set([
  "BJ", "BI", "CM", "KM", "CI", "DJ", "GA", "GN", "GQ", "MG",
  "CF", "CD", "CG", "RW", "SN", "SC", "TD", "TG",
  "DZ", "BF", "ML", "MA", "MU", "MR", "NE", "TN",
  "BE", "FR", "LU", "MC", "CH", "AD", "CA", "HT", "LB", "VU",
  "GP", "MQ", "GF", "RE", "YT", "PF", "BL", "MF", "PM", "WF",
  "NC", "TF", "CP"
]);

// Country / territory codes where Dutch is an official or primary language.
// Belgium (BE) is intentionally omitted here: Wallonia must stay French via
// FRANCOPHONE_REGIONS / `fr-BE`, while Flanders and Dutch-speaking Brussels
// resolve through language tag `nl` / `nl-BE`.
const DUTCH_REGIONS = new Set([
  "NL", // Netherlands
  "SR", // Suriname
  "AW", // Aruba
  "CW", // Curaçao
  "SX", // Sint Maarten (Dutch side)
  "BQ"  // Bonaire, Sint Eustatius, Saba
]);

function normalizeLocale(value) {
  const lang = String(value || "").toLowerCase().slice(0, 2);
  return SUPPORTED.has(lang) ? lang : null;
}

function storedLocale() {
  try {
    return normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function detectBrowserLanguage() {
  const locales = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en"];
  for (const value of locales) {
    const [language, region] = String(value || "").replace(/_/g, "-").split("-");
    const lang = String(language || "").toLowerCase();
    const regionCode = String(region || "").toUpperCase();
    if (lang === "nl") return "nl";
    if (lang === "fr") return "fr";
    if (DUTCH_REGIONS.has(regionCode)) return "nl";
    if (FRANCOPHONE_REGIONS.has(regionCode)) return "fr";
  }
  return "en";
}

function persistLocale(lang) {
  const locale = normalizeLocale(lang);
  if (!locale) return null;
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* ignore */ }
  return locale;
}

function stripLangQueryParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("lang")) return;
    url.searchParams.delete("lang");
    const clean = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, "", clean);
  } catch { /* ignore */ }
}

function deviceLanguage() {
  const forced = normalizeLocale(new URLSearchParams(window.location.search).get("lang"));
  if (forced) {
    persistLocale(forced);
    stripLangQueryParam();
    return forced;
  }
  return storedLocale() || detectBrowserLanguage();
}

/** Switch UI language and reload so catalogues / Accept-Language stay in sync. */
function setAppLanguage(lang) {
  const locale = persistLocale(lang);
  if (!locale || locale === window.SPRITE_INDEX_LOCALE) return false;
  document.documentElement.dataset.langSwitching = "1";
  // Keep the current path/query (except lang) so deep links survive the reload.
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  window.location.assign(`${url.pathname}${url.search}${url.hash}` || "/");
  return true;
}

const locale = deviceLanguage();
window.SPRITE_INDEX_LOCALE = locale;
window.appLocale = () => locale;
window.setAppLanguage = setAppLanguage;
window.SPRITE_INDEX_LOCALES = Object.freeze(["fr", "en", "nl"]);
window.SPRITE_INDEX_LOCALE_KEY = LOCALE_STORAGE_KEY;

try {
  document.documentElement.lang = locale;
} catch { /* ignore */ }
})();
