// This baseline deliberately delegates to the previous idempotent bootstrap.
// It is irreversible because it may create and backfill live user data. Future
// schema changes must be new migrations with an explicit, tested `down` path.

module.exports = {
  id: "001_legacy_schema_baseline",
  description: "Create and upgrade the legacy SPRITE-INDEX schema baseline",
  irreversible: true,
  transaction: false,
  async up() {
    await require("../server/schema").ensureSquadTables();
  }
};
