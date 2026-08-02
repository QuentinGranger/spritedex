const shared = require("./shared");
const { assert, API, test, rnd, register, auth, cleanup, createSquad, joinSquad, sendFriendRequest, acceptFriendRequest, inviteToSquad, acceptSquadInvitation, getSquad, friendshipStatus } = shared;

module.exports = async function runFriendshipsAndCapacity({ alice, bob, charlie }) {
  await test("un ami peut être invité dans une squad", async () => {
    await sendFriendRequest(alice.token, bob.id);
    await acceptFriendRequest(bob.token, alice.id);
    const squad = await createSquad(alice.token, "Alpha Squad");
    const { status, data } = await inviteToSquad(alice.token, squad.id, bob.id);
    assert.strictEqual(status, 200, `invite failed: ${JSON.stringify(data)}`);
    assert.ok(data.ok, "invite not acknowledged");
    assert.ok(data.invitationId, "missing invitation id");
    const accept = await acceptSquadInvitation(bob.token, data.invitationId);
    assert.strictEqual(accept.status, 200, `accept failed: ${JSON.stringify(accept.data)}`);
    assert.strictEqual(accept.data.squadCode, squad.code);
    const details = await getSquad(alice.token, squad.code);
    assert.ok(details.members.map(m => String(m.userId)).includes(String(bob.id)), "bob is not in squad");
  });

  await test("un non-ami ne peut pas être invité dans une squad", async () => {
    const squad = await createSquad(alice.token, "Beta Squad");
    const { status } = await inviteToSquad(alice.token, squad.id, charlie.id);
    assert.strictEqual(status, 403, "non-friend should not be invitable");
  });

  await test("le QR d'escouade contient le lien d'adhésion et reste réservé aux membres", async () => {
    const squad = await createSquad(alice.token, "QR Squad");
    const res = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/qr`, { headers: auth(alice.token) });
    assert.strictEqual(res.status, 200, `squad QR failed: ${await res.text()}`);
    const data = await res.json();
    assert.strictEqual(data.code, squad.code);
    assert.ok(data.qr.startsWith("data:image/png;base64,"), "squad QR is not a base64 png");
    assert.ok(data.url.includes(`joinSquad=${encodeURIComponent(squad.code)}`), "squad QR URL has no join code");
    const forbidden = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/qr`, { headers: auth(charlie.token) });
    assert.strictEqual(forbidden.status, 403, "a non-member must not be able to generate a squad QR");
  });

  await test("une invitation en double est refusée", async () => {
    await sendFriendRequest(alice.token, charlie.id);
    await acceptFriendRequest(charlie.token, alice.id);
    const squad = await createSquad(alice.token, "Gamma Squad");
    const first = await inviteToSquad(alice.token, squad.id, charlie.id);
    assert.strictEqual(first.status, 200, `first invite failed: ${JSON.stringify(first.data)}`);
    const second = await inviteToSquad(alice.token, squad.id, charlie.id);
    assert.strictEqual(second.status, 409, "duplicate invite should be rejected");
  });

  await test("un membre de squad peut être ajouté comme ami", async () => {
    const dave = await register(`SqDave${rnd()}`), eve = await register(`SqEve${rnd()}`);
    try {
      const squad = await createSquad(dave.token, "Delta Squad");
      await joinSquad(eve.token, squad.code);
      assert.strictEqual(await friendshipStatus(dave.token, eve.id), "none", "should not already be friends");
      await sendFriendRequest(dave.token, eve.id);
      await acceptFriendRequest(eve.token, dave.id);
      assert.strictEqual(await friendshipStatus(dave.token, eve.id), "accepted", "friendship should be accepted");
    } finally { await cleanup(dave); await cleanup(eve); }
  });

  await test("une amitié n'est pas créée automatiquement en rejoignant une squad", async () => {
    const frank = await register(`SqFrank${rnd()}`), grace = await register(`SqGrace${rnd()}`);
    try {
      const squad = await createSquad(frank.token, "Echo Squad");
      await joinSquad(grace.token, squad.code);
      assert.strictEqual(await friendshipStatus(frank.token, grace.id), "none", "joining a squad should not create friendship");
    } finally { await cleanup(frank); await cleanup(grace); }
  });

  await test("les arrivées concurrentes ne peuvent pas dépasser dix membres", async () => {
    const owner = await register(`SqCapOwner${rnd()}`), joiners = [];
    try {
      for (let index = 0; index < 11; index++) joiners.push(await register(`SqCap${index}${rnd()}`));
      const squad = await createSquad(owner.token, "Capacity Lock Squad");
      const responses = await Promise.all(joiners.map(async joiner => {
        const res = await fetch(`${API}/squads/join`, { method: "POST", headers: auth(joiner.token), body: JSON.stringify({ code: squad.code }) });
        return { status: res.status, body: await res.json().catch(() => ({})) };
      }));
      const statuses = responses.map(result => result.status);
      assert.strictEqual(statuses.filter(status => status === 200).length, 9, `join statuses: ${statuses}`);
      assert.ok(statuses.every(status => status === 200 || status === 400), `unexpected join statuses: ${JSON.stringify(responses)}`);
      assert.strictEqual((await getSquad(owner.token, squad.code)).members.length, 10, "the squad must never exceed ten active members");
    } finally { await cleanup(owner); for (const joiner of joiners) await cleanup(joiner); }
  });

  await test("une invitation acceptée et une arrivée directe partagent le même verrou de capacité", async () => {
    const owner = await register(`SqMixOwner${rnd()}`), directJoiner = await register(`SqMixDirect${rnd()}`), invitee = await register(`SqMixInvitee${rnd()}`), fillers = [];
    try {
      await sendFriendRequest(owner.token, invitee.id);
      await acceptFriendRequest(invitee.token, owner.id);
      const squad = await createSquad(owner.token, "Mixed Capacity Lock Squad");
      for (let index = 0; index < 8; index++) { const filler = await register(`SqMixFill${index}${rnd()}`); fillers.push(filler); await joinSquad(filler.token, squad.code); }
      const invitation = await inviteToSquad(owner.token, squad.id, invitee.id);
      assert.strictEqual(invitation.status, 200, `invite failed: ${JSON.stringify(invitation.data)}`);
      const [directRes, invitationRes] = await Promise.all([
        fetch(`${API}/squads/join`, { method: "POST", headers: auth(directJoiner.token), body: JSON.stringify({ code: squad.code }) }),
        acceptSquadInvitation(invitee.token, invitation.data.invitationId)
      ]);
      const statuses = [directRes.status, invitationRes.status];
      assert.strictEqual(statuses.filter(status => status === 200).length, 1, `mixed capacity statuses: ${statuses}`);
      assert.ok(statuses.every(status => status === 200 || status === 400), `unexpected mixed capacity statuses: ${statuses}`);
      assert.strictEqual((await getSquad(owner.token, squad.code)).members.length, 10, "mixed joins must not exceed ten active members");
    } finally { await cleanup(owner); await cleanup(directJoiner); await cleanup(invitee); for (const filler of fillers) await cleanup(filler); }
  });
};
