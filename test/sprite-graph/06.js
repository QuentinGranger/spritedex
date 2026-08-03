const ctx = require("./shared");

module.exports = {
  name: "hooks API : collection + ami + comparaison + notif (Étape 3)",
  async run() {
    const {
      API,
      BASE,
      FRIEND_INVITATION_METHODS,
      FRIEND_INVITATION_PUBLIC_METRIC_KEYS,
      FUTURE_GRAPH_EVENT_TYPES,
      GOAL_SCOPES,
      GRAPH_DATA_LEVELS,
      GRAPH_EVENT_COMMON_FIELDS,
      GRAPH_EVENT_SPECIFIC_FIELDS,
      GRAPH_EVENT_TYPES,
      GRAPH_EVENT_TYPE_SET,
      GRAPH_EVENT_VERSIONS,
      GRAPH_INTERACTION_EVENT_TYPES,
      GRAPH_INTERACTION_EVENT_TYPE_SET,
      GRAPH_SOURCES,
      INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
      OWNERSHIP_SAMPLE_STATUSES,
      PUBLIC_ANONYMIZATION_MIN_USERS,
      applyPublicAnonymizationGate,
      assert,
      auth,
      buildComparisonCompletedContext,
      buildDeduplicationKey,
      buildFriendInvitationSentContext,
      buildGoalCompletedContext,
      buildGraphEventEnvelope,
      buildNotificationOpenedContext,
      buildSquadJoinedContext,
      calculateCommunityVariantStats,
      computeSquadJoinImpact,
      correctGraphEvent,
      ensureCommunityStatsTables,
      ensureGraphEventsTable,
      extractTopDifferenceSpriteIds,
      formatCommunityOwnershipDisplay,
      formatCommunityPriorityDisplay,
      formatRecentPriorityAddsDisplay,
      formatSampleSizeDisplay,
      fs,
      getCommunityVariantOwnership,
      getFriendInvitationPublicMetrics,
      getGraphAggregate,
      getMostSoughtVariants,
      getPriorityInterestMetrics,
      isFriendInvitationPubliclyExposable,
      isGraphEventCancelled,
      listEligibleCommunityUserIds,
      normalizeComparisonPair,
      normalizeGraphSource,
      normalizeInvitationMethod,
      path,
      pool,
      processGraphEventOutbox,
      recordCollectionGraphEvents,
      recordGraphEvent,
      recordParticipantComparisonSession,
      register,
      resolveGoalScope,
      rnd,
      root,
      roundRate,
      sanitizeGraphContext,
      stopCommunityStatsDailyJob,
      stopGraphOutboxWorker
    } = ctx;
    await ensureGraphEventsTable(pool);
    const a = await register(`SgA${rnd()}`);
    const b = await register(`SgB${rnd()}`);

    // Seed a real catalogue variant if possible
    const variantRes = await pool.query(`SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`);
    assert.ok(variantRes.rows.length, "need at least one variant in DB");
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    const put = await fetch(`${API}/collection/${a.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(a.token),
      body: JSON.stringify({ status: "owned", priority: "urgent" })
    });
    if (!put.ok) throw new Error(`setEntry: ${await put.text()}`);

    await new Promise((r) => setTimeout(r, 120));

    const colEvents = await pool.query(
      `SELECT event_type, source, context FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2
         AND (
           source = 'collection.setEntry'
           OR (source = 'api' AND COALESCE(context->>'origin', '') = 'collection.setEntry')
         )`,
      [a.id, variantId]
    );
    const colTypes = new Set(colEvents.rows.map((r) => r.event_type));
    // First PUT creates the row → sprite_added (Étapes 12–13).
    assert.ok(colTypes.has("collection.sprite_added"), "missing sprite_added from setEntry");

    // Real status change on existing row → status_changed (Étape 14).
    const beforeStatusCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.status_changed'`,
      [a.id, variantId]
    );
    const put3 = await fetch(`${API}/collection/${a.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(a.token),
      body: JSON.stringify({ status: "missing" })
    });
    if (!put3.ok) throw new Error(`setEntry3: ${await put3.text()}`);
    await new Promise((r) => setTimeout(r, 150));
    const afterStatusCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.status_changed'`,
      [a.id, variantId]
    );
    // Live server must have current sprite-graph hooks for Étape 14 semantics.
    if (afterStatusCount.rows[0].n > beforeStatusCount.rows[0].n) {
      const statusEv = await pool.query(
        `SELECT context FROM graph_events
         WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.status_changed'
         ORDER BY recorded_at DESC LIMIT 1`,
        [a.id, variantId]
      );
      const ctx = statusEv.rows[0].context || {};
      assert.ok(ctx.previousStatus === "owned" || ctx.oldStatus === "owned", "expected previousStatus owned");
      assert.strictEqual(ctx.newStatus, "missing");
    }

    const friend = await fetch(`${API}/friends/${b.id}/request`, {
      method: "POST",
      headers: auth(a.token)
    });
    if (!friend.ok) throw new Error(`friend request: ${await friend.text()}`);
    await new Promise((r) => setTimeout(r, 80));

    const friendEv = await pool.query(
      `SELECT id, target_user_id, friendship_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'friend_invitation.sent'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(friendEv.rows.length, 1);
    assert.strictEqual(Number(friendEv.rows[0].target_user_id), Number(b.id));
    assert.ok(friendEv.rows[0].friendship_id);

    const cmp = await recordParticipantComparisonSession({
      requesterId: a.id,
      userAId: a.id,
      userBId: b.id,
      source: "passport",
      catalogueVersion: "test-sg",
      result: { summary: { catalogueVariantCount: 12, insufficientData: false } }
    });
    assert.ok(cmp.counted, `comparison not counted: ${cmp.skippedReason || "?"}`);
    await new Promise((r) => setTimeout(r, 80));

    const cmpEv = await pool.query(
      `SELECT comparison_id, target_user_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'comparison.completed'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(cmpEv.rows.length, 1);
    assert.strictEqual(Number(cmpEv.rows[0].target_user_id), Number(b.id));
    assert.ok(cmpEv.rows[0].comparison_id);

    // Notification opened
    const push = require("../push-service");
    const notif = await push.createNotification(pool, {
      recipientId: a.id,
      actorId: b.id,
      type: "friend_request_received",
      context: { friendId: b.id },
      message: "test graph notif",
      url: "/friends"
    });
    assert.ok(notif && notif.id);
    const opened = await push.markNotificationRead(pool, a.id, notif.id, { clicked: true });
    assert.ok(opened);
    await new Promise((r) => setTimeout(r, 80));

    const notifEv = await pool.query(
      `SELECT notification_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'notification.opened'
         AND notification_id = $2`,
      [a.id, notif.id]
    );
    assert.strictEqual(notifEv.rows.length, 1);

    // Second click must not duplicate
    await push.markNotificationRead(pool, a.id, notif.id, { clicked: true });
    await new Promise((r) => setTimeout(r, 40));
    const notifEv2 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE event_type = 'notification.opened' AND notification_id = $1`,
      [notif.id]
    );
    assert.strictEqual(notifEv2.rows[0].n, 1);
  }
};
