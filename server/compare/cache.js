"use strict";

const { getServerCompareCatalogItems } = require("./catalog");
const { compareServerClassify, compareServerIsExplicitEntry, compareServerIsPriority } = require("./engine");
const { computeComplementarityScore } = require("./complementarity");

const COMPARE_CACHE_TTL_MS = (() => {
  const v = parseInt(process.env.COMPARE_CACHE_TTL_MS, 10);
  if (!isNaN(v)) return Math.max(30000, Math.min(120000, v));
  return 60000;
})();

const compareCatalogCache = { data: null, expiresAt: 0 };
const compareResultCache = new Map();
const MAX_COMPARE_RESULT_CACHE = 500;

const collectionCache = new Map();
const MAX_COLLECTION_CACHE = 200;

function pruneCompareResultCache() {
  const now = Date.now();
  for (const [key, entry] of compareResultCache.entries()) {
    if (entry.expiresAt < now) compareResultCache.delete(key);
  }
  if (compareResultCache.size > MAX_COMPARE_RESULT_CACHE) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, entry] of compareResultCache.entries()) {
      if (entry.createdAt < oldest) {
        oldest = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) compareResultCache.delete(oldestKey);
  }
}

function pruneCollectionCache() {
  const now = Date.now();
  for (const [key, entry] of collectionCache.entries()) {
    if (entry.expiresAt < now) collectionCache.delete(key);
  }
  if (collectionCache.size > MAX_COLLECTION_CACHE) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, entry] of collectionCache.entries()) {
      if (entry.createdAt < oldest) {
        oldest = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) collectionCache.delete(oldestKey);
  }
}

function getCompareCacheKey(userAId, userBId) {
  return `${userAId}:${userBId}`;
}

function invalidateCompareCacheForUser(userId) {
  const uid = String(userId);
  const prefix = `${uid}:`;
  const suffix = `:${uid}`;
  for (const key of compareResultCache.keys()) {
    if (key === uid || key.startsWith(prefix) || key.endsWith(suffix)) {
      compareResultCache.delete(key);
    }
  }
  // A collection change also invalidates the cached collection for this user.
  collectionCache.delete(uid);
}

async function getServerCompareCatalogItemsCached() {
  const now = Date.now();
  if (compareCatalogCache.data && compareCatalogCache.expiresAt > now) {
    return compareCatalogCache.data;
  }
  const data = await getServerCompareCatalogItems();
  compareCatalogCache.data = data;
  compareCatalogCache.expiresAt = now + COMPARE_CACHE_TTL_MS;
  return data;
}

function getCachedCompareResult(userAId, userBId) {
  pruneCompareResultCache();
  const entry = compareResultCache.get(getCompareCacheKey(userAId, userBId));
  if (entry && entry.expiresAt > Date.now()) return entry.result;
  return null;
}

function setCachedCompareResult(userAId, userBId, result) {
  pruneCompareResultCache();
  compareResultCache.set(getCompareCacheKey(userAId, userBId), {
    result,
    expiresAt: Date.now() + COMPARE_CACHE_TTL_MS,
    createdAt: Date.now()
  });
}

function rebuildCompareResult(result, records, entryCounts = null) {
  const groups = { bothOwned: [], onlyUserA: [], onlyUserB: [], bothMissing: [], unknown: [] };
  for (const rec of records) {
    const sa = compareServerClassify(rec.userA);
    const sb = compareServerClassify(rec.userB);
    if (sa === "unknown" || sb === "unknown") groups.unknown.push(rec);
    else if (sa === "owned" && sb === "owned") groups.bothOwned.push(rec);
    else if (sa === "owned" && sb !== "owned") groups.onlyUserA.push(rec);
    else if (sb === "owned" && sa !== "owned") groups.onlyUserB.push(rec);
    else if (sa === "missing" && sb === "missing") groups.bothMissing.push(rec);
    else groups.unknown.push(rec);
  }

  const total = records.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;
  const toRate = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : 0);

  // Counts are intentionally taken from the full presentation result rather
  // than the current query-filtered subset.  When a caller redacts priority
  // or notes first it supplies viewer-safe counts here, preventing those
  // metadata-only entries from becoming a side channel in `enteredCount`.
  const aEnteredCount =
    entryCounts?.aEnteredCount ?? result.summary?.aEnteredCount ?? result.users?.userA?.enteredCount ?? 0;
  const bEnteredCount =
    entryCounts?.bEnteredCount ?? result.summary?.bEnteredCount ?? result.users?.userB?.enteredCount ?? 0;
  const complementarityRate = toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount);
  const complementarityScore = computeComplementarityScore(complementarityRate, records);
  const summary = {
    ...result.summary,
    catalogueVariantCount: total,
    bothOwnedCount,
    onlyUserACount,
    onlyUserBCount,
    bothMissingCount,
    unknownCount,
    aOwnedCount,
    bOwnedCount,
    aPossessionRate: toRate(aOwnedCount, total),
    bPossessionRate: toRate(bOwnedCount, total),
    collectiveOwnedCount,
    collectiveCompletionRate: toRate(collectiveOwnedCount, total),
    complementarityRate,
    complementarityScore,
    aEnteredCount,
    bEnteredCount,
    insufficientData: aEnteredCount === 0 || bEnteredCount === 0
  };
  const users = {
    ...result.users,
    userA: { ...result.users?.userA, enteredCount: aEnteredCount },
    userB: { ...result.users?.userB, enteredCount: bEnteredCount }
  };

  return { ...result, users, records, groups, summary };
}

function countVisibleCompareEntries(records, userKey) {
  return records.reduce((count, record) => count + (compareServerIsExplicitEntry(record[userKey]) ? 1 : 0), 0);
}

function applyServerCompareFilters(result, query = {}) {
  let records = result.records;
  const status = query.status;
  if (status) {
    if (result.groups[status]) {
      records = result.groups[status];
    } else if (status === "differences" || status === "missingMatch") {
      records = [...result.groups.onlyUserA, ...result.groups.onlyUserB];
    } else if (status === "priorities") {
      records = records.filter((r) => compareServerIsPriority(r.userA) || compareServerIsPriority(r.userB));
    }
  }

  if (query.seasonId) records = records.filter((r) => r.seasonId === query.seasonId);
  if (query.eventId) records = records.filter((r) => r.eventId === query.eventId);
  if (query.rarity)
    records = records.filter((r) => r.rarity && String(r.rarity).toLowerCase() === String(query.rarity).toLowerCase());
  if (query.variantType)
    records = records.filter(
      (r) => r.variantType && String(r.variantType).toLowerCase() === String(query.variantType).toLowerCase()
    );
  if (query.availability) records = records.filter((r) => r.availabilityStatus === query.availability);

  return rebuildCompareResult(result, records);
}

module.exports = {
  pruneCompareResultCache,
  pruneCollectionCache,
  getCompareCacheKey,
  invalidateCompareCacheForUser,
  getServerCompareCatalogItemsCached,
  getCachedCompareResult,
  setCachedCompareResult,
  rebuildCompareResult,
  countVisibleCompareEntries,
  applyServerCompareFilters,
  COMPARE_CACHE_TTL_MS,
  collectionCache,
  compareCatalogCache,
  compareResultCache,
  MAX_COMPARE_RESULT_CACHE
};
