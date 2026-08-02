"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const entry = fs.readFileSync(path.join(root, "css", "account.css"), "utf8");
const imports = [...entry.matchAll(/@import url\("\.\/account\/([^\"]+)"\);/g)].map((match) => match[1]);

assert.strictEqual(imports.length, 17, "account styles must be split into focused files");
assert.deepStrictEqual(imports, [
  "topbar.css",
  "panel.css",
  "email-banner.css",
  "profile.css",
  "passport-profile.css",
  "passport-progress.css",
  "passport-sharing.css",
  "profile-actions.css",
  "sections.css",
  "account-actions.css",
  "notifications.css",
  "account-deletion.css",
  "passport-responsive.css",
  "desktop-dashboard.css",
  "overview.css",
  "badges.css",
  "passport-collections.css"
], "account imports must preserve the original cascade order");

const stylesheet = [entry];
for (const file of imports) {
  const source = fs.readFileSync(path.join(root, "css", "account", file), "utf8");
  assert.ok(source.split("\n").length <= 500, `css/account/${file} exceeds the 500-line module limit`);
  const braces = [...source].reduce((depth, character) => depth + (character === "{" ? 1 : character === "}" ? -1 : 0), 0);
  assert.strictEqual(braces, 0, `css/account/${file} has unbalanced CSS blocks`);
  stylesheet.push(source);
}

const css = stylesheet.join("\n");
for (const selector of [".account-panel", ".collector-passport", ".passport-share-dialog", ".notif-settings", ".account-overview-grid"]) {
  assert.ok(css.includes(selector), `missing account style selector: ${selector}`);
}

console.log("account CSS modules: ok");
