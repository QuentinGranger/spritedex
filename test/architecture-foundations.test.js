"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { installSourceAlias } = require("../src/shared/config/register-path-alias");

installSourceAlias();
const root = path.join(__dirname, "..");

assert.strictEqual(require("../server/db"), require("@/infrastructure/database/postgres-pool"));
assert.strictEqual(require("../server/rate-limit-store"), require("@/infrastructure/cache/rate-limit-store"));
assert.strictEqual(require("../server/consent"), require("@/shared/validation/cookie-consent"));
assert.strictEqual(require("../server/runtime-health"), require("@/infrastructure/observability/runtime-health"));
assert.strictEqual(require("../server/catalog"), require("@/features/sprites/infrastructure/catalog-repository"));
assert.match(
  fs.readFileSync(path.join(root, "server", "auth.js"), "utf8"),
  /@\/features\/auth\/infrastructure\/session-service/,
  "the legacy auth entry point must delegate to the Auth feature"
);
assert.match(
  fs.readFileSync(path.join(root, "server", "core.js"), "utf8"),
  /@\/app\/http\/core/,
  "the legacy HTTP entry point must delegate to src/app/http"
);

const mastery = require("@/domain/collections/value-objects/mastery-level");
assert.strictEqual(mastery.normalizeMasteryLevel({ masteryLevel: 3 }, "owned"), 3);
assert.strictEqual(mastery.normalizeMasteryLevel({ masteryLevel: 8 }, "owned"), 1);
assert.strictEqual(mastery.normalizeMasteryLevel({ masteryLevel: 3 }, "missing"), 0);

const collectionsDir = path.join(root, "src", "features", "collections", "presentation", "http");
for (const file of ["effects.js", "entry.js", "import.js", "maintenance.js", "read.js", "shared.js", "sync.js"]) {
  assert.ok(fs.existsSync(path.join(collectionsDir, file)), `missing collection feature module: ${file}`);
}

const domainFile = fs.readFileSync(
  path.join(root, "src", "domain", "collections", "value-objects", "mastery-level.js"),
  "utf8"
);
assert.ok(!domainFile.includes("require("), "domain value objects must remain framework-independent");

console.log("architecture foundations: ok");
