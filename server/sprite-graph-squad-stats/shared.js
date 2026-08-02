"use strict";

// ── Sprite Graph squad daily stats (Étapes 56–58) ────────────────────────────
// squad_id is INTEGER (live schema); the step doc's UUID is not used.

const { pool } = require("../db");
const {
  COMMUNITY_ELIGIBILITY,
  EXPLICIT_COLLECTION_STATUSES
} = require("../sprite-graph-community");
const { resolveCatalogueContext } = require("../sprite-graph-catalogue");

/** Étape 57 — squad eligibility for community averages. */
const SQUAD_COMMUNITY_ELIGIBILITY = Object.freeze({
  minActiveMembers: Number(process.env.GRAPH_SQUAD_MIN_MEMBERS || 2),
  minCollectionFillRate: Number(
    process.env.GRAPH_SQUAD_MIN_FILL || COMMUNITY_ELIGIBILITY.minCollectionFillRate || 0.6
  ),
  recentActivityDays: Number(
    process.env.GRAPH_SQUAD_ACTIVE_DAYS || COMMUNITY_ELIGIBILITY.recentActivityDays || 90
  ),
  requireAnalyticsConsent: process.env.GRAPH_SQUAD_REQUIRE_CONSENT !== "0"
});

function round2(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

/** node-pg DATE → local Y-M-D (avoid String(date).slice → "Sun Jul 26"). */
function toIsoDate(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function ratePercent(numerator, denominator) {
  const d = Number(denominator) || 0;
  if (d <= 0) return null;
  return round2((Number(numerator) || 0) / d * 100);
}

/**
 * Étape 58 — separate acquisition progress from catalogue-size shock.
 *
 * completionRateAfterCatalogueUpdate = same covered / new catalogue size
 * (not the final rate after acquisitions).
 */
function decomposeCatalogueVsAcquisition({
  previousCovered,
  previousCatalogueCount,
  currentCovered,
  currentCatalogueCount
} = {}) {
  const before = ratePercent(previousCovered, previousCatalogueCount);
  const afterCatalogueOnly = ratePercent(previousCovered, currentCatalogueCount);
  const afterWithAcquisitions = ratePercent(currentCovered, currentCatalogueCount);

  const catalogueExpansionImpact =
    before != null && afterCatalogueOnly != null
      ? round2(afterCatalogueOnly - before)
      : null;
  const acquisitionProgress =
    afterWithAcquisitions != null && afterCatalogueOnly != null
      ? round2(afterWithAcquisitions - afterCatalogueOnly)
      : null;

  return {
    completionRateBeforeCatalogueUpdate: before,
    completionRateAfterCatalogueUpdate: afterCatalogueOnly,
    catalogueExpansionImpact,
    acquisitionProgress,
    completionRateCurrent: afterWithAcquisitions
  };
}

module.exports = {
  pool,
  COMMUNITY_ELIGIBILITY,
  EXPLICIT_COLLECTION_STATUSES,
  resolveCatalogueContext,
  SQUAD_COMMUNITY_ELIGIBILITY,
  round2,
  toIsoDate,
  ratePercent,
  decomposeCatalogueVsAcquisition
};
