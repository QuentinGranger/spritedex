"use strict";

module.exports = async function runSquadInvitations(ctx) {
  const { assert, API, test, rnd, register, auth, cleanup, setVisibility, setEntry, becomeFriends, okJson } = ctx;

  await test("squad invitations can be declined or accepted on canonical path", async () => {
    const alice = await register(`FrInvAlice${rnd()}`);
    const bob = await register(`FrInvBob${rnd()}`);
    try {
      let res = await fetch(`${API}/friends/requests`, {
        method: "POST",
        headers: auth(alice.token),
        body: JSON.stringify({ addresseeId: bob.id })
      });
      const { requestId } = await okJson(res, "friend request");
      res = await fetch(`${API}/friends/requests/${requestId}/accept`, { method: "POST", headers: auth(bob.token) });
      await okJson(res, "accept request");

      res = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(alice.token),
        body: JSON.stringify({ name: "Canonical Squad" })
      });
      const { code } = await okJson(res, "create squad");

      res = await fetch(`${API}/squads/${code}/invite/${bob.id}`, { method: "POST", headers: auth(alice.token) });
      const { invitationId } = await okJson(res, "invite bob");

      // Bob declines via canonical path.
      res = await fetch(`${API}/squads/invitations/${invitationId}/decline`, {
        method: "POST",
        headers: auth(bob.token)
      });
      await okJson(res, "decline invitation");

      // Bob no longer has pending invitations.
      res = await fetch(`${API}/squad-invitations`, { headers: auth(bob.token) });
      const declinedList = await okJson(res, "list invitations after decline");
      assert.strictEqual(declinedList.invitations.length, 0, "declined invitation still pending");

      // Alice invites Bob again.
      res = await fetch(`${API}/squads/${code}/invite/${bob.id}`, { method: "POST", headers: auth(alice.token) });
      const { invitationId: newInvitationId } = await okJson(res, "re-invite bob");

      // Bob accepts via canonical path.
      res = await fetch(`${API}/squads/invitations/${newInvitationId}/accept`, {
        method: "POST",
        headers: auth(bob.token)
      });
      const acceptData = await okJson(res, "accept via canonical path");
      assert.strictEqual(acceptData.squadCode, code);

      // Squad stats are populated.
      res = await fetch(`${API}/squads/${code}`, { headers: auth(bob.token) });
      const squadData = await okJson(res, "squad details after accept");
      assert.ok(typeof squadData.collectiveCompletionRate === "number", "collective completion missing");
      assert.ok(Array.isArray(squadData.recommendations), "recommendations missing");
    } finally {
      await cleanup(alice);
      await cleanup(bob);
    }
  });
};
