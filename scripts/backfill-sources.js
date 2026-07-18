// One-time backfill: ensure every source ID referenced in existing tables
// has a matching row in sprite_sources, with inferred type/reliability.

require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  database: process.env.PGDATABASE || "spritedex",
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

function inferSourceType(sourceId) {
  const s = (sourceId || "").toLowerCase();
  if (s.includes("official") || s.includes("epic") || s.includes("fortnite.com") || s.includes("fortnite-api")) return "official";
  if (s.includes("in_game") || s.includes("observed")) return "in_game";
  if (s.includes("creator") || s.includes("youtuber") || s.includes("streamer")) return "creator";
  if (s.includes("community") || s.includes("discord") || s.includes("reddit")) return "community";
  if (s.includes("gg") || s.includes("database") || s.includes("wiki")) return "database";
  return "unknown";
}

function inferSourceReliability(type) {
  if (type === "official") return "primary";
  if (type === "in_game") return "primary";
  if (type === "creator") return "secondary";
  if (type === "community") return "secondary";
  if (type === "database") return "tertiary";
  return "unknown";
}

async function main() {
  const client = await pool.connect();
  try {
    const ids = new Set();

    const tables = [
      { table: "sprite_news", column: "source" },
      { table: "sprites", column: "sources" },
      { table: "sprite_variants", column: "sources" },
      { table: "availability_periods", column: "sources" },
      { table: "events", column: "sources" },
    ];

    for (const { table, column } of tables) {
      const res = await client.query(`SELECT ${column} FROM ${table} WHERE ${column} IS NOT NULL`);
      for (const row of res.rows) {
        let values = row[column];
        if (typeof values === "string") {
          try { values = JSON.parse(values); } catch { values = [values]; }
        }
        if (Array.isArray(values)) {
          for (const id of values) if (id) ids.add(id);
        } else if (values) {
          ids.add(values);
        }
      }
    }

    let inserted = 0;
    for (const sourceId of ids) {
      const type = inferSourceType(sourceId);
      const reliability = inferSourceReliability(type);
      const res = await client.query(
        `INSERT INTO sprite_sources (id, type, publisher, title, url, reliability, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [sourceId, type, null, sourceId, null, reliability]
      );
      if (res.rowCount > 0) inserted++;
    }

    console.log(`[BACKFILL] ${inserted} source(s) inserted, ${ids.size} total referenced.`);
  } finally {
    client.release();
    pool.end();
  }
}

main();
