const ctx = require("./shared");

module.exports = {
  name: "comparison : contexte, paire, anti-reload (Étapes 18–20)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    await ensureGraphEventsTable(pool);
    const pair = normalizeComparisonPair(10, 3);
    assert.deepStrictEqual(pair, {
      pairUserLowId: 3,
      pairUserHighId: 10,
      pairKey: "comparison_pair:3:10"
    });
    assert.deepStrictEqual(normalizeComparisonPair(3, 10), pair);
    assert.strictEqual(normalizeComparisonPair(5, 5), null);

    const ctx = buildComparisonCompletedContext({
      actorUserId: 10,
      targetUserId: 3,
      userAId: 3,
      userBId: 10,
      catalogueVersion: "2026.07.18-1",
      result: {
        summary: {
          collectiveCompletionRate: 79.27,
          complementarityRate: 20,
          onlyUserACount: 5,
          onlyUserBCount: 8,
          bothOwnedCount: 52,
          bothMissingCount: 17
        }
      }
    });
    // Actor is user B (10) → onlyActor = onlyUserB
    assert.strictEqual(ctx.onlyActorCount, 8);
    assert.strictEqual(ctx.onlyTargetCount, 5);
    assert.strictEqual(ctx.bothOwnedCount, 52);
    assert.strictEqual(ctx.pairKey, "comparison_pair:3:10");
    assert.strictEqual(ctx.collectiveCompletionRate, 79.27);

    const a = await register(`SgCmpA${rnd()}`);
    const b = await register(`SgCmpB${rnd()}`);
    const result = {
      summary: {
        catalogueVariantCount: 20,
        insufficientData: false,
        collectiveCompletionRate: 50,
        complementarityRate: 10,
        onlyUserACount: 2,
        onlyUserBCount: 3,
        bothOwnedCount: 4,
        bothMissingCount: 5
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
    await new Promise((r) => setTimeout(r, 80));

    const ev = await pool.query(
      `SELECT context, source, comparison_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'comparison.completed'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(ev.rows.length, 1);
    assert.strictEqual(ev.rows[0].context.pairKey, `comparison_pair:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`);
    assert.strictEqual(ev.rows[0].context.bothOwnedCount, 4);
    assert.ok(ev.rows[0].comparison_id);

    // Étape 19 — reload within window is not counted again
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

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE event_type = 'comparison.completed'
         AND (
           (actor_user_id = $1 AND target_user_id = $2)
           OR (actor_user_id = $2 AND target_user_id = $1)
         )`,
      [a.id, b.id]
    );
    assert.strictEqual(count.rows[0].n, 1);
  }
};
