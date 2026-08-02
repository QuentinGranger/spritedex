"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const suiteDir = path.join(root, "test", "passport");
const suites = [
  "shared.js",
  "foundations.js",
  "activity-and-definitions.js",
  "advanced-badges.js",
  "catalogue-and-integrity.js",
  "live-contract.js",
  "live-public-profile.js",
  "live-summary.js",
  "live-collection.js",
  "live-social.js",
  "live-archival.js"
];

for (const file of suites) {
  const source = fs.readFileSync(path.join(suiteDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `test/passport/${file} exceeds the 500-line module limit`);
  if (file !== "shared.js") {
    assert.strictEqual(typeof require(path.join(suiteDir, file)).run, "function", `${file} must expose run()`);
  }
}

const runner = fs.readFileSync(path.join(root, "test", "passport.test.js"), "utf8");
assert.ok(runner.split("\n").length <= 75, "test/passport.test.js must remain a lightweight runner");
let previousIndex = -1;
for (const file of suites.slice(1)) {
  const index = runner.indexOf(`./passport/${file.replace(".js", "")}`);
  assert.ok(index > previousIndex, `suite order is invalid for ${file}`);
  previousIndex = index;
}

const shared = require(path.join(suiteDir, "shared.js"));
for (const name of ["register", "cleanup", "getPassport", "setEntry", "getActiveVariants", "test", "results"]) {
  assert.strictEqual(typeof shared[name], "function", `shared helper ${name} is missing`);
}

console.log("passport test modules: ok");
