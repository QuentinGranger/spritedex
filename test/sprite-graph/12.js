const ctx = require("./shared");

module.exports = {
  name: "community_variant_stats + éligibilité + taux (Étapes 36–40)",
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
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();

    assert.strictEqual(roundRate(18, 320), 5.63);
    assert.strictEqual(
      formatCommunityOwnershipDisplay(5.63),
      "5,6 % des collectionneurs renseignés possèdent cette variante."
    );

    const tables = await pool.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [
        [
          "graph_daily_metrics",
          "community_variant_stats",
          "community_sprite_stats",
          "comparison_daily_stats",
          "squad_daily_stats",
          "notification_daily_stats"
        ]
      ]
    );
    const names = new Set(tables.rows.map((r) => r.tablename));
    assert.ok(names.has("community_variant_stats"));
    assert.ok(names.has("graph_daily_metrics"));

    // Prefer a variant with no existing entries so rates stay deterministic.
    const variantRes = await pool.query(
      `SELECT v.id
       FROM sprite_variants v
       LEFT JOIN sprite_entries e ON e.variant_id = v.id
       GROUP BY v.id
       HAVING COUNT(e.id) = 0
       ORDER BY v.id
       LIMIT 1`
    );
    const fallback = await pool.query(`SELECT id FROM sprite_variants ORDER BY id DESC LIMIT 1`);
    assert.ok(fallback.rows.length, "need catalogue variant");
    const variantId = (variantRes.rows[0] || fallback.rows[0]).id;

    const owner = await register(`CmOwn${rnd()}`);
    const misser = await register(`CmMiss${rnd()}`);
    // Make both eligible without filling 60% of a large catalogue.
    for (const u of [owner, misser]) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(),
             is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
         WHERE id = $1`,
        [u.id]
      );
    }
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, status)
       VALUES ($1, $2, 'owned'), ($3, $2, 'missing')
       ON CONFLICT (user_id, variant_id)
       DO UPDATE SET status = EXCLUDED.status`,
      [owner.id, variantId, misser.id]
    );

    const eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(eligible.includes(Number(owner.id)), `owner ${owner.id} not in ${eligible.slice(0, 5)}`);
    assert.ok(eligible.includes(Number(misser.id)));

    // Test accounts excluded.
    await pool.query(`UPDATE users SET is_test_account = TRUE WHERE id = $1`, [misser.id]);
    const eligible2 = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(!eligible2.includes(Number(misser.id)));
    await pool.query(`UPDATE users SET is_test_account = FALSE WHERE id = $1`, [misser.id]);

    const day = new Date().toISOString().slice(0, 10);
    const calc = await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true }
    });
    assert.strictEqual(calc.variants, 1);
    assert.ok(calc.eligibleUsers >= 2);

    const row = await pool.query(
      `SELECT * FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(row.rows.length, 1);
    assert.ok(row.rows[0].eligible_user_count >= 2);
    assert.ok(row.rows[0].owner_user_count >= 1);
    assert.strictEqual(
      Number(row.rows[0].ownership_rate),
      roundRate(row.rows[0].owner_user_count, row.rows[0].sample_size)
    );
    // Isolated formula check when only our two collectors filled the variant.
    if (row.rows[0].sample_size === 2) {
      assert.strictEqual(row.rows[0].owner_user_count, 1);
      assert.strictEqual(Number(row.rows[0].ownership_rate), 50);
    }

    // Public gate: 2 < 20 → insufficient.
    const pub = await getCommunityVariantOwnership(pool, variantId, { metricDate: day });
    assert.ok(pub.insufficient);
    assert.ok(pub.display.includes("insuffisant") || pub.message);

    const internal = await getCommunityVariantOwnership(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(internal.ownershipRate, 50);
    assert.ok(internal.display.includes("50") || internal.display.includes("50,0"));
    assert.ok(internal.sampleSize >= 2);
    assert.ok(internal.sampleSizeDisplay.includes("échantillon"));
  }
};
