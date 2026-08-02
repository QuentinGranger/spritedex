/* Browser locale detection, independent from message catalogues. */
(function setupApplicationLanguage() {
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

function deviceLanguage() {
  const forced = new URLSearchParams(window.location.search).get("lang");
  if (forced === "fr" || forced === "en" || forced === "nl") return forced;
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

const locale = deviceLanguage();
window.SPRITE_INDEX_LOCALE = locale;
window.appLocale = () => locale;
})();
