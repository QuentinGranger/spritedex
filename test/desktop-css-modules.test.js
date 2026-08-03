"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const entry = fs.readFileSync(path.join(root, "css", "desktop.css"), "utf8");
const imports = [...entry.matchAll(/@import url\("\.\/desktop\/([^\"]+)"\);/g)].map((match) => match[1]);

assert.deepStrictEqual(
  imports,
  [
    "shell.css",
    "checklist-directory.css",
    "checklist-cards.css",
    "checklist-interactions.css",
    "missing-board.css",
    "view-shell.css",
    "stats.css",
    "collection-banner.css",
    "social.css"
  ],
  "desktop imports must preserve workspace cascade order"
);

const stylesheet = [entry];
for (const file of imports) {
  const source = fs.readFileSync(path.join(root, "css", "desktop", file), "utf8");
  assert.ok(source.split("\n").length <= 500, `css/desktop/${file} exceeds the 500-line module limit`);
  const braces = [...source].reduce(
    (depth, character) => depth + (character === "{" ? 1 : character === "}" ? -1 : 0),
    0
  );
  assert.strictEqual(braces, 0, `css/desktop/${file} has unbalanced CSS blocks`);
  stylesheet.push(source);
}

const css = stylesheet.join("\n");
for (const selector of [".app-shell", ".checklist-list", "#view-missing", "#view-stats", "#view-social"]) {
  assert.ok(css.includes(selector), `missing desktop style selector: ${selector}`);
}

console.log("desktop CSS modules: ok");
