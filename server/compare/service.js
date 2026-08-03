"use strict";

const { analytics, pool, comparisonSessions, getCollectionAccessReason, getVisibility } = require("./shared");
const {
  getCachedCompareResult,
  getServerCompareCatalogItemsCached,
  setCachedCompareResult,
  applyServerCompareFilters
} = require("./cache");
const { loadServerCompareCollection } = require("./catalog");
const { compareCollectionsServer } = require("./complementarity");
const { applyCollectionVisibilityFilters } = require("./visibility");

async function buildCompareResult(reqUser, targetUser, source, queryParams = {}) {
  const sessionSource = comparisonSessions.resolveCompareSource(queryParams.source, source);
  const targetVisibility = getVisibility(targetUser);
  const accessReason = await getCollectionAccessReason(reqUser, targetUser.id, targetVisibility);
  if (accessReason === "blocked") {
    const err = new Error("Vous ne pouvez pas interagir avec cet utilisateur");
    err.status = 403;
    throw err;
  }
  if (accessReason === "denied" || accessReason === "private") {
    const err = new Error("Collection non accessible");
    err.status = 403;
    throw err;
  }

  const [reqUserRes] = await Promise.all([
    pool.query("SELECT id, username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL", [reqUser])
  ]);
  const reqUserRow = reqUserRes.rows[0] || {};
  const reqUserVisibility = getVisibility(reqUserRow);

  const userMap = {
    [String(reqUser)]: { ...reqUserRow, visibility: reqUserVisibility },
    [String(targetUser.id)]: { ...targetUser, visibility: targetVisibility }
  };

  let result = getCachedCompareResult(reqUser, targetUser.id);
  let catalogueForVersion = null;
  if (!result) {
    const [catalogue, collectionA, collectionB] = await Promise.all([
      getServerCompareCatalogItemsCached(),
      loadServerCompareCollection(reqUser),
      loadServerCompareCollection(targetUser.id)
    ]);
    catalogueForVersion = catalogue;

    const userA = {
      id: reqUser,
      displayName: reqUserRow.display_name || reqUserRow.username || reqUser,
      collection: collectionA
    };
    const userB = {
      id: targetUser.id,
      displayName: targetUser.display_name || targetUser.username || targetUser.id,
      collection: collectionB
    };

    result = compareCollectionsServer(userA, userB, catalogue);
    setCachedCompareResult(reqUser, targetUser.id, result);
    analytics.logCompareAnalyticsEvent(pool, {
      userId: reqUser,
      event: "comparison_created",
      details: { userAId: reqUser, userBId: targetUser.id, source: sessionSource }
    });
  } else {
    catalogueForVersion = await getServerCompareCatalogItemsCached();
  }
  const catalogueVersion = comparisonSessions.catalogueVersionFromItems(catalogueForVersion);
  const engineResult = result;

  // Redact before applying query filters or calculating any presentation
  // metrics.  Filtering the raw cached result first made `status=priorities`
  // and complementarity scores an oracle for a hidden priority.
  result = await applyCollectionVisibilityFilters(result, reqUser, userMap);
  result = applyServerCompareFilters(result, queryParams);
  result.accessReason = accessReason;
  analytics.logCompareAnalyticsEvent(pool, {
    userId: reqUser,
    event: "comparison_viewed",
    details: { userAId: reqUser, userBId: targetUser.id, source: sessionSource }
  });

  // Étapes 27–29 — count unique comparison sessions (not every page reload).
  try {
    await comparisonSessions.recordParticipantComparisonSession({
      requesterId: reqUser,
      userAId: reqUser,
      userBId: targetUser.id,
      source: sessionSource,
      catalogueVersion,
      result: engineResult
    });
  } catch (err) {
    console.error("[comparison-sessions] buildCompareResult", err.message);
  }

  // Étapes 44–45 — complementary collection badge (friends / shared squad only).
  try {
    const { evaluateAndAwardComplementaryBadge } = require("./passport-badges");
    await evaluateAndAwardComplementaryBadge(reqUser, targetUser.id, engineResult, { catalogueVersion });
  } catch (err) {
    console.error("[passport-badges] complementary", err.message);
  }

  return result;
}

module.exports = { buildCompareResult };
