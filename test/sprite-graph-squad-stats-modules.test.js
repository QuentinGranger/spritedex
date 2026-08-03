"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const directory = path.join(root, "server", "sprite-graph-squad-stats");
const modules = ["community.js", "context.js", "daily.js", "eligibility.js", "schema.js", "shared.js"];

assert.deepStrictEqual(
  fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .sort(),
  modules
);
for (const file of modules) {
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  assert.ok(source.split("\n").length < 500, `${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "server", "sprite-graph-squad-stats.js"), "utf8");
assert.ok(facade.split("\n").length < 60, "squad-stat facade should remain lightweight");
for (const name of [
  "ensureSquadDailyStatsTables",
  "listEligibleSquadIds",
  "calculateSquadDailyStats",
  "getSquadCommunityContext"
]) {
  assert.match(facade, new RegExp(`\\b${name}\\b`), `facade must export ${name}`);
}

const stats = require("../server/sprite-graph-squad-stats");
assert.strictEqual(typeof stats.calculateSquadDailyStats, "function");
assert.strictEqual(typeof stats.getSquadCommunityContext, "function");
assert.deepStrictEqual(stats.resolveSquadSizeBand(4).id, "4_6");
console.log(`sprite graph squad-stat modules: ${modules.length} focused files`);
