"use strict";

const { pool } = require("../db");
const { ensureSource } = require("../catalog");
const { broadcastNewsUpdate } = require("../ws");
const {
  fetchFortniteAPINews,
  fetchFortniteAPINewsEN,
  fetchFortniteGGNews,
  fetchFortniteSTWNews
} = require("./sources");
const { extractEventsFromNews } = require("./events");
const { extractAvailabilityFromNews, extractRecurrenceFromNews } = require("./catalog");
const { persistNewsInInbox, backfillRecentNewsInbox, notifyNewsSubscribers } = require("./delivery");

async function refreshNews() {
  const [frNews, enNews, stwNews, ggNews] = await Promise.all([
    fetchFortniteAPINews(),
    fetchFortniteAPINewsEN(),
    fetchFortniteSTWNews(),
    fetchFortniteGGNews()
  ]);
  const all = [...frNews, ...enNews, ...stwNews, ...ggNews];
  const insertedItems = [];
  for (const item of all) {
    try {
      const result = await pool.query(
        `INSERT INTO sprite_news (hash, source, title, description, image, link, news_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hash) DO NOTHING
         RETURNING id`,
        [item.hash, item.source, item.title, item.description.slice(0, 500), item.image, item.link, item.date]
      );
      if (result.rows.length > 0) {
        insertedItems.push({ ...item, newsId: result.rows[0].id });
      } else if (item.image) {
        // Backfill scraped art onto older rows that were stored without an image.
        await pool.query(
          `UPDATE sprite_news
           SET image = $1
           WHERE hash = $2 AND (image IS NULL OR image = '')`,
          [item.image, item.hash]
        );
      }
    } catch (err) {
      // duplicate or error, skip
    }
  }
  if (insertedItems.length > 0) {
    console.log(`News: ${insertedItems.length} new items inserted`);
    await persistNewsInInbox(insertedItems);
    notifyNewsSubscribers(insertedItems);
  }

  // Mirror scraped thumbnails onto existing inbox rows that were stored without art.
  try {
    await pool.query(
      `UPDATE notifications n
       SET data = jsonb_set(COALESCE(n.data, '{}'::jsonb), '{image}', to_jsonb(sn.image), true)
       FROM sprite_news sn
       WHERE n.type = 'news_article'
         AND n.entity_id = ('news:' || sn.id::text)
         AND sn.image IS NOT NULL AND sn.image <> ''
         AND COALESCE(n.data->>'image', '') = ''`
    );
  } catch (err) {
    console.warn("[NEWS] notification image backfill skipped:", err.message);
  }

  // Existing items are restored after deployment as already read: users get a
  // useful feed without an unexpected unread badge or external push burst.
  await backfillRecentNewsInbox();

  // Extract events, availability and recurrence from scraped news (existing + newly inserted)
  const existingNews = await pool.query(
    "SELECT source, title, description, image, link, news_date AS date FROM sprite_news ORDER BY news_date DESC LIMIT 500"
  );
  for (const item of existingNews.rows) {
    await ensureSource(item.source, {
      title: item.title,
      url: item.link,
      publishedAt: item.date
    });
  }
  const eventExtraction = await extractEventsFromNews(existingNews.rows);
  await extractAvailabilityFromNews(existingNews.rows);
  await extractRecurrenceFromNews(existingNews.rows);

  // Étape 75 — catalogue growth → bump totals + queue passport recalcs.
  try {
    await require("./passport-summary").syncCatalogueMetaAndFanout();
  } catch (err) {
    console.error("[NEWS] passport catalogue fanout failed:", err.message);
  }

  broadcastNewsUpdate({
    newItems: insertedItems
      .map((i) => ({ source: i.source, title: i.title, link: i.link, image: i.image, date: i.date }))
      .slice(0, 5),
    newCount: insertedItems.length,
    extractedEvents: eventExtraction.eventIds.slice(0, 5),
    extractedEventCount: eventExtraction.count,
    timestamp: new Date().toISOString()
  });
}

module.exports = { refreshNews };
