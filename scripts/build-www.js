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
const REQUIRED_LOCALIZED_ASSETS = Object.freeze([
  "js/i18n.js",
  "js/i18n-nl-data.js",
  "js/i18n-nl-legacy-data.js",
  "js/i18n-nl-messages.json",
  "js/legal-content-nl.js"
]);

function verifyLocalizedBundle() {
  const bundledIndex = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  for (const asset of REQUIRED_LOCALIZED_ASSETS) {
    const source = path.join(ROOT, asset);
    const bundled = path.join(OUT, asset);
    if (!fs.existsSync(source)) throw new Error(`[build-www] source asset missing: ${asset}`);
    if (!fs.existsSync(bundled)) throw new Error(`[build-www] bundled asset missing: ${asset}`);
    if (!fs.readFileSync(source).equals(fs.readFileSync(bundled))) {
      throw new Error(`[build-www] bundled asset differs from source: ${asset}`);
    }
  }
  for (const script of ["js/i18n-nl-data.js", "js/i18n-nl-legacy-data.js", "js/legal-content-nl.js"]) {
    if (!bundledIndex.includes(`src=\"${script}\"`)) {
      throw new Error(`[build-www] index.html does not load required localized asset: ${script}`);
    }
  }
}

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

verifyLocalizedBundle();
fs.writeFileSync(path.join(OUT, "sw.js"), renderServiceWorker(ROOT));

console.log(`www/ built for Capacitor (${FILES.length + 1} files + ${DIRS.length} dirs, cache version generated)`);
