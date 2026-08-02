// Versioned PostgreSQL migration runner.
//
// Migrations are immutable CommonJS modules in ../migrations named
// NNN_description.js. Every migration needs an `up` function and either a
// `down` function or an explicit `irreversible: true` declaration.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("@/infrastructure/database/postgres-pool");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "..", "migrations");
const ADVISORY_LOCK_KEY = 716_334_921;
const MIGRATION_FILE_RE = /^(\d{3,})_[a-z0-9][a-z0-9_-]*\.js$/;

function checksum(source) {
  return crypto.createHash("sha256").update(source).digest("hex");
}

function readMigrationFiles(directory = MIGRATIONS_DIR) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => MIGRATION_FILE_RE.test(file))
    .sort((a, b) => a.localeCompare(b, "en"));
}

function loadMigrations(directory = MIGRATIONS_DIR) {
  const seenIds = new Set();
  return readMigrationFiles(directory).map((file) => {
    const filenameId = file.slice(0, -3);
    const sourcePath = path.join(directory, file);
    const source = fs.readFileSync(sourcePath, "utf8");
    // Requiring after the source read means the recorded checksum represents
    // exactly the migration that will be executed.
    delete require.cache[require.resolve(sourcePath)];
    const migration = require(sourcePath);
    if (!migration || typeof migration !== "object") {
      throw new Error(`Migration ${file} must export an object.`);
    }
    if (migration.id !== filenameId) {
      throw new Error(`Migration ${file} must use id '${filenameId}'.`);
    }
    if (seenIds.has(migration.id)) {
      throw new Error(`Duplicate migration id '${migration.id}'.`);
    }
    seenIds.add(migration.id);
    if (typeof migration.description !== "string" || !migration.description.trim()) {
      throw new Error(`Migration ${migration.id} needs a non-empty description.`);
    }
    if (typeof migration.up !== "function") {
      throw new Error(`Migration ${migration.id} needs an async up function.`);
    }
    if (typeof migration.down !== "function" && migration.irreversible !== true) {
      throw new Error(`Migration ${migration.id} needs a down function or irreversible: true.`);
    }
    if (migration.transaction != null && typeof migration.transaction !== "boolean") {
      throw new Error(`Migration ${migration.id} transaction must be boolean when provided.`);
    }
    return {
      ...migration,
      checksum: checksum(source),
      filename: file,
      transaction: migration.transaction !== false
    };
  });
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(160) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      description TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0)
    )
  `);
}

async function appliedMigrations(client) {
  const result = await client.query(
    "SELECT id, checksum, description, applied_at, execution_ms FROM schema_migrations ORDER BY id ASC"
  );
  return result.rows;
}

function validateHistory(migrations, applied) {
  const byId = new Map(migrations.map((migration) => [migration.id, migration]));
  for (const row of applied) {
    const migration = byId.get(row.id);
    if (!migration) {
      throw new Error(`Applied migration '${row.id}' is missing from this release. Restore its immutable file before deploying.`);
    }
    if (migration.checksum !== row.checksum) {
      throw new Error(`Checksum mismatch for applied migration '${row.id}'. Applied migrations must never be edited.`);
    }
  }
}

async function withMigrationLock(work) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await ensureMigrationTable(client);
    return await work(client);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    } catch (error) {
      console.error("[migrations] advisory unlock failed:", error.message);
    }
    client.release();
  }
}

async function applyMigration(client, migration) {
  const startedAt = Date.now();
  const context = { client, pool, migrationId: migration.id };
  if (migration.transaction) await client.query("BEGIN");
  try {
    await migration.up(context);
    const elapsed = Date.now() - startedAt;
    await client.query(
      "INSERT INTO schema_migrations (id, checksum, description, execution_ms) VALUES ($1, $2, $3, $4)",
      [migration.id, migration.checksum, migration.description, elapsed]
    );
    if (migration.transaction) await client.query("COMMIT");
    return elapsed;
  } catch (error) {
    if (migration.transaction) await client.query("ROLLBACK").catch(() => {});
    throw new Error(`Migration ${migration.id} failed: ${error.message}`);
  }
}

async function migrate({ dryRun = false } = {}) {
  const migrations = loadMigrations();
  return withMigrationLock(async (client) => {
    const applied = await appliedMigrations(client);
    validateHistory(migrations, applied);
    const appliedIds = new Set(applied.map((row) => row.id));
    const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
    if (dryRun) return { applied: [], pending: pending.map((migration) => migration.id), dryRun: true };

    const executed = [];
    for (const migration of pending) {
      console.log(`[migrations] applying ${migration.id}: ${migration.description}`);
      const executionMs = await applyMigration(client, migration);
      executed.push({ id: migration.id, executionMs });
      console.log(`[migrations] applied ${migration.id} in ${executionMs}ms`);
    }
    return { applied: executed, pending: [], dryRun: false };
  });
}

async function status() {
  const migrations = loadMigrations();
  return withMigrationLock(async (client) => {
    const applied = await appliedMigrations(client);
    validateHistory(migrations, applied);
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    return migrations.map((migration) => ({
      id: migration.id,
      description: migration.description,
      irreversible: migration.irreversible === true,
      applied: appliedById.has(migration.id),
      appliedAt: appliedById.get(migration.id)?.applied_at || null
    }));
  });
}

async function rollback({ steps = 1 } = {}) {
  const count = Number(steps);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("Rollback steps must be a positive integer.");
  }
  const migrations = loadMigrations();
  return withMigrationLock(async (client) => {
    const applied = await appliedMigrations(client);
    validateHistory(migrations, applied);
    const byId = new Map(migrations.map((migration) => [migration.id, migration]));
    const targets = applied.slice(-count).reverse();
    if (targets.length !== count) throw new Error(`Cannot rollback ${count} migration(s); only ${targets.length} applied.`);
    const rolledBack = [];
    for (const row of targets) {
      const migration = byId.get(row.id);
      if (migration.irreversible === true || typeof migration.down !== "function") {
        throw new Error(`Migration ${migration.id} is irreversible. Restore from a database backup instead of forcing a rollback.`);
      }
      if (migration.transaction) await client.query("BEGIN");
      try {
        await migration.down({ client, pool, migrationId: migration.id });
        await client.query("DELETE FROM schema_migrations WHERE id = $1", [migration.id]);
        if (migration.transaction) await client.query("COMMIT");
        rolledBack.push(migration.id);
      } catch (error) {
        if (migration.transaction) await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Rollback ${migration.id} failed: ${error.message}`);
      }
    }
    return rolledBack;
  });
}

module.exports = { MIGRATIONS_DIR, applyMigration, loadMigrations, migrate, rollback, status, validateHistory };
