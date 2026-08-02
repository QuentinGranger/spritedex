const ctx = require("./shared");

module.exports = {
  name: "unknown exclu + priorité + fenêtres (Étapes 41–45)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();

    assert.ok(!OWNERSHIP_SAMPLE_STATUSES.includes("unknown"));
    assert.ok(OWNERSHIP_SAMPLE_STATUSES.includes("owned"));
    assert.ok(OWNERSHIP_SAMPLE_STATUSES.includes("spotted"));
    assert.strictEqual(roundRate(90, 200), 45);
    assert.strictEqual(
      formatCommunityPriorityDisplay(45),
      "45 % des collectionneurs auxquels elle manque l'ont placée en priorité."
    );
    assert.strictEqual(formatSampleSizeDisplay(320), "échantillon de 320 collections renseignées");
    assert.strictEqual(
      formatRecentPriorityAddsDisplay(84, 7),
      "+84 ajouts en priorité sur 7 jours"
    );

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

    // 1 owned, 1 missing, 1 priority, 1 unknown (unknown must not dilute ownership).
    const users = [];
    for (const prefix of ["Ow", "Mi", "Pr", "Un"]) {
      users.push(await register(`C41${prefix}${rnd()}`));
    }
    const [uOwned, uMissing, uPriority, uUnknown] = users;
    for (const u of users) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(), is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
         WHERE id = $1`,
        [u.id]
      );
    }
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, status) VALUES
         ($1, $5, 'owned'),
         ($2, $5, 'missing'),
         ($3, $5, 'priority'),
         ($4, $5, 'unknown')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = EXCLUDED.status`,
      [uOwned.id, uMissing.id, uPriority.id, uUnknown.id, variantId]
    );

    // Seed a recent priority_added event for the 7d window.
    await recordGraphEvent(pool, {
      eventType: "collection.priority_added",
      actorUserId: uPriority.id,
      variantId,
      source: "api",
      origin: "test.priority_window",
      context: { previousStatus: "missing", priorityLevel: "high" },
      deduplicationKey: `prio-win-${variantId}-${uPriority.id}-${rnd()}`
    });

    const day = new Date().toISOString().slice(0, 10);
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true }
    });

    const row = await pool.query(
      `SELECT * FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(row.rows.length, 1);
    const stats = row.rows[0];
    // unknown excluded from sample → 3 (owned+missing+priority)
    assert.strictEqual(Number(stats.sample_size), 3);
    assert.strictEqual(Number(stats.unknown_user_count), 1);
    assert.strictEqual(Number(stats.owner_user_count), 1);
    assert.strictEqual(Number(stats.ownership_rate), roundRate(1, 3));
    // priority among not-owned (missing+priority) = 1/2 = 50
    assert.strictEqual(Number(stats.not_owned_user_count), 2);
    assert.strictEqual(Number(stats.priority_user_count), 1);
    assert.strictEqual(Number(stats.priority_rate), 50);
    assert.ok(Number(stats.priority_added_7d) >= 1);

    const internal = await getCommunityVariantOwnership(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(internal.sampleSize, 3);
    assert.strictEqual(internal.sampleSizeDisplay, "échantillon de 3 collections renseignées");
    assert.ok(internal.priorityDisplay.includes("50"));
    assert.ok(internal.recentPriorityAddsDisplay[7].includes("7 jours"));

    const sought = await getMostSoughtVariants(pool, {
      metricDate: day,
      limit: 100,
      level: "aggregated_internal"
    });
    assert.strictEqual(sought.definition, "current_priority_unique_users");
    assert.ok(
      sought.items.some((i) => i.variantId === variantId && i.priorityUserCount >= 1),
      `expected ${variantId} among most-sought (got ${sought.items.length} items)`
    );
  }
};
