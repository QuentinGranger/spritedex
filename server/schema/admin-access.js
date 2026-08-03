"use strict";

async function ensureAdminAccessSchema(pool) {
  // Backoffice actions are deliberately separate from the product/security
  // logs. They contain no session secrets and make every administrative
  // mutation attributable to the protected terminal session.
  await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id BIGSERIAL PRIMARY KEY,
        actor VARCHAR(80) NOT NULL DEFAULT 'terminal',
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(60) NOT NULL,
        target_id VARCHAR(160),
        justification TEXT,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created
        ON admin_audit_log (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_target
        ON admin_audit_log (target_type, target_id, created_at DESC);

      -- Shared across instances so rolling deploys and load-balanced nodes
      -- can validate the same terminal-admin tickets and session cookies.
      CREATE TABLE IF NOT EXISTS admin_access_tickets (
        token_hash VARCHAR(64) PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_ip VARCHAR(64),
        created_user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_admin_access_tickets_expires
        ON admin_access_tickets (expires_at);

      -- Named operators are the long-term replacement for the legacy shared
      -- terminal secret. Passwords are scrypt hashes and never leave Postgres.
      CREATE TABLE IF NOT EXISTS admin_operators (
        id VARCHAR(32) PRIMARY KEY,
        username VARCHAR(40) NOT NULL UNIQUE,
        display_name VARCHAR(80) NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(40) NOT NULL DEFAULT 'owner',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        secret_rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ,
        last_login_ip VARCHAR(64),
        last_login_user_agent TEXT,
        last_unusual_login_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_admin_operators_active
        ON admin_operators (active, username);

      CREATE TABLE IF NOT EXISTS admin_security_alerts (
        id VARCHAR(32) PRIMARY KEY,
        operator_id VARCHAR(32) REFERENCES admin_operators(id) ON DELETE SET NULL,
        severity VARCHAR(20) NOT NULL DEFAULT 'warning',
        kind VARCHAR(60) NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by VARCHAR(80)
      );
      CREATE INDEX IF NOT EXISTS idx_admin_security_alerts_open
        ON admin_security_alerts (acknowledged_at, created_at DESC);

      ALTER TABLE admin_access_tickets
        ADD COLUMN IF NOT EXISTS operator_id VARCHAR(32),
        ADD COLUMN IF NOT EXISTS operator_label VARCHAR(80),
        ADD COLUMN IF NOT EXISTS role VARCHAR(40),
        ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(20) NOT NULL DEFAULT 'legacy_global';

      CREATE TABLE IF NOT EXISTS admin_access_sessions (
        token_hash VARCHAR(64) PRIMARY KEY,
        public_id VARCHAR(16) NOT NULL UNIQUE,
        actor_label VARCHAR(60) NOT NULL DEFAULT 'terminal',
        role VARCHAR(40) NOT NULL DEFAULT 'owner',
        expires_at TIMESTAMPTZ NOT NULL,
        max_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_ip VARCHAR(64),
        created_user_agent TEXT,
        last_ip VARCHAR(64),
        last_user_agent TEXT
      );
      ALTER TABLE admin_access_sessions
        ADD COLUMN IF NOT EXISTS max_expires_at TIMESTAMPTZ;
      ALTER TABLE admin_access_sessions
        ADD COLUMN IF NOT EXISTS role VARCHAR(40) NOT NULL DEFAULT 'owner';
      ALTER TABLE admin_access_sessions
        ADD COLUMN IF NOT EXISTS operator_id VARCHAR(32),
        ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(20) NOT NULL DEFAULT 'legacy_global';
      UPDATE admin_access_sessions
      SET max_expires_at = COALESCE(max_expires_at, created_at + INTERVAL '12 hours')
      WHERE max_expires_at IS NULL;
      UPDATE admin_access_sessions
      SET role = COALESCE(NULLIF(TRIM(role), ''), 'owner')
      WHERE role IS NULL OR TRIM(role) = '';
      CREATE INDEX IF NOT EXISTS idx_admin_access_sessions_expires
        ON admin_access_sessions (expires_at);
      CREATE INDEX IF NOT EXISTS idx_admin_access_sessions_max_expires
        ON admin_access_sessions (max_expires_at);

      CREATE TABLE IF NOT EXISTS admin_totp_replays (
        replay_key VARCHAR(64) PRIMARY KEY,
        counter_value BIGINT NOT NULL,
        purpose VARCHAR(40) NOT NULL DEFAULT 'login',
        used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      -- Migrate the first short-lived shape (counter-only PK) if it still exists.
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'admin_totp_replays'
            AND column_name = 'counter_value'
        ) AND NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'admin_totp_replays'
            AND column_name = 'replay_key'
        ) THEN
          DROP TABLE admin_totp_replays;
          CREATE TABLE admin_totp_replays (
            replay_key VARCHAR(64) PRIMARY KEY,
            counter_value BIGINT NOT NULL,
            purpose VARCHAR(40) NOT NULL DEFAULT 'login',
            used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS idx_admin_totp_replays_used
        ON admin_totp_replays (used_at);
    `);
}

module.exports = { ensureAdminAccessSchema };
