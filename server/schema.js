// schema.js — extracted from server.js

const analytics = require("../analytics");
const pushService = require("../push-service");
const secLog = require("../security-logger");
const { seedReferenceData } = require("../sprite-data");
const { shareSquad } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");

// ── DB init : ensure ALL tables exist (idempotent schema bootstrap) ──
// Runs on every boot. Creates the full schema if missing so the app can be
// deployed against a brand-new empty PostgreSQL database with zero manual SQL.
async function ensureSquadTables() {
  try {
    // Core reference + user tables (previously created manually in dev).
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
      ADD COLUMN IF NOT EXISTS is_released BOOLEAN DEFAULT TRUE;
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
    await pool.query(`
      ALTER TABLE availability_periods ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unknown';
      CREATE TABLE IF NOT EXISTS sprite_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        variant_id VARCHAR(100) NOT NULL,
        sprite_id VARCHAR(50),
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        note TEXT DEFAULT '',
        priority TEXT DEFAULT 'none',
        obtained_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, variant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sprite_entries_user ON sprite_entries (user_id);

      -- Migrate old schema where the variant id was stored in a column named sprite_id
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sprite_entries' AND column_name='sprite_id')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sprite_entries' AND column_name='variant_id') THEN
          ALTER TABLE sprite_entries RENAME COLUMN sprite_id TO variant_id;
        END IF;
      END $$;

      ALTER TABLE sprite_entries ADD COLUMN IF NOT EXISTS sprite_id VARCHAR(50);

      -- Backfill base sprite_id from variant_id using the catalog mapping
      UPDATE sprite_entries se
      SET sprite_id = COALESCE(
        (SELECT sv.sprite_id FROM sprite_variants sv WHERE sv.id = se.variant_id LIMIT 1),
        split_part(se.variant_id, '::', 1),
        se.variant_id
      )
      WHERE sprite_id IS NULL;

      -- Ensure the unique constraint on (user_id, variant_id) is present
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'sprite_entries' AND indexdef LIKE '%(user_id, variant_id)%'
        ) THEN
          ALTER TABLE sprite_entries ADD CONSTRAINT unique_user_variant UNIQUE (user_id, variant_id);
        END IF;
      END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy VARCHAR(20) DEFAULT 'squad_only';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token VARCHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_iterations INTEGER;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cgu_accepted BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cgu_version VARCHAR(32);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cgu_accepted_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cookie_consent JSONB;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS squads (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(50) NOT NULL DEFAULT 'Mon escouade',
        created_by INTEGER REFERENCES users(id),
        join_open BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS squad_members (
        squad_id INTEGER REFERENCES squads(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (squad_id, user_id)
      );
      -- The primary key (squad_id, user_id) does not efficiently serve
      -- lookups by user_id alone (used by shareSquad() to find common squads
      -- between two users on every privacy check) — add a dedicated index.
      CREATE INDEX IF NOT EXISTS idx_squad_members_user ON squad_members (user_id);

      CREATE TABLE IF NOT EXISTS friends (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        friend_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, friend_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends (friend_user_id);
    `);
    await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS join_open BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS squad_activity (
        id SERIAL PRIMARY KEY,
        squad_id INTEGER REFERENCES squads(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        sprite_id TEXT NOT NULL,
        action VARCHAR(20) NOT NULL DEFAULT 'owned',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_squad_activity_squad ON squad_activity (squad_id, created_at DESC);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sprite_news (
        id SERIAL PRIMARY KEY,
        hash VARCHAR(32) UNIQUE NOT NULL,
        source VARCHAR(30) NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        image TEXT,
        link TEXT,
        news_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS collection_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        sprite_id TEXT NOT NULL,
        old_status VARCHAR(20),
        new_status VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_collection_history_user ON collection_history (user_id, created_at DESC);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS legacy_sprite_name_map (
        old_name TEXT PRIMARY KEY,
        sprite_id TEXT NOT NULL,
        variant_name TEXT NOT NULL DEFAULT 'Base',
        status TEXT NOT NULL DEFAULT 'mapped',
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration_errors (
        id SERIAL PRIMARY KEY,
        table_name TEXT NOT NULL,
        original_key TEXT NOT NULL,
        user_id INTEGER,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compare_share_tokens (
        id SERIAL PRIMARY KEY,
        token VARCHAR(64) UNIQUE NOT NULL,
        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        collection_visible BOOLEAN NOT NULL DEFAULT TRUE,
        show_notes BOOLEAN NOT NULL DEFAULT FALSE,
        show_priorities BOOLEAN NOT NULL DEFAULT TRUE,
        allow_visitor_compare BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_compare_share_token ON compare_share_tokens (token);
      CREATE INDEX IF NOT EXISTS idx_compare_share_owner ON compare_share_tokens (owner_user_id);
    `);
    await pushService.ensurePushTables(pool);
    await secLog.ensureSecurityLogTable(pool);
    await analytics.ensureCompareAnalyticsTable(pool);
    console.log("Squad tables ready");
  } catch (err) {
    console.error("Failed to create squad tables:", err);
  }
}

// Auto-seed static reference data on every boot. seedReferenceData is idempotent
// (upserts), so new sprites/images added to sprite-data.js are synced into
// existing databases as well as fresh ones.
async function ensureReferenceDataSeeded() {
  try {
    const counts = await seedReferenceData(pool);
    console.log(`Seeded reference data: ${counts.sprites} sprites, ${counts.variants} variants, ${counts.images} images`);
  } catch (err) {
    console.error("Failed to seed reference data:", err);
  }
}

// ── Account deletion cleanup ──
// Permanently removes accounts marked for deletion more than 30 days ago.
// CASCADE constraints handle sprite_entries, sessions, squad_members, etc.
async function purgeDeletedAccounts() {
  try {
    const result = await pool.query(
      `DELETE FROM users
       WHERE deleted_at IS NOT NULL
         AND deleted_at < NOW() - INTERVAL '30 days'
       RETURNING id`
    );
    if (result.rows.length > 0) {
      console.log(`[PURGE] ${result.rows.length} deleted account(s) permanently removed.`);
    }
  } catch (err) {
    console.error("[PURGE] Failed to purge deleted accounts:", err);
  }
}

module.exports = { ensureReferenceDataSeeded, ensureSquadTables, purgeDeletedAccounts };
