"use strict";

const fs = require("fs");
const path = require("path");

const VERIFICATION_STATUSES = Object.freeze([
  "declared",
  "system_confirmed",
  "community_verified",
  "officially_verified"
]);

/** French display copy for name_key / description_key. */
const BADGE_COPY = Object.freeze({
  "badge.first_collection.name": "Première collection",
  "badge.first_collection.description": "Vous avez ajouté votre première variante.",
  "badge.collection_25.name": "Collection 25 %",
  "badge.collection_25.description": "Vous avez atteint 25 % de complétion sur le catalogue publié.",
  "badge.collection_50.name": "Collection 50 %",
  "badge.collection_50.description": "Vous avez atteint 50 % de complétion sur le catalogue publié.",
  "badge.collection_75.name": "Collection 75 %",
  "badge.collection_75.description": "Vous avez atteint 75 % de complétion sur le catalogue publié.",
  "badge.collection_100.name": "Collection 100 %",
  "badge.collection_100.description": "Vous avez atteint 100 % de complétion sur une version du catalogue.",
  "badge.explorer.name": "Explorateur",
  "badge.explorer.description": "Vous avez découvert 5 familles de Sprites.",
  "badge.reliable_collection.name": "Collection fiable",
  "badge.reliable_collection.description": "Votre collection est renseignée à au moins 90 %.",
  "badge.squad_member.name": "Esprit d'escouade",
  "badge.squad_member.description": "Vous participez à une squad.",
  "badge.squad_founder.name": "Fondateur de squad",
  "badge.squad_founder.description": "Vous avez créé une squad rejointe par un autre collectionneur et active depuis au moins 24 heures.",
  "badge.complementary_collection.name": "Collection complémentaire",
  "badge.complementary_collection.description": "Votre collection complète réellement celle d’un ami ou coéquipier.",
  "badge.archivist.name": "Archiviste",
  "badge.archivist.description": "Vous avez maintenu une collection complète et à jour pendant trois mises à jour du catalogue.",
  "badge.early_collector.name": "Early Collector",
  "badge.early_collector.description": "Vous faites partie des collectionneurs présents dès le début de sprite-index.",
  "badge.all_rarities.name": "Une variante de chaque rareté",
  "badge.all_rarities.description": "Vous possédez au moins une variante de chaque rareté officielle du catalogue.",
  "badge.event_completed.name": "Événement complété",
  "badge.event_completed.description": "Vous avez complété toutes les variantes d’un événement.",
  "badge.social.name": "Social",
  "badge.social.description": "Vous avez au moins un ami.",
  "badge.event_complete.name": "Événement accompli",
  "badge.event_complete.description": "Vous avez complété au moins un événement."
});

const BADGE_COPY_EN = Object.freeze({
  "badge.first_collection.name": "First collection",
  "badge.first_collection.description": "You added your first variant.",
  "badge.collection_25.name": "Collection 25%",
  "badge.collection_25.description": "You reached 25% completion of the published catalogue.",
  "badge.collection_50.name": "Collection 50%",
  "badge.collection_50.description": "You reached 50% completion of the published catalogue.",
  "badge.collection_75.name": "Collection 75%",
  "badge.collection_75.description": "You reached 75% completion of the published catalogue.",
  "badge.collection_100.name": "Collection 100%",
  "badge.collection_100.description": "You reached 100% completion on a catalogue version.",
  "badge.explorer.name": "Explorer",
  "badge.explorer.description": "You discovered 5 Sprite families.",
  "badge.reliable_collection.name": "Reliable collection",
  "badge.reliable_collection.description": "Your collection is at least 90% filled in.",
  "badge.squad_member.name": "Squad spirit",
  "badge.squad_member.description": "You are part of a squad.",
  "badge.squad_founder.name": "Squad founder",
  "badge.squad_founder.description": "You created a squad joined by another collector and active for at least 24 hours.",
  "badge.complementary_collection.name": "Complementary collection",
  "badge.complementary_collection.description": "Your collection meaningfully complements a friend or teammate.",
  "badge.archivist.name": "Archivist",
  "badge.archivist.description": "You kept a complete, up-to-date collection across three catalogue updates.",
  "badge.early_collector.name": "Early Collector",
  "badge.early_collector.description": "You were among the collectors present from the start of sprite-index.",
  "badge.all_rarities.name": "One variant of each rarity",
  "badge.all_rarities.description": "You own at least one variant of each official catalogue rarity.",
  "badge.event_completed.name": "Event completed",
  "badge.event_completed.description": "You completed all variants of an event.",
  "badge.social.name": "Social",
  "badge.social.description": "You have at least one friend.",
  "badge.event_complete.name": "Event accomplished",
  "badge.event_complete.description": "You completed at least one event."
});

