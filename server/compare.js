// compare.js — extracted from server.js

const analytics = require("../analytics");
const secLog = require("../security-logger");
const { checkPrivacyAccess, getRequestingUser } = require("./auth");
const { buildAcquisitionMethod, buildAvailability } = require("./catalog");
const { app } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");

// ── Server-side comparison engine (mirrors js/compare.js logic) ──
const COMPARE_SERVER_RULES = {
  owned: ["owned"],
  missing: ["missing", "priority", "spotted", "unavailable"],
  recommend: ["missing", "priority", "spotted"],
  unknown: ["new", "unknown", "unsure"]
};

function compareServerIsOwned(status) { return COMPARE_SERVER_RULES.owned.includes(status); }
function compareServerIsMissing(status) { return COMPARE_SERVER_RULES.missing.includes(status); }
function compareServerIsUnknown(status) { return !status || COMPARE_SERVER_RULES.unknown.includes(status); }
function compareServerIsRecommend(status) { return COMPARE_SERVER_RULES.recommend.includes(status); }

function compareServerIsPriority(entry) {
  if (!entry) return false;
  const s = entry.status;
  if (s === "unavailable" || compareServerIsOwned(s) || compareServerIsUnknown(s)) return false;
  if (s === "priority") return true;
  return !!(entry.priority && entry.priority !== "none" && entry.priority !== "ignored");
}

function compareServerClassify(entry) {
  const s = entry?.status;
  if (compareServerIsOwned(s)) return "owned";
  if (compareServerIsMissing(s)) return "missing";
  return "unknown";
}

function compareServerIsExplicitEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.status && !COMPARE_SERVER_RULES.unknown.includes(entry.status)) return true;
  if (entry.note && String(entry.note).trim()) return true;
  if (entry.priority && entry.priority !== "none" && entry.priority !== "ignored") return true;
  return false;
}

function countServerExplicitCollectionEntries(collection) {
  if (!collection || typeof collection !== "object") return 0;
  let count = 0;
  for (const [key, entry] of Object.entries(collection)) {
    if (key.startsWith("fav_")) continue;
    if (compareServerIsExplicitEntry(entry)) count++;
  }
  return count;
}

function compareServerDefaultEntry() { return { status: "new", priority: "none", note: "" }; }

function isVariantReleasedAndActiveServer(item) {
  const release = (item.releaseStatus || "").toLowerCase();
  if (["unreleased", "upcoming", "coming_soon", "soon", "unknown"].includes(release)) return false;
  const data = (item.dataStatus || "").toLowerCase();
  if (["archived", "legacy", "disabled"].includes(data)) return false;
  if (item.available === false || item.enabled === false || item.isReleased === false) return false;
  return true;
}

async function getServerCompareCatalogItems() {
  const [spritesRes, variantsRes] = await Promise.all([
    pool.query(`SELECT id, name, rarity, color, season_id, event_id, acquisition, availability, data_status, is_released, available, added_date FROM sprites`),
    pool.query(`SELECT id, sprite_id, variant_type, name, rarity, release_status, data_status, acquisition, availability, first_observed_at, image_path, suggested_image_path FROM sprite_variants`)
  ]);
  const spriteMap = Object.fromEntries(spritesRes.rows.map(s => [s.id, s]));
  const items = [];
  for (const v of variantsRes.rows) {
    const sprite = spriteMap[v.sprite_id];
    if (!sprite) continue;
    const variantAcquisition = buildAcquisitionMethod(v.acquisition && Object.keys(v.acquisition || {}).length ? v.acquisition : sprite.acquisition);
    const variantAvailability = buildAvailability(v.availability && Object.keys(v.availability || {}).length ? v.availability : sprite.availability);
    items.push({
      id: v.id,
      variantId: v.id,
      spriteId: sprite.id,
      variantType: v.variant_type,
      variantName: v.name || v.variant_type,
      spriteName: sprite.name || sprite.id,
      img: v.image_path || v.suggested_image_path || null,
      rarity: v.rarity || sprite.rarity,
      color: sprite.color,
      seasonId: sprite.season_id,
      eventId: sprite.event_id,
      releaseStatus: v.release_status || "",
      dataStatus: v.data_status || sprite.data_status || "",
      availabilityStatus: variantAvailability.status,
      acquisitionMethod: variantAcquisition.type,
      releaseDate: variantAvailability.startDate || v.first_observed_at || sprite.added_date,
      available: v.available !== undefined ? v.available : sprite.available,
      isReleased: sprite.is_released
    });
  }
  return items;
}

