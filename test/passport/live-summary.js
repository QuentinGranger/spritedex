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
  await test("endpoints dédiés + résumé matérialisé (Étapes 71–72)", async () => {
    const me = await fetch(`${API}/passport/me`, { headers: auth(owner.token) });
    assert.strictEqual(me.status, 200);
    const meData = await me.json();
    assert.ok(meData.user && String(meData.user.id) === String(owner.id));
    assert.ok(meData.summary || (meData.collection && meData.collection.fromSummary));

    const byUser = await fetch(`${API}/users/${owner.id}/passport`, { headers: auth(owner.token) });
    assert.strictEqual(byUser.status, 200);

    const settings = await fetch(`${API}/passport/settings`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({ activityVisibility: "friends" })
    });
    assert.strictEqual(settings.status, 200);

    const badges = await fetch(`${API}/users/${owner.id}/badges`, { headers: auth(owner.token) });
    assert.strictEqual(badges.status, 200);
    const badgeData = await badges.json();
    assert.ok(Array.isArray(badgeData.badges));
    assert.ok(Array.isArray(badgeData.badgeProgress));

    const activity = await fetch(`${API}/users/${owner.id}/passport/activity`, {
      headers: auth(owner.token)
    });
    assert.strictEqual(activity.status, 200);
    const actData = await activity.json();
    assert.ok(Array.isArray(actData.recentActivity));

    const card = await fetch(`${API}/passport/share-card`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({
        format: "1200x630",
        showSquad: true,
        showBadges: true,
        showCompletion: true,
        showEvents: true,
        showJoinedAt: false
      })
    });
    assert.strictEqual(card.status, 200);
    const cardData = await card.json();
    assert.strictEqual(cardData.format, "1200x630");
    assert.ok(!("email" in cardData));
    assert.ok(cardData.publicUrl.startsWith("/u/"));

    const summaryMod = require("../../server/passport-summary");
    await summaryMod.ensurePassportSummaryTables(pool);
    const summary = await summaryMod.getPassportSummary(owner.id);
    assert.ok(summary, "user_passport_summaries row required");
    assert.strictEqual(typeof summary.completionRate, "number");
    assert.ok(summary.catalogueVersion);
    assert.strictEqual(typeof summary.releasedVariantCount, "number");
  });

  await test("file de recalcul + catalogue (Étapes 74–75)", async () => {
    const summaryMod = require("../../server/passport-summary");
    await summaryMod.ensurePassportSummaryTables(pool);
    const before = await summaryMod.getPassportSummary(owner.id);
    assert.ok(before);

    const jobId = await summaryMod.enqueuePassportRecalc(owner.id, {
      reason: "test.queue",
      triggerEvent: "collection.updated",
      collectionChanged: true,
      notify: false
    });
    assert.ok(jobId);

    const processed = await summaryMod.processPassportRecalcBatch(pool);
    assert.ok(processed >= 1);

    const after = await summaryMod.getPassportSummary(owner.id);
    assert.ok(after);
    assert.ok(new Date(after.recalculatedAt) >= new Date(before.recalculatedAt));

    // Étape 75 — bump released totals when catalogue "grows".
    const bumped = await summaryMod.handleCataloguePublished({
      previousVersion: before.catalogueVersion,
      newVersion: `${before.catalogueVersion}-testgrow`,
      previousReleasedVariantCount: before.releasedVariantCount,
      newReleasedVariantCount: before.releasedVariantCount + 2,
      previousReleasedSpriteCount: before.releasedSpriteCount,
      newReleasedSpriteCount: before.releasedSpriteCount + 1
    });
    assert.ok(bumped.enqueued >= 1);
    assert.strictEqual(bumped.addedVariantCount, 2);

    const mid = await summaryMod.getPassportSummary(owner.id);
    assert.strictEqual(mid.releasedVariantCount, before.releasedVariantCount + 2);
    assert.ok(mid.completionRate <= before.completionRate + 1e-6);

    // Drain queued catalogue jobs for this user at least once.
    await summaryMod.processPassportRecalcBatch(pool);
  });
}

module.exports = { run };
