"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "server", "admin-operations");
const modules = fs.readdirSync(moduleDir).filter((file) => file.endsWith(".js"));

assert.strictEqual(modules.length, 12, "admin operations must be split into shared helpers and domain modules");
for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `server/admin-operations/${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "server", "routes-admin-operations.js"), "utf8");
for (const domain of ["overview", "players", "catalog", "notifications", "privacy-audit"]) {
  assert.match(facade, new RegExp(`admin-operations/${domain}`), `facade must register ${domain}`);
}
assert.match(facade, /module\.exports = \{ audit: shared\.audit \}/);

console.log("admin operation modules: ok");
