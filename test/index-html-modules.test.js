"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { renderIndexPage } = require("../scripts/index-page");

const root = path.join(__dirname, "..");
const template = fs.readFileSync(path.join(root, "index.html"), "utf8");
const fragmentsDir = path.join(root, "index", "fragments");
const includes = [...template.matchAll(/<!-- index:include ([a-z0-9-]+\.html) -->/g)].map((match) => match[1]);

assert.ok(includes.length >= 20, "index.html must be composed from focused fragments");
assert.strictEqual(new Set(includes).size, includes.length, "index fragments must be included once in a stable order");
for (const fragment of includes) {
  const source = fs.readFileSync(path.join(fragmentsDir, fragment), "utf8");
  assert.ok(source.split("\n").length <= 500, `index fragment exceeds 500 lines: ${fragment}`);
}

const page = renderIndexPage(root);
assert.ok(!page.includes("<!-- index:include"), "rendered index must not expose fragment directives");
for (const selector of ["loginScreen", "appShell", "mainViews", "commandPalette", "js/events/bootstrap.js"]) {
  assert.ok(page.includes(selector), `rendered index is missing ${selector}`);
}
assert.ok((page.match(/<script src=/g) || []).length > 100, "rendered index must retain client script loading");

console.log(`index html modules: ${includes.length} fragments`);
