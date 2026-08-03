"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const entry = fs.readFileSync(path.join(root, "css", "shell.css"), "utf8");
const imports = [...entry.matchAll(/@import url\("\.\/shell\/([^\"]+)"\);/g)].map((match) => match[1]);

assert.deepStrictEqual(imports, [
  "01-foundation.css",
  "02-buttons-and-topbar.css",
  "02b-lang-menu.css",
  "03-notifications-shell.css",
  "04-notifications-content.css",
  "05-notifications-items.css",
  "06-notifications-mobile.css",
  "07-hero-and-tabs.css",
  "08-views-and-forms.css"
], "shell imports must preserve the interface cascade order");

const stylesheet = [entry];
for (const file of imports) {
  const source = fs.readFileSync(path.join(root, "css", "shell", file), "utf8");
  assert.ok(source.split("\n").length <= 500, `css/shell/${file} exceeds the 500-line module limit`);
  const braces = [...source].reduce((depth, character) => depth + (character === "{" ? 1 : character === "}" ? -1 : 0), 0);
  assert.strictEqual(braces, 0, `css/shell/${file} has unbalanced CSS blocks`);
  stylesheet.push(source);
}

const css = stylesheet.join("\n");
for (const selector of [".app-shell", ".topbar", ".notif-dropdown", ".hero-card", ".tabs", ".main-views"]) {
  assert.ok(css.includes(selector), `missing shell style selector: ${selector}`);
}

console.log("shell CSS modules: ok");
