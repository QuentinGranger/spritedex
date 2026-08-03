// Immutable catalogue registry: append-only event log with hash chaining.
// Bootstrap emits genesis events from the current sprites / sprite_variants
// projections. Continuity is verifiable from this point forward.

module.exports = {
  id: "003_catalog_registry",
  description: "Append-only catalog registry events with content-hash chain and projection tips",
  irreversible: true,
  async up({ client }) {
    const registry = require("../server/catalog-registry");
    await registry.ensureCatalogRegistrySchema(client);
    const result = await registry.bootstrapCatalogRegistry(client, {
      source: registry.SOURCES.BOOTSTRAP,
      actorLabel: "migration:003_catalog_registry"
    });
    console.log(
      `[003_catalog_registry] bootstrapped ${result.spritesBootstrapped} sprites, ${result.variantsBootstrapped} variants`
    );
  }
};
