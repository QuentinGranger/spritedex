"use strict";

async function ensureSquadsAndSocialSchema(pool) {
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

      -- Collector passport preferences use the application's INTEGER user and
      -- squad identifiers (the UUID identifiers in this database belong to
      -- memberships/invitations, not to users or squads themselves).
      CREATE TABLE IF NOT EXISTS collector_passports (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        primary_squad_id INTEGER REFERENCES squads(id) ON DELETE SET NULL,
        passport_visibility VARCHAR(30) NOT NULL DEFAULT 'friends',
        statistics_visibility VARCHAR(30) NOT NULL DEFAULT 'friends',
        badges_visibility VARCHAR(30) NOT NULL DEFAULT 'friends',
        activity_visibility VARCHAR(30) NOT NULL DEFAULT 'friends',
        comparisons_visibility VARCHAR(30) NOT NULL DEFAULT 'private',
        show_join_date BOOLEAN NOT NULL DEFAULT TRUE,
        show_last_activity BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (passport_visibility IN ('private', 'friends', 'squad', 'public')),
        CHECK (statistics_visibility IN ('private', 'friends', 'squad', 'public')),
        CHECK (badges_visibility IN ('private', 'friends', 'squad', 'public')),
        CHECK (activity_visibility IN ('private', 'friends', 'squad', 'public')),
        CHECK (comparisons_visibility IN ('private', 'friends', 'squad', 'public'))
      );
      CREATE INDEX IF NOT EXISTS idx_collector_passports_primary_squad ON collector_passports(primary_squad_id);

      -- Étape 16 — persistent passport achievements (never revoked when rate drops)
      CREATE TABLE IF NOT EXISTS user_passport_achievements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        achievement_id VARCHAR(80) NOT NULL,
        unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        catalogue_version VARCHAR(80) NOT NULL,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (user_id, achievement_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_passport_achievements_user
        ON user_passport_achievements (user_id, unlocked_at DESC);

      -- Étape 16 — historical peak completion for the passport record line
      CREATE TABLE IF NOT EXISTS user_collection_peaks (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        peak_completion_rate NUMERIC(10, 4) NOT NULL DEFAULT 0,
        peak_completion_display NUMERIC(6, 1) NOT NULL DEFAULT 0,
        peak_owned_variant_count INTEGER NOT NULL DEFAULT 0,
        peak_released_variant_count INTEGER NOT NULL DEFAULT 0,
        peak_catalogue_version VARCHAR(80),
        achieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Étape 18 — versioned event collection requirements
      CREATE TABLE IF NOT EXISTS event_collection_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id VARCHAR(100) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        required_variant_ids JSONB NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ,
        UNIQUE (event_id, version)
      );
      CREATE INDEX IF NOT EXISTS idx_event_collection_versions_active
        ON event_collection_versions (event_id, published_at DESC);

      -- Étape 19 — recorded event completions against a specific requirements version
      CREATE TABLE IF NOT EXISTS user_event_completions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_id VARCHAR(100) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        event_version_id UUID NOT NULL REFERENCES event_collection_versions(id) ON DELETE CASCADE,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        catalogue_version VARCHAR(80) NOT NULL,
        verification_status VARCHAR(30) NOT NULL DEFAULT 'declared',
        UNIQUE (user_id, event_version_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_event_completions_user
        ON user_event_completions (user_id, completed_at DESC);

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
      ALTER TABLE user_reports
        ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolution TEXT,
        ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS admin_notes TEXT,
        ADD COLUMN IF NOT EXISTS appeal_status VARCHAR(20) NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS appeal_message TEXT,
        ADD COLUMN IF NOT EXISTS appeal_created_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS appeal_reviewed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS appeal_resolution TEXT;
      CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports (reported_id, status);
      CREATE INDEX IF NOT EXISTS idx_user_reports_priority ON user_reports (priority, status, created_at DESC);

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
}

module.exports = { ensureSquadsAndSocialSchema };
