"use strict";

const ENTITY_TYPES = Object.freeze(["sprite", "variant"]);

const EVENT_TYPES = Object.freeze({
  SPRITE_CREATED: "sprite.created",
  SPRITE_BOOTSTRAP: "sprite.bootstrap",
  SPRITE_UPDATED: "sprite.updated",
  SPRITE_ARCHIVED: "sprite.archived",
  VARIANT_CREATED: "variant.created",
  VARIANT_BOOTSTRAP: "variant.bootstrap",
  VARIANT_UPDATED: "variant.updated",
  VARIANT_ARCHIVED: "variant.archived",
  VARIANT_WITHDRAWN: "variant.withdrawn"
});

const GENESIS_EVENT_TYPES = new Set([
  EVENT_TYPES.SPRITE_CREATED,
  EVENT_TYPES.SPRITE_BOOTSTRAP,
  EVENT_TYPES.VARIANT_CREATED,
  EVENT_TYPES.VARIANT_BOOTSTRAP
]);

const ARCHIVE_EVENT_TYPES = new Set([
  EVENT_TYPES.SPRITE_ARCHIVED,
  EVENT_TYPES.VARIANT_ARCHIVED,
  EVENT_TYPES.VARIANT_WITHDRAWN
]);

const UPDATE_EVENT_TYPES = new Set([EVENT_TYPES.SPRITE_UPDATED, EVENT_TYPES.VARIANT_UPDATED]);

const REGISTRY_STATUSES = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  WITHDRAWN: "withdrawn"
});

const SOURCES = Object.freeze({
  ADMIN: "admin",
  IMPORT: "import",
  SEED: "seed",
  NEWS: "news",
  BOOTSTRAP: "bootstrap",
  SYSTEM: "system"
});

/** Projection columns that may appear in a sprite snapshot / patch. */
const SPRITE_PAYLOAD_COLUMNS = Object.freeze([
  "name",
  "rarity",
  "color",
  "effect",
  "variants",
  "available",
  "added_date",
  "catalog_id",
  "slug",
  "official_name",
  "season_id",
  "event_id",
  "image",
  "introduced_in_update",
  "first_observed_at",
  "last_verified_at",
  "officially_announced_at",
  "ability",
  "acquisition",
  "availability",
  "recurrence",
  "dates",
  "missing_fields",
  "base_summon_cost",
  "data_status",
  "notes",
  "sources",
  "catalog_version",
  "catalog_generated_at",
  "is_released",
  "editorial_status",
  "editorial_updated_at"
]);

const VARIANT_PAYLOAD_COLUMNS = Object.freeze([
  "sprite_id",
  "variant_type",
  "name",
  "official_name",
  "slug",
  "rarity",
  "release_status",
  "first_observed_at",
  "summon_cost",
  "sprite_chest_drop_chance_pct",
  "extra_effect_ref",
  "effect",
  "acquisition",
  "image_path",
  "suggested_image_path",
  "availability",
  "recurrence",
  "dates",
  "missing_fields",
  "data_status",
  "sources",
  "editorial_status",
  "editorial_updated_at"
]);

function isVariantEntity(entityType) {
  return entityType === "variant";
}

function genesisEventType(entityType) {
  return entityType === "variant" ? EVENT_TYPES.VARIANT_CREATED : EVENT_TYPES.SPRITE_CREATED;
}

function updateEventType(entityType) {
  return entityType === "variant" ? EVENT_TYPES.VARIANT_UPDATED : EVENT_TYPES.SPRITE_UPDATED;
}

function archiveEventType(entityType) {
  return entityType === "variant" ? EVENT_TYPES.VARIANT_ARCHIVED : EVENT_TYPES.SPRITE_ARCHIVED;
}

function payloadColumns(entityType) {
  return entityType === "variant" ? VARIANT_PAYLOAD_COLUMNS : SPRITE_PAYLOAD_COLUMNS;
}

module.exports = {
  ENTITY_TYPES,
  EVENT_TYPES,
  GENESIS_EVENT_TYPES,
  ARCHIVE_EVENT_TYPES,
  UPDATE_EVENT_TYPES,
  REGISTRY_STATUSES,
  SOURCES,
  SPRITE_PAYLOAD_COLUMNS,
  VARIANT_PAYLOAD_COLUMNS,
  isVariantEntity,
  genesisEventType,
  updateEventType,
  archiveEventType,
  payloadColumns
};
