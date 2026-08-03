#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { pool } = require("../server/db");
const registry = require("../server/catalog-registry");

async function main() {
  await registry.ensureCatalogRegistrySchema(pool);
  const report = await registry.verifyAllCatalogRegistry(pool);
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        checked: report.checked,
        failed: report.failed,
        failures: report.results.slice(0, 50)
      },
      null,
      2
    )
  );
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`[catalog:verify] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
