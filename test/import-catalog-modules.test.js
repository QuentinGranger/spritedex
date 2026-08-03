"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "scripts", "import-catalog");
const modules = [
  "normalizers.js",
  "availability-periods.js",
  "schema.js",
  "changes.js",
  "context.js",
  "sources-and-seasons.js",
  "released-sprites.js",
  "unreleased-sprites.js",
  "metadata-and-legacy.js",
  "importer.js"
];

for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `scripts/import-catalog/${file} exceeds the 500-line module limit`);
}

const runner = fs.readFileSync(path.join(root, "scripts", "import-catalog.js"), "utf8");
assert.ok(runner.split("\n").length <= 100, "scripts/import-catalog.js must remain a lightweight CLI entry point");
assert.match(runner, /require\.main === module/);

const normalizers = require("../scripts/import-catalog/normalizers");
assert.strictEqual(normalizers.normalizeAvailabilityStatus("live", null, null), "available");
assert.strictEqual(normalizers.normalizeAvailabilityStatus("unreleased", "2999-01-01", null), "upcoming");
assert.strictEqual(normalizers.normalizeRecurrenceStatus("possible return"), "possible_return");
assert.strictEqual(normalizers.titleCaseVariant("base"), "Base");

const cli = require("../scripts/import-catalog");
assert.strictEqual(typeof cli.createPool, "function");
assert.strictEqual(typeof cli.main, "function");

(async () => {
  const { importCatalog } = require("../scripts/import-catalog/importer");
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(String(sql).trim().split(/\s+/)[0]);
      return { rows: [] };
    },
    release() {
      calls.push("release");
    }
  };
  const result = await importCatalog(
    {
      async connect() {
        return client;
      }
    },
    {
      catalogueVersion: "test-empty",
      generatedAt: "2026-08-02T00:00:00.000Z",
      variantDefinitions: [],
      sources: [],
      sprites: [],
      unreleasedContent: { baseSprites: [] }
    }
  );
  assert.deepStrictEqual(result, { version: "test-empty", totalChanges: 0 });
  assert.deepStrictEqual(calls.slice(0, 1), ["BEGIN"]);
  assert.ok(calls.includes("COMMIT"));
  assert.strictEqual(calls.at(-1), "release");
  console.log("import catalog modules: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
