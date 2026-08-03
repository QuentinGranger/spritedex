"use strict";

// Étape 67 — stable /u/:username URLs + rename redirects + reuse cooldown.
const { pool } = require("./db");

const USERNAME_RESERVE_DAYS = Number(process.env.USERNAME_RESERVE_DAYS) || 30;

async function ensureUsernameHistoryTable(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS username_history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username VARCHAR(50) NOT NULL,
      username_normalized VARCHAR(50) NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reserved_until TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_username_history_norm
      ON username_history (username_normalized, reserved_until DESC);
    CREATE INDEX IF NOT EXISTS idx_username_history_user
      ON username_history (user_id, changed_at DESC);
  `);
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * True if `username` is currently held by another user or still reserved in history.
 */
async function isUsernameReserved(username, { exceptUserId = null, db = pool } = {}) {
  const norm = normalizeUsername(username);
  if (!norm) return true;

  const taken = await db.query(
    `SELECT id FROM users
     WHERE username_normalized = $1
       AND deleted_at IS NULL
       AND ($2::int IS NULL OR id <> $2)
     LIMIT 1`,
    [norm, exceptUserId]
  );
  if (taken.rows.length) return true;

  const reserved = await db.query(
    `SELECT 1 FROM username_history
     WHERE username_normalized = $1
       AND reserved_until > NOW()
       AND ($2::int IS NULL OR user_id <> $2)
     LIMIT 1`,
    [norm, exceptUserId]
  );
  return reserved.rows.length > 0;
}

/**
 * Record an old username when the user renames. Keeps redirect + blocks reuse.
 */
async function recordUsernameChange(userId, oldUsername, { db = pool } = {}) {
  await ensureUsernameHistoryTable(db);
  const username = String(oldUsername || "").trim();
  const norm = normalizeUsername(username);
  if (!username || !norm) return null;
  const result = await db.query(
    `INSERT INTO username_history (user_id, username, username_normalized, reserved_until)
     VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 day'))
     RETURNING *`,
    [userId, username, norm, USERNAME_RESERVE_DAYS]
  );
  return result.rows[0] || null;
}

/**
 * Resolve a public slug to a user. Returns:
 *  { status: 'ok', user }
 *  { status: 'redirect', from, to, userId }
 *  { status: 'not_found' }
 */
async function resolveUsernameSlug(slug, db = pool) {
  await ensureUsernameHistoryTable(db);
  const norm = normalizeUsername(slug);
  if (!norm || norm.length > 50) return { status: "not_found" };

  const current = await db.query(
    `SELECT id, username, display_name, avatar_url, created_at
     FROM users
     WHERE username_normalized = $1
       AND deleted_at IS NULL
       AND (suspended_until IS NULL OR suspended_until <= NOW())
     LIMIT 1`,
    [norm]
  );
  if (current.rows.length) {
    return { status: "ok", user: current.rows[0] };
  }

  // Temporary redirect from an old username while reserved (or forever while we
  // still have history pointing at an active account — brief: redirect temporaire).
  const hist = await db.query(
    `SELECT h.user_id, h.username AS old_username, u.username AS current_username
     FROM username_history h
     JOIN users u ON u.id = h.user_id
     WHERE h.username_normalized = $1
       AND u.deleted_at IS NULL
       AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())
     ORDER BY h.changed_at DESC
     LIMIT 1`,
    [norm]
  );
  if (!hist.rows.length) return { status: "not_found" };

  const row = hist.rows[0];
  // Stop redirecting once cooldown ended AND current username differs (slot freed).
  const stillReserved = await db.query(
    `SELECT 1 FROM username_history
     WHERE username_normalized = $1 AND reserved_until > NOW()
     LIMIT 1`,
    [norm]
  );
  if (!stillReserved.rows.length) {
    // Cooldown over — no longer redirect (prevents permanent squat on old URLs after release).
    return { status: "not_found" };
  }

  return {
    status: "redirect",
    from: slug,
    to: row.current_username,
    userId: row.user_id
  };
}

module.exports = {
  USERNAME_RESERVE_DAYS,
  ensureUsernameHistoryTable,
  normalizeUsername,
  isUsernameReserved,
  recordUsernameChange,
  resolveUsernameSlug
};
