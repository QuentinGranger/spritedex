const ctx = require("./shared");

module.exports = {
  name: "outbox + privacy + anonymisation (Étapes 31–35)",
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
    stopGraphOutboxWorker();

    // Étape 33 — PII stripped from context.
    const clean = sanitizeGraphContext({
      invitationMethod: "username",
      email: "secret@example.com",
      note: "ma note privée",
      blockReason: "spam",
      accessToken: "eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
      nested: { ipAddress: "1.2.3.4", ok: true }
    });
    assert.strictEqual(clean.invitationMethod, "username");
    assert.strictEqual(clean.email, undefined);
    assert.strictEqual(clean.note, undefined);
    assert.strictEqual(clean.blockReason, undefined);
    assert.strictEqual(clean.accessToken, undefined);
    assert.strictEqual(clean.nested.ipAddress, undefined);
    assert.strictEqual(clean.nested.ok, true);

    // Étape 34–35 — levels + threshold.
    assert.strictEqual(GRAPH_DATA_LEVELS.RAW_PRIVATE, "raw_private");
    assert.strictEqual(PUBLIC_ANONYMIZATION_MIN_USERS, 20);
    const gated = applyPublicAnonymizationGate({ uniqueUserCount: 3, payload: { count: 10 } });
    assert.strictEqual(gated.ok, false);
    assert.strictEqual(gated.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);
    assert.strictEqual(applyPublicAnonymizationGate({ uniqueUserCount: 20, payload: { count: 10 } }).ok, true);

    const user = await register(`SgObx${rnd()}`);
    const ev = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: user.id,
      spriteId: "sp_test",
      variantId: `var_obx_${rnd()}`,
      source: "api",
      origin: "test.outbox",
      context: {
        newStatus: "owned",
        email: "leak@example.com",
        note: "should not persist"
      },
      deduplicationKey: `test-outbox-${rnd()}`
    });
    assert.ok(ev && ev.id);
    assert.strictEqual(ev.context.email, undefined);
    assert.strictEqual(ev.context.note, undefined);
    assert.strictEqual(ev.context.newStatus, "owned");

    const outbox = await pool.query(`SELECT status FROM event_outbox WHERE graph_event_id = $1::uuid`, [ev.id]);
    assert.strictEqual(outbox.rows.length, 1);
    assert.strictEqual(outbox.rows[0].status, "pending");

    // Drain until our row is processed (reset availability in case of retry backoff).
    let status = "pending";
    for (let i = 0; i < 30 && status !== "processed" && status !== "failed"; i++) {
      await pool.query(
        `UPDATE event_outbox
         SET status = 'pending', available_at = NOW() - INTERVAL '1 second'
         WHERE graph_event_id = $1::uuid AND status IN ('pending', 'processing')`,
        [ev.id]
      );
      await processGraphEventOutbox(pool, { limit: 200 });
      const processed = await pool.query(
        `SELECT status, error_message FROM event_outbox WHERE graph_event_id = $1::uuid`,
        [ev.id]
      );
      status = processed.rows[0]?.status || "missing";
      if (status === "failed") {
        throw new Error(`outbox failed: ${processed.rows[0].error_message}`);
      }
    }
    assert.strictEqual(status, "processed");

    const internal = await getGraphAggregate(pool, {
      level: GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL,
      metricKey: "events.collection.sprite_added"
    });
    assert.ok(internal);
    assert.ok(Number(internal.value.count) >= 1);

    const pub = await getGraphAggregate(pool, {
      level: GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC,
      metricKey: "events.collection.sprite_added"
    });
    assert.ok(pub);
    // With few unique users, public surface must be insufficient.
    if ((pub.uniqueUserCount || 0) < PUBLIC_ANONYMIZATION_MIN_USERS) {
      assert.strictEqual(pub.insufficient, true);
      assert.strictEqual(pub.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);
    }
  }
};
