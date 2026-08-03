"use strict";

module.exports = async function runAccountDeletion(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("deleted account is removed from friend lists and pending invitations cancelled", async () => {
    const alice = await register(`FrDeleteAlice${rnd()}`);
    const bob = await register(`FrDeleteBob${rnd()}`);
    try {
      let res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(alice.token),
        body: JSON.stringify({ addresseeId: bob.id })
      });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(bob.token) });
      await okJson(res, "accept request");

      // Bob sends a pending request to Alice (will be cancelled when Alice deletes).
      const claire = await register(`FrDeleteClaire${rnd()}`);
      try {
        res = await fetch(`${API}/friends/requests`, {
          method: "POST",
          headers: auth(claire.token),
          body: JSON.stringify({ addresseeId: alice.id })
        });
        await okJson(res, "pending request to alice");
      } catch (e) {
        await cleanup(claire);
        throw e;
      }

      // Alice creates a compare share link and a friend invite link.
      res = await fetch(`${API}/compare/share`, {
        method: "POST",
        headers: auth(alice.token),
        body: JSON.stringify({ duration: "1h" })
      });
      const { token: compareToken } = await okJson(res, "compare share link");
      res = await fetch(`${API}/friends/invite-links`, {
        method: "POST",
        headers: auth(alice.token),
        body: JSON.stringify({ duration: "24h" })
      });
      const { token: inviteToken } = await okJson(res, "friend invite link");

      // Alice deletes her account.
      res = await fetch(`${API}/profile/${alice.id}`, { method: "DELETE", headers: auth(alice.token) });
      await okJson(res, "delete account");

      // Bob no longer sees Alice in his friend list.
      res = await fetch(`${API}/friends`, { headers: auth(bob.token) });
      const friends = await okJson(res, "friend list");
      assert.ok(!friends.friends.some((f) => f.id === alice.id), "deleted user still in friend list");

      // Alice's pending request to her is cancelled.
      res = await fetch(`${API}/friends/requests/received`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 401, "deleted user session should be invalid");
      res = await fetch(`${API}/friends/pending`, { headers: auth(claire.token) });
      const pending = await okJson(res, "pending list");
      assert.ok(!pending.pending.some((p) => p.id === alice.id), "deleted addressee still in pending list");

      // Alice cannot be compared, searched or viewed.
      res = await fetch(`${API}/compare/${alice.id}`, { headers: auth(bob.token) });
      assert.strictEqual(res.status, 404, `compare should fail: ${res.status}`);
      res = await fetch(`${API}/profile/${alice.id}`, { headers: auth(bob.token) });
      assert.strictEqual(res.status, 404, `profile should fail: ${res.status}`);
      res = await fetch(`${API}/users/search?q=${encodeURIComponent(alice.username)}`, { headers: auth(bob.token) });
      const search = await okJson(res, "search");
      assert.ok(!search.users.some((u) => u.id === alice.id), "deleted user found in search");

      // Links are revoked / deleted.
      res = await fetch(`${API}/compare/share/${compareToken}`);
      assert.strictEqual(res.status, 404, `share link should be revoked: ${res.status}`);
      res = await fetch(`${API}/friends/invite-links/${inviteToken}`);
      assert.strictEqual(res.status, 404, `invite link should be deleted: ${res.status}`);

      await cleanup(claire);
    } finally {
      await cleanup(alice);
      await cleanup(bob);
    }
  });
};
