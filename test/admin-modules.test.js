"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { renderAdminPage } = require("../server/admin-page");

const root = path.join(__dirname, "..");
const html = renderAdminPage();
const scripts = [...html.matchAll(/<script src="\/js\/(admin\/[^\"]+\.js)"><\/script>/g)].map((match) => match[1]);

assert.ok(scripts.length >= 20, "the backoffice must be separated into focused modules");
assert.strictEqual(scripts[0], "admin/context.js", "the shared admin context must load first");
assert.strictEqual(scripts.at(-1), "admin/bindings.js", "event bindings must load after every feature module");

for (const script of scripts) {
  const file = path.join(root, "js", script);
  const source = fs.readFileSync(file, "utf8");
  assert.ok(source.split("\n").length <= 500, `${script} exceeds the 500-line module limit`);
  assert.match(source, /^\(\(\) => \{/, `${script} must isolate its local declarations`);
}

assert.match(
  fs.readFileSync(path.join(root, "js", "admin.js"), "utf8"),
  /split into focused scripts/,
  "the legacy entry file must point to the split modules"
);
console.log("admin modules: ok");
