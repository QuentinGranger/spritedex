"use strict";

module.exports = async function runSquadDeletion(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("deleted account squad activity no longer leaks identity", async () => {
    const carol = await register(`FrDeleteCarol${rnd()}`);
    const dave = await register(`FrDeleteDave${rnd()}`);
    try {
      const squadRes = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(carol.token),
        body: JSON.stringify({ name: "Activity Squad" })
      });
      const squad = await okJson(squadRes, "create squad");

      let res = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(dave.token),
        body: JSON.stringify({ code: squad.code })
      });
      await okJson(res, "join squad");

      // The activity is collection-derived, so make it intentionally visible
      // to the squad before asserting its pre-deletion representation.
      res = await fetch(`${API}/profile/${dave.id}`, {
        method: "PATCH",
        headers: auth(dave.token),
        body: JSON.stringify({ collectionVisibility: "squad" })
      });
      await okJson(res, "set squad collection visibility");

      // Dave makes a collection change that emits squad activity.
      const catRes = await fetch(`${API}/sprites`);
      assert.strictEqual(catRes.status, 200);
      const cat = await catRes.json();
      const variantId =
        (cat.sprites[0] && cat.sprites[0].variantIds && cat.sprites[0].variantIds[0]) ||
        (cat.sprites[0] && cat.sprites[0].id) ||
        "sprite_burnt_peanut";
      res = await fetch(`${API}/collection/${dave.id}/${variantId}`, {
        method: "PUT",
        headers: auth(dave.token),
        body: JSON.stringify({ status: "owned" })
      });
      await okJson(res, "collection update");

      // Verify Dave's username appears before deletion.
      res = await fetch(`${API}/squads/${squad.code}/history`, { headers: auth(carol.token) });
      let history = await okJson(res, "squad history");
      assert.ok(
        history.entries.some((e) => e.username === dave.username),
        "dave activity missing before deletion"
      );

      // Dave deletes account.
      res = await fetch(`${API}/profile/${dave.id}`, { method: "DELETE", headers: auth(dave.token) });
      await okJson(res, "delete dave");

      // Deleted collection activity is fail-closed: old rows are detached
      // from the user and must not reveal either the prior identity or a
      // concrete private ownership event to the remaining members.
      res = await fetch(`${API}/squads/${squad.code}/history`, { headers: auth(carol.token) });
      history = await okJson(res, "squad history after delete");
      assert.ok(
        !history.entries.some((e) => e.username === dave.username),
        "deleted member identity leaked through squad activity"
      );
    } finally {
      await cleanup(carol);
      await cleanup(dave);
    }
  });
};
