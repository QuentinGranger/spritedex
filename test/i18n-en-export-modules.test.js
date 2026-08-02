"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "js", "i18n-en-export.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert.strictEqual(manifest.format, "sprite-index-i18n-message-manifest/v1");
assert.strictEqual(manifest.locale, "en");
assert.ok(Array.isArray(manifest.fragments) && manifest.fragments.length > 1, "English messages must be split into fragments");

const messages = {};
for (const relativePath of manifest.fragments) {
  assert.match(relativePath, /^i18n-en-export\/[a-z]+\.json$/, `invalid fragment path: ${relativePath}`);
  const source = fs.readFileSync(path.join(root, "js", relativePath), "utf8");
  assert.ok(source.split("\n").length <= 500, `${relativePath} exceeds the 500-line module limit`);
  const fragment = JSON.parse(source);
  for (const [key, value] of Object.entries(fragment)) {
    assert.ok(!(key in messages), `duplicate English message key: ${key}`);
    messages[key] = value;
  }
}

assert.strictEqual(Object.keys(messages).length, 1815, "English message catalogue key count changed");
assert.strictEqual(messages["nav.missing"], "Missing");
assert.strictEqual(messages["account.legal.contact"], "Contact support");
assert.strictEqual(messages["friends.compare"], "Compare");

console.log("English i18n message modules: ok");
