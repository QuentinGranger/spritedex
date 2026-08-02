"use strict";

const { analytics, pool, app, canViewCollection, getRequestingUser, isBlocked, shareSquad, comparisonSessions } = require("./shared");
const { getCachedCompareResult, getServerCompareCatalogItemsCached, setCachedCompareResult, applyServerCompareFilters } = require("./cache");
const { loadServerCompareCollection } = require("./catalog");
const { compareCollectionsServer } = require("./complementarity");
const { applyCollectionVisibilityFilters } = require("./visibility");

// ── Comparisons : GET comparison between two users ──
app.get("/api/comparisons/users/:userAId/:userBId", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const { userAId, userBId } = req.params;
    const usersResult = await pool.query(
      `SELECT id, username, display_name, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE id = ANY($1) AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`,
      [[userAId, userBId]]
    );
    const userMap = Object.fromEntries(usersResult.rows.map(u => [u.id, u]));
    if (!userMap[userAId] || !userMap[userBId]) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (await isBlocked(userAId, userBId)) {
      return res.status(403).json({ error: "Comparaison impossible" });
    }

    const canViewA = await canViewCollection(reqUser, userAId);
    const canViewB = await canViewCollection(reqUser, userBId);
    if (!canViewA || !canViewB) {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    let catalogueForVersion = null;
    let result = getCachedCompareResult(userAId, userBId);
    if (!result) {
      const [catalogue, collectionA, collectionB] = await Promise.all([
        getServerCompareCatalogItemsCached(),
        loadServerCompareCollection(userAId),
        loadServerCompareCollection(userBId)
      ]);
      catalogueForVersion = catalogue;

      const userA = { id: userAId, displayName: userMap[userAId].display_name || userMap[userAId].username || userAId, collection: collectionA };
      const userB = { id: userBId, displayName: userMap[userBId].display_name || userMap[userBId].username || userBId, collection: collectionB };

      result = compareCollectionsServer(userA, userB, catalogue);
      setCachedCompareResult(userAId, userBId, result);
      analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_created", details: { userAId, userBId, source: "api" } });
    } else {
      catalogueForVersion = await getServerCompareCatalogItemsCached();
    }

    // See buildCompareResult: filters and derived scores must operate on the
    // viewer-redacted representation, never on the raw cache entry.
    const engineResult = result;
    const catalogueVersion = comparisonSessions.catalogueVersionFromItems(catalogueForVersion);
    result = await applyCollectionVisibilityFilters(result, reqUser, userMap);
    result = applyServerCompareFilters(result, req.query);

    const sharesSquad = await shareSquad(userAId, userBId);
    const pairSource = comparisonSessions.resolveCompareSource(
      req.query.source,
      sharesSquad ? "squad" : "direct"
    );
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_viewed", details: { userAId, userBId, source: pairSource } });

    if (sharesSquad) {
      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, event: "squad_member_comparison_opened", details: { userAId, userBId } });
    }

    try {
      await comparisonSessions.recordParticipantComparisonSession({
        requesterId: reqUser,
        userAId,
        userBId,
        source: pairSource,
        catalogueVersion,
        result: engineResult
      });
    } catch (sessionErr) {
      console.error("[comparison-sessions] /api/comparisons/users", sessionErr.message);
    }

    try {
      const { evaluateAndAwardComplementaryBadge } = require("./passport-badges");
      await evaluateAndAwardComplementaryBadge(userAId, userBId, engineResult, { catalogueVersion });
    } catch (badgeErr) {
      console.error("[passport-badges] complementary /api/comparisons/users", badgeErr.message);
    }

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


module.exports = {  };
