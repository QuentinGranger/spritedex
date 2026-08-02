"use strict";

const pushSubscriptions = require("../../../../../server/push-subscriptions");

async function ensurePushTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      platform VARCHAR(20) NOT NULL DEFAULT 'web',
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, token)
    );
    CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);
  `);
  await pushSubscriptions.ensurePushSubscriptionsTable(pool);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_new_sprites BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_new_variants BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_squad_activity BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS push_pref_session_summary BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_goals BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_sync BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS push_pref_news BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS push_pref_friend_collection_updates BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS push_pref_friend_priority_matches BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS push_quiet_start SMALLINT,
      ADD COLUMN IF NOT EXISTS push_quiet_end SMALLINT,
      ADD COLUMN IF NOT EXISTS push_max_per_day INTEGER NOT NULL DEFAULT 8,
      ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Paris',
      ADD COLUMN IF NOT EXISTS push_reactivation_needed BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  // Étape 52 — safety default is 8/day (migrate the previous schema default of 20).
  await pool
    .query(
      `
    ALTER TABLE users ALTER COLUMN push_max_per_day SET DEFAULT 8
  `
    )
    .catch(() => {});
  await pool
    .query(
      `
    UPDATE users SET push_max_per_day = 8 WHERE push_max_per_day = 20
  `
    )
    .catch(() => {});
}

async function registerToken(pool, userId, token, platform = "web", extras = {}) {
  return pushSubscriptions.registerSubscription(pool, userId, {
    platform,
    token,
    ...extras
  });
}

async function unregisterToken(pool, userId, token) {
  await pushSubscriptions.unregisterSubscription(pool, userId, { token, endpoint: token });
  // Legacy cleanup.
  await pool.query("DELETE FROM push_tokens WHERE user_id = $1 AND token = $2", [userId, token]).catch(() => {});
}

async function unregisterAllTokens(pool, userId) {
  await pushSubscriptions.unregisterAllSubscriptions(pool, userId);
  await pool.query("DELETE FROM push_tokens WHERE user_id = $1", [userId]).catch(() => {});
}

async function getEnabledTokensForUser(pool, userId) {
  const rows = await pushSubscriptions.getActiveSubscriptionsForUser(pool, userId);
  return rows.map(pushSubscriptions.toDispatchTarget).filter(Boolean);
}

async function getNewsSubscriberTokens(pool) {
  await pushSubscriptions.ensurePushSubscriptionsTable(pool);
  const result = await pool.query(
    `SELECT ps.id, ps.user_id, ps.platform, ps.endpoint, ps.token,
            ps.public_key, ps.auth_secret
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.is_active = TRUE
       AND u.push_enabled = TRUE
       AND u.push_pref_news = TRUE
       AND u.deleted_at IS NULL`
  );
  return result.rows
    .map((row) => {
      const target = pushSubscriptions.toDispatchTarget(row);
      return target ? { ...target, user_id: row.user_id } : null;
    })
    .filter(Boolean);
}

async function getSquadMemberTokens(pool, squadId, excludeUserId) {
  await pushSubscriptions.ensurePushSubscriptionsTable(pool);
  const result = await pool.query(
    `SELECT ps.id, ps.user_id, ps.platform, ps.endpoint, ps.token,
            ps.public_key, ps.auth_secret, u.push_pref_squad_activity
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     JOIN squad_members sm ON sm.user_id = u.id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND ps.is_active = TRUE
       AND u.push_enabled = TRUE
       AND u.push_pref_squad_activity = TRUE
       AND u.deleted_at IS NULL
       AND u.id <> $2`,
    [squadId, excludeUserId]
  );
  return result.rows
    .map((row) => {
      const target = pushSubscriptions.toDispatchTarget(row);
      return target ? { ...target, push_pref_squad_activity: row.push_pref_squad_activity } : null;
    })
    .filter(Boolean);
}

module.exports = {
  ensurePushTables,
  registerToken,
  unregisterToken,
  unregisterAllTokens,
  getEnabledTokensForUser,
  getNewsSubscriberTokens,
  getSquadMemberTokens
};
