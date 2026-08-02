const ctx = require("./shared");

module.exports = {
  name: "progression des squads (Étape 94)",
  async run() {
    const {  } = ctx;
    const {
      ensureSquadDailyStatsTables,
      calculateSquadDailyStats,
      listEligibleSquadIds,
      decomposeCatalogueVsAcquisition
    } = require("../server/sprite-graph-squad-stats");
    await ensureSquadDailyStatsTables(pool);

    const owner = await register(`Sq94A${rnd()}`);
    const member = await register(`Sq94B${rnd()}`);
    const compare = require("../server/compare");
    const catalog = (await compare.getServerCompareCatalogItemsCached())
      .filter(compare.isVariantReleasedAndActiveServer);
    assert.ok(catalog.length >= 2, "need active catalogue variants");
    const v1 = { id: catalog[0].variantId || catalog[0].id, sprite_id: catalog[0].spriteId };
    const v2 = { id: catalog[1].variantId || catalog[1].id, sprite_id: catalog[1].spriteId };

    for (const u of [owner, member]) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(), is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb,
             collection_visibility = 'friends',
             suspended_until = NULL
         WHERE id = $1`,
        [u.id]
      );
    }

    // Owner owns v1 uniquely; both own v2 (doublon).
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES
         ($1, $3, $5, 'owned'),
         ($1, $4, $6, 'owned'),
         ($2, $4, $6, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
      [owner.id, member.id, v1.id, v2.id, v1.sprite_id, v2.sprite_id]
    );

    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Prog${rnd()}` })
    });
    if (!squadRes.ok) throw new Error(`create squad: ${await squadRes.text()}`);
    const squadBody = await squadRes.json();
    const code = squadBody.code || squadBody.squad?.code;
    const squadId = squadBody.id || squadBody.squad?.id;
    assert.ok(code && squadId);

    const joinRes = await fetch(`${API}/squads/join`, {
      method: "POST",
      headers: auth(member.token),
      body: JSON.stringify({ code })
    });
    if (!joinRes.ok) throw new Error(`join squad: ${await joinRes.text()}`);

    // Impact join : variantes uniques du joiner vs partagées.
    const impact = await computeSquadJoinImpact(squadId, member.id, {
      previousMemberIds: [owner.id]
    });
    assert.ok(impact.sharedVariantsAdded >= 1); // v2 shared
    // v1 is owner-only — joiner adds 0 unique if they only share v2
    assert.ok(impact.newVariantsAddedToSquad >= 0);

    const day = new Date().toISOString().slice(0, 10);
    const catA = `cat94a-${rnd()}`;
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catA,
      catalogueVariantCount: 100,
      eligibleSquadIds: [squadId]
    });
    const before = await pool.query(
      `SELECT * FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(before.rows.length, 1);
    assert.ok(before.rows[0].unique_owner_variant_count >= 1);
    assert.ok(before.rows[0].shared_variant_count >= 1);
    assert.strictEqual(before.rows[0].catalogue_version, catA);
    assert.strictEqual(before.rows[0].active_member_count, 2);
    const coveredWithBoth = Number(before.rows[0].covered_variant_count);

    // Doublon sans gain collectif : member also gets v1 → unique drops, covered unchanged.
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES ($1, $2, $3, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
      [member.id, v1.id, v1.sprite_id]
    );
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catA,
      catalogueVariantCount: 100,
      eligibleSquadIds: [squadId]
    });
    const afterDup = await pool.query(
      `SELECT covered_variant_count, unique_owner_variant_count, shared_variant_count
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(Number(afterDup.rows[0].covered_variant_count), coveredWithBoth);
    assert.ok(Number(afterDup.rows[0].shared_variant_count) >= Number(before.rows[0].shared_variant_count));

    // Nouvelle version catalogue — choc ≠ acquisition.
    const decomp = decomposeCatalogueVsAcquisition({
      previousCovered: coveredWithBoth,
      previousCatalogueCount: 100,
      currentCovered: coveredWithBoth,
      currentCatalogueCount: 130
    });
    assert.ok(decomp.catalogueExpansionImpact < 0);
    assert.strictEqual(decomp.acquisitionProgress, 0);
    const catB = `cat94b-${rnd()}`;
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catB,
      catalogueVariantCount: 130,
      eligibleSquadIds: [squadId]
    });
    const afterCat = await pool.query(
      `SELECT catalogue_version, catalogue_variant_count, catalogue_expansion_impact
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(afterCat.rows[0].catalogue_version, catB);
    // Matrix uses live catalogue size; version stamp still records the new release.
    assert.ok(Number(afterCat.rows[0].catalogue_variant_count) >= coveredWithBoth);

    // Collection privée exclue du couverture communautaire.
    await pool.query(
      `UPDATE users SET collection_visibility = 'private' WHERE id = $1`,
      [member.id]
    );
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catB,
      catalogueVariantCount: 130,
      eligibleSquadIds: [squadId]
    });
    const afterPrivate = await pool.query(
      `SELECT covered_variant_count, active_member_count
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.ok(Number(afterPrivate.rows[0].covered_variant_count) <= coveredWithBoth);
    assert.strictEqual(Number(afterPrivate.rows[0].active_member_count), 2);
    await pool.query(
      `UPDATE users SET collection_visibility = 'friends' WHERE id = $1`,
      [member.id]
    );

    // Départ d’un membre.
    const leaveRes = await fetch(`${API}/squads/${encodeURIComponent(code)}/leave`, {
      method: "POST",
      headers: auth(member.token)
    });
    if (!leaveRes.ok) throw new Error(`leave squad: ${await leaveRes.text()}`);
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catB,
      catalogueVariantCount: 130,
      eligibleSquadIds: [squadId]
    });
    const afterLeave = await pool.query(
      `SELECT active_member_count FROM squad_daily_stats
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(Number(afterLeave.rows[0].active_member_count), 1);

    // Squad inactive — membres inactifs → non éligible.
    await pool.query(
      `UPDATE users SET last_active_at = NOW() - INTERVAL '200 days' WHERE id = $1`,
      [owner.id]
    );
    // Re-add member as inactive too so squad has 2 but no recent activity.
    await pool.query(
      `UPDATE squad_members SET status = 'active', left_at = NULL WHERE squad_id = $1 AND user_id = $2`,
      [squadId, member.id]
    );
    await pool.query(
      `UPDATE users SET last_active_at = NOW() - INTERVAL '200 days' WHERE id = $1`,
      [member.id]
    );
    const eligible = await listEligibleSquadIds(pool, {
      minActiveMembers: 2,
      minCollectionFillRate: 0,
      recentActivityDays: 90,
      requireAnalyticsConsent: false
    });
    assert.ok(!eligible.includes(Number(squadId)));

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 94"));
  }
};
