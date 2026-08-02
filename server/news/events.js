"use strict";

const crypto = require("crypto");
const { pool } = require("../db");
const { invalidateSquadAnalysisCache } = require("../squad-analysis-cache");
const { detectEventInfo, estimateEventEndDate } = require("./parsing");

async function extractEventsFromNews(newsItems) {
  const spritesRes = await pool.query("SELECT id, name FROM sprites");
  const sprites = spritesRes.rows;
  const seasonRes = await pool.query("SELECT id FROM seasons ORDER BY start_date DESC NULLS LAST LIMIT 1");
  const fallbackSeasonId = seasonRes.rows[0]?.id || null;

  const insertedEventIds = new Set();
  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const eventInfo = detectEventInfo(text);
    if (!eventInfo) continue;

    const eventId = "event_" + crypto.createHash("md5").update(`${eventInfo.name}|${item.date || ""}|${item.source}`).digest("hex").slice(0, 16);
    if (insertedEventIds.has(eventId)) continue;
    insertedEventIds.add(eventId);

    const startDate = item.date || new Date().toISOString();
    const endDate = estimateEventEndDate(eventInfo, startDate, text);

    try {
      await pool.query(
        `INSERT INTO events (id, name, type, season_id, start_date, end_date, data_status, sources)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, type = $3, season_id = $4, start_date = COALESCE($5::timestamptz, events.start_date), end_date = COALESCE($6, events.end_date), data_status = $7, sources = $8`,
        [
          eventId,
          eventInfo.name,
          eventInfo.type,
          fallbackSeasonId,
          startDate,
          endDate,
          "observed",
          JSON.stringify([item.source]),
        ]
      );
    } catch (err) {
      console.error("[EVENTS] failed to insert event", eventId, err.message);
      continue;
    }

    // Link explicitly mentioned sprites to this event (only if they have no event yet)
    if (["content_update", "catch_up_event", "seasonal_event"].includes(eventInfo.type)) {
      const normalizedText = text.toLowerCase();
      for (const sprite of sprites) {
        if (!sprite.name) continue;
        const spriteNameLower = sprite.name.toLowerCase();
        const shortName = spriteNameLower.replace(" sprite", "").trim();
        if (normalizedText.includes(spriteNameLower) || (shortName.length > 2 && normalizedText.includes(shortName))) {
          await pool.query(
            `UPDATE sprites SET event_id = $1 WHERE id = $2 AND event_id IS NULL`,
            [eventId, sprite.id]
          ).catch(() => {});
        }
      }
    }
  }

  if (insertedEventIds.size > 0) {
    console.log(`[EVENTS] ${insertedEventIds.size} events extracted from news`);
    invalidateSquadAnalysisCache();
  }
  return { count: insertedEventIds.size, eventIds: Array.from(insertedEventIds) };
}

module.exports = { extractEventsFromNews };
