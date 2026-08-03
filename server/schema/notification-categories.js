"use strict";

async function backfillNotificationCategories(pool) {
  // Backfill categories for known contextual types; leave others as 'general'.
  await pool.query(`
      UPDATE notifications SET category = CASE type
        WHEN 'friend_request_accepted' THEN 'social'
        WHEN 'friend_acquired_missing_variant' THEN 'collection'
        WHEN 'squad_completion_increased' THEN 'collection'
        WHEN 'priority_variant_available' THEN 'alerts'
        WHEN 'wanted_event_ending_soon' THEN 'alerts'
        ELSE category END
      WHERE category = 'general';
    `);
}

module.exports = { backfillNotificationCategories };
