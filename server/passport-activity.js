"use strict";

// Étapes 31–34 — curated passport recent activity (allowlisted, grouped, TTL).
const { pool } = require("./db");

const ACTIVITY_RETENTION_DAYS = 90;
const ACTIVITY_FEED_LIMIT = 10;
const OWNED_GROUP_WINDOW_MINUTES = 10;

const ALLOWED_ACTIVITY_TYPES = Object.freeze([
  "variants_owned",
  "badge_unlocked",
  "event_completed",
  "squad_joined",
  "squad_created",
  "collective_goal_completed",
  "completion_milestone"
]);

const ALLOWED_VISIBILITY = Object.freeze(["private", "friends", "squad", "public"]);

async function ensurePassportActivityTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS passport_activity (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_type VARCHAR(80) NOT NULL,
      entity_type VARCHAR(50),
      entity_id VARCHAR(120),
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      visibility VARCHAR(30) NOT NULL DEFAULT 'friends',
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      CHECK (activity_type IN (
        'variants_owned',
        'badge_unlocked',
        'event_completed',
        'squad_joined',
        'squad_created',
        'collective_goal_completed',
        'completion_milestone'
      )),
      CHECK (visibility IN ('private', 'friends', 'squad', 'public'))
    );
    CREATE INDEX IF NOT EXISTS idx_passport_activity_user_time
      ON passport_activity (user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_passport_activity_expires
      ON passport_activity (expires_at)
      WHERE expires_at IS NOT NULL;
  `);
}

function defaultExpiresAt() {
  return new Date(Date.now() + ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Write one allowlisted activity row. Returns null for disallowed types.
 */
async function writeActivity({
  userId,
  activityType,
  entityType = null,
  entityId = null,
  data = {},
  visibility = "friends",
  occurredAt = null,
  expiresAt = null,
  db = pool
} = {}) {
  if (!ALLOWED_ACTIVITY_TYPES.includes(activityType)) return null;
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const vis = ALLOWED_VISIBILITY.includes(visibility) ? visibility : "friends";
  const expires = expiresAt || defaultExpiresAt();
  const result = await db.query(
    `INSERT INTO passport_activity
       (user_id, activity_type, entity_type, entity_id, data, visibility, occurred_at, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE($7::timestamptz, NOW()), $8)
     RETURNING *`,
    [
      id,
      activityType,
      entityType,
      entityId == null ? null : String(entityId).slice(0, 120),
      JSON.stringify(data || {}),
      vis,
      occurredAt,
      expires
    ]
  );
  return result.rows[0] || null;
}

/**
 * Étape 34 — fold owned gains into one activity within a 10-minute window.
 * Pass many variantIds at once for sync/import (single line).
 */
async function recordOwnedVariants(userId, variantIds, extra = {}, db = pool) {
  const ids = [...new Set((variantIds || []).map(String).filter(Boolean))];
  if (!ids.length) return null;

  const existing = await db.query(
    `SELECT id, data FROM passport_activity
     WHERE user_id = $1
       AND activity_type = 'variants_owned'
       AND occurred_at > NOW() - ($2::int * INTERVAL '1 minute')
     ORDER BY occurred_at DESC
     LIMIT 1`,
    [userId, OWNED_GROUP_WINDOW_MINUTES]
  );

  if (existing.rows.length) {
    const prev = existing.rows[0].data || {};
    const prevIds = Array.isArray(prev.variantIds) ? prev.variantIds.map(String) : [];
    const merged = [...new Set([...prevIds, ...ids])].slice(0, 200);
    const count = merged.length;
    const data = {
      ...prev,
      ...extra,
      count,
      variantIds: merged,
      lastVariantId: ids[ids.length - 1]
    };
    const updated = await db.query(
      `UPDATE passport_activity
       SET data = $2::jsonb,
           occurred_at = NOW(),
           expires_at = $3,
           entity_id = $4
       WHERE id = $1
       RETURNING *`,
      [existing.rows[0].id, JSON.stringify(data), defaultExpiresAt(), ids[ids.length - 1]]
    );
    return updated.rows[0] || null;
  }

  return writeActivity({
    userId,
    activityType: "variants_owned",
    entityType: "variant",
    entityId: ids[0],
    data: {
      count: ids.length,
      variantIds: ids.slice(0, 200),
      lastVariantId: ids[ids.length - 1],
      ...extra
    },
    visibility: extra.visibility || "friends",
    db
  });
}

async function listRecentActivity(userId, { limit = ACTIVITY_FEED_LIMIT, db = pool } = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id < 1) return [];
  const result = await db.query(
    `SELECT id, activity_type, entity_type, entity_id, data, visibility, occurred_at, expires_at
     FROM passport_activity
     WHERE user_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       AND occurred_at > NOW() - ($2::int * INTERVAL '1 day')
     ORDER BY occurred_at DESC
     LIMIT $3`,
    [id, ACTIVITY_RETENTION_DAYS, Math.max(1, Math.min(50, limit))]
  );
  return result.rows.map((row) => ({
    id: row.id,
    type: row.activity_type,
    activityType: row.activity_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    data: row.data || {},
    visibility: row.visibility,
    createdAt: row.occurred_at,
    occurredAt: row.occurred_at
  }));
}

async function purgeExpiredActivity(db = pool) {
  await db.query(
    `DELETE FROM passport_activity
     WHERE (expires_at IS NOT NULL AND expires_at < NOW())
        OR occurred_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [ACTIVITY_RETENTION_DAYS]
  );
}

module.exports = {
  ACTIVITY_RETENTION_DAYS,
  ACTIVITY_FEED_LIMIT,
  OWNED_GROUP_WINDOW_MINUTES,
  ALLOWED_ACTIVITY_TYPES,
  ensurePassportActivityTable,
  writeActivity,
  recordOwnedVariants,
  listRecentActivity,
  purgeExpiredActivity,
  defaultExpiresAt
};
