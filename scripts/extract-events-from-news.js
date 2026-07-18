// One-time backfill: extract events from existing sprite_news and insert into events.
// Also links explicitly mentioned sprites to the event when safe.

const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  database: process.env.PGDATABASE || "spritedex",
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const EVENT_PATTERNS = [
  { regex: /mastery monday|lundi de la maîtrise/i, type: "weekly_event", name: "Mastery Monday" },
  { regex: /holofoil hours/i, type: "weekly_event", name: "Holofoil Hours" },
  { regex: /gold\s*(?:&\s*gummy|\s*hours|fish)|gummy\s*hours|mythic goldfish/i, type: "weekly_event", name: "Gold & Gummy Hours" },
  { regex: /galaxy hours/i, type: "weekly_event", name: "Galaxy Hours" },
  { regex: /catch up day|catch up/i, type: "catch_up_event", name: "Catch Up Day" },
  { regex: /gone wild/i, type: "seasonal_event", name: "Gone Wild" },
  { regex: /summer hits|summer adventure|fun in the sun/i, type: "seasonal_event", name: "Summer Event" },
];

function detectEventInfo(text) {
  const normalized = (text || "").toLowerCase();
  for (const pattern of EVENT_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return { type: pattern.type, name: pattern.name };
    }
  }
  const newSpriteMatch = text.match(/new sprites?[:—]\s*(.+)/i);
  if (newSpriteMatch) {
    return { type: "content_update", name: `New Sprites: ${newSpriteMatch[1].trim().slice(0, 60)}` };
  }
  return null;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const newsRes = await client.query(
      "SELECT source, title, description, news_date AS date FROM sprite_news ORDER BY news_date DESC LIMIT 500"
    );
    const spritesRes = await client.query("SELECT id, name FROM sprites");
    const seasonRes = await client.query("SELECT id FROM seasons ORDER BY start_date DESC NULLS LAST LIMIT 1");
    const fallbackSeasonId = seasonRes.rows[0]?.id || null;

    const insertedEventIds = new Set();
    let linkedSprites = 0;

    for (const item of newsRes.rows) {
      const text = `${item.title || ""} ${item.description || ""}`;
      const eventInfo = detectEventInfo(text);
      if (!eventInfo) continue;

      const eventId = "event_" + crypto.createHash("md5").update(`${eventInfo.name}|${item.date || ""}|${item.source}`).digest("hex").slice(0, 16);
      if (insertedEventIds.has(eventId)) continue;
      insertedEventIds.add(eventId);

      await client.query(
        `INSERT INTO events (id, name, type, season_id, start_date, end_date, data_status, sources)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, type = $3, season_id = $4, start_date = $5::timestamptz, end_date = $6, data_status = $7, sources = $8`,
        [
          eventId,
          eventInfo.name,
          eventInfo.type,
          fallbackSeasonId,
          item.date || null,
          null,
          "observed",
          JSON.stringify([item.source]),
        ]
      );

      if (["content_update", "catch_up_event", "seasonal_event"].includes(eventInfo.type)) {
        const normalizedText = text.toLowerCase();
        for (const sprite of spritesRes.rows) {
          if (!sprite.name) continue;
          const spriteNameLower = sprite.name.toLowerCase();
          const shortName = spriteNameLower.replace(" sprite", "").trim();
          if (normalizedText.includes(spriteNameLower) || (shortName.length > 2 && normalizedText.includes(shortName))) {
            const updateRes = await client.query(
              `UPDATE sprites SET event_id = $1 WHERE id = $2 AND event_id IS NULL RETURNING id`,
              [eventId, sprite.id]
            );
            if (updateRes.rowCount > 0) linkedSprites++;
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log(`[BACKFILL] ${insertedEventIds.size} events extracted, ${linkedSprites} sprites linked.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[BACKFILL] failed:", err);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

main();
