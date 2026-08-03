"use strict";

async function ensureWishlistAndStatsSchema(pool) {
  await pool.query(`
      CREATE TABLE IF NOT EXISTS squad_wishlist_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
        variant_id TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'wanted',
        found_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (squad_id, variant_id),
        CHECK (status IN ('wanted', 'found'))
      );
      CREATE INDEX IF NOT EXISTS idx_squad_wishlist_squad ON squad_wishlist_items (squad_id, status, updated_at DESC);
    `);

  await pool.query(`
      CREATE TABLE IF NOT EXISTS squad_stats (
        squad_id INTEGER PRIMARY KEY REFERENCES squads(id) ON DELETE CASCADE,
        collective_completion_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
        recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
        computed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
}

module.exports = { ensureWishlistAndStatsSchema };
