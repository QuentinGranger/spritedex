"use strict";

async function ensureNotificationColumns(pool) {
  // Add any columns missing on older databases.
  await pool.query(`
      ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'general',
        ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT 'SPRITE-INDEX',
        ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50),
        ADD COLUMN IF NOT EXISTS entity_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'created',
        ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
    `);
}

module.exports = { ensureNotificationColumns };
