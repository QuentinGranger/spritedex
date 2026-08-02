"use strict";

module.exports = async function runInvitationSettings(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  const dave = await register(`FrDave${rnd()}`);
  const eve = await register(`FrEve${rnd()}`);
  try {
    await test("nobody setting blocks friend requests", async () => {
      let res = await fetch(`${API}/profile/${eve.id}`, {
        method: "PATCH",
        headers: auth(eve.token),
        body: JSON.stringify({ friendInvitesFrom: "nobody" })
      });
      if (res.status !== 200) assert.fail(`profile patch failed: ${await res.text()}`);

      res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(dave.token),
        body: JSON.stringify({ addresseeId: eve.id })
      });
      assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
    });

    await test("mutual_squad_members setting only allows shared squad members", async () => {
      // eve joins a squad created by dave
      let res = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(dave.token),
        body: JSON.stringify({ name: "FrSquad" })
      });
      assert.strictEqual(res.status, 200);
      const squad = await res.json();

      res = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(eve.token),
        body: JSON.stringify({ code: squad.code })
      });
      if (res.status !== 200) assert.fail(`squad join failed: ${await res.text()}`);

      res = await fetch(`${API}/profile/${eve.id}`, {
        method: "PATCH",
        headers: auth(eve.token),
        body: JSON.stringify({ friendInvitesFrom: "mutual_squad_members" })
      });
      if (res.status !== 200) assert.fail(`profile patch failed: ${await res.text()}`);

      // dave (same squad) can invite eve
      res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(dave.token),
        body: JSON.stringify({ addresseeId: eve.id })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "pending");
    });
  } finally {
    await cleanup(dave);
    await cleanup(eve);
  }
};
