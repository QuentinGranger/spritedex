require("dotenv").config();
const { Pool } = require("pg");

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

(async () => {
  try {
    const sprites = await pool.query(`SELECT id, name, official_name FROM sprites ORDER BY name`);
    console.log("sprites:", sprites.rows.map((r) => [r.id, r.name]));

    const variants = await pool.query(`SELECT id, sprite_id, variant_type FROM sprite_variants ORDER BY sprite_id, variant_type`);
    const variantGroups = {};
    for (const r of variants.rows) {
      const key = `${r.sprite_id}::${r.variant_type.toLowerCase()}`;
      variantGroups[key] = (variantGroups[key] || 0) + 1;
    }
    const duplicateVariants = Object.entries(variantGroups).filter(([k, v]) => v > 1);
    console.log("duplicate variants:", duplicateVariants);

    // Simulate getAllItems
    const items = [];
    for (const s of sprites.rows) {
      const vRows = variants.rows.filter((v) => v.sprite_id === s.id);
      for (const v of vRows) {
        items.push({ id: `${s.id}::${v.variant_type}`, spriteId: s.id, variant: v.variant_type, name: s.name });
      }
    }
    const seen = new Set();
    const dupItemIds = [];
    for (const item of items) {
      if (seen.has(item.id)) dupItemIds.push(item.id);
      else seen.add(item.id);
    }
    console.log("duplicate item ids in getAllItems:", [...new Set(dupItemIds)]);
    console.log("total items:", items.length);

    // Count distinct sprites and variants
    console.log("total sprites:", sprites.rows.length, "total variant rows:", variants.rows.length);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
