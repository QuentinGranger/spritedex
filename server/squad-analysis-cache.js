// squad-analysis-cache.js — shared cache and version helpers for squad completion analyses.

const crypto = require("crypto");
const { pool } = require("./db");
const compare = require("./compare");

const squadAnalysisCache = new Map();
const SQUAD_ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;
const SQUAD_ANALYSIS_CACHE_MAX_ENTRIES = 300;

function pruneSquadAnalysisCache() {
  const now = Date.now();
  for (const [key, entry] of squadAnalysisCache) {
    if (entry.expiresAt <= now) squadAnalysisCache.delete(key);
  }
  if (squadAnalysisCache.size > SQUAD_ANALYSIS_CACHE_MAX_ENTRIES) {
    const sorted = [...squadAnalysisCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = sorted.slice(0, squadAnalysisCache.size - SQUAD_ANALYSIS_CACHE_MAX_ENTRIES);
    for (const [key] of toDelete) squadAnalysisCache.delete(key);
  }
}

function getSquadAnalysisCache(key) {
  pruneSquadAnalysisCache();
  const entry = squadAnalysisCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    squadAnalysisCache.delete(key);
    return null;
  }
  return entry.data;
}

function setSquadAnalysisCache(key, data) {
  pruneSquadAnalysisCache();
  squadAnalysisCache.set(key, { data, expiresAt: Date.now() + SQUAD_ANALYSIS_CACHE_TTL_MS });
}

function getSquadFilterHash(req, endpoint) {
  const sorted = Object.keys(req.query).sort();
  const params = { _endpoint: endpoint };
  for (const k of sorted) params[k] = req.query[k];
  return crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 12);
}

function computeCatalogueVersion(catalogue) {
  const active = catalogue.filter(compare.isVariantReleasedAndActiveServer);
  const payload = active
    .map(i => `${i.id}|${i.availabilityStatus || ''}|${i.endDate || ''}|${i.acquisitionMethod || ''}|${i.rarity || ''}|${i.eventId || ''}`)
    .sort()
    .join("\n");
  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 8);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  return `${today}-${hash}`;
}

async function getSquadCollectionVersion(squad) {
  const result = await pool.query(
    `SELECT
      (SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM squad_members WHERE squad_id = $1 AND status = 'active') AS user_ids,
      (SELECT MAX(updated_at)::text FROM squad_members WHERE squad_id = $1 AND status = 'active') AS members_max,
      (SELECT MAX(se.updated_at)::text FROM sprite_entries se JOIN squad_members sm ON sm.user_id = se.user_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS entries_max,
      (SELECT COUNT(*)::text FROM sprite_entries se JOIN squad_members sm ON sm.user_id = se.user_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS entries_count,
      (SELECT MAX(u.updated_at)::text FROM users u JOIN squad_members sm ON sm.user_id = u.id WHERE sm.squad_id = $1 AND sm.status = 'active') AS users_max,
      (SELECT MAX(updated_at)::text FROM collection_goals WHERE squad_id = $1) AS goals_max,
      (SELECT MAX(f.updated_at)::text FROM friendships f JOIN squad_members sm ON sm.user_id = f.requester_id OR sm.user_id = f.addressee_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS friends_max,
      (SELECT MAX(b.updated_at)::text FROM user_blocks b JOIN squad_members sm ON sm.user_id = b.blocker_id OR sm.user_id = b.blocked_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS blocks_max,
      (SELECT updated_at::text FROM squads WHERE id = $1) AS squad_updated`,
    [squad.id]
  );
  const r = result.rows[0];
  const payload = `${r.user_ids || ''}:${r.members_max || ''}:${r.entries_max || ''}:${r.entries_count || '0'}:${r.users_max || ''}:${r.goals_max || ''}:${r.friends_max || ''}:${r.blocks_max || ''}:${r.squad_updated || ''}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

function invalidateSquadAnalysisCache(squadId = null) {
  if (!squadId) {
    squadAnalysisCache.clear();
    return;
  }
  const prefix = `squad:${squadId}:`;
  for (const key of squadAnalysisCache.keys()) {
    if (key.startsWith(prefix)) squadAnalysisCache.delete(key);
  }
}

async function invalidateSquadAnalysisCacheForUser(userId) {
  const result = await pool.query(
    "SELECT squad_id FROM squad_members WHERE user_id = $1 AND status = 'active'",
    [userId]
  );
  for (const row of result.rows) {
    invalidateSquadAnalysisCache(row.squad_id);
  }
}

async function getCachedOrComputeSquadAnalysis(req, squad, viewerId, endpoint, computeFn) {
  const [catalogueAll, collectionVersion] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    getSquadCollectionVersion(squad)
  ]);
  const catalogueVersion = computeCatalogueVersion(catalogueAll);
  const filterHash = getSquadFilterHash(req, endpoint);
  const key = `squad:${squad.id}:viewer:${viewerId}:cat:${catalogueVersion}:col:${collectionVersion}:filters:${filterHash}`;
  const cached = getSquadAnalysisCache(key);
  if (cached) {
    return cached;
  }
  const data = await computeFn();
  setSquadAnalysisCache(key, data);
  return data;
}

module.exports = {
  getSquadCollectionVersion,
  computeCatalogueVersion,
  getCachedOrComputeSquadAnalysis,
  invalidateSquadAnalysisCache,
  invalidateSquadAnalysisCacheForUser
};
