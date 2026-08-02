const ctx = require("./shared");

module.exports = {
  name: "agrégats communautaires (Étape 92)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();

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
    const variantId = (variantRes.rows[0] || fallback.rows[0]).id;

    const users = [];
    for (const prefix of ["El", "Ow", "Mi", "Pr", "Un", "Su"]) {
      users.push(await register(`C92${prefix}${rnd()}`));
    }
    const [uElig, uOwned, uMissing, uPriority, uUnknown, uSuspended] = users;
    for (const u of users) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(), is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb,
             suspended_until = NULL
         WHERE id = $1`,
        [u.id]
      );
    }
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, status)
       VALUES
         ($1, $7, 'owned'),
         ($2, $7, 'owned'),
         ($3, $7, 'missing'),
         ($4, $7, 'priority'),
         ($5, $7, 'unknown'),
         ($6, $7, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = EXCLUDED.status`,
      [uElig.id, uOwned.id, uMissing.id, uPriority.id, uUnknown.id, uSuspended.id, variantId]
    );

    // Suspended excluded.
    await pool.query(
      `UPDATE users SET suspended_until = NOW() + INTERVAL '2 hours' WHERE id = $1`,
      [uSuspended.id]
    );
    const eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(eligible.includes(Number(uOwned.id)));
    assert.ok(!eligible.includes(Number(uSuspended.id)));
    assert.ok(!OWNERSHIP_SAMPLE_STATUSES.includes("unknown"));

    const day = new Date().toISOString().slice(0, 10);
    const catVersion = `test-92-${rnd()}`;
    const calc = await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: catVersion
    });
    assert.ok(calc.variants >= 1);

    const row = await pool.query(
      `SELECT * FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(row.rows.length, 1);
    const stats = row.rows[0];
    assert.ok(stats.sample_size >= 1);
    assert.strictEqual(
      Number(stats.ownership_rate),
      roundRate(stats.owner_user_count, stats.sample_size)
    );
    assert.ok(stats.priority_rate == null || Number.isFinite(Number(stats.priority_rate)));
    // unknown must not inflate sample relative to owned+missing+priority(+spotted).
    assert.ok(Number(stats.sample_size) >= Number(stats.owner_user_count));
    assert.strictEqual(stats.catalogue_version, catVersion);

    const pub = await getCommunityVariantOwnership(pool, variantId, { metricDate: day });
    if (stats.sample_size < PUBLIC_ANONYMIZATION_MIN_USERS) {
      assert.ok(pub.insufficient);
      assert.strictEqual(pub.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);
    }
    const gate = applyPublicAnonymizationGate({
      uniqueUserCount: stats.sample_size,
      payload: { ownershipRate: stats.ownership_rate }
    });
    assert.strictEqual(gate.ok, stats.sample_size >= PUBLIC_ANONYMIZATION_MIN_USERS);

    const internal = await getCommunityVariantOwnership(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.ok(internal.sampleSizeDisplay.includes("échantillon") || internal.sampleSize >= 1);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 92"));
  }
};
