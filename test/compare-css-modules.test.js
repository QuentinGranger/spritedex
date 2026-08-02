"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { renderIndexPage } = require("../scripts/index-page");

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "css", "compare");
const modules = [
  "shell.css",
  "summary.css",
  "cards-and-lists.css",
  "table-actions.css",
  "catalog-filters.css",
  "sprite-dialog.css",
  "share-dialog.css",
  "mode-toggle.css",
  "squads.css"
];

for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `css/compare/${file} exceeds the 500-line module limit`);
  assert.strictEqual(
    (source.match(/\{/g) || []).length,
    (source.match(/\}/g) || []).length,
    `css/compare/${file} has unbalanced braces`
  );
}

const facade = fs.readFileSync(path.join(root, "css", "compare.css"), "utf8");
assert.ok(facade.split("\n").length <= 30, "css/compare.css must remain a lightweight import entry point");
let previousIndex = -1;
for (const file of modules) {
  const index = facade.indexOf(`./compare/${file}`);
  assert.ok(index > previousIndex, `import order is invalid for ${file}`);
  previousIndex = index;
}

const html = renderIndexPage(root);
assert.match(html, /href="css\/compare\.css"/);

console.log("compare css modules: ok");
