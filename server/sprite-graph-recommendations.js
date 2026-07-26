"use strict";

// ── Sprite Graph recommendation surfaces (Étapes 85–87) ─────────────────────
// v1: reserved surfaces + simple boolean rules only. No complex model pipeline.
// Never emit hidden user-value / prestige scores (Étape 87).

const {
  SIMPLE_GRAPH_RULES,
  evaluateSimpleGraphRules,
  getGraphScoringPolicy,
  assertNoForbiddenUserValueScores,
  FORBIDDEN_USER_VALUE_SCORES
} = require("./sprite-graph-rules");

/**
 * Surfaces the Graph may later feed. Values are documentation / feature flags,
 * not live complex generators.
 */
const FUTURE_GRAPH_RECOMMENDATION_SURFACES = Object.freeze({
  PRIORITY_SUGGESTIONS: "priority_suggestions",
  COMPLEMENTARY_FRIENDS: "complementary_friends",
  SQUAD_MEMBER_SUGGESTIONS: "squad_member_suggestions",
  EVENT_GOALS: "event_goals",
  VARIANT_INTEREST: "variant_interest",
  PERSONALIZED_NOTIFICATIONS: "personalized_notifications"
});

const FUTURE_GRAPH_RECOMMENDATION_SURFACE_SET = new Set(
  Object.values(FUTURE_GRAPH_RECOMMENDATION_SURFACES)
);

/**
 * Étape 85 / 86 / 87 — readiness: simple rules OK, complex auto-gen off.
 */
function getGraphRecommendationReadiness() {
  return {
    version: 1,
    autoGenerate: false,
    simpleRules: true,
    complexModels: false,
    ranksPeople: false,
    note: "La v1 applique des règles booléennes simples ; les modèles complexes et les scores de valeur des personnes sont exclus.",
    simpleRuleIds: SIMPLE_GRAPH_RULES.map((r) => r.id),
    forbiddenUserValueScores: [...FORBIDDEN_USER_VALUE_SCORES],
    scoringPolicy: getGraphScoringPolicy(),
    surfaces: Object.values(FUTURE_GRAPH_RECOMMENDATION_SURFACES).map((id) => ({
      id,
      status: "reserved",
      autoGenerate: false,
      simpleRulesEligible: true
    }))
  };
}

/**
 * Resolve recommendations:
 * - without facts → empty items (hooks only)
 * - with facts → Étape 86 simple rule matches (optional surface filter)
 */
async function resolveGraphRecommendations(_db, _userId, {
  surface = null,
  facts = null
} = {}) {
  if (surface && !FUTURE_GRAPH_RECOMMENDATION_SURFACE_SET.has(surface)) {
    return {
      surface,
      items: [],
      autoGenerate: false,
      complexModels: false,
      ranksPeople: false,
      error: "unknown_surface",
      readiness: getGraphRecommendationReadiness()
    };
  }

  let items = [];
  let ruleEvaluation = null;
  if (facts && typeof facts === "object") {
    ruleEvaluation = evaluateSimpleGraphRules(facts);
    items = ruleEvaluation.matches
      .filter((m) => !surface || m.outcome.surface === surface)
      .map((m) => ({
        id: m.ruleId,
        kind: m.outcome.kind,
        strength: m.outcome.strength || null,
        action: m.outcome.action || null,
        surface: m.outcome.surface,
        message: m.outcome.message,
        source: "simple_rules",
        ranksPeople: false
      }));
  }

  const payload = {
    surface: surface || null,
    items,
    autoGenerate: false,
    complexModels: false,
    ranksPeople: false,
    engine: facts ? "simple_rules" : "hooks_only",
    ruleEvaluation,
    readiness: getGraphRecommendationReadiness()
  };

  const gate = assertNoForbiddenUserValueScores(payload);
  if (!gate.ok) {
    return {
      surface: surface || null,
      items: [],
      autoGenerate: false,
      complexModels: false,
      ranksPeople: false,
      error: "forbidden_user_value_score",
      violations: gate.violations,
      readiness: getGraphRecommendationReadiness()
    };
  }
  return payload;
}

module.exports = {
  FUTURE_GRAPH_RECOMMENDATION_SURFACES,
  FUTURE_GRAPH_RECOMMENDATION_SURFACE_SET,
  getGraphRecommendationReadiness,
  resolveGraphRecommendations
};
