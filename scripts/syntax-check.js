#!/usr/bin/env node
"use strict";

/**
 * Syntax gate for deployed JS outside the typed/modular src/ tree.
 * Runs `node --check` on every .js file under the given roots.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TARGETS = [
  "server",
  "js",
  "test",
  "scripts",
  "security.js",
  "security-logger.js",
  "server.js",
  "analytics.js",
  "push-service.js",
  "seed.js",
  "sprite-data.js",
  "sw.js",
  "eslint.config.js"
];

function collectJsFiles(target, out = []) {
  const abs = path.join(ROOT, target);
  if (!fs.existsSync(abs)) return out;
  const st = fs.statSync(abs);
  if (st.isFile()) {
    if (abs.endsWith(".js") || abs.endsWith(".cjs") || abs.endsWith(".mjs")) out.push(abs);
    return out;
  }
  for (const name of fs.readdirSync(abs)) {
    if (name === "node_modules" || name === "www" || name === "coverage") continue;
    collectJsFiles(path.join(target, name), out);
  }
  return out;
}

const files = TARGETS.flatMap((target) => collectJsFiles(target));
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    const rel = path.relative(ROOT, file);
    process.stderr.write(`${rel}\n${result.stderr || result.stdout || "syntax error"}\n`);
  }
}

if (failed) {
  console.error(`syntax-check: ${failed}/${files.length} file(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`syntax-check: ${files.length} files ok`);
}
