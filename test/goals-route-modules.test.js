"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const goalsDirectory = path.join(root, "src", "features", "goals", "presentation", "http");
const modules = fs.readdirSync(goalsDirectory).filter(file => file.endsWith(".js")).sort();

assert.deepStrictEqual(modules, ["completion.js", "create.js", "feasibility.js", "list.js", "recommendation.js", "shared.js"]);
for (const file of modules) {
  const source = fs.readFileSync(path.join(goalsDirectory, file), "utf8");
  assert.ok(source.split("\n").length < 500, `${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "src", "app", "api", "goals", "register.js"), "utf8");
assert.ok(facade.split("\n").length < 50, "routes-goals.js should remain a lightweight facade");
for (const module of ["create", "feasibility", "recommendation", "list", "completion"]) {
  assert.match(facade, new RegExp(`http/${module}`), `route registry must load ${module}`);
}
assert.match(fs.readFileSync(path.join(goalsDirectory, "completion.js"), "utf8"), /module\.exports = \{ checkAffectedGoals \}/, "completion helper must remain exported");

const legacyFacade = fs.readFileSync(path.join(root, "server", "routes-goals.js"), "utf8");
assert.match(legacyFacade, /@\/app\/api\/goals\/register/, "legacy route path must delegate to the app layer");

console.log(`goal route modules: ${modules.length} focused files`);
