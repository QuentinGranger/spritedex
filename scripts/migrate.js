#!/usr/bin/env node

require("dotenv").config();

const { migrate, rollback, status } = require("../server/migrations");

function usage() {
  console.error("Usage: node scripts/migrate.js <up|status|rollback> [--dry-run] [--steps=N]");
  process.exitCode = 1;
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const command = process.argv[2] || "up";
  if (command === "up") {
    const result = await migrate({ dryRun: process.argv.includes("--dry-run") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "status") {
    console.table(await status());
    return;
  }
  if (command === "rollback") {
    const steps = option("steps") || "1";
    console.log(`Rolled back: ${(await rollback({ steps })).join(", ")}`);
    return;
  }
  usage();
}

main().catch((error) => {
  console.error(`[migrations] ${error.message}`);
  process.exitCode = 1;
});
