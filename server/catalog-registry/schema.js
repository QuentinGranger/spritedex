"use strict";

/**
 * Ensure catalog registry tables, append-only trigger, and projection columns.
 * Safe to call repeatedly (idempotent).
 */
async function ensureCatalogRegistrySchema(db) {
  await db.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS catalog_registry_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('sprite', 'variant')),
      entity_id VARCHAR(100) NOT NULL,
      parent_sprite_id VARCHAR(50),
      seq BIGINT NOT NULL CHECK (seq > 0),
      event_type VARCHAR(80) NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source VARCHAR(50) NOT NULL,
      actor_user_id INTEGER,
      actor_label VARCHAR(100),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      content_hash CHAR(64) NOT NULL,
      prev_content_hash CHAR(64),
      CONSTRAINT catalog_registry_events_entity_seq UNIQUE (entity_type, entity_id, seq),
      CONSTRAINT catalog_registry_events_hash_unique UNIQUE (content_hash),
      CONSTRAINT catalog_registry_events_parent_chk CHECK (
        (entity_type = 'sprite' AND parent_sprite_id IS NULL)
        OR (entity_type = 'variant' AND parent_sprite_id IS NOT NULL)
      ),
      CONSTRAINT catalog_registry_events_prev_chk CHECK (
        (seq = 1 AND prev_content_hash IS NULL)
        OR (seq > 1 AND prev_content_hash IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_catalog_registry_entity_seq
      ON catalog_registry_events (entity_type, entity_id, seq);
    CREATE INDEX IF NOT EXISTS idx_catalog_registry_parent
      ON catalog_registry_events (parent_sprite_id)
      WHERE parent_sprite_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_catalog_registry_recorded
      ON catalog_registry_events (recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_catalog_registry_type
      ON catalog_registry_events (event_type, recorded_at DESC);
  `);

  await db.query(`
    CREATE OR REPLACE FUNCTION catalog_registry_events_reject_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'catalog_registry_events is append-only; mutations must append a new version';
    END;
    $$;
  `);
  await db.query(`DROP TRIGGER IF EXISTS trg_catalog_registry_append_only ON catalog_registry_events`);
  await db.query(`
    CREATE TRIGGER trg_catalog_registry_append_only
      BEFORE UPDATE OR DELETE ON catalog_registry_events
      FOR EACH ROW
      EXECUTE PROCEDURE catalog_registry_events_reject_mutation()
  `);

  await db.query(`
    ALTER TABLE sprites
      ADD COLUMN IF NOT EXISTS registry_seq BIGINT,
      ADD COLUMN IF NOT EXISTS registry_hash CHAR(64),
      ADD COLUMN IF NOT EXISTS registry_status VARCHAR(20) NOT NULL DEFAULT 'active';
    ALTER TABLE sprite_variants
      ADD COLUMN IF NOT EXISTS registry_seq BIGINT,
      ADD COLUMN IF NOT EXISTS registry_hash CHAR(64),
      ADD COLUMN IF NOT EXISTS registry_status VARCHAR(20) NOT NULL DEFAULT 'active';
    CREATE INDEX IF NOT EXISTS idx_sprites_registry_status ON sprites (registry_status);
    CREATE INDEX IF NOT EXISTS idx_sprite_variants_registry_status ON sprite_variants (registry_status);
  `);

  // Physical deletes must not erase catalogue identity; archive via registry events.
  await replaceFkRestrict(db, "sprite_variants", "sprite_variants_sprite_id_fkey", "sprite_id", "sprites", "id");
  await replaceFkRestrict(db, "sprite_images", "sprite_images_sprite_id_fkey", "sprite_id", "sprites", "id");
  await replaceFkRestrict(
    db,
    "availability_periods",
    "availability_periods_sprite_id_fkey",
    "sprite_id",
    "sprites",
    "id"
  );
}

async function replaceFkRestrict(db, table, constraintName, column, refTable, refColumn) {
  const exists = await db.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = $1 AND constraint_name = $2 AND constraint_type = 'FOREIGN KEY'`,
    [table, constraintName]
  );
  if (exists.rows.length) {
    await db.query(`ALTER TABLE ${table} DROP CONSTRAINT ${constraintName}`);
  }
  const tableExists = await db.query(`SELECT to_regclass($1) AS reg`, [table]);
  if (!tableExists.rows[0]?.reg) return;
  await db.query(`
    ALTER TABLE ${table}
      ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (${column}) REFERENCES ${refTable}(${refColumn}) ON DELETE RESTRICT
  `);
}

module.exports = { ensureCatalogRegistrySchema };
