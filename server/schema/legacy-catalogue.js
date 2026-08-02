"use strict";

async function ensureLegacyCatalogueSchema(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS legacy_sprite_name_map (
        old_name TEXT PRIMARY KEY,
        sprite_id TEXT NOT NULL,
        variant_name TEXT NOT NULL DEFAULT 'Base',
        status TEXT NOT NULL DEFAULT 'mapped',
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration_errors (
        id SERIAL PRIMARY KEY,
        table_name TEXT NOT NULL,
        original_key TEXT NOT NULL,
        user_id INTEGER,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
}

module.exports = { ensureLegacyCatalogueSchema };
