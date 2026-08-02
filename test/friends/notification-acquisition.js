"use strict";

module.exports = async function runNotificationAcquisition(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("friend_acquired_missing_variant notification (Étape 64)", async () => {
    const actor = await register(`FrE64Act${rnd()}`);
    const missingFriend = await register(`FrE64Miss${rnd()}`);
    const priorityFriend = await register(`FrE64Prio${rnd()}`);
    const unknownFriend = await register(`FrE64Unk${rnd()}`);
    const outsider = await register(`FrE64Out${rnd()}`);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    try {
      const catRes = await fetch(`${API}/sprites`);
      assert.strictEqual(catRes.status, 200, `catalog failed: ${catRes.status}`);
      const cat = await catRes.json();
      const variantIds = [];
      for (const sprite of cat.sprites || []) {
        for (const id of sprite.variantIds || [sprite.id]) {
          if (id && !variantIds.includes(id)) variantIds.push(id);
          if (variantIds.length >= 3) break;
        }
        if (variantIds.length >= 3) break;
      }
      assert.ok(variantIds.length >= 3, "need at least 3 catalog variants");
      const [v1, v2, v3] = variantIds;

      await becomeFriends(actor, missingFriend);
      await becomeFriends(actor, priorityFriend);
      await becomeFriends(actor, unknownFriend);
      await setVisibility(actor, { collectionVisibility: "friends" });

      // Recipient interests on v1 (outsider is not a friend).
      await setEntry(missingFriend.token, missingFriend.id, v1, "missing");
      await setEntry(priorityFriend.token, priorityFriend.id, v1, "priority");
      await setEntry(unknownFriend.token, unknownFriend.id, v1, "unknown");
      await setEntry(outsider.token, outsider.id, v1, "missing");

      // Owned transition triggers analysis (Étape 15).
      await setEntry(actor.token, actor.id, v1, "missing");
      await setEntry(actor.token, actor.id, v1, "owned");
      await sleep(700);

      let notifRes = await fetch(`${API}/notifications`, { headers: auth(missingFriend.token) });
      assert.strictEqual(notifRes.status, 200);
      let notifs = await notifRes.json();
      const forMissing = notifs.notifications.filter(
        (n) => n.type === "friend_acquired_missing_variant"
          && String(n.actor_id || n.actor?.id) === String(actor.id)
          && String(n.entity_id || n.entity?.id) === String(v1)
      );
      assert.strictEqual(forMissing.length, 1, "missing friend should be notified once");
      assert.ok(
        /correspondance|manque|possède/i.test(forMissing[0].title || ""),
        "missing-level wording expected"
      );
      assert.notStrictEqual(
        forMissing[0].data?.priorityLevel,
        "strong",
        "simple missing must not be strong priority"
      );

      notifRes = await fetch(`${API}/notifications`, { headers: auth(priorityFriend.token) });
      notifs = await notifRes.json();
      const forPriority = notifs.notifications.filter(
        (n) => n.type === "friend_acquired_missing_variant"
          && String(n.actor_id || n.actor?.id) === String(actor.id)
      );
      assert.strictEqual(forPriority.length, 1, "priority friend should be notified");
      assert.ok(
        /priorit/i.test(forPriority[0].title || forPriority[0].body || ""),
        "priority must be distinguished from simple missing"
      );
      assert.strictEqual(forPriority[0].data?.priorityLevel, "strong");
      assert.strictEqual(forPriority[0].data?.recipientCollectionStatus, "priority");

      notifRes = await fetch(`${API}/notifications`, { headers: auth(unknownFriend.token) });
      notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((n) => n.type === "friend_acquired_missing_variant"),
        "unknown status must not trigger the alert"
      );

      notifRes = await fetch(`${API}/notifications`, { headers: auth(outsider.token) });
      notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some((n) => n.type === "friend_acquired_missing_variant"),
        "non-friend must not be selected"
      );

      // Multiple acquisitions for the same friend are grouped in one batch.
      await fetch(`${API}/notifications/read-all`, {
        method: "POST",
        headers: auth(missingFriend.token)
      });
      await setEntry(missingFriend.token, missingFriend.id, v2, "missing");
      await setEntry(missingFriend.token, missingFriend.id, v3, "missing");
      await setEntry(actor.token, actor.id, v2, "missing");
      await setEntry(actor.token, actor.id, v2, "owned");
      await setEntry(actor.token, actor.id, v3, "missing");
      await setEntry(actor.token, actor.id, v3, "owned");
      await sleep(700);

      notifRes = await fetch(`${API}/notifications`, { headers: auth(missingFriend.token) });
      notifs = await notifRes.json();
      const grouped = notifs.notifications.filter(
        (n) => n.type === "friend_acquired_missing_variant"
          && String(n.actor_id || n.actor?.id) === String(actor.id)
          && n.read_at == null
      );
      assert.strictEqual(grouped.length, 1, "multiple acquisitions should flush as one grouped notification");
      const groupCount = Number(grouped[0].data?.count || grouped[0].data?.group?.eventCount || 0);
      assert.ok(groupCount >= 2, `grouped count expected >= 2, got ${groupCount}`);
      assert.ok(
        Array.isArray(grouped[0].data?.variantIds)
          && grouped[0].data.variantIds.length >= 2,
        "grouped payload should list multiple variants"
      );

      // Private actor collection must not reveal acquisitions.
      await fetch(`${API}/notifications/read-all`, {
        method: "POST",
        headers: auth(missingFriend.token)
      });
      let privateVariant = null;
      for (const sprite of cat.sprites || []) {
        for (const id of sprite.variantIds || [sprite.id]) {
          if (id && !variantIds.slice(0, 3).includes(id)) {
            privateVariant = id;
            break;
          }
        }
        if (privateVariant) break;
      }
      assert.ok(privateVariant, "need a 4th catalog variant for the privacy check");

      await setVisibility(actor, { collectionVisibility: "private" });
      await setEntry(missingFriend.token, missingFriend.id, privateVariant, "missing");
      await setEntry(actor.token, actor.id, privateVariant, "missing");
      await setEntry(actor.token, actor.id, privateVariant, "owned");
      await sleep(700);

      notifRes = await fetch(`${API}/notifications`, { headers: auth(missingFriend.token) });
      notifs = await notifRes.json();
      assert.ok(
        !notifs.notifications.some(
          (n) => n.type === "friend_acquired_missing_variant" && n.read_at == null
        ),
        "private collections must not reveal acquisitions"
      );
    } finally {
      await cleanup(actor);
      await cleanup(missingFriend);
      await cleanup(priorityFriend);
      await cleanup(unknownFriend);
      await cleanup(outsider);
    }
  });
};
