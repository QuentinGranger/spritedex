"use strict";

const { assert, passportReliability, buildBadges, computePassportProgress, computeOwnedRarityStats, sameVariantSet, OFFICIAL_RARITY_SCORE, specialVariantScore, resolveCompareSource, isCountableCompareResult, recordComparisonSession, getComparisonStatsForUser, ensureComparisonSessionsTable, ensurePassportActivityTable, recordOwnedVariants, listRecentActivity, writeActivity, ALLOWED_ACTIVITY_TYPES, ACTIVITY_FEED_LIMIT, ensurePassportBadgeTables, evaluateBadgeCondition, listBadgeDefinitions, listUserBadges, VERIFICATION_STATUSES, meetsCompletionThreshold, evaluateAndAwardComplementaryBadge, pool, BASE, API, test, rnd, register, auth, cleanup, getPassport, setEntry, getActiveVariants } = require("./shared");

async function run({ owner, friend, stranger }) {
    await test("comparaisons : session unique + dédoublonnage 30 min (Étapes 27–30)", async () => {
      await ensureComparisonSessionsTable(pool);
      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ comparisonsVisibility: "friends" })
      });

      const { ids } = await getActiveVariants(owner.token);
      assert.ok(ids.length >= 2, "need variants for countable compare");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      await setEntry(owner.token, owner.id, ids[1], "missing");
      await setEntry(friend.token, friend.id, ids[0], "missing");
      await setEntry(friend.token, friend.id, ids[1], "owned");

      const before = await getPassport(owner.token, owner.id);
      assert.strictEqual(before.status, 200);
      const beforeCount = before.data.social.comparisonCount || 0;

      const cmp1 = await fetch(`${API}/compare/${friend.id}?source=friends_list`, { headers: auth(owner.token) });
      assert.ok(cmp1.ok, await cmp1.text());
      const after1 = await getPassport(owner.token, owner.id);
      assert.strictEqual(after1.data.social.comparisonCount, beforeCount + 1);
      assert.ok(after1.data.social.distinctCollectorsCompared >= 1);

      const cmp2 = await fetch(`${API}/compare/${friend.id}?source=friends_list`, { headers: auth(owner.token) });
      assert.ok(cmp2.ok, await cmp2.text());
      const after2 = await getPassport(owner.token, owner.id);
      assert.strictEqual(
        after2.data.social.comparisonCount,
        beforeCount + 1,
        "reload within window must not inflate counter"
      );

      // Direct unit path: same pair skipped.
      const fakeResult = { summary: { insufficientData: false, catalogueVariantCount: 10 } };
      const again = await recordComparisonSession({
        initiatorId: owner.id,
        comparedUserId: friend.id,
        source: "direct",
        catalogueVersion: "test",
        result: fakeResult
      });
      assert.strictEqual(again.counted, false);
      assert.strictEqual(again.skippedReason, "deduped");

      const stats = await getComparisonStatsForUser(owner.id);
      assert.strictEqual(stats.comparisonCount, after2.data.social.comparisonCount);
    });

    await test("squad principale : choix explicite + masquage privé (Étapes 24–25)", async () => {
      // No auto-pick when unset.
      let pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.strictEqual(pass.data.primarySquad, null, "must not auto-select a squad");

      const create = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(owner.token),
        body: JSON.stringify({ name: `Bravo ${rnd()}` })
      });
      const created = await create.json();
      assert.ok(create.ok, JSON.stringify(created));
      const squadId = created.id || (created.squad && created.squad.id);
      assert.ok(squadId, "squad id required");

      // Still null until explicitly chosen.
      pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.data.primarySquad, null);

      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({
          primarySquadId: squadId,
          passportVisibility: "friends",
          statisticsVisibility: "friends"
        })
      });

      pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.ok(pass.data.primarySquad);
      assert.strictEqual(pass.data.primarySquad.private, false);
      assert.ok(pass.data.primarySquad.name);
      assert.ok(pass.data.primarySquad.memberCount >= 1);
      assert.strictEqual(typeof pass.data.primarySquad.collectiveCompletionRate, "number");
      assert.strictEqual(pass.data.primarySquad.role, "Fondateur");

      // Mark squad private for non-members.
      const { pool } = require("../../server/db");
      await pool.query("UPDATE squads SET visibility = 'private' WHERE id = $1", [squadId]);

      const friendView = await getPassport(friend.token, owner.id);
      assert.strictEqual(friendView.status, 200);
      assert.ok(friendView.data.primarySquad);
      assert.strictEqual(friendView.data.primarySquad.private, true);
      assert.strictEqual(friendView.data.primarySquad.display, "Squad privée");
      assert.strictEqual(friendView.data.primarySquad.name, undefined);
      assert.strictEqual(friendView.data.primarySquad.memberCount, undefined);
      assert.strictEqual(friendView.data.primarySquad.collectiveCompletionRate, undefined);
    });
}

module.exports = { run };
