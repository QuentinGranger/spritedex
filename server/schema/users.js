"use strict";

async function ensureUserProfileSchema(pool) {
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
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token_expires TIMESTAMPTZ;
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
      ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_source VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cookie_consent JSONB;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) NOT NULL DEFAULT 'fr';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_invites_from VARCHAR(20) DEFAULT 'everyone';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS squad_invites_from VARCHAR(20) DEFAULT 'friends';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) DEFAULT 'public';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS collection_visibility VARCHAR(20) DEFAULT 'friends';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS priority_visibility VARCHAR(20) DEFAULT 'friends';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS notes_visibility VARCHAR(20) DEFAULT 'private';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS visibility JSONB;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS username_normalized VARCHAR(50) GENERATED ALWAYS AS (LOWER(username)) STORED;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'users_suspension_source_check'
            AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT users_suspension_source_check
            CHECK (suspension_source IS NULL OR suspension_source IN ('self', 'admin'));
        END IF;
      END $$;
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
}

module.exports = { ensureUserProfileSchema };
