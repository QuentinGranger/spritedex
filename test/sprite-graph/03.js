const ctx = require("./shared");

module.exports = {
  name: "collection events : ajout / statut / no-op / dédup (Étapes 11–15)",
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
    const user = await register(`SgSem${rnd()}`);
    const variantId = `sg_sem_${rnd()}`;
    const spriteId = `sg_sprite_${rnd()}`;

    assert.strictEqual(
      buildDeduplicationKey("collection.sprite_added", user.id, variantId, "entry_123"),
      `collection.sprite_added:${user.id}:${variantId}:entry_123`
    );

    // Étape 12–13 + 16 — first creation as priority → sprite_added + priority_added
    const created = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: true,
          entryId: 123,
          changeId: "entry_123",
          newStatus: "priority",
          newPriority: "urgent"
        }
      ],
      { source: "web", catalogueVersion: "2026.07.18-1" }
    );
    assert.strictEqual(created.length, 2);
    assert.strictEqual(created[0].eventType, "collection.sprite_added");
    assert.strictEqual(created[0].eventVersion, 1);
    assert.strictEqual(created[0].source, "web");
    assert.strictEqual(created[0].context.newStatus, "priority");
    assert.strictEqual(created[1].eventType, "collection.priority_added");
    assert.strictEqual(created[1].context.previousStatus, "absent");
    assert.strictEqual(created[1].context.priorityLevel, "urgent");

    // Later owned transition → status_changed only (not sprite_added)
    const statusRows = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: false,
          historyId: 99,
          previousStatus: "priority",
          newStatus: "owned",
          previousPriority: "urgent",
          newPriority: "urgent"
        }
      ],
      { source: "api", catalogueVersion: "2026.07.18-1" }
    );
    assert.strictEqual(statusRows.length, 1);
    assert.strictEqual(statusRows[0].eventType, "collection.status_changed");
    assert.strictEqual(statusRows[0].context.previousStatus, "priority");
    assert.strictEqual(statusRows[0].context.newStatus, "owned");
    assert.ok(!statusRows.some((r) => r.eventType === "collection.sprite_added"));

    // Étape 16 — missing → priority emits status_changed + priority_added
    const prioRows = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId: `${variantId}_b`,
          spriteId,
          isNewEntry: false,
          historyId: 100,
          previousStatus: "missing",
          newStatus: "priority",
          newPriority: "important",
          eventId: "event_hot_bat_summer"
        }
      ],
      { source: "api" }
    );
    const prioTypes = prioRows.map((r) => r.eventType).sort();
    assert.deepStrictEqual(prioTypes, ["collection.priority_added", "collection.status_changed"]);
    const prioEv = prioRows.find((r) => r.eventType === "collection.priority_added");
    assert.strictEqual(prioEv.context.previousStatus, "missing");
    assert.strictEqual(prioEv.context.priorityLevel, "important");
    assert.strictEqual(prioEv.context.eventId, "event_hot_bat_summer");

    // Étape 15 — no-op
    const noop = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: false,
          previousStatus: "owned",
          newStatus: "owned",
          previousPriority: "none",
          newPriority: "none"
        }
      ],
      { source: "api" }
    );
    assert.strictEqual(noop.length, 0);

    // Dedup retry of same sprite_added key
    const retry = await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId,
          spriteId,
          isNewEntry: true,
          changeId: "entry_123",
          newStatus: "owned"
        }
      ],
      { source: "web" }
    );
    assert.strictEqual(retry.length, 0);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 11"));
    assert.ok(doc.includes("Étape 15"));
    assert.ok(doc.includes("Étape 16"));
    assert.ok(doc.includes("première création"));

    // Étape 17 — historical adds ≠ current state
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority)
       VALUES ($1, $2, $3, 'priority', '', 'urgent')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'priority'`,
      [user.id, `${variantId}_cur`, spriteId]
    );
    // Simulate missing→priority→missing→priority (2 historical adds already have 1 from prioRows + maybe create)
    await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId: `${variantId}_hist`,
          spriteId,
          isNewEntry: false,
          historyId: 201,
          previousStatus: "missing",
          newStatus: "priority",
          newPriority: "urgent"
        }
      ],
      { source: "api" }
    );
    await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId: `${variantId}_hist`,
          spriteId,
          isNewEntry: false,
          historyId: 202,
          previousStatus: "priority",
          newStatus: "missing"
        }
      ],
      { source: "api" }
    );
    await recordCollectionGraphEvents(
      user.id,
      [
        {
          variantId: `${variantId}_hist`,
          spriteId,
          isNewEntry: false,
          historyId: 203,
          previousStatus: "missing",
          newStatus: "priority",
          newPriority: "urgent"
        }
      ],
      { source: "api" }
    );
    const metrics = await getPriorityInterestMetrics(pool, { days: 30 });
    assert.ok(metrics.currentPriorities >= 1);
    assert.ok(metrics.historicalPriorityAdds >= 2);
    assert.ok(metrics.uniqueUsersWhoPrioritized >= 1);
  }
};
