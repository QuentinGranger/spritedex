const fs = require("fs");
const path = require("path");

const DEFAULT_CATALOG_PATH = path.join(__dirname, "..", "catalog", "2026-07-18");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadCatalog(catalogPath = DEFAULT_CATALOG_PATH) {
  const resolved = path.resolve(catalogPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return readJson(resolved);

  const manifestPath = path.join(resolved, "manifest.json");
  const manifest = readJson(manifestPath);
  if (manifest.format !== "sprite-index-catalog-manifest/v1") {
    throw new Error(`Manifeste de catalogue non pris en charge : ${manifestPath}`);
  }
  const read = (relativePath) => readJson(path.join(resolved, relativePath));
  const sections = manifest.sections || {};
  const catalog = {
    ...read(manifest.metadata),
    disclaimer: read(sections.disclaimer),
    summary: read(sections.summary),
    season: read(sections.season),
    weeklyEvents: read(sections.weeklyEvents),
    variantDefinitions: (sections.variantDefinitions || []).map(read),
    sprites: (sections.sprites || []).map(read),
    unreleasedContent: {
      ...read(sections.unreleasedContent.metadata),
      baseSprites: (sections.unreleasedContent.baseSprites || []).map(read),
      variantTypes: read(sections.unreleasedContent.variantTypes)
    },
    sources: (sections.sources || []).map(read)
  };
  return catalog;
}

module.exports = { DEFAULT_CATALOG_PATH, loadCatalog };
