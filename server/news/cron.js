"use strict";

const { pool } = require("../db");
const { refreshNews } = require("./refresh");

let newsInterval = null;
async function startNewsCron() {
  await pool
    .query(
      `UPDATE sprite_news SET link = 'https://fortnite.com/news?lang=fr' WHERE (link IS NULL OR link = 'https://www.fortnite.com/news') AND source LIKE 'fortnite-api%'`
    )
    .catch(() => {});
  await pool
    .query(`UPDATE sprite_news SET link = 'https://fortnite.gg/news' WHERE link IS NULL AND source = 'fortnite.gg'`)
    .catch(() => {});
  refreshNews().catch((err) => console.error("[NEWS] initial refresh failed:", err.message));
  newsInterval = setInterval(
    () => refreshNews().catch((err) => console.error("[NEWS] cron refresh failed:", err.message)),
    30 * 60 * 1000
  );
}

function getNewsInterval() {
  return newsInterval;
}

module.exports = { startNewsCron, getNewsInterval };
