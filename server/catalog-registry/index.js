"use strict";

const { ensureCatalogRegistrySchema } = require("./schema");
const { computeContentHash, canonicalJson } = require("./hash");
const types = require("./types");
const { reduceEvents, applyEvent, snapshotFromRow } = require("./reduce");
const {
  CatalogRegistryError,
  appendCatalogEvent,
  createCatalogEntity,
  updateCatalogEntity,
  archiveCatalogEntity,
  latestEvent,
  loadEvents
} = require("./append");
const { reconstructEntity } = require("./reconstruct");
const { verifyEntityChain, verifyAllCatalogRegistry } = require("./verify");
const { bootstrapCatalogRegistry } = require("./bootstrap");
const { syncSpriteSnapshot, syncVariantSnapshot, patchEntity, diffPatch } = require("./sync");
const {
  backfillCatalogRegistryFromHistory,
  rebuildEntityChain,
  snapshotFromCatalogSprite,
  snapshotFromCatalogVariant
} = require("./backfill");

module.exports = {
  ensureCatalogRegistrySchema,
  computeContentHash,
  canonicalJson,
  ...types,
  reduceEvents,
  applyEvent,
  snapshotFromRow,
  CatalogRegistryError,
  appendCatalogEvent,
  createCatalogEntity,
  updateCatalogEntity,
  archiveCatalogEntity,
  latestEvent,
  loadEvents,
  reconstructEntity,
  verifyEntityChain,
  verifyAllCatalogRegistry,
  bootstrapCatalogRegistry,
  syncSpriteSnapshot,
  syncVariantSnapshot,
  patchEntity,
  diffPatch,
  backfillCatalogRegistryFromHistory,
  rebuildEntityChain,
  snapshotFromCatalogSprite,
  snapshotFromCatalogVariant
};
