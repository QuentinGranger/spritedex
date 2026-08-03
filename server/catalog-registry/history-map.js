"use strict";

/**
 * Map catalog_change_history.field keys → projection columns / nested paths.
 * Covers admin camelCase keys and import dotted keys.
 */
const HISTORY_FIELD_MAP = Object.freeze({
  catalogId: { column: "catalog_id" },
  slug: { column: "slug" },
  name: { column: "name" },
  officialName: { column: "official_name" },
  rarity: { column: "rarity" },
  color: { column: "color" },
  effect: { column: "effect" },
  variants: { column: "variants" },
  available: { column: "available" },
  image: { column: "image" },
  imagePath: { column: "image_path" },
  suggestedImagePath: { column: "suggested_image_path" },
  eventId: { column: "event_id" },
  seasonId: { column: "season_id" },
  dataStatus: { column: "data_status" },
  introducedInUpdate: { column: "introduced_in_update" },
  firstObservedAt: { column: "first_observed_at" },
  lastVerifiedAt: { column: "last_verified_at" },
  officiallyAnnouncedAt: { column: "officially_announced_at" },
  baseSummonCost: { column: "base_summon_cost" },
  ability: { column: "ability" },
  acquisition: { column: "acquisition" },
  availability: { column: "availability" },
  "availability.status": { column: "availability", nested: "status" },
  recurrence: { column: "recurrence" },
  dates: { column: "dates" },
  missingFields: { column: "missing_fields" },
  notes: { column: "notes" },
  sources: { column: "sources" },
  catalogVersion: { column: "catalog_version" },
  isReleased: { column: "is_released" },
  editorialStatus: { column: "editorial_status" },
  releaseStatus: { column: "release_status" }
});

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function applyFieldValue(fields, fieldKey, value) {
  const mapping = HISTORY_FIELD_MAP[fieldKey];
  if (!mapping) {
    // Unknown keys are stored under a namespaced bag so history is not lost.
    fields._unmapped = fields._unmapped || {};
    fields._unmapped[fieldKey] = value;
    return;
  }
  if (mapping.nested) {
    const current =
      fields[mapping.column] && typeof fields[mapping.column] === "object" ? { ...fields[mapping.column] } : {};
    current[mapping.nested] = value;
    fields[mapping.column] = current;
    return;
  }
  fields[mapping.column] = value;
}

/**
 * Walk history newest→oldest applying previous_value to recover the earliest known state.
 */
function reverseToInitialSnapshot(currentSnapshot, historyAsc) {
  const state = cloneJson(currentSnapshot) || {};
  for (let i = historyAsc.length - 1; i >= 0; i--) {
    const entry = historyAsc[i];
    applyFieldValue(state, entry.field, entry.previous_value);
  }
  delete state._unmapped;
  return state;
}

/**
 * Build ordered forward patches from history (oldest→newest).
 */
function forwardPatchesFromHistory(historyAsc) {
  return historyAsc.map((entry) => {
    const patch = {};
    applyFieldValue(patch, entry.field, entry.new_value);
    delete patch._unmapped;
    return {
      patch,
      occurredAt: entry.changed_at,
      actorLabel: entry.changed_by || null,
      reason: entry.reason || null,
      sourceId: entry.source_id || null,
      field: entry.field
    };
  });
}

function diffPatch(fromFields, toFields) {
  const patch = {};
  const keys = new Set([...Object.keys(fromFields || {}), ...Object.keys(toFields || {})]);
  for (const key of keys) {
    if (key === "_unmapped") continue;
    if (JSON.stringify(fromFields?.[key] ?? null) !== JSON.stringify(toFields?.[key] ?? null)) {
      patch[key] = toFields?.[key] ?? null;
    }
  }
  return patch;
}

module.exports = {
  HISTORY_FIELD_MAP,
  cloneJson,
  applyFieldValue,
  reverseToInitialSnapshot,
  forwardPatchesFromHistory,
  diffPatch
};
