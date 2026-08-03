"use strict";

module.exports = async function runNotificationPreferences(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("notifications are created and collection notifications can be disabled", async () => {
    const fred = await register(`FrFred${rnd()}`);
    const gina = await register(`FrGina${rnd()}`);
    try {
      const catRes = await fetch(`${API}/sprites`);
      assert.strictEqual(catRes.status, 200, `catalog failed: ${catRes.status}`);
      const cat = await catRes.json();
      const first = cat.sprites[0];
      const second = cat.sprites[1] || cat.sprites[0];
      const variantId =
        (first && first.variantIds && first.variantIds[0]) || (first && first.id) || "sprite_burnt_peanut";
      const variantId2 = (second && second.variantIds && second.variantIds[0]) || (second && second.id) || variantId;

      let res = await fetch(`${API}/friends/${gina.id}/request`, { method: "POST", headers: auth(fred.token) });
      assert.strictEqual(res.status, 200, `request failed: ${res.status}`);
      res = await fetch(`${API}/friends/${fred.id}/accept`, { method: "POST", headers: auth(gina.token) });
      assert.strictEqual(res.status, 200, `accept failed: ${res.status}`);

      let notifRes = await fetch(`${API}/notifications`, { headers: auth(gina.token) });
      assert.strictEqual(notifRes.status, 200);
      let notifs = await notifRes.json();
      assert.ok(
        notifs.notifications.some((n) => n.type === "friend_request_received" && n.actor_id === fred.id),
        "gina missing friend_request_received"
      );

      notifRes = await fetch(`${API}/notifications`, { headers: auth(fred.token) });
      notifs = await notifRes.json();
      const accepted = notifs.notifications.find((n) => n.type === "friend_request_accepted" && n.actor_id === gina.id);
      assert.ok(accepted, "fred missing friend_request_accepted");
      // Étape 13 — content shape
      assert.ok(
        accepted.title && accepted.title.includes("a accepté votre invitation"),
        "title should name the accepter"
      );
      assert.strictEqual(accepted.body || accepted.message, "Vous pouvez maintenant comparer vos collections.");
      assert.strictEqual(String(accepted.data.friendId), String(gina.id));
      assert.ok(accepted.data.friendshipId, "data.friendshipId missing");
      assert.strictEqual(accepted.data.actionUrl, `/compare/${gina.id}`);
      assert.strictEqual(accepted.data.actions?.primary?.label, "Comparer nos collections");
      assert.strictEqual(accepted.data.actions?.secondary?.label, "Voir le profil");

      // Étape 11: accepter (gina) must NOT receive a friend_request_accepted for their own action.
      notifRes = await fetch(`${API}/notifications`, { headers: auth(gina.token) });
      notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((n) => n.type === "friend_request_accepted"),
        "accepter should not receive friend_request_accepted"
      );

      // Gina marks the variant as missing (Étape 16/17 — interest required).
      res = await fetch(`${API}/collection/${gina.id}/${variantId}`, {
        method: "PUT",
        headers: auth(gina.token),
        body: JSON.stringify({ status: "missing", priority: "urgent" })
      });
      assert.strictEqual(res.status, 200, `gina missing update failed: ${res.status}`);

      // Étape 15: Fred must transition from a non-owned tracked status → owned.
      res = await fetch(`${API}/collection/${fred.id}/${variantId}`, {
        method: "PUT",
        headers: auth(fred.token),
        body: JSON.stringify({ status: "missing" })
      });
      assert.strictEqual(res.status, 200, `fred missing seed failed: ${res.status}`);
      res = await fetch(`${API}/collection/${fred.id}/${variantId}`, {
        method: "PUT",
        headers: auth(fred.token),
        body: JSON.stringify({ status: "owned" })
      });
      assert.strictEqual(res.status, 200, `fred owned update failed: ${res.status}`);

      await new Promise((r) => setTimeout(r, 700));
      notifRes = await fetch(`${API}/notifications`, { headers: auth(gina.token) });
      notifs = await notifRes.json();
      assert.ok(
        notifs.notifications.some((n) => n.type === "friend_collection_updated" && n.actor_id === fred.id),
        "gina missing friend_collection_updated"
      );
      const acquired = notifs.notifications.find(
        (n) =>
          n.type === "friend_acquired_missing_variant" &&
          n.actor_id === fred.id &&
          String(n.entity_id) === String(variantId)
      );
      assert.ok(acquired, "gina missing friend_acquired_missing_variant");
      assert.strictEqual(acquired.data.recipientCollectionStatus, "missing");
      assert.ok(String(acquired.data.actionUrl).includes(`/compare/${fred.id}`), "actionUrl should point to compare");

      // Disable collection topic for Gina (Étape 16 — must authorize the notification).
      res = await fetch(`${API}/notifications/preferences`, {
        method: "PUT",
        headers: auth(gina.token),
        body: JSON.stringify({ categories: { collection: false } })
      });
      assert.strictEqual(res.status, 200, `disable collection prefs failed: ${res.status}`);
      // Also disable legacy coarse collection updates.
      res = await fetch(`${API}/profile/${gina.id}`, {
        method: "PATCH",
        headers: auth(gina.token),
        body: JSON.stringify({ pushPrefFriendCollectionUpdates: false, pushPrefFriendPriorityMatches: false })
      });
      assert.strictEqual(res.status, 200, `disable prefs failed: ${res.status}`);

      // Mark existing notifications as read so we can assert no new ones arrive.
      res = await fetch(`${API}/notifications/read-all`, { method: "POST", headers: auth(gina.token) });
      assert.strictEqual(res.status, 200, `read-all failed: ${res.status}`);

      // Use a different variant so Étape 14/20 dedupe keys don't mask the prefs check.
      res = await fetch(`${API}/collection/${gina.id}/${variantId2}`, {
        method: "PUT",
        headers: auth(gina.token),
        body: JSON.stringify({ status: "missing" })
      });
      assert.strictEqual(res.status, 200, `gina missing v2 failed: ${res.status}`);
      res = await fetch(`${API}/collection/${fred.id}/${variantId2}`, {
        method: "PUT",
        headers: auth(fred.token),
        body: JSON.stringify({ status: "missing" })
      });
      assert.strictEqual(res.status, 200, `fred missing v2 failed: ${res.status}`);
      res = await fetch(`${API}/collection/${fred.id}/${variantId2}`, {
        method: "PUT",
        headers: auth(fred.token),
        body: JSON.stringify({ status: "owned" })
      });
      assert.strictEqual(res.status, 200, `fred own v2 failed: ${res.status}`);

      await new Promise((r) => setTimeout(r, 700));
      notifRes = await fetch(`${API}/notifications`, { headers: auth(gina.token) });
      notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((n) => n.type === "friend_collection_updated" && n.read_at === null),
        "disabled collection notification created"
      );
      assert.ok(
        !notifs.notifications.some((n) => n.type === "friend_acquired_missing_variant" && n.read_at === null),
        "disabled acquired notification created"
      );
    } finally {
      await cleanup(fred);
      await cleanup(gina);
    }
  });

  await test("friend_request_accepted is skipped when social notifications are disabled (Étape 12)", async () => {
    const requester = await register(`FrSocOffA${rnd()}`);
    const accepter = await register(`FrSocOffB${rnd()}`);
    try {
      // Recipient (requester) opts out of the social category before the accept.
      let res = await fetch(`${API}/notifications/preferences`, {
        method: "PUT",
        headers: auth(requester.token),
        body: JSON.stringify({ categories: { social: false } })
      });
      assert.strictEqual(res.status, 200, `disable social failed: ${res.status}`);

      res = await fetch(`${API}/friends/${accepter.id}/request`, { method: "POST", headers: auth(requester.token) });
      assert.strictEqual(res.status, 200, `request failed: ${res.status}`);
      res = await fetch(`${API}/friends/${requester.id}/accept`, { method: "POST", headers: auth(accepter.token) });
      assert.strictEqual(res.status, 200, `accept failed: ${res.status}`);

      const notifRes = await fetch(`${API}/notifications`, { headers: auth(requester.token) });
      assert.strictEqual(notifRes.status, 200);
      const notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((n) => n.type === "friend_request_accepted"),
        "social-disabled recipient should not get friend_request_accepted"
      );
    } finally {
      await cleanup(requester);
      await cleanup(accepter);
    }
  });
};
