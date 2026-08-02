const ctx = require("./shared");

module.exports = {
  name: "table append-only + variantes (Étapes 4–5)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    await ensureGraphEventsTable(pool);
    const cols = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'graph_events'
    `);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r.data_type]));
    assert.ok(byName.id);
    assert.ok(byName.event_type);
    assert.ok(byName.deduplication_key);
    assert.ok(byName.variant_id);
    assert.ok(byName.sprite_id);
    assert.ok(byName.actor_user_id === "integer" || byName.actor_user_id === "bigint");
    assert.ok(byName.squad_id === "integer" || byName.squad_id === "bigint");

    // Dedup: same key inserts nothing twice
    const once = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: 1,
      spriteId: "s",
      variantId: "v",
      source: "api",
      deduplicationKey: `test-dedup-table-${rnd()}`
    });
    const key = once.deduplicationKey;
    const twice = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: 1,
      spriteId: "s",
      variantId: "v",
      source: "api",
      deduplicationKey: key
    });
    assert.ok(once);
    assert.strictEqual(twice, null);

    // Unknown event type ignored
    const ignored = await recordGraphEvent(pool, {
      eventType: "collection.unknown_future",
      actorUserId: 1,
      source: "api"
    });
    assert.strictEqual(ignored, null);
  }
};
