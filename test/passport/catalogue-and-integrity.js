"use strict";

const { assert, passportReliability, buildBadges, computePassportProgress, computeOwnedRarityStats, sameVariantSet, OFFICIAL_RARITY_SCORE, specialVariantScore, resolveCompareSource, isCountableCompareResult, recordComparisonSession, getComparisonStatsForUser, ensureComparisonSessionsTable, ensurePassportActivityTable, recordOwnedVariants, listRecentActivity, writeActivity, ALLOWED_ACTIVITY_TYPES, ACTIVITY_FEED_LIMIT, ensurePassportBadgeTables, evaluateBadgeCondition, listBadgeDefinitions, listUserBadges, VERIFICATION_STATUSES, meetsCompletionThreshold, evaluateAndAwardComplementaryBadge, pool, BASE, API, test, rnd, register, auth, cleanup, getPassport, setEntry, getActiveVariants } = require("./shared");

async function run() {
  await test("rareté officielle ≠ type de variante (Étapes 21–23)", () => {
    assert.strictEqual(OFFICIAL_RARITY_SCORE.common, 1);
    assert.strictEqual(OFFICIAL_RARITY_SCORE.mythic, 6);
    assert.strictEqual(specialVariantScore("Holofoil", "Base"), 4);
    assert.strictEqual(specialVariantScore("gold", "Gold"), 1);
    assert.strictEqual(specialVariantScore("Base", "Base"), 0);

    const catalogue = [
      { id: "1", rarity: "rare", variantType: "Base", variantName: "Base" },
      { id: "2", rarity: "mythic", variantType: "Gold", variantName: "Gold" },
      { id: "3", rarity: "common", variantType: "Holofoil", variantName: "Holofoil" },
      { id: "4", rarity: "legendary", variantType: "Gummy", variantName: "Gummy" }
    ];
    const empty = computeOwnedRarityStats(catalogue, []);
    assert.strictEqual(empty.display, "Aucune rareté débloquée");
    assert.strictEqual(empty.highestOfficialRarity, null);
    assert.ok(Array.isArray(empty.rarityBreakdown));
    assert.ok(Array.isArray(empty.variantTypeBreakdown));

    const stats = computeOwnedRarityStats(catalogue, ["1", "2", "3"]);
    assert.strictEqual(stats.highestOfficialRarity.key, "mythic");
    assert.strictEqual(stats.highestOfficialRarity.label, "Mythique");
    assert.strictEqual(stats.highestOfficialRarity.ownedCountAtRarity, 1);
    assert.strictEqual(stats.rarestSpecialVariant.key, "holofoil");
    assert.strictEqual(stats.rarestSpecialVariant.label, "Holofoil");
    assert.notStrictEqual(stats.highestOfficialRarity.key, "holofoil");
    assert.ok(stats.rarityBreakdown.some((r) => r.key === "rare" && r.ownedCount === 1));
    assert.ok(stats.variantTypeBreakdown.some((v) => v.key === "gold" && v.ownedCount === 1 && v.filter === "variant:Gold"));
    assert.ok(stats.variantTypeBreakdown.some((v) => v.key === "base"));
  });

  await test("badges déterministes sans classement mondial", () => {
    const badges = buildBadges({
      ownedCount: 3,
      discoveredCount: 5,
      completionRate: 50,
      reliability: { level: "complete" },
      squadCount: 1,
      friendCount: 1,
      eventsCompleted: 1
    });
    const ids = badges.map((b) => b.id);
    assert.ok(ids.includes("first_collection"));
    assert.ok(ids.includes("explorer"));
    assert.ok(ids.includes("collection_50"));
    assert.ok(!ids.some((id) => /rank|leaderboard|mondial/i.test(id)));
  });

  await test("statistiques : filtre catalogue + progression (Étape 80 unit)", () => {
    const { isVariantReleasedAndActiveServer } = require("../../server/compare");
    const catalogue = [
      { id: "a1", spriteId: "A", rarity: "common", variantType: "Base", releaseStatus: "released", dataStatus: "active" },
      { id: "a2", spriteId: "A", rarity: "rare", variantType: "Gold", releaseStatus: "released", dataStatus: "active" },
      { id: "b1", spriteId: "B", rarity: "mythic", variantType: "Base", releaseStatus: "released", dataStatus: "active" },
      { id: "u1", spriteId: "U", rarity: "legendary", variantType: "Base", releaseStatus: "unreleased", dataStatus: "active" },
      { id: "x1", spriteId: "X", rarity: "epic", variantType: "Base", releaseStatus: "released", dataStatus: "archived" },
      { id: "y1", spriteId: "Y", rarity: "legendary", variantType: "Base", releaseStatus: "released", dataStatus: "legacy" }
    ];
    const live = catalogue.filter(isVariantReleasedAndActiveServer);
    assert.strictEqual(live.length, 3, "unreleased + archived + legacy excluded");
    assert.ok(!live.some((i) => i.id === "u1" || i.id === "x1" || i.id === "y1"));

    const ownedIds = new Set(["a1", "a2"]); // sprite A both variants
    const releasedSprites = new Set(live.map((i) => i.spriteId));
    const discovered = new Set(live.filter((i) => ownedIds.has(i.id)).map((i) => i.spriteId));
    assert.strictEqual(releasedSprites.size, 2);
    assert.strictEqual(discovered.size, 1, "distinct sprites owned");
    assert.strictEqual(ownedIds.size, 2, "variant count");

    const progress = computePassportProgress(ownedIds.size, live.length);
    assert.ok(Math.abs(progress.completionRatePrecise - (2 / 3) * 100) < 1e-9);

    const empty = computePassportProgress(0, live.length);
    assert.strictEqual(empty.completionRatePrecise, 0);
    assert.strictEqual(passportReliability(0, live.length).level, "insufficient");

    const partial = passportReliability(1, live.length);
    assert.ok(partial.rate < 90);

    const rarity = computeOwnedRarityStats(live, ownedIds);
    assert.strictEqual(rarity.highestOfficialRarity.key, "rare");
  });

  await test("intégrité : flips + imports incohérents + classements reportés (Étapes 77–79)", () => {
    const integrity = require("../../server/passport-integrity");
    assert.ok(integrity.isOwnedMissingFlip("owned", "missing"));
    assert.ok(integrity.isOwnedMissingFlip("missing", "owned"));
    assert.ok(!integrity.isOwnedMissingFlip("owned", "priority"));

    const mass = integrity.summarizeChanges(
      Array.from({ length: 60 }, (_, i) => ({
        variantId: `v${i}`,
        oldStatus: "missing",
        newStatus: "owned"
      }))
    );
    assert.strictEqual(mass.changeCount, 60);
    assert.strictEqual(mass.ownedGains, 60);

    const incoherence = integrity.detectImportIncoherence({
      previousCount: 120,
      nextCount: 0,
      deletedCount: 120,
      changes: [],
      ownedRatio: 0
    });
    assert.ok(incoherence.flags.includes("import_large_deletion"));
    assert.ok(incoherence.flags.includes("import_wiped_collection"));

    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.globalLeaderboard, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.collectionTop, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.countryRanking, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.squadRanking, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.declaredCountRewards, false);
  });
}

module.exports = { run };
