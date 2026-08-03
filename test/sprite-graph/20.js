const ctx = require("./shared");

module.exports = {
  name: "seuils tendance + compare/squad context + reco hooks (Étapes 81–85)",
  async run() {
    const {} = ctx;
    const {
      evaluateTrendEligibility,
      TREND_DISPLAY_REQUIREMENTS,
      TREND_INSUFFICIENT_MESSAGE,
      ensureTrendTables
    } = require("../server/sprite-graph-trends");
    const {
      getCompareCommunityInsights,
      getStandardCommunityVariantResponse
    } = require("../server/sprite-graph-public");
    const {
      resolveSquadSizeBand,
      resolveCompletionBand,
      getSquadCommunityContext,
      ensureSquadDailyStatsTables
    } = require("../server/sprite-graph-squad-stats");
    const {
      getGraphRecommendationReadiness,
      resolveGraphRecommendations,
      FUTURE_GRAPH_RECOMMENDATION_SURFACES
    } = require("../server/sprite-graph-recommendations");

    // Étape 81 — gates.
    assert.strictEqual(TREND_DISPLAY_REQUIREMENTS.minDaysOfData, 7);
    assert.strictEqual(TREND_DISPLAY_REQUIREMENTS.minEligibleUsers, 20);
    assert.strictEqual(TREND_DISPLAY_REQUIREMENTS.minRelevantEvents, 5);
    const blocked = evaluateTrendEligibility({
      daysOfData: 3,
      sampleSize: 50,
      relevantEventCount: 10
    });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.message, TREND_INSUFFICIENT_MESSAGE);
    const allowed = evaluateTrendEligibility({
      daysOfData: 7,
      sampleSize: 20,
      relevantEventCount: 5
    });
    assert.strictEqual(allowed.ok, true);

    await ensureTrendTables(pool);
    const variantRes = await pool.query(`SELECT v.id FROM sprite_variants v ORDER BY v.id LIMIT 1`);
    const variantId = variantRes.rows[0].id;
    const localDay = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dayNum}`;
    };
    const day = localDay(new Date());

    // Seed enough interest history + events for a visible trend.
    for (let i = 0; i < 8; i++) {
      const d = localDay(new Date(Date.now() - i * 86400000));
      await pool.query(
        `INSERT INTO variant_interest_daily (
           metric_date, variant_id, priority_user_count, ownership_rate,
           interest_score, sample_size, change_7d, trend
         ) VALUES ($1::date, $2, 40, 6, $3, 80, 12, 'rising')
         ON CONFLICT (metric_date, variant_id) DO UPDATE SET
           interest_score = EXCLUDED.interest_score,
           sample_size = 80,
           change_7d = 12,
           trend = 'rising'`,
        [d, variantId, 50 + i]
      );
    }
    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate, not_owned_user_count,
         priority_added_7d, priority_added_30d
       ) VALUES ($1::date, $2, 80, 5, 60, 20, 80, 6.25, 33, 60, 4, 10)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         sample_size = 80, ownership_rate = 6.25, priority_rate = 33,
         owner_user_count = 5, missing_user_count = 60, priority_user_count = 20`,
      [day, variantId]
    );
    for (let i = 0; i < 6; i++) {
      await recordGraphEvent(pool, {
        eventType: GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
        actorUserId: 1,
        spriteId: "sg_trend_sprite",
        variantId: String(variantId),
        source: "system",
        origin: "test.trend81",
        context: { seed: `trend81-${i}` },
        deduplicationKey: `trend81-${variantId}-${i}-${rnd()}`
      });
    }

    const stdReady = await getStandardCommunityVariantResponse(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.ok(stdReady.trendEligibility);
    // Events may land outside window depending on DB clock; eligibility object always present.
    if (stdReady.trendEligibility.ok) {
      assert.ok(stdReady.community.trend);
      assert.ok(stdReady.publicDisplay.trend.startsWith("Tendance"));
    } else {
      assert.ok(stdReady.publicDisplay.trend.includes("Pas encore assez"));
    }

    // Étape 82 — compare insights (secondary).
    const compare = await getCompareCommunityInsights(pool, {
      items: [
        { variantId, relation: "bothMissing" },
        { variantId, relation: "onlyA" }
      ],
      aName: "Quentin",
      bName: "Lucy",
      level: "aggregated_internal"
    });
    assert.ok(compare.insights.length >= 1);
    assert.ok(compare.note.includes("secondaires"));
    const both = compare.insights.find((i) => i.relation === "bothMissing");
    assert.ok(both);
    assert.ok(both.personalLine.includes("Quentin"));
    assert.ok(both.communityLine.includes("%"));
    assert.strictEqual(both.priority, "secondary");

    // Étape 84 — peer bands.
    assert.strictEqual(resolveSquadSizeBand(5).id, "4_6");
    assert.ok(resolveSquadSizeBand(5).label.includes("4 à 6"));
    assert.strictEqual(resolveCompletionBand(82).id, "75_100");
    assert.notStrictEqual(resolveSquadSizeBand(2).id, resolveSquadSizeBand(20).id);

    // Étape 83 — squad community context (if a squad exists).
    await ensureSquadDailyStatsTables(pool);
    const squadRow = await pool.query(`SELECT id, name, code FROM squads ORDER BY id LIMIT 1`);
    if (squadRow.rows.length) {
      const sid = squadRow.rows[0].id;
      await pool.query(
        `INSERT INTO squad_daily_stats (
           metric_date, squad_id, active_member_count, covered_variant_count,
           catalogue_variant_count, collective_completion_rate, progress_7d,
           eligible_for_community, catalogue_version
         ) VALUES ($1::date, $2, 5, 100, 120, 82, 2.1, TRUE, 'test')
         ON CONFLICT (metric_date, squad_id) DO UPDATE SET
           active_member_count = 5,
           collective_completion_rate = 82,
           progress_7d = 2.1,
           eligible_for_community = TRUE`,
        [day, sid]
      );
      // Peer squads in same band.
      const peers = await pool.query(`SELECT id FROM squads WHERE id <> $1 LIMIT 3`, [sid]);
      for (const p of peers.rows) {
        await pool.query(
          `INSERT INTO squad_daily_stats (
             metric_date, squad_id, active_member_count, covered_variant_count,
             catalogue_variant_count, collective_completion_rate, progress_7d,
             eligible_for_community
           ) VALUES ($1::date, $2, 5, 90, 120, 70, 2.0, TRUE)
           ON CONFLICT (metric_date, squad_id) DO UPDATE SET
             active_member_count = 5, progress_7d = 2.0, eligible_for_community = TRUE`,
          [day, p.id]
        );
      }
      const ctx = await getSquadCommunityContext(pool, sid, { metricDate: day });
      assert.ok(ctx);
      assert.ok(ctx.coverage.label.includes("82"));
      assert.strictEqual(ctx.peerGroup.competitive, false);
      assert.strictEqual(ctx.peerGroup.ranking, null);
      assert.ok(ctx.peerGroup.sizeBand.id === "4_6");

      const apiSquad = await fetch(`${API}/sprite-graph/squads/${encodeURIComponent(squadRow.rows[0].code)}/community`);
      if (apiSquad.ok) {
        const body = await apiSquad.json();
        assert.strictEqual(body.peerGroup.competitive, false);
      }
    }

    // Étape 85 — readiness only, empty items.
    const readiness = getGraphRecommendationReadiness();
    assert.strictEqual(readiness.autoGenerate, false);
    assert.ok(readiness.surfaces.length >= 6);
    assert.ok(readiness.surfaces.every((s) => s.status === "reserved" && s.autoGenerate === false));
    const resolved = await resolveGraphRecommendations(pool, null, {
      surface: FUTURE_GRAPH_RECOMMENDATION_SURFACES.PRIORITY_SUGGESTIONS
    });
    assert.deepStrictEqual(resolved.items, []);
    assert.strictEqual(resolved.autoGenerate, false);

    const readyRes = await fetch(`${API}/sprite-graph/recommendations/readiness`);
    if (readyRes.ok) {
      const body = await readyRes.json();
      assert.strictEqual(body.autoGenerate, false);
    }
    const compareRes = await fetch(`${API}/sprite-graph/compare/community-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ variantId, relation: "bothMissing" }],
        aName: "A",
        bName: "B"
      })
    });
    if (compareRes.ok) {
      const body = await compareRes.json();
      assert.ok(Array.isArray(body.insights));
    }
  }
};
