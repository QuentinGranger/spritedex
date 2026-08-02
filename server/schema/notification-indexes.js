"use strict";

async function ensureNotificationIndexes(pool) {
    // Indexes: drop legacy (user_*) names and recreate on recipient_id/data.
    await pool.query(`
      DROP INDEX IF EXISTS idx_notifications_user_created;
      DROP INDEX IF EXISTS idx_notifications_context;
      DROP INDEX IF EXISTS idx_notifications_unread;
      DROP INDEX IF EXISTS idx_notifications_pending;
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications (recipient_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (recipient_id, read_at NULLS FIRST)
        WHERE archived_at IS NULL AND hidden_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_notifications_data ON notifications USING GIN (data);
      CREATE INDEX IF NOT EXISTS idx_notifications_pending ON notifications (created_at) WHERE status IN ('created', 'queued');
      -- News are global but each reader must receive an inbox item only once.
      -- The partial key makes refresh retries and concurrent workers harmless.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_news_article_recipient
        ON notifications (recipient_id, entity_id)
        WHERE type = 'news_article';
    `);
}

module.exports = { ensureNotificationIndexes };
