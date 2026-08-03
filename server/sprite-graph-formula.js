"use strict";

// ── Sprite Graph formula versioning (Étape 99) ───────────────────────────────
// Stamp formula ids on new aggregates only. Never silently rewrite history.

/**
 * Current formula identifiers. Bump the suffix (v2…) when interpretation changes.
 * Historical rows keep the id they were written with.
 */
const GRAPH_FORMULA_IDS = Object.freeze({
  OWNERSHIP_RATE: process.env.GRAPH_FORMULA_OWNERSHIP_RATE || "ownership_rate_v1",
  PRIORITY_RATE: process.env.GRAPH_FORMULA_PRIORITY_RATE || "priority_rate_v1",
  INTEREST_SCORE: process.env.GRAPH_FORMULA_INTEREST_SCORE || "interest_score_v1",
  SQUAD_PROGRESS: process.env.GRAPH_FORMULA_SQUAD_PROGRESS || "squad_progress_v1"
});

/** Bundle stamp for community_variant_stats (ownership + priority). */
function communityFormulaVersion(ids = GRAPH_FORMULA_IDS) {
  return `${ids.OWNERSHIP_RATE};${ids.PRIORITY_RATE}`;
}

function interestFormulaVersion(ids = GRAPH_FORMULA_IDS) {
  return ids.INTEREST_SCORE;
}

function squadFormulaVersion(ids = GRAPH_FORMULA_IDS) {
  return ids.SQUAD_PROGRESS;
}

function getGraphFormulaRegistry() {
  let catalog = null;
  try {
    catalog = require("./sprite-graph-metric-catalog").getGraphMetricCatalog();
  } catch (_) {
    /* optional */
  }
  return {
    version: 1,
    note: "Les formules sont versionnées ; une nouvelle version n’écrase pas l’interprétation historique.",
    current: { ...GRAPH_FORMULA_IDS },
    stamps: {
      community_variant_stats: communityFormulaVersion(),
      variant_interest_daily: interestFormulaVersion(),
      sprite_popularity_scores: interestFormulaVersion(),
      squad_daily_stats: squadFormulaVersion(),
      community_squad_progress_daily: squadFormulaVersion()
    },
    rewriteHistoryOnDailyJob: false,
    rebuildMayOverwriteExplicitRange: true,
    documentation: catalog ? { metricCount: catalog.count, lastReview: catalog.lastReview } : null
  };
}

async function ensureFormulaVersionColumns(db) {
  const alters = [
    `ALTER TABLE community_variant_stats ADD COLUMN IF NOT EXISTS formula_version VARCHAR(80)`,
    `ALTER TABLE variant_interest_daily ADD COLUMN IF NOT EXISTS formula_version VARCHAR(80)`,
    `ALTER TABLE sprite_popularity_scores ADD COLUMN IF NOT EXISTS formula_version VARCHAR(80)`,
    `ALTER TABLE squad_daily_stats ADD COLUMN IF NOT EXISTS formula_version VARCHAR(80)`,
    `ALTER TABLE community_squad_progress_daily ADD COLUMN IF NOT EXISTS formula_version VARCHAR(80)`
  ];
  for (const sql of alters) {
    try {
      await db.query(sql);
    } catch (_) {
      /* table may not exist yet */
    }
  }
}

module.exports = {
  GRAPH_FORMULA_IDS,
  communityFormulaVersion,
  interestFormulaVersion,
  squadFormulaVersion,
  getGraphFormulaRegistry,
  ensureFormulaVersionColumns
};
