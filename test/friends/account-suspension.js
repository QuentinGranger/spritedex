"use strict";

module.exports = async function runAccountSuspension(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("suspended account hides profile and blocks new invitations while keeping friendships", async () => {
    const nina = await register(`FrSuspendNina${rnd()}`);
    const paul = await register(`FrSuspendPaul${rnd()}`);
    const quinn = await register(`FrSuspendQuinn${rnd()}`);
    try {
      // Nina and Paul are friends.
      let res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(nina.token), body: JSON.stringify({ addresseeId: paul.id }) });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(paul.token) });
      await okJson(res, "accept request");

      // Paul can see Nina's profile and they are in his friend list.
      res = await fetch(`${API}/profile/${nina.id}`, { headers: auth(paul.token) });
      await okJson(res, "profile before suspend");
      res = await fetch(`${API}/friends`, { headers: auth(paul.token) });
      let friends = await okJson(res, "friend list before suspend");
      assert.ok(friends.friends.some(f => f.id === nina.id), "nina missing before suspend");

      // Nina suspends her account.
      res = await fetch(`${API}/profile/${nina.id}/suspend`, { method: "POST", headers: auth(nina.token), body: JSON.stringify({ durationMinutes: 10 }) });
      await okJson(res, "suspend");

      // Paul can no longer see Nina's profile or friend list entry.
      res = await fetch(`${API}/profile/${nina.id}`, { headers: auth(paul.token) });
      assert.strictEqual(res.status, 404, `profile should be hidden: ${res.status}`);
      res = await fetch(`${API}/friends`, { headers: auth(paul.token) });
      friends = await okJson(res, "friend list during suspend");
      assert.ok(!friends.friends.some(f => f.id === nina.id), "nina should be hidden during suspend");

      // Search hides Nina.
      res = await fetch(`${API}/users/search?q=${encodeURIComponent(nina.username)}`, { headers: auth(paul.token) });
      const search = await okJson(res, "search during suspend");
      assert.ok(!search.users.some(u => u.id === nina.id), "suspended user found in search");

      // Quinn cannot send a friend request to Nina while she is suspended.
      res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(quinn.token), body: JSON.stringify({ addresseeId: nina.id }) });
      assert.strictEqual(res.status, 403, `friend request should be blocked: ${res.status}`);

      // Nina unsuspends; friendship is restored.
      res = await fetch(`${API}/profile/${nina.id}/unsuspend`, { method: "POST", headers: auth(nina.token) });
      await okJson(res, "unsuspend");

      res = await fetch(`${API}/profile/${nina.id}`, { headers: auth(paul.token) });
      await okJson(res, "profile after unsuspend");
      res = await fetch(`${API}/friends`, { headers: auth(paul.token) });
      friends = await okJson(res, "friend list after unsuspend");
      assert.ok(friends.friends.some(f => f.id === nina.id), "nina should reappear after unsuspend");

      // Quinn can now send a friend request.
      res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(quinn.token), body: JSON.stringify({ addresseeId: nina.id }) });
      await okJson(res, "friend request after unsuspend");
    } finally {
      await cleanup(nina);
      await cleanup(paul);
      await cleanup(quinn);
    }
  });
};
