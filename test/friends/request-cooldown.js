"use strict";

module.exports = async function runRequestCooldown(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

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
      assert.ok(!pending.pending.some((p) => p.id === mike.id), "declined request still in pending");
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

        const del = await fetch(`${API}/friends/requests/${requestId}`, {
          method: "DELETE",
          headers: auth(mike.token)
        });
        assert.strictEqual(del.status, 200);

        const sent = await (await fetch(`${API}/friends/requests/sent`, { headers: auth(mike.token) })).json();
        assert.ok(!sent.requests.some((r) => r.user && r.user.id === oscar.id), "cancelled request still in sent list");

        const received = await (await fetch(`${API}/friends/requests/received`, { headers: auth(oscar.token) })).json();
        assert.ok(
          !received.requests.some((r) => r.user && r.user.id === mike.id),
          "cancelled request still in received list"
        );
      } finally {
        await cleanup(oscar);
      }
    });
  } finally {
    await cleanup(mike);
    await cleanup(nina);
  }
};
