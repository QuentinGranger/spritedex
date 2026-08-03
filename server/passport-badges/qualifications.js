"use strict";

const { pool } = require("../db");
const { EARLY_COLLECTOR_BEFORE } = require("./content");
const { awardBadgeByCode } = require("./unlocking");

/**
 * Étape 43 — founder badge requires create + another member + 24h age.
 * Remains valid if the squad is later closed (historical membership counts).
 */
async function findQualifyingFoundedSquad(userId, db = pool) {
  const result = await db.query(
    `SELECT s.id, s.code, s.name, s.created_at
     FROM squads s
     WHERE s.created_by = $1
       AND s.created_at <= NOW() - INTERVAL '24 hours'
       AND EXISTS (
         SELECT 1 FROM squad_members sm
         WHERE sm.squad_id = s.id
           AND sm.user_id <> s.created_by
       )
     ORDER BY s.created_at ASC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function userQualifiesAsSquadFounder(userId, db = pool) {
  return Boolean(await findQualifyingFoundedSquad(userId, db));
}

async function maybeAwardSquadFounder(userId, db = pool) {
  const squad = await findQualifyingFoundedSquad(userId, db);
  if (!squad) return null;
  return awardBadgeByCode(userId, "squad_founder", {
    evidence: {
      squadId: squad.id,
      squadCode: squad.code,
      squadName: squad.name,
      squadCreatedAt: squad.created_at,
      ruleType: "squad_founder_qualified"
    },
    db
  });
}

/** Étape 46 — stamp a catalogue review when coverage is high enough. */
async function recordCatalogueReview(userId, catalogueVersion, coverageRate, db = pool) {
  const rate = Number(coverageRate);
  const version = String(catalogueVersion || "").slice(0, 80);
  if (!version || !Number.isFinite(rate) || rate < 90) return null;
  const result = await db.query(
    `INSERT INTO user_catalogue_reviews (user_id, catalogue_version, reviewed_at, completion_coverage_rate)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (user_id, catalogue_version) DO UPDATE SET
       reviewed_at = NOW(),
       completion_coverage_rate = GREATEST(
         user_catalogue_reviews.completion_coverage_rate,
         EXCLUDED.completion_coverage_rate
       )
     RETURNING *`,
    [userId, version, rate]
  );
  return result.rows[0] || null;
}

async function evaluateArchivistQualified(
  userId,
  { minCoverage = 90, minVersions = 3, maxGapDays = 30, db = pool } = {}
) {
  const reviews = await db.query(
    `SELECT catalogue_version, reviewed_at, completion_coverage_rate
     FROM user_catalogue_reviews
     WHERE user_id = $1 AND completion_coverage_rate >= $2
     ORDER BY reviewed_at ASC`,
    [userId, minCoverage]
  );
  const rows = reviews.rows;
  if (rows.length < minVersions) return false;
  const versions = new Set(rows.map((r) => String(r.catalogue_version)));
  if (versions.size < minVersions) return false;

  const maxGapMs = maxGapDays * 24 * 60 * 60 * 1000;
  for (let i = 1; i < rows.length; i++) {
    const gap = new Date(rows[i].reviewed_at).getTime() - new Date(rows[i - 1].reviewed_at).getTime();
    if (gap > maxGapMs) return false;
  }
  // Current catalogue must not sit unverified for more than maxGapDays.
  const last = rows[rows.length - 1];
  if (Date.now() - new Date(last.reviewed_at).getTime() > maxGapMs) return false;
  return true;
}

/**
 * Étapes 47–48 — Early Collector: fixed cutoff + real collection + verified identity.
 */
async function evaluateEarlyCollectorQualified(userId, ruleConfig = {}, db = pool) {
  const beforeIso = ruleConfig.before || EARLY_COLLECTOR_BEFORE;
  const before = new Date(beforeIso);
  if (!Number.isFinite(before.getTime())) return false;

  const userRes = await db.query(
    `SELECT id, created_at, email_verified, oauth_provider, suspended_until, deleted_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRes.rows.length) return false;
  const user = userRes.rows[0];
  if (user.deleted_at) return false;
  if (user.suspended_until && new Date(user.suspended_until) > new Date()) return false;
  if (new Date(user.created_at) >= before) return false;

  const verified = !!user.email_verified || !!(user.oauth_provider && String(user.oauth_provider).trim());
  if (!verified) return false;

  const owned = await db.query(
    `SELECT 1 FROM sprite_entries
     WHERE user_id = $1 AND LOWER(status) = 'owned'
     LIMIT 1`,
    [userId]
  );
  return owned.rows.length > 0;
}

module.exports = {
  findQualifyingFoundedSquad,
  userQualifiesAsSquadFounder,
  maybeAwardSquadFounder,
  recordCatalogueReview,
  evaluateArchivistQualified,
  evaluateEarlyCollectorQualified
};
