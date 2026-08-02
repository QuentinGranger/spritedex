"use strict";

async function ensureCollectionEntriesSchema(pool) {
    await pool.query(`
      ALTER TABLE availability_periods ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unknown';
      CREATE TABLE IF NOT EXISTS sprite_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        variant_id VARCHAR(100) NOT NULL,
        sprite_id VARCHAR(50),
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        note TEXT DEFAULT '',
        priority TEXT DEFAULT 'none',
        obtained_at TIMESTAMPTZ,
        mastery_level SMALLINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, variant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sprite_entries_user ON sprite_entries (user_id);

      -- Migrate old schema where the variant id was stored in a column named sprite_id
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sprite_entries' AND column_name='sprite_id')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sprite_entries' AND column_name='variant_id') THEN
          ALTER TABLE sprite_entries RENAME COLUMN sprite_id TO variant_id;
        END IF;
      END $$;

      ALTER TABLE sprite_entries ADD COLUMN IF NOT EXISTS sprite_id VARCHAR(50);
      ALTER TABLE sprite_entries ADD COLUMN IF NOT EXISTS mastery_level SMALLINT NOT NULL DEFAULT 0;

      -- A mastery level is meaningful only for a variant the collector owns.
      -- Existing owned rows predate mastery, so they start at level 1.
      UPDATE sprite_entries
      SET mastery_level = CASE WHEN status = 'owned' THEN 1 ELSE 0 END
      WHERE mastery_level IS NULL
         OR mastery_level < 0
         OR mastery_level > 5
         OR (status = 'owned' AND mastery_level = 0)
         OR (status <> 'owned' AND mastery_level <> 0);

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'sprite_entries_mastery_level_check'
            AND conrelid = 'sprite_entries'::regclass
        ) THEN
          ALTER TABLE sprite_entries
            ADD CONSTRAINT sprite_entries_mastery_level_check
            CHECK (
              (status = 'owned' AND mastery_level BETWEEN 1 AND 5)
              OR (status <> 'owned' AND mastery_level = 0)
            );
        END IF;
      END $$;

      -- Backfill base sprite_id from variant_id using the catalog mapping
      UPDATE sprite_entries se
      SET sprite_id = COALESCE(
        (SELECT sv.sprite_id FROM sprite_variants sv WHERE sv.id = se.variant_id LIMIT 1),
        split_part(se.variant_id, '::', 1),
        se.variant_id
      )
      WHERE sprite_id IS NULL;

      -- Ensure a single active entry per (user, variant). Deduplicate first,
      -- then enforce UNIQUE (user_id, variant_id) if missing.
      DELETE FROM sprite_entries a
      USING sprite_entries b
      WHERE a.user_id = b.user_id
        AND a.variant_id = b.variant_id
        AND a.id < b.id;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'unique_user_variant'
            AND conrelid = 'sprite_entries'::regclass
        ) AND NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'sprite_entries' AND indexdef LIKE '%(user_id, variant_id)%'
        ) THEN
          ALTER TABLE sprite_entries ADD CONSTRAINT unique_user_variant UNIQUE (user_id, variant_id);
        END IF;
      END $$;
    `);
}

module.exports = { ensureCollectionEntriesSchema };
