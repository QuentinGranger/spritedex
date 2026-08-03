const ctx = require("./shared");

module.exports = {
  name: "catalogue métriques + validation v1 (Étapes 100–101)",
  async run() {
    const {} = ctx;
    const {
      GRAPH_METRIC_CATALOG,
      getGraphMetricCatalog,
      getGraphMetricDoc,
      METRIC_CATALOG_LAST_REVIEW
    } = require("../server/sprite-graph-metric-catalog");
    const { GRAPH_V1_VALIDATION_CRITERIA, evaluateGraphV1Readiness } = require("../server/sprite-graph-v1-validation");

    // Étape 100 — chaque métrique a les champs requis.
    const requiredFields = [
      "id",
      "name",
      "description",
      "formula",
      "eligiblePopulation",
      "timeWindow",
      "minimumThreshold",
      "version",
      "limits",
      "lastModified"
    ];
    assert.ok(GRAPH_METRIC_CATALOG.length >= 8);
    for (const m of GRAPH_METRIC_CATALOG) {
      for (const f of requiredFields) {
        assert.ok(m[f] != null, `missing ${f} on ${m.id}`);
      }
      assert.ok(Array.isArray(m.limits));
      assert.ok(m.lastModified);
    }

    const ownership = getGraphMetricDoc("ownership_rate");
    assert.ok(ownership);
    assert.strictEqual(ownership.name, "Taux de possession communautaire");
    assert.ok(ownership.formula.includes("divisé par"));
    assert.ok(ownership.formula.toLowerCase().includes("posséd"));
    assert.strictEqual(ownership.version, "ownership_rate_v1");
    assert.strictEqual(ownership.lastModified, METRIC_CATALOG_LAST_REVIEW);

    const catalog = getGraphMetricCatalog();
    assert.ok(catalog.count >= 8);
    const publicOnly = getGraphMetricCatalog({ surface: "public" });
    assert.ok(publicOnly.metrics.every((m) => m.surface === "public"));
    const internalOnly = getGraphMetricCatalog({ surface: "internal" });
    assert.ok(internalOnly.metrics.every((m) => m.surface === "internal"));
    assert.ok(internalOnly.metrics.some((m) => m.id === "events_per_minute"));

    // Étape 101 — critères de validation.
    assert.ok(GRAPH_V1_VALIDATION_CRITERIA.length >= 13);
    const labels = GRAPH_V1_VALIDATION_CRITERIA.map((c) => c.label);
    assert.ok(labels.some((l) => l.includes("huit événements")));
    assert.ok(labels.some((l) => l.includes("dédupliqu")));
    assert.ok(labels.some((l) => l.includes("côté serveur")));
    assert.ok(labels.some((l) => l.includes("versions")));
    assert.ok(labels.some((l) => l.includes("historisés")));
    assert.ok(labels.some((l) => l.includes("surcomptées")));
    assert.ok(labels.some((l) => l.includes("invitations") && l.includes("squads")));
    assert.ok(labels.some((l) => l.includes("objectifs")));
    assert.ok(labels.some((l) => l.includes("notifications")));
    assert.ok(labels.some((l) => l.includes("rejoués")));
    assert.ok(labels.some((l) => l.includes("inconnues")));
    assert.ok(labels.some((l) => l.includes("anonymisation")));
    assert.ok(labels.some((l) => l.includes("catalogue")));

    const readiness = await evaluateGraphV1Readiness(pool, { includeLiveProbes: true });
    assert.strictEqual(readiness.version, 1);
    assert.strictEqual(readiness.staticReady, true);
    assert.strictEqual(readiness.ready, true);
    assert.ok(
      readiness.criteria.every((c) => c.ok),
      "all static v1 criteria must pass"
    );
    assert.ok(Array.isArray(readiness.liveProbes));
    assert.ok(readiness.metricCatalog.count >= 8);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 100"));
    assert.ok(doc.includes("Étape 101"));
    assert.ok(doc.includes("Taux de possession communautaire"));
    assert.ok(doc.includes("divisé par"));

    const catalogHttp = await fetch(`${API}/admin/sprite-graph/metrics-catalog`);
    assert.ok(catalogHttp.status === 401 || catalogHttp.status === 403);
    const readyHttp = await fetch(`${API}/admin/sprite-graph/v1-readiness`);
    assert.ok(readyHttp.status === 401 || readyHttp.status === 403);
  }
};