async function loadServerCompareCollection(userId) {
  const result = await pool.query(
    "SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  const collection = {};
  for (const row of result.rows) {
    collection[row.variant_id] = {
      status: row.status || "new",
      note: row.note || "",
      priority: row.priority || "none",
      obtainedAt: row.obtained_at || null
    };
  }
  return collection;
}

function compareCollectionsServer(userA, userB, catalogue) {
  const activeCatalogue = catalogue.filter(isVariantReleasedAndActiveServer);
  const groups = { bothOwned: [], onlyUserA: [], onlyUserB: [], bothMissing: [], unknown: [] };
  const records = [];

  for (const item of activeCatalogue) {
    const a = userA.collection[item.variantId] || compareServerDefaultEntry();
    const b = userB.collection[item.variantId] || compareServerDefaultEntry();
    const sa = compareServerClassify(a);
    const sb = compareServerClassify(b);

    const record = {
      ...item,
      userA: { status: a.status, priority: a.priority, note: a.note },
      userB: { status: b.status, priority: b.priority, note: b.note }
    };

    if (sa === "unknown" || sb === "unknown") {
      groups.unknown.push(record);
    } else if (sa === "owned" && sb === "owned") {
      groups.bothOwned.push(record);
    } else if (sa === "owned" && sb !== "owned") {
      groups.onlyUserA.push(record);
    } else if (sb === "owned" && sa !== "owned") {
      groups.onlyUserB.push(record);
    } else if (sa === "missing" && sb === "missing") {
      groups.bothMissing.push(record);
    } else {
      groups.unknown.push(record);
    }
    records.push(record);
  }

  const total = activeCatalogue.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;

  const toRate = (n, d) => d ? Math.round((n / d) * 10000) / 100 : 0;
  const aEnteredCount = countServerExplicitCollectionEntries(userA.collection);
  const bEnteredCount = countServerExplicitCollectionEntries(userB.collection);
  const insufficientData = aEnteredCount === 0 || bEnteredCount === 0;
  const comparisonId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `comparison_${crypto.randomBytes(16).toString("hex")}`;

  return {
    comparisonId,
    generatedAt: new Date().toISOString(),
    users: {
      userA: { id: userA.id, displayName: userA.displayName, enteredCount: aEnteredCount },
      userB: { id: userB.id, displayName: userB.displayName, enteredCount: bEnteredCount }
    },
    summary: {
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
      complementarityRate: toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount),
      aEnteredCount,
      bEnteredCount,
      insufficientData
    },
    groups,
    records
  };
}

const COMPARE_CACHE_TTL_MS = (() => {
  const v = parseInt(process.env.COMPARE_CACHE_TTL_MS, 10);
  if (!isNaN(v)) return Math.max(30000, Math.min(120000, v));
  return 60000;
})();

const compareCatalogCache = { data: null, expiresAt: 0 };
const compareResultCache = new Map();
const MAX_COMPARE_RESULT_CACHE = 500;

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

function applyServerCompareFilters(result, query) {
  let records = result.records;
  const status = query.status;
  if (status) {
    if (result.groups[status]) {
      records = result.groups[status];
    } else if (status === "differences" || status === "missingMatch") {
      records = [...result.groups.onlyUserA, ...result.groups.onlyUserB];
    } else if (status === "priorities") {
      records = records.filter(r => compareServerIsPriority(r.userA) || compareServerIsPriority(r.userB));
    }
  }

  if (query.seasonId) records = records.filter(r => r.seasonId === query.seasonId);
  if (query.eventId) records = records.filter(r => r.eventId === query.eventId);
  if (query.rarity) records = records.filter(r => r.rarity && String(r.rarity).toLowerCase() === String(query.rarity).toLowerCase());
  if (query.variantType) records = records.filter(r => r.variantType && String(r.variantType).toLowerCase() === String(query.variantType).toLowerCase());
  if (query.availability) records = records.filter(r => r.availabilityStatus === query.availability);

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
  const toRate = (n, d) => d ? Math.round((n / d) * 10000) / 100 : 0;

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
    complementarityRate: toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount),
    insufficientData: result.summary?.insufficientData ?? false
  };

  return { ...result, records, groups, summary };
}

