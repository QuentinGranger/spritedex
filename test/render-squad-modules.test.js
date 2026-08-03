"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { renderIndexPage } = require("../scripts/index-page");

const root = path.join(__dirname, "..");
const modules = [
  "lifecycle.js",
  "admin-controls.js",
  "diff-helpers.js",
  "members.js",
  "main-render.js",
  "table-and-cards.js",
  "hunt.js",
  "duel-and-session.js",
  "history.js",
  "recommendations.js",
  "summary.js"
];

const context = vm.createContext({ console, setTimeout() {}, clearTimeout() {} });
for (const file of modules) {
  const source = fs.readFileSync(path.join(root, "js", "render-squad", file), "utf8");
  assert.ok(source.split("\n").length <= 500, `js/render-squad/${file} exceeds the 500-line module limit`);
  vm.runInContext(source, context, { filename: file });
}

for (const name of [
  "createSquad",
  "joinSquad",
  "leaveSquad",
  "loadSquad",
  "restoreSquad",
  "renderSquad",
  "renderSquadMembers",
  "renderSquadTable",
  "renderSquadHunt",
  "renderSquadDuel",
  "renderSquadHistory",
  "renderSquadRecommendations",
  "renderSquadRecommendedFriends",
  "renderSquadComplementaryPairs",
  "buildSquadSummary"
]) {
  assert.strictEqual(vm.runInContext(`typeof ${name}`, context), "function", `missing ${name}`);
}

const facade = fs.readFileSync(path.join(root, "js", "render-squad.js"), "utf8");
assert.ok(facade.split("\n").length <= 50, "js/render-squad.js must remain a lightweight compatibility entry point");

const html = renderIndexPage(root);
let previousIndex = -1;
for (const file of modules) {
  const index = html.indexOf(`js/render-squad/${file}`);
  assert.ok(index > previousIndex, `script order is invalid for ${file}`);
  previousIndex = index;
}
assert.ok(
  html.indexOf("js/render-squad.js") > previousIndex,
  "compatibility entry point must load after squad modules"
);

console.log("render squad modules: ok");
