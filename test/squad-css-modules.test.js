"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const entry = fs.readFileSync(path.join(root, "css", "squad.css"), "utf8");
const imports = [...entry.matchAll(/@import url\("\.\/squad\/([^\"]+)"\);/g)].map((match) => match[1]);

assert.strictEqual(imports.length, 18, "squad styles must be split into focused files");
assert.deepStrictEqual(imports.slice(-4), [
  "completion-engine.css",
  "completion-engine-desktop.css",
  "completion-engine-mobile.css",
  "wishlist.css"
], "the completion engine and wishlist cascade must remain ordered");

const stylesheet = [entry];
for (const file of imports) {
  const source = fs.readFileSync(path.join(root, "css", "squad", file), "utf8");
  assert.ok(source.split("\n").length <= 500, `css/squad/${file} exceeds the 500-line module limit`);
  const braces = [...source].reduce((depth, character) => depth + (character === "{" ? 1 : character === "}" ? -1 : 0), 0);
  assert.strictEqual(braces, 0, `css/squad/${file} has unbalanced CSS blocks`);
  stylesheet.push(source);
}

const css = stylesheet.join("\n");
for (const selector of [".squad-lobby", ".squad-admin", ".hunt-section", ".squad-engine", ".squad-wishlist"]) {
  assert.ok(css.includes(selector), `missing squad style selector: ${selector}`);
}

console.log("squad CSS modules: ok");
