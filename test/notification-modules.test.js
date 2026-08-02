"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const suiteDir = path.join(root, "test", "notifications");
const suites = [
  "catalog-basics.js",
  "event-bus-and-gates.js",
  "content-and-dedupe.js",
  "presend-and-center.js",
  "delivery-and-ui.js",
  "readiness-and-security.js",
  "contextual-contracts.js",
  "shared.js"
];

for (const file of suites) {
  const source = fs.readFileSync(path.join(suiteDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `test/notifications/${file} exceeds the 500-line module limit`);
}

const runner = fs.readFileSync(path.join(root, "test", "notifications.test.js"), "utf8");
assert.ok(runner.split("\n").length <= 50, "notification test runner must stay lightweight");
assert.match(runner, /catalog-basics/);
assert.match(runner, /event-bus-and-gates/);
assert.match(runner, /contextual-contracts/);
assert.match(fs.readFileSync(path.join(suiteDir, "shared.js"), "utf8"), /EXPECTED_NOTIFICATION_TYPES/);

console.log("notification test modules: ok");
