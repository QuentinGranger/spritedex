"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "server", "sprite-graph");
const modules = [
  "constants.js",
  "normalization.js",
  "schema.js",
  "events.js",
  "priority.js",
  "social.js",
  "squads.js",
  "goals.js",
  "comparison.js",
  "collection.js"
];

for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `server/sprite-graph/${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "server", "sprite-graph.js"), "utf8");
assert.ok(facade.split("\n").length <= 75, "server/sprite-graph.js must remain a lightweight compatibility facade");

const graph = require("../server/sprite-graph");
for (const name of [
  "ensureGraphEventsTable",
  "buildGraphEventEnvelope",
  "recordGraphEvent",
  "correctGraphEvent",
  "recordCollectionGraphEvents",
  "buildDeduplicationKey",
  "getPriorityInterestMetrics",
  "computeSquadJoinImpact",
  "buildGoalCompletedContext",
  "buildComparisonCompletedContext",
  "sanitizeGraphContext",
  "applyPublicAnonymizationGate"
]) {
  assert.strictEqual(typeof graph[name], "function", `${name} must remain public`);
}
assert.strictEqual(graph.GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED, "collection.sprite_added");
assert.strictEqual(graph.GRAPH_EVENT_VERSIONS[graph.GRAPH_EVENT_TYPES.GOAL_COMPLETED], 3);

console.log("sprite graph service modules: ok");
