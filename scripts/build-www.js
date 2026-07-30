// Assembles the static web assets into ./www, the folder Capacitor bundles into
// the native iOS/Android apps. Run before `npx cap sync` (see `npm run cap:sync`).
// The app shell (HTML/CSS/JS + sprite images) ships inside the app for instant,
// offline-capable loading; all data still comes from the remote API over HTTPS.

const fs = require("fs");
const path = require("path");
const { renderServiceWorker } = require("./client-cache");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "www");

const FILES = ["index.html", "404.html", "manifest.json", "LogoApp.png", "icon-192.png", "icon-512.png"];
const DIRS = ["css", "js", "Favicon", "icons", "Sprite", "trophet"];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT, f));
  } else {
    console.warn(`[build-www] skipped missing file: ${f}`);
  }
}

for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(OUT, d), { recursive: true });
  } else {
    console.warn(`[build-www] skipped missing dir: ${d}`);
  }
}

fs.writeFileSync(path.join(OUT, "sw.js"), renderServiceWorker(ROOT));

console.log(`www/ built for Capacitor (${FILES.length + 1} files + ${DIRS.length} dirs, cache version generated)`);
