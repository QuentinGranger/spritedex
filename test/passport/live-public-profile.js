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
  await test("actions contextuelles ami / public (Étape 66)", async () => {
    await fetch(`${API}/profile/${owner.id}/passport/settings`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({
        passportVisibility: "friends",
        statisticsVisibility: "friends",
        comparisonsVisibility: "friends"
      })
    });
    await fetch(`${API}/friends/${friend.id}/request`, { method: "POST", headers: auth(owner.token) });
    await fetch(`${API}/friends/${owner.id}/accept`, { method: "POST", headers: auth(friend.token) });

    const friendView = await getPassport(friend.token, owner.id);
    assert.strictEqual(friendView.status, 200);
    assert.ok(friendView.data.relationship && friendView.data.relationship.isFriend);
    assert.ok(friendView.data.actions.includes("compare_collections"));
    assert.ok(friendView.data.actions.includes("invite_to_squad"));
    assert.ok(friendView.data.actions.includes("create_shared_goal"));
    assert.ok(!friendView.data.actions.includes("edit_profile"));

    await fetch(`${API}/profile/${owner.id}/passport/settings`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({
        passportVisibility: "public",
        statisticsVisibility: "public",
        comparisonsVisibility: "public"
      })
    });
    const strangerView = await getPassport(stranger.token, owner.id);
    assert.strictEqual(strangerView.status, 200);
    assert.ok(strangerView.data.actions.includes("add_friend"));
    assert.ok(strangerView.data.actions.includes("view_public_collection"));
  });

  await test("URL publique /u/:username + API normalisée (Étapes 67 & 70)", async () => {
    await fetch(`${API}/profile/${owner.id}/passport/settings`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({
        passportVisibility: "public",
        statisticsVisibility: "public",
        badgesVisibility: "public",
        activityVisibility: "public"
      })
    });

    const byUsername = await fetch(`${API}/u/${encodeURIComponent(owner.username)}/passport`);
    assert.strictEqual(byUsername.status, 200);
    const normalized = await byUsername.json();
    assert.ok(normalized.user);
    assert.strictEqual(normalized.user.username, owner.username);
    assert.ok(String(normalized.user.id).startsWith("user_"));
    assert.ok(normalized.passport);
    assert.ok(normalized.passport.statistics);
    assert.strictEqual(typeof normalized.passport.statistics.completionRate, "number");
    assert.ok(normalized.publicUrl.startsWith("/u/"));
    assert.ok(!JSON.stringify(normalized).includes("@example.com"), "never leak email");

    const formatNorm = await fetch(`${API}/profile/${owner.id}/passport?format=normalized`, {
      headers: auth(owner.token)
    });
    assert.strictEqual(formatNorm.status, 200);
    const selfNorm = await formatNorm.json();
    assert.ok(selfNorm.passport.statistics);
    assert.ok(Array.isArray(selfNorm.actions));
    assert.ok(selfNorm.actions.includes("share_passport"));

    const card = await fetch(`${API}/u/${encodeURIComponent(owner.username)}/passport/card`, {
      headers: auth(owner.token)
    });
    assert.strictEqual(card.status, 200);
    const cardData = await card.json();
    assert.strictEqual(cardData.username, owner.username);
    assert.ok(cardData.availableFields);
    assert.ok(!("email" in cardData));
    assert.ok(!("friends" in cardData));
    assert.ok(!("notes" in cardData));
  });

  await test("rename : redirect temporaire + réservation (Étape 67)", async () => {
    const oldUsername = owner.username;
    const newUsername = `ren_${rnd()}`.slice(0, 20);
    const patch = await fetch(`${API}/profile/${owner.id}`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({ username: newUsername })
    });
    assert.ok(patch.ok, await patch.text());
    owner.username = newUsername;

    // Old slug redirects while reserved.
    const redirectApi = await fetch(`${API}/u/${encodeURIComponent(oldUsername)}/passport`, {
      redirect: "manual"
    });
    assert.ok([301, 302, 307, 308].includes(redirectApi.status), `expected redirect, got ${redirectApi.status}`);

    // Another user cannot take the reserved old username.
    const steal = await fetch(`${API}/profile/${stranger.id}`, {
      method: "PATCH",
      headers: auth(stranger.token),
      body: JSON.stringify({ username: oldUsername })
    });
    assert.strictEqual(steal.status, 409);

    // New slug resolves.
    await fetch(`${API}/profile/${owner.id}/passport/settings`, {
      method: "PATCH",
      headers: auth(owner.token),
      body: JSON.stringify({ passportVisibility: "public", statisticsVisibility: "public" })
    });
    const ok = await fetch(`${API}/u/${encodeURIComponent(newUsername)}/passport`);
    assert.strictEqual(ok.status, 200);
  });
}

module.exports = { run };
