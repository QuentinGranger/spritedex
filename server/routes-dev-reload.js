// Development-only browser refresh endpoint. It intentionally does not exist
// outside `npm run dev`, so production clients never pay for filesystem scans.
const { app } = require("./core");
const fs = require("fs");
const path = require("path");

if (process.env.APP_LIVE_RELOAD === "1") {
  const ROOT_DIR = path.join(__dirname, "..");
  const WATCHED_PATHS = [
    "index.html", "404.html", "manifest.json", "sw.js", "LogoApp.png",
    "Favicon", "icons", "css", "js", "server", "sprite-data.js", "server.js"
  ];
  const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "www", "release", "coverage"]);
  let lastScanAt = 0;
  let lastVersion = "0";

  function latestMtime(targetPath) {
    let latest = 0;
    let stat;
    try {
      stat = fs.statSync(targetPath);
    } catch {
      return latest;
    }
    latest = stat.mtimeMs;
    if (!stat.isDirectory()) return latest;

    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      latest = Math.max(latest, latestMtime(path.join(targetPath, entry.name)));
    }
    return latest;
  }

  function reloadVersion() {
    const now = Date.now();
    if (now - lastScanAt < 500) return lastVersion;
    lastScanAt = now;
    const newest = Math.max(...WATCHED_PATHS.map((item) => latestMtime(path.join(ROOT_DIR, item))));
    lastVersion = String(Math.floor(newest));
    return lastVersion;
  }

  app.get("/__dev/reload-version", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ version: reloadVersion() });
  });
}
