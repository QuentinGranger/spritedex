"use strict";

const { createImportContext } = require("./context");
const { importSourcesAndSeasons } = require("./sources-and-seasons");
const { importReleasedSprites } = require("./released-sprites");
const { importUnreleasedSprites } = require("./unreleased-sprites");
const { importMetadataAndLegacyEntries } = require("./metadata-and-legacy");

async function importCatalog(db, catalog) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const version = catalog.catalogueVersion;
    const generatedAt = catalog.generatedAt;
    const context = await createImportContext(client, catalog, version, generatedAt);
    await importSourcesAndSeasons(client, catalog, version);
    let totalChanges = 0;
    totalChanges += await importReleasedSprites(client, catalog, context);
    totalChanges += await importUnreleasedSprites(client, catalog, context);
    await importMetadataAndLegacyEntries(client, catalog, context);
    await client.query("COMMIT");
    console.log(`[IMPORT] Catalog ${version} imported successfully.`);
    console.log(`[HISTORY] ${totalChanges} modification(s) journalisée(s) dans catalog_change_history.`);
    return { version, totalChanges };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[IMPORT] Failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { importCatalog };
