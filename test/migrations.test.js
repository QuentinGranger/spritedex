// Pure contract tests for the versioned migration registry.
const assert = require("node:assert");
const { loadMigrations, validateHistory } = require("../server/migrations");

const migrations = loadMigrations();

assert.ok(migrations.length > 0, "at least one baseline migration is required");
assert.deepStrictEqual(
  migrations.map((migration) => migration.id),
  [...migrations].sort((a, b) => a.id.localeCompare(b.id)).map((migration) => migration.id),
  "migration ids must be sorted and deterministic"
);

for (const migration of migrations) {
  assert.match(migration.id, /^\d{3,}_[a-z0-9][a-z0-9_-]*$/);
  assert.ok(migration.description);
  assert.strictEqual(typeof migration.up, "function");
  assert.ok(typeof migration.down === "function" || migration.irreversible === true);
  assert.match(migration.checksum, /^[a-f0-9]{64}$/);
}

assert.doesNotThrow(() =>
  validateHistory(
    migrations,
    migrations.map((migration) => ({
      id: migration.id,
      checksum: migration.checksum
    }))
  )
);

assert.throws(
  () => validateHistory(migrations, [{ id: migrations[0].id, checksum: "0".repeat(64) }]),
  /Checksum mismatch/
);
assert.throws(
  () => validateHistory(migrations, [{ id: "999_missing", checksum: "0".repeat(64) }]),
  /missing from this release/
);

console.log(`migration registry: ${migrations.length} valid migration(s)`);
