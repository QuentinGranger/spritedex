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

async function run() {
  await test("badges : archiviste / early / raretés / événements (Étapes 46–50)", async () => {
    await ensurePassportBadgeTables(pool);
    const {
      EARLY_COLLECTOR_BEFORE,
      recordCatalogueReview,
      evaluateArchivistQualified,
      evaluateEarlyCollectorQualified,
      requiredRaritiesFromCatalogue,
      evaluateAllRaritiesOwned
    } = require("../../server/passport-badges");

    const defs = await listBadgeDefinitions();
    assert.ok(defs.some((d) => d.code === "archivist"));
    assert.ok(defs.some((d) => d.code === "early_collector"));
    assert.ok(defs.some((d) => d.code === "all_rarities"));
    assert.ok(defs.some((d) => d.code === "event_completed"));
    const early = defs.find((d) => d.code === "early_collector");
    assert.ok(early.ruleConfig.before || early.rule_config?.before);
    assert.ok(String(EARLY_COLLECTOR_BEFORE).includes("2026-10-01"));

    const rarities = requiredRaritiesFromCatalogue([
      { id: "1", rarity: "common" },
      { id: "2", rarity: "mythic" },
      { id: "3", rarity: "Gold" }
    ]);
    assert.ok(rarities.includes("common"));
    assert.ok(rarities.includes("mythic"));
    assert.ok(!rarities.includes("gold"));

    const all = evaluateAllRaritiesOwned(
      [
        { id: "1", rarity: "rare" },
        { id: "2", rarity: "epic" },
        { id: "3", rarity: "legendary" }
      ],
      ["1", "2"]
    );
    assert.ok(!all.qualified);
    assert.deepStrictEqual(all.required, ["rare", "epic", "legendary"]);

    const u = await register(`PpArch${rnd()}`);
    try {
      await recordCatalogueReview(u.id, "v1", 91);
      await recordCatalogueReview(u.id, "v2", 92);
      assert.ok(!(await evaluateArchivistQualified(u.id)));
      await recordCatalogueReview(u.id, "v3", 93);
      assert.ok(await evaluateArchivistQualified(u.id));

      // Early collector without verified email / owned → false
      assert.ok(!(await evaluateEarlyCollectorQualified(u.id, { before: "2099-01-01T00:00:00.000Z" })));
    } finally {
      await cleanup(u);
    }
  });

  await test("badges : progression locked + moteur sélectif + dédup (Étapes 51–54)", async () => {
    const {
      BADGE_TRIGGERS,
      buildBadgeUnlockDedupeKey,
      liveProgressForBadge,
      evaluateUserBadges
    } = require("../../server/badge-engine");

    assert.ok(BADGE_TRIGGERS["collection.variant_acquired"].includes("collection_100"));
    assert.ok(BADGE_TRIGGERS["comparison.generated"].includes("complementary_collection"));
    assert.strictEqual(buildBadgeUnlockDedupeKey(42, "first_collection"), "badge_unlock:first_collection:42");
    assert.ok(
      buildBadgeUnlockDedupeKey(42, "event_completed", "event_version", "uuid-1").includes("event_version:uuid-1")
    );

    const live = liveProgressForBadge(
      { ruleType: "completion_threshold", ruleConfig: { threshold: 100 } },
      { ownedVariantCount: 64, releasedVariantCount: 82 }
    );
    assert.strictEqual(live.progressValue, 64);
    assert.strictEqual(live.targetValue, 82);
    assert.strictEqual(live.progressRate, 78.05);
    assert.strictEqual(live.remaining, 18);

    await ensurePassportBadgeTables(pool);
    const u = await register(`PpEng${rnd()}`);
    try {
      // Selective eval with empty collection should not throw.
      const result = await evaluateUserBadges(u.id, "account.created", { notify: false });
      assert.strictEqual(result.trigger, "account.created");
      assert.ok(Array.isArray(result.unlocked));

      // Idempotent award: second evaluate of same state unlocks nothing new.
      const again = await evaluateUserBadges(u.id, "account.created", { notify: false });
      assert.strictEqual(again.unlocked.length, 0);
    } finally {
      await cleanup(u);
    }
  });

  await test("instantanés + badge épinglé (Étapes 56 & 59)", async () => {
    const {
      ensurePassportStatSnapshots,
      maybeCreatePassportStatSnapshot,
      getLatestSnapshot,
      SNAPSHOT_REASONS
    } = require("../../server/passport-snapshots");
    const { ensureCollectorPassport, resolveFeaturedBadge } = require("../../server/passport");

    await ensurePassportStatSnapshots(pool);
    await ensurePassportBadgeTables(pool);
    const u = await register(`PpSnap${rnd()}`);
    try {
      const snap = await maybeCreatePassportStatSnapshot(
        u.id,
        {
          catalogueVersion: "test-v1",
          ownedSpriteCount: 1,
          ownedVariantCount: 2,
          releasedVariantCount: 10,
          completionRate: 20,
          collectionCoverageRate: 50,
          completedEventCount: 0,
          comparisonCount: 0
        },
        { unlockedCodes: ["collection_25"], collectionChanged: true }
      );
      assert.ok(snap);
      assert.ok(
        [SNAPSHOT_REASONS.CATALOGUE_VERSION, SNAPSHOT_REASONS.MILESTONE, SNAPSHOT_REASONS.DAILY].includes(snap.reason)
      );
      const latest = await getLatestSnapshot(u.id);
      assert.ok(latest);
      assert.strictEqual(String(latest.catalogue_version), "test-v1");

      // Same catalogue + no change → no new snapshot
      const again = await maybeCreatePassportStatSnapshot(
        u.id,
        {
          catalogueVersion: "test-v1",
          ownedSpriteCount: 1,
          ownedVariantCount: 2,
          releasedVariantCount: 10,
          completionRate: 20,
          collectionCoverageRate: 50,
          completedEventCount: 0,
          comparisonCount: 0
        },
        { unlockedCodes: [], collectionChanged: false }
      );
      assert.strictEqual(again, null);

      await ensureCollectorPassport(u.id);
      const defs = await listBadgeDefinitions();
      const first = defs.find((d) => d.code === "first_collection");
      assert.ok(first);

      // Pin without unlock → reject via resolve (clear)
      await pool.query("UPDATE collector_passports SET featured_badge_id = $1 WHERE user_id = $2", [first.id, u.id]);
      const cleared = await resolveFeaturedBadge(u.id, first.id);
      assert.strictEqual(cleared, null);
      const row = await pool.query("SELECT featured_badge_id FROM collector_passports WHERE user_id = $1", [u.id]);
      assert.strictEqual(row.rows[0].featured_badge_id, null);
    } finally {
      await cleanup(u);
    }
  });
}

module.exports = { run };
