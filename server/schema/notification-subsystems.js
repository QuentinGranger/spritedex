"use strict";

const analytics = require("../../analytics");
const pushService = require("../../push-service");
const notifPrefs = require("../notification-preferences");
const eventIdempotency = require("../event-idempotency");
const acquisition = require("../notification-acquisition");
const squadCompletion = require("../notification-squad-completion");
const secLog = require("../../security-logger");

async function ensureNotificationSubsystemSchemas(pool) {
    await pushService.ensurePushTables(pool);
    await require("../push-subscriptions").ensurePushSubscriptionsTable(pool);
    await notifPrefs.ensureNotificationPreferencesTable(pool);
    await eventIdempotency.ensureProcessedEventsTable(pool);
    await require("../notification-delivery-queue").ensureDeliveryQueueTable(pool);
    await require("../notification-deliveries").ensureDeliveriesTable(pool);
    await require("../notification-blocks").ensureNotificationHiddenColumn(pool);
    await acquisition.ensureAcquisitionBatchTable(pool);
    await squadCompletion.ensureSquadCompletionTables(pool);
    await secLog.ensureSecurityLogTable(pool);
    await analytics.ensureCompareAnalyticsTable(pool);
    await analytics.ensureProductAnalyticsTable(pool);
    await require("../comparison-sessions").ensureComparisonSessionsTable(pool);
    await require("../passport-activity").ensurePassportActivityTable(pool);
    await require("../passport-badges").ensurePassportBadgeTables(pool);
    await require("../passport-snapshots").ensurePassportStatSnapshots(pool);
    await require("../username-history").ensureUsernameHistoryTable(pool);
    await require("../passport-summary").ensurePassportSummaryTables(pool);
    await require("../passport-integrity").ensurePassportIntegrityTables(pool);
    await require("../sprite-graph").ensureGraphEventsTable(pool);

    // Étape 59 — featured (pinned) badge on the collector passport.
    await pool.query(`
      ALTER TABLE collector_passports
        ADD COLUMN IF NOT EXISTS featured_badge_id UUID
    `);
    // Soft FK: badge_definitions may be created later in the same boot; enforce via app logic.

}

module.exports = { ensureNotificationSubsystemSchemas };
