"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { renderIndexPage } = require("../scripts/index-page");

const root = path.join(__dirname, "..");
const directory = path.join(root, "js", "squad-engine");
const modules = [
  "state.js",
  "overview.js",
  "filters.js",
  "recommendations.js",
  "scenario.js",
  "optimization.js",
  "interactions.js"
];

assert.deepStrictEqual(
  fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .sort(),
  modules.slice().sort()
);
for (const file of modules) {
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  assert.ok(source.split("\n").length < 500, `${file} exceeds the 500-line module limit`);
}

const state = fs.readFileSync(path.join(directory, "state.js"), "utf8");
const interactions = fs.readFileSync(path.join(directory, "interactions.js"), "utf8");
assert.match(state, /let squadEngineReport = null/, "engine state must initialize before render modules");
assert.match(interactions, /setupSquadEngine\(\);/, "interactions must initialize after all render modules");

const html = renderIndexPage(root);
let cursor = -1;
for (const file of modules) {
  const script = `src="js/squad-engine/${file}"`;
  const position = html.indexOf(script);
  assert.ok(position > cursor, `${file} must load in engine dependency order`);
  cursor = position;
}

const facade = fs.readFileSync(path.join(root, "js", "squad-engine.js"), "utf8");
assert.ok(facade.split("\n").length < 20, "legacy entry point should remain lightweight");
console.log(`squad engine modules: ${modules.length} focused scripts`);
