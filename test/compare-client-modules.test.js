"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { renderIndexPage } = require("../scripts/index-page");

const root = path.join(__dirname, "..");
const modules = [
  "state-and-rules.js",
  "calculation.js",
  "summary-and-community.js",
  "filters-and-sorting.js",
  "table-and-actions.js",
  "recommendations.js",
  "squads-and-render.js",
  "sharing.js",
  "direct-comparisons.js",
  "realtime-and-events.js"
];

const context = vm.createContext({ console, setTimeout() {}, clearTimeout() {}, WebSocket: { OPEN: 1 } });
for (const file of modules) {
  const source = fs.readFileSync(path.join(root, "js", "compare", file), "utf8");
  assert.ok(source.split("\n").length <= 500, `js/compare/${file} exceeds the 500-line module limit`);
  vm.runInContext(source, context, { filename: file });
}

for (const name of [
  "compareCollections",
  "computeComplementarityScore",
  "renderCompare",
  "loadCompareTarget",
  "compareWithUser",
  "setupCompareEvents"
]) {
  assert.strictEqual(vm.runInContext(`typeof ${name}`, context), "function", `missing ${name}`);
}

const html = renderIndexPage(root);
let previousIndex = -1;
for (const file of modules) {
  const index = html.indexOf(`js/compare/${file}`);
  assert.ok(index > previousIndex, `script order is invalid for ${file}`);
  previousIndex = index;
}

console.log("compare client modules: ok");
