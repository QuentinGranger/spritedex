const ctx = require("./shared");

module.exports = {
  name: "tendances (Étape 93)",
  async run() {
    const {  } = ctx;
    const {
      resolveInterestTrend,
      evaluateTrendEligibility,
      TREND_DISPLAY_REQUIREMENTS,
      TREND_INSUFFICIENT_MESSAGE,
      ensureTrendTables,
      calculateVariantInterestDaily,
      getVariantInterestSeries,
      percentChange
    } = require("../server/sprite-graph-trends");
    const { decomposeCatalogueVsAcquisition } = require("../server/sprite-graph-squad-stats");

    // Hausse / baisse / stabilité (+ volume insuffisant sans jours/events).
    assert.strictEqual(resolveInterestTrend(30, 25, { enforceDisplayRequirements: false }), "strongly_rising");
    assert.strictEqual(resolveInterestTrend(12, 25, { enforceDisplayRequirements: false }), "rising");
    assert.strictEqual(resolveInterestTrend(0, 25, { enforceDisplayRequirements: false }), "stable");
    assert.strictEqual(resolveInterestTrend(-12, 25, { enforceDisplayRequirements: false }), "falling");
    assert.strictEqual(resolveInterestTrend(-30, 25, { enforceDisplayRequirements: false }), "strongly_falling");
    assert.strictEqual(resolveInterestTrend(40, 5, { enforceDisplayRequirements: false }), null);

    // Historique trop court / volume / events.
    const short = evaluateTrendEligibility({
      daysOfData: 3,
      sampleSize: 50,
      relevantEventCount: 10
    });
    assert.strictEqual(short.ok, false);
    assert.strictEqual(short.message, TREND_INSUFFICIENT_MESSAGE);
    assert.ok(TREND_DISPLAY_REQUIREMENTS.minDaysOfData >= 7);

    // Nouvelle variante — aucune série d’intérêt ⇒ pas de tendance.
    await ensureTrendTables(pool);
    const day = new Date().toISOString().slice(0, 10);
    const seriesFresh = await getVariantInterestSeries(pool, `sg93new_${rnd()}`, {
      days: 30,
      level: "aggregated_internal"
    });
    assert.ok(seriesFresh == null || seriesFresh.latest?.trend == null);

    const variantRes = await pool.query(
      `SELECT v.id FROM sprite_variants v ORDER BY v.id LIMIT 1`
    );
    const variantId = variantRes.rows[0].id;
    await pool.query(`DELETE FROM variant_interest_daily WHERE variant_id = $1`, [variantId]);
    await pool.query(
      `INSERT INTO variant_interest_daily (
         metric_date, variant_id, priority_user_count, ownership_rate,
         interest_score, sample_size, change_7d, trend
       ) VALUES ($1::date, $2, 10, 8, 40, 30, 5, 'rising')
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET interest_score = 40, sample_size = 30`,
      [day, variantId]
    );
    const series = await getVariantInterestSeries(pool, variantId, {
      days: 30,
      level: "aggregated_internal"
    });
    assert.ok(series);
    assert.strictEqual(series.latest.trend, null);
    assert.ok(
      (series.latest.trendMessage || series.trendEligibility?.message || "")
        .includes("Pas encore assez")
    );

    // Événement temporaire — priority_added avec eventId.
    const user = await register(`Sg93Ev${rnd()}`);
    const tmp = await recordCollectionGraphEvents(user.id, [{
      variantId: `sg93tmp_${rnd()}`,
      spriteId: "sg93s",
      isNewEntry: false,
      historyId: 9301,
      previousStatus: "missing",
      newStatus: "priority",
      newPriority: "urgent",
      eventId: "event_hot_temp_93"
    }], { source: "api", catalogueVersion: "2026.07.18-1" });
    const prio = tmp.find((e) => e.eventType === "collection.priority_added");
    assert.ok(prio);
    assert.strictEqual(prio.context.eventId, "event_hot_temp_93");

    // Correction de catalogue — choc taille ≠ acquisition.
    const decomp = decomposeCatalogueVsAcquisition({
      previousCovered: 80,
      previousCatalogueCount: 100,
      currentCovered: 80,
      currentCatalogueCount: 120
    });
    assert.ok(decomp.catalogueExpansionImpact < 0);
    assert.strictEqual(decomp.acquisitionProgress, 0);
    assert.ok(percentChange(60, 50) > 0);

    // Recalc path still runs for known variants.
    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate
       ) VALUES ($1::date, $2, 40, 8, 20, 10, 40, 20, 33)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET sample_size = 40`,
      [day, variantId]
    );
    const calc = await calculateVariantInterestDaily(pool, { metricDate: day });
    assert.ok(calc.variants >= 1);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 93"));
  }
};
