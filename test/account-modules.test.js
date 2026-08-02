"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { renderIndexPage } = require("../scripts/index-page");

const root = path.join(__dirname, "..");
const index = renderIndexPage(root);
const scripts = [...index.matchAll(/<script src="(js\/account(?:\/[^\"]+)?)\.js"><\/script>/g)].map((match) => match[1]);

assert.strictEqual(scripts.length, 12, "account behaviour must load through focused modules and one entry point");
assert.strictEqual(scripts[0], "js/account/context", "account context must load before feature modules");
assert.strictEqual(scripts.at(-1), "js/account", "the account entry point must load last");

for (const script of scripts) {
  const source = fs.readFileSync(path.join(root, `${script}.js`), "utf8");
  assert.ok(source.split("\n").length <= 500, `${script}.js exceeds the 500-line module limit`);
}

const entry = fs.readFileSync(path.join(root, "js", "account.js"), "utf8");
assert.match(entry, /function setupAccountPanel/);
assert.match(entry, /SpriteIndexAccount\?\.initialize/);
const publicPassport = fs.readFileSync(path.join(root, "js", "account", "public-passport.js"), "utf8");
assert.match(publicPassport, /openCollectorPassportByUsername/);

console.log("account modules: ok");
