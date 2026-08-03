"use strict";

// Étape 56 — passport_stat_snapshots (INTEGER user ids).
const { pool } = require("./db");

const SNAPSHOT_REASONS = Object.freeze({
  CATALOGUE_VERSION: "catalogue_version",
  MILESTONE: "milestone",
  DAILY: "daily"
});

const MILESTONE_CODES = new Set(["collection_25", "collection_50", "collection_75", "collection_100"]);

async function ensurePassportStatSnapshots(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS passport_stat_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      catalogue_version VARCHAR(80) NOT NULL,
      owned_sprite_count INTEGER NOT NULL DEFAULT 0,
      owned_variant_count INTEGER NOT NULL DEFAULT 0,
      released_variant_count INTEGER NOT NULL DEFAULT 0,
      completion_rate NUMERIC(10, 4) NOT NULL DEFAULT 0,
      collection_coverage_rate NUMERIC(10, 4) NOT NULL DEFAULT 0,
      completed_event_count INTEGER NOT NULL DEFAULT 0,
      comparison_count INTEGER NOT NULL DEFAULT 0,
      reason VARCHAR(40) NOT NULL DEFAULT 'daily',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_passport_stat_snapshots_user_time
      ON passport_stat_snapshots (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_passport_stat_snapshots_user_version
      ON passport_stat_snapshots (user_id, catalogue_version);
  `);
}

async function getLatestSnapshot(userId, db = pool) {
  const result = await db.query(
    `SELECT * FROM passport_stat_snapshots
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function hasSnapshotSince(userId, sinceDate, db = pool) {
  const result = await db.query(
    `SELECT 1 FROM passport_stat_snapshots
     WHERE user_id = $1 AND created_at >= $2
     LIMIT 1`,
    [userId, sinceDate]
  );
  return result.rows.length > 0;
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Insert a snapshot row. Does not dedupe — callers decide when to create.
 */
async function createPassportStatSnapshot(userId, stats, { reason = SNAPSHOT_REASONS.DAILY, db = pool } = {}) {
  const result = await db.query(
    `INSERT INTO passport_stat_snapshots (
       user_id, catalogue_version,
       owned_sprite_count, owned_variant_count, released_variant_count,
       completion_rate, collection_coverage_rate,
       completed_event_count, comparison_count, reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      userId,
      String(stats.catalogueVersion || "unknown").slice(0, 80),
      Number(stats.ownedSpriteCount) || 0,
      Number(stats.ownedVariantCount) || 0,
      Number(stats.releasedVariantCount) || 0,
      Number(stats.completionRate) || 0,
      Number(stats.collectionCoverageRate) || 0,
      Number(stats.completedEventCount) || 0,
      Number(stats.comparisonCount) || 0,
      String(reason || SNAPSHOT_REASONS.DAILY).slice(0, 40)
    ]
  );
  return result.rows[0] || null;
}

/**
 * Decide whether to snapshot after a passport refresh.
 * Creates at most one row, preferring catalogue_version > milestone > daily.
 */
async function maybeCreatePassportStatSnapshot(
  userId,
  stats,
  { unlockedCodes = [], collectionChanged = false, db = pool } = {}
) {
  await ensurePassportStatSnapshots(db);
  const last = await getLatestSnapshot(userId, db);
  const catalogueVersion = String(stats.catalogueVersion || "");
  const reasons = [];

  if (!last || String(last.catalogue_version) !== catalogueVersion) {
    reasons.push(SNAPSHOT_REASONS.CATALOGUE_VERSION);
  }

  const hitMilestone = (unlockedCodes || []).some((code) => MILESTONE_CODES.has(String(code)));
  if (hitMilestone) reasons.push(SNAPSHOT_REASONS.MILESTONE);

  if (collectionChanged) {
    const hasToday = await hasSnapshotSince(userId, startOfUtcDay(), db);
    if (!hasToday) reasons.push(SNAPSHOT_REASONS.DAILY);
  }

  if (!reasons.length) return null;

  const priority = [SNAPSHOT_REASONS.CATALOGUE_VERSION, SNAPSHOT_REASONS.MILESTONE, SNAPSHOT_REASONS.DAILY];
  const reason = priority.find((r) => reasons.includes(r)) || SNAPSHOT_REASONS.DAILY;
  return createPassportStatSnapshot(userId, stats, { reason, db });
}

module.exports = {
  SNAPSHOT_REASONS,
  MILESTONE_CODES,
  ensurePassportStatSnapshots,
  getLatestSnapshot,
  createPassportStatSnapshot,
  maybeCreatePassportStatSnapshot
};
