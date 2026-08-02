"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { renderAdminPage } = require("../server/admin-page");

const root = path.join(__dirname, "..");
const template = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const fragmentsDir = path.join(root, "admin", "fragments");
const fragments = fs.readdirSync(fragmentsDir).filter(name => name.endsWith(".html")).sort();

assert.ok(fragments.length >= 25, "the admin page should be split into focused HTML fragments");
for (const name of fragments) {
  const source = fs.readFileSync(path.join(fragmentsDir, name), "utf8");
  assert.ok(source.split("\n").length < 500, `${name} exceeds the 500-line fragment limit`);
  assert.ok(template.includes(`admin:include ${name}`), `${name} must be included by the admin page template`);
}

const html = renderAdminPage();
assert.doesNotMatch(html, /<!-- admin:include /, "the served admin page must resolve every fragment");
assert.match(html, /id="adminSessionBadge"/, "the chrome fragment must be present");
assert.match(html, /data-admin-panel="privacy"/, "the tab fragments must be present");
assert.match(html, /id="adminSearchDialog"/, "the dialog fragments must be present");
assert.match(html, /src="\/js\/admin\/bindings\.js"/, "the scripts fragment must be present");

console.log(`admin HTML fragments: ${fragments.length} focused files`);
