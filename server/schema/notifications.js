"use strict";

async function ensureNotificationTableSchema(pool) {
    // ── Notifications (contextual notifications feature) ──
    // Every notification is persisted here before any push/email dispatch, so it
    // also acts as the in-app inbox and an outbox for delivery workers.
    // NOTE: the reference spec uses UUID ids, but SPRITE-INDEX users.id is an INTEGER
    // SERIAL and variant ids are strings, so we keep SERIAL/INTEGER keys and a
    // VARCHAR entity_id (a variant/squad/event/invitation id) rather than UUID.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(80) NOT NULL,
        category VARCHAR(30) NOT NULL DEFAULT 'general',
        title TEXT NOT NULL DEFAULT 'SPRITE-INDEX',
        body TEXT NOT NULL DEFAULT '',
        entity_type VARCHAR(50),
        entity_id VARCHAR(100),
        data JSONB NOT NULL DEFAULT '{}',
        status VARCHAR(30) NOT NULL DEFAULT 'created',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        clicked_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ
      );
    `);
}

module.exports = { ensureNotificationTableSchema };
