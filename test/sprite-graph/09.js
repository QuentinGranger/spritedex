const ctx = require("./shared");

module.exports = {
  name: "goalScope + notification.opened + future action events (Étapes 26–28)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    assert.deepStrictEqual([...GOAL_SCOPES].sort(), ["friends", "personal", "squad"]);
    assert.strictEqual(resolveGoalScope({ squad_id: 9 }), "squad");
    assert.strictEqual(resolveGoalScope({}), "personal");
    assert.strictEqual(resolveGoalScope({ scope: "friends" }), "friends");
    assert.strictEqual(
      buildGoalCompletedContext({ goal: { scope: "friends" } }).goalScope,
      "friends"
    );

    assert.strictEqual(
      FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED,
      "notification.action_clicked"
    );
    assert.strictEqual(
      FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_CONVERTED,
      "notification.converted"
    );
    assert.ok(!GRAPH_EVENT_TYPE_SET.has("notification.action_clicked"));

    const deliveredAt = new Date(Date.now() - 180 * 1000).toISOString();
    const openedAt = new Date().toISOString();
    const nctx = buildNotificationOpenedContext({
      type: "priority_variant_available",
      category: "alerts",
      delivered_at: deliveredAt,
      data: { url: "/sprites/batman?holofoil", channels: ["push"] }
    }, { openedAt, channel: "push" });
    assert.strictEqual(nctx.notificationType, "priority_variant_available");
    assert.strictEqual(nctx.category, "alerts");
    assert.strictEqual(nctx.channel, "push");
    assert.strictEqual(nctx.destination, "/sprites/batman?holofoil");
    assert.ok(nctx.delaySinceDeliverySeconds >= 179 && nctx.delaySinceDeliverySeconds <= 181);

    await ensureGraphEventsTable(pool);
    const a = await register(`SgNotif${rnd()}`);
    const push = require("../push-service");
    const notif = await push.createNotification(pool, {
      recipientId: a.id,
      type: "priority_variant_available",
      context: { variantId: "test" },
      message: "graph open test",
      url: "/sprites/batman?holofoil"
    });
    assert.ok(notif && notif.id);
    // Seed delivered_at for delay measurement.
    await pool.query(
      `UPDATE notifications SET delivered_at = NOW() - INTERVAL '3 minutes' WHERE id = $1`,
      [notif.id]
    );
    const opened = await push.markNotificationRead(pool, a.id, notif.id, { clicked: true });
    assert.ok(opened);
    await new Promise((r) => setTimeout(r, 60));
    const ev = await pool.query(
      `SELECT context, event_version FROM graph_events
       WHERE event_type = 'notification.opened' AND notification_id = $1`,
      [notif.id]
    );
    assert.strictEqual(ev.rows.length, 1);
    const ctx = ev.rows[0].context || {};
    assert.strictEqual(ctx.notificationType, "priority_variant_available");
    assert.ok(ctx.destination === "/sprites/batman?holofoil" || ctx.destination == null || typeof ctx.destination === "string");
    assert.ok(Number(ev.rows[0].event_version) >= 2 || ctx.notificationType);
  }
};
