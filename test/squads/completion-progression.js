const { assert, API, test, rnd, register, auth, cleanup, createSquad, joinSquad, sendFriendRequest, acceptFriendRequest, getSquad, setEntry, leaveSquad } = require("./shared");

module.exports = async function runCompletionProgression(samples) {
  await test("squad_completion_increased progression (Étape 65)", async () => {
    const owner = await register(`SqE65A${rnd()}`), mate = await register(`SqE65B${rnd()}`), leaver = await register(`SqE65C${rnd()}`);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await sendFriendRequest(owner.token, mate.id); await acceptFriendRequest(mate.token, owner.id);
      await sendFriendRequest(owner.token, leaver.id); await acceptFriendRequest(leaver.token, owner.id);
      const squad = await createSquad(owner.token, "Étape 65 Squad");
      await joinSquad(mate.token, squad.code); await joinSquad(leaver.token, squad.code);
      const ids = (samples.activeIds || []).filter(Boolean);
      assert.ok(ids.length >= 5, `need >= 5 active variants, got ${ids.length}`);
      const [seedId, vGain, vDup, vFast1, vFast2, vAfterLeave] = [ids[0], ids[1], ids[1], ids[2], ids[3], ids[4]];
      await setEntry(owner.token, owner.id, seedId, "owned"); await sleep(300);
      let details = await getSquad(owner.token, squad.code);
      const rateBeforeGain = Number(details.collectiveCompletionRate);
      assert.ok(rateBeforeGain > 0, "seed ownership should raise collective rate");
      await setEntry(mate.token, mate.id, vGain, "owned"); await sleep(700);
      details = await getSquad(owner.token, squad.code);
      const rateAfterGain = Number(details.collectiveCompletionRate);
      assert.ok(rateAfterGain > rateBeforeGain, "new unique variant must increase collective rate");
      let notifRes = await fetch(`${API}/notifications`, { headers: auth(owner.token) });
      let notifs = await notifRes.json();
      const hit = notifs.notifications.find(n => n.type === "squad_completion_increased" && String(n.actor_id || n.actor?.id) === String(mate.id));
      assert.ok(hit, "owner should be notified of mate's unique gain");
      assert.strictEqual(Number(hit.data.previousRate), rateBeforeGain, "previousRate must match");
      assert.strictEqual(Number(hit.data.newRate), rateAfterGain, "newRate must match");
      assert.ok(Number(hit.data.newCoveredCount) > Number(hit.data.previousCoveredCount), "covered count must rise");
      assert.ok((hit.data.newVariantIds || []).map(String).includes(String(vGain)), "new variant listed");
      const ownerBefore = notifs.notifications.filter(n => n.type === "squad_completion_increased").length;
      const mateBefore = (await (await fetch(`${API}/notifications`, { headers: auth(mate.token) })).json()).notifications.filter(n => n.type === "squad_completion_increased" && String(n.actor_id || n.actor?.id) === String(owner.id)).length;
      await setEntry(owner.token, owner.id, vDup, "owned"); await sleep(700);
      details = await getSquad(owner.token, squad.code);
      assert.strictEqual(Number(details.collectiveCompletionRate), rateAfterGain, "already-covered possession must not change the rate");
      const mateAfter = (await (await fetch(`${API}/notifications`, { headers: auth(mate.token) })).json()).notifications.filter(n => n.type === "squad_completion_increased" && String(n.actor_id || n.actor?.id) === String(owner.id)).length;
      assert.strictEqual(mateAfter, mateBefore, "duplicate coverage must not notify");
      const ownerAfter = (await (await fetch(`${API}/notifications`, { headers: auth(owner.token) })).json()).notifications.filter(n => n.type === "squad_completion_increased").length;
      assert.strictEqual(ownerAfter, ownerBefore, "no extra notif on duplicate cover");
      await fetch(`${API}/notifications/read-all`, { method: "POST", headers: auth(owner.token) });
      await setEntry(mate.token, mate.id, vFast1, "owned"); await setEntry(mate.token, mate.id, vFast2, "owned"); await sleep(700);
      notifs = await (await fetch(`${API}/notifications`, { headers: auth(owner.token) })).json();
      const rapid = notifs.notifications.filter(n => n.type === "squad_completion_increased" && n.read_at == null && String(n.actor_id || n.actor?.id) === String(mate.id));
      assert.strictEqual(rapid.length, 1, "rapid gains should flush as one grouped notification");
      const rapidCount = Number(rapid[0].data?.count || rapid[0].data?.group?.eventCount || 0);
      assert.ok(rapidCount >= 2, `grouped count expected >= 2, got ${rapidCount}`);
      assert.ok(Array.isArray(rapid[0].data?.newVariantIds) && rapid[0].data.newVariantIds.length >= 2, "grouped payload should list multiple variants");
      if (rapid[0].data?.milestone != null) {
        assert.ok([25, 50, 75, 80, 90, 95, 100].includes(Number(rapid[0].data.milestone)), "milestone value must be a known palier");
        assert.strictEqual(rapid[0].data.kind, "milestone");
      } else if (Number(rapid[0].data?.previousRate) < 25 && Number(rapid[0].data?.newRate) >= 25) assert.fail("crossing 25% must set data.milestone");
      details = await getSquad(owner.token, squad.code);
      assert.strictEqual(Number(rapid[0].data.newRate), Number(details.collectiveCompletionRate), "grouped newRate must match current collective rate");
      assert.ok(Number(rapid[0].data.newRate) > Number(rapid[0].data.previousRate), "grouped previous/new rates must advance");
      await leaveSquad(leaver.token, squad.code);
      await fetch(`${API}/notifications/read-all`, { method: "POST", headers: auth(leaver.token) });
      await setEntry(mate.token, mate.id, vAfterLeave, "owned"); await sleep(700);
      const leaverNotifs = await (await fetch(`${API}/notifications`, { headers: auth(leaver.token) })).json();
      assert.ok(!leaverNotifs.notifications.some(n => n.type === "squad_completion_increased" && n.read_at == null), "former squad members must not be notified");
      const ownerAfterLeave = await (await fetch(`${API}/notifications`, { headers: auth(owner.token) })).json();
      assert.ok(ownerAfterLeave.notifications.some(n => n.type === "squad_completion_increased" && n.read_at == null && (n.data?.newVariantIds || []).map(String).includes(String(vAfterLeave))), "active members should still be notified after someone leaves");
    } finally { await cleanup(owner); await cleanup(mate); await cleanup(leaver); }
  });
};
