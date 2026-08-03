"use strict";

module.exports = async function runNotificationAcceptance(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("friend_request_accepted notification (Étape 63)", async () => {
    // A) created after accept · requester only · once · opens compare · cancelled on immediate block
    const requester = await register(`FrE63A${rnd()}`);
    const accepter = await register(`FrE63B${rnd()}`);
    try {
      let res = await fetch(`${API}/friends/${accepter.id}/request`, {
        method: "POST",
        headers: auth(requester.token)
      });
      assert.strictEqual(res.status, 200, `request failed: ${res.status}`);
      res = await fetch(`${API}/friends/${requester.id}/accept`, {
        method: "POST",
        headers: auth(accepter.token)
      });
      assert.strictEqual(res.status, 200, `accept failed: ${res.status}`);

      let notifRes = await fetch(`${API}/notifications`, { headers: auth(requester.token) });
      assert.strictEqual(notifRes.status, 200);
      let notifs = await notifRes.json();
      const accepted = notifs.notifications.filter(
        (n) => n.type === "friend_request_accepted" && String(n.actor_id || n.actor?.id) === String(accepter.id)
      );
      assert.strictEqual(accepted.length, 1, "exactly one friend_request_accepted for requester");
      const n = accepted[0];
      const actionUrl = n.action?.url || n.data?.actionUrl || n.data?.actions?.primary?.url;
      assert.strictEqual(actionUrl, `/compare/${accepter.id}`, "notification must open comparison with the accepter");

      notifRes = await fetch(`${API}/notifications`, { headers: auth(accepter.token) });
      notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((x) => x.type === "friend_request_accepted"),
        "accepter must not receive friend_request_accepted"
      );

      // Re-accept must not create a second notification (dedupe / no re-emit).
      res = await fetch(`${API}/friends/${requester.id}/accept`, {
        method: "POST",
        headers: auth(accepter.token)
      });
      // Already friends → conflict or no-op; either way inbox stays at one.
      notifRes = await fetch(`${API}/notifications`, { headers: auth(requester.token) });
      notifs = await notifRes.json();
      assert.strictEqual(
        notifs.notifications.filter((x) => x.type === "friend_request_accepted").length,
        1,
        "re-accept must not create a duplicate friend_request_accepted"
      );

      // Immediate block cancels / removes the social notification from the inbox.
      res = await fetch(`${API}/users/${accepter.id}/block`, {
        method: "POST",
        headers: auth(requester.token)
      });
      assert.strictEqual(res.status, 200, `block failed: ${res.status}`);
      notifRes = await fetch(`${API}/notifications`, { headers: auth(requester.token) });
      notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((x) => x.type === "friend_request_accepted"),
        "friend_request_accepted must be cancelled after immediate block"
      );
    } finally {
      await cleanup(requester);
      await cleanup(accepter);
    }

    // B) respects preferences (social category + type-level disable)
    const prefsRequester = await register(`FrE63PrefA${rnd()}`);
    const prefsAccepter = await register(`FrE63PrefB${rnd()}`);
    try {
      let res = await fetch(`${API}/notifications/preferences`, {
        method: "PUT",
        headers: auth(prefsRequester.token),
        body: JSON.stringify({
          categories: { social: false },
          types: { friend_request_accepted: false }
        })
      });
      assert.strictEqual(res.status, 200, `disable prefs failed: ${res.status}`);

      res = await fetch(`${API}/friends/${prefsAccepter.id}/request`, {
        method: "POST",
        headers: auth(prefsRequester.token)
      });
      assert.strictEqual(res.status, 200, `request failed: ${res.status}`);
      res = await fetch(`${API}/friends/${prefsRequester.id}/accept`, {
        method: "POST",
        headers: auth(prefsAccepter.token)
      });
      assert.strictEqual(res.status, 200, `accept failed: ${res.status}`);

      const notifRes = await fetch(`${API}/notifications`, { headers: auth(prefsRequester.token) });
      assert.strictEqual(notifRes.status, 200);
      const notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((x) => x.type === "friend_request_accepted"),
        "prefs-disabled recipient must not get friend_request_accepted"
      );
    } finally {
      await cleanup(prefsRequester);
      await cleanup(prefsAccepter);
    }
  });
};
