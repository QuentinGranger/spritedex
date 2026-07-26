// CLI seeder: populates the reference data (sprites, variants, images).
// Works against local dev (host=localhost) or any cloud DB via DATABASE_URL.
// Usage: npm run seed   (set DATABASE_URL to target a remote database)

const { Pool } = require("pg");
const { seedReferenceData } = require("./sprite-data");
const { databasePoolConfig } = require("./server/db");

const pool = process.env.DATABASE_URL
  ? new Pool(databasePoolConfig(process.env.DATABASE_URL))
  : new Pool({ database: "sprite-index", host: "localhost", port: 5432 });

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
