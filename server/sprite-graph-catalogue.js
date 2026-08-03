"use strict";

// ── Sprite Graph catalogue version helper (Étape 59) ─────────────────────────

const { pool } = require("./db");

/**
 * Resolve the current catalogue fingerprint + released/active variant count.
 * Used to stamp every major daily aggregate so periods remain comparable.
 */
async function resolveCatalogueContext(db = pool) {
  const compare = require("./compare");
  const { computeCatalogueVersion } = require("./squad-analysis-cache");

  let catalogue = [];
  try {
    if (typeof compare.getServerCompareCatalogItemsCached === "function") {
      catalogue = await compare.getServerCompareCatalogItemsCached();
    } else if (typeof compare.getServerCompareCatalogItems === "function") {
      catalogue = await compare.getServerCompareCatalogItems();
    }
  } catch (_) {
    catalogue = [];
  }
  if (!Array.isArray(catalogue)) catalogue = [];

  const active =
    typeof compare.isVariantReleasedAndActiveServer === "function"
      ? catalogue.filter(compare.isVariantReleasedAndActiveServer)
      : catalogue;

  const catalogueVersion = computeCatalogueVersion(catalogue) || "unknown";
  const catalogueVariantCount = active.length || catalogue.length;

  // Fallback count from DB if catalogue loader is empty (tests / cold start).
  if (!catalogueVariantCount) {
    const res = await db.query(`SELECT COUNT(*)::int AS n FROM sprite_variants`);
    return {
      catalogueVersion: catalogueVersion === "unknown" ? `db-${res.rows[0]?.n || 0}` : catalogueVersion,
      catalogueVariantCount: res.rows[0]?.n || 0,
      catalogue
    };
  }

  return { catalogueVersion, catalogueVariantCount, catalogue };
}

/**
 * Étape 59 — ensure catalogue_version columns exist on major aggregate tables.
 */
async function ensureCatalogueVersionColumns(db = pool) {
  const alters = [
    `ALTER TABLE community_variant_stats ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE community_sprite_stats ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE comparison_daily_stats ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE comparison_sprite_diff_stats ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE comparison_complementarity_by_band ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE sprite_popularity_scores ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE variant_interest_daily ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE squad_daily_snapshots ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE notification_daily_stats ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`,
    `ALTER TABLE graph_daily_metrics ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`
  ];
  for (const sql of alters) {
    try {
      await db.query(sql);
    } catch (_) {
      /* table may not exist yet — created later by ensure* */
    }
  }
}

module.exports = {
  resolveCatalogueContext,
  ensureCatalogueVersionColumns
};
