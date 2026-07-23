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
      ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cookie_consent JSONB;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_invites_from VARCHAR(20) DEFAULT 'everyone';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS squad_invites_from VARCHAR(20) DEFAULT 'friends';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) DEFAULT 'public';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS collection_visibility VARCHAR(20) DEFAULT 'friends';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS priority_visibility VARCHAR(20) DEFAULT 'friends';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notes_visibility VARCHAR(20) DEFAULT 'private';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS visibility JSONB;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username_normalized VARCHAR(50) GENERATED ALWAYS AS (LOWER(username)) STORED;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_normalized ON users (username_normalized);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
    `);
    await pool.query(`
      UPDATE users
      SET profile_visibility = CASE privacy
            WHEN 'private' THEN 'private'
            WHEN 'friends_only' THEN 'friends'
            WHEN 'squad_only' THEN 'squad'
            WHEN 'public' THEN 'public'
            ELSE 'public'
          END,
          collection_visibility = COALESCE(collection_visibility, CASE privacy
            WHEN 'private' THEN 'private'
            WHEN 'friends_only' THEN 'friends'
            WHEN 'squad_only' THEN 'squad'
            WHEN 'public' THEN 'public'
            ELSE 'friends'
          END),
          priority_visibility = COALESCE(priority_visibility, CASE privacy
            WHEN 'private' THEN 'private'
            WHEN 'friends_only' THEN 'friends'
            WHEN 'squad_only' THEN 'squad'
            WHEN 'public' THEN 'public'
            ELSE 'friends'
          END),
          notes_visibility = COALESCE(notes_visibility, 'private')
      WHERE privacy IS NOT NULL
    `);
    await pool.query(`
      UPDATE users
      SET visibility = COALESCE(visibility, '{}') || jsonb_build_object(
            'profile', profile_visibility,
            'collection', collection_visibility,
            'priorities', priority_visibility,
            'notes', notes_visibility,
            'statistics', 'public',
            'activity', 'private'
          )
      WHERE visibility IS NULL OR visibility = '{}'::jsonb
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS squads (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(50) NOT NULL DEFAULT 'Mon escouade',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        join_open BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS squad_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(30) NOT NULL DEFAULT 'member',
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        UNIQUE (squad_id, user_id)
      );
      -- Lookups by user_id (common-squad checks, profile list) need a dedicated index.
      CREATE INDEX IF NOT EXISTS idx_squad_members_user ON squad_members (user_id);

      CREATE TABLE IF NOT EXISTS squad_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
        inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        responded_at TIMESTAMPTZ,
        UNIQUE (squad_id, invitee_id, status)
      );
      CREATE INDEX IF NOT EXISTS idx_squad_invitations_invitee ON squad_invitations (invitee_id, status);
      CREATE INDEX IF NOT EXISTS idx_squad_invitations_squad ON squad_invitations (squad_id, status);

      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS friendships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        responded_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (requester_id <> addressee_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS unique_friendship_pair
        ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))
        WHERE status IN ('pending', 'accepted', 'blocked');
      CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_id);
      CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id);

      CREATE TABLE IF NOT EXISTS user_blocks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (blocker_id, blocked_id),
        CHECK (blocker_id <> blocked_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_blocks_pair ON user_blocks (blocker_id, blocked_id);

      CREATE TABLE IF NOT EXISTS user_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(500),
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (reporter_id <> reported_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports (reported_id, status);

      CREATE TABLE IF NOT EXISTS friend_invite_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ,
        max_uses INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_friend_invite_links_owner ON friend_invite_links (owner_id);
      CREATE INDEX IF NOT EXISTS idx_friend_invite_links_token ON friend_invite_links (token_hash);
    `);
    await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS join_open BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS logo_url TEXT`);
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
        sprite_id TEXT,
        type VARCHAR(30) NOT NULL DEFAULT 'collection_update',
        action VARCHAR(20) NOT NULL DEFAULT 'owned',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_squad_activity_squad ON squad_activity (squad_id, created_at DESC);
    `);

    // Migrate pre-existing squad_activity tables to the unified schema.
    await pool.query(`
      ALTER TABLE squad_activity
        ADD COLUMN IF NOT EXISTS type VARCHAR(30) NOT NULL DEFAULT 'collection_update',
        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}',
        ALTER COLUMN sprite_id DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_squad_activity_type ON squad_activity (squad_id, type, created_at DESC);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS collection_goals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        squad_id INTEGER REFERENCES squads(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        variant_id TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_collection_goals_user ON collection_goals (user_id, status);
      CREATE INDEX IF NOT EXISTS idx_collection_goals_squad ON collection_goals (squad_id, status);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS squad_stats (
        squad_id INTEGER PRIMARY KEY REFERENCES squads(id) ON DELETE CASCADE,
        collective_completion_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
        computed_at TIMESTAMPTZ DEFAULT NOW()
      );
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        entity_id VARCHAR(100),
        context JSONB DEFAULT '{}',
        message TEXT NOT NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, read_at NULLS FIRST);
    `);

    // Ensure the context column exists even on databases created before this change.
    await pool.query(`
      ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS context JSONB DEFAULT '{}';
      CREATE INDEX IF NOT EXISTS idx_notifications_context ON notifications USING GIN (context);
    `);
    await pushService.ensurePushTables(pool);
    await secLog.ensureSecurityLogTable(pool);
    await analytics.ensureCompareAnalyticsTable(pool);
    await analytics.ensureProductAnalyticsTable(pool);

    // ── Migration: unifying relationship model ──
    // The legacy `friends` table is no longer used by the application.
    // Any remaining rows are migrated into `friendships` before the old table is dropped.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friends') THEN
          INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at, updated_at)
          SELECT user_id, friend_user_id, status, created_at,
                 CASE WHEN status IN ('pending') THEN NULL ELSE updated_at END,
                 updated_at
          FROM friends
          WHERE status IS NOT NULL
            AND user_id <> friend_user_id
          ON CONFLICT DO NOTHING;

          DROP TABLE friends;
        END IF;
      END
      $$;
    `);

    // ── Migration: normalize squad_members table ──
    // Existing tables (pre-normalization) lack id/role/status/left_at. This block
    // upgrades them idempotently without breaking current integer FKs on users/squads.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'squad_members')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'squad_members' AND column_name = 'id') THEN

          ALTER TABLE squad_members ADD COLUMN id UUID DEFAULT gen_random_uuid();
          ALTER TABLE squad_members ADD COLUMN role VARCHAR(30) NOT NULL DEFAULT 'member';
          ALTER TABLE squad_members ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active';
          ALTER TABLE squad_members ADD COLUMN left_at TIMESTAMPTZ;

          ALTER TABLE squad_members ALTER COLUMN id SET NOT NULL;
          ALTER TABLE squad_members ALTER COLUMN squad_id SET NOT NULL;
          ALTER TABLE squad_members ALTER COLUMN user_id SET NOT NULL;
          ALTER TABLE squad_members ALTER COLUMN joined_at SET NOT NULL;

          ALTER TABLE squad_members DROP CONSTRAINT IF EXISTS squad_members_pkey;
          ALTER TABLE squad_members ADD PRIMARY KEY (id);
          ALTER TABLE squad_members ADD CONSTRAINT unique_squad_member UNIQUE (squad_id, user_id);

          UPDATE squad_members SET role = 'owner'
          WHERE user_id = (SELECT created_by FROM squads WHERE squads.id = squad_members.squad_id);
        END IF;
      END
      $$;
    `);

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
