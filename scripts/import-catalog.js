"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { databasePoolConfig } = require("../server/db");
const { validateCatalog, formatReport } = require("./validate-catalog");
const { DEFAULT_CATALOG_PATH, loadCatalog } = require("./catalog-loader");
const { ensureCatalogImportSchema } = require("./import-catalog/schema");
const { importCatalog } = require("./import-catalog/importer");

function createPool() {
  return process.env.DATABASE_URL
    ? new Pool(databasePoolConfig(process.env.DATABASE_URL))
    : new Pool({ database: "sprite-index", host: "localhost", port: 5432 });
}

async function main(argv = process.argv) {
  const catalogPath = argv[2] || DEFAULT_CATALOG_PATH;
  const catalog = loadCatalog(catalogPath);
  const pool = createPool();
  try {
    const validation = validateCatalog(catalog);
    console.log(formatReport(validation));
    if (validation.errors.length > 0 && !argv.includes("--skip-validation")) {
      throw new Error("Import annulé : le catalogue contient des erreurs bloquantes.");
    }
    await ensureCatalogImportSchema(pool);
    return await importCatalog(pool, catalog);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createPool, main };
