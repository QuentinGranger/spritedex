require("dotenv").config();
const { Pool } = require("pg");

// ─────────────────────────────────────────────────────────────────────────────
// Dedupe duplicate catalog sprites that share the same slug.
//
// Some deployments accumulated two rows per sprite under two id schemes:
//   - short id  (e.g. "water")        → older catalog import, real rarity/effect
//   - "sprite_" (e.g. "sprite_water") → seed / current catalog
//
// This collapses each slug group into the canonical "sprite_"-prefixed id:
//   1. Backfills any unknown/null catalog columns on the canonical row.
//   2. Re-points child rows (variants, images, availability_periods) when the
//      canonical is missing them.
//   3. Migrates user data (sprite_entries, collection_history) from the old
//      base id to the canonical base id, merging duplicates per user.
//   4. Deletes the stale duplicate sprite rows.
//
// Nothing user-owned is deleted without being merged first. Run with:
//   DATABASE_URL="postgres://…"  node scripts/dedupe-sprites.js
//   node scripts/dedupe-sprites.js --dry-run   (report only, no writes)
// ─────────────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes("--dry-run");

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
    })
  : new Pool({ database: "spritedex", host: "localhost", port: 5432 });

const isUnknown = (v) => v === null || v === undefined || v === "" || v === "unknown";

const STATUS_WEIGHT = { owned: 100, spotted: 90, priority: 80, missing: 70, unsure: 60, unavailable: 50, new: 0 };
const PRIORITY_WEIGHT = { urgent: 100, important: 80, medium: 60, low: 40, ignored: 20, none: 0 };
function bestStatus(a, b) { return (STATUS_WEIGHT[a] || 0) >= (STATUS_WEIGHT[b] || 0) ? a : b; }
function bestPriority(a, b) { return (PRIORITY_WEIGHT[a] || 0) >= (PRIORITY_WEIGHT[b] || 0) ? a : b; }
function earliest(a, b) { if (!a) return b; if (!b) return a; return a < b ? a : b; }
function latest(a, b) { if (!a) return b; if (!b) return a; return a > b ? a : b; }

// Rewrite the base part of a "base::variant" collection key.
function rewriteBase(spriteId, oldBase, newBase) {
  const sep = spriteId.indexOf("::");
  const base = sep === -1 ? spriteId : spriteId.slice(0, sep);
  const rest = sep === -1 ? "" : spriteId.slice(sep);
  if (base !== oldBase) return spriteId;
  return `${newBase}${rest}`;
}

async function migrateSpriteEntries(client, oldId, newId) {
  const rows = (await client.query(
    `SELECT * FROM sprite_entries WHERE sprite_id = $1 OR sprite_id LIKE $2`,
    [oldId, `${oldId}::%`]
  )).rows;
  let migrated = 0, merged = 0;
  for (const r of rows) {
    const newSpriteId = rewriteBase(r.sprite_id, oldId, newId);
    if (newSpriteId === r.sprite_id) continue;
    const existing = (await client.query(
      `SELECT * FROM sprite_entries WHERE user_id = $1 AND sprite_id = $2`,
      [r.user_id, newSpriteId]
    )).rows[0];
    if (!existing) {
      if (!DRY_RUN) {
        await client.query(`UPDATE sprite_entries SET sprite_id = $1 WHERE id = $2`, [newSpriteId, r.id]);
      }
      migrated++;
    } else {
      if (!DRY_RUN) {
        await client.query(
          `UPDATE sprite_entries SET status = $1, priority = $2, note = $3, obtained_at = $4, updated_at = $5 WHERE id = $6`,
          [
            bestStatus(existing.status, r.status),
            bestPriority(existing.priority, r.priority),
            [existing.note, r.note].filter(Boolean).join("\n---\n"),
            earliest(existing.obtained_at, r.obtained_at),
            latest(existing.updated_at, r.updated_at),
            existing.id,
          ]
        );
        await client.query(`DELETE FROM sprite_entries WHERE id = $1`, [r.id]);
      }
      merged++;
    }
  }
  return { migrated, merged };
}

async function migrateCollectionHistory(client, oldId, newId) {
  const rows = (await client.query(
    `SELECT id, sprite_id FROM collection_history WHERE sprite_id = $1 OR sprite_id LIKE $2`,
    [oldId, `${oldId}::%`]
  )).rows;
  let migrated = 0;
  for (const r of rows) {
    const newSpriteId = rewriteBase(r.sprite_id, oldId, newId);
    if (newSpriteId === r.sprite_id) continue;
    if (!DRY_RUN) {
      await client.query(`UPDATE collection_history SET sprite_id = $1 WHERE id = $2`, [newSpriteId, r.id]);
    }
    migrated++;
  }
  return migrated;
}

