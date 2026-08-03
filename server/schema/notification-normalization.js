"use strict";

async function normalizeNotificationSchema(pool) {
  // Normalize constraints on columns that may have been renamed from legacy.
  await pool.query(`
      ALTER TABLE notifications ALTER COLUMN type TYPE VARCHAR(80);
      UPDATE notifications SET data = '{}'::jsonb WHERE data IS NULL;
      ALTER TABLE notifications ALTER COLUMN data SET DEFAULT '{}';
      ALTER TABLE notifications ALTER COLUMN data SET NOT NULL;
    `);
}

module.exports = { normalizeNotificationSchema };
