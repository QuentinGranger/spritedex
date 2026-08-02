"use strict";

async function ensureAuthenticationSchema(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(80) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);

      -- Session secrets are stored only as s_<sha256>, never as a usable
      -- bearer token. Invalidating older plaintext rows is intentional.
      ALTER TABLE sessions ALTER COLUMN token TYPE VARCHAR(80);
      DELETE FROM sessions WHERE token !~ '^s_[0-9a-f]{64}$';

      CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
        code_hash VARCHAR(64) PRIMARY KEY,
        verifier_hash VARCHAR(64) NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_exchange_codes_expiry
        ON oauth_exchange_codes (expires_at);
      DELETE FROM oauth_exchange_codes WHERE expires_at <= NOW();
    `);
}

module.exports = { ensureAuthenticationSchema };
