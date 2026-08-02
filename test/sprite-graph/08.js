const ctx = require("./shared");

module.exports = {
  name: "squad.joined + goal.completed context builders (Étapes 23–25)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    await ensureGraphEventsTable(pool);
    const joined = buildSquadJoinedContext({
      inviterId: 7,
      memberRole: "member",
      memberCountAfterJoin: 5,
      collectiveCompletionBefore: 81.7,
      collectiveCompletionAfter: 85.4,
      newVariantsAddedToSquad: 3,
      sharedVariantsAdded: 41,
      joinSource: "friend_invitation"
    });
    assert.strictEqual(joined.inviterId, 7);
    assert.strictEqual(joined.newVariantsAddedToSquad, 3);
    assert.strictEqual(joined.sharedVariantsAdded, 41);

    const goalCtx = buildGoalCompletedContext({
      goal: {
        title: "Batman",
        squad_id: 1,
        created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        target_variant_ids: ["v1", "v2", "v3", "v4", "v5"]
      },
      actorUserId: 42,
      participantCount: 4,
      completedAt: new Date().toISOString()
    });
    assert.strictEqual(goalCtx.goalScope, "squad");
    assert.strictEqual(goalCtx.goalType, "event_completion");
    assert.strictEqual(goalCtx.participantCount, 4);
    assert.strictEqual(goalCtx.targetVariantCount, 5);
    assert.strictEqual(goalCtx.completedVariantCount, 5);
    assert.ok(goalCtx.durationDays >= 7 && goalCtx.durationDays <= 9);

    // Impact helper with empty previous squad → joiner variants all "new".
    const u = await register(`SgJoin${rnd()}`);
    const variantRes = await pool.query(`SELECT id FROM sprite_variants ORDER BY id LIMIT 2`);
    if (variantRes.rows.length >= 1) {
      await pool.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
         SELECT $1, v.id, v.sprite_id, 'owned'
         FROM sprite_variants v WHERE v.id = $2
         ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
        [u.id, variantRes.rows[0].id]
      );
      // Need a real squad id — create minimal squad if possible via API.
      const squadRes = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(u.token),
        body: JSON.stringify({ name: `SG${rnd()}` })
      });
      if (squadRes.ok) {
        const squad = await squadRes.json();
        const squadId = squad.id || squad.squad?.id;
        if (squadId) {
          const impact = await computeSquadJoinImpact(squadId, u.id, { previousMemberIds: [] });
          assert.ok(impact.memberCountAfterJoin >= 1);
          assert.ok(impact.newVariantsAddedToSquad >= 0);
          assert.strictEqual(impact.sharedVariantsAdded, 0);
        }
      }
    }
  }
};
