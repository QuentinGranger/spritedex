"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

process.env.APP_URL ||= "http://127.0.0.1:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "server", "compare");
const modules = fs.readdirSync(moduleDir).filter((file) => file.endsWith(".js"));

assert.ok(modules.length >= 17, "comparison logic must be split into focused modules");
for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `server/compare/${file} exceeds the 500-line module limit`);
}

const compare = require("../server/compare");
assert.deepStrictEqual(
  Object.entries(compare).filter(([, value]) => value === undefined).map(([name]) => name),
  [],
  "the compatibility facade must expose every comparison API"
);
assert.strictEqual(typeof compare.compareCollectionsServer, "function");
assert.strictEqual(typeof compare.getSquadAcquisitionPriority, "function");
assert.strictEqual(typeof compare.loadCollectionForShare, "function");

const result = compare.compareCollectionsServer(
  { id: "a", displayName: "A", collection: { v1: { status: "owned", priority: "none", note: "" } } },
  { id: "b", displayName: "B", collection: { v1: { status: "missing", priority: "none", note: "" } } },
  [{ id: "v1", variantId: "v1", spriteId: "s1", variantType: "Base", releaseStatus: "released", dataStatus: "", available: true, isReleased: true }]
);
assert.strictEqual(result.summary.onlyUserACount, 1, "the split engine must preserve comparison grouping");

const priorities = compare.getSquadAcquisitionPriority([{
  variantId: "v1", spriteId: "s1", spriteName: "Sprite", variantName: "Base", rarity: "rare", availabilityStatus: "available", endDate: null,
  ownerCount: 0, missingCount: 2, memberCount: 2, missingMembers: ["A", "B"], availability: { recurrence: { status: "unknown" } },
  members: [
    { userId: 1, username: "A", status: "priority", priority: "high", classification: "missing", visible: true },
    { userId: 2, username: "B", status: "missing", priority: "none", classification: "missing", visible: true }
  ]
}]);
assert.strictEqual(priorities[0].variantId, "v1", "the split squad recommendation helpers must stay connected");

console.log("compare modules: ok");
