const ctx = require("./shared");

module.exports = {
  name: "friend_invitation.sent : méthodes + agrégats publics (Étapes 21–22)",
  async run() {
    const {  } = ctx;
    await ensureGraphEventsTable(pool);
    assert.ok(FRIEND_INVITATION_METHODS.includes("username"));
    assert.strictEqual(normalizeInvitationMethod("qr"), "qr_code");
    assert.strictEqual(normalizeInvitationMethod("username_search"), "username");
    assert.strictEqual(isFriendInvitationPubliclyExposable(), false);

    const ctx = buildFriendInvitationSentContext({
      invitationMethod: "passport",
      invitationSource: "passport"
    });
    assert.strictEqual(ctx.invitationMethod, "passport");
    assert.strictEqual(ctx.invitationSource, "passport");

    const a = await register(`SgInvA${rnd()}`);
    const b = await register(`SgInvB${rnd()}`);
    // Exercise current module (not necessarily the live process).
    const { applyFriendAction } = require("../server/friends/state-machine");
    const outcome = await applyFriendAction(a.id, b.id, "request", {
      invitationMethod: "passport",
      invitationSource: "passport",
      origin: "friends.request"
    });
    assert.ok(outcome.ok, outcome.message || "request failed");
    await new Promise((r) => setTimeout(r, 80));

    const friendEv = await pool.query(
      `SELECT context, event_version FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'friend_invitation.sent'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(friendEv.rows.length, 1);
    const fctx = friendEv.rows[0].context || {};
    assert.strictEqual(fctx.invitationMethod, "passport");
    assert.strictEqual(fctx.invitationSource, "passport");
    assert.ok(Number(friendEv.rows[0].event_version) >= 2);

    const metrics = await getFriendInvitationPublicMetrics(pool);
    for (const key of FRIEND_INVITATION_PUBLIC_METRIC_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(metrics, key), `missing ${key}`);
    }
    assert.ok(typeof metrics.totalInvitationsSent === "number");
    assert.ok(metrics.acceptanceRate >= 0 && metrics.acceptanceRate <= 1);
    // Public payload must not include identity fields.
    assert.strictEqual(metrics.actorUserId, undefined);
    assert.strictEqual(metrics.targetUserId, undefined);
    assert.strictEqual(metrics.pendingCount, undefined);
  }
};
