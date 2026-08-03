"use strict";

const { app } = require("../core");
const { pool } = require("../db");

app.get("/api/news", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const result = await pool.query(
      `SELECT id, source, title, description, image, link, news_date, created_at
       FROM sprite_news
       WHERE status = 'published'
       ORDER BY news_date DESC, created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query(`SELECT COUNT(*) FROM sprite_news WHERE status = 'published'`);
    const total = parseInt(countResult.rows[0].count);
    res.json({ news: result.rows, total, hasMore: offset + result.rows.length < total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = {};
