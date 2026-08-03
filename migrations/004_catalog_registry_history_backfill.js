// Rebuild catalog registry chains from catalog_change_history and the dated
// catalog/ snapshot so continuity is verifiable before the 003 bootstrap tip.

module.exports = {
  id: "004_catalog_registry_history_backfill",
  description: "Backfill catalog registry chains from change history and dated catalog snapshot",
  irreversible: true,
  async up({ client }) {
    const { backfillCatalogRegistryFromHistory } = require("../server/catalog-registry/backfill");
    const report = await backfillCatalogRegistryFromHistory(client);
    console.log(
      `[004_catalog_registry_history_backfill] sprites=${report.sprites} variants=${report.variants} variantsCreated=${report.variantsCreated}`
    );
  }
};
