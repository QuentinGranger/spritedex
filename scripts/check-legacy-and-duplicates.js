require("dotenv").config();
const { Pool } = require("pg");
const path = require("path");

function shouldUseSSL(url) {
  if (!url) return false;
  const hostname = new URL(url).hostname;
  return (
    url.includes("sslmode=require") ||
    url.includes("ssl=true") ||
    (!hostname.includes("localhost") && !hostname.endsWith(".local"))
  );
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
    })
  : new Pool({ database: "spritedex", host: "localhost", port: 5432, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });

const timeout = setTimeout(() => {
  console.error("[TIMEOUT] Database query took too long; exiting.");
  process.exit(1);
}, 10000);

(async () => {
  try {
    // basic connectivity
    const [{ now }] = (await pool.query("SELECT NOW() as now")).rows;
    console.log("Connected:", now);

    for (const table of ["sprite_entries", "collection_history", "squad_activity"]) {
      const r = await pool.query(
        `SELECT sprite_id, COUNT(*) as c FROM ${table} GROUP BY sprite_id ORDER BY c DESC, sprite_id LIMIT 50`
      );
      console.log(`\n[${table}] ${r.rowCount} distinct sprite_id (top 50):`);
      r.rows.forEach((row) => console.log(" ", row.c, row.sprite_id));

      const legacy = await pool.query(
        `SELECT DISTINCT sprite_id FROM ${table} WHERE sprite_id NOT LIKE 'sprite_%' LIMIT 50`
      );
      if (legacy.rowCount > 0) {
        console.log(`[${table}] legacy ids:`, legacy.rows.map((r) => r.sprite_id));
      }
    }

    const dupSprites = await pool.query(`
      SELECT LOWER(name) as name_key, array_agg(id ORDER BY id) as ids, count(*) as c
      FROM sprites
      GROUP BY LOWER(name)
      HAVING count(*) > 1
      ORDER BY c DESC, name_key
      LIMIT 50
    `);
    console.log("\n[Duplicate sprites by name]", dupSprites.rowCount);
    dupSprites.rows.forEach((r) => console.log(" ", r.name_key, r.ids));

    const dupOfficial = await pool.query(`
      SELECT LOWER(official_name) as name_key, array_agg(id ORDER BY id) as ids, count(*) as c
      FROM sprites
      WHERE official_name IS NOT NULL AND official_name <> ''
      GROUP BY LOWER(official_name)
      HAVING count(*) > 1
      ORDER BY c DESC, name_key
      LIMIT 50
    `);
    console.log("\n[Duplicate sprites by official_name]", dupOfficial.rowCount);
    dupOfficial.rows.forEach((r) => console.log(" ", r.name_key, r.ids));

    const dupVariants = await pool.query(`
      SELECT sprite_id, LOWER(variant_type) as variant, array_agg(id ORDER BY id) as ids, count(*) as c
      FROM sprite_variants
      GROUP BY sprite_id, LOWER(variant_type)
      HAVING count(*) > 1
      LIMIT 50
    `);
    console.log("\n[Duplicate variants by sprite_id/variant_type]", dupVariants.rowCount);
    dupVariants.rows.forEach((r) => console.log(" ", r.sprite_id, r.variant, r.ids));

    console.log("\nDone.");
  } catch (err) {
    console.error("[ERROR]", err.message);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    await pool.end();
  }
})();
