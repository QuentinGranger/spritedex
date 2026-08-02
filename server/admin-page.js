"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const PAGE_FILE = path.join(ROOT_DIR, "admin.html");
const FRAGMENTS_DIR = path.join(ROOT_DIR, "admin", "fragments");
const INCLUDE = /<!-- admin:include ([a-z0-9-]+\.html) -->/g;

function readFragment(name) {
  const file = path.join(FRAGMENTS_DIR, name);
  if (!file.startsWith(`${FRAGMENTS_DIR}${path.sep}`)) throw new Error(`Invalid admin fragment: ${name}`);
  return fs.readFileSync(file, "utf8");
}

function renderAdminPage() {
  return fs.readFileSync(PAGE_FILE, "utf8").replace(INCLUDE, (_match, name) => readFragment(name));
}

module.exports = { renderAdminPage };
