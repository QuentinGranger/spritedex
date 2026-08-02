const { assert, API, test, rnd, register, auth, cleanup, createSquad, joinSquad, sendFriendRequest, acceptFriendRequest, setEntry } = require("./shared");

module.exports = async function runCompletionNotification(samples) {
  await test("une nouvelle variante unique déclenche squad_completion_increased (Étapes 22–23)", async () => {
    const owner = await register(`SqCompA${rnd()}`), mate = await register(`SqCompB${rnd()}`);
    try {
      await sendFriendRequest(owner.token, mate.id);
      await acceptFriendRequest(mate.token, owner.id);
      const squad = await createSquad(owner.token, "Notify Squad");
      await joinSquad(mate.token, squad.code);
      await setEntry(owner.token, owner.id, samples.activeId, "owned");
      await new Promise(r => setTimeout(r, 300));
      const otherId = samples.secondActiveId;
      assert.ok(otherId && String(otherId) !== String(samples.activeId), "need a second distinct active variant");
      await setEntry(mate.token, mate.id, otherId, "owned");
      await new Promise(r => setTimeout(r, 800));
      const notifRes = await fetch(`${API}/notifications`, { headers: auth(owner.token) });
      assert.strictEqual(notifRes.status, 200);
      const notifs = await notifRes.json();
      const hit = notifs.notifications.find(n => n.type === "squad_completion_increased" && String(n.actor_id) === String(mate.id));
      assert.ok(hit, "owner should receive squad_completion_increased for unique gain");
      assert.ok(hit.data && Array.isArray(hit.data.newVariantIds), "data.newVariantIds missing");
      assert.ok(hit.data.newVariantIds.map(String).includes(String(otherId)), "new variant not listed");
      const beforeCount = notifs.notifications.filter(n => n.type === "squad_completion_increased").length;
      await setEntry(owner.token, owner.id, otherId, "owned");
      await new Promise(r => setTimeout(r, 800));
      const notifs2 = await (await fetch(`${API}/notifications`, { headers: auth(mate.token) })).json();
      const afterCount = notifs2.notifications.filter(n => n.type === "squad_completion_increased" && String(n.actor_id) === String(owner.id)).length;
      assert.strictEqual(afterCount, 0, "duplicate coverage must not notify (Étape 23)");
      assert.ok(beforeCount >= 1, "sanity: at least one prior completion notif");
    } finally { await cleanup(owner); await cleanup(mate); }
  });
};
