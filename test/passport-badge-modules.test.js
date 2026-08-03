"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "server", "passport-badges");
const modules = [
  "content.js",
  "definitions.js",
  "rules.js",
  "schema.js",
  "definitions-query.js",
  "unlocking.js",
  "qualifications.js",
  "rarities-events.js",
  "complementary.js",
  "user-badges.js"
];

for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `server/passport-badges/${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "server", "passport-badges.js"), "utf8");
assert.ok(facade.split("\n").length <= 75, "server/passport-badges.js must remain a lightweight compatibility facade");

const badges = require("../server/passport-badges");
for (const name of [
  "resolveBadgeCopy",
  "evaluateBadgeCondition",
  "ensurePassportBadgeTables",
  "unlockBadgesForUser",
  "awardBadgeByCode",
  "maybeAwardSquadFounder",
  "evaluateEarlyCollectorQualified",
  "evaluateAllRaritiesOwned",
  "awardEventCompletedBadges",
  "evaluateAndAwardComplementaryBadge",
  "listUserBadges"
]) {
  assert.strictEqual(typeof badges[name], "function", `${name} must remain public`);
}
assert.strictEqual(badges.MILESTONE_BADGES, badges.MILESTONE_BY_CODE);
assert.strictEqual(badges.resolveBadgeCopy("badge.first_collection.name", "", "en"), "First collection");

console.log("passport badge modules: ok");
