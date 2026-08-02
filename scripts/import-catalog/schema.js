"use strict";

async function ensureCatalogImportSchema(db) {
  await db.query(`
    ALTER TABLE sprites
    ADD COLUMN IF NOT EXISTS catalog_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS slug VARCHAR(50),
    ADD COLUMN IF NOT EXISTS official_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS season_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS event_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS image VARCHAR(255),
    ADD COLUMN IF NOT EXISTS introduced_in_update VARCHAR(20),
    ADD COLUMN IF NOT EXISTS first_observed_at DATE,
    ADD COLUMN IF NOT EXISTS last_verified_at DATE,
    ADD COLUMN IF NOT EXISTS officially_announced_at DATE,
    ADD COLUMN IF NOT EXISTS ability JSONB,
    ADD COLUMN IF NOT EXISTS acquisition JSONB,
    ADD COLUMN IF NOT EXISTS availability JSONB,
    ADD COLUMN IF NOT EXISTS recurrence JSONB,
    ADD COLUMN IF NOT EXISTS dates JSONB,
    ADD COLUMN IF NOT EXISTS missing_fields JSONB,
    ADD COLUMN IF NOT EXISTS base_summon_cost INTEGER,
    ADD COLUMN IF NOT EXISTS data_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS notes JSONB,
    ADD COLUMN IF NOT EXISTS sources JSONB,
    ADD COLUMN IF NOT EXISTS catalog_version VARCHAR(32),
    ADD COLUMN IF NOT EXISTS catalog_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_released BOOLEAN DEFAULT TRUE;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sprite_variants (
      id VARCHAR(100) PRIMARY KEY,
      sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
      variant_type VARCHAR(30) NOT NULL,
      name VARCHAR(100) NOT NULL,
      official_name VARCHAR(100),
      slug VARCHAR(100),
      rarity VARCHAR(30),
      release_status VARCHAR(20),
      first_observed_at DATE,
      summon_cost INTEGER,
      sprite_chest_drop_chance_pct NUMERIC,
      extra_effect_ref VARCHAR(50),
      effect JSONB,
      acquisition JSONB,
      image_path VARCHAR(255),
      suggested_image_path VARCHAR(255),
      availability JSONB,
      data_status VARCHAR(20),
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (sprite_id, variant_type)
    );
    CREATE INDEX IF NOT EXISTS idx_sprite_variants_sprite ON sprite_variants(sprite_id);
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS official_name VARCHAR(100);
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS rarity VARCHAR(30);
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS effect JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS acquisition JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS recurrence JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS dates JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS missing_fields JSONB;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS seasons (
      id VARCHAR(50) PRIMARY KEY,
      chapter INTEGER,
      season INTEGER,
      name VARCHAR(100),
      name_en VARCHAR(100),
      start_date DATE,
      end_date DATE,
      data_status VARCHAR(20) DEFAULT 'incomplete',
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_seasons_chapter ON seasons(chapter, season);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS events (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(100),
      type VARCHAR(50),
      season_id VARCHAR(50),
      start_date DATE,
      end_date DATE,
      data_status VARCHAR(20) DEFAULT 'incomplete',
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_events_season ON events(season_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS availability_periods (
      id VARCHAR(100) PRIMARY KEY,
      sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      status VARCHAR(20) DEFAULT 'unknown',
      event_id VARCHAR(100),
      confidence VARCHAR(20) DEFAULT 'unknown',
      data_status VARCHAR(20) DEFAULT 'incomplete',
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (sprite_id, start_date, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_availability_periods_sprite ON availability_periods(sprite_id);
    CREATE INDEX IF NOT EXISTS idx_availability_periods_dates ON availability_periods(start_date, end_date);
  `);
  await db.query(`
    ALTER TABLE availability_periods ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unknown';
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sprite_sources (
      id VARCHAR(100) PRIMARY KEY,
      type VARCHAR(30),
      publisher VARCHAR(100),
      title TEXT,
      url TEXT,
      published_at TIMESTAMPTZ,
      observed_at TIMESTAMPTZ,
      last_verified_at TIMESTAMPTZ,
      reliability VARCHAR(20),
      catalog_version VARCHAR(32),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.query(`
    ALTER TABLE sprite_sources
      ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `);

  // Étape 19 — Historique des modifications du catalogue.
  // Chaque changement de champ (rareté, disponibilité, saison…) est journalisé
  // avec l'ancienne et la nouvelle valeur, l'auteur, la date, la raison et la source.
  await db.query(`
    CREATE TABLE IF NOT EXISTS catalog_change_history (
      id SERIAL PRIMARY KEY,
      entity_type VARCHAR(30) NOT NULL DEFAULT 'sprite',
      entity_id VARCHAR(100) NOT NULL,
      field VARCHAR(100) NOT NULL,
      previous_value JSONB,
      new_value JSONB,
      changed_by VARCHAR(100),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason TEXT,
      source_id VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_change_history_entity ON catalog_change_history (entity_id, changed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_change_history_changed_at ON catalog_change_history (changed_at DESC);
  `);
}

module.exports = { ensureCatalogImportSchema };