// ── Comparisons : GET comparison between two users ──
app.get("/api/comparisons/users/:userAId/:userBId", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const { userAId, userBId } = req.params;
    const usersResult = await pool.query(
      "SELECT id, username, privacy FROM users WHERE id = ANY($1) AND deleted_at IS NULL",
      [[userAId, userBId]]
    );
    const userMap = Object.fromEntries(usersResult.rows.map(u => [u.id, u]));
    if (!userMap[userAId] || !userMap[userBId]) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    const accessA = await checkPrivacyAccess(req, userAId, userMap[userAId].privacy || "private");
    const accessB = await checkPrivacyAccess(req, userBId, userMap[userBId].privacy || "private");
    if (accessA === "blocked" || accessB === "blocked") {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    let result = getCachedCompareResult(userAId, userBId);
    if (!result) {
      const [catalogue, collectionA, collectionB] = await Promise.all([
        getServerCompareCatalogItemsCached(),
        loadServerCompareCollection(userAId),
        loadServerCompareCollection(userBId)
      ]);

      const userA = { id: userAId, displayName: userMap[userAId].username || userAId, collection: collectionA };
      const userB = { id: userBId, displayName: userMap[userBId].username || userBId, collection: collectionB };

      result = compareCollectionsServer(userA, userB, catalogue);
      setCachedCompareResult(userAId, userBId, result);
      analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_created", details: { userAId, userBId, source: "api" } });
    }

    result = applyServerCompareFilters(result, req.query);

    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_viewed", details: { userAId, userBId, source: "api" } });
    for (const [key, value] of Object.entries(req.query)) {
      if (value && ["status", "seasonId", "eventId", "rarity", "variantType", "availability"].includes(key)) {
        analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_filter_used", details: { filter: key, value: String(value) } });
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[/api/comparisons]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

function computeDurationExpiry(duration) {
  const now = Date.now();
  if (duration === "1h") return new Date(now + 60 * 60 * 1000).toISOString();
  if (duration === "24h") return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (duration === "7d") return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

async function loadCollectionForShare(userId, options) {
  const result = await pool.query(
    "SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  const collection = {};
  for (const row of result.rows) {
    collection[row.variant_id] = {
      status: row.status || "new",
      note: options.show_notes ? (row.note || "") : "",
      priority: options.show_priorities ? (row.priority || "none") : "none",
      obtainedAt: row.obtained_at || null
    };
  }
  return collection;
}

// ── Compare share tokens ──
app.post("/api/compare/share", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const duration = req.body?.duration || "24h";
    const expiresAt = computeDurationExpiry(duration);
    const token = crypto.randomBytes(32).toString("hex");
    const collectionVisible = req.body?.collectionVisible !== false;
    const showNotes = !!req.body?.showNotes;
    const showPriorities = req.body?.showPriorities !== false;
    const allowVisitorCompare = req.body?.allowVisitorCompare !== false;

    const insert = await pool.query(
      `INSERT INTO compare_share_tokens (token, owner_user_id, expires_at, collection_visible, show_notes, show_priorities, allow_visitor_compare)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7) RETURNING id, token, expires_at, created_at`,
      [token, reqUser, expiresAt, collectionVisible, showNotes, showPriorities, allowVisitorCompare]
    );

    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "compare_share_created", status: "ok" });
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_shared", details: { duration, source: "compare" } });
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "compare_invitation_generated", details: { source: "compare" } });
    res.json({
      token,
      url: `${req.protocol}://${req.get("host")}/compare/share/${token}`,
      expiresAt: insert.rows[0].expires_at,
      createdAt: insert.rows[0].created_at,
      options: { collectionVisible, showNotes, showPriorities, allowVisitorCompare }
    });
  } catch (err) {
    console.error("[/api/compare/share]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/compare/share/:token", async (req, res) => {
  try {
    const token = req.params.token;
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Token invalide" });

    const tokenRes = await pool.query(
      `SELECT t.*, u.username as owner_username
       FROM compare_share_tokens t
       JOIN users u ON u.id = t.owner_user_id
       WHERE t.token = $1 AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > NOW())
         AND u.deleted_at IS NULL`,
      [token]
    );
    if (!tokenRes.rows.length) return res.status(404).json({ error: "Lien invalide, expiré ou révoqué" });
    const share = tokenRes.rows[0];
    if (!share.collection_visible) return res.status(403).json({ error: "Collection masquée par le propriétaire" });

    await pool.query("UPDATE compare_share_tokens SET last_used_at = NOW() WHERE id = $1", [share.id]);

    const ownerCollection = await loadCollectionForShare(share.owner_user_id, share);
    const visitor = await getRequestingUser(req);
    let visitorCollection = {};
    let visitorName = "Visiteur";
    if (visitor && share.allow_visitor_compare) {
      visitorCollection = await loadServerCompareCollection(visitor);
      const visitorRes = await pool.query("SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL", [visitor]);
      if (visitorRes.rows.length) visitorName = visitorRes.rows[0].username;
    }

    const userA = { id: share.owner_user_id, displayName: share.owner_username, collection: ownerCollection };
    const userB = { id: visitor || "visitor", displayName: visitorName, collection: visitorCollection };
    const catalogue = await getServerCompareCatalogItemsCached();
    const result = compareCollectionsServer(userA, userB, catalogue);

    analytics.logCompareAnalyticsEvent(pool, { userId: visitor, event: "comparison_viewed", details: { source: "share", ownerId: share.owner_user_id } });

    res.json({
      token,
      options: {
        collectionVisible: share.collection_visible,
        showNotes: !!share.show_notes,
        showPriorities: !!share.show_priorities,
        allowVisitorCompare: !!share.allow_visitor_compare
      },
      result
    });
  } catch (err) {
    console.error("[/api/compare/share/:token]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/compare/share/:token", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const result = await pool.query(
      "UPDATE compare_share_tokens SET revoked_at = NOW() WHERE token = $1 AND owner_user_id = $2 RETURNING id",
      [req.params.token, reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lien non trouvé" });
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "compare_share_revoked", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/compare/share/:token]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/compare/shares", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const result = await pool.query(
      `SELECT token, expires_at, revoked_at, collection_visible, show_notes, show_priorities, allow_visitor_compare, created_at, last_used_at
       FROM compare_share_tokens
       WHERE owner_user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC`,
      [reqUser]
    );
    res.json({ shares: result.rows });
  } catch (err) {
    console.error("[/api/compare/shares]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Compare analytics ──
const COMPARE_ANALYTICS_EVENTS_SET = analytics.COMPARE_ANALYTICS_EVENTS;

app.post("/api/analytics/compare", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    const { event, details } = req.body || {};
    if (!event || !COMPARE_ANALYTICS_EVENTS_SET.has(event)) {
      return res.status(400).json({ error: "Événement inconnu" });
    }
    const cleanDetails = details && typeof details === "object" ? details : {};
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event, details: cleanDetails });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/analytics/compare]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/analytics/compare", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const metrics = await analytics.getCompareAnalyticsMetrics(pool, { days });
    res.json(metrics);
  } catch (err) {
    console.error("[/api/analytics/compare]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = { COMPARE_ANALYTICS_EVENTS_SET, COMPARE_CACHE_TTL_MS, COMPARE_SERVER_RULES, MAX_COMPARE_RESULT_CACHE, applyServerCompareFilters, compareCatalogCache, compareCollectionsServer, compareResultCache, compareServerClassify, compareServerDefaultEntry, compareServerIsExplicitEntry, compareServerIsMissing, compareServerIsOwned, compareServerIsPriority, compareServerIsRecommend, compareServerIsUnknown, computeDurationExpiry, countServerExplicitCollectionEntries, getCachedCompareResult, getCompareCacheKey, getServerCompareCatalogItems, getServerCompareCatalogItemsCached, invalidateCompareCacheForUser, isVariantReleasedAndActiveServer, loadCollectionForShare, loadServerCompareCollection, pruneCompareResultCache, setCachedCompareResult };
