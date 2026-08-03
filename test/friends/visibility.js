"use strict";

module.exports = async function runVisibility(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  const paul = await register(`FrPaul${rnd()}`);
  const quinn = await register(`FrQuinn${rnd()}`);
  const roger = await register(`FrRoger${rnd()}`);
  try {
    await becomeFriends(paul, quinn);
    await becomeFriends(roger, quinn);
    await test("private collection blocks comparison even between friends", async () => {
      await setVisibility(quinn, { collectionVisibility: "private" });
      const res = await fetch(`${API}/compare/${quinn.id}`, { headers: auth(paul.token) });
      assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
    });

    await test("friends visibility allows accepted friends to compare", async () => {
      await setVisibility(quinn, { collectionVisibility: "friends" });
      const res = await fetch(`${API}/compare/${quinn.id}`, { headers: auth(paul.token) });
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert.ok(data.records, "compare result missing");
    });

    await test("pending friend cannot compare with friends visibility", async () => {
      // sever roger friendship; send a new pending request
      let res = await fetch(`${API}/friends/${roger.id}/remove`, { method: "POST", headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`remove failed: ${await res.text()}`);
      res = await fetch(`${API}/friends/${quinn.id}/request`, { method: "POST", headers: auth(roger.token) });
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);

      res = await fetch(`${API}/compare/${quinn.id}`, { headers: auth(roger.token) });
      assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);

      // accept for the squad test below
      res = await fetch(`${API}/friends/${roger.id}/accept`, { method: "POST", headers: auth(quinn.token) });
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
    });

    await test("squad visibility allows squad members but not friends outside squad", async () => {
      // paul joins a squad with quinn; roger does not
      const squadRes = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(quinn.token),
        body: JSON.stringify({ name: "Alpha Squad" })
      });
      assert.strictEqual(squadRes.status, 200, `expected 200, got ${squadRes.status}`);
      const squad = await squadRes.json();

      const joinPaul = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(paul.token),
        body: JSON.stringify({ code: squad.code })
      });
      assert.ok(joinPaul.ok, `paul join failed: ${await joinPaul.text()}`);

      await setVisibility(quinn, { collectionVisibility: "squad" });

      let res = await fetch(`${API}/compare/${quinn.id}`, { headers: auth(paul.token) });
      assert.strictEqual(res.status, 200, `expected 200 for squad member, got ${res.status}`);

      res = await fetch(`${API}/compare/${quinn.id}`, { headers: auth(roger.token) });
      assert.strictEqual(res.status, 403, `expected 403 for friend outside squad, got ${res.status}`);
    });

    await test("squad profile visibility excludes friends from search", async () => {
      await setVisibility(quinn, { profileVisibility: "squad" });

      // roger searches for quinn and should not find her
      const searchRoger = await fetch(`${API}/users/search?q=${encodeURIComponent(quinn.username)}`, {
        headers: auth(roger.token)
      });
      const rogerResults = await searchRoger.json();
      assert.ok(!rogerResults.users.some((u) => u.id === quinn.id), "roger found squad-only profile");

      // paul (squad member) should find her
      const searchPaul = await fetch(`${API}/users/search?q=${encodeURIComponent(quinn.username)}`, {
        headers: auth(paul.token)
      });
      const paulResults = await searchPaul.json();
      assert.ok(
        paulResults.users.some((u) => u.id === quinn.id),
        "paul did not find squad profile"
      );
    });

    await test("private profile users are not returned in search", async () => {
      await setVisibility(quinn, { profileVisibility: "private" });

      const searchRes = await fetch(`${API}/users/search?q=${encodeURIComponent(quinn.username)}`, {
        headers: auth(roger.token)
      });
      assert.strictEqual(searchRes.status, 200, `expected 200, got ${searchRes.status}`);
      const results = await searchRes.json();
      assert.ok(!results.users.some((u) => u.id === quinn.id), "private profile found in search");

      await setVisibility(quinn, { profileVisibility: "friends" });
    });

    await test("public collection allows any authenticated user to compare", async () => {
      await setVisibility(quinn, { collectionVisibility: "public" });

      // roger is a friend; make him compare with quinn (public)
      const res = await fetch(`${API}/comparisons/users/${roger.id}/${quinn.id}`, { headers: auth(roger.token) });
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert.ok(data.records, "compare result missing");
    });

    await test("share link allows public visitor to view collection", async () => {
      const create = await fetch(`${API}/compare/share`, {
        method: "POST",
        headers: auth(quinn.token),
        body: JSON.stringify({ duration: "1h" })
      });
      assert.ok(create.ok, `create share failed: ${create.status}`);
      const { token: shareToken } = await create.json();

      const use = await fetch(`${API}/compare/share/${shareToken}`);
      assert.strictEqual(use.status, 200, `expected 200, got ${use.status}`);
      const data = await use.json();
      assert.ok(data.result && data.result.records, "visitor share result missing");
    });

    await test("leaving member removes contribution but keeps personal collection", async () => {
      // Ensure public collections so squad coverage can be computed.
      await setVisibility(quinn, { collectionVisibility: "public" });
      await setVisibility(paul, { collectionVisibility: "public" });
      await setVisibility(roger, { collectionVisibility: "public" });

      // Create a fresh squad with Quinn (owner), Paul and Roger.
      let res = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(quinn.token),
        body: JSON.stringify({ name: "Bravo Six" })
      });
      if (!res.ok) assert.fail(`create squad failed: ${await res.text()}`);
      const squad = await res.json();

      res = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(paul.token),
        body: JSON.stringify({ code: squad.code })
      });
      if (!res.ok) assert.fail(`paul join failed: ${await res.text()}`);

      res = await fetch(`${API}/squads/${squad.code}/invite/${roger.id}`, {
        method: "POST",
        headers: auth(quinn.token)
      });
      if (!res.ok) assert.fail(`roger invite failed: ${await res.text()}`);
      let { invitationId } = await res.json();

      // Roger accepts the invitation to become an active member.
      res = await fetch(`${API}/squads/invitations/${invitationId}/accept`, {
        method: "POST",
        headers: auth(roger.token)
      });
      if (!res.ok) assert.fail(`roger accept invite failed: ${await res.text()}`);

      // Find an active variant id from the compare catalog.
      const cmpRes = await fetch(`${API}/comparisons/users/${paul.id}/${roger.id}`, { headers: auth(quinn.token) });
      if (cmpRes.status !== 200) assert.fail(`compare failed: ${await cmpRes.text()}`);
      const cmpData = await cmpRes.json();
      const records = cmpData.records || [];
      assert.ok(records.length > 0, "no active variants");
      const variantId = records[0].variantId;

      // Roger owns a variant nobody else has.
      await setEntry(roger.token, roger.id, variantId, "owned");

      // Squad coverage now counts Roger's variant.
      res = await fetch(`${API}/squads/${squad.code}`, { headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`squad details failed: ${await res.text()}`);
      const withRoger = await res.json();
      assert.ok(withRoger.collectiveCompletionRate > 0, "squad coverage should include roger's contribution");

      // Roger leaves the squad.
      res = await fetch(`${API}/squads/${squad.code}/leave`, {
        method: "POST",
        headers: auth(roger.token)
      });
      if (!res.ok) assert.fail(`roger leave failed: ${await res.text()}`);

      // Squad coverage is recalculated without Roger's contribution.
      res = await fetch(`${API}/squads/${squad.code}`, { headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`squad details after leave failed: ${await res.text()}`);
      const withoutRoger = await res.json();
      assert.ok(
        withoutRoger.collectiveCompletionRate < withRoger.collectiveCompletionRate,
        "squad coverage should drop after roger leaves"
      );

      // But Roger's personal collection remains intact.
      res = await fetch(`${API}/collection/${roger.id}`, { headers: auth(roger.token) });
      if (!res.ok) assert.fail(`roger collection failed: ${await res.text()}`);
      const coll = await res.json();
      assert.ok(
        coll[variantId] && coll[variantId].status === "owned",
        "roger's personal entry should remain after leaving"
      );
    });

    await test("leaving squad keeps friendship and removing friend does not kick from squad", async () => {
      // Use friends visibility so compare relies on friendship, not squad membership.
      await setVisibility(quinn, { collectionVisibility: "friends" });
      await setVisibility(paul, { collectionVisibility: "friends" });
      await setVisibility(roger, { collectionVisibility: "friends" });

      // Scenario A: Paul leaves a squad but stays friend with Quinn.
      let res = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(quinn.token),
        body: JSON.stringify({ name: "Charlie One" })
      });
      if (!res.ok) assert.fail(`create squad failed: ${await res.text()}`);
      const squadA = await res.json();

      res = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(paul.token),
        body: JSON.stringify({ code: squadA.code })
      });
      if (!res.ok) assert.fail(`paul join failed: ${await res.text()}`);

      res = await fetch(`${API}/squads/${squadA.code}/leave`, { method: "POST", headers: auth(paul.token) });
      if (!res.ok) assert.fail(`paul leave failed: ${await res.text()}`);

      // Quinn still sees Paul as a friend.
      res = await fetch(`${API}/friends`, { headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`friend list failed: ${await res.text()}`);
      const friends = await res.json();
      assert.ok(
        friends.friends.some((f) => f.id === paul.id),
        "friendship should remain after leaving squad"
      );

      // Compare between the two friends still works.
      res = await fetch(`${API}/comparisons/users/${quinn.id}/${paul.id}`, { headers: auth(quinn.token) });
      assert.strictEqual(res.status, 200, `compare should still be available: ${await res.text()}`);

      // Scenario B: Quinn removes Roger as a friend while Roger is still in a squad.
      res = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(quinn.token),
        body: JSON.stringify({ name: "Delta Two" })
      });
      if (!res.ok) assert.fail(`create second squad failed: ${await res.text()}`);
      const squadB = await res.json();

      res = await fetch(`${API}/squads/${squadB.code}/invite/${roger.id}`, {
        method: "POST",
        headers: auth(quinn.token)
      });
      if (!res.ok) assert.fail(`roger invite failed: ${await res.text()}`);
      let { invitationId } = await res.json();

      res = await fetch(`${API}/squads/invitations/${invitationId}/accept`, {
        method: "POST",
        headers: auth(roger.token)
      });
      if (!res.ok) assert.fail(`roger accept invite failed: ${await res.text()}`);

      res = await fetch(`${API}/friends/${roger.id}/remove`, { method: "POST", headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`remove friend failed: ${await res.text()}`);

      // Roger must still be listed as an active member of the squad.
      res = await fetch(`${API}/squads/${squadB.code}`, { headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`squad details failed: ${await res.text()}`);
      const data = await res.json();
      assert.ok(
        data.members.some((m) => String(m.userId) === String(roger.id)),
        "removing friendship should not remove roger from squad"
      );
    });
  } finally {
    await cleanup(paul);
    await cleanup(quinn);
    await cleanup(roger);
  }
};
