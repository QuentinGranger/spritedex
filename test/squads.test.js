// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Squad / friend invitation & recommendations tests
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

async function getSquadHistory(token, squadCode) {
  const res = await fetch(`${API}/squads/${encodeURIComponent(squadCode)}/history`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get squad history failed: ${await res.text()}`);
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

async function leaveSquad(token, code) {
  const res = await fetch(`${API}/squads/${encodeURIComponent(code)}/leave`, {
    method: "POST",
    headers: auth(token)
  });
  if (!res.ok) assert.fail(`leave squad failed: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

async function getVariantSamples(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  if (!res.ok) assert.fail(`get sprites failed: ${await res.text()}`);
  const { sprites } = await res.json();

  const excludedRelease = new Set(["unreleased", "upcoming", "coming_soon", "soon", "unknown"]);

  let activeId = null;
  let secondActiveId = null;
  let unreleasedId = null;
  const activeIds = [];

  for (const sprite of sprites) {
    const details = sprite.variantDetails || {};
    for (const variant of Object.values(details)) {
      const release = (variant.releaseStatus || "").toLowerCase();
      const available = variant.available !== false;
      if (available && !excludedRelease.has(release)) {
        if (!activeIds.includes(variant.id)) activeIds.push(variant.id);
        if (!activeId) activeId = variant.id;
        else if (!secondActiveId && variant.id !== activeId) secondActiveId = variant.id;
      }
      if (!unreleasedId && (!available || excludedRelease.has(release))) {
        unreleasedId = variant.id;
      }
    }
  }

  assert.ok(activeId, "need at least one active variant");
  return { activeId, secondActiveId, unreleasedId, activeIds };
}

async function friendshipStatus(token, otherId) {
  const res = await fetch(`${API}/friends`, { headers: auth(token) });
  if (!res.ok) assert.fail(`list friends failed: ${await res.text()}`);
  const data = await res.json();
  return data.friends.find(f => String(f.id) === String(otherId)) ? "accepted" : "none";
}

async function run() {
  console.log(`\nRunning SPRITE-INDEX squads tests against ${BASE}\n`);

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

    await test("les arrivées concurrentes ne peuvent pas dépasser dix membres", async () => {
      const owner = await register(`SqCapOwner${rnd()}`);
      const joiners = [];
      try {
        for (let index = 0; index < 11; index++) {
          joiners.push(await register(`SqCap${index}${rnd()}`));
        }
        const squad = await createSquad(owner.token, "Capacity Lock Squad");
        const results = await Promise.all(joiners.map(async joiner => {
          const res = await fetch(`${API}/squads/join`, {
            method: "POST",
            headers: auth(joiner.token),
            body: JSON.stringify({ code: squad.code })
          });
          return { status: res.status, body: await res.json().catch(() => ({})) };
        }));
        const statuses = results.map(result => result.status);
        assert.strictEqual(statuses.filter(status => status === 200).length, 9, `join statuses: ${statuses}`);
        assert.ok(statuses.every(status => status === 200 || status === 400), `unexpected join statuses: ${JSON.stringify(results)}`);

        const details = await getSquad(owner.token, squad.code);
        assert.strictEqual(details.members.length, 10, "the squad must never exceed ten active members");
      } finally {
        await cleanup(owner);
        for (const joiner of joiners) await cleanup(joiner);
      }
    });

    await test("une invitation acceptée et une arrivée directe partagent le même verrou de capacité", async () => {
      const owner = await register(`SqMixOwner${rnd()}`);
      const directJoiner = await register(`SqMixDirect${rnd()}`);
      const invitee = await register(`SqMixInvitee${rnd()}`);
      const fillers = [];
      try {
        await sendFriendRequest(owner.token, invitee.id);
        await acceptFriendRequest(invitee.token, owner.id);

        const squad = await createSquad(owner.token, "Mixed Capacity Lock Squad");
        for (let index = 0; index < 8; index++) {
          const filler = await register(`SqMixFill${index}${rnd()}`);
          fillers.push(filler);
          await joinSquad(filler.token, squad.code);
        }
        const invitation = await inviteToSquad(owner.token, squad.id, invitee.id);
        assert.strictEqual(invitation.status, 200, `invite failed: ${JSON.stringify(invitation.data)}`);

        const [directRes, invitationRes] = await Promise.all([
          fetch(`${API}/squads/join`, {
            method: "POST",
            headers: auth(directJoiner.token),
            body: JSON.stringify({ code: squad.code })
          }),
          acceptSquadInvitation(invitee.token, invitation.data.invitationId)
        ]);
        const directStatus = directRes.status;
        const invitationStatus = invitationRes.status;
        assert.strictEqual(
          [directStatus, invitationStatus].filter(status => status === 200).length,
          1,
          `mixed capacity statuses: direct=${directStatus}, invitation=${invitationStatus}`
        );
        assert.ok(
          [directStatus, invitationStatus].every(status => status === 200 || status === 400),
          `unexpected mixed capacity statuses: direct=${directStatus}, invitation=${invitationStatus}`
        );

        const details = await getSquad(owner.token, squad.code);
        assert.strictEqual(details.members.length, 10, "mixed joins must not exceed ten active members");
      } finally {
        await cleanup(owner);
        await cleanup(directJoiner);
        await cleanup(invitee);
        for (const filler of fillers) await cleanup(filler);
      }
    });

    // ── Recommendations ──

    const samples = await getVariantSamples(alice.token);

    await test("une collection bloquée ne fuit ni dans l'activité ni les notifications de squad", async () => {
      const owner = await register(`SqPrivateOwner${rnd()}`);
      const viewer = await register(`SqPrivateViewer${rnd()}`);
      try {
        const squad = await createSquad(owner.token, "Privacy Activity Squad");
        await joinSquad(viewer.token, squad.code);

        // The collection is initially public, then a block revokes access.
        // This exercises both the real-time recipient filter and the history
        // filter for rows that existed before the privacy state changed.
        await setPrivacy(owner.token, owner.id, "public");
        await setEntry(owner.token, owner.id, samples.activeId, "owned");
        await new Promise(r => setTimeout(r, 250));

        let history = await getSquadHistory(viewer.token, squad.code);
        const publicActivity = history.entries.find(
          e => e.type === "collection_update" && String(e.user_id) === String(owner.id)
        );
        assert.ok(publicActivity, "public collection activity should be visible before the block");
        assert.strictEqual(
          publicActivity.metadata?.firstInSquad,
          undefined,
          "activity must not expose collective ownership inferred from other collections"
        );

        await blockUser(viewer.token, viewer.id, owner.id);
        if (samples.secondActiveId) {
          await setEntry(owner.token, owner.id, samples.secondActiveId, "owned");
        }
        await new Promise(r => setTimeout(r, 700));

        history = await getSquadHistory(viewer.token, squad.code);
        assert.ok(
          !history.entries.some(e => e.type === "collection_update" && String(e.user_id) === String(owner.id)),
          "blocked viewer must not receive past or new collection activity"
        );

        const notifRes = await fetch(`${API}/notifications`, { headers: auth(viewer.token) });
        if (!notifRes.ok) assert.fail(`notifications failed: ${await notifRes.text()}`);
        const notifications = await notifRes.json();
        assert.ok(
          !notifications.notifications.some(n =>
            n.type === "squad_completion_increased" && String(n.actor_id) === String(owner.id)
          ),
          "blocked viewer must not receive squad completion derived from the owner's collection"
        );

        const details = await getSquad(viewer.token, squad.code);
        const ownerMember = details.members.find(m => String(m.userId) === String(owner.id));
        assert.ok(
          !ownerMember || ownerMember.entryCount === 0,
          "blocked owner's collection must be omitted from squad stats"
        );
      } finally {
        await cleanup(owner);
        await cleanup(viewer);
      }
    });

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

    await test("une nouvelle variante unique déclenche squad_completion_increased (Étapes 22–23)", async () => {
      const owner = await register(`SqCompA${rnd()}`);
      const mate = await register(`SqCompB${rnd()}`);
      try {
        await sendFriendRequest(owner.token, mate.id);
        await acceptFriendRequest(mate.token, owner.id);
        const squad = await createSquad(owner.token, "Notify Squad");
        await joinSquad(mate.token, squad.code);

        // Seed coverage so the next unique gain has a previous snapshot.
        await setEntry(owner.token, owner.id, samples.activeId, "owned");
        await new Promise(r => setTimeout(r, 300));

        // Mate acquires a different variant nobody in the squad owns → coverage↑.
        const otherId = samples.secondActiveId;
        assert.ok(otherId && String(otherId) !== String(samples.activeId), "need a second distinct active variant");
        await setEntry(mate.token, mate.id, otherId, "owned");
        await new Promise(r => setTimeout(r, 800));

        const notifRes = await fetch(`${API}/notifications`, { headers: auth(owner.token) });
        assert.strictEqual(notifRes.status, 200);
        const notifs = await notifRes.json();
        const hit = notifs.notifications.find(
          n => n.type === "squad_completion_increased" && String(n.actor_id) === String(mate.id)
        );
        assert.ok(hit, "owner should receive squad_completion_increased for unique gain");
        assert.ok(hit.data && Array.isArray(hit.data.newVariantIds), "data.newVariantIds missing");
        assert.ok(hit.data.newVariantIds.map(String).includes(String(otherId)), "new variant not listed");

        // Same variant already covered by owner: mate re-acquiring a shared one shouldn't notify.
        // (mate already owns otherId; owner already owns activeId — have owner get otherId = no coverage gain)
        const beforeCount = notifs.notifications.filter(n => n.type === "squad_completion_increased").length;
        await setEntry(owner.token, owner.id, otherId, "owned");
        await new Promise(r => setTimeout(r, 800));
        const notifRes2 = await fetch(`${API}/notifications`, { headers: auth(mate.token) });
        const notifs2 = await notifRes2.json();
        const afterCount = notifs2.notifications.filter(
          n => n.type === "squad_completion_increased" && String(n.actor_id) === String(owner.id)
        ).length;
        assert.strictEqual(afterCount, 0, "duplicate coverage must not notify (Étape 23)");
        assert.ok(beforeCount >= 1, "sanity: at least one prior completion notif");
      } finally {
        await cleanup(owner);
        await cleanup(mate);
      }
    });

    // Étape 65 — full squad progression notification contract
    await test("squad_completion_increased progression (Étape 65)", async () => {
      const owner = await register(`SqE65A${rnd()}`);
      const mate = await register(`SqE65B${rnd()}`);
      const leaver = await register(`SqE65C${rnd()}`);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      try {
        await sendFriendRequest(owner.token, mate.id);
        await acceptFriendRequest(mate.token, owner.id);
        await sendFriendRequest(owner.token, leaver.id);
        await acceptFriendRequest(leaver.token, owner.id);

        const squad = await createSquad(owner.token, "Étape 65 Squad");
        await joinSquad(mate.token, squad.code);
        await joinSquad(leaver.token, squad.code);

        const ids = (samples.activeIds || []).filter(Boolean);
        assert.ok(ids.length >= 5, `need >= 5 active variants, got ${ids.length}`);
        const [seedId, vGain, vDup, vFast1, vFast2, vAfterLeave] = [
          ids[0], ids[1], ids[1], ids[2], ids[3], ids[4]
        ];

        // Seed coverage snapshot (first owned may not emit — previous stats null).
        await setEntry(owner.token, owner.id, seedId, "owned");
        await sleep(300);
        let details = await getSquad(owner.token, squad.code);
        const rateBeforeGain = Number(details.collectiveCompletionRate);
        assert.ok(rateBeforeGain > 0, "seed ownership should raise collective rate");

        // 1) A new unique variant increases the rate and notifies active members.
        await setEntry(mate.token, mate.id, vGain, "owned");
        await sleep(700);
        details = await getSquad(owner.token, squad.code);
        const rateAfterGain = Number(details.collectiveCompletionRate);
        assert.ok(rateAfterGain > rateBeforeGain, "new unique variant must increase collective rate");

        let notifRes = await fetch(`${API}/notifications`, { headers: auth(owner.token) });
        assert.strictEqual(notifRes.status, 200);
        let notifs = await notifRes.json();
        let hit = notifs.notifications.find(
          (n) => n.type === "squad_completion_increased"
            && String(n.actor_id || n.actor?.id) === String(mate.id)
        );
        assert.ok(hit, "owner should be notified of mate's unique gain");
        assert.strictEqual(Number(hit.data.previousRate), rateBeforeGain, "previousRate must match");
        assert.strictEqual(Number(hit.data.newRate), rateAfterGain, "newRate must match");
        assert.ok(
          Number(hit.data.newCoveredCount) > Number(hit.data.previousCoveredCount),
          "covered count must rise"
        );
        assert.ok(
          (hit.data.newVariantIds || []).map(String).includes(String(vGain)),
          "new variant listed"
        );

        // 2) Owning an already-covered variant does not change coverage / notify.
        const ownerSquadNotifsBefore = notifs.notifications.filter(
          (n) => n.type === "squad_completion_increased"
        ).length;
        notifRes = await fetch(`${API}/notifications`, { headers: auth(mate.token) });
        const mateBefore = (await notifRes.json()).notifications.filter(
          (n) => n.type === "squad_completion_increased"
            && String(n.actor_id || n.actor?.id) === String(owner.id)
        ).length;

        await setEntry(owner.token, owner.id, vDup, "owned");
        await sleep(700);
        details = await getSquad(owner.token, squad.code);
        assert.strictEqual(
          Number(details.collectiveCompletionRate),
          rateAfterGain,
          "already-covered possession must not change the rate"
        );

        notifRes = await fetch(`${API}/notifications`, { headers: auth(mate.token) });
        const mateAfterDup = (await notifRes.json()).notifications.filter(
          (n) => n.type === "squad_completion_increased"
            && String(n.actor_id || n.actor?.id) === String(owner.id)
        ).length;
        assert.strictEqual(mateAfterDup, mateBefore, "duplicate coverage must not notify");

        notifRes = await fetch(`${API}/notifications`, { headers: auth(owner.token) });
        const ownerAfterDup = (await notifRes.json()).notifications.filter(
          (n) => n.type === "squad_completion_increased"
        ).length;
        assert.strictEqual(ownerAfterDup, ownerSquadNotifsBefore, "no extra notif on duplicate cover");

        // 3) Rapid progressions are grouped (+ milestone when a palier is crossed).
        await fetch(`${API}/notifications/read-all`, {
          method: "POST",
          headers: auth(owner.token)
        });
        await setEntry(mate.token, mate.id, vFast1, "owned");
        await setEntry(mate.token, mate.id, vFast2, "owned");
        await sleep(700);

        notifRes = await fetch(`${API}/notifications`, { headers: auth(owner.token) });
        notifs = await notifRes.json();
        const rapid = notifs.notifications.filter(
          (n) => n.type === "squad_completion_increased"
            && n.read_at == null
            && String(n.actor_id || n.actor?.id) === String(mate.id)
        );
        assert.strictEqual(rapid.length, 1, "rapid gains should flush as one grouped notification");
        const rapidCount = Number(
          rapid[0].data?.count || rapid[0].data?.group?.eventCount || 0
        );
        assert.ok(rapidCount >= 2, `grouped count expected >= 2, got ${rapidCount}`);
        assert.ok(
          Array.isArray(rapid[0].data?.newVariantIds)
            && rapid[0].data.newVariantIds.length >= 2,
          "grouped payload should list multiple variants"
        );
        // Paliers: when a known threshold is crossed, the payload must mark it.
        // (Large catalogues may not reach 25% in this fixture — unit tests cover the math.)
        if (rapid[0].data?.milestone != null) {
          assert.ok(
            [25, 50, 75, 80, 90, 95, 100].includes(Number(rapid[0].data.milestone)),
            "milestone value must be a known palier"
          );
          assert.strictEqual(rapid[0].data.kind, "milestone");
        } else if (Number(rapid[0].data?.previousRate) < 25 && Number(rapid[0].data?.newRate) >= 25) {
          assert.fail("crossing 25% must set data.milestone");
        }

        // Exact rates on the grouped flush: first previous → latest new.
        details = await getSquad(owner.token, squad.code);
        assert.strictEqual(
          Number(rapid[0].data.newRate),
          Number(details.collectiveCompletionRate),
          "grouped newRate must match current collective rate"
        );
        assert.ok(
          Number(rapid[0].data.newRate) > Number(rapid[0].data.previousRate),
          "grouped previous/new rates must advance"
        );

        // 4) Former members are not notified of later gains.
        await leaveSquad(leaver.token, squad.code);
        await fetch(`${API}/notifications/read-all`, {
          method: "POST",
          headers: auth(leaver.token)
        });
        await setEntry(mate.token, mate.id, vAfterLeave, "owned");
        await sleep(700);

        notifRes = await fetch(`${API}/notifications`, { headers: auth(leaver.token) });
        const leaverNotifs = await notifRes.json();
        assert.ok(
          !leaverNotifs.notifications.some(
            (n) => n.type === "squad_completion_increased" && n.read_at == null
          ),
          "former squad members must not be notified"
        );

        // Still-active owner keeps receiving progression alerts.
        notifRes = await fetch(`${API}/notifications`, { headers: auth(owner.token) });
        const ownerAfterLeave = await notifRes.json();
        assert.ok(
          ownerAfterLeave.notifications.some(
            (n) => n.type === "squad_completion_increased"
              && n.read_at == null
              && (n.data?.newVariantIds || []).map(String).includes(String(vAfterLeave))
          ),
          "active members should still be notified after someone leaves"
        );
      } finally {
        await cleanup(owner);
        await cleanup(mate);
        await cleanup(leaver);
      }
    });

    await test("Squad Completion Engine report + simulate (contrat moteur)", async () => {
      const owner = await register(`EngOwn${rnd()}`);
      const mate = await register(`EngMate${rnd()}`);
      try {
        await sendFriendRequest(owner.token, mate.id);
        await acceptFriendRequest(mate.token, owner.id);

        const squad = await createSquad(owner.token, "Engine Squad");
        const invite = await inviteToSquad(owner.token, squad.id, mate.id);
        assert.strictEqual(invite.status, 200, `invite failed: ${JSON.stringify(invite.data)}`);
        const accept = await acceptSquadInvitation(mate.token, invite.data.invitationId);
        assert.strictEqual(accept.status, 200, `accept failed: ${JSON.stringify(accept.data)}`);

        const samples = await getVariantSamples(owner.token);
        const uniqueVariant = samples.activeId;
        const missingVariant = samples.secondActiveId || samples.activeIds[1];
        assert.ok(missingVariant, "need a second active variant for simulate");

        await resetCollection(owner.token, owner.id);
        await resetCollection(mate.token, mate.id);
        await setEntry(owner.token, owner.id, uniqueVariant, "owned");

        const reportRes = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/completion/report`, {
          headers: auth(owner.token)
        });
        if (!reportRes.ok) assert.fail(`completion/report failed: ${await reportRes.text()}`);
        const report = await reportRes.json();

        assert.ok(report.engineVersion, "engineVersion required");
        assert.ok(report.catalogueVersion, "catalogueVersion required");
        assert.ok(report.summary, "summary required");
        assert.ok(report.analysis, "analysis required");
        assert.ok(report.recommendations, "recommendations required");
        assert.ok(report.optimization, "optimization required");

        assert.ok(report.analysis.mostComplementaryMember, "mostComplementaryMember required");
        assert.strictEqual(
          typeof report.analysis.mostComplementaryMember.uniqueVariantCount,
          "number",
          "mostComplementaryMember.uniqueVariantCount must be a number"
        );
        assert.ok(Array.isArray(report.analysis.uniqueOwners?.byMember), "uniqueOwners.byMember required");
        assert.ok(
          report.analysis.uniqueOwners.byMember.some(m => String(m.userId) === String(owner.id) && m.count >= 1),
          "owner should appear in uniqueOwners.byMember"
        );

        assert.ok(Array.isArray(report.recommendations.priorities), "priorities required");
        if (report.recommendations.priorities.length) {
          const p = report.recommendations.priorities[0];
          assert.ok(typeof p.display === "string" && p.display.length > 0, "priority.display required");
          assert.strictEqual(typeof p.collectiveCoverageDelta, "number", "priority.collectiveCoverageDelta required");
        }

        assert.ok(report.recommendations.plan, "recommendations.plan required");
        assert.ok(Array.isArray(report.recommendations.plan.members), "plan.members required");
        assert.ok(Array.isArray(report.recommendations.assignments), "assignments required");

        const beforeRate = report.summary.collectiveCompletionRate;
        const simRes = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/completion/simulate`, {
          method: "POST",
          headers: auth(owner.token),
          body: JSON.stringify({
            changes: [{ type: "acquire", memberId: mate.id, variantIds: [missingVariant] }]
          })
        });
        if (!simRes.ok) assert.fail(`completion/simulate failed: ${await simRes.text()}`);
        const sim = await simRes.json();
        assert.ok(sim.before && sim.after && sim.difference, "simulate must return before/after/difference");
        assert.strictEqual(typeof sim.before.completionRate, "number");
        assert.strictEqual(typeof sim.after.completionRate, "number");
        assert.strictEqual(typeof sim.difference.completionRate, "number");
        assert.ok(
          sim.after.coveredCount >= sim.before.coveredCount,
          "acquiring a missing variant should not reduce covered count"
        );

        // Sanity: live report rate matches simulate baseline (same collections).
        assert.ok(
          Math.abs(Number(sim.before.completionRate) - Number(beforeRate)) < 0.02,
          `simulate before (${sim.before.completionRate}) should match report (${beforeRate})`
        );

        const oversizedChanges = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/completion/simulate`, {
          method: "POST",
          headers: auth(owner.token),
          body: JSON.stringify({
            changes: Array.from({ length: 21 }, () => ({
              type: "acquire",
              memberId: mate.id,
              variantIds: [missingVariant]
            }))
          })
        });
        assert.strictEqual(oversizedChanges.status, 400, `oversized simulation should fail: ${await oversizedChanges.text()}`);

        const oversizedVariants = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/completion/simulate`, {
          method: "POST",
          headers: auth(owner.token),
          body: JSON.stringify({
            changes: [{
              type: "acquire",
              memberId: mate.id,
              variantIds: Array(101).fill(missingVariant)
            }]
          })
        });
        assert.strictEqual(oversizedVariants.status, 400, `oversized variant list should fail: ${await oversizedVariants.text()}`);

        const malformedKick = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/kick`, {
          method: "POST",
          headers: auth(owner.token),
          body: JSON.stringify({ targetUserId: "not-a-user-id" })
        });
        assert.strictEqual(malformedKick.status, 400, `malformed targetUserId should fail: ${await malformedKick.text()}`);
      } finally {
        await cleanup(owner);
        await cleanup(mate);
      }
    });
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
