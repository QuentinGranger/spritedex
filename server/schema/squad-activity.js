"use strict";

async function ensureSquadActivitySchema(pool) {
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
}

module.exports = { ensureSquadActivitySchema };
