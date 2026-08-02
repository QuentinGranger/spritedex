const ctx = require("./shared");

module.exports = {
  name: "reconstruction des agrégats (Étape 95)",
  async run() {
    const {  } = ctx;
    await ensureGraphEventsTable(pool);
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();
    const {
      ensureMetricCounterTables,
      rebuildGraphMetrics,
      rebuildMetricCountersFromEvents,
      getMetricCounter,
      GRAPH_COUNTER_METRICS,
      COUNTER_TOTAL_ENTITY
    } = require("../server/sprite-graph-counters");
    await ensureMetricCounterTables(pool);

    const localDay = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dayNum}`;
    };
    const day = localDay(new Date());
    const variantRes = await pool.query(
      `SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`
    );
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;
    const user = await register(`SgRecon${rnd()}`);
    const catVersion = `recon-95-${rnd()}`;

    // Seed countable events for the day.
    for (let i = 0; i < 3; i++) {
      await recordGraphEvent(pool, {
        eventType: GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
        actorUserId: user.id,
        variantId,
        spriteId,
        source: "api",
        occurredAt: `${day}T10:0${i}:00.000Z`,
        context: { catalogueVersion: catVersion, seed: i },
        deduplicationKey: `recon95-${user.id}-${i}-${rnd()}`
      }, { skipGovernance: true });
    }

    await pool.query(
      `UPDATE users
       SET last_active_at = NOW(), is_test_account = FALSE,
           community_stats_opt_in = TRUE,
           cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
       WHERE id = $1`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES ($1, $2, $3, 'priority')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'priority'`,
      [user.id, variantId, spriteId]
    );

    // Deterministic community snapshot (bypass default fill-rate for this user).
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: catVersion
    });
    const counterSeed = await rebuildMetricCountersFromEvents(pool, day, day);
    assert.ok(counterSeed.events >= 3);

    const counterBefore = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: variantId
    });
    assert.ok(counterBefore);
    const counterBeforeValue = Number(counterBefore.countValue);
    assert.ok(counterBeforeValue >= 3);

    const communityBefore = await pool.query(
      `SELECT owner_user_count, sample_size, ownership_rate, priority_user_count,
              catalogue_version
       FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(communityBefore.rows.length, 1);
    const snap = { ...communityBefore.rows[0] };

    // Supprimer les agrégats de la période.
    await pool.query(
      `DELETE FROM graph_metric_counters
       WHERE metric_date = $1::date
         AND (
           entity_id = $2
           OR (metric_type = $3 AND entity_id = $4)
         )`,
      [day, variantId, GRAPH_COUNTER_METRICS.PRIORITY_ADDED, COUNTER_TOTAL_ENTITY]
    );
    await pool.query(
      `DELETE FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    const wipedCommunity = await pool.query(
      `SELECT COUNT(*)::int AS n FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(wipedCommunity.rows[0].n, 0);

    // Rejouer : counters depuis events + community stats depuis état métier.
    const rebuilt = await rebuildGraphMetrics(pool, day, day, {
      runDailyPipeline: false,
      rebuildCounters: true
    });
    assert.ok(rebuilt.counters.events >= 3);
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: catVersion
    });

    const counterAfter = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: variantId
    });
    assert.ok(counterAfter);
    assert.strictEqual(Number(counterAfter.countValue), counterBeforeValue);

    const communityAfter = await pool.query(
      `SELECT owner_user_count, sample_size, ownership_rate, priority_user_count,
              catalogue_version
       FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(communityAfter.rows.length, 1);
    assert.strictEqual(
      Number(communityAfter.rows[0].sample_size),
      Number(snap.sample_size)
    );
    assert.strictEqual(
      Number(communityAfter.rows[0].owner_user_count),
      Number(snap.owner_user_count)
    );
    assert.strictEqual(
      Number(communityAfter.rows[0].priority_user_count),
      Number(snap.priority_user_count)
    );
    assert.strictEqual(
      Number(communityAfter.rows[0].ownership_rate),
      Number(snap.ownership_rate)
    );
    assert.strictEqual(communityAfter.rows[0].catalogue_version, snap.catalogue_version);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 95"));
    assert.ok(doc.includes("reconstruct"));
  }
};
