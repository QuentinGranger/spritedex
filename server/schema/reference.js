"use strict";

async function ensureReferenceSchema(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sprites (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        rarity VARCHAR(30) NOT NULL,
        color VARCHAR(60) NOT NULL,
        effect TEXT NOT NULL,
        variants TEXT[] NOT NULL,
        available VARCHAR(20) NOT NULL DEFAULT 'available',
        added_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS variant_meta (
        name VARCHAR(30) PRIMARY KEY,
        label VARCHAR(50) NOT NULL,
        bonus TEXT NOT NULL
      );
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
      ADD COLUMN IF NOT EXISTS is_released BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS editorial_status VARCHAR(20) NOT NULL DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS editorial_updated_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_sprites_editorial_status ON sprites (editorial_status, editorial_updated_at DESC);
      CREATE TABLE IF NOT EXISTS sprite_images (
        sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
        variant VARCHAR(30) NOT NULL,
        image_path VARCHAR(255) NOT NULL,
        PRIMARY KEY (sprite_id, variant)
      );
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
    await pool.query(`
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
      ALTER TABLE sprite_sources
        ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);
}

module.exports = { ensureReferenceSchema };