const BADGE_COPY_NL = Object.freeze({
  "badge.first_collection.name": "Eerste collectie",
  "badge.first_collection.description": "Je hebt je eerste variant toegevoegd.",
  "badge.collection_25.name": "Collectie 25%",
  "badge.collection_25.description": "Je hebt 25% voltooiing van de gepubliceerde catalogus bereikt.",
  "badge.collection_50.name": "Collectie 50%",
  "badge.collection_50.description": "Je hebt 50% voltooiing van de gepubliceerde catalogus bereikt.",
  "badge.collection_75.name": "Collectie 75%",
  "badge.collection_75.description": "Je hebt 75% voltooiing van de gepubliceerde catalogus bereikt.",
  "badge.collection_100.name": "Collectie 100%",
  "badge.collection_100.description": "Je hebt 100% voltooiing van een catalogusversie bereikt.",
  "badge.explorer.name": "Ontdekker",
  "badge.explorer.description": "Je hebt 5 Sprite-families ontdekt.",
  "badge.reliable_collection.name": "Betrouwbare collectie",
  "badge.reliable_collection.description": "Je collectie is voor minstens 90% ingevuld.",
  "badge.squad_member.name": "Teamgeest",
  "badge.squad_member.description": "Je maakt deel uit van een squad.",
  "badge.squad_founder.name": "Squadoprichter",
  "badge.squad_founder.description": "Je hebt een squad gemaakt waar een andere verzamelaar zich bij aansloot en die minstens 24 uur actief is.",
  "badge.complementary_collection.name": "Aanvullende collectie",
  "badge.complementary_collection.description": "Je collectie vult die van een vriend of teamgenoot daadwerkelijk aan.",
  "badge.archivist.name": "Archivaris",
  "badge.archivist.description": "Je hebt drie catalogusupdates lang een volledige, actuele collectie behouden.",
  "badge.early_collector.name": "Early Collector",
  "badge.early_collector.description": "Je behoort tot de verzamelaars die er vanaf het begin van sprite-index bij waren.",
  "badge.all_rarities.name": "Een variant van elke zeldzaamheid",
  "badge.all_rarities.description": "Je bezit minstens één variant van elke officiële zeldzaamheid in de catalogus.",
  "badge.event_completed.name": "Evenement voltooid",
  "badge.event_completed.description": "Je hebt alle varianten van een evenement voltooid.",
  "badge.social.name": "Sociaal",
  "badge.social.description": "Je hebt minstens één vriend.",
  "badge.event_complete.name": "Evenement behaald",
  "badge.event_complete.description": "Je hebt minstens één evenement voltooid."
});

/** Fixed Early Collector cutoff — never change retroactively once seeded (Étapes 47–48). */
const EARLY_COLLECTOR_BEFORE = process.env.EARLY_COLLECTOR_BEFORE || "2026-10-01T00:00:00.000Z";

const TROPHET_DIR = path.join(__dirname, "..", "..", "trophet");

function normalizeForMatch(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

const TROPHY_FILENAME_TO_CODE = Object.freeze({
  archivistepng: "archivist",
  collection25png: "collection_25",
  collection50png: "collection_50",
  collection75png: "collection_75",
  collection100png: "collection_100",
  collectioncomplementairepng: "complementary_collection",
  collectionfiablepng: "reliable_collection",
  earlycollectorpng: "early_collector",
  espritescouadepng: "squad_member",
  explorateurpng: "explorer",
  evenementcompletepng: "event_completed",
  fondateurdesquadpng: "squad_founder",
  premierecollectionpng: "first_collection",
  socialpng: "social",
  unevariantedechaqueraretepng: "all_rarities"
});

const TROPHY_IMAGE_MAP = (() => {
  const map = {};
  try {
    const files = fs.readdirSync(TROPHET_DIR).filter((f) => /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(f));
    for (const f of files) {
      const key = normalizeForMatch(f);
      const code = TROPHY_FILENAME_TO_CODE[key];
      if (code) map[code] = "trophet/" + encodeURIComponent(f);
    }
  } catch (err) {
    // trophet directory may be missing in tests / CI
  }
  return Object.freeze(map);
})();

function getBadgeIconUrl(code) {
  return TROPHY_IMAGE_MAP[code] || null;
}


module.exports = { VERIFICATION_STATUSES, BADGE_COPY, BADGE_COPY_EN, BADGE_COPY_NL, EARLY_COLLECTOR_BEFORE, getBadgeIconUrl };
