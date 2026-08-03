"use strict";

const {
  assert,
  passportReliability,
  buildBadges,
  computePassportProgress,
  computeOwnedRarityStats,
  sameVariantSet,
  OFFICIAL_RARITY_SCORE,
  specialVariantScore,
  resolveCompareSource,
  isCountableCompareResult,
  recordComparisonSession,
  getComparisonStatsForUser,
  ensureComparisonSessionsTable,
  ensurePassportActivityTable,
  recordOwnedVariants,
  listRecentActivity,
  writeActivity,
  ALLOWED_ACTIVITY_TYPES,
  ACTIVITY_FEED_LIMIT,
  ensurePassportBadgeTables,
  evaluateBadgeCondition,
  listBadgeDefinitions,
  listUserBadges,
  VERIFICATION_STATUSES,
  meetsCompletionThreshold,
  evaluateAndAwardComplementaryBadge,
  pool,
  BASE,
  API,
  test,
  rnd,
  register,
  auth,
  cleanup,
  getPassport,
  setEntry,
  getActiveVariants
} = require("./shared");

async function run({ owner, friend, stranger }) {
  await test("archivage catalogue : dénominateur sans perte d’historique (Étape 76)", async () => {
    const summaryMod = require("../../server/passport-summary");
    const integrity = require("../../server/passport-integrity");
    await summaryMod.ensurePassportSummaryTables(pool);
    await integrity.ensurePassportIntegrityTables(pool);

    const before = await summaryMod.getPassportSummary(owner.id);
    assert.ok(before);
    const safetyBefore = await integrity.verifyArchiveSafety(owner.id);
    const badgeCountBefore = safetyBefore.activeBadgesKept;
    const historyBefore = safetyBefore.historyRowsKept;
    const entriesBefore = safetyBefore.ownershipRowsKept;
    const peakBefore = safetyBefore.personalBestRate;

    const shrink = await summaryMod.handleCataloguePublished({
      previousVersion: before.catalogueVersion,
      newVersion: `${before.catalogueVersion}-archive`,
      previousReleasedVariantCount: before.releasedVariantCount,
      newReleasedVariantCount: Math.max(1, before.releasedVariantCount - 3),
      previousReleasedSpriteCount: before.releasedSpriteCount,
      newReleasedSpriteCount: Math.max(1, before.releasedSpriteCount - 1)
    });
    assert.strictEqual(shrink.shrink, true);
    assert.strictEqual(shrink.removedVariantCount, 3);

    const mid = await summaryMod.getPassportSummary(owner.id);
    assert.strictEqual(mid.releasedVariantCount, Math.max(1, before.releasedVariantCount - 3));
    assert.ok(mid.catalogueVersion.endsWith("-archive"));
    // Completion can only stay or rise when denominator shrinks (owned fixed).
    assert.ok(mid.completionRate + 1e-6 >= before.completionRate);

    const safetyAfter = await integrity.verifyArchiveSafety(owner.id);
    assert.strictEqual(safetyAfter.ownershipRowsKept, entriesBefore, "possession rows must remain");
    assert.ok(safetyAfter.historyRowsKept >= historyBefore, "status history must remain");
    assert.strictEqual(safetyAfter.activeBadgesKept, badgeCountBefore, "badges must remain");
    if (peakBefore != null) {
      assert.ok(safetyAfter.personalBestRate + 1e-6 >= peakBefore, "personal best must not drop");
    }
  });

  await test("déclaratif + classements reportés sur le passeport (Étapes 78–79)", async () => {
    const pass = await getPassport(owner.token, owner.id);
    assert.strictEqual(pass.status, 200);
    assert.ok(pass.data.declarative);
    assert.match(pass.data.declarative.collection, /déclarée/i);
    assert.match(pass.data.declarative.badges, /déclarée/i);
    assert.ok(pass.data.rankings);
    assert.strictEqual(pass.data.rankings.globalLeaderboard, false);
    assert.strictEqual(pass.data.rankings.collectionTop, false);
    // No passport ranking endpoints.
    const rankingProbe = await fetch(`${API}/passport/leaderboard`, { headers: auth(owner.token) });
    assert.ok([404, 405].includes(rankingProbe.status));
  });

  await test("statistiques API : empty / partial / record (Étape 80)", async () => {
    const emptyUser = await register(`PpEmpty${rnd()}`);
    try {
      const emptyPass = await getPassport(emptyUser.token, emptyUser.id);
      assert.strictEqual(emptyPass.status, 200);
      assert.strictEqual(emptyPass.data.collection.ownedVariantCount, 0);
      assert.strictEqual(emptyPass.data.collection.discoveredSpriteCount, 0);
      assert.strictEqual(emptyPass.data.collection.completionRatePrecise, 0);
      assert.ok(emptyPass.data.collection.reliability);
      assert.strictEqual(emptyPass.data.collection.reliability.level, "insufficient");
      assert.ok(emptyPass.data.catalogue.releasedVariantCount >= 1);
      assert.ok(emptyPass.data.collection.catalogueVersion);

      const { ids, bySprite } = await getActiveVariants(emptyUser.token);
      assert.ok(ids.length >= 2);
      // Partial fill: one owned, one missing.
      await setEntry(emptyUser.token, emptyUser.id, ids[0], "owned");
      await setEntry(emptyUser.token, emptyUser.id, ids[1], "missing");
      let pass = await getPassport(emptyUser.token, emptyUser.id);
      assert.ok(pass.data.collection.ownedVariantCount >= 1);
      assert.ok(pass.data.collection.discoveredSpriteCount >= 1);
      assert.ok(pass.data.collection.completionRatePrecise > 0);
      assert.ok(pass.data.collection.reliability.explicitVariantCount >= 2);
      assert.ok(pass.data.collection.highestOfficialRarity || pass.data.collection.highestRarity, "max rarity present");
      assert.ok(pass.data.collection.personalRecord || pass.data.collection.historicalPeak);

      // Raise then lower ownership — historical peak must remain.
      const peak1 = Number((pass.data.collection.personalRecord || pass.data.collection.historicalPeak).completionRate);
      await setEntry(emptyUser.token, emptyUser.id, ids[0], "missing");
      pass = await getPassport(emptyUser.token, emptyUser.id);
      const peak2 = Number((pass.data.collection.personalRecord || pass.data.collection.historicalPeak).completionRate);
      assert.ok(peak2 + 1e-6 >= peak1, "historical record must not decrease");
      assert.ok(pass.data.collection.completionRatePrecise <= peak2 + 1e-6, "current rate ≤ personal best");

      // Distinct sprites: own two variants of same sprite if available.
      let multi = null;
      for (const [, list] of bySprite.entries()) {
        if (list.length >= 2) {
          multi = list.slice(0, 2);
          break;
        }
      }
      if (multi) {
        await setEntry(emptyUser.token, emptyUser.id, multi[0], "owned");
        await setEntry(emptyUser.token, emptyUser.id, multi[1], "owned");
        pass = await getPassport(emptyUser.token, emptyUser.id);
        assert.ok(pass.data.collection.ownedVariantCount >= 2);
        assert.ok(pass.data.collection.discoveredSpriteCount >= 1);
        assert.ok(pass.data.collection.discoveredSpriteCount <= pass.data.collection.ownedVariantCount);
      }
    } finally {
      await cleanup(emptyUser);
    }
  });
}

module.exports = { run };
