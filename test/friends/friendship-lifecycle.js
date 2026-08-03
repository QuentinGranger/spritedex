"use strict";

module.exports = async function runFriendshipLifecycle(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  const alice = await register(`FrAlice${rnd()}`);
  const bob = await register(`FrBob${rnd()}`);
  try {
    await test("user search finds bob by username with public fields", async () => {
      const res = await fetch(`${API}/users/search?username=${encodeURIComponent(bob.username)}`, {
        headers: auth(alice.token)
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const found = data.users.find((u) => u.id === bob.id);
      assert.ok(found, "bob not found");
      assert.strictEqual(found.username, bob.username);
      assert.strictEqual(found.displayName, bob.displayName);
      assert.ok("avatarUrl" in found);
      assert.strictEqual(found.friendshipStatus, "none");
      assert.strictEqual(found.canReceiveFriendRequest, true);
      assert.ok(!("email" in found), "email leaked");
    });

    await test("search rejects queries under 3 characters", async () => {
      const res = await fetch(`${API}/users/search?username=ab`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 400, `expected 400, got ${res.status}`);
    });

    await test("alice can send friend request to bob", async () => {
      const res = await fetch(`${API}/friends/${bob.id}/request`, { method: "POST", headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.ok, true);
    });

    await test("bob sees pending invitation from alice with public fields", async () => {
      const res = await fetch(`${API}/friends/pending`, { headers: auth(bob.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const found = data.pending.find((p) => p.id === alice.id);
      assert.ok(found, "pending not found");
      assert.strictEqual(found.username, alice.username);
      assert.strictEqual(found.displayName, alice.displayName);
      assert.ok("avatarUrl" in found, "avatarUrl missing");
      assert.ok("sentAt" in found, "sentAt missing");
    });

    await test("bob's pending request includes common squad", async () => {
      const squadRes = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(bob.token),
        body: JSON.stringify({ name: "Bravo Six" })
      });
      assert.strictEqual(squadRes.status, 200);
      const squad = await squadRes.json();

      const join = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(alice.token),
        body: JSON.stringify({ code: squad.code })
      });
      if (!join.ok) assert.fail(`squad join failed: ${await join.text()}`);

      const pending = await (await fetch(`${API}/friends/pending`, { headers: auth(bob.token) })).json();
      const found = pending.pending.find((p) => p.id === alice.id);
      assert.ok(found, "pending not found");
      assert.ok(found.commonSquad, "common squad missing");
      assert.strictEqual(found.commonSquad.code, squad.code);
      assert.strictEqual(found.commonSquad.name, "Bravo Six");
    });

    await test("alice sees sent invitation with public fields and status", async () => {
      const res = await fetch(`${API}/friends/sent`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const sent = data.sent.find((s) => s.id === bob.id);
      assert.ok(sent, "sent invitation not found");
      assert.strictEqual(sent.username, bob.username);
      assert.strictEqual(sent.displayName, bob.displayName);
      assert.strictEqual(sent.status, "pending");
      assert.ok("avatarUrl" in sent, "avatarUrl missing");
      assert.ok("sentAt" in sent, "sentAt missing");
    });

    await test("REST request list endpoints expose requestId and user", async () => {
      const receivedRes = await fetch(`${API}/friends/requests/received`, { headers: auth(bob.token) });
      assert.strictEqual(receivedRes.status, 200);
      const received = await receivedRes.json();
      const req = received.requests.find((r) => r.user && r.user.id === alice.id);
      assert.ok(req, "alice's request not in bob's received list");
      assert.ok(req.requestId, "received requestId missing");

      const sentRes = await fetch(`${API}/friends/requests/sent`, { headers: auth(alice.token) });
      assert.strictEqual(sentRes.status, 200);
      const sent = await sentRes.json();
      const s = sent.requests.find((r) => r.user && r.user.id === bob.id);
      assert.ok(s, "bob not in alice's sent list");
      assert.ok(s.requestId, "sent requestId missing");
    });

    await test("alice can cancel a sent invitation", async () => {
      const carol = await register(`FrCancelCarol${rnd()}`);
      try {
        let res = await fetch(`${API}/friends/${carol.id}/request`, { method: "POST", headers: auth(alice.token) });
        assert.strictEqual(res.status, 200);
        res = await fetch(`${API}/friends/${carol.id}/cancel`, { method: "POST", headers: auth(alice.token) });
        assert.strictEqual(res.status, 200);
        res = await fetch(`${API}/friends/sent`, { headers: auth(alice.token) });
        const data = await res.json();
        assert.ok(!data.sent.some((s) => s.id === carol.id), "cancelled invitation still in sent list");
      } finally {
        await cleanup(carol);
      }
    });

    await test("bob accepts friend request", async () => {
      const res = await fetch(`${API}/friends/${alice.id}/accept`, { method: "POST", headers: auth(bob.token) });
      assert.strictEqual(res.status, 200);
    });

    await test("alice can quick compare with bob via /api/compare/:friendId", async () => {
      const res = await fetch(`${API}/compare/${bob.id}`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
      const data = await res.json();
      assert.ok(data.summary, "missing summary");
      assert.ok(data.records, "missing records");
    });

    await test("non-friend cannot use quick compare", async () => {
      const charlie = await register(`FrCharlieQuick${rnd()}`);
      try {
        const res = await fetch(`${API}/compare/${bob.id}`, { headers: auth(charlie.token) });
        assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
      } finally {
        await cleanup(charlie);
      }
    });

    await test("both users see each other as friends with public fields", async () => {
      const a = await (await fetch(`${API}/friends`, { headers: auth(alice.token) })).json();
      const b = await (await fetch(`${API}/friends`, { headers: auth(bob.token) })).json();
      const aliceSeesBob = a.friends.find((f) => f.id === bob.id);
      const bobSeesAlice = b.friends.find((f) => f.id === alice.id);
      assert.ok(aliceSeesBob, "alice doesn't see bob");
      assert.ok(bobSeesAlice, "bob doesn't see alice");
      assert.strictEqual(aliceSeesBob.username, bob.username);
      assert.strictEqual(aliceSeesBob.displayName, bob.displayName);
      assert.ok("avatarUrl" in aliceSeesBob, "avatarUrl missing");
      assert.ok("lastActive" in aliceSeesBob, "lastActive missing");
      assert.ok("actions" in aliceSeesBob, "actions missing");
      assert.strictEqual(aliceSeesBob.actions.compare, true);
      assert.strictEqual(aliceSeesBob.actions.inviteToSquad, true);
    });

    await test("private activity is not exposed through profiles or the friend list", async () => {
      const profileRes = await fetch(`${API}/profile/${bob.id}`, { headers: auth(alice.token) });
      assert.strictEqual(profileRes.status, 200);
      const profile = await profileRes.json();
      assert.strictEqual(profile.lastActiveAt, null, "private activity leaked from profile");

      const listRes = await fetch(`${API}/friends`, { headers: auth(alice.token) });
      assert.strictEqual(listRes.status, 200);
      const list = await listRes.json();
      const found = list.friends.find((f) => f.id === bob.id);
      assert.ok(found, "bob not in friend list");
      assert.strictEqual(found.lastActive, null, "private activity leaked from friend list");
    });

    await test("friend list respects privacy settings", async () => {
      // bob sets privacy to private so alice should not see completion/last update
      let res = await fetch(`${API}/profile/${bob.id}`, {
        method: "PATCH",
        headers: auth(bob.token),
        body: JSON.stringify({ privacy: "private" })
      });
      if (res.status !== 200) assert.fail(`profile patch failed: ${await res.text()}`);

      const list = await (await fetch(`${API}/friends`, { headers: auth(alice.token) })).json();
      const found = list.friends.find((f) => f.id === bob.id);
      assert.ok(found, "bob not in friend list");
      assert.strictEqual(found.completionRate, null, "completionRate should be hidden");
      assert.strictEqual(found.lastCollectionUpdate, null, "lastCollectionUpdate should be hidden");
      assert.strictEqual(found.actions.compare, false, "compare should be disabled");

      // restore public for rest of tests
      res = await fetch(`${API}/profile/${bob.id}`, {
        method: "PATCH",
        headers: auth(bob.token),
        body: JSON.stringify({ privacy: "public" })
      });
      if (res.status !== 200) assert.fail(`restore privacy failed: ${await res.text()}`);
    });

    await test("friend list can include comparison preview", async () => {
      const res = await fetch(`${API}/friends?preview=true`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const found = data.friends.find((f) => f.id === bob.id);
      assert.ok(found, "bob not found");
      assert.ok(found.preview, "preview missing");
      assert.ok("missingFromFriend" in found.preview);
      assert.ok("missingFromMe" in found.preview);
      assert.ok("collectiveCompletionRate" in found.preview);
      assert.ok("totalVariants" in found.preview);
    });

    await test("friend list does not include preview by default", async () => {
      const res = await fetch(`${API}/friends`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const found = data.friends.find((f) => f.id === bob.id);
      assert.ok(found, "bob not found");
      assert.ok(!("preview" in found), "preview should not be included by default");
    });

    await test("bob can set privacy to friends_only and alice can compare", async () => {
      let res = await fetch(`${API}/profile/${bob.id}`, {
        method: "PATCH",
        headers: auth(bob.token),
        body: JSON.stringify({ privacy: "friends_only" })
      });
      if (res.status !== 200) assert.fail(`patch failed: ${await res.text()}`);

      res = await fetch(`${API}/comparisons/users/${alice.id}/${bob.id}`, { headers: auth(alice.token) });
      if (res.status !== 200) assert.fail(`compare failed: ${await res.text()}`);
      const data = await res.json();
      assert.ok(data.summary, "missing summary");
    });

    await test("non-friend cannot compare when privacy is friends_only", async () => {
      const charlie = await register(`FrCharlie${rnd()}`);
      try {
        const res = await fetch(`${API}/comparisons/users/${charlie.id}/${bob.id}`, { headers: auth(charlie.token) });
        assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
      } finally {
        await cleanup(charlie);
      }
    });

    await test("alice can remove bob from friends via DELETE", async () => {
      const res = await fetch(`${API}/friends/${bob.id}`, { method: "DELETE", headers: auth(alice.token) });
      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);

      const friends = await (await fetch(`${API}/friends`, { headers: auth(alice.token) })).json();
      assert.ok(!friends.friends.some((f) => f.id === bob.id), "alice still sees bob");

      const compareRes = await fetch(`${API}/compare/${bob.id}`, { headers: auth(alice.token) });
      assert.strictEqual(compareRes.status, 403, `expected 403 after removal, got ${compareRes.status}`);
    });

    await test("block prevents new friend request", async () => {
      let res = await fetch(`${API}/friends/${bob.id}/block`, { method: "POST", headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
      res = await fetch(`${API}/friends/${alice.id}/request`, { method: "POST", headers: auth(bob.token) });
      assert.strictEqual(res.status, 403, `expected 403, got ${res.status}`);
    });

    await test("alice can unblock bob", async () => {
      const res = await fetch(`${API}/friends/${bob.id}/unblock`, { method: "POST", headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
    });

    await test("user can block another user and hide profile/collection/comparison", async () => {
      const dave = await register(`FrDave${rnd()}`);
      const eve = await register(`FrEve${rnd()}`);
      try {
        // Become friends first
        let res = await fetch(`${API}/friends/${eve.id}/request`, { method: "POST", headers: auth(dave.token) });
        assert.strictEqual(res.status, 200);
        res = await fetch(`${API}/friends/${dave.id}/accept`, { method: "POST", headers: auth(eve.token) });
        assert.strictEqual(res.status, 200);

        // Compare works before block
        res = await fetch(`${API}/compare/${eve.id}`, { headers: auth(dave.token) });
        assert.strictEqual(res.status, 200, `expected 200 before block, got ${res.status}`);

        // Block from profile context via the generic users endpoint
        res = await fetch(`${API}/users/${eve.id}/block`, { method: "POST", headers: auth(dave.token) });
        assert.strictEqual(res.status, 200, `expected 200 block, got ${res.status}`);

        // Profile hidden
        res = await fetch(`${API}/profile/${eve.id}`, { headers: auth(dave.token) });
        assert.strictEqual(res.status, 404, `expected 404 profile, got ${res.status}`);

        // Collection hidden
        res = await fetch(`${API}/collection/${eve.id}`, { headers: auth(dave.token) });
        assert.strictEqual(res.status, 403, `expected 403 collection, got ${res.status}`);

        // Compare blocked
        res = await fetch(`${API}/compare/${eve.id}`, { headers: auth(dave.token) });
        assert.strictEqual(res.status, 403, `expected 403 compare, got ${res.status}`);

        // New friend request blocked
        res = await fetch(`${API}/friends/${dave.id}/request`, { method: "POST", headers: auth(eve.token) });
        assert.strictEqual(res.status, 403, `expected 403 request, got ${res.status}`);
      } finally {
        await cleanup(dave);
        await cleanup(eve);
      }
    });

    await test("user can list, unblock and must re-invite a blocked user", async () => {
      const fred = await register(`FrFred${rnd()}`);
      const gina = await register(`FrGina${rnd()}`);
      try {
        // Become friends
        let res = await fetch(`${API}/friends/${gina.id}/request`, { method: "POST", headers: auth(fred.token) });
        assert.strictEqual(res.status, 200);
        res = await fetch(`${API}/friends/${fred.id}/accept`, { method: "POST", headers: auth(gina.token) });
        assert.strictEqual(res.status, 200);

        // Block
        res = await fetch(`${API}/users/${gina.id}/block`, { method: "POST", headers: auth(fred.token) });
        assert.strictEqual(res.status, 200);

        // Blocked list contains gina
        const listRes = await fetch(`${API}/users/blocked`, { headers: auth(fred.token) });
        assert.strictEqual(listRes.status, 200);
        const list = await listRes.json();
        assert.ok(
          list.blocked.some((u) => u.id === gina.id),
          "gina missing from blocked list"
        );

        // Unblock via DELETE /api/users/:userId/block
        res = await fetch(`${API}/users/${gina.id}/block`, { method: "DELETE", headers: auth(fred.token) });
        assert.strictEqual(res.status, 200, `expected 200 unblock, got ${res.status}`);

        // Blocked list empty
        const listAfter = await (await fetch(`${API}/users/blocked`, { headers: auth(fred.token) })).json();
        assert.ok(!listAfter.blocked.some((u) => u.id === gina.id), "gina still in blocked list");

        // Friendship not restored
        const friends = await (await fetch(`${API}/friends`, { headers: auth(fred.token) })).json();
        assert.ok(!friends.friends.some((f) => f.id === gina.id), "gina still in friends list");

        // New invitation can be sent
        res = await fetch(`${API}/friends/${gina.id}/request`, { method: "POST", headers: auth(fred.token) });
        assert.strictEqual(res.status, 200, `expected 200 re-request, got ${res.status}`);
      } finally {
        await cleanup(fred);
        await cleanup(gina);
      }
    });

    let lastRequestId;

    await test("bob can send friend request to alice using addresseeId", async () => {
      const res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(bob.token),
        body: JSON.stringify({ addresseeId: alice.id })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.requestId, "missing requestId");
      assert.strictEqual(data.status, "pending");
      assert.ok(data.createdAt, "missing createdAt");
      lastRequestId = data.requestId;
    });

    await test("alice can accept request by requestId", async () => {
      const res = await fetch(`${API}/friends/requests/${lastRequestId}/accept`, {
        method: "POST",
        headers: auth(alice.token)
      });
      assert.strictEqual(res.status, 200);
      const friends = await (await fetch(`${API}/friends`, { headers: auth(bob.token) })).json();
      assert.ok(
        friends.friends.some((f) => f.id === alice.id),
        "bob doesn't see alice after accept"
      );
    });

    await test("bob cannot resend request to alice using addresseeId", async () => {
      const res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(bob.token),
        body: JSON.stringify({ addresseeId: alice.id })
      });
      assert.strictEqual(res.status, 409);
    });

    await test("bob can send friend request to a new user by username", async () => {
      const carol = await register(`FrCarol${rnd()}`);
      try {
        const res = await fetch(`${API}/friends/requests`, {
          method: "POST",
          headers: auth(bob.token),
          body: JSON.stringify({ addresseeId: carol.username })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.status, "pending");
      } finally {
        await cleanup(carol);
      }
    });
  } finally {
    await cleanup(alice);
    await cleanup(bob);
  }
};
