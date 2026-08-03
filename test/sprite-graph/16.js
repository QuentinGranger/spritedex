const ctx = require("./shared");

module.exports = {
  name: "squad_daily_stats + catalogue bias + daily pipeline (Étapes 56–60)",
  async run() {
    const {} = ctx;
    await ensureGraphEventsTable(pool);
    const {
      decomposeCatalogueVsAcquisition,
      ensureSquadDailyStatsTables,
      calculateSquadDailyStats,
      calculateCommunitySquadProgress
    } = require("../server/sprite-graph-squad-stats");
    const { resolveCatalogueContext } = require("../server/sprite-graph-catalogue");
    const { runSpriteGraphDailyPipeline } = require("../server/sprite-graph-daily");

    // Étape 58 — catalogue expansion without acquisitions.
    const decomp = decomposeCatalogueVsAcquisition({
      previousCovered: 85,
      previousCatalogueCount: 100,
      currentCovered: 85,
      currentCatalogueCount: 101.3
    });
    // 85/100 = 85 ; 85/101.3 ≈ 83.91
    assert.strictEqual(decomp.completionRateBeforeCatalogueUpdate, 85);
    assert.ok(Math.abs(decomp.catalogueExpansionImpact - (decomp.completionRateAfterCatalogueUpdate - 85)) < 0.001);
    assert.strictEqual(decomp.acquisitionProgress, 0);

    const sameCat = decomposeCatalogueVsAcquisition({
      previousCovered: 50,
      previousCatalogueCount: 100,
      currentCovered: 55,
      currentCatalogueCount: 100
    });
    assert.strictEqual(sameCat.catalogueExpansionImpact, 0);
    assert.strictEqual(sameCat.acquisitionProgress, 5);

    await ensureSquadDailyStatsTables(pool);
    const cat = await resolveCatalogueContext(pool);
    assert.ok(cat.catalogueVersion);
    assert.ok(cat.catalogueVariantCount >= 0);

    const day = new Date().toISOString().slice(0, 10);
    const owner = await register(`SqStats${rnd()}`);
    const member = await register(`SqStatsM${rnd()}`);
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Stats${rnd()}` })
    });
    assert.ok(squadRes.ok, "create squad");
    const squad = await squadRes.json();
    const squadId = squad.id || squad.squad?.id;
    assert.ok(squadId);

    // Try to add second member if invite/join API allows; otherwise still compute snapshot.
    const inviteRes = await fetch(`${API}/squads/${squadId}/invites`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ username: member.username })
    }).catch(() => null);
    if (inviteRes && inviteRes.ok) {
      const inv = await inviteRes.json();
      const inviteId = inv.id || inv.invite?.id;
      if (inviteId) {
        await fetch(`${API}/squads/invites/${inviteId}/accept`, {
          method: "POST",
          headers: auth(member.token)
        }).catch(() => null);
      }
    }

    const calc = await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: cat.catalogueVersion,
      catalogueVariantCount: cat.catalogueVariantCount,
      eligibleSquadIds: [] // force non-eligible flag; structure still written
    });
    assert.ok(calc.squads >= 1);
    assert.strictEqual(calc.catalogueVersion, cat.catalogueVersion);

    const row = await pool.query(
      `SELECT * FROM squad_daily_stats
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(row.rows.length, 1);
    assert.ok(row.rows[0].active_member_count >= 1);
    assert.ok(row.rows[0].catalogue_variant_count >= 0);
    assert.strictEqual(row.rows[0].catalogue_version, cat.catalogueVersion);
    assert.ok(row.rows[0].covered_variant_count >= 0);
    assert.ok(row.rows[0].unique_owner_variant_count >= 0);
    assert.ok(row.rows[0].shared_variant_count >= 0);

    const snap = await pool.query(
      `SELECT catalogue_version FROM squad_daily_snapshots
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(snap.rows[0]?.catalogue_version, cat.catalogueVersion);

    // Seed eligible row for community average.
    await pool.query(
      `UPDATE squad_daily_stats
       SET eligible_for_community = TRUE, progress_7d = 2.5
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    const progress = await calculateCommunitySquadProgress(pool, {
      metricDate: day,
      windowDays: 7,
      catalogueVersion: cat.catalogueVersion
    });
    assert.ok(progress.eligibleSquadCount >= 1);
    assert.ok(progress.avgCompletionProgress != null);
    assert.strictEqual(progress.catalogueVersion, cat.catalogueVersion);

    // Étape 60 — full pipeline smoke (may be heavy but must complete).
    const pipeline = await runSpriteGraphDailyPipeline(pool, { metricDate: day });
    assert.ok(pipeline.catalogueVersion);
    assert.ok(pipeline.community);
    assert.ok(pipeline.comparison);
    assert.ok(pipeline.popularity);
    assert.ok(pipeline.trends);
    assert.ok(pipeline.squads);
    assert.ok(pipeline.publish);
    assert.ok(pipeline.publish.anonymizationMinUsers >= 1);

    const published = await pool.query(`SELECT * FROM graph_daily_publish WHERE metric_date = $1::date`, [day]);
    assert.strictEqual(published.rows.length, 1);
    assert.strictEqual(published.rows[0].catalogue_version, pipeline.catalogueVersion);

    // Étape 59 — pipeline stamps catalogueVersion; rows only when variants written.
    assert.ok(pipeline.community.catalogueVersion || pipeline.catalogueVersion);
    if (pipeline.community.variants > 0) {
      const cvs = await pool.query(
        `SELECT catalogue_version FROM community_variant_stats
         WHERE metric_date = $1::date
           AND catalogue_version IS NOT NULL
         LIMIT 1`,
        [day]
      );
      assert.ok(cvs.rows.length, "expected stamped community_variant_stats rows");
      assert.strictEqual(cvs.rows[0].catalogue_version, pipeline.catalogueVersion);
    }
  }
};
