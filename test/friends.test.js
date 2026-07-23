// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Friends / invitations integration tests
// Run against a live server: node server.js, then node test/friends.test.js
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

async function run() {
  console.log(`\nRunning SPRITNEX friends tests against ${BASE}\n`);

  const alice = await register(`FrAlice${rnd()}`);
  const bob = await register(`FrBob${rnd()}`);

  try {
    await test("user search finds bob by username with public fields", async () => {
      const res = await fetch(`${API}/users/search?username=${encodeURIComponent(bob.username)}`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const found = data.users.find(u => u.id === bob.id);
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
      const found = data.pending.find(p => p.id === alice.id);
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
      const found = pending.pending.find(p => p.id === alice.id);
      assert.ok(found, "pending not found");
      assert.ok(found.commonSquad, "common squad missing");
      assert.strictEqual(found.commonSquad.code, squad.code);
      assert.strictEqual(found.commonSquad.name, "Bravo Six");
    });

    await test("alice sees sent invitation with public fields and status", async () => {
      const res = await fetch(`${API}/friends/sent`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      const sent = data.sent.find(s => s.id === bob.id);
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
      const req = received.requests.find(r => r.user && r.user.id === alice.id);
      assert.ok(req, "alice's request not in bob's received list");
      assert.ok(req.requestId, "received requestId missing");

      const sentRes = await fetch(`${API}/friends/requests/sent`, { headers: auth(alice.token) });
      assert.strictEqual(sentRes.status, 200);
      const sent = await sentRes.json();
      const s = sent.requests.find(r => r.user && r.user.id === bob.id);
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
        assert.ok(!data.sent.some(s => s.id === carol.id), "cancelled invitation still in sent list");
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
      const aliceSeesBob = a.friends.find(f => f.id === bob.id);
      const bobSeesAlice = b.friends.find(f => f.id === alice.id);
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

    await test("friend list respects privacy settings", async () => {
      // bob sets privacy to private so alice should not see completion/last update
      let res = await fetch(`${API}/profile/${bob.id}`, {
        method: "PATCH",
        headers: auth(bob.token),
        body: JSON.stringify({ privacy: "private" })
      });
      if (res.status !== 200) assert.fail(`profile patch failed: ${await res.text()}`);

      const list = await (await fetch(`${API}/friends`, { headers: auth(alice.token) })).json();
      const found = list.friends.find(f => f.id === bob.id);
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
      const found = data.friends.find(f => f.id === bob.id);
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
      const found = data.friends.find(f => f.id === bob.id);
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
      assert.ok(!friends.friends.some(f => f.id === bob.id), "alice still sees bob");

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
        assert.ok(list.blocked.some(u => u.id === gina.id), "gina missing from blocked list");

        // Unblock via DELETE /api/users/:userId/block
        res = await fetch(`${API}/users/${gina.id}/block`, { method: "DELETE", headers: auth(fred.token) });
        assert.strictEqual(res.status, 200, `expected 200 unblock, got ${res.status}`);

        // Blocked list empty
        const listAfter = await (await fetch(`${API}/users/blocked`, { headers: auth(fred.token) })).json();
        assert.ok(!listAfter.blocked.some(u => u.id === gina.id), "gina still in blocked list");

        // Friendship not restored
        const friends = await (await fetch(`${API}/friends`, { headers: auth(fred.token) })).json();
        assert.ok(!friends.friends.some(f => f.id === gina.id), "gina still in friends list");

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
      assert.ok(friends.friends.some(f => f.id === alice.id), "bob doesn't see alice after accept");
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

  // ── Invitation settings tests ──
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

  // ── Invite link tests ──
  const grace = await register(`FrGrace${rnd()}`);
  const henry = await register(`FrHenry${rnd()}`);
  try {
    let linkToken;
    let linkId;

    await test("create a permanent invite link", async () => {
      const res = await fetch(`${API}/friends/invite-links`, {
        method: "POST",
        headers: auth(grace.token),
        body: JSON.stringify({ duration: "permanent" })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.ok(data.token, "missing token");
      assert.ok(data.url, "missing url");
      linkToken = data.token;
      linkId = data.id;
    });

    await test("public invite link returns owner public profile and canUse", async () => {
      const res = await fetch(`${API}/friends/invite-links/${linkToken}`, { headers: auth(henry.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.owner.id, grace.id);
      assert.ok(!("email" in data.owner), "email leaked");
      assert.strictEqual(data.canUse, true);
      assert.strictEqual(data.friendshipStatus, "none");
    });

    await test("redeem invite link sends friend request", async () => {
      const res = await fetch(`${API}/friends/invite-links/${linkToken}/use`, {
        method: "POST",
        headers: auth(henry.token)
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.status, "pending");

      const pending = await (await fetch(`${API}/friends/pending`, { headers: auth(grace.token) })).json();
      assert.ok(pending.pending.some(p => p.id === henry.id), "grace does not see henry's request");
    });

    await test("owner cannot redeem their own link", async () => {
      const res = await fetch(`${API}/friends/invite-links/${linkToken}/use`, {
        method: "POST",
        headers: auth(grace.token)
      });
      assert.strictEqual(res.status, 400);
    });

    await test("single-use link is consumed after one redeem", async () => {
      const res = await fetch(`${API}/friends/invite-links`, {
        method: "POST",
        headers: auth(grace.token),
        body: JSON.stringify({ duration: "single_use" })
      });
      assert.strictEqual(res.status, 201);
      const data = await res.json();

      const iris = await register(`FrIris${rnd()}`);
      try {
        const ok = await fetch(`${API}/friends/invite-links/${data.token}/use`, {
          method: "POST",
          headers: auth(iris.token)
        });
        assert.strictEqual(ok.status, 201);

        const second = await fetch(`${API}/friends/invite-links/${data.token}/use`, {
          method: "POST",
          headers: auth(henry.token)
        });
        assert.strictEqual(second.status, 410);
      } finally {
        await cleanup(iris);
      }
    });

    await test("generate QR code for invite link", async () => {
      const res = await fetch(`${API}/friends/invite-links/${linkToken}/qr`, { headers: auth(grace.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(data.qr.startsWith("data:image/png;base64,"), "qr is not a base64 png");
      assert.ok(data.url.includes(linkToken), "qr url does not contain the token");
    });

    await test("regenerate invite link invalidates old token", async () => {
      const res = await fetch(`${API}/friends/invite-links/${linkId}/regenerate`, {
        method: "POST",
        headers: auth(grace.token)
      });
      assert.strictEqual(res.status, 201);
      const regenerated = await res.json();
      assert.ok(regenerated.token && regenerated.token !== linkToken, "token not regenerated");

      const old = await fetch(`${API}/friends/invite-links/${linkToken}`, { headers: auth(henry.token) });
      assert.strictEqual(old.status, 410);

      const fresh = await fetch(`${API}/friends/invite-links/${regenerated.token}`, { headers: auth(henry.token) });
      assert.strictEqual(fresh.status, 200);
      const freshData = await fresh.json();
      assert.strictEqual(freshData.owner.id, grace.id);
    });

    await test("revoke invite link makes it unusable", async () => {
      const create = await fetch(`${API}/friends/invite-links`, {
        method: "POST",
        headers: auth(grace.token),
        body: JSON.stringify({ duration: "permanent" })
      });
      const newLink = await create.json();

      const del = await fetch(`${API}/friends/invite-links/${newLink.id}`, {
        method: "DELETE",
        headers: auth(grace.token)
      });
      assert.strictEqual(del.status, 200);

      const get = await fetch(`${API}/friends/invite-links/${newLink.token}`, { headers: auth(henry.token) });
      assert.strictEqual(get.status, 410);
    });
  } finally {
    await cleanup(grace);
    await cleanup(henry);
  }

  // ── Decline + cooldown tests ──
  const mike = await register(`FrMike${rnd()}`);
  const nina = await register(`FrNina${rnd()}`);
  try {
    let requestId;

    await test("nina can decline a friend request by requestId", async () => {
      const send = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(mike.token),
        body: JSON.stringify({ addresseeId: nina.id })
      });
      assert.strictEqual(send.status, 200);
      requestId = (await send.json()).requestId;

      const decline = await fetch(`${API}/friends/requests/${requestId}/decline`, {
        method: "POST",
        headers: auth(nina.token)
      });
      assert.strictEqual(decline.status, 200);

      const pending = await (await fetch(`${API}/friends/pending`, { headers: auth(nina.token) })).json();
      assert.ok(!pending.pending.some(p => p.id === mike.id), "declined request still in pending");
    });

    await test("new request is blocked for 7 days after decline", async () => {
      const res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(mike.token),
        body: JSON.stringify({ addresseeId: nina.id })
      });
      assert.strictEqual(res.status, 429, `expected 429, got ${res.status}`);
    });

    await test("declined request status is visible", async () => {
      const res = await fetch(`${API}/friends/${mike.id}/status`, { headers: auth(nina.token) });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "declined");
    });

    await test("sender can cancel a request via DELETE /api/friends/requests/:id", async () => {
      const oscar = await register(`FrOscar${rnd()}`);
      try {
        const send = await fetch(`${API}/friends/requests`, {
          method: "POST",
          headers: auth(mike.token),
          body: JSON.stringify({ addresseeId: oscar.id })
        });
        assert.strictEqual(send.status, 200);
        const { requestId } = await send.json();

        const del = await fetch(`${API}/friends/requests/${requestId}`, { method: "DELETE", headers: auth(mike.token) });
        assert.strictEqual(del.status, 200);

        const sent = await (await fetch(`${API}/friends/requests/sent`, { headers: auth(mike.token) })).json();
        assert.ok(!sent.requests.some(r => r.user && r.user.id === oscar.id), "cancelled request still in sent list");

        const received = await (await fetch(`${API}/friends/requests/received`, { headers: auth(oscar.token) })).json();
        assert.ok(!received.requests.some(r => r.user && r.user.id === mike.id), "cancelled request still in received list");
      } finally {
        await cleanup(oscar);
      }
    });
  } finally {
    await cleanup(mike);
    await cleanup(nina);
  }

  // ── Visibility level tests ──
  async function setVisibility(user, settings) {
    const res = await fetch(`${API}/profile/${user.id}`, {
      method: "PATCH",
      headers: auth(user.token),
      body: JSON.stringify(settings)
    });
    assert.ok(res.ok, `set visibility failed: ${await res.text()}`);
  }

  async function setEntry(token, userId, variantId, status) {
    const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ status })
    });
    assert.ok(res.ok, `setEntry failed: ${await res.text()}`);
  }

  async function becomeFriends(a, b) {
    let res = await fetch(`${API}/friends/${b.id}/request`, { method: "POST", headers: auth(a.token) });
    if (!res.ok) assert.fail(`request failed: ${await res.text()}`);
    res = await fetch(`${API}/friends/${a.id}/accept`, { method: "POST", headers: auth(b.token) });
    if (!res.ok) assert.fail(`accept failed: ${await res.text()}`);
  }

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
      const searchRoger = await fetch(`${API}/users/search?q=${encodeURIComponent(quinn.username)}`, { headers: auth(roger.token) });
      const rogerResults = await searchRoger.json();
      assert.ok(!rogerResults.users.some(u => u.id === quinn.id), "roger found squad-only profile");

      // paul (squad member) should find her
      const searchPaul = await fetch(`${API}/users/search?q=${encodeURIComponent(quinn.username)}`, { headers: auth(paul.token) });
      const paulResults = await searchPaul.json();
      assert.ok(paulResults.users.some(u => u.id === quinn.id), "paul did not find squad profile");
    });

    await test("private profile users are not returned in search", async () => {
      await setVisibility(quinn, { profileVisibility: "private" });

      const searchRes = await fetch(`${API}/users/search?q=${encodeURIComponent(quinn.username)}`, { headers: auth(roger.token) });
      assert.strictEqual(searchRes.status, 200, `expected 200, got ${searchRes.status}`);
      const results = await searchRes.json();
      assert.ok(!results.users.some(u => u.id === quinn.id), "private profile found in search");

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
      assert.ok(withoutRoger.collectiveCompletionRate < withRoger.collectiveCompletionRate, "squad coverage should drop after roger leaves");

      // But Roger's personal collection remains intact.
      res = await fetch(`${API}/collection/${roger.id}`, { headers: auth(roger.token) });
      if (!res.ok) assert.fail(`roger collection failed: ${await res.text()}`);
      const coll = await res.json();
      assert.ok(coll[variantId] && coll[variantId].status === "owned", "roger's personal entry should remain after leaving");
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
      assert.ok(friends.friends.some(f => f.id === paul.id), "friendship should remain after leaving squad");

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

      res = await fetch(`${API}/squads/${squadB.code}/invite/${roger.id}`, { method: "POST", headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`roger invite failed: ${await res.text()}`);
      let { invitationId } = await res.json();

      res = await fetch(`${API}/squads/invitations/${invitationId}/accept`, { method: "POST", headers: auth(roger.token) });
      if (!res.ok) assert.fail(`roger accept invite failed: ${await res.text()}`);

      res = await fetch(`${API}/friends/${roger.id}/remove`, { method: "POST", headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`remove friend failed: ${await res.text()}`);

      // Roger must still be listed as an active member of the squad.
      res = await fetch(`${API}/squads/${squadB.code}`, { headers: auth(quinn.token) });
      if (!res.ok) assert.fail(`squad details failed: ${await res.text()}`);
      const data = await res.json();
      assert.ok(data.members.some(m => String(m.userId) === String(roger.id)), "removing friendship should not remove roger from squad");
    });
  } finally {
    await cleanup(paul);
    await cleanup(quinn);
    await cleanup(roger);
  }

  const steve = await register(`FrSteve${rnd()}`);
  const tina = await register(`FrTina${rnd()}`);
  try {
    await test("blocking a squad member hides individual data but preserves global stats", async () => {
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

      // Squad global stats still include Steve's contribution, but Steve is hidden from the member list.
      res = await fetch(`${API}/squads/${squad.code}`, { headers: auth(tina.token) });
      if (!res.ok) assert.fail(`squad details failed: ${await res.text()}`);
      const data = await res.json();
      assert.ok(data.collectiveCompletionRate > 0, "squad global stats should still count blocked member's contribution");
      assert.ok(!data.members.some(m => String(m.userId) === String(steve.id)), "blocked member should not appear in member list");
    });
  } finally {
    await cleanup(steve);
    await cleanup(tina);
  }

  await test("notifications are created and collection notifications can be disabled", async () => {
    const fred = await register(`FrFred${rnd()}`);
    const gina = await register(`FrGina${rnd()}`);
    try {
      const catRes = await fetch(`${API}/sprites`);
      assert.strictEqual(catRes.status, 200, `catalog failed: ${catRes.status}`);
      const cat = await catRes.json();
      const first = cat.sprites[0];
      const variantId = (first && first.variantIds && first.variantIds[0]) || (first && first.id) || "sprite_burnt_peanut";

      let res = await fetch(`${API}/friends/${gina.id}/request`, { method: "POST", headers: auth(fred.token) });
      assert.strictEqual(res.status, 200, `request failed: ${res.status}`);
      res = await fetch(`${API}/friends/${fred.id}/accept`, { method: "POST", headers: auth(gina.token) });
      assert.strictEqual(res.status, 200, `accept failed: ${res.status}`);

      let notifRes = await fetch(`${API}/notifications`, { headers: auth(gina.token) });
      assert.strictEqual(notifRes.status, 200);
      let notifs = await notifRes.json();
      assert.ok(notifs.notifications.some(n => n.type === "friend_request_received" && n.actor_id === fred.id), "gina missing friend_request_received");

      notifRes = await fetch(`${API}/notifications`, { headers: auth(fred.token) });
      notifs = await notifRes.json();
      assert.ok(notifs.notifications.some(n => n.type === "friend_request_accepted" && n.actor_id === gina.id), "fred missing friend_request_accepted");

      // Gina prioritizes the variant
      res = await fetch(`${API}/collection/${gina.id}/${variantId}`, {
        method: "PUT",
        headers: auth(gina.token),
        body: JSON.stringify({ status: "missing", priority: "urgent" })
      });
      assert.strictEqual(res.status, 200, `gina priority update failed: ${res.status}`);

      // Fred now owns that variant
      res = await fetch(`${API}/collection/${fred.id}/${variantId}`, {
        method: "PUT",
        headers: auth(fred.token),
        body: JSON.stringify({ status: "owned" })
      });
      assert.strictEqual(res.status, 200, `fred owned update failed: ${res.status}`);

      await new Promise(r => setTimeout(r, 150));
      notifRes = await fetch(`${API}/notifications`, { headers: auth(gina.token) });
      notifs = await notifRes.json();
      assert.ok(notifs.notifications.some(n => n.type === "friend_collection_updated" && n.actor_id === fred.id), "gina missing friend_collection_updated");
      assert.ok(notifs.notifications.some(n => n.type === "friend_priority_match" && n.actor_id === fred.id && n.entity_id === variantId), "gina missing friend_priority_match");

      // Disable collection-related notifications for Gina
      res = await fetch(`${API}/profile/${gina.id}`, {
        method: "PATCH",
        headers: auth(gina.token),
        body: JSON.stringify({ pushPrefFriendCollectionUpdates: false, pushPrefFriendPriorityMatches: false })
      });
      assert.strictEqual(res.status, 200, `disable prefs failed: ${res.status}`);

      // Mark existing notifications as read so we can assert no new ones arrive.
      res = await fetch(`${API}/notifications/read-all`, { method: "POST", headers: auth(gina.token) });
      assert.strictEqual(res.status, 200, `read-all failed: ${res.status}`);

      res = await fetch(`${API}/collection/${fred.id}/${variantId}`, {
        method: "PUT",
        headers: auth(fred.token),
        body: JSON.stringify({ status: "new" })
      });
      assert.strictEqual(res.status, 200, `fred reset failed: ${res.status}`);

      await new Promise(r => setTimeout(r, 150));
      notifRes = await fetch(`${API}/notifications`, { headers: auth(gina.token) });
      notifs = await notifRes.json();
      assert.ok(!notifs.notifications.some(n => n.type === "friend_collection_updated" && n.read_at === null), "disabled collection notification created");
      assert.ok(!notifs.notifications.some(n => n.type === "friend_priority_match" && n.read_at === null), "disabled priority match created");
    } finally {
      await cleanup(fred);
      await cleanup(gina);
    }
  });

  async function okJson(res, label) {
    const text = await res.text();
    if (!res.ok) assert.fail(`${label}: ${res.status} ${text}`);
    return JSON.parse(text);
  }

  await test("squad members expose friendship fields and friend can be invited", async () => {
    const salice = await register(`FrSquadAlice${rnd()}`);
    const sbob = await register(`FrSquadBob${rnd()}`);
    const sdave = await register(`FrSquadDave${rnd()}`);
    try {
      // Alice and Bob become friends.
      let res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(salice.token), body: JSON.stringify({ addresseeId: sbob.id }) });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(sbob.token) });
      await okJson(res, "accept request");

      // Alice creates an open squad.
      res = await fetch(`${API}/squads`, { method: "POST", headers: auth(salice.token), body: JSON.stringify({ name: "Test Squad" }) });
      const { code } = await okJson(res, "create squad");

      // Alice can invite Bob because they are friends.
      res = await fetch(`${API}/squads/${code}/invite/${sbob.id}`, { method: "POST", headers: auth(salice.token) });
      const inviteResult = await okJson(res, "invite to squad");
      assert.ok(inviteResult.invitationId, "invite should return invitationId");

      // Bob sees the pending squad invitation with context.
      res = await fetch(`${API}/squad-invitations`, { headers: auth(sbob.token) });
      const invitations = await okJson(res, "list squad invitations");
      assert.ok(invitations.invitations.length, "bob should have a pending squad invitation");
      const squadInvite = invitations.invitations[0];
      assert.strictEqual(squadInvite.squad.code, code);
      assert.ok(squadInvite.inviter.id === salice.id || squadInvite.inviter.username === salice.username);
      assert.strictEqual(squadInvite.actions.join, true);

      // Bob accepts the invitation.
      res = await fetch(`${API}/squad-invitations/${squadInvite.invitationId}/accept`, { method: "POST", headers: auth(sbob.token) });
      await okJson(res, "accept squad invitation");

      // Squad details now include friendship status fields for members.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(sbob.token) });
      const squadData = await okJson(res, "squad details");
      const aliceMember = squadData.members.find(m => m.userId === salice.id);
      const bobMember = squadData.members.find(m => m.userId === sbob.id);
      assert.ok(aliceMember, "alice missing from squad members");
      assert.ok(bobMember, "bob missing from squad members");
      assert.strictEqual(aliceMember.friendshipStatus, "accepted");
      assert.strictEqual(aliceMember.canReceiveFriendRequest, false);
      assert.strictEqual(bobMember.friendshipStatus, "me");
      assert.strictEqual(bobMember.canReceiveFriendRequest, false);

      // Non-friend Dave joins via code; it must not create a friendship.
      res = await fetch(`${API}/squads/join`, { method: "POST", headers: auth(sdave.token), body: JSON.stringify({ code }) });
      await okJson(res, "join squad");
      res = await fetch(`${API}/friends`, { headers: auth(salice.token) });
      const friends = await okJson(res, "friend list");
      assert.ok(!friends.friends.some(f => f.id === sdave.id), "joining squad created a friendship");

      // Dave sees Alice as a non-friend he can add.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(sdave.token) });
      const daveView = await okJson(res, "squad details from dave");
      const aliceFromDave = daveView.members.find(m => m.userId === salice.id);
      assert.ok(aliceFromDave, "alice missing from dave's view");
      assert.strictEqual(aliceFromDave.friendshipStatus, "none");
      assert.strictEqual(aliceFromDave.canReceiveFriendRequest, true);

      // Alice cannot invite a non-friend (Dave) to the squad.
      res = await fetch(`${API}/squads/${code}/invite/${sdave.id}`, { method: "POST", headers: auth(salice.token) });
      assert.strictEqual(res.status, 403, `non-friend invite should fail: ${res.status}`);
    } finally {
      await cleanup(salice);
      await cleanup(sbob);
      await cleanup(sdave);
    }
  });

  await test("squad invitations can be declined or accepted on canonical path", async () => {
    const alice = await register(`FrInvAlice${rnd()}`);
    const bob = await register(`FrInvBob${rnd()}`);
    try {
      let res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(alice.token), body: JSON.stringify({ addresseeId: bob.id }) });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(bob.token) });
      await okJson(res, "accept request");

      res = await fetch(`${API}/squads`, { method: "POST", headers: auth(alice.token), body: JSON.stringify({ name: "Canonical Squad" }) });
      const { code } = await okJson(res, "create squad");

      res = await fetch(`${API}/squads/${code}/invite/${bob.id}`, { method: "POST", headers: auth(alice.token) });
      const { invitationId } = await okJson(res, "invite bob");

      // Bob declines via canonical path.
      res = await fetch(`${API}/squads/invitations/${invitationId}/decline`, { method: "POST", headers: auth(bob.token) });
      await okJson(res, "decline invitation");

      // Bob no longer has pending invitations.
      res = await fetch(`${API}/squad-invitations`, { headers: auth(bob.token) });
      const declinedList = await okJson(res, "list invitations after decline");
      assert.strictEqual(declinedList.invitations.length, 0, "declined invitation still pending");

      // Alice invites Bob again.
      res = await fetch(`${API}/squads/${code}/invite/${bob.id}`, { method: "POST", headers: auth(alice.token) });
      const { invitationId: newInvitationId } = await okJson(res, "re-invite bob");

      // Bob accepts via canonical path.
      res = await fetch(`${API}/squads/invitations/${newInvitationId}/accept`, { method: "POST", headers: auth(bob.token) });
      const acceptData = await okJson(res, "accept via canonical path");
      assert.strictEqual(acceptData.squadCode, code);

      // Squad stats are populated.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(bob.token) });
      const squadData = await okJson(res, "squad details after accept");
      assert.ok(typeof squadData.collectiveCompletionRate === "number", "collective completion missing");
      assert.ok(Array.isArray(squadData.recommendations), "recommendations missing");
    } finally {
      await cleanup(alice);
      await cleanup(bob);
    }
  });

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

  await test("deleted account is removed from friend lists and pending invitations cancelled", async () => {
    const alice = await register(`FrDeleteAlice${rnd()}`);
    const bob = await register(`FrDeleteBob${rnd()}`);
    try {
      let res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(alice.token), body: JSON.stringify({ addresseeId: bob.id }) });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(bob.token) });
      await okJson(res, "accept request");

      // Bob sends a pending request to Alice (will be cancelled when Alice deletes).
      const claire = await register(`FrDeleteClaire${rnd()}`);
      try {
        res = await fetch(`${API}/friends/requests`, { method: "POST", headers: auth(claire.token), body: JSON.stringify({ addresseeId: alice.id }) });
        await okJson(res, "pending request to alice");
      } catch (e) {
        await cleanup(claire);
        throw e;
      }

      // Alice creates a compare share link and a friend invite link.
      res = await fetch(`${API}/compare/share`, { method: "POST", headers: auth(alice.token), body: JSON.stringify({ duration: "1h" }) });
      const { token: compareToken } = await okJson(res, "compare share link");
      res = await fetch(`${API}/friends/invite-links`, { method: "POST", headers: auth(alice.token), body: JSON.stringify({ duration: "24h" }) });
      const { token: inviteToken } = await okJson(res, "friend invite link");

      // Alice deletes her account.
      res = await fetch(`${API}/profile/${alice.id}`, { method: "DELETE", headers: auth(alice.token) });
      await okJson(res, "delete account");

      // Bob no longer sees Alice in his friend list.
      res = await fetch(`${API}/friends`, { headers: auth(bob.token) });
      const friends = await okJson(res, "friend list");
      assert.ok(!friends.friends.some(f => f.id === alice.id), "deleted user still in friend list");

      // Alice's pending request to her is cancelled.
      res = await fetch(`${API}/friends/requests/received`, { headers: auth(alice.token) });
      assert.strictEqual(res.status, 401, "deleted user session should be invalid");
      res = await fetch(`${API}/friends/pending`, { headers: auth(claire.token) });
      const pending = await okJson(res, "pending list");
      assert.ok(!pending.pending.some(p => p.id === alice.id), "deleted addressee still in pending list");

      // Alice cannot be compared, searched or viewed.
      res = await fetch(`${API}/compare/${alice.id}`, { headers: auth(bob.token) });
      assert.strictEqual(res.status, 404, `compare should fail: ${res.status}`);
      res = await fetch(`${API}/profile/${alice.id}`, { headers: auth(bob.token) });
      assert.strictEqual(res.status, 404, `profile should fail: ${res.status}`);
      res = await fetch(`${API}/users/search?q=${encodeURIComponent(alice.username)}`, { headers: auth(bob.token) });
      const search = await okJson(res, "search");
      assert.ok(!search.users.some(u => u.id === alice.id), "deleted user found in search");

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

  await test("deleted account squad activity is anonymised", async () => {
    const carol = await register(`FrDeleteCarol${rnd()}`);
    const dave = await register(`FrDeleteDave${rnd()}`);
    try {
      const squadRes = await fetch(`${API}/squads`, { method: "POST", headers: auth(carol.token), body: JSON.stringify({ name: "Activity Squad" }) });
      const squad = await okJson(squadRes, "create squad");

      let res = await fetch(`${API}/squads/join`, { method: "POST", headers: auth(dave.token), body: JSON.stringify({ code: squad.code }) });
      await okJson(res, "join squad");

      // Dave makes a collection change that emits squad activity.
      const catRes = await fetch(`${API}/sprites`);
      assert.strictEqual(catRes.status, 200);
      const cat = await catRes.json();
      const variantId = (cat.sprites[0] && cat.sprites[0].variantIds && cat.sprites[0].variantIds[0]) || (cat.sprites[0] && cat.sprites[0].id) || "sprite_burnt_peanut";
      res = await fetch(`${API}/collection/${dave.id}/${variantId}`, {
        method: "PUT",
        headers: auth(dave.token),
        body: JSON.stringify({ status: "owned" })
      });
      await okJson(res, "collection update");

      // Verify Dave's username appears before deletion.
      res = await fetch(`${API}/squads/${squad.code}/history`, { headers: auth(carol.token) });
      let history = await okJson(res, "squad history");
      assert.ok(history.entries.some(e => e.username === dave.username), "dave activity missing before deletion");

      // Dave deletes account.
      res = await fetch(`${API}/profile/${dave.id}`, { method: "DELETE", headers: auth(dave.token) });
      await okJson(res, "delete dave");

      // His entry is now anonymised.
      res = await fetch(`${API}/squads/${squad.code}/history`, { headers: auth(carol.token) });
      history = await okJson(res, "squad history after delete");
      assert.ok(history.entries.some(e => e.username === "Utilisateur anonyme"), "squad activity not anonymised");
    } finally {
      await cleanup(carol);
      await cleanup(dave);
    }
  });

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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
