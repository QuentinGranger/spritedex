// Regression contract: client totals must use the same released/active scope
// as passport and squad progress on the server.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/helpers.js", "utf8");
const start = source.indexOf("function isReleasedCollectionItem");
const end = source.indexOf("function defaultEntry", start);
assert.ok(start >= 0 && end > start, "collection metric helpers not found");

const entries = new Map([
  ["released-owned", { status: "owned" }],
  ["released-missing", { status: "missing" }],
  ["upcoming-owned", { status: "owned" }],
  ["disabled-owned", { status: "owned" }],
  ["unknown-owned", { status: "owned" }]
]);
const context = {
  getAllItems() { return items; },
  getEntry(id) { return entries.get(id) || { status: "new" }; }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const items = [
  { id: "released-owned", spriteId: "sprite-a", releaseStatus: "released", available: true },
  { id: "released-missing", spriteId: "sprite-a", releaseStatus: "released", available: true },
  { id: "upcoming-owned", spriteId: "sprite-a", releaseStatus: "upcoming", available: true },
  { id: "disabled-owned", spriteId: "sprite-b", releaseStatus: "released", available: false },
  { id: "unknown-owned", spriteId: "sprite-b", releaseStatus: "unknown", available: true }
];

const released = context.getReleasedCollectionItems(items);
assert.deepStrictEqual(released.map((item) => item.id), ["released-owned", "released-missing"]);

const metrics = context.getCollectionMetrics(items);
assert.deepStrictEqual(JSON.parse(JSON.stringify(metrics)), {
  catalogueTotal: 5,
  releasedTotal: 2,
  owned: 1,
  remaining: 1,
  precisePercent: 50,
  percent: 50,
  percentRounded: 50
});

const spriteMetrics = context.getSpriteCollectionMetrics("sprite-a", items);
assert.deepStrictEqual(JSON.parse(JSON.stringify(spriteMetrics)), { total: 2, owned: 1, percent: 50 });
assert.strictEqual(context.collectionPercent(41, 83), 49.4);

console.log("4 passed, 0 failed");
