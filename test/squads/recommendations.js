const {
  assert,
  test,
  rnd,
  register,
  cleanup,
  createSquad,
  joinSquad,
  sendFriendRequest,
  acceptFriendRequest,
  getSquadRecommendations,
  getSquadCompletion,
  setPrivacy,
  setEntry,
  resetCollection,
  blockUser,
  unblockUser
} = require("./shared");

module.exports = async function runRecommendations(samples) {
  const henry = await register(`SqHenry${rnd()}`),
    irene = await register(`SqIrene${rnd()}`);
  try {
    await sendFriendRequest(henry.token, irene.id);
    await acceptFriendRequest(irene.token, henry.id);
    const squad = await createSquad(henry.token, "Recommend Squad");
    await test("les contenus non sortis sont exclus des recommandations", async () => {
      await resetCollection(irene.token, irene.id);
      if (samples.unreleasedId) await setEntry(irene.token, irene.id, samples.unreleasedId, "owned");
      await setEntry(irene.token, irene.id, samples.activeId, "owned");
      const candidate = (await getSquadRecommendations(henry.token, squad.code)).recommendations.friendsToInvite.find(
        (c) => String(c.userId) === String(irene.id)
      );
      assert.ok(candidate, "friend not recommended");
      assert.ok(candidate.newVariantsForSquad >= 1, "active variant should contribute");
      if (samples.unreleasedId)
        assert.ok(
          candidate.potentialContribution <= candidate.newVariantsForSquad,
          "unreleased variant leaked into contribution"
        );
    });
    await test("les collections privées ne sont pas utilisées", async () => {
      await setPrivacy(irene.token, irene.id, "private");
      const candidate = (await getSquadRecommendations(henry.token, squad.code)).recommendations.friendsToInvite.find(
        (c) => String(c.userId) === String(irene.id)
      );
      assert.ok(!candidate, "private collection friend should not be recommended");
      await setPrivacy(irene.token, irene.id, "public");
    });
    await test("les utilisateurs bloqués ne sont pas recommandés", async () => {
      await setPrivacy(irene.token, irene.id, "public");
      await blockUser(henry.token, henry.id, irene.id);
      const candidate = (await getSquadRecommendations(henry.token, squad.code)).recommendations.friendsToInvite.find(
        (c) => String(c.userId) === String(irene.id)
      );
      assert.ok(!candidate, "blocked user should not be recommended");
    });
    await test("la contribution potentielle est exacte", async () => {
      await unblockUser(henry.token, henry.id, irene.id);
      await setPrivacy(irene.token, irene.id, "public");
      await sendFriendRequest(henry.token, irene.id);
      await acceptFriendRequest(irene.token, henry.id);
      const jack = await register(`SqJack${rnd()}`);
      try {
        await sendFriendRequest(henry.token, jack.id);
        await acceptFriendRequest(jack.token, henry.id);
        await resetCollection(irene.token, irene.id);
        await setEntry(irene.token, irene.id, samples.activeId, "owned");
        await resetCollection(jack.token, jack.id);
        const candidate = (await getSquadRecommendations(henry.token, squad.code)).recommendations.friendsToInvite.find(
          (c) => String(c.userId) === String(irene.id)
        );
        assert.ok(candidate, "irene not recommended");
        assert.strictEqual(candidate.newVariantsForSquad, 1, "potential contribution should be exactly 1");
        assert.strictEqual(candidate.potentialContribution, 1, "potentialContribution field mismatch");
      } finally {
        await cleanup(jack);
      }
    });
    await test("les pourcentages sont recalculés après une modification", async () => {
      await resetCollection(irene.token, irene.id);
      await setEntry(irene.token, irene.id, samples.activeId, "owned");
      let rec = await getSquadRecommendations(henry.token, squad.code);
      const before = rec.recommendations.friendsToInvite.find((c) => String(c.userId) === String(irene.id));
      assert.ok(before, "irene not recommended before");
      await joinSquad(irene.token, squad.code);
      rec = await getSquadRecommendations(henry.token, squad.code);
      const after = rec.recommendations.friendsToInvite.find((c) => String(c.userId) === String(irene.id));
      if (after) {
        assert.strictEqual(after.newVariantsForSquad, 0, "new variant count should be 0 after member owns it");
        assert.ok(
          after.currentCompletionRate > before.currentCompletionRate ||
            after.projectedCompletionRate > before.projectedCompletionRate,
          "rates should increase"
        );
      }
      assert.ok(rec.recommendations.memberComparisons.length > 0, "member comparisons missing");
    });
    await test("le périmètre d'analyse de la squad est bien défini", async () => {
      const scope = await getSquadCompletion(henry.token, squad.code);
      assert.strictEqual(scope.squadCode, squad.code, "scope should return squad code");
      assert.ok(
        typeof scope.catalogueVariantCount === "number" && scope.catalogueVariantCount >= 1,
        "catalogueVariantCount should be positive"
      );
      assert.ok(
        typeof scope.activeMemberCount === "number" && scope.activeMemberCount >= 1,
        "activeMemberCount should be at least owner"
      );
      assert.ok(
        scope.includedMemberCount <= scope.activeMemberCount,
        "includedMemberCount cannot exceed activeMemberCount"
      );
      assert.ok(scope.excludedUnreleasedVariants >= 0, "excludedUnreleasedVariants should be non-negative");
      assert.ok(scope.excludedPrivateCollections >= 0, "excludedPrivateCollections should be non-negative");
    });
  } finally {
    await cleanup(henry);
    await cleanup(irene);
  }
};
