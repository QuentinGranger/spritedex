"use strict";

async function ensureShareCapabilitiesSchema(pool) {
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

      CREATE TABLE IF NOT EXISTS security_migrations (
        name VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
}

module.exports = { ensureShareCapabilitiesSchema };
