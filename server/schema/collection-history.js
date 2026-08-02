"use strict";

async function ensureCollectionHistorySchema(pool) {
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
}

module.exports = { ensureCollectionHistorySchema };
