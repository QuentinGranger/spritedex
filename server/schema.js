"use strict";

const { pool } = require("./db");
const { seedReferenceData } = require("../sprite-data");

// Compatibility entry point. Ordered schema stages live in server/schema/.
// The sequence is intentionally preserved for existing databases and fresh bootstraps.
async function ensureSquadTables() {
  try {
    await require("./schema/reference").ensureReferenceSchema(pool);
    await require("./schema/collection-entries").ensureCollectionEntriesSchema(pool);
    await require("./schema/authentication").ensureAuthenticationSchema(pool);
    await require("./schema/users").ensureUserProfileSchema(pool);
    await require("./schema/squads-and-social").ensureSquadsAndSocialSchema(pool);
    await require("./schema/squad-options").ensureSquadOptionsSchema(pool);
    await require("./schema/sprite-variants").ensureSpriteVariantsSchema(pool);
    await require("./schema/squad-activity").ensureSquadActivitySchema(pool);
    await require("./schema/goals").ensureGoalsSchema(pool);
    await require("./schema/wishlist-and-stats").ensureWishlistAndStatsSchema(pool);
    await require("./schema/news").ensureNewsSchema(pool);
    await require("./schema/collection-history").ensureCollectionHistorySchema(pool);
    await require("./schema/legacy-catalogue").ensureLegacyCatalogueSchema(pool);
    await require("./schema/catalogue-history").ensureCatalogueHistorySchema(pool);
    await require("./catalog-registry").ensureCatalogRegistrySchema(pool);
    await require("./schema/admin-access").ensureAdminAccessSchema(pool);
    await require("./schema/news-publication").ensureNewsPublicationSchema(pool);
    await require("./schema/share-capabilities").ensureShareCapabilitiesSchema(pool);
    await require("./schema/capability-hardening").applyCapabilityHardening(pool);
    await require("./schema/auth-token-hardening").applyAuthTokenHardening(pool);
    await require("./schema/admin-operator-migration").applyAdminOperatorMigration(pool);
    await require("./schema/notifications").ensureNotificationTableSchema(pool);
    await require("./schema/notification-legacy-columns").migrateLegacyNotificationColumns(pool);
    await require("./schema/notification-columns").ensureNotificationColumns(pool);
    await require("./schema/notification-normalization").normalizeNotificationSchema(pool);
    await require("./schema/notification-categories").backfillNotificationCategories(pool);
    await require("./schema/notification-indexes").ensureNotificationIndexes(pool);
    await require("./schema/notification-subsystems").ensureNotificationSubsystemSchemas(pool);
    await require("./schema/friends-legacy-migration").migrateLegacyFriendsSchema(pool);
    await require("./schema/squad-member-normalization").normalizeSquadMemberSchema(pool);
    console.log("Squad tables ready");
  } catch (err) {
    console.error("Failed to create squad tables:", err);
    throw err;
  }
}

// Auto-seed static reference data on every boot. seedReferenceData is idempotent
// (upserts), so new sprites/images added to sprite-data.js are synced into
// existing databases as well as fresh ones.
async function ensureReferenceDataSeeded() {
  try {
    const counts = await seedReferenceData(pool);
    console.log(
      `Seeded reference data: ${counts.sprites} sprites, ${counts.variants} variants, ${counts.images} images`
    );
    const registry = require("./catalog-registry");
    await registry.ensureCatalogRegistrySchema(pool);
    const boot = await registry.bootstrapCatalogRegistry(pool, {
      source: registry.SOURCES.SEED,
      actorLabel: "seedReferenceData"
    });
    if (boot.spritesBootstrapped || boot.variantsBootstrapped) {
      console.log(
        `Catalog registry seed bootstrap: ${boot.spritesBootstrapped} sprites, ${boot.variantsBootstrapped} variants`
      );
    }
  } catch (err) {
    console.error("Failed to seed reference data:", err);
  }
}

async function purgeDeletedAccounts(options = {}) {
  try {
    return await require("./privacy-ops").purgeDeletedAccounts(options);
  } catch (err) {
    console.error("[PURGE] Failed to purge deleted accounts:", err);
    return { purged: [], retentionDays: require("./privacy-ops").retentionDays() };
  }
}

async function purgeUnverifiedPasswordAccounts(options = {}) {
  try {
    return await require("./privacy-ops").purgeUnverifiedPasswordAccounts(options);
  } catch (err) {
    console.error("[PURGE] Failed to purge unverified accounts:", err);
    return { purged: [], retentionDays: 7 };
  }
}

module.exports = {
  ensureReferenceDataSeeded,
  ensureSquadTables,
  purgeDeletedAccounts,
  purgeUnverifiedPasswordAccounts
};
