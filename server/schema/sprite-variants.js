"use strict";

async function ensureSpriteVariantsSchema(pool) {
  await pool.query(`
      CREATE TABLE IF NOT EXISTS sprite_variants (
        id VARCHAR(100) PRIMARY KEY,
        sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
        variant_type VARCHAR(30) NOT NULL,
        name VARCHAR(100) NOT NULL,
        official_name VARCHAR(100),
        slug VARCHAR(100),
        rarity VARCHAR(30),
        release_status VARCHAR(20),
        first_observed_at DATE,
        summon_cost INTEGER,
        sprite_chest_drop_chance_pct NUMERIC,
        extra_effect_ref VARCHAR(50),
        effect JSONB,
        acquisition JSONB,
        image_path VARCHAR(255),
        suggested_image_path VARCHAR(255),
        availability JSONB,
        data_status VARCHAR(20),
        sources JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (sprite_id, variant_type)
      );
      CREATE INDEX IF NOT EXISTS idx_sprite_variants_sprite ON sprite_variants(sprite_id);
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS official_name VARCHAR(100);
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS rarity VARCHAR(30);
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS effect JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS acquisition JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS recurrence JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS dates JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS missing_fields JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS editorial_status VARCHAR(20) NOT NULL DEFAULT 'published';
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS editorial_updated_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_sprite_variants_editorial_status ON sprite_variants (editorial_status, editorial_updated_at DESC);
    `);
}

module.exports = { ensureSpriteVariantsSchema };
