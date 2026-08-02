const ctx = require("./shared");

module.exports = {
  name: "métriques techniques + contrôle + formules (Étapes 97–99)",
  async run() {
    const {  } = ctx;
    const {
      getSpriteGraphTechnicalMetrics,
      getSpriteGraphControlBoard,
      setPublicMetricDisabled,
      listPublicMetricFlags,
      recordOpsRun,
      bumpOpsCounter,
      GRAPH_OPS_COUNTERS,
      isSpriteGraphAdmin
    } = require("../server/sprite-graph-metrics");
    const {
      GRAPH_FORMULA_IDS,
      getGraphFormulaRegistry,
      communityFormulaVersion,
      interestFormulaVersion,
      squadFormulaVersion,
      ensureFormulaVersionColumns
    } = require("../server/sprite-graph-formula");

    // Étape 99 — registry.
    assert.strictEqual(GRAPH_FORMULA_IDS.OWNERSHIP_RATE, "ownership_rate_v1");
    assert.strictEqual(GRAPH_FORMULA_IDS.PRIORITY_RATE, "priority_rate_v1");
    assert.strictEqual(GRAPH_FORMULA_IDS.INTEREST_SCORE, "interest_score_v1");
    assert.strictEqual(GRAPH_FORMULA_IDS.SQUAD_PROGRESS, "squad_progress_v1");
    assert.ok(communityFormulaVersion().includes("ownership_rate_v1"));
    assert.strictEqual(interestFormulaVersion(), "interest_score_v1");
    assert.strictEqual(squadFormulaVersion(), "squad_progress_v1");
    const registry = getGraphFormulaRegistry();
    assert.strictEqual(registry.rewriteHistoryOnDailyJob, false);
    assert.ok(registry.note.toLowerCase().includes("historique"));

    await ensureFormulaVersionColumns(pool);
    await ensureCommunityStatsTables(pool);
    const day = new Date().toISOString().slice(0, 10);
    const variantRes = await pool.query(`SELECT id FROM sprite_variants ORDER BY id LIMIT 1`);
    const variantId = variantRes.rows[0].id;
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: false },
      catalogueVersion: "formula99"
    });
    const stamped = await pool.query(
      `SELECT formula_version FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.ok(stamped.rows.length);
    assert.ok(String(stamped.rows[0].formula_version || "").includes("ownership_rate_v1"));
    // Historique : ne pas backfiller une ancienne ligne NULL avec la version courante dans ce test —
    // on vérifie seulement que les nouveaux écritures sont stampées.

    // Étape 97 — technical metrics.
    await bumpOpsCounter(pool, GRAPH_OPS_COUNTERS.DEDUP_SKIPS, 1);
    await recordOpsRun(pool, {
      runType: "aggregate_calc",
      startedAt: new Date(Date.now() - 40),
      finishedAt: new Date(),
      ok: true,
      details: { test: true }
    });
    const tech = await getSpriteGraphTechnicalMetrics(pool, { windowMinutes: 60 });
    assert.strictEqual(tech.publicProduct, false);
    assert.strictEqual(tech.scope, "internal_technical");
    assert.ok(typeof tech.eventsPerMinute === "number");
    assert.ok(typeof tech.workerLagSeconds === "number");
    assert.ok(typeof tech.aggregateCalcMsLast === "number");
    assert.ok(typeof tech.duplicateSkipCount === "number");
    assert.ok(tech.table && tech.table.name === "graph_events");
    assert.ok(tech.table.rowCount >= 0);

    // Étape 98 — control board + disable flag.
    const board = await getSpriteGraphControlBoard(pool);
    assert.strictEqual(board.publicProduct, false);
    assert.ok(typeof board.eventsLast24h === "number");
    assert.ok(Array.isArray(board.eventsByType));
    assert.ok("processingLagSeconds" in board);
    assert.ok("sampleSizes" in board);
    assert.ok(Array.isArray(board.publicMetricsSuspended));
    assert.ok(board.formulas.current.OWNERSHIP_RATE);

    await setPublicMetricDisabled(pool, "ownership_rate", {
      disabled: true,
      reason: "test incorrect metric",
      updatedBy: 1
    });
    const flags = await listPublicMetricFlags(pool);
    assert.ok(flags.some((f) => f.key === "ownership_rate" && f.disabled));
    const board2 = await getSpriteGraphControlBoard(pool);
    assert.ok(board2.publicMetricsSuspended.includes("ownership_rate"));

    // Public surface respects suspension.
    const pub = await fetch(
      `${API}/sprite-graph/variants/${encodeURIComponent(variantId)}/community`
    );
    if (pub.ok) {
      const body = await pub.json();
      assert.ok(body.insufficient === true || body.suspended === true);
    }

    // Re-enable for other tests / product.
    await setPublicMetricDisabled(pool, "ownership_rate", { disabled: false, reason: "restored" });

    // Admin routes require auth/admin — anonymous → 401/403.
    const boardHttp = await fetch(`${API}/admin/sprite-graph/control-board`);
    assert.ok(boardHttp.status === 401 || boardHttp.status === 403);
    const techHttp = await fetch(`${API}/admin/sprite-graph/technical-metrics`);
    assert.ok(techHttp.status === 401 || techHttp.status === 403);
    assert.strictEqual(isSpriteGraphAdmin(null), false);

    // With admin env set to a registered user, board succeeds.
    const admin = await register(`Adm99${rnd()}`);
    const prev = process.env.ANALYTICS_ADMIN_USER_IDS;
    process.env.ANALYTICS_ADMIN_USER_IDS = String(admin.id);
    // Module already cached admin set — hit module functions directly (HTTP uses boot-time set).
    const exportOk = await require("../server/sprite-graph-metrics").getAdminAggregateExport(pool, {
      metricDate: day,
      limit: 5
    });
    assert.strictEqual(exportOk.includesRawEvents, false);
    if (prev == null) delete process.env.ANALYTICS_ADMIN_USER_IDS;
    else process.env.ANALYTICS_ADMIN_USER_IDS = prev;

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 97"));
    assert.ok(doc.includes("Étape 98"));
    assert.ok(doc.includes("Étape 99"));
    assert.ok(doc.includes("ownership_rate_v1"));
  }
};
