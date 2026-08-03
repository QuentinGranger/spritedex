const {
  assert,
  API,
  test,
  rnd,
  register,
  auth,
  cleanup,
  createSquad,
  joinSquad,
  getSquad,
  getSquadHistory,
  setPrivacy,
  setEntry,
  blockUser
} = require("./shared");

module.exports = async function runPrivacy(samples) {
  await test("une collection bloquée ne fuit ni dans l'activité ni les notifications de squad", async () => {
    const owner = await register(`SqPrivateOwner${rnd()}`),
      viewer = await register(`SqPrivateViewer${rnd()}`);
    try {
      const squad = await createSquad(owner.token, "Privacy Activity Squad");
      await joinSquad(viewer.token, squad.code);
      await setPrivacy(owner.token, owner.id, "public");
      await setEntry(owner.token, owner.id, samples.activeId, "owned");
      await new Promise((r) => setTimeout(r, 250));
      let history = await getSquadHistory(viewer.token, squad.code);
      const publicActivity = history.entries.find(
        (e) => e.type === "collection_update" && String(e.user_id) === String(owner.id)
      );
      assert.ok(publicActivity, "public collection activity should be visible before the block");
      assert.strictEqual(
        publicActivity.metadata?.firstInSquad,
        undefined,
        "activity must not expose collective ownership inferred from other collections"
      );
      await blockUser(viewer.token, viewer.id, owner.id);
      if (samples.secondActiveId) await setEntry(owner.token, owner.id, samples.secondActiveId, "owned");
      await new Promise((r) => setTimeout(r, 700));
      history = await getSquadHistory(viewer.token, squad.code);
      assert.ok(
        !history.entries.some((e) => e.type === "collection_update" && String(e.user_id) === String(owner.id)),
        "blocked viewer must not receive past or new collection activity"
      );
      const notifRes = await fetch(`${API}/notifications`, { headers: auth(viewer.token) });
      if (!notifRes.ok) assert.fail(`notifications failed: ${await notifRes.text()}`);
      const notifications = await notifRes.json();
      assert.ok(
        !notifications.notifications.some(
          (n) => n.type === "squad_completion_increased" && String(n.actor_id) === String(owner.id)
        ),
        "blocked viewer must not receive squad completion derived from the owner's collection"
      );
      const ownerMember = (await getSquad(viewer.token, squad.code)).members.find(
        (m) => String(m.userId) === String(owner.id)
      );
      assert.ok(
        !ownerMember || ownerMember.entryCount === 0,
        "blocked owner's collection must be omitted from squad stats"
      );
    } finally {
      await cleanup(owner);
      await cleanup(viewer);
    }
  });
};
