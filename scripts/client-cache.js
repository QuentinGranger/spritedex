// Creates a deterministic service-worker cache version from the client shell.
// Both the web server and Capacitor build use this module, so neither surface
// can accidentally ship a worker with a stale manually maintained version.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CACHE_TOKEN = "__SPRITE_INDEX_CACHE_VERSION__";
const ASSETS_TOKEN = "__SPRITE_INDEX_STATIC_ASSETS__";

function localAssetPath(value) {
  if (!value || /^(?:https?:|data:|#|\/\/)/i.test(value)) return null;
  const clean = value.split(/[?#]/, 1)[0];
  if (!clean || clean.includes("..")) return null;
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function clientAssetPaths(rootDir) {
  const index = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const assets = new Set(["/", "/index.html", "/404.html", "/manifest.json", "/sw.js"]);
  for (const match of index.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const asset = localAssetPath(match[1]);
    if (asset && fs.existsSync(path.join(rootDir, asset))) assets.add(asset);
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
    for (const icon of manifest.icons || []) {
      const asset = localAssetPath(icon?.src);
      if (asset && fs.existsSync(path.join(rootDir, asset))) assets.add(asset);
    }
  } catch {
    // A missing or malformed manifest must not prevent the app shell build.
  }
  return [...assets].sort();
}

function cacheVersion(rootDir, assets = clientAssetPaths(rootDir)) {
  const workerTemplate = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8")
    .replace(CACHE_TOKEN, "<cache>")
    .replace(ASSETS_TOKEN, "<assets>");
  const digest = crypto.createHash("sha256");
  digest.update(workerTemplate);
  for (const asset of assets) {
    digest.update(`\0${asset}\0`);
    if (asset === "/") continue;
    digest.update(fs.readFileSync(path.join(rootDir, asset)));
  }
  return `sprite-index-${digest.digest("hex").slice(0, 16)}`;
}

function renderServiceWorker(rootDir) {
  const assets = clientAssetPaths(rootDir);
  const template = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");
  if (!template.includes(CACHE_TOKEN) || !template.includes(ASSETS_TOKEN)) {
    throw new Error("sw.js must contain the generated cache placeholders");
  }
  return template
    .replace(CACHE_TOKEN, cacheVersion(rootDir, assets))
    .replace(ASSETS_TOKEN, JSON.stringify(JSON.stringify(assets)));
}

module.exports = { CACHE_TOKEN, ASSETS_TOKEN, cacheVersion, clientAssetPaths, renderServiceWorker };