async function tableExists(client, name) {
  const r = await client.query(`SELECT to_regclass($1) AS reg`, [name]);
  return !!r.rows[0].reg;
}

async function backfillCanonical(client, canonical, dup) {
  const sets = [];
  const values = [];
  let i = 1;
  const columns = ["rarity", "effect", "color", "image", "official_name", "season_id", "event_id"];
  for (const col of columns) {
    if (isUnknown(canonical[col]) && !isUnknown(dup[col])) {
      sets.push(`${col} = $${i++}`);
      values.push(dup[col]);
    }
  }
  // Prefer the richer variants array.
  const cv = Array.isArray(canonical.variants) ? canonical.variants : [];
  const dv = Array.isArray(dup.variants) ? dup.variants : [];
  if (dv.length > cv.length) {
    sets.push(`variants = $${i++}`);
    values.push(dv);
  }
  if (sets.length === 0) return [];
  values.push(canonical.id);
  if (!DRY_RUN) {
    await client.query(`UPDATE sprites SET ${sets.join(", ")} WHERE id = $${i}`, values);
  }
  return sets;
}

async function repointChildRows(client, oldId, newId) {
  const actions = {};
  // Migrate variants that the canonical does not already have.
  const childTables = [
    { table: "sprite_variants", uniqueCol: "variant_type" },
    { table: "sprite_images", uniqueCol: "variant" },
    { table: "availability_periods", uniqueCol: null },
  ];
  for (const { table, uniqueCol } of childTables) {
    if (!(await tableExists(client, table))) continue;
    const dupRows = (await client.query(`SELECT * FROM ${table} WHERE sprite_id = $1`, [oldId])).rows;
    let moved = 0, dropped = 0;
    for (const row of dupRows) {
      let clash = false;
      if (uniqueCol) {
        const existing = await client.query(
          `SELECT 1 FROM ${table} WHERE sprite_id = $1 AND ${uniqueCol} = $2`,
          [newId, row[uniqueCol]]
        );
        clash = existing.rowCount > 0;
      }
      if (clash) {
        if (!DRY_RUN) await client.query(`DELETE FROM ${table} WHERE ctid = $1`, [row.ctid]).catch(async () => {
          if (row.id !== undefined) await client.query(`DELETE FROM ${table} WHERE id = $1`, [row.id]);
        });
        dropped++;
      } else {
        if (!DRY_RUN) {
          if (row.id !== undefined) {
            await client.query(`UPDATE ${table} SET sprite_id = $1 WHERE id = $2`, [newId, row.id]);
          } else {
            await client.query(`UPDATE ${table} SET sprite_id = $1 WHERE sprite_id = $2 AND ${uniqueCol} = $3`, [newId, oldId, row[uniqueCol]]);
          }
        }
        moved++;
      }
    }
    actions[table] = { moved, dropped };
  }
  return actions;
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sprites = (await client.query(
      `SELECT id, name, slug, rarity, effect, color, image, official_name, season_id, event_id, variants FROM sprites`
    )).rows;

    // Group by slug (fall back to normalized id).
    const groups = new Map();
    for (const s of sprites) {
      const slug = s.slug || s.id.replace(/^sprite_/, "").replace(/_/g, "-");
      if (!groups.has(slug)) groups.set(slug, []);
      groups.get(slug).push(s);
    }

    let totalDupGroups = 0;
    for (const [slug, group] of groups.entries()) {
      if (group.length < 2) continue;
      totalDupGroups++;
      const canonical = group.find(s => s.id.startsWith("sprite_")) || group[0];
      console.log(`\nSlug "${slug}" → canonical "${canonical.id}" (dups: ${group.filter(s => s !== canonical).map(s => s.id).join(", ")})`);

      for (const dup of group) {
        if (dup.id === canonical.id) continue;

        const filled = await backfillCanonical(client, canonical, dup);
        if (filled.length) console.log(`  backfilled ${canonical.id}: ${filled.join(", ")}`);

        const child = await repointChildRows(client, dup.id, canonical.id);
        console.log(`  child rows:`, JSON.stringify(child));

        const entries = await migrateSpriteEntries(client, dup.id, canonical.id);
        const hist = await migrateCollectionHistory(client, dup.id, canonical.id);
        console.log(`  sprite_entries migrated=${entries.migrated} merged=${entries.merged}, history migrated=${hist}`);

        if (!DRY_RUN) {
          await client.query(`DELETE FROM sprites WHERE id = $1`, [dup.id]);
        }
        console.log(`  deleted stale sprite row "${dup.id}"`);
      }
    }

    if (totalDupGroups === 0) {
      console.log("No duplicate slug groups found. Nothing to do.");
    }

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\nDRY RUN — rolled back, no changes written.");
    } else {
      await client.query("COMMIT");
      console.log(`\nDone. Processed ${totalDupGroups} duplicate group(s).`);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Dedupe failed, rolled back:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
