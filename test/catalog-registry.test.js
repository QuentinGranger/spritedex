"use strict";

const assert = require("node:assert");
const {
  computeContentHash,
  canonicalJson,
  reduceEvents,
  EVENT_TYPES,
  applyEvent
} = require("../server/catalog-registry");

// Pure unit tests (no database) for hash chaining + reducer.

const hash1 = computeContentHash({
  entityType: "sprite",
  entityId: "sprite_test",
  parentSpriteId: null,
  seq: 1,
  eventType: EVENT_TYPES.SPRITE_CREATED,
  occurredAt: "2026-01-01T00:00:00.000Z",
  source: "seed",
  payload: { snapshot: { name: "Test", rarity: "Rare" } },
  prevContentHash: null
});
assert.match(hash1, /^[a-f0-9]{64}$/);

const hash1b = computeContentHash({
  entityType: "sprite",
  entityId: "sprite_test",
  parentSpriteId: null,
  seq: 1,
  eventType: EVENT_TYPES.SPRITE_CREATED,
  occurredAt: "2026-01-01T00:00:00.000Z",
  source: "seed",
  payload: { snapshot: { rarity: "Rare", name: "Test" } },
  prevContentHash: null
});
assert.strictEqual(hash1, hash1b, "canonical key order must not change the hash");

const hash2 = computeContentHash({
  entityType: "sprite",
  entityId: "sprite_test",
  parentSpriteId: null,
  seq: 2,
  eventType: EVENT_TYPES.SPRITE_UPDATED,
  occurredAt: "2026-01-02T00:00:00.000Z",
  source: "admin",
  payload: { patch: { rarity: "Epic" } },
  prevContentHash: hash1
});
assert.notStrictEqual(hash1, hash2);

const tampered = computeContentHash({
  entityType: "sprite",
  entityId: "sprite_test",
  parentSpriteId: null,
  seq: 2,
  eventType: EVENT_TYPES.SPRITE_UPDATED,
  occurredAt: "2026-01-02T00:00:00.000Z",
  source: "admin",
  payload: { patch: { rarity: "Epic" } },
  prevContentHash: "0".repeat(64)
});
assert.notStrictEqual(tampered, hash2, "wrong prev hash must change content hash");

const state = reduceEvents(
  [
    {
      entity_type: "sprite",
      entity_id: "sprite_test",
      event_type: EVENT_TYPES.SPRITE_CREATED,
      payload: { snapshot: { name: "Test", rarity: "Rare", color: "blue" } }
    },
    {
      entity_type: "sprite",
      entity_id: "sprite_test",
      event_type: EVENT_TYPES.SPRITE_UPDATED,
      payload: { patch: { rarity: "Epic" } }
    },
    {
      entity_type: "sprite",
      entity_id: "sprite_test",
      event_type: EVENT_TYPES.SPRITE_ARCHIVED,
      payload: { reason: "retired" }
    }
  ],
  { entityType: "sprite", entityId: "sprite_test" }
);

assert.strictEqual(state.fields.name, "Test");
assert.strictEqual(state.fields.rarity, "Epic");
assert.strictEqual(state.fields.color, "blue");
assert.strictEqual(state.status, "archived");

const variantState = applyEvent(null, {
  entityType: "variant",
  entityId: "sprite_test::Base",
  parentSpriteId: "sprite_test",
  eventType: EVENT_TYPES.VARIANT_CREATED,
  payload: { snapshot: { sprite_id: "sprite_test", variant_type: "Base", name: "Test Base" } }
});
assert.strictEqual(variantState.parentSpriteId, "sprite_test");
assert.strictEqual(variantState.fields.variant_type, "Base");

assert.ok(canonicalJson({ b: 1, a: 2 }).includes('"a"'));

const {
  reverseToInitialSnapshot,
  forwardPatchesFromHistory,
  diffPatch
} = require("../server/catalog-registry/history-map");

const current = { name: "Water", rarity: "Epic", availability: { status: "available" } };
const history = [
  {
    field: "rarity",
    previous_value: "Rare",
    new_value: "Epic",
    changed_at: "2026-06-10T00:00:00.000Z"
  },
  {
    field: "availability.status",
    previous_value: "upcoming",
    new_value: "available",
    changed_at: "2026-06-15T00:00:00.000Z"
  }
];
const initial = reverseToInitialSnapshot(current, history);
assert.strictEqual(initial.rarity, "Rare");
assert.strictEqual(initial.availability.status, "upcoming");
const forwards = forwardPatchesFromHistory(history);
assert.strictEqual(forwards.length, 2);
assert.strictEqual(forwards[0].patch.rarity, "Epic");
assert.deepStrictEqual(diffPatch({ a: 1 }, { a: 1, b: 2 }), { b: 2 });

console.log("catalog-registry: hash/reduce/history unit tests ok");
