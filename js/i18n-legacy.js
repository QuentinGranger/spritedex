/* Translation of French text retained in old HTML and dynamically rendered UI. */
(function setupLegacyTranslation() {
  const locale = window.SPRITE_INDEX_LOCALE || "fr";
  const EN = window.__SPRITE_INDEX_I18N_EN_LEGACY__ || {};

  // French HTML source → Dutch (loaded from js/i18n-nl-legacy-data.js).
  const NL = Object.freeze(window.__SPRITE_INDEX_I18N_NL_LEGACY__ || {});

  const TIME_UNIT_EN = Object.freeze({
    minute: "minute",
    minutes: "minutes",
    heure: "hour",
    heures: "hours",
    jour: "day",
    jours: "days",
    semaine: "week",
    semaines: "weeks",
    mois: "month"
  });
  const TIME_UNIT_NL = Object.freeze({
    minute: "minuut",
    minutes: "minuten",
    heure: "uur",
    heures: "uur",
    jour: "dag",
    jours: "dagen",
    semaine: "week",
    semaines: "weken",
    mois: "maand"
  });

  const PATTERNS_EN = [
    [/^Niveau (\d+)$/, "Level $1"],
    [/^(\d+) variantes? obtenues$/, "$1 variants collected"],
    [/^(\d+) variantes? possédées$/, "$1 variants owned"],
    [/^(\d+) variantes? à découvrir$/, "$1 variants left to discover"],
    [/^(\d+) actions$/, "$1 actions"],
    [/^(\d+) semaines? actives$/, "$1 active weeks"],
    [
      /^Il y a (\d+) (minute|heure|jour|semaine|mois)s?$/,
      (full, n, unit) => {
        const key = full.includes(`${unit}s`) && unit !== "mois" ? `${unit}s` : unit;
        return `${n} ${TIME_UNIT_EN[key] || unit} ago`;
      }
    ],
    [/^Aujourd’hui · (.+)$/, "Today · $1"],
    [/^Hier · (.+)$/, "Yesterday · $1"],
    [/^Aucune activité ne correspond à ce filtre\.$/, "No activity matches this filter."],
    [/^Impossible de charger (.+)\.$/, "Unable to load $1."],
    [/^Erreur réseau\.$/, "Network error."],
    [/^Statut : (.+)$/, "Status: $1"],
    [/^(.+) invalide$/, "Invalid $1"],
    [/^(.+) invalides$/, "Invalid $1"],
    [/^(.+) requis$/, "$1 required"],
    [/^(.+) introuvable$/, "$1 not found"],
    [/^Trop de variantes \((\d+) max\)$/, "Too many variants ($1 max)"],
    [/^Trop de membres assignés \((\d+) max\)$/, "Too many assigned members ($1 max)"],
    [/^Trop de participants \((\d+) max\)$/, "Too many participants ($1 max)"],
    [/^Trop de changements \((\d+) max\)$/, "Too many changes ($1 max)"],
    [/^Trop de (.+) \((\d+) max\)$/, "Too many $1 ($2 max)"],
    [/^(.+) trop long \((\d+) max\)$/, "$1 too long ($2 max)"],
    [/^(.+) trop volumineux$/, "$1 too large"],
    [/^Provider (.+) non configuré$/, "Provider $1 is not configured"],
    [/^Possession communautaire : (.+) %$/, "Community ownership: $1%"],
    [
      /^Prioritaire chez (.+) % des collectionneurs auxquels elle manque$/,
      "Priority for $1% of collectors who are missing it"
    ],
    [/^Tendance : (.+)$/, "Trend: $1"],
    [/^Rareté officielle : (.+)$/, "Official rarity: $1"],
    [/^Taux de possession sprite-index : (.+) %$/, "sprite-index ownership rate: $1%"],
    [/^Évolution : ([+-]?.+) points$/, "Change: $1 points"],
    [/^(\d+) priorités → (\d+) priorités en 7 jours$/, "$1 priorities → $2 priorities in 7 days"],
    [/^échantillon de (\d+) collections? renseignées?$/, "sample of $1 filled collection(s)"],
    [/^\+(\d+) ajouts? en priorité sur (\d+) jours$/, "+$1 priority add(s) over $2 days"],
    [/^(.+) manque à (.+) et (.+)\.$/, "$1 is missing for $2 and $3."],
    [/^(.+) est possédée par (.+) mais manque à (.+)\.$/, "$1 is owned by $2 but missing for $3."],
    [
      /^Seulement (.+) % de la communauté sprite-index la possède\.$/,
      "Only $1% of the sprite-index community owns it."
    ],
    [
      /^Cette variante est prioritaire chez (.+) % des utilisateurs auxquels elle manque\.$/,
      "This variant is a priority for $1% of users who are missing it."
    ]
  ];

  const PATTERNS_NL = [
    [/^Niveau (\d+)$/, "Niveau $1"],
    [/^(\d+) variantes? obtenues$/, "$1 varianten verzameld"],
    [/^(\d+) variantes? possédées$/, "$1 varianten in bezit"],
    [/^(\d+) variantes? à découvrir$/, "$1 varianten te ontdekken"],
    [/^(\d+) actions$/, "$1 acties"],
    [/^(\d+) semaines? actives$/, "$1 actieve weken"],
    [
      /^Il y a (\d+) (minute|heure|jour|semaine|mois)s?$/,
      (full, n, unit) => {
        const key = full.includes(`${unit}s`) && unit !== "mois" ? `${unit}s` : unit;
        return `${n} ${TIME_UNIT_NL[key] || unit} geleden`;
      }
    ],
    [/^Aujourd’hui · (.+)$/, "Vandaag · $1"],
    [/^Hier · (.+)$/, "Gisteren · $1"],
    [/^Aucune activité ne correspond à ce filtre\.$/, "Geen activiteit komt overeen met dit filter."],
    [/^Impossible de charger (.+)\.$/, "Kan $1 niet laden."],
    [/^Erreur réseau\.$/, "Netwerkfout."],
    [/^Statut : (.+)$/, "Status: $1"],
    [/^(.+) invalide$/, "Ongeldige $1"],
    [/^(.+) invalides$/, "Ongeldige $1"],
    [/^(.+) requis$/, "$1 verplicht"],
    [/^(.+) introuvable$/, "$1 niet gevonden"],
    [/^Trop de variantes \((\d+) max\)$/, "Te veel varianten ($1 max)"],
    [/^Trop de membres assignés \((\d+) max\)$/, "Te veel toegewezen leden ($1 max)"],
    [/^Trop de participants \((\d+) max\)$/, "Te veel deelnemers ($1 max)"],
    [/^Trop de changements \((\d+) max\)$/, "Te veel wijzigingen ($1 max)"],
    [/^Trop de (.+) \((\d+) max\)$/, "Te veel $1 ($2 max)"],
    [/^(.+) trop long \((\d+) max\)$/, "$1 te lang ($2 max)"],
    [/^(.+) trop volumineux$/, "$1 te groot"],
    [/^Provider (.+) non configuré$/, "Provider $1 is niet geconfigureerd"],
    [/^Possession communautaire : (.+) %$/, "Communitybezit: $1%"],
    [
      /^Prioritaire chez (.+) % des collectionneurs auxquels elle manque$/,
      "Prioriteit voor $1% van de verzamelaars die hem missen"
    ],
    [/^Tendance : (.+)$/, "Trend: $1"],
    [/^Rareté officielle : (.+)$/, "Officiële zeldzaamheid: $1"],
    [/^Taux de possession sprite-index : (.+) %$/, "sprite-index-bezitspercentage: $1%"],
    [/^Évolution : ([+-]?.+) points$/, "Verandering: $1 punten"],
    [/^(\d+) priorités → (\d+) priorités en 7 jours$/, "$1 prioriteiten → $2 prioriteiten in 7 dagen"],
    [/^échantillon de (\d+) collections? renseignées?$/, "steekproef van $1 ingevulde collectie(s)"],
    [/^\+(\d+) ajouts? en priorité sur (\d+) jours$/, "+$1 prioriteitstoevoeging(en) over $2 dagen"],
    [/^(.+) manque à (.+) et (.+)\.$/, "$1 ontbreekt bij $2 en $3."],
    [/^(.+) est possédée par (.+) mais manque à (.+)\.$/, "$1 is in bezit van $2 maar ontbreekt bij $3."],
    [
      /^Seulement (.+) % de la communauté sprite-index la possède\.$/,
      "Slechts $1% van de sprite-index-community heeft hem."
    ],
    [
      /^Cette variante est prioritaire chez (.+) % des utilisateurs auxquels elle manque\.$/,
      "Deze variant is een prioriteit voor $1% van de gebruikers die hem missen."
    ]
  ];

  function applyPattern(trimmed, pattern, replacement) {
    if (typeof replacement === "function") {
      if (!pattern.test(trimmed)) return null;
      return trimmed.replace(pattern, replacement);
    }
    if (!pattern.test(trimmed)) return null;
    return trimmed.replace(pattern, replacement);
  }

  function translateLegacy(value) {
    const source = String(value == null ? "" : value);
    if (locale === "fr" || !source) return source;
    const dict = locale === "nl" ? NL : EN;
    const patterns = locale === "nl" ? PATTERNS_NL : PATTERNS_EN;
    const trimmed = source.trim();
    const direct = dict[trimmed];
    if (direct) return source.replace(trimmed, direct);
    for (const [pattern, replacement] of patterns) {
      const replaced = applyPattern(trimmed, pattern, replacement);
      if (replaced == null) continue;
      // Second pass for nested FR fragments (e.g. "Trend: en hausse").
      const nested =
        dict[replaced] ||
        (() => {
          const m = replaced.match(/^Trend: (.+)$/);
          return m && dict[m[1]] ? `Trend: ${dict[m[1]]}` : null;
        })();
      return source.replace(trimmed, nested || replaced);
    }
    return source;
  }

  window.SpriteIndexLegacyTranslation = Object.freeze({ translateLegacy });
})();
