"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { renderIndexPage } = require("../scripts/index-page");

const root = path.join(__dirname, "..");
const directory = path.join(root, "js", "events");
const modules = [
  "views.js",
  "social-tabs.js",
  "view-swipe.js",
  "mobile-more.js",
  "navigation-events.js",
  "swipe-events.js",
  "checklist-events.js",
  "detail-events.js",
  "data-events.js",
  "missing-events.js",
  "squad-events.js",
  "service-worker.js",
  "bootstrap.js"
];

assert.deepStrictEqual(
  fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .sort(),
  modules.slice().sort()
);
for (const file of modules) {
  const source = fs.readFileSync(path.join(directory, file), "utf8");
  assert.ok(source.split("\n").length < 500, `${file} exceeds the 500-line module limit`);
}

const bootstrap = fs.readFileSync(path.join(directory, "bootstrap.js"), "utf8");
for (const setup of [
  "setupMobileMoreEvents",
  "setupChecklistEvents",
  "setupDetailEvents",
  "setupSquadEvents",
  "setupServiceWorker"
]) {
  assert.match(bootstrap, new RegExp(`\\b${setup}\\(`), `bootstrap must call ${setup}`);
}
const html = renderIndexPage(root);
let previous = -1;
for (const file of modules) {
  const position = html.indexOf(`src="js/events/${file}"`);
  assert.ok(position > previous, `${file} must load in dependency order`);
  previous = position;
}
const facade = fs.readFileSync(path.join(root, "js", "events.js"), "utf8");
assert.ok(facade.split("\n").length < 20, "events.js should remain a lightweight compatibility entry point");
console.log(`event modules: ${modules.length} focused scripts`);
