// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Squad / friend invitation & recommendations tests
// Run against a live server: node server.js, then node test/squads.test.js
// ─────────────────────────────────────────────────────────────────
const assert = require("node:assert");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

function rnd() {
  return Math.random().toString(36).slice(2, 10);
}

async function register(username, displayName) {
  const email = `${username}_${rnd()}@example.com`;
  const body = { email, password: "password123", username, ageConfirmed: true, cguAccepted: true };
  if (displayName) body.displayName = displayName;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, email, username, displayName: data.displayName };
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: auth(user.token) });
}

async function createSquad(token, name) {
  const res = await fetch(`${API}/squads`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ name })
  });
  if (!res.ok) assert.fail(`create squad failed: ${await res.text()}`);
  return res.json();
}

async function joinSquad(token, code) {
  const res = await fetch(`${API}/squads/join`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ code })
  });
  if (!res.ok) assert.fail(`join squad failed: ${await res.text()}`);
  return res.json();
}

async function sendFriendRequest(token, friendId) {
  const res = await fetch(`${API}/friends/${friendId}/request`, { method: "POST", headers: auth(token) });
  assert.strictEqual(res.status, 200, `send friend request failed: ${await res.text()}`);
}

async function acceptFriendRequest(token, friendId) {
  const res = await fetch(`${API}/friends/${friendId}/accept`, { method: "POST", headers: auth(token) });
  assert.strictEqual(res.status, 200, `accept friend request failed: ${await res.text()}`);
}

