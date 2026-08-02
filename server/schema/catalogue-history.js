"use strict";

async function ensureCatalogueHistorySchema(pool) {
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
}

module.exports = { ensureCatalogueHistorySchema };
