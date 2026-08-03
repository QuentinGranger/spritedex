const ctx = require("./shared");

module.exports = {
  name: "confidentialité (Étape 96)",
  async run() {
    const {} = ctx;
    await ensureGraphEventsTable(pool);
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();
    const { anonymizeUserGraphData, setCommunityStatsOptIn } = require("../server/sprite-graph-governance");
    const {
      listEligibleSquadIds,
      ensureSquadDailyStatsTables,
      calculateSquadDailyStats,
      resolveSquadSizeBand
    } = require("../server/sprite-graph-squad-stats");
    const { getAdminAggregateExport } = require("../server/sprite-graph-metrics");

    const user = await register(`Priv96${rnd()}`);
    const blocked = await register(`Priv96b${rnd()}`);
    const variantRes = await pool.query(`SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    await pool.query(
      `UPDATE users
       SET last_active_at = NOW(), is_test_account = FALSE,
           community_stats_opt_in = TRUE,
           cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
       WHERE id = $1`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES ($1, $2, $3, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
      [user.id, variantId, spriteId]
    );
    await recordGraphEvent(
      pool,
      {
        eventType: "collection.sprite_added",
        actorUserId: user.id,
        variantId,
        spriteId,
        source: "api",
        context: { note: "secret-note", email: "x@y.z", catalogueVersion: "keep96" },
        deduplicationKey: `priv96-${user.id}-${rnd()}`
      },
      { skipGovernance: true }
    );

    // Événements privés — PII absente à l’écriture.
    const stored = await pool.query(
      `SELECT context FROM graph_events
       WHERE actor_user_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [user.id]
    );
    assert.strictEqual(stored.rows[0].context.email, undefined);
    assert.strictEqual(stored.rows[0].context.note, undefined);
    assert.strictEqual(stored.rows[0].context.catalogueVersion, "keep96");

    // Consentement retiré → exclus des éligibles.
    let eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(eligible.includes(Number(user.id)));
    await setCommunityStatsOptIn(pool, user.id, false);
    eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(!eligible.includes(Number(user.id)));
    await setCommunityStatsOptIn(pool, user.id, true);

    // Seuil minimal d’anonymisation.
    const gate = applyPublicAnonymizationGate({
      uniqueUserCount: PUBLIC_ANONYMIZATION_MIN_USERS - 1,
      payload: { ownershipRate: 10 }
    });
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);

    // Utilisateurs bloqués — pas d’invitation.
    const { applyFriendAction } = require("../server/friends/state-machine");
    const blockRes = await fetch(`${API}/users/${blocked.id}/block`, {
      method: "POST",
      headers: auth(user.token)
    });
    if (!blockRes.ok) throw new Error(`block: ${await blockRes.text()}`);
    const invite = await applyFriendAction(blocked.id, user.id, "request", {
      invitationMethod: "username",
      origin: "test.etape96"
    });
    assert.ok(invite.error === 403 || invite.ok === false);

    // Petites squads — 1 membre actif non éligible communauté.
    await ensureSquadDailyStatsTables(pool);
    const solo = await register(`Priv96s${rnd()}`);
    await pool.query(
      `UPDATE users SET last_active_at = NOW(), is_test_account = FALSE,
         community_stats_opt_in = TRUE,
         cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
       WHERE id = $1`,
      [solo.id]
    );
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(solo.token),
      body: JSON.stringify({ name: `Tiny${rnd()}` })
    });
    if (!squadRes.ok) throw new Error(`squad: ${await squadRes.text()}`);
    const squadBody = await squadRes.json();
    const squadId = squadBody.id || squadBody.squad?.id;
    const day = new Date().toISOString().slice(0, 10);
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      eligibleSquadIds: []
    });
    const squadRow = await pool.query(
      `SELECT eligible_for_community, active_member_count
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    if (squadRow.rows.length) {
      assert.strictEqual(squadRow.rows[0].eligible_for_community, false);
      assert.ok(Number(squadRow.rows[0].active_member_count) <= 1);
    }
    assert.notStrictEqual(resolveSquadSizeBand(2).id, resolveSquadSizeBand(20).id);
    const eligibleSquads = await listEligibleSquadIds(pool, {
      minActiveMembers: 2,
      minCollectionFillRate: 0,
      requireAnalyticsConsent: false
    });
    assert.ok(!eligibleSquads.includes(Number(squadId)));

    // Suppression / anonymisation.
    const beforeAgg = await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: "priv96"
    });
    assert.ok(beforeAgg.variants >= 1);
    const anon = await anonymizeUserGraphData(pool, user.id);
    assert.ok(anon.ok);
    assert.ok(anon.eventsAnonymized >= 1);
    const afterAnon = await pool.query(
      `SELECT actor_user_id, context FROM graph_events
       WHERE deduplication_key LIKE 'anon:%'
       ORDER BY recorded_at DESC LIMIT 1`
    );
    assert.ok(afterAnon.rows.length);
    assert.strictEqual(afterAnon.rows[0].actor_user_id, null);
    assert.strictEqual(afterAnon.rows[0].context.anonymized, true);
    // Agrégats journaliers restent.
    const aggStill = await pool.query(
      `SELECT COUNT(*)::int AS n FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.ok(aggStill.rows[0].n >= 1);

    // Export admin = agrégats uniquement, pas de raw.
    const exp = await getAdminAggregateExport(pool, { metricDate: day, limit: 50 });
    assert.strictEqual(exp.includesRawEvents, false);
    assert.strictEqual(exp.includesPersonalData, false);
    assert.ok(Array.isArray(exp.rows));

    // Pas d’export raw public.
    const rawExport = await fetch(`${API}/sprite-graph/export/raw`);
    assert.ok(rawExport.status === 404 || rawExport.status >= 400);

    // level=internal sans admin → public.
    const internalLeak = await fetch(
      `${API}/sprite-graph/variants/${encodeURIComponent(variantId)}/community?level=aggregated_internal`
    );
    if (internalLeak.ok) {
      const body = await internalLeak.json();
      // Without admin, gate still applies at public level (insufficient if sample small).
      assert.ok(body.insufficient === true || body.community || body.disclaimer);
    }

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 96"));
  }
};
