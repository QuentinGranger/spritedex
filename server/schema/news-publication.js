"use strict";

async function ensureNewsPublicationSchema(pool) {
    // Imported news remains visible by default. Drafts created in the
    // backoffice are intentionally excluded from the public feed until an
    // operator explicitly publishes them.
    await pool.query(`
      ALTER TABLE sprite_news
        ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published',
        ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS editor_note TEXT;
      UPDATE sprite_news
      SET status = 'published',
          published_at = COALESCE(published_at, created_at)
      WHERE status IS NULL OR status NOT IN ('draft', 'published', 'archived');
      UPDATE sprite_news
      SET published_at = COALESCE(published_at, created_at)
      WHERE status = 'published';
      CREATE INDEX IF NOT EXISTS idx_sprite_news_status_date
        ON sprite_news (status, news_date DESC, created_at DESC);
    `);
}

module.exports = { ensureNewsPublicationSchema };
