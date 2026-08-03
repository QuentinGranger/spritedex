"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "server", "schema");
const modules = [
  "reference.js",
  "collection-entries.js",
  "authentication.js",
  "users.js",
  "squads-and-social.js",
  "squad-options.js",
  "sprite-variants.js",
  "squad-activity.js",
  "goals.js",
  "wishlist-and-stats.js",
  "news.js",
  "collection-history.js",
  "legacy-catalogue.js",
  "catalogue-history.js",
  "admin-access.js",
  "news-publication.js",
  "share-capabilities.js",
  "capability-hardening.js",
  "auth-token-hardening.js",
  "admin-operator-migration.js",
  "notifications.js",
  "notification-legacy-columns.js",
  "notification-columns.js",
  "notification-normalization.js",
  "notification-categories.js",
  "notification-indexes.js",
  "notification-subsystems.js",
  "friends-legacy-migration.js",
  "squad-member-normalization.js"
];

for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `server/schema/${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "server", "schema.js"), "utf8");
assert.ok(facade.split("\n").length <= 125, "server/schema.js must remain a lightweight compatibility entry point");
let previousIndex = -1;
for (const file of modules) {
  const index = facade.indexOf(`./schema/${file.replace(".js", "")}`);
  assert.ok(index > previousIndex, `schema stage order is invalid for ${file}`);
  previousIndex = index;
}

const schema = require("../server/schema");
for (const name of ["ensureSquadTables", "ensureReferenceDataSeeded", "purgeDeletedAccounts"]) {
  assert.strictEqual(typeof schema[name], "function", `${name} must remain public`);
}

console.log("schema modules: ok");
