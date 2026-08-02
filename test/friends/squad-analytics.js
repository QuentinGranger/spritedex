"use strict";

module.exports = async function runSquadAnalytics(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  const steve = await register(`FrSteve${rnd()}`);
  const tina = await register(`FrTina${rnd()}`);
  try {
    await test("squad analytics respect priority visibility and blocks", async () => {
      let res = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(steve.token),
        body: JSON.stringify({ name: "Echo Squad" })
      });
      if (!res.ok) assert.fail(`create squad failed: ${await res.text()}`);
      const squad = await res.json();

      res = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(tina.token),
        body: JSON.stringify({ code: squad.code })
      });
      if (!res.ok) assert.fail(`tina join failed: ${await res.text()}`);

      // Make collections public so Steve can discover an active variant before blocking.
      await setVisibility(tina, { collectionVisibility: "public" });
      await setVisibility(steve, { collectionVisibility: "public" });

      // Get an active variant id before blocking.
      const cmpRes = await fetch(`${API}/comparisons/users/${steve.id}/${tina.id}`, { headers: auth(steve.token) });
      if (cmpRes.status !== 200) assert.fail(`compare failed: ${await cmpRes.text()}`);
      const cmpData = await cmpRes.json();
      const records = cmpData.records || [];
      assert.ok(records.length > 0, "no active variants");
      const variantId = records[0].variantId;

      // A granular private priority must not be visible in either the member
      // collection payload or the acquisition engine viewed by Tina.
      await setVisibility(steve, { priorityVisibility: "private" });
      await setEntry(steve.token, steve.id, variantId, "missing", "urgent");
      await setEntry(tina.token, tina.id, variantId, "owned");

      let detailsRes = await fetch(`${API}/squads/${squad.code}`, { headers: auth(tina.token) });
      if (!detailsRes.ok) assert.fail(`squad details failed: ${await detailsRes.text()}`);
      let details = await detailsRes.json();
      const steveBeforeBlock = details.members.find(m => String(m.userId) === String(steve.id));
      assert.strictEqual(steveBeforeBlock?.collection?.[variantId]?.priority, "none", "private priority leaked in squad details");

      const acquisitionRes = await fetch(`${API}/squads/${squad.code}/completion/recommendations`, { headers: auth(tina.token) });
      if (!acquisitionRes.ok) assert.fail(`squad recommendation engine failed: ${await acquisitionRes.text()}`);
      const acquisition = await acquisitionRes.json();
      const priorityRow = (acquisition.priorities || []).find(row => row.variantId === variantId);
      assert.ok(priorityRow, "priority fixture missing from acquisition engine");
      assert.strictEqual(priorityRow.priorityCount, 0, "private priority leaked into squad acquisition score");

      // Steve owns a variant Tina does not.
      await setEntry(steve.token, steve.id, variantId, "owned");
      await setEntry(tina.token, tina.id, variantId, "missing");

      // Tina blocks Steve.
      res = await fetch(`${API}/users/${steve.id}/block`, { method: "POST", headers: auth(tina.token) });
      if (!res.ok) assert.fail(`block failed: ${await res.text()}`);

      // Profile hidden for Tina.
      const profileRes = await fetch(`${API}/profile/${steve.id}`, { headers: auth(tina.token) });
      assert.strictEqual(profileRes.status, 404, "blocked profile should be hidden");

      // Comparison between them is now impossible.
      const blockCompareRes = await fetch(`${API}/comparisons/users/${tina.id}/${steve.id}`, { headers: auth(tina.token) });
      assert.strictEqual(blockCompareRes.status, 403, "comparison should be blocked");

      // A blocked member's collection must not influence aggregate metrics.
      res = await fetch(`${API}/squads/${squad.code}`, { headers: auth(tina.token) });
      if (!res.ok) assert.fail(`squad details failed: ${await res.text()}`);
      const data = await res.json();
      assert.strictEqual(data.coveredVariantCount, 0, "blocked member's collection must not contribute to squad coverage");
      assert.ok(!data.members.some(m => String(m.userId) === String(steve.id)), "blocked member should not appear in member list");

      const uniqueRes = await fetch(`${API}/squads/${squad.code}/unique-owners`, { headers: auth(tina.token) });
      if (!uniqueRes.ok) assert.fail(`unique owner analysis failed: ${await uniqueRes.text()}`);
      const unique = await uniqueRes.json();
      assert.ok(
        !(unique.uniqueVariants || []).some(row => String(row.uniqueOwnerId) === String(steve.id)),
        "blocked member leaked through unique-owner analytics"
      );
    });
  } finally {
    await cleanup(steve);
    await cleanup(tina);
  }
};
