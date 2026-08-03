"use strict";

// Étapes 76–77 — catalogue archival contract + soft anti-fraud for declared collections.
// Never block a user solely for updating their collection quickly.
const { pool } = require("./db");

const MASS_CHANGE_THRESHOLD = Number(process.env.PASSPORT_MASS_CHANGE_THRESHOLD) || 50;
const FLIP_WINDOW_MINUTES = Number(process.env.PASSPORT_FLIP_WINDOW_MINUTES) || 60;
const FLIP_THRESHOLD = Number(process.env.PASSPORT_FLIP_THRESHOLD) || 8;
const IMPORT_DELETE_WARN = Number(process.env.PASSPORT_IMPORT_DELETE_WARN) || 80;

let tablesReady = false;

async function ensurePassportIntegrityTables(db = pool) {
  if (tablesReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS collection_change_log (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source VARCHAR(40) NOT NULL,
      change_count INTEGER NOT NULL DEFAULT 0,
      owned_gains INTEGER NOT NULL DEFAULT 0,
      owned_losses INTEGER NOT NULL DEFAULT 0,
      flip_count INTEGER NOT NULL DEFAULT 0,
      deleted_count INTEGER NOT NULL DEFAULT 0,
      flags TEXT[] NOT NULL DEFAULT '{}',
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_collection_change_log_user
      ON collection_change_log (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_collection_change_log_flags
      ON collection_change_log USING GIN (flags);
  `);
  // Help flip detection queries.
  await db
    .query(
      `
    CREATE INDEX IF NOT EXISTS idx_collection_history_user_sprite_time
      ON collection_history (user_id, sprite_id, created_at DESC);
  `
    )
    .catch(() => {});
  tablesReady = true;
}

function isOwnedMissingFlip(oldStatus, newStatus) {
  const a = String(oldStatus || "").toLowerCase();
  const b = String(newStatus || "").toLowerCase();
  return (a === "owned" && b === "missing") || (a === "missing" && b === "owned");
}

/**
 * Persist status transitions (Étape 77 — keep status history).
 * `sprite_id` column historically stores the variant id for passport history.
 */
async function recordStatusHistory(userId, changes, db = pool) {
  const rows = (changes || []).filter((c) => c && c.variantId && c.oldStatus !== c.newStatus);
  if (!rows.length) return 0;
  const values = [];
  const params = [];
  let i = 1;
  for (const c of rows) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(userId, String(c.variantId), c.oldStatus || null, c.newStatus || "new");
  }
  await db.query(
    `INSERT INTO collection_history (user_id, sprite_id, old_status, new_status)
     VALUES ${values.join(", ")}`,
    params
  );
  return rows.length;
}

function summarizeChanges(changes = []) {
  let ownedGains = 0;
  let ownedLosses = 0;
  let flips = 0;
  for (const c of changes) {
    const oldS = String(c.oldStatus || "").toLowerCase();
    const newS = String(c.newStatus || "").toLowerCase();
    if (newS === "owned" && oldS !== "owned") ownedGains += 1;
    if (oldS === "owned" && newS !== "owned") ownedLosses += 1;
    if (isOwnedMissingFlip(oldS, newS)) flips += 1;
  }
  return {
    changeCount: changes.length,
    ownedGains,
    ownedLosses,
    flipCount: flips
  };
}

/**
 * Detect repeated owned↔missing flips in the recent window (soft signal).
 */
async function countRecentOwnedMissingFlips(userId, { windowMinutes = FLIP_WINDOW_MINUTES, db = pool } = {}) {
  await ensurePassportIntegrityTables(db);
  const result = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM collection_history
     WHERE user_id = $1
       AND created_at > NOW() - ($2::int * INTERVAL '1 minute')
       AND (
         (old_status = 'owned' AND new_status = 'missing')
         OR (old_status = 'missing' AND new_status = 'owned')
       )`,
    [userId, windowMinutes]
  );
  return result.rows[0]?.count || 0;
}

/**
 * Soft incoherence checks for bulk import/replace (never blocks).
 */
function detectImportIncoherence({
  previousCount = 0,
  nextCount = 0,
  deletedCount = 0,
  changes = [],
  ownedRatio = null
} = {}) {
  const flags = [];
  const summary = summarizeChanges(changes);

  if (deletedCount >= IMPORT_DELETE_WARN) {
    flags.push("import_large_deletion");
  }
  if (previousCount >= 20 && nextCount === 0) {
    flags.push("import_wiped_collection");
  }
  if (summary.ownedGains >= MASS_CHANGE_THRESHOLD && summary.ownedLosses >= MASS_CHANGE_THRESHOLD) {
    flags.push("import_churn_owned");
  }
  if (ownedRatio != null && ownedRatio >= 0.95 && nextCount >= 100 && previousCount < 5) {
    flags.push("import_sudden_near_complete");
  }
  if (summary.flipCount >= Math.max(10, Math.floor(summary.changeCount * 0.3))) {
    flags.push("import_many_owned_missing_flips");
  }
  return { flags, summary, deletedCount };
}

/**
 * Journal mass / suspicious changes without rejecting the write.
 */
async function logCollectionIntegrityEvent(
  userId,
  { source = "sync", changes = [], deletedCount = 0, extraFlags = [], details = {} } = {}
) {
  await ensurePassportIntegrityTables();
  const summary = summarizeChanges(changes);
  const flags = new Set(extraFlags || []);

  if (summary.changeCount >= MASS_CHANGE_THRESHOLD) {
    flags.add("mass_status_change");
  }
  if (summary.flipCount >= Math.max(5, Math.floor(summary.changeCount * 0.25))) {
    flags.add("bulk_owned_missing_flips");
  }
  if (deletedCount >= IMPORT_DELETE_WARN) {
    flags.add("import_large_deletion");
  }

  const recentFlips = await countRecentOwnedMissingFlips(userId).catch(() => 0);
  if (recentFlips >= FLIP_THRESHOLD) {
    flags.add("repeated_owned_missing_flips");
  }

  // Always journal when flagged or mass; also journal imports with deletions.
  if (!flags.size && summary.changeCount < MASS_CHANGE_THRESHOLD && deletedCount < 1) {
    return { logged: false, flags: [], summary, recentFlips };
  }

  const flagList = [...flags];
  await pool.query(
    `INSERT INTO collection_change_log
       (user_id, source, change_count, owned_gains, owned_losses, flip_count, deleted_count, flags, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::jsonb)`,
    [
      userId,
      String(source).slice(0, 40),
      summary.changeCount,
      summary.ownedGains,
      summary.ownedLosses,
      summary.flipCount,
      deletedCount || 0,
      flagList,
      JSON.stringify({ ...details, recentFlips })
    ]
  );

  if (flagList.length) {
    console.warn(
      `[passport-integrity] user=${userId} source=${source} flags=${flagList.join(",")}` +
        ` changes=${summary.changeCount} flips=${summary.flipCount} deleted=${deletedCount || 0}`
    );
  }

  return { logged: true, flags: flagList, summary, recentFlips };
}

/**
 * Étape 76 — document + verify archival safety invariants for tests/ops.
 * Live stats already exclude archived via isVariantReleasedAndActiveServer.
 */
async function verifyArchiveSafety(userId, { db = pool } = {}) {
  const [entries, history, badges, snapshots, peaks, summary] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS c FROM sprite_entries WHERE user_id = $1", [userId]),
    db.query("SELECT COUNT(*)::int AS c FROM collection_history WHERE user_id = $1", [userId]),
    db
      .query(
        `SELECT COUNT(*)::int AS c FROM user_badges
       WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId]
      )
      .catch(() => ({ rows: [{ c: 0 }] })),
    db
      .query("SELECT COUNT(*)::int AS c FROM passport_stat_snapshots WHERE user_id = $1", [userId])
      .catch(() => ({ rows: [{ c: 0 }] })),
    db.query("SELECT peak_completion_rate, peak_catalogue_version FROM user_collection_peaks WHERE user_id = $1", [
      userId
    ]),
    db.query(
      "SELECT catalogue_version, released_variant_count, completion_rate FROM user_passport_summaries WHERE user_id = $1",
      [userId]
    )
  ]);

  return {
    ownershipRowsKept: entries.rows[0].c,
    historyRowsKept: history.rows[0].c,
    activeBadgesKept: badges.rows[0].c,
    snapshotsKept: snapshots.rows[0].c,
    personalBestRate: peaks.rows[0] ? Number(peaks.rows[0].peak_completion_rate) : null,
    personalBestCatalogueVersion: peaks.rows[0]?.peak_catalogue_version || null,
    summaryCatalogueVersion: summary.rows[0]?.catalogue_version || null,
    summaryReleasedVariantCount: summary.rows[0] ? Number(summary.rows[0].released_variant_count) : null,
    summaryCompletionRate: summary.rows[0] ? Number(summary.rows[0].completion_rate) : null
  };
}

/** Étape 79 — passport must not expose global rankings. */
const PASSPORT_RANKINGS_DEFERRED = Object.freeze({
  globalLeaderboard: false,
  collectionTop: false,
  countryRanking: false,
  squadRanking: false,
  declaredCountRewards: false,
  reason: [
    "few_users_at_launch",
    "declarative_collection",
    "fake_account_risk",
    "discourages_newcomers",
    "empty_platform_perception"
  ]
});

module.exports = {
  MASS_CHANGE_THRESHOLD,
  FLIP_WINDOW_MINUTES,
  FLIP_THRESHOLD,
  IMPORT_DELETE_WARN,
  PASSPORT_RANKINGS_DEFERRED,
  ensurePassportIntegrityTables,
  recordStatusHistory,
  summarizeChanges,
  isOwnedMissingFlip,
  countRecentOwnedMissingFlips,
  detectImportIncoherence,
  logCollectionIntegrityEvent,
  verifyArchiveSafety
};
