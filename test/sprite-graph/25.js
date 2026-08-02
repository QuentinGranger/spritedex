const ctx = require("./shared");

module.exports = {
  name: "événements sociaux (Étape 91)",
  async run() {
    const {  } = ctx;
    await ensureGraphEventsTable(pool);
    const { applyFriendAction } = require("../server/friends/state-machine");

    const a = await register(`SgSocA${rnd()}`);
    const b = await register(`SgSocB${rnd()}`);
    const c = await register(`SgSocC${rnd()}`);

    // Invitation envoyée.
    const invited = await applyFriendAction(a.id, b.id, "request", {
      invitationMethod: "username",
      origin: "test.etape91"
    });
    assert.ok(invited.ok, invited.message || "invite failed");
    await new Promise((r) => setTimeout(r, 80));
    const invCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND target_user_id = $2
         AND event_type = 'friend_invitation.sent'`,
      [a.id, b.id]
    );
    assert.strictEqual(invCount.rows[0].n, 1);

    // Invitation en double refusée — pas de second événement.
    const dup = await applyFriendAction(a.id, b.id, "request", {
      invitationMethod: "username",
      origin: "test.etape91.dup"
    });
    assert.ok(dup.error === 409 || dup.ok === false);
    const invCount2 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND target_user_id = $2
         AND event_type = 'friend_invitation.sent'`,
      [a.id, b.id]
    );
    assert.strictEqual(invCount2.rows[0].n, 1);

    // Blocage respecté — pas d’invitation ni d’événement.
    const blockRes = await fetch(`${API}/users/${c.id}/block`, {
      method: "POST",
      headers: auth(a.token)
    });
    if (!blockRes.ok) throw new Error(`block failed: ${await blockRes.text()}`);
    const blockedInvite = await applyFriendAction(c.id, a.id, "request", {
      invitationMethod: "username",
      origin: "test.etape91.block"
    });
    assert.ok(blockedInvite.error === 403 || blockedInvite.ok === false);
    const blockedEv = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND target_user_id = $2
         AND event_type = 'friend_invitation.sent'`,
      [c.id, a.id]
    );
    assert.strictEqual(blockedEv.rows[0].n, 0);

    // Entrée dans une squad → squad.joined.
    const owner = await register(`SgSocOwn${rnd()}`);
    const joiner = await register(`SgSocJoin${rnd()}`);
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Soc${rnd()}` })
    });
    if (!squadRes.ok) throw new Error(`create squad: ${await squadRes.text()}`);
    const squad = await squadRes.json();
    const code = squad.code || squad.squad?.code;
    assert.ok(code);
    const joinRes = await fetch(`${API}/squads/join`, {
      method: "POST",
      headers: auth(joiner.token),
      body: JSON.stringify({ code })
    });
    if (!joinRes.ok) throw new Error(`join squad: ${await joinRes.text()}`);
    await new Promise((r) => setTimeout(r, 120));
    const joinEv = await pool.query(
      `SELECT context, squad_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'squad.joined'
       ORDER BY recorded_at DESC LIMIT 1`,
      [joiner.id]
    );
    assert.strictEqual(joinEv.rows.length, 1);
    assert.ok(
      joinEv.rows[0].context?.joinSource === "join_code"
        || joinEv.rows[0].context?.memberRole
    );

    // Comparaison comptée une seule fois.
    const result = {
      summary: {
        catalogueVariantCount: 10,
        insufficientData: false,
        collectiveCompletionRate: 40,
        complementarityRate: 20,
        onlyUserACount: 1,
        onlyUserBCount: 2,
        bothOwnedCount: 3,
        bothMissingCount: 4
      }
    };
    const first = await recordParticipantComparisonSession({
      requesterId: a.id,
      userAId: a.id,
      userBId: b.id,
      source: "friends_list",
      catalogueVersion: "2026.07.18-1",
      result
    });
    assert.ok(first.counted);
    const second = await recordParticipantComparisonSession({
      requesterId: b.id,
      userAId: a.id,
      userBId: b.id,
      source: "friends_list",
      catalogueVersion: "2026.07.18-1",
      result
    });
    assert.strictEqual(second.counted, false);
    assert.strictEqual(second.skippedReason, "deduped");

    // Données privées non exposées.
    const scrubbed = sanitizeGraphContext({
      email: "secret@example.com",
      note: "privé",
      blockReason: "spam",
      invitationMethod: "username",
      catalogueVersion: "keep"
    });
    assert.strictEqual(scrubbed.email, undefined);
    assert.strictEqual(scrubbed.note, undefined);
    assert.strictEqual(scrubbed.blockReason, undefined);
    assert.strictEqual(scrubbed.catalogueVersion, "keep");
    const metrics = await getFriendInvitationPublicMetrics(pool);
    assert.strictEqual(metrics.actorUserId, undefined);
    assert.strictEqual(metrics.targetUserId, undefined);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 91"));
  }
};
