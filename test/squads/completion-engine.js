const { assert, API, test, rnd, register, auth, cleanup, createSquad, sendFriendRequest, acceptFriendRequest, inviteToSquad, acceptSquadInvitation, getVariantSamples, resetCollection, setEntry } = require("./shared");

module.exports = async function runCompletionEngine() {
  await test("Squad Completion Engine report + simulate (contrat moteur)", async () => {
    const owner = await register(`EngOwn${rnd()}`), mate = await register(`EngMate${rnd()}`);
    try {
      await sendFriendRequest(owner.token, mate.id);
      await acceptFriendRequest(mate.token, owner.id);
      const squad = await createSquad(owner.token, "Engine Squad");
      const invite = await inviteToSquad(owner.token, squad.id, mate.id);
      assert.strictEqual(invite.status, 200, `invite failed: ${JSON.stringify(invite.data)}`);
      const accept = await acceptSquadInvitation(mate.token, invite.data.invitationId);
      assert.strictEqual(accept.status, 200, `accept failed: ${JSON.stringify(accept.data)}`);
      const samples = await getVariantSamples(owner.token);
      const uniqueVariant = samples.activeId, missingVariant = samples.secondActiveId || samples.activeIds[1];
      assert.ok(missingVariant, "need a second active variant for simulate");
      await resetCollection(owner.token, owner.id); await resetCollection(mate.token, mate.id);
      await setEntry(owner.token, owner.id, uniqueVariant, "owned");
      const reportRes = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/completion/report`, { headers: auth(owner.token) });
      if (!reportRes.ok) assert.fail(`completion/report failed: ${await reportRes.text()}`);
      const report = await reportRes.json();
      for (const field of ["engineVersion", "catalogueVersion", "summary", "analysis", "recommendations", "optimization"]) assert.ok(report[field], `${field} required`);
      assert.ok(report.analysis.mostComplementaryMember, "mostComplementaryMember required");
      assert.strictEqual(typeof report.analysis.mostComplementaryMember.uniqueVariantCount, "number", "mostComplementaryMember.uniqueVariantCount must be a number");
      assert.ok(Array.isArray(report.analysis.uniqueOwners?.byMember), "uniqueOwners.byMember required");
      assert.ok(report.analysis.uniqueOwners.byMember.some(m => String(m.userId) === String(owner.id) && m.count >= 1), "owner should appear in uniqueOwners.byMember");
      assert.ok(Array.isArray(report.recommendations.priorities), "priorities required");
      if (report.recommendations.priorities.length) {
        const p = report.recommendations.priorities[0];
        assert.ok(typeof p.display === "string" && p.display.length > 0, "priority.display required");
        assert.strictEqual(typeof p.collectiveCoverageDelta, "number", "priority.collectiveCoverageDelta required");
      }
      assert.ok(report.recommendations.plan, "recommendations.plan required");
      assert.ok(Array.isArray(report.recommendations.plan.members), "plan.members required");
      assert.ok(Array.isArray(report.recommendations.assignments), "assignments required");
      const beforeRate = report.summary.collectiveCompletionRate;
      const simulateUrl = `${API}/squads/${encodeURIComponent(squad.code)}/completion/simulate`;
      const simRes = await fetch(simulateUrl, { method: "POST", headers: auth(owner.token), body: JSON.stringify({ changes: [{ type: "acquire", memberId: mate.id, variantIds: [missingVariant] }] }) });
      if (!simRes.ok) assert.fail(`completion/simulate failed: ${await simRes.text()}`);
      const sim = await simRes.json();
      assert.ok(sim.before && sim.after && sim.difference, "simulate must return before/after/difference");
      assert.strictEqual(typeof sim.before.completionRate, "number"); assert.strictEqual(typeof sim.after.completionRate, "number"); assert.strictEqual(typeof sim.difference.completionRate, "number");
      assert.ok(sim.after.coveredCount >= sim.before.coveredCount, "acquiring a missing variant should not reduce covered count");
      assert.ok(Math.abs(Number(sim.before.completionRate) - Number(beforeRate)) < 0.02, `simulate before (${sim.before.completionRate}) should match report (${beforeRate})`);
      const oversizedChanges = await fetch(simulateUrl, { method: "POST", headers: auth(owner.token), body: JSON.stringify({ changes: Array.from({ length: 21 }, () => ({ type: "acquire", memberId: mate.id, variantIds: [missingVariant] })) }) });
      assert.strictEqual(oversizedChanges.status, 400, `oversized simulation should fail: ${await oversizedChanges.text()}`);
      const oversizedVariants = await fetch(simulateUrl, { method: "POST", headers: auth(owner.token), body: JSON.stringify({ changes: [{ type: "acquire", memberId: mate.id, variantIds: Array(101).fill(missingVariant) }] }) });
      assert.strictEqual(oversizedVariants.status, 400, `oversized variant list should fail: ${await oversizedVariants.text()}`);
      const malformedKick = await fetch(`${API}/squads/${encodeURIComponent(squad.code)}/kick`, { method: "POST", headers: auth(owner.token), body: JSON.stringify({ targetUserId: "not-a-user-id" }) });
      assert.strictEqual(malformedKick.status, 400, `malformed targetUserId should fail: ${await malformedKick.text()}`);
    } finally { await cleanup(owner); await cleanup(mate); }
  });
};
