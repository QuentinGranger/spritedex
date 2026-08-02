const ctx = require("./shared");

module.exports = {
  name: "append-only + corrections + source/version (Étapes 6–10)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    await ensureGraphEventsTable(pool);

    assert.deepStrictEqual([...GRAPH_SOURCES], [
      "web", "ios", "android", "api", "import", "admin", "system", "migration"
    ]);
    assert.strictEqual(normalizeGraphSource("collection.setEntry"), "api");
    assert.strictEqual(normalizeGraphSource("import"), "import");
    assert.strictEqual(normalizeGraphSource("web"), "web");
    assert.strictEqual(
      GRAPH_EVENT_VERSIONS[GRAPH_EVENT_TYPES.COMPARISON_COMPLETED],
      2
    );
    for (const field of GRAPH_EVENT_COMMON_FIELDS) assert.ok(field);
    for (const field of GRAPH_EVENT_SPECIFIC_FIELDS) assert.ok(field);

    const envelope = buildGraphEventEnvelope({
      eventType: "comparison.completed",
      actorUserId: 1,
      source: "collection.setEntry",
      context: { foo: "x" }
    });
    assert.strictEqual(envelope.source, "api");
    assert.strictEqual(envelope.eventVersion, 2);
    assert.strictEqual(envelope.context.origin, "collection.setEntry");
    assert.ok(envelope.id);
    assert.ok(envelope.occurredAt);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("graph_event_corrections"));
    assert.ok(doc.includes("Événement ≠ état"));
    assert.ok(doc.includes("eventVersion"));

    const user = await register(`SgFix${rnd()}`);
    const bad = await recordGraphEvent(pool, {
      eventType: "collection.status_changed",
      actorUserId: user.id,
      spriteId: "sprite_water",
      variantId: "sprite_water_gold",
      source: "api",
      origin: "test.bad",
      context: { oldStatus: "unknown", newStatus: "owned" },
      deduplicationKey: `bad-${user.id}-${rnd()}`
    });
    assert.ok(bad && bad.id);

    // Must refuse UPDATE on graph_events
    let updateBlocked = false;
    try {
      await pool.query(`UPDATE graph_events SET source = 'admin' WHERE id = $1::uuid`, [bad.id]);
    } catch (err) {
      updateBlocked = /append-only/i.test(err.message);
    }
    assert.ok(updateBlocked, "expected UPDATE to be rejected");

    const correction = await correctGraphEvent(pool, {
      cancelledEventId: bad.id,
      reason: "mauvais statut enregistré",
      correctedBy: user.id,
      correctiveEvent: {
        eventType: "collection.status_changed",
        actorUserId: user.id,
        spriteId: "sprite_water",
        variantId: "sprite_water_gold",
        source: "admin",
        context: { oldStatus: "unknown", newStatus: "priority" },
        deduplicationKey: `fix-${user.id}-${rnd()}`
      }
    });
    assert.ok(correction.ok, correction.error || "correction failed");
    assert.ok(correction.correctiveEvent);
    assert.ok(await isGraphEventCancelled(bad.id));

    const again = await correctGraphEvent(pool, {
      cancelledEventId: bad.id,
      reason: "retry"
    });
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.error, "already_cancelled");

    const effective = await pool.query(
      `SELECT id FROM graph_events_effective WHERE id = $1::uuid`,
      [bad.id]
    );
    assert.strictEqual(effective.rows.length, 0);

    const correctiveVisible = await pool.query(
      `SELECT id, source, event_version FROM graph_events_effective WHERE id = $1::uuid`,
      [correction.correctiveEvent.id]
    );
    assert.strictEqual(correctiveVisible.rows.length, 1);
    assert.strictEqual(correctiveVisible.rows[0].source, "admin");
    assert.strictEqual(Number(correctiveVisible.rows[0].event_version), 1);

    // Original row still exists (history preserved)
    const raw = await pool.query(`SELECT id FROM graph_events WHERE id = $1::uuid`, [bad.id]);
    assert.strictEqual(raw.rows.length, 1);
  }
};
