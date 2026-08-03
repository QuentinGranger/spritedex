"use strict";

async function migrateLegacyFriendsSchema(pool) {
  // ── Migration: unifying relationship model ──
  // The legacy `friends` table is no longer used by the application.
  // Any remaining rows are migrated into `friendships` before the old table is dropped.
  await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'friends') THEN
          INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at, updated_at)
          SELECT user_id, friend_user_id, status, created_at,
                 CASE WHEN status IN ('pending') THEN NULL ELSE updated_at END,
                 updated_at
          FROM friends
          WHERE status IS NOT NULL
            AND user_id <> friend_user_id
          ON CONFLICT DO NOTHING;

          DROP TABLE friends;
        END IF;
      END
      $$;
    `);
}

module.exports = { migrateLegacyFriendsSchema };
