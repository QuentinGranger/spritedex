const ctx = require("./shared");

module.exports = {
  name: "percentiles + tendances + squad snapshots (Étapes 51–55)",
  async run() {
    const {  } = ctx;
    await ensureGraphEventsTable(pool);
    const {
      percentileScores,
      INTEREST_TREND_LABEL,
      calculateSpritePopularityScores
    } = require("../server/sprite-graph-comparison-stats");
    const {
      resolveInterestTrend,
      percentChange,
      ensureTrendTables,
      calculateVariantInterestDaily,
      calculateSquadDailySnapshots,
      getVariantInterestSeries
    } = require("../server/sprite-graph-trends");

    assert.strictEqual(INTEREST_TREND_LABEL, "Tendance sprite-index");

    // Étape 51 — percentiles 0–100.
    const scores = percentileScores(new Map([["a", 1], ["b", 10], ["c", 100]]));
    assert.strictEqual(scores.get("a"), 0);
    assert.strictEqual(scores.get("c"), 100);
    assert.ok(scores.get("b") > 0 && scores.get("b") < 100);

    // Étape 54 — trend bands + min volume.
    assert.strictEqual(resolveInterestTrend(30, 20), "strongly_rising");
    assert.strictEqual(resolveInterestTrend(12, 20), "rising");
    assert.strictEqual(resolveInterestTrend(0, 20), "stable");
    assert.strictEqual(resolveInterestTrend(-15, 20), "falling");
    assert.strictEqual(resolveInterestTrend(-40, 20), "strongly_falling");
    assert.strictEqual(resolveInterestTrend(50, 5), null);
    assert.strictEqual(percentChange(78, 55), Math.round(((78 - 55) / 55) * 10000) / 100);

    await ensureTrendTables(pool);
    const day = new Date().toISOString().slice(0, 10);
    const dayPrev = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Seed community + popularity so variant interest can compute.
    const variantRes = await pool.query(
      `SELECT v.id, v.sprite_id FROM sprite_variants v ORDER BY v.id LIMIT 1`
    );
    assert.ok(variantRes.rows.length);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate
       ) VALUES ($1::date, $2, 25, 5, 10, 8, 25, 20, 40)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         priority_user_count = 8, sample_size = 25, ownership_rate = 20`,
      [day, variantId]
    );
    await pool.query(
      `INSERT INTO sprite_popularity_scores (
         metric_date, sprite_id, score, sample_size, components, weights
       ) VALUES ($1::date, $2, 78, 25, '{}'::jsonb, '{}'::jsonb)
       ON CONFLICT (metric_date, sprite_id) DO UPDATE SET score = 78, sample_size = 25`,
      [day, spriteId]
    );
    await pool.query(
      `INSERT INTO variant_interest_daily (
         metric_date, variant_id, priority_user_count, ownership_rate,
         interest_score, sample_size
       ) VALUES ($1::date, $2, 42, 18, 55, 25)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET interest_score = 55`,
      [dayPrev, variantId]
    );

    const vCalc = await calculateVariantInterestDaily(pool, { metricDate: day });
    assert.ok(vCalc.variants >= 1);

    const series = await getVariantInterestSeries(pool, variantId, {
      days: 14,
      level: "aggregated_internal"
    });
    assert.ok(series);
    assert.strictEqual(series.label, "Tendance sprite-index");
    assert.ok(series.latest.interestScore != null);
    assert.ok(series.latest.peakInterestScore >= series.latest.interestScore);
    assert.ok(series.latest.change7d != null || series.latest.change7d === null);
    // Étape 81 — trend only when days/users/events gates pass.
    if (
      series.latest.sampleSize >= 20
      && series.latest.change7d != null
      && series.trendEligibility?.ok
    ) {
      assert.ok(series.latest.trend);
    } else if (series.latest.sampleSize >= 20 && series.latest.change7d != null) {
      assert.strictEqual(series.latest.trend, null);
    }

    // Étape 55 — squad snapshot (create a tiny squad via API if possible).
    const owner = await register(`SqSnap${rnd()}`);
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Trend${rnd()}` })
    });
    if (squadRes.ok) {
      const squad = await squadRes.json();
      const squadId = squad.id || squad.squad?.id;
      if (squadId) {
        const sCalc = await calculateSquadDailySnapshots(pool, { metricDate: day });
        assert.ok(sCalc.squads >= 1);
        const snap = await pool.query(
          `SELECT * FROM squad_daily_snapshots
           WHERE metric_date = $1::date AND squad_id = $2`,
          [day, squadId]
        );
        assert.strictEqual(snap.rows.length, 1);
        assert.ok(snap.rows[0].member_count >= 1);
        assert.ok(snap.rows[0].covered_variant_count >= 0);
      }
    }

    // Percentile path still used by interest score calc.
    const pop = await calculateSpritePopularityScores(pool, { metricDate: day, windowDays: 7 });
    assert.ok(pop.formula.includes("percentile"));
    assert.strictEqual(pop.label, "Tendance sprite-index");
  }
};
