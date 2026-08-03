const ctx = require("./shared");

module.exports = {
  name: "contrat : 8 événements stables + doc (Étapes 1–3)",
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
    const expected = [
      "collection.sprite_added",
      "collection.status_changed",
      "collection.priority_added",
      "comparison.completed",
      "friend_invitation.sent",
      "squad.joined",
      "goal.completed",
      "notification.opened"
    ];
    assert.strictEqual(GRAPH_EVENT_TYPE_SET.size, 8);
    for (const type of expected) {
      assert.ok(GRAPH_EVENT_TYPE_SET.has(type), `missing ${type}`);
    }
    assert.strictEqual(GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED, "collection.sprite_added");
    assert.deepStrictEqual([...GRAPH_INTERACTION_EVENT_TYPE_SET].sort(), [
      "comparison.filter_applied",
      "notification.action_clicked",
      "notification.converted",
      "recommendation.clicked"
    ]);
    assert.strictEqual(GRAPH_INTERACTION_EVENT_TYPES.RECOMMENDATION_CLICKED, "recommendation.clicked");

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Neo4j"));
    assert.ok(doc.includes("graph_events"));
    for (const type of expected) assert.ok(doc.includes(type), `doc missing ${type}`);
  }
};
