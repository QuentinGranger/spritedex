const ctx = require("./shared");

module.exports = {
  name: "réponse communautaire + tendances + historique (Étapes 76–80)",
  async run() {
    const {} = ctx;
    await ensureGraphEventsTable(pool);
    const {
      getStandardCommunityVariantResponse,
      getVariantCommunityHistory,
      getCommunityTrendsBoard,
      COMMUNITY_SOURCE_DISCLAIMER,
      formatRateFr
    } = require("../server/sprite-graph-public");

    assert.strictEqual(formatRateFr(5.63, { digits: 1 }), "5,6");
    assert.ok(COMMUNITY_SOURCE_DISCLAIMER.includes("sprite-index"));

    const variantRes = await pool.query(
      `SELECT v.id, v.sprite_id, COALESCE(v.rarity, s.rarity) AS rarity
       FROM sprite_variants v JOIN sprites s ON s.id = v.sprite_id
       ORDER BY v.id LIMIT 1`
    );
    assert.ok(variantRes.rows.length);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;
    const localDay = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dayNum}`;
    };
    const day = localDay(new Date());
    const dayPrev = localDay(new Date(Date.now() - 8 * 86400000));

    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate, not_owned_user_count,
         priority_added_7d, priority_added_30d, catalogue_version
       ) VALUES
         ($1::date, $3, 320, 18, 200, 90, 320, 5.63, 45, 200, 84, 156, '2026.07.18-1'),
         ($2::date, $3, 300, 10, 180, 42, 300, 3.2, 23, 180, 20, 40, '2026.07.10-1')
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         eligible_user_count = EXCLUDED.eligible_user_count,
         owner_user_count = EXCLUDED.owner_user_count,
         missing_user_count = EXCLUDED.missing_user_count,
         priority_user_count = EXCLUDED.priority_user_count,
         sample_size = EXCLUDED.sample_size,
         ownership_rate = EXCLUDED.ownership_rate,
         priority_rate = EXCLUDED.priority_rate,
         not_owned_user_count = EXCLUDED.not_owned_user_count,
         priority_added_7d = EXCLUDED.priority_added_7d,
         priority_added_30d = EXCLUDED.priority_added_30d,
         catalogue_version = EXCLUDED.catalogue_version`,
      [day, dayPrev, variantId]
    );
    // Isolate étape 81 gate: only one interest day for this variant.
    await pool.query(`DELETE FROM variant_interest_daily WHERE variant_id = $1`, [variantId]);
    await pool.query(
      `INSERT INTO variant_interest_daily (
         metric_date, variant_id, priority_user_count, ownership_rate,
         interest_score, sample_size, change_7d, trend, catalogue_version
       ) VALUES ($1::date, $2, 90, 5.63, 78, 320, 30, 'strongly_rising', '2026.07.18-1')
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         interest_score = 78, sample_size = 320, trend = 'strongly_rising', change_7d = 30`,
      [day, variantId]
    );

    const std = await getStandardCommunityVariantResponse(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(std.variantId, variantId);
    assert.strictEqual(std.asOf, day);
    assert.ok(std.community);
    assert.strictEqual(std.community.eligibleCollectionCount, 320);
    assert.strictEqual(std.community.ownerCount, 18);
    assert.strictEqual(std.community.ownershipRate, 5.63);
    assert.strictEqual(std.community.priorityRateAmongMissing, 45);
    assert.strictEqual(std.community.priorityAdds7d, 84);
    assert.strictEqual(std.community.interestScore, 78);
    // Étape 81 — single-day fixture is below min history → no trend label yet.
    assert.strictEqual(std.community.trend, null);
    assert.ok(std.publicDisplay.trend.includes("Pas encore assez"));
    assert.strictEqual(std.dataQuality.minimumSampleReached, true);
    assert.ok(std.publicDisplay.ownership.includes("5,6"));
    assert.ok(std.publicDisplay.priority.includes("45"));
    assert.ok(std.raritySeparation.ownershipLabel.includes("sprite-index"));
    assert.ok(std.disclaimer.includes("sprite-index"));

    // Étape 79 — official vs community separated.
    assert.ok("official" in std);
    assert.ok(std.raritySeparation.note);

    const hist = await getVariantCommunityHistory(pool, variantId, {
      days: 30,
      level: "aggregated_internal"
    });
    assert.strictEqual(hist.showHistory, true);
    assert.ok(hist.series.length >= 2);
    assert.ok(hist.ownership.evolutionLabel.includes("points"));
    assert.ok(hist.priorities.label.includes("priorités"));

    const board = await getCommunityTrendsBoard(pool, {
      metricDate: day,
      limit: 5,
      level: "aggregated_internal"
    });
    assert.ok(board.disclaimer.includes("sprite-index"));
    assert.ok(board.sections.mostOwned);
    assert.ok(board.sections.rarestInSpriteIndex);
    assert.ok(board.sections.mostSought);
    assert.ok(board.sections.mostPriorityAdds);
    assert.ok(board.sections.strongestRisers);
    assert.ok(board.sections.mostCompared);

    // HTTP routes (if server restarted with routes-sprite-graph).
    const apiRes = await fetch(`${API}/sprite-graph/variants/${encodeURIComponent(variantId)}/community`);
    if (apiRes.ok) {
      const body = await apiRes.json();
      assert.strictEqual(body.variantId, variantId);
      assert.ok(body.disclaimer);
    }
    const trendsRes = await fetch(`${API}/sprite-graph/trends?limit=5`);
    if (trendsRes.ok) {
      const body = await trendsRes.json();
      assert.ok(body.sections);
      assert.ok(body.disclaimer.includes("sprite-index"));
    }
    const spriteRes = await fetch(`${API}/sprite-graph/sprites/${encodeURIComponent(spriteId)}/community`);
    if (spriteRes.ok) {
      const body = await spriteRes.json();
      assert.strictEqual(body.spriteId, spriteId);
      assert.ok(body.officialRarityLabel == null || body.officialRarityLabel.includes("Rareté officielle"));
    }
  }
};
