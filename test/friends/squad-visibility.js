"use strict";

module.exports = async function runSquadVisibility(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("squad details respect collectionVisibility for non-friend members", async () => {
    const alice = await register(`FrVisAlice${rnd()}`);
    const bob = await register(`FrVisBob${rnd()}`);
    const carol = await register(`FrVisCarol${rnd()}`);
    try {
      // Alice creates an open squad.
      let res = await fetch(`${API}/squads`, { method: "POST", headers: auth(alice.token), body: JSON.stringify({ name: "Visibility Squad" }) });
      const { code } = await okJson(res, "create squad");

      // Bob and Carol join the squad (open join).
      res = await fetch(`${API}/squads/join`, { method: "POST", headers: auth(bob.token), body: JSON.stringify({ code }) });
      await okJson(res, "bob join");
      res = await fetch(`${API}/squads/join`, { method: "POST", headers: auth(carol.token), body: JSON.stringify({ code }) });
      await okJson(res, "carol join");

      // Alice adds a collection entry.
      const catRes = await fetch(`${API}/sprites`);
      assert.strictEqual(catRes.status, 200);
      const cat = await catRes.json();
      const variantId = (cat.sprites[0] && cat.sprites[0].variantIds && cat.sprites[0].variantIds[0]) || (cat.sprites[0] && cat.sprites[0].id) || "sprite_burnt_peanut";
      res = await fetch(`${API}/collection/${alice.id}/${variantId}`, { method: "PUT", headers: auth(alice.token), body: JSON.stringify({ status: "owned" }) });
      await okJson(res, "alice collection update");

      // Alice sets collection visibility to friends-only.
      res = await fetch(`${API}/profile/${alice.id}`, { method: "PATCH", headers: auth(alice.token), body: JSON.stringify({ collectionVisibility: "friends" }) });
      assert.strictEqual(res.status, 200, `set collectionVisibility failed: ${await res.text()}`);

      // Bob (non-friend squad member) sees Alice's collection as empty.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(bob.token) });
      const squadData = await okJson(res, "squad details from bob");
      const aliceFromBob = squadData.members.find(m => m.userId === alice.id);
      assert.ok(aliceFromBob, "alice missing from bob's view");
      assert.strictEqual(Object.keys(aliceFromBob.collection || {}).length, 0, "bob should not see alice's collection");
      assert.strictEqual(aliceFromBob.entryCount, 0, "bob should see entryCount 0");
      assert.strictEqual(aliceFromBob.lastUpdated, null, "bob should not see lastUpdated");

      // Alice and Bob become friends.
      res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(alice.token), body: JSON.stringify({ addresseeId: bob.id }) });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(bob.token) });
      await okJson(res, "accept request");

      // Bob (now friend) can see Alice's collection entry.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(bob.token) });
      const squadAfter = await okJson(res, "squad details after friend");
      const aliceAfter = squadAfter.members.find(m => m.userId === alice.id);
      assert.ok(aliceAfter, "alice missing after friend");
      assert.ok(Object.keys(aliceAfter.collection || {}).length > 0, "bob should now see alice's collection");
      assert.strictEqual(aliceAfter.entryCount, 1, "bob should see entryCount 1");
      assert.ok(aliceAfter.lastUpdated, "bob should see lastUpdated");
    } finally {
      await cleanup(alice);
      await cleanup(bob);
      await cleanup(carol);
    }
  });
};
