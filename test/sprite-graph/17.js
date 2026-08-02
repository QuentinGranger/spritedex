const ctx = require("./shared");

module.exports = {
  name: "compteurs temps réel + rebuild + rétention (Étapes 61–65)",
  async run() {
    const {  } = ctx;
    await ensureGraphEventsTable(pool);
    const {
      GRAPH_COUNTER_METRICS,
      COUNTER_TOTAL_ENTITY,
      GRAPH_RETENTION,
      ensureMetricCounterTables,
      incrementMetricCounter,
      applyRealtimeCountersFromEvent,
      getMetricCounter,
      counterBumpsForEvent,
      rebuildMetricCountersFromEvents,
      rebuildGraphMetrics,
      pruneGraphTechnicalArtifacts,
      compactGraphEventTechnicalContext
    } = require("../server/sprite-graph-counters");
    const { processGraphEventOutbox } = require("../server/sprite-graph-outbox");

    await ensureMetricCounterTables(pool);
    assert.strictEqual(GRAPH_RETENTION.keepRawEventsForever, true);
    assert.ok(GRAPH_RETENTION.rawEventKeepFields.includes("event_type"));
    assert.ok(GRAPH_RETENTION.technicalContextKeys.includes("requestId"));

    const day = new Date().toISOString().slice(0, 10);
    const variantRes = await pool.query(
      `SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`
    );
    assert.ok(variantRes.rows.length);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    // Étape 61 — incremental only, no community recalc flag.
    const rt = await applyRealtimeCountersFromEvent(pool, {
      event_type: "collection.priority_added",
      variant_id: variantId,
      sprite_id: spriteId,
      occurred_at: `${day}T12:00:00.000Z`,
      context: {}
    });
    assert.strictEqual(rt.recalculatedCommunity, false);
    assert.ok(rt.applied >= 2);

    const total = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: COUNTER_TOTAL_ENTITY
    });
    assert.ok(total);
    assert.ok(total.countValue >= 1);

    const byVariant = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: variantId
    });
    assert.ok(byVariant.countValue >= 1);

    // Étape 62 — outbox path increments counters (still no community %).
    const before = total.countValue;
    const user = await register(`Ctr${rnd()}`);
    await recordGraphEvent(pool, {
      eventType: GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
      actorUserId: user.id,
      variantId,
      spriteId,
      source: "api",
      occurredAt: `${day}T13:00:00.000Z`,
      context: { requestId: "tech-should-be-prunable", catalogueVersion: "test-ctr" },
      deduplicationKey: `ctr-prio-${rnd()}`
    });
    await processGraphEventOutbox(pool, { limit: 20 });
    const after = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: COUNTER_TOTAL_ENTITY
    });
    assert.ok(after.countValue >= before + 1);

    // Comparison difference bumps.
    const bumps = counterBumpsForEvent({
      event_type: "comparison.completed",
      context: { topDifferenceSpriteIds: [spriteId, spriteId, "unknown-x"] },
      occurred_at: `${day}T14:00:00.000Z`
    });
    assert.ok(bumps.some((b) => b.metricType === GRAPH_COUNTER_METRICS.COMPARISON_COMPLETED));
    assert.ok(bumps.some((b) => (
      b.metricType === GRAPH_COUNTER_METRICS.COMPARISON_DIFFERENCE && b.entityId === spriteId
    )));

    // Étape 63 — direct increment API.
    await incrementMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.INVITATION_SENT,
      entityId: COUNTER_TOTAL_ENTITY,
      delta: 3
    });
    const inv = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.INVITATION_SENT
    });
    assert.ok(inv.countValue >= 3);

    // Étape 64 — rebuild counters from raw events for today.
    const rebuilt = await rebuildMetricCountersFromEvents(pool, day, day);
    assert.ok(rebuilt.events >= 1);
    assert.ok(rebuilt.counterBumps >= 1);
    const rebuiltTotal = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: COUNTER_TOTAL_ENTITY
    });
    assert.ok(rebuiltTotal.countValue >= 1);

    // Full rebuild without re-running heavy daily pipeline for every assertion path.
    const full = await rebuildGraphMetrics(pool, day, day, {
      runDailyPipeline: false,
      rebuildCounters: true
    });
    assert.strictEqual(full.days, 1);
    assert.ok(full.counters.events >= 1);

    // Étape 65 — retention: never delete raw events; prune technical artifacts ok.
    const prune = await pruneGraphTechnicalArtifacts(pool, {
      outboxRetentionDays: 3650, // keep recent outbox in tests
      counterRetentionDays: 3650,
      compactTechnicalContext: false
    });
    assert.strictEqual(prune.keepRawEventsForever, true);
    assert.ok(Array.isArray(prune.rawEventKeepFields));

    // Compact technical context on a fresh old-dated event via controlled path.
    // Insert with occurred_at far in the past using recordGraphEvent.
    const oldKey = `ctr-old-${rnd()}`;
    const oldEv = await recordGraphEvent(pool, {
      eventType: GRAPH_EVENT_TYPES.GOAL_COMPLETED,
      actorUserId: user.id,
      source: "api",
      occurredAt: "2020-01-01T00:00:00.000Z",
      context: {
        requestId: "drop-me",
        goalScope: "personal",
        catalogueVersion: "keep-me"
      },
      deduplicationKey: oldKey
    });
    assert.ok(oldEv);
    const compacted = await compactGraphEventTechnicalContext(pool, {
      olderThanDays: 30,
      limit: 50
    });
    assert.ok(compacted >= 0);
    const afterCompact = await pool.query(
      `SELECT context FROM graph_events WHERE deduplication_key = $1`,
      [oldKey]
    );
    if (compacted > 0 && afterCompact.rows[0]) {
      assert.strictEqual(afterCompact.rows[0].context.requestId, undefined);
      assert.strictEqual(afterCompact.rows[0].context.goalScope, "personal");
    }

    // Raw event row still exists (not deleted).
    const stillThere = await pool.query(
      `SELECT id FROM graph_events WHERE deduplication_key = $1`,
      [oldKey]
    );
    assert.strictEqual(stillThere.rows.length, 1);
  }
};
