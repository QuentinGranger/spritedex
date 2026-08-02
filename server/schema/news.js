"use strict";

async function ensureNewsSchema(pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sprite_news (
        id SERIAL PRIMARY KEY,
        hash VARCHAR(32) UNIQUE NOT NULL,
        source VARCHAR(30) NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        image TEXT,
        link TEXT,
        news_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
}

module.exports = { ensureNewsSchema };
