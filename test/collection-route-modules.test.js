"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const collectionDirectory = path.join(root, "src", "features", "collections", "presentation", "http");
const modules = fs
  .readdirSync(collectionDirectory)
  .filter((file) => file.endsWith(".js"))
  .sort();

assert.deepStrictEqual(modules, [
  "effects.js",
  "entry.js",
  "import.js",
  "maintenance.js",
  "read.js",
  "shared.js",
  "sync.js"
]);
for (const file of modules) {
  const source = fs.readFileSync(path.join(collectionDirectory, file), "utf8");
  assert.ok(source.split("\n").length < 500, `${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "src", "app", "api", "collections", "register.js"), "utf8");
assert.ok(facade.split("\n").length < 50, "routes-collection.js should remain a lightweight facade");
for (const module of ["read", "entry", "sync", "import", "maintenance"]) {
  assert.match(facade, new RegExp(`http/${module}`), `route registry must load ${module}`);
}
const effects = fs.readFileSync(path.join(collectionDirectory, "effects.js"), "utf8");
assert.match(
  effects,
  /notifyCollectionChanges|emitVariantAcquiredEvents|scheduleSquadStatsForUser/,
  "shared write effects must stay centralized"
);

const legacyFacade = fs.readFileSync(path.join(root, "server", "routes-collection.js"), "utf8");
assert.match(legacyFacade, /@\/app\/api\/collections\/register/, "legacy route path must delegate to the app layer");

console.log(`collection route modules: ${modules.length} focused files`);
