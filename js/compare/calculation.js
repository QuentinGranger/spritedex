"use strict";

function compareCollections(userA, userB, catalogue = getCompareCatalogItems()) {
  const userAInfo = userA && typeof userA === "object" && "collection" in userA
    ? userA
    : { id: "userA", displayName: t("compare.playerA"), collection: userA || {} };
  const userBInfo = userB && typeof userB === "object" && "collection" in userB
    ? userB
    : { id: "userB", displayName: t("compare.playerB"), collection: userB || {} };
  const collectionA = userAInfo.collection;
  const collectionB = userBInfo.collection;

  const activeCatalogue = catalogue.filter(isVariantReleasedAndActive);

  const groups = {
    bothOwned: [],
    onlyUserA: [],
    onlyUserB: [],
    bothMissing: [],
    unknown: []
  };
  const records = [];

  for (const item of activeCatalogue) {
    const a = compareEntry(collectionA, item);
    const b = compareEntry(collectionB, item);
    const sa = compareClassify(a);
    const sb = compareClassify(b);

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
  const aPossessionRate = toRate(aOwnedCount, total);
  const bPossessionRate = toRate(bOwnedCount, total);
  const collectiveCompletionRate = toRate(collectiveOwnedCount, total);
  const complementarityRate = toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount);
  const complementarityScore = computeComplementarityScore(complementarityRate, records);

  const aEnteredCount = countExplicitCollectionEntries(collectionA);
  const bEnteredCount = countExplicitCollectionEntries(collectionB);
  const insufficientData = aEnteredCount === 0 || bEnteredCount === 0;

  const comparisonId = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `comparison_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return {
    comparisonId,
    generatedAt: new Date().toISOString(),
    users: {
      userA: { id: userAInfo.id, displayName: userAInfo.displayName, enteredCount: aEnteredCount },
      userB: { id: userBInfo.id, displayName: userBInfo.displayName, enteredCount: bEnteredCount }
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
      aPossessionRate,
      bPossessionRate,
      collectiveOwnedCount,
      collectiveCompletionRate,
      complementarityRate,
      complementarityScore,
      aEnteredCount,
      bEnteredCount,
      insufficientData
    },
    groups,
    records
  };
}

// ── Rendu ──────────────────────────────────────────────────────────────────
