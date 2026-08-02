"use strict";

const pushService = require("../../push-service");
const { pool } = require("../db");
const { broadcastNewsUpdate } = require("../ws");

async function persistNewsInInbox(items, { markRead = false } = {}) {
  let created = 0;
  for (const item of items) {
    const newsId = Number(item.newsId);
    if (!Number.isInteger(newsId) || newsId <= 0) continue;
    const entityId = `news:${newsId}`;
    const data = {
      newsId,
      source: String(item.source || "unknown").slice(0, 80),
      newsUrl: String(item.link || "https://fortnite.gg/news").slice(0, 2048),
      image: item.image ? String(item.image).slice(0, 2048) : null
    };
    try {
      const result = await pool.query(
        `INSERT INTO notifications
           (recipient_id, type, category, title, body, entity_type, entity_id, data, status, read_at)
         SELECT u.id, 'news_article', 'news', $1, $2, 'news', $3, $4::jsonb, 'created',
                CASE WHEN $5::boolean THEN NOW() ELSE NULL END
         FROM users u
         WHERE u.deleted_at IS NULL
         ON CONFLICT (recipient_id, entity_id) WHERE type = 'news_article' DO NOTHING`,
        [
          String(item.title || item.description || "SPRITE-INDEX").slice(0, 500),
          String(item.description || item.title || "").slice(0, 500),
          entityId,
          JSON.stringify({
            ...data,
            translationKey: "notifications.news_article",
            translationParams: {
              articleTitle: item.title || null,
              count: 1,
              template: "default"
            }
          }),
          markRead
        ]
      );
      created += result.rowCount || 0;
    } catch (error) {
      console.error(`[NEWS] inbox persistence failed for ${entityId}:`, error.message);
    }
  }
  if (created > 0) {
    console.log(`[NEWS] ${created} notification${created === 1 ? "" : "s"} in-app créée${created === 1 ? "" : "s"}`);
  }
  return created;
}

async function backfillRecentNewsInbox({ limit = 10 } = {}) {
  const count = Math.max(1, Math.min(20, Number(limit) || 10));
  try {
    const result = await pool.query(
      `SELECT id AS "newsId", source, title, description, image, link, news_date AS date
       FROM sprite_news
       ORDER BY news_date DESC NULLS LAST, created_at DESC
       LIMIT $1`,
      [count]
    );
    if (!result.rows.length) return 0;
    return persistNewsInInbox(result.rows, { markRead: true });
  } catch (error) {
    console.error("[NEWS] inbox backfill failed:", error.message);
    return 0;
  }
}

async function notifyNewsSubscribers(items) {
  if (!items.length) return;
  const count = items.length;
  const articleTitle = items[0].title || null;
  const icon = items[0].image || "/icons/icon-192x192.png";
  const url = items[0].link || "/";
  try {
    const notifI18n = require("./notification-i18n");
    const { resolveNotificationLanguage } = require("./i18n");
    const results = await pushService.notifyNewsSubscribersLocalized(pool, {
      icon,
      url,
      render(lang) {
        const locale = resolveNotificationLanguage(lang, null);
        const fallbackArticle = notifI18n.tNotif(
          count > 1 ? "notifications.fallback.articles" : "notifications.fallback.article",
          { count },
          locale
        );
        const rendered = notifI18n.renderTranslatedMessage("news_article", {
          count,
          articleTitle: articleTitle || fallbackArticle
        }, locale);
        return {
          title: (rendered && rendered.title)
            || (locale === "en" ? "New SPRITE-INDEX news" : locale === "nl" ? "Nieuw SPRITE-INDEX-nieuws" : "Nouvelle actu SPRITE-INDEX"),
          body: (rendered && rendered.body) || articleTitle || fallbackArticle || "",
          icon,
          url
        };
      }
    });
    const ok = (results || []).filter(r => r.ok).length;
    console.log(`[PUSH] News notification sent to ${ok}/${(results || []).length} devices`);
  } catch (err) {
    console.error("[PUSH] Failed to send news notification:", err);
  }
}

async function fanoutPublishedNews(row, { notifyPush = true } = {}) {
  if (!row || row.status !== "published") return { inboxNotifications: 0 };
  const item = {
    newsId: row.id,
    source: row.source || "backoffice",
    title: row.title,
    description: row.description,
    image: row.image,
    link: row.link,
    date: row.news_date || row.published_at || new Date().toISOString()
  };
  const inboxNotifications = await persistNewsInInbox([item], { markRead: false });
  if (notifyPush) {
    notifyNewsSubscribers([item]).catch((error) => {
      console.error("[NEWS] admin publish push failed:", error.message);
    });
  }
  broadcastNewsUpdate({
    newItems: [{
      source: item.source,
      title: item.title,
      link: item.link,
      image: item.image,
      date: item.date
    }],
    newCount: 1,
    extractedEvents: [],
    extractedEventCount: 0,
    timestamp: new Date().toISOString()
  });
  return { inboxNotifications };
}

module.exports = { persistNewsInInbox, backfillRecentNewsInbox, notifyNewsSubscribers, fanoutPublishedNews };
