#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { pool } = require("../server/db");
const { backfillCatalogRegistryFromHistory } = require("../server/catalog-registry/backfill");
const { verifyAllCatalogRegistry } = require("../server/catalog-registry/verify");

async function main() {
  const report = await backfillCatalogRegistryFromHistory(pool);
  const integrity = await verifyAllCatalogRegistry(pool);
  console.log(
    JSON.stringify(
      { backfill: report, integrity: { ok: integrity.ok, checked: integrity.checked, failed: integrity.failed } },
      null,
      2
    )
  );
  if (!integrity.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(`[catalog:backfill] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
