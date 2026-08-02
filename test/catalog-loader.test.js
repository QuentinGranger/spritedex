const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_CATALOG_PATH, loadCatalog } = require("../scripts/catalog-loader");
const { validateCatalog } = require("../scripts/validate-catalog");

const manifest = JSON.parse(fs.readFileSync(path.join(DEFAULT_CATALOG_PATH, "manifest.json"), "utf8"));
const catalog = loadCatalog();
const validation = validateCatalog(catalog);

assert.strictEqual(manifest.format, "sprite-index-catalog-manifest/v1");
assert.strictEqual(catalog.catalogueVersion, manifest.catalogueVersion);
assert.strictEqual(catalog.sprites.length, 21);
assert.strictEqual(catalog.variantDefinitions.length, 8);
assert.strictEqual(catalog.sources.length, 27);
assert.strictEqual(catalog.unreleasedContent.baseSprites.length, 1);
assert.strictEqual(validation.errors.length, 0, validation.errors.map((error) => error.message).join("\n"));

for (const relativePath of [...manifest.sections.sprites, ...manifest.sections.variantDefinitions, ...manifest.sections.sources]) {
  assert.ok(fs.existsSync(path.join(DEFAULT_CATALOG_PATH, relativePath)), `fragment absent : ${relativePath}`);
}

console.log("catalog loader: OK");
