"use strict";

async function migrateLegacyNotificationColumns(pool) {
    // Migrate legacy notifications tables (pre "contextual notifications"), which
    // used user_id / context / message. Rename in place to avoid data loss.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='user_id')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='recipient_id') THEN
          ALTER TABLE notifications RENAME COLUMN user_id TO recipient_id;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='context')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='data') THEN
          ALTER TABLE notifications RENAME COLUMN context TO data;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='message')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='body') THEN
          ALTER TABLE notifications RENAME COLUMN message TO body;
        END IF;
      END $$;
    `);
}

module.exports = { migrateLegacyNotificationColumns };
