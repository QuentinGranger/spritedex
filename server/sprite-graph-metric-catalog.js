"use strict";

// ── Sprite Graph metric documentation (Étape 100) ────────────────────────────
// Canonical catalog: name, description, formula, population, window, thresholds,
// version, limits, lastModified. Source of truth for docs + admin UI.

const { PUBLIC_ANONYMIZATION_MIN_USERS } = require("./sprite-graph-privacy");
const { GRAPH_FORMULA_IDS } = require("./sprite-graph-formula");
const { TREND_DISPLAY_REQUIREMENTS, TREND_MIN_VOLUME } = require("./sprite-graph-trends");
const { COMMUNITY_ELIGIBILITY } = require("./sprite-graph-community");
const { SQUAD_COMMUNITY_ELIGIBILITY } = require("./sprite-graph-squad-stats");

const METRIC_CATALOG_LAST_REVIEW = "2026-07-26";

/**
 * @typedef {object} GraphMetricDoc
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} formula
 * @property {string} eligiblePopulation
 * @property {string} timeWindow
 * @property {string|number} minimumThreshold
 * @property {string} version
 * @property {string[]} limits
 * @property {string} lastModified
 * @property {"public"|"internal"} surface
 */

/** @type {GraphMetricDoc[]} */
const GRAPH_METRIC_CATALOG = Object.freeze([
  Object.freeze({
    id: "ownership_rate",
    name: "Taux de possession communautaire",
    description:
      "Part des collectionneurs éligibles ayant renseigné la variante et la possédant.",
    formula:
      "Nombre d’utilisateurs éligibles possédant la variante "
      + "divisé par "
      + "nombre d’utilisateurs éligibles ayant renseigné la variante "
      + "(statuts owned / missing / priority / spotted).",
    eligiblePopulation:
      `Utilisateurs non suspendus, non test, actifs ≤ ${COMMUNITY_ELIGIBILITY.recentActivityDays} j, `
      + `opt-in communauté / consentement analytics, collection remplie ≥ `
      + `${Math.round(COMMUNITY_ELIGIBILITY.minCollectionFillRate * 100)} %, `
      + "avec un statut renseigné (hors unknown dans le dénominateur).",
    timeWindow: "Snapshot journalier (metric_date) ; consolidation nocturne.",
    minimumThreshold: `${PUBLIC_ANONYMIZATION_MIN_USERS} utilisateurs dans l’échantillon pour affichage public`,
    version: GRAPH_FORMULA_IDS.OWNERSHIP_RATE,
    limits: [
      "Les statuts unknown ne diluent pas le taux",
      "Pas d’affichage public sous le seuil d’anonymisation",
      "Ne confond pas rareté officielle et possession sprite-index"
    ],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "public"
  }),
  Object.freeze({
    id: "priority_rate",
    name: "Taux de priorité parmi les manquants",
    description:
      "Part des collectionneurs éligibles auxquels la variante manque et qui l’ont placée en priorité.",
    formula:
      "Nombre d’utilisateurs éligibles en statut priority "
      + "divisé par "
      + "nombre d’utilisateurs éligibles en missing + priority + spotted (non-owned renseignés).",
    eligiblePopulation:
      "Même population que le taux de possession ; dénominateur = non-owned renseignés.",
    timeWindow: "Snapshot journalier (metric_date).",
    minimumThreshold: `${PUBLIC_ANONYMIZATION_MIN_USERS} utilisateurs (échantillon public)`,
    version: GRAPH_FORMULA_IDS.PRIORITY_RATE,
    limits: [
      "Ne mesure pas l’urgence individuelle",
      "Les ajouts en priorité sur 7/30/90 j sont des compteurs séparés"
    ],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "public"
  }),
  Object.freeze({
    id: "interest_score",
    name: "Indice d’intérêt communautaire",
    description:
      "Score 0–100 combinant priorités, ajouts collection, différences de comparaison et notifications.",
    formula:
      "interest_score = priorityScore×0,40 + collectionScore×0,30 + comparisonScore×0,20 + notificationScore×0,10 "
      + "(chaque composante = percentile 0–100 sur la fenêtre).",
    eligiblePopulation:
      "Agrégats issus des événements graph et stats communauté des utilisateurs éligibles.",
    timeWindow: "Fenêtre glissante 7 jours par défaut (calcul journalier).",
    minimumThreshold: `${TREND_MIN_VOLUME} utilisateurs / volume min pour classer une tendance associée`,
    version: GRAPH_FORMULA_IDS.INTEREST_SCORE,
    limits: [
      "Ce n’est pas un score de prestige utilisateur",
      "Les poids peuvent évoluer via GRAPH_POPULARITY_WEIGHTS → nouvelle version de formule"
    ],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "public"
  }),
  Object.freeze({
    id: "interest_trend",
    name: "Tendance sprite-index",
    description:
      "Direction d’évolution de l’indice d’intérêt (forte hausse → forte baisse).",
    formula:
      "Classification du % de variation de interest_score (7 j) : "
      + "≥25 fortement en hausse ; ≥10 en hausse ; >−10 stable ; >−25 en baisse ; sinon fortement en baisse.",
    eligiblePopulation: "Variantes avec série interest_score calculée.",
    timeWindow:
      `Affichage si ≥ ${TREND_DISPLAY_REQUIREMENTS.minDaysOfData} j de données, `
      + `≥ ${TREND_DISPLAY_REQUIREMENTS.minEligibleUsers} utilisateurs, `
      + `≥ ${TREND_DISPLAY_REQUIREMENTS.minRelevantEvents} événements pertinents (7 j).`,
    minimumThreshold: TREND_DISPLAY_REQUIREMENTS,
    version: `${GRAPH_FORMULA_IDS.INTEREST_SCORE}+trend_bands_v1`,
    limits: [
      "Sinon : « Pas encore assez de données pour calculer une tendance. »",
      "Nouvelle variante sans historique → pas de tendance"
    ],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "public"
  }),
  Object.freeze({
    id: "squad_progress",
    name: "Progression collective de squad",
    description:
      "Évolution du taux de complétion collective, séparant choc catalogue et acquisitions.",
    formula:
      "Δ complétion corrigé : acquisition_progress = taux après acquisitions − taux après seule expansion catalogue "
      + "(decomposeCatalogueVsAcquisition).",
    eligiblePopulation:
      `Squads avec ≥ ${SQUAD_COMMUNITY_ELIGIBILITY.minActiveMembers} membres actifs non suspendus, `
      + "collections suffisamment renseignées, activité récente ; collections private exclues de la couverture.",
    timeWindow: "Snapshots journaliers ; progress_7d / progress_30d vs jours antérieurs.",
    minimumThreshold: `${SQUAD_COMMUNITY_ELIGIBILITY.minActiveMembers} membres actifs pour éligibilité communauté`,
    version: GRAPH_FORMULA_IDS.SQUAD_PROGRESS,
    limits: [
      "Pas de classement compétitif public",
      "Comparaison anonyme par bande de taille (ex. 4–6) uniquement",
      "Une squad inactive n’entre pas dans les moyennes communauté"
    ],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "public"
  }),
  Object.freeze({
    id: "sample_size",
    name: "Taille d’échantillon",
    description:
      "Nombre de collections éligibles ayant renseigné la variante (dénominateur possession).",
    formula: "COUNT(utilisateurs éligibles avec statut ∈ {owned, missing, priority, spotted}).",
    eligiblePopulation: "Identique à ownership_rate.",
    timeWindow: "Journalier.",
    minimumThreshold: PUBLIC_ANONYMIZATION_MIN_USERS,
    version: "sample_size_v1",
    limits: ["Affiché publiquement de façon agrégée (« échantillon de N collections »)"],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "public"
  }),
  Object.freeze({
    id: "priority_adds_7d",
    name: "Ajouts en priorité (7 jours)",
    description: "Nombre d’événements collection.priority_added effectifs sur 7 jours.",
    formula: "COUNT(graph_events_effective WHERE event_type = collection.priority_added AND occurred_at ∈ [J-6, J]).",
    eligiblePopulation: "Événements non annulés ; acteurs soumis aux gates gouvernance.",
    timeWindow: "7 jours glissants à la date de calcul.",
    minimumThreshold: "Aucun pour le compteur interne ; affichage public soumis au seuil d’échantillon de la variante",
    version: "priority_adds_7d_v1",
    limits: ["Compteur d’événements, pas d’utilisateurs uniques"],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "public"
  }),
  Object.freeze({
    id: "events_per_minute",
    name: "Événements par minute",
    description: "Débit d’ingestion graph_events (métrique technique).",
    formula: "COUNT(graph_events WHERE recorded_at ≥ NOW() − W minutes) / W.",
    eligiblePopulation: "Tous les événements persistés (y compris exclus communauté).",
    timeWindow: "Fenêtre configurable (défaut 60 min).",
    minimumThreshold: "n/a",
    version: "ops_events_per_minute_v1",
    limits: ["Interne uniquement — jamais dans le produit public"],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "internal"
  }),
  Object.freeze({
    id: "worker_lag_seconds",
    name: "Retard du worker outbox",
    description: "Âge du plus ancien message outbox encore pending.",
    formula: "EXTRACT(EPOCH FROM NOW() − MIN(available_at)) WHERE status = pending.",
    eligiblePopulation: "Lignes event_outbox pending.",
    timeWindow: "Temps réel / instantané.",
    minimumThreshold: "n/a",
    version: "ops_worker_lag_v1",
    limits: ["Interne uniquement"],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "internal"
  }),
  Object.freeze({
    id: "aggregate_calc_ms",
    name: "Temps de calcul des agrégats",
    description: "Durée de la dernière consolidation journalière (pipeline).",
    formula: "finished_at − started_at du run_type = aggregate_calc.",
    eligiblePopulation: "n/a (ops).",
    timeWindow: "Dernier run enregistré.",
    minimumThreshold: "n/a",
    version: "ops_aggregate_calc_ms_v1",
    limits: ["Interne uniquement"],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "internal"
  }),
  Object.freeze({
    id: "rebuild_duration_ms",
    name: "Durée de reconstruction",
    description: "Durée du dernier rebuildGraphMetrics.",
    formula: "finished_at − started_at du run_type = rebuild.",
    eligiblePopulation: "n/a (ops).",
    timeWindow: "Dernier run enregistré.",
    minimumThreshold: "n/a",
    version: "ops_rebuild_ms_v1",
    limits: ["Interne uniquement ; un rebuild explicite peut réécrire une plage"],
    lastModified: METRIC_CATALOG_LAST_REVIEW,
    surface: "internal"
  })
]);

function getGraphMetricCatalog({ surface = null } = {}) {
  const items = surface
    ? GRAPH_METRIC_CATALOG.filter((m) => m.surface === surface)
    : [...GRAPH_METRIC_CATALOG];
  return {
    version: 1,
    lastReview: METRIC_CATALOG_LAST_REVIEW,
    count: items.length,
    metrics: items
  };
}

function getGraphMetricDoc(metricId) {
  return GRAPH_METRIC_CATALOG.find((m) => m.id === metricId) || null;
}

module.exports = {
  METRIC_CATALOG_LAST_REVIEW,
  GRAPH_METRIC_CATALOG,
  getGraphMetricCatalog,
  getGraphMetricDoc
};
