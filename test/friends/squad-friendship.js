"use strict";

module.exports = async function runSquadFriendship(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("squad members expose friendship fields and friend can be invited", async () => {
    const salice = await register(`FrSquadAlice${rnd()}`);
    const sbob = await register(`FrSquadBob${rnd()}`);
    const sdave = await register(`FrSquadDave${rnd()}`);
    try {
      // Alice and Bob become friends.
      let res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(salice.token),
        body: JSON.stringify({ addresseeId: sbob.id })
      });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(sbob.token) });
      await okJson(res, "accept request");

      // Alice creates an open squad.
      res = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(salice.token),
        body: JSON.stringify({ name: "Test Squad" })
      });
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
      res = await fetch(`${API}/squad-invitations/${squadInvite.invitationId}/accept`, {
        method: "POST",
        headers: auth(sbob.token)
      });
      await okJson(res, "accept squad invitation");

      // Squad details now include friendship status fields for members.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(sbob.token) });
      const squadData = await okJson(res, "squad details");
      const aliceMember = squadData.members.find((m) => m.userId === salice.id);
      const bobMember = squadData.members.find((m) => m.userId === sbob.id);
      assert.ok(aliceMember, "alice missing from squad members");
      assert.ok(bobMember, "bob missing from squad members");
      assert.strictEqual(aliceMember.friendshipStatus, "accepted");
      assert.strictEqual(aliceMember.canReceiveFriendRequest, false);
      assert.strictEqual(bobMember.friendshipStatus, "me");
      assert.strictEqual(bobMember.canReceiveFriendRequest, false);

      // Non-friend Dave joins via code; it must not create a friendship.
      res = await fetch(`${API}/squads/join`, {
        method: "POST",
        headers: auth(sdave.token),
        body: JSON.stringify({ code })
      });
      await okJson(res, "join squad");
      res = await fetch(`${API}/friends`, { headers: auth(salice.token) });
      const friends = await okJson(res, "friend list");
      assert.ok(!friends.friends.some((f) => f.id === sdave.id), "joining squad created a friendship");

      // Dave sees Alice as a non-friend he can add.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(sdave.token) });
      const daveView = await okJson(res, "squad details from dave");
      const aliceFromDave = daveView.members.find((m) => m.userId === salice.id);
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
};
