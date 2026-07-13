// CLI seeder: populates the reference data (sprites, variants, images).
// Works against local dev (host=localhost) or any cloud DB via DATABASE_URL.
// Usage: npm run seed   (set DATABASE_URL to target a remote database)

const { Pool } = require("pg");
const { seedReferenceData } = require("./sprite-data");

function useSSL(url) {
  if (!url) return false;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  if (process.env.PGSSL === "disable") return false;
  return true;
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false
    })
  : new Pool({ database: "spritedex", host: "localhost", port: 5432 });

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const counts = await seedReferenceData(client);
    await client.query("COMMIT");
    console.log(`✓ ${counts.variants} variant_meta rows`);
    console.log(`✓ ${counts.sprites} sprites rows`);
    console.log(`✓ ${counts.images} sprite_images rows`);
    console.log("\n✅ Seed complete!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
