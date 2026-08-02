"use strict";

async function ensureGoalsSchema(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS collection_goals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        squad_id INTEGER REFERENCES squads(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        variant_id TEXT,
        target_variant_ids TEXT[],
        status VARCHAR(30) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE collection_goals ADD COLUMN IF NOT EXISTS target_variant_ids TEXT[];
      CREATE INDEX IF NOT EXISTS idx_collection_goals_user ON collection_goals (user_id, status);
      CREATE INDEX IF NOT EXISTS idx_collection_goals_squad ON collection_goals (squad_id, status);
      CREATE INDEX IF NOT EXISTS idx_collection_goals_variants ON collection_goals USING GIN (target_variant_ids);
    `);
}

module.exports = { ensureGoalsSchema };
