const { pool } = require("./shared");

async function ensureSquadDailyStatsTables(db = pool) {
  // Étape 56 — canonical daily squad stats (migrate older stub columns).
  // Create first, then ALTER (table may already exist from community stub),
  // then indexes that depend on new columns.
  await db.query(`
    CREATE TABLE IF NOT EXISTS squad_daily_stats (
      metric_date DATE NOT NULL,
      squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,

      active_member_count INTEGER NOT NULL DEFAULT 0,
      covered_variant_count INTEGER NOT NULL DEFAULT 0,
      catalogue_variant_count INTEGER NOT NULL DEFAULT 0,

      collective_completion_rate DECIMAL NOT NULL DEFAULT 0,
      unique_owner_variant_count INTEGER NOT NULL DEFAULT 0,
      shared_variant_count INTEGER NOT NULL DEFAULT 0,

      catalogue_version VARCHAR(80),
      eligible_for_community BOOLEAN NOT NULL DEFAULT FALSE,

      progress_1d DECIMAL,
      progress_7d DECIMAL,
      progress_30d DECIMAL,

      completion_rate_before_catalogue_update DECIMAL,
      completion_rate_after_catalogue_update DECIMAL,
      catalogue_expansion_impact DECIMAL,
      acquisition_progress DECIMAL,

      joins_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (metric_date, squad_id)
    );
  `);

  await db.query(`
    ALTER TABLE squad_daily_stats
      ADD COLUMN IF NOT EXISTS active_member_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS covered_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS catalogue_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS collective_completion_rate DECIMAL NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS unique_owner_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shared_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80),
      ADD COLUMN IF NOT EXISTS eligible_for_community BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS progress_1d DECIMAL,
      ADD COLUMN IF NOT EXISTS progress_7d DECIMAL,
      ADD COLUMN IF NOT EXISTS progress_30d DECIMAL,
      ADD COLUMN IF NOT EXISTS completion_rate_before_catalogue_update DECIMAL,
      ADD COLUMN IF NOT EXISTS completion_rate_after_catalogue_update DECIMAL,
      ADD COLUMN IF NOT EXISTS catalogue_expansion_impact DECIMAL,
      ADD COLUMN IF NOT EXISTS acquisition_progress DECIMAL,
      ADD COLUMN IF NOT EXISTS joins_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_squad_daily_stats_date
      ON squad_daily_stats (metric_date DESC);
    CREATE INDEX IF NOT EXISTS idx_squad_daily_stats_eligible
      ON squad_daily_stats (metric_date DESC)
      WHERE eligible_for_community = TRUE;
  `);

  // Étape 57 — community-wide average squad progression.
  await db.query(`
    CREATE TABLE IF NOT EXISTS community_squad_progress_daily (
      metric_date DATE NOT NULL,
      window_days INTEGER NOT NULL DEFAULT 7,
      eligible_squad_count INTEGER NOT NULL DEFAULT 0,
      avg_completion_progress DECIMAL,
      catalogue_version VARCHAR(80),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, window_days)
    );
  `);
}

module.exports = { ensureSquadDailyStatsTables };
