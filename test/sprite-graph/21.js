const ctx = require("./shared");

module.exports = {
  name: "règles simples + pas de score social caché (Étapes 86–87)",
  async run() {
    const {  } = ctx;
    const {
      evaluateSimpleGraphRules,
      getGraphScoringPolicy,
      assertNoForbiddenUserValueScores,
      FORBIDDEN_USER_VALUE_SCORES,
      SIMPLE_GRAPH_RULES
    } = require("../server/sprite-graph-rules");
    const {
      getGraphRecommendationReadiness,
      resolveGraphRecommendations
    } = require("../server/sprite-graph-recommendations");

    assert.ok(SIMPLE_GRAPH_RULES.some((r) => r.id === "strong_priority_alert"));
    assert.ok(SIMPLE_GRAPH_RULES.some((r) => r.id === "suggest_comparison"));

    const alert = evaluateSimpleGraphRules({
      isPriority: true,
      ownershipRate: 5.6,
      eventEndingInHours: 12
    });
    assert.strictEqual(alert.engine, "simple_rules");
    assert.strictEqual(alert.complexModels, false);
    assert.strictEqual(alert.ranksPeople, false);
    assert.ok(alert.matches.some((m) => m.ruleId === "strong_priority_alert"));
    assert.ok(alert.matches[0].outcome.message.toLowerCase().includes("alerte"));

    const noAlert = evaluateSimpleGraphRules({
      isPriority: true,
      ownershipRate: 5.6,
      eventEndingInHours: 200
    });
    assert.ok(!noAlert.matches.some((m) => m.ruleId === "strong_priority_alert"));

    const suggest = evaluateSimpleGraphRules({
      complementaryVariantCount: 16,
      collectionFillPctA: 81,
      collectionFillPctB: 90
    });
    assert.ok(suggest.matches.some((m) => m.ruleId === "suggest_comparison"));

    const noSuggest = evaluateSimpleGraphRules({
      complementaryVariantCount: 16,
      collectionFillPctA: 50,
      collectionFillPctB: 90
    });
    assert.ok(!noSuggest.matches.some((m) => m.ruleId === "suggest_comparison"));

    const policy = getGraphScoringPolicy();
    assert.strictEqual(policy.ranksPeople, false);
    assert.strictEqual(policy.allowsHiddenUserValueScores, false);
    assert.ok(FORBIDDEN_USER_VALUE_SCORES.includes("prestige_score"));
    assert.ok(assertNoForbiddenUserValueScores({ interestScore: 12, ownershipRate: 5 }).ok);
    assert.ok(!assertNoForbiddenUserValueScores({ prestigeScore: 99 }).ok);
    assert.ok(!assertNoForbiddenUserValueScores({ collector_value_score: 1 }).ok);

    const readiness = getGraphRecommendationReadiness();
    assert.strictEqual(readiness.simpleRules, true);
    assert.strictEqual(readiness.complexModels, false);
    assert.strictEqual(readiness.ranksPeople, false);

    const withFacts = await resolveGraphRecommendations(pool, null, {
      facts: {
        complementaryVariantCount: 20,
        collectionFillPctA: 85,
        collectionFillPctB: 85
      }
    });
    assert.ok(withFacts.items.some((i) => i.id === "suggest_comparison"));
    assert.strictEqual(withFacts.ranksPeople, false);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 86"));
    assert.ok(doc.includes("Étape 87"));
    assert.ok(doc.includes("score de prestige") || doc.includes("prestige"));

    const rulesRes = await fetch(`${API}/sprite-graph/rules/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isPriority: true,
        ownershipRate: 4,
        eventEndingInHours: 6
      })
    });
    if (rulesRes.ok) {
      const body = await rulesRes.json();
      assert.ok(body.matches.some((m) => m.ruleId === "strong_priority_alert"));
    }
    const policyRes = await fetch(`${API}/sprite-graph/scoring-policy`);
    if (policyRes.ok) {
      const body = await policyRes.json();
      assert.strictEqual(body.ranksPeople, false);
    }
  }
};
