"use strict";

module.exports = async function runInviteLinks(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

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
      assert.ok(
        pending.pending.some((p) => p.id === henry.id),
        "grace does not see henry's request"
      );
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
};
