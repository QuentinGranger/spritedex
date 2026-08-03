const assert = require("node:assert");
const path = require("node:path");
const { cacheVersion, clientAssetPaths, renderServiceWorker } = require("../scripts/client-cache");

const root = path.join(__dirname, "..");
const assets = clientAssetPaths(root);
const worker = renderServiceWorker(root);
const eventSource = require("node:fs")
  .readdirSync(path.join(root, "js", "events"))
  .filter((file) => file.endsWith(".js"))
  .map((file) => require("node:fs").readFileSync(path.join(root, "js", "events", file), "utf8"))
  .join("\n");

assert.ok(assets.includes("/css/home.css"), "le shell CSS doit participer à l'empreinte");
assert.ok(assets.includes("/js/farm-plan.js"), "le shell JS doit participer à l'empreinte");
assert.ok(assets.includes("/js/i18n-nl-data.js"), "le dictionnaire néerlandais doit participer à l'empreinte");
assert.ok(
  assets.includes("/js/i18n-nl-legacy-data.js"),
  "le dictionnaire néerlandais historique doit participer à l'empreinte"
);
assert.ok(
  assets.includes("/js/legal-content-nl.js"),
  "les documents juridiques néerlandais doivent participer à l'empreinte"
);
assert.ok(
  worker.includes(`const CACHE_NAME = "${cacheVersion(root, assets)}"`),
  "version de cache absente du worker généré"
);
assert.ok(!worker.includes("__SPRITE_INDEX_"), "un placeholder a été laissé dans le worker généré");
assert.ok(worker.includes("/js/farm-plan.js"), "la liste d'assets du worker est incomplète");
assert.match(worker, /url\.pathname === "\/admin"/, "le backoffice ne doit jamais utiliser le cache applicatif");
assert.match(
  eventSource,
  /register\("\/sw\.js", \{ scope: "\/", updateViaCache: "none" \}\)/,
  "le worker doit être enregistré à la racine sans réutiliser un cache HTTP"
);

console.log("client cache generation: ok");
