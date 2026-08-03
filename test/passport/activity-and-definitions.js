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
  await test("activité : types autorisés + regroupement 10 min (Étapes 31–34)", async () => {
    await ensurePassportActivityTable(pool);
    assert.ok(ALLOWED_ACTIVITY_TYPES.includes("variants_owned"));
    assert.ok(!ALLOWED_ACTIVITY_TYPES.includes("missing"));
    assert.strictEqual(ACTIVITY_FEED_LIMIT, 10);

    const blocked = await writeActivity({
      userId: 1,
      activityType: "privacy_changed",
      data: {}
    });
    assert.strictEqual(blocked, null);

    // Use a disposable user via register later for DB writes — pure grouping unit via fake user cleanup.
    const u = await register(`PpAct${rnd()}`);
    try {
      await recordOwnedVariants(u.id, ["v1", "v2", "v3"]);
      await recordOwnedVariants(u.id, ["v4", "v5"]);
      const feed = await listRecentActivity(u.id);
      assert.ok(feed.length >= 1);
      assert.strictEqual(feed[0].activityType, "variants_owned");
      assert.strictEqual(feed[0].data.count, 5, "bulk owned adds must group into one activity");
      assert.ok(feed.length <= 10);
    } finally {
      await cleanup(u);
    }
  });

  await test("badges : définitions officielles + progression (Étapes 35–40)", async () => {
    await ensurePassportBadgeTables(pool);
    const defs = await listBadgeDefinitions();
    assert.ok(defs.length >= 5);
    assert.ok(defs.every((d) => d.ruleType || d.rule_type));
    assert.ok(defs.some((d) => d.code === "first_collection"));
    assert.ok(defs.some((d) => d.code === "collection_25"));
    assert.ok(defs.some((d) => d.code === "collection_50"));
    assert.ok(defs.some((d) => d.code === "collection_75"));
    assert.ok(defs.some((d) => d.code === "collection_100"));
    assert.ok(defs.some((d) => d.code === "squad_founder"));
    assert.ok(defs.some((d) => d.code === "complementary_collection"));
    assert.ok(VERIFICATION_STATUSES.includes("declared"));
    assert.ok(VERIFICATION_STATUSES.includes("system_confirmed"));
    assert.ok(VERIFICATION_STATUSES.includes("community_verified"));
    assert.ok(VERIFICATION_STATUSES.includes("officially_verified"));
    const progression = defs.filter((d) => /^collection_\d+$/.test(d.code));
    assert.ok(progression.every((d) => (d.ruleType || d.rule_type) === "completion_threshold"));
    const first = defs.find((d) => d.code === "first_collection");
    assert.strictEqual(first.ruleType || first.rule_type, "first_owned_transition");
    const founder = defs.find((d) => d.code === "squad_founder");
    assert.strictEqual(founder.ruleType || founder.rule_type, "squad_founder_qualified");
    assert.ok(evaluateBadgeCondition({ type: "owned_variant_count", min: 1 }, { ownedVariantCount: 1 }));
    assert.ok(!evaluateBadgeCondition({ type: "owned_variant_count", min: 1 }, { ownedVariantCount: 0 }));
  });

  await test("badges : précision seuil 75 % (Étape 41)", () => {
    assert.ok(!meetsCompletionThreshold(74.999, 75));
    assert.ok(meetsCompletionThreshold(75, 75));
    assert.ok(meetsCompletionThreshold(75.001, 75));
    assert.ok(!meetsCompletionThreshold(74.9, 75));
    assert.ok(
      !evaluateBadgeCondition(
        { type: "completion_rate", min: 75 },
        { completionRatePrecise: 74.999, completionRateDisplay: 75 }
      ),
      "display rounding must not unlock"
    );
    assert.ok(
      evaluateBadgeCondition(
        { type: "completion_rate", min: 75 },
        { completionRatePrecise: 75, completionRateDisplay: 75 }
      )
    );
  });

  await test("badges : complémentarité refuse les faux comptes (Étape 45)", async () => {
    const empty = await evaluateAndAwardComplementaryBadge(1, 1, {
      summary: { insufficientData: false, catalogueVariantCount: 10 }
    });
    assert.strictEqual(empty.skippedReason, "same_or_invalid_users");

    const insufficient = await evaluateAndAwardComplementaryBadge(1, 2, {
      summary: { insufficientData: true, catalogueVariantCount: 10 }
    });
    assert.strictEqual(insufficient.skippedReason, "insufficient_data");
  });
}

module.exports = { run };
