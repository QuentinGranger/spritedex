const ctx = require("./shared");

module.exports = {
  name: "collection.status_changed (Étape 90)",
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
    const user = await register(`SgSt90${rnd()}`);
    const spriteId = `sg90s_${rnd()}`;
    const variantId = `sg90_${rnd()}`;
    const cat = "2026.07.18-1";

    // Seed as missing (existing entry).
    await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: true,
          changeId: `seed90_${variantId}`,
          newStatus: "missing"
        }
      ],
      { source: "api", catalogueVersion: cat }
    );

    // missing → priority
    const toPrio = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: false,
          historyId: 9001,
          previousStatus: "missing",
          newStatus: "priority",
          newPriority: "urgent"
        }
      ],
      { source: "api", catalogueVersion: cat }
    );
    const prioStatus = toPrio.find((e) => e.eventType === "collection.status_changed");
    assert.ok(prioStatus);
    assert.strictEqual(prioStatus.context.previousStatus, "missing");
    assert.strictEqual(prioStatus.context.oldStatus, "missing");
    assert.strictEqual(prioStatus.context.newStatus, "priority");
    assert.strictEqual(prioStatus.eventVersion, 1);
    assert.ok(toPrio.some((e) => e.eventType === "collection.priority_added"));

    // priority → owned
    const toOwned = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: false,
          historyId: 9002,
          previousStatus: "priority",
          newStatus: "owned",
          previousPriority: "urgent",
          newPriority: "urgent"
        }
      ],
      { source: "web", catalogueVersion: cat }
    );
    assert.strictEqual(toOwned.length, 1);
    assert.strictEqual(toOwned[0].eventType, "collection.status_changed");
    assert.strictEqual(toOwned[0].context.previousStatus, "priority");
    assert.strictEqual(toOwned[0].context.newStatus, "owned");
    assert.strictEqual(toOwned[0].source, "web");

    // owned → missing
    const toMissing = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: false,
          historyId: 9003,
          previousStatus: "owned",
          newStatus: "missing"
        }
      ],
      { source: "api", catalogueVersion: cat }
    );
    assert.strictEqual(toMissing.length, 1);
    assert.strictEqual(toMissing[0].context.previousStatus, "owned");
    assert.strictEqual(toMissing[0].context.newStatus, "missing");

    // owned → owned : aucun événement
    const noop = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: false,
          previousStatus: "owned",
          newStatus: "owned"
        }
      ],
      { source: "api" }
    );
    assert.strictEqual(noop.length, 0);

    // Historique conservé (append-only) — les 3 transitions restent.
    const hist = await pool.query(
      `SELECT context->>'previousStatus' AS prev, context->>'newStatus' AS next, occurred_at
       FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2
         AND event_type = 'collection.status_changed'
       ORDER BY recorded_at ASC`,
      [user.id, variantId]
    );
    assert.ok(hist.rows.length >= 3);
    const transitions = hist.rows.map((r) => `${r.prev}->${r.next}`);
    assert.ok(transitions.includes("missing->priority"));
    assert.ok(transitions.includes("priority->owned"));
    assert.ok(transitions.includes("owned->missing"));

    // UPDATE interdit sur graph_events (append-only).
    let updateBlocked = false;
    try {
      await pool.query(`UPDATE graph_events SET source = 'tamper' WHERE id = $1::uuid`, [toMissing[0].id]);
    } catch (_e) {
      updateBlocked = true;
    }
    assert.ok(updateBlocked, "historique status_changed doit rester immuable");

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 90"));
    assert.ok(doc.includes("owned → owned") || doc.includes("owned→owned"));
  }
};
