const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "squads");
const modules = fs.readdirSync(root).filter((name) => name.endsWith(".js"));

assert.ok(modules.length >= 7, "squad tests should be split into focused modules");
for (const name of modules) {
  const file = path.join(root, name);
  const lines = fs.readFileSync(file, "utf8").split("\n").length;
  assert.ok(lines < 500, `${name} must stay below 500 lines (${lines})`);
  require(file);
}

const runner = fs.readFileSync(path.join(__dirname, "squads.test.js"), "utf8");
assert.ok(runner.split("\n").length < 75, "squads.test.js should remain a lightweight runner");
for (const name of [
  "friendships-and-capacity",
  "privacy",
  "recommendations",
  "completion-notification",
  "completion-progression",
  "completion-engine"
]) {
  assert.ok(runner.includes(`./squads/${name}`), `runner must load ${name}`);
}

console.log(`✓ Squad test modules: ${modules.length} focused files`);
