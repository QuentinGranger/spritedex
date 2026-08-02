"use strict";

const { assert, passportReliability, buildBadges, computePassportProgress, computeOwnedRarityStats, sameVariantSet, OFFICIAL_RARITY_SCORE, specialVariantScore, resolveCompareSource, isCountableCompareResult, recordComparisonSession, getComparisonStatsForUser, ensureComparisonSessionsTable, ensurePassportActivityTable, recordOwnedVariants, listRecentActivity, writeActivity, ALLOWED_ACTIVITY_TYPES, ACTIVITY_FEED_LIMIT, ensurePassportBadgeTables, evaluateBadgeCondition, listBadgeDefinitions, listUserBadges, VERIFICATION_STATUSES, meetsCompletionThreshold, evaluateAndAwardComplementaryBadge, pool, BASE, API, test, rnd, register, auth, cleanup, getPassport, setEntry, getActiveVariants } = require("./shared");

async function run() {
  await test("fiabilité : niveaux complete / usable / insufficient", () => {
    assert.strictEqual(passportReliability(90, 100).level, "complete");
    assert.strictEqual(passportReliability(60, 100).level, "usable");
    assert.strictEqual(passportReliability(59.99, 100).level, "insufficient");
    assert.strictEqual(passportReliability(82, 82).rate, 100);
  });

  await test("progression : taux précis + affichage + prochaine étape (Étapes 13–14)", () => {
    const progress = computePassportProgress(64, 82);
    assert.ok(Math.abs(progress.completionRatePrecise - (64 / 82) * 100) < 1e-9);
    assert.strictEqual(progress.completionRate, 78.05);
    assert.strictEqual(progress.completionRateDisplay, 78.1);
    assert.ok(progress.nextStep);
    assert.strictEqual(progress.nextStep.targetPercent, 90);
    assert.strictEqual(progress.nextStep.remainingVariants, 10);
    assert.match(progress.nextStep.label, /10 variantes avant 90/);
  });

  await test("versions d’événement : comparaison de sets (Étape 18)", () => {
    assert.ok(sameVariantSet(["a", "b"], ["b", "a"]));
    assert.ok(!sameVariantSet(["a", "b"], ["a", "b", "c"]));
  });

  await test("sessions de comparaison : source + résultat comptable (Étapes 27–28)", () => {
    assert.strictEqual(resolveCompareSource("quick_compare"), "friends_list");
    assert.strictEqual(resolveCompareSource("passport"), "passport");
    assert.strictEqual(resolveCompareSource("share"), "shared_link");
    assert.strictEqual(resolveCompareSource("api", "direct"), "squad");
    assert.ok(!isCountableCompareResult({ summary: { insufficientData: true, catalogueVariantCount: 10 } }));
    assert.ok(isCountableCompareResult({ summary: { insufficientData: false, catalogueVariantCount: 10 } }));
  });

}

module.exports = { run };
