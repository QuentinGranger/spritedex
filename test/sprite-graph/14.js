const ctx = require("./shared");

module.exports = {
  name: "comparaison diffs + complémentarité + popularité (Étapes 46–50)",
  async run() {
    const {} = ctx;
    await ensureGraphEventsTable(pool);
    const {
      ensureComparisonStatsTables,
      calculateComparisonAndPopularityStats,
      getMostComparedSprites,
      getAverageComplementarity,
      getTopPopularSprites,
      resolveCollectionBand,
      POPULARITY_SCORE_WEIGHTS
    } = require("../server/sprite-graph-comparison-stats");
    await ensureComparisonStatsTables(pool);

    assert.strictEqual(FUTURE_GRAPH_EVENT_TYPES.COMPARISON_SPRITE_VIEWED, "comparison.sprite_viewed");
    assert.ok(!GRAPH_EVENT_TYPE_SET.has("comparison.sprite_viewed"));
    assert.strictEqual(resolveCollectionBand(10), "0_25");
    assert.strictEqual(resolveCollectionBand(40), "25_50");
    assert.strictEqual(resolveCollectionBand(60), "50_75");
    assert.strictEqual(resolveCollectionBand(90), "75_100");
    assert.ok(Math.abs(POPULARITY_SCORE_WEIGHTS.priority - 0.4) < 1e-9);

    const sprites = await pool.query(`SELECT id FROM sprites ORDER BY id LIMIT 2`);
    assert.ok(sprites.rows.length >= 2, "need ≥2 sprites in catalogue");
    const spriteA = sprites.rows[0].id;
    const spriteB = sprites.rows[1].id;

    const top = extractTopDifferenceSpriteIds({
      groups: {
        onlyUserA: [
          { spriteId: spriteA, variantId: "v1" },
          { spriteId: spriteA, variantId: "v2" },
          { spriteId: spriteB, variantId: "v3" }
        ],
        onlyUserB: [{ spriteId: spriteA, variantId: "v4" }]
      }
    });
    assert.deepStrictEqual(top.slice(0, 2), [spriteA, spriteB]);

    const ctx = buildComparisonCompletedContext({
      actorUserId: 1,
      targetUserId: 2,
      userAId: 1,
      userBId: 2,
      catalogueVersion: "cat-test",
      result: {
        summary: {
          complementarityRate: 40,
          aPossessionRate: 20,
          bPossessionRate: 30,
          onlyUserACount: 1,
          onlyUserBCount: 1,
          bothOwnedCount: 2,
          bothMissingCount: 1
        },
        groups: {
          onlyUserA: [{ spriteId: spriteA }],
          onlyUserB: [{ spriteId: spriteB }]
        }
      }
    });
    assert.deepStrictEqual(ctx.topDifferenceSpriteIds, [spriteA, spriteB]);
    assert.strictEqual(ctx.differenceSpriteCount, 2);
    assert.strictEqual(ctx.pairCollectionRate, 25);

    const u1 = await register(`CmpPopA${rnd()}`);
    const u2 = await register(`CmpPopB${rnd()}`);
    const day = new Date().toISOString().slice(0, 10);
    await recordGraphEvent(pool, {
      eventType: "comparison.completed",
      actorUserId: u1.id,
      targetUserId: u2.id,
      source: "api",
      origin: "test.comparison_stats",
      context: {
        pairKey: `comparison_pair:${Math.min(u1.id, u2.id)}:${Math.max(u1.id, u2.id)}`,
        catalogueVersion: "cat-test",
        complementarityRate: 40,
        pairCollectionRate: 25,
        topDifferenceSpriteIds: [spriteA, spriteB],
        differenceSpriteCount: 2
      },
      deduplicationKey: `cmp-stats-${rnd()}`
    });
    const variantForA = await pool.query(`SELECT id FROM sprite_variants WHERE sprite_id = $1 LIMIT 1`, [spriteA]);
    await recordGraphEvent(pool, {
      eventType: "collection.priority_added",
      actorUserId: u1.id,
      spriteId: spriteA,
      variantId: variantForA.rows[0]?.id || null,
      source: "api",
      origin: "test.pop",
      context: { priorityLevel: "high" },
      deduplicationKey: `pop-prio-${rnd()}`
    });

    const calc = await calculateComparisonAndPopularityStats(pool, { metricDate: day });
    assert.ok(calc.comparison.comparisonsCounted >= 1);
    assert.ok(calc.comparison.avgComplementarity != null);

    const most = await getMostComparedSprites(pool, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(most.spriteLevel, "difference_appearances_not_views");
    assert.ok(most.items.some((i) => i.spriteId === spriteA));
    assert.ok(most.items.every((i) => i.metric === "difference_appearance"));
    assert.ok(!/"views"/.test(JSON.stringify(most)));

    const avg = await getAverageComplementarity(pool, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.ok(avg.avgComplementarity >= 0);
    assert.ok(avg.byCollectionBand.some((b) => b.band === "25_50" || b.band === "0_25"));

    const pop = await getTopPopularSprites(pool, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(pop.label, "Tendance sprite-index");
    assert.strictEqual(pop.indexLabel, "Indice d'intérêt communautaire");
    assert.ok(pop.formulaDocumentation.includes("percentile") || pop.formulaDocumentation.includes("0.40"));
    assert.ok(Array.isArray(pop.items));
  }
};
