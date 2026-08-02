"use strict";

const { assert, passportReliability, buildBadges, computePassportProgress, computeOwnedRarityStats, sameVariantSet, OFFICIAL_RARITY_SCORE, specialVariantScore, resolveCompareSource, isCountableCompareResult, recordComparisonSession, getComparisonStatsForUser, ensureComparisonSessionsTable, ensurePassportActivityTable, recordOwnedVariants, listRecentActivity, writeActivity, ALLOWED_ACTIVITY_TYPES, ACTIVITY_FEED_LIMIT, ensurePassportBadgeTables, evaluateBadgeCondition, listBadgeDefinitions, listUserBadges, VERIFICATION_STATUSES, meetsCompletionThreshold, evaluateAndAwardComplementaryBadge, pool, BASE, API, test, rnd, register, auth, cleanup, getPassport, setEntry, getActiveVariants } = require("./shared");

async function run({ owner, friend, stranger }) {
    await test("unicité (user, variant) : une seule entrée active (Étape 12)", async () => {
      const { ids } = await getActiveVariants(owner.token);
      assert.ok(ids[0], "need a variant");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      await setEntry(owner.token, owner.id, ids[0], "priority");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      const { status, data } = await getPassport(owner.token, owner.id);
      assert.strictEqual(status, 200);
      assert.ok(data.collection.ownedVariantCount >= 1);
      // Re-PUT same variant must not inflate owned count beyond distinct variants.
      const before = data.collection.ownedVariantCount;
      await setEntry(owner.token, owner.id, ids[0], "owned");
      const again = await getPassport(owner.token, owner.id);
      assert.strictEqual(again.data.collection.ownedVariantCount, before);
    });

    await test("Sprites découverts ≠ variantes possédées (Étape 2)", async () => {
      const { ids, bySprite } = await getActiveVariants(owner.token);
      assert.ok(ids.length >= 3, "need catalogue samples");
      let spriteId = null;
      let variants = [];
      for (const [sid, list] of bySprite.entries()) {
        if (list.length >= 2) {
          spriteId = sid;
          variants = list.slice(0, 2);
          break;
        }
      }
      assert.ok(spriteId && variants.length >= 2, "need a sprite with >= 2 released variants");

      // Isolate this assertion from earlier tests on the same user.
      await fetch(`${API}/collection/${owner.id}`, { method: "DELETE", headers: auth(owner.token) });
      await setEntry(owner.token, owner.id, variants[0], "owned");
      await setEntry(owner.token, owner.id, variants[1], "owned");

      const { status, data } = await getPassport(owner.token, owner.id);
      assert.strictEqual(status, 200);
      assert.ok(data.collection.discoveredSpriteCount >= 1, "at least 1 sprite discovered");
      assert.ok(data.collection.ownedVariantCount >= 2, "at least 2 variants owned");
      assert.ok(
        data.collection.ownedVariantCount >= data.collection.discoveredSpriteCount,
        "variants owned should be >= sprites discovered"
      );
      const ownedSet = new Set(variants);
      const other = ids.find((id) => !ownedSet.has(id));
      if (other) {
        const before = data.collection.ownedVariantCount;
        await setEntry(owner.token, owner.id, other, "priority");
        const again = await getPassport(owner.token, owner.id);
        assert.strictEqual(again.data.collection.ownedVariantCount, before, "priority must not count as owned");
      }
    });

    await test("visibilité : ami vs inconnu (Étapes 7–8)", async () => {
      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ passportVisibility: "friends", comparisonsVisibility: "private" })
      });

      const blocked = await getPassport(stranger.token, owner.id);
      assert.strictEqual(blocked.status, 404, "stranger must not see friends-only passport");

      await fetch(`${API}/friends/${friend.id}/request`, { method: "POST", headers: auth(owner.token) });
      await fetch(`${API}/friends/${owner.id}/accept`, { method: "POST", headers: auth(friend.token) });

      const ok = await getPassport(friend.token, owner.id);
      assert.strictEqual(ok.status, 200, "accepted friend can view passport");
      assert.strictEqual(ok.data.social.comparisonCount, null, "comparisons stay private by default");
    });

    await test("réglages passeport : owner only", async () => {
      const res = await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        headers: auth(friend.token)
      });
      assert.strictEqual(res.status, 403);
    });

}

module.exports = { run };
