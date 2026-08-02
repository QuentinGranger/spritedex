"use strict";

const { pool } = require("./shared");

async function resolveCompareUser(identifier) {
  if (!identifier) return null;
  const raw = String(identifier).trim();
  const isNumeric = /^\d+$/.test(raw);
  const query = isNumeric
    ? `SELECT id, username, display_name, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE id = $1 AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`
    : `SELECT id, username, display_name, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE (username = $1 OR username_normalized = LOWER($1)) AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`;
  const result = await pool.query(query, isNumeric ? [Number(raw)] : [raw]);
  return result.rows[0] || null;
}


module.exports = { resolveCompareUser };