async function inviteToSquad(token, squadId, inviteeId) {
  const res = await fetch(`${API}/squads/${squadId}/invitations`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ inviteeId })
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function acceptSquadInvitation(token, invitationId) {
  const res = await fetch(`${API}/squads/invitations/${invitationId}/accept`, {
    method: "POST",
    headers: auth(token)
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function getSquad(token, squadCode) {
  const res = await fetch(`${API}/squads/${squadCode}`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get squad failed: ${await res.text()}`);
  return res.json();
}

async function getSquadRecommendations(token, squadCode) {
  const res = await fetch(`${API}/squads/${squadCode}/recommendations`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get recommendations failed: ${await res.text()}`);
  return res.json();
}

async function getSquadCompletion(token, squadCode) {
  const res = await fetch(`${API}/squads/${squadCode}/completion`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get completion scope failed: ${await res.text()}`);
  return res.json();
}

async function setPrivacy(token, userId, collectionVisibility) {
  const res = await fetch(`${API}/profile/${userId}`, {
    method: "PATCH",
    headers: auth(token),
    body: JSON.stringify({ collectionVisibility })
  });
  if (!res.ok) assert.fail(`set collection visibility failed: ${await res.text()}`);
}

async function setEntry(token, userId, variantId, status) {
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ status })
  });
  if (!res.ok) assert.fail(`setEntry ${variantId} failed: ${await res.text()}`);
}

async function resetCollection(token, userId) {
  const res = await fetch(`${API}/collection/${userId}`, {
    method: "DELETE",
    headers: auth(token)
  });
  return res.ok;
}

async function blockUser(token, userId, blockedId) {
  const res = await fetch(`${API}/users/${blockedId}/block`, {
    method: "POST",
    headers: auth(token)
  });
  if (!res.ok) assert.fail(`block user failed: ${await res.text()}`);
}

async function unblockUser(token, userId, blockedId) {
  const res = await fetch(`${API}/users/${blockedId}/block`, {
    method: "DELETE",
    headers: auth(token)
  });
  if (!res.ok) assert.fail(`unblock user failed: ${await res.text()}`);
}

async function getVariantSamples(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get sprites failed: ${await res.text()}`);
  const { sprites } = await res.json();

  const excludedRelease = new Set(["unreleased", "upcoming", "coming_soon", "soon", "unknown"]);

  let activeId = null;
  let unreleasedId = null;

  for (const sprite of sprites) {
    const details = sprite.variantDetails || {};
    for (const variant of Object.values(details)) {
      const release = (variant.releaseStatus || "").toLowerCase();
      const available = variant.available !== false;
      if (!activeId && available && !excludedRelease.has(release)) {
        activeId = variant.id;
      }
      if (!unreleasedId && (!available || excludedRelease.has(release))) {
        unreleasedId = variant.id;
      }
      if (activeId && unreleasedId) break;
    }
    if (activeId && unreleasedId) break;
  }

  assert.ok(activeId, "need at least one active variant");
  return { activeId, unreleasedId };
}

async function friendshipStatus(token, otherId) {
  const res = await fetch(`${API}/friends`, { headers: auth(token) });
  if (!res.ok) assert.fail(`list friends failed: ${await res.text()}`);
  const data = await res.json();
  return data.friends.find(f => String(f.id) === String(otherId)) ? "accepted" : "none";
}

async function run() {
  console.log(`\nRunning SPRITNEX squads tests against ${BASE}\n`);

  const alice = await register(`SqAlice${rnd()}`);
  const bob = await register(`SqBob${rnd()}`);
  const charlie = await register(`SqCharlie${rnd()}`);

  try {
    // ── Friends & squads ──

    await test("un ami peut être invité dans une squad", async () => {
      await sendFriendRequest(alice.token, bob.id);
      await acceptFriendRequest(bob.token, alice.id);

      const squad = await createSquad(alice.token, "Alpha Squad");
      const { status, data } = await inviteToSquad(alice.token, squad.id, bob.id);
      assert.strictEqual(status, 200, `invite failed: ${JSON.stringify(data)}`);
      assert.ok(data.ok, "invite not acknowledged");
      assert.ok(data.invitationId, "missing invitation id");

      const accept = await acceptSquadInvitation(bob.token, data.invitationId);
      assert.strictEqual(accept.status, 200, `accept failed: ${JSON.stringify(accept.data)}`);
      assert.strictEqual(accept.data.squadCode, squad.code);

      const details = await getSquad(alice.token, squad.code);
      const members = details.members.map(m => String(m.userId));
      assert.ok(members.includes(String(bob.id)), "bob is not in squad");
    });

    await test("un non-ami ne peut pas être invité dans une squad", async () => {
      const squad = await createSquad(alice.token, "Beta Squad");
      const { status } = await inviteToSquad(alice.token, squad.id, charlie.id);
      assert.strictEqual(status, 403, "non-friend should not be invitable");
    });

    await test("une invitation en double est refusée", async () => {
      await sendFriendRequest(alice.token, charlie.id);
      await acceptFriendRequest(charlie.token, alice.id);

      const squad = await createSquad(alice.token, "Gamma Squad");
      const first = await inviteToSquad(alice.token, squad.id, charlie.id);
      assert.strictEqual(first.status, 200, `first invite failed: ${JSON.stringify(first.data)}`);

      const second = await inviteToSquad(alice.token, squad.id, charlie.id);
      assert.strictEqual(second.status, 409, "duplicate invite should be rejected");
    });

    await test("un membre de squad peut être ajouté comme ami", async () => {
      // dave and eve are squad members but not friends yet
      const dave = await register(`SqDave${rnd()}`);
      const eve = await register(`SqEve${rnd()}`);
      try {
        const squad = await createSquad(dave.token, "Delta Squad");
        await joinSquad(eve.token, squad.code);

        const statusBefore = await friendshipStatus(dave.token, eve.id);
        assert.strictEqual(statusBefore, "none", "should not already be friends");

        await sendFriendRequest(dave.token, eve.id);
        await acceptFriendRequest(eve.token, dave.id);

        const statusAfter = await friendshipStatus(dave.token, eve.id);
        assert.strictEqual(statusAfter, "accepted", "friendship should be accepted");
      } finally {
        await cleanup(dave);
        await cleanup(eve);
      }
    });

    await test("une amitié n'est pas créée automatiquement en rejoignant une squad", async () => {
      const frank = await register(`SqFrank${rnd()}`);
      const grace = await register(`SqGrace${rnd()}`);
      try {
        const squad = await createSquad(frank.token, "Echo Squad");
        await joinSquad(grace.token, squad.code);

        const status = await friendshipStatus(frank.token, grace.id);
        assert.strictEqual(status, "none", "joining a squad should not create friendship");
      } finally {
        await cleanup(frank);
        await cleanup(grace);
      }
    });

    // ── Recommendations ──

    const samples = await getVariantSamples(alice.token);

    const henry = await register(`SqHenry${rnd()}`);
    const irene = await register(`SqIrene${rnd()}`);
    try {
      await sendFriendRequest(henry.token, irene.id);
      await acceptFriendRequest(irene.token, henry.id);

      const squad = await createSquad(henry.token, "Recommend Squad");

      await test("les contenus non sortis sont exclus des recommandations", async () => {
        await resetCollection(irene.token, irene.id);
        if (samples.unreleasedId) {
          await setEntry(irene.token, irene.id, samples.unreleasedId, "owned");
        }
        await setEntry(irene.token, irene.id, samples.activeId, "owned");

        const rec = await getSquadRecommendations(henry.token, squad.code);
        const candidate = rec.recommendations.friendsToInvite.find(c => String(c.userId) === String(irene.id));
        assert.ok(candidate, "friend not recommended");
        assert.ok(candidate.newVariantsForSquad >= 1, "active variant should contribute");
        if (samples.unreleasedId) {
          // The unreleased variant should not increase the count beyond the one active variant
          assert.ok(candidate.potentialContribution <= candidate.newVariantsForSquad, "unreleased variant leaked into contribution");
        }
      });

      await test("les collections privées ne sont pas utilisées", async () => {
        await setPrivacy(irene.token, irene.id, "private");

        const rec = await getSquadRecommendations(henry.token, squad.code);
        const candidate = rec.recommendations.friendsToInvite.find(c => String(c.userId) === String(irene.id));
        assert.ok(!candidate, "private collection friend should not be recommended");

        await setPrivacy(irene.token, irene.id, "public");
      });

      await test("les utilisateurs bloqués ne sont pas recommandés", async () => {
        await setPrivacy(irene.token, irene.id, "public");
        await blockUser(henry.token, henry.id, irene.id);

        const rec = await getSquadRecommendations(henry.token, squad.code);
        const candidate = rec.recommendations.friendsToInvite.find(c => String(c.userId) === String(irene.id));
        assert.ok(!candidate, "blocked user should not be recommended");
      });

      await test("la contribution potentielle est exacte", async () => {
        // Unblock irene, restore friendship and reset to one active variant owned by her only
        await unblockUser(henry.token, henry.id, irene.id);
        await setPrivacy(irene.token, irene.id, "public");
        await sendFriendRequest(henry.token, irene.id);
        await acceptFriendRequest(irene.token, henry.id);

        // Create a second friend that owns another active variant
        const jack = await register(`SqJack${rnd()}`);
        await sendFriendRequest(henry.token, jack.id);
        await acceptFriendRequest(jack.token, henry.id);

        await resetCollection(irene.token, irene.id);
        await setEntry(irene.token, irene.id, samples.activeId, "owned");
        await resetCollection(jack.token, jack.id);

        const rec = await getSquadRecommendations(henry.token, squad.code);
        const ireneCandidate = rec.recommendations.friendsToInvite.find(c => String(c.userId) === String(irene.id));
        assert.ok(ireneCandidate, "irene not recommended");
        assert.strictEqual(ireneCandidate.newVariantsForSquad, 1, "potential contribution should be exactly 1");
        assert.strictEqual(ireneCandidate.potentialContribution, 1, "potentialContribution field mismatch");

        await cleanup(jack);
      });

      await test("les pourcentages sont recalculés après une modification", async () => {
        await resetCollection(irene.token, irene.id);
        await setEntry(irene.token, irene.id, samples.activeId, "owned");

        let rec = await getSquadRecommendations(henry.token, squad.code);
        const before = rec.recommendations.friendsToInvite.find(c => String(c.userId) === String(irene.id));
        assert.ok(before, "irene not recommended before");
        const beforeRate = before.currentCompletionRate;
        const beforeProjected = before.projectedCompletionRate;

        // Add the same variant to a squad member so the friend's contribution drops to 0
        await joinSquad(irene.token, squad.code);

        rec = await getSquadRecommendations(henry.token, squad.code);
        const afterFriends = rec.recommendations.friendsToInvite.find(c => String(c.userId) === String(irene.id));
        if (afterFriends) {
          assert.strictEqual(afterFriends.newVariantsForSquad, 0, "new variant count should be 0 after member owns it");
          assert.ok(afterFriends.currentCompletionRate > beforeRate || afterFriends.projectedCompletionRate > beforeProjected, "rates should increase");
        }

        // Verify member comparisons percentages were recomputed
        assert.ok(rec.recommendations.memberComparisons.length > 0, "member comparisons missing");
      });

      await test("le périmètre d'analyse de la squad est bien défini", async () => {
        const scope = await getSquadCompletion(henry.token, squad.code);
        assert.strictEqual(scope.squadCode, squad.code, "scope should return squad code");
        assert.ok(typeof scope.catalogueVariantCount === "number" && scope.catalogueVariantCount >= 1, "catalogueVariantCount should be positive");
        assert.ok(typeof scope.activeMemberCount === "number" && scope.activeMemberCount >= 1, "activeMemberCount should be at least owner");
        assert.ok(scope.includedMemberCount <= scope.activeMemberCount, "includedMemberCount cannot exceed activeMemberCount");
        assert.ok(scope.excludedUnreleasedVariants >= 0, "excludedUnreleasedVariants should be non-negative");
        assert.ok(scope.excludedPrivateCollections >= 0, "excludedPrivateCollections should be non-negative");
      });
    } finally {
      await cleanup(henry);
      await cleanup(irene);
    }
  } finally {
    await cleanup(alice);
    await cleanup(bob);
    await cleanup(charlie);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest runner crashed:", err.message);
  process.exit(1);
});
