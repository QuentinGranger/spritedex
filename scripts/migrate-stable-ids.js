require("dotenv").config();
const { Pool } = require("pg");

function shouldUseSSL(url) {
  if (!url) return false;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  if (process.env.PGSSL === "disable") return false;
  return true;
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
    })
  : new Pool({ database: "spritedex", host: "localhost", port: 5432 });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Build mapping from short slug to stable catalog_id
    const spritesRes = await client.query(`
      SELECT id AS short_id, catalog_id FROM sprites WHERE catalog_id IS NOT NULL
    `);
    const mapping = {};
    for (const row of spritesRes.rows) {
      mapping[row.short_id] = row.catalog_id;
    }
    console.log(`[MIGRATE] Mapping ${Object.keys(mapping).length} sprites to stable IDs`);

    // 2. Drop FK constraints to allow updating primary key
    await client.query(`ALTER TABLE sprite_images DROP CONSTRAINT IF EXISTS sprite_images_sprite_id_fkey`);
    await client.query(`ALTER TABLE sprite_variants DROP CONSTRAINT IF EXISTS sprite_variants_sprite_id_fkey`);

    // 3. Update sprites primary key: move short id to slug, use catalog_id as new id
    await client.query(`
      UPDATE sprites
      SET slug = id, id = catalog_id
      WHERE catalog_id IS NOT NULL AND id <> catalog_id
    `);

    // 4. Update sprite_images sprite_id using mapping
    for (const [shortId, stableId] of Object.entries(mapping)) {
      await client.query(
        `UPDATE sprite_images SET sprite_id = $1 WHERE sprite_id = $2`,
        [stableId, shortId]
      );
    }

    // 5. Update sprite_variants sprite_id using mapping
    for (const [shortId, stableId] of Object.entries(mapping)) {
      await client.query(
        `UPDATE sprite_variants SET sprite_id = $1 WHERE sprite_id = $2`,
        [stableId, shortId]
      );
    }

    // 6. Re-add FK constraints
    await client.query(`
      ALTER TABLE sprite_images
      ADD CONSTRAINT sprite_images_sprite_id_fkey
      FOREIGN KEY (sprite_id) REFERENCES sprites(id) ON DELETE CASCADE
    `);
    await client.query(`
      ALTER TABLE sprite_variants
      ADD CONSTRAINT sprite_variants_sprite_id_fkey
      FOREIGN KEY (sprite_id) REFERENCES sprites(id) ON DELETE CASCADE
    `);

    // 7. Update collection entry IDs from shortId::Variant to stableId::Variant
    for (const [shortId, stableId] of Object.entries(mapping)) {
      await client.query(
        `UPDATE sprite_entries SET sprite_id = $1 || '::' || split_part(sprite_id, '::', 2)
         WHERE split_part(sprite_id, '::', 1) = $2`,
        [stableId, shortId]
      );
      await client.query(
        `UPDATE collection_history SET sprite_id = $1 || '::' || split_part(sprite_id, '::', 2)
         WHERE split_part(sprite_id, '::', 1) = $2`,
        [stableId, shortId]
      );
      await client.query(
        `UPDATE squad_activity SET sprite_id = $1 || '::' || split_part(sprite_id, '::', 2)
         WHERE split_part(sprite_id, '::', 1) = $2`,
        [stableId, shortId]
      );
    }

    await client.query("COMMIT");
    console.log("[MIGRATE] Stable IDs migration completed successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[MIGRATE] Migration failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

(async () => {
  try {
    await migrate();
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
