"use strict";

async function createImportContext(client, catalog, version, generatedAt) {
  // Build variant type effect map for per-variant effect data
  const variantEffectMap = {};
  for (const vd of catalog.variantDefinitions || []) {
    const key = vd.id.replace("variant_type_", "");
    variantEffectMap[key] = vd.extraEffect || null;
  }

  // Fetch existing colors so we don't overwrite them with defaults.
  // Also snapshot pre-import field values so we can journalize what changes
  // during this import (Étape 19 — historique des modifications).
  const existingSpritesRes = await client.query(
    "SELECT id, color, rarity, season_id, official_name, image, availability, data_status FROM sprites"
  );
  const existingColors = {};
  const existingSprites = {};
  for (const row of existingSpritesRes.rows) {
    existingColors[row.id] = row.color;
    existingSprites[row.id] = row;
  }
  const existingVariantsRes = await client.query(
    "SELECT id, sprite_id, rarity, release_status, image_path, availability, data_status FROM sprite_variants"
  );
  const existingVariants = {};
  for (const row of existingVariantsRes.rows) existingVariants[row.id] = row;

  // Metadata attached to every change recorded during this catalog import.
  const changeMeta = {
    changedBy: process.env.CATALOG_CHANGED_BY || "catalog_import",
    changedAt: generatedAt || new Date().toISOString(),
    reason: `Import du catalogue ${version}`
  };
  // availability.status can be nested in a JSONB column; normalize reads.
  return { version, generatedAt, variantEffectMap, existingColors, existingSprites, existingVariants, changeMeta };
}

module.exports = { createImportContext };
