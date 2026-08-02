"use strict";

const { assert, passportReliability, buildBadges, computePassportProgress, computeOwnedRarityStats, sameVariantSet, OFFICIAL_RARITY_SCORE, specialVariantScore, resolveCompareSource, isCountableCompareResult, recordComparisonSession, getComparisonStatsForUser, ensureComparisonSessionsTable, ensurePassportActivityTable, recordOwnedVariants, listRecentActivity, writeActivity, ALLOWED_ACTIVITY_TYPES, ACTIVITY_FEED_LIMIT, ensurePassportBadgeTables, evaluateBadgeCondition, listBadgeDefinitions, listUserBadges, VERIFICATION_STATUSES, meetsCompletionThreshold, evaluateAndAwardComplementaryBadge, pool, BASE, API, test, rnd, register, auth, cleanup, getPassport, setEntry, getActiveVariants } = require("./shared");

async function run({ owner, friend, stranger }) {
    await test("passeport soi-même : contrat Étapes 1–3", async () => {
      const { status, data } = await getPassport(owner.token, owner.id);
      assert.strictEqual(status, 200, JSON.stringify(data));
      assert.ok(data.user && data.user.createdAt, "createdAt from users.created_at required");
      assert.ok(data.catalogue && data.catalogue.version, "catalogue.version required");
      assert.strictEqual(typeof data.catalogue.releasedSpriteCount, "number");
      assert.strictEqual(typeof data.catalogue.releasedVariantCount, "number");
      assert.ok(data.catalogue.releasedVariantCount >= 1);
      assert.ok(data.collection, "collection required");
      assert.strictEqual(typeof data.collection.discoveredSpriteCount, "number");
      assert.strictEqual(typeof data.collection.ownedVariantCount, "number");
      assert.strictEqual(typeof data.collection.completionRate, "number");
      assert.strictEqual(typeof data.collection.completionRatePrecise, "number");
      assert.ok(data.collection.catalogueVersion, "catalogueVersion stamped on collection (Étape 15)");
      assert.ok(data.collection.progress, "progress block required (Étape 14)");
      assert.strictEqual(data.collection.progress.catalogueVersion, data.collection.catalogueVersion);
      assert.ok(data.events, "events sections required (Étape 20)");
      assert.ok(Array.isArray(data.events.completed));
      assert.ok(Array.isArray(data.events.inProgress));
      assert.ok(Array.isArray(data.events.historical));
      assert.ok(data.collection.reliability);
      assert.ok(["complete", "usable", "insufficient"].includes(data.collection.reliability.level));
      assert.ok(Array.isArray(data.badges));
      assert.ok(Array.isArray(data.recentActivity));
      assert.ok(data.recentActivity.length <= 10, "Étape 33 — max 10 activités");
      assert.ok(data.social);
      if (data.social.comparisonCount != null) {
        assert.strictEqual(typeof data.social.distinctCollectorsCompared, "number");
      }
    });

    await test("accomplissements persistants + record historique (Étape 16)", async () => {
      const { ids } = await getActiveVariants(owner.token);
      assert.ok(ids.length >= 1);
      await fetch(`${API}/collection/${owner.id}`, { method: "DELETE", headers: auth(owner.token) });
      // Seed enough owned entries to unlock first_collection, then demote later.
      await setEntry(owner.token, owner.id, ids[0], "owned");
      let pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.ok(pass.data.badges.some((b) => b.id === "first_collection"), "first_collection should unlock");
      const unlockedAt = pass.data.badges.find((b) => b.id === "first_collection").unlockedAt;
      assert.ok(unlockedAt);
      assert.ok(pass.data.badges.find((b) => b.id === "first_collection").catalogueVersion);
      assert.strictEqual(
        pass.data.badges.find((b) => b.id === "first_collection").verificationStatus,
        "system_confirmed",
        "Étape 38/39 — first_collection is system_confirmed"
      );
      const fromTable = await listUserBadges(owner.id);
      assert.ok(fromTable.some((b) => b.id === "first_collection" || b.code === "first_collection"));
      const prog = fromTable.find((b) => b.code === "first_collection");
      assert.ok(prog);
      // Progression badges keep evidence; first_collection is not progression but unlock persists.
      assert.ok(pass.data.recentActivity.some((a) => a.activityType === "variants_owned" || a.type === "variants_owned"));
      assert.ok(pass.data.recentActivity.some((a) => a.activityType === "badge_unlocked" || a.type === "badge_unlocked"));

      await setEntry(owner.token, owner.id, ids[0], "missing");
      pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.ok(
        pass.data.badges.some((b) => b.id === "first_collection"),
        "badge must remain after rate drops (Étape 42 historical)"
      );
      assert.ok(pass.data.collection.historicalPeak, "historical peak required");
      assert.ok(Number(pass.data.collection.historicalPeak.completionRate) > 0);
      assert.ok(Array.isArray(pass.data.badgeProgress), "Étape 51 — badgeProgress required");
      const lockedProgression = pass.data.badgeProgress.find(
        (b) => b.badgeCode === "collection_100" && b.status === "locked"
      );
      assert.ok(lockedProgression, "collection_100 should appear as locked with progress");
      assert.strictEqual(typeof lockedProgression.progressValue, "number");
      assert.strictEqual(typeof lockedProgression.targetValue, "number");
      assert.strictEqual(typeof lockedProgression.progressRate, "number");
      assert.ok(pass.data.identity, "Étape 58 — identity block");
      assert.ok(pass.data.user.avatarUrl != null || pass.data.identity.avatarUrl != null);
      assert.ok(pass.data.collection.personalRecord || pass.data.collection.historicalPeak, "Étape 55");
      assert.ok(pass.data.collection.progress, "Étape 60 — progress block");
      assert.ok(pass.data.collection.reliabilityQuality || pass.data.collection.progress.quality);
      assert.ok(Array.isArray(pass.data.collection.rarityBreakdown), "Étape 61 — rarityBreakdown");
      assert.ok(Array.isArray(pass.data.collection.variantTypeBreakdown), "Étape 61 — variantTypeBreakdown");
      if (pass.data.events) {
        assert.ok(Array.isArray(pass.data.events.inProgress));
        assert.ok(Array.isArray(pass.data.events.recentlyCompleted) || Array.isArray(pass.data.events.completed));
      }
      assert.ok(pass.data.badgeProgress.every((b) => b.uiCategory), "Étape 63 — uiCategory");
      assert.ok(pass.data.recentActivity.some((a) => a.activityType === "account_created" || a.type === "account_created"));
      assert.ok(Array.isArray(pass.data.actions), "Étape 66 — actions");
      assert.ok(pass.data.actions.includes("share_passport"));
      assert.ok(pass.data.actions.includes("edit_profile"));
      assert.ok(pass.data.publicUrl && pass.data.publicUrl.startsWith("/u/"), "Étape 67 — publicUrl");
    });
}

module.exports = { run };
