"use strict";

// ── Sprite Graph simple rules + scoring policy (Étapes 86–87) ────────────────
// Explicit boolean rules only — no complex models, no hidden user-value scores.

/**
 * Étape 87 — never invent global scores that rank people.
 * The Graph measures behaviours and relations, not personal worth.
 */
const FORBIDDEN_USER_VALUE_SCORES = Object.freeze([
  "collector_value_score",
  "score_de_valeur_du_collectionneur",
  "social_quality_score",
  "score_de_qualite_sociale",
  "prestige_score",
  "score_de_prestige",
  "user_worth_score",
  "hidden_social_score"
]);

const FORBIDDEN_USER_VALUE_SCORE_SET = new Set(FORBIDDEN_USER_VALUE_SCORES);

/** Default thresholds for the two starter rules (env-overridable). */
const SIMPLE_RULE_THRESHOLDS = Object.freeze({
  lowOwnershipRateMax: (() => {
    const n = Number(process.env.GRAPH_RULE_LOW_OWNERSHIP_MAX);
    return Number.isFinite(n) && n > 0 ? n : 10;
  })(),
  eventEndingSoonHours: (() => {
    const n = Number(process.env.GRAPH_RULE_EVENT_ENDING_HOURS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 48;
  })(),
  complementaryVariantsMin: (() => {
    const n = Number(process.env.GRAPH_RULE_COMPLEMENTARY_MIN);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
  })(),
  collectionFillMinPct: (() => {
    const n = Number(process.env.GRAPH_RULE_FILL_MIN_PCT);
    return Number.isFinite(n) && n > 0 ? n : 80;
  })()
});

/**
 * Étape 86 — declarative starter rules (AND of conditions).
 */
const SIMPLE_GRAPH_RULES = Object.freeze([
  Object.freeze({
    id: "strong_priority_alert",
    label: "Alerte forte priorité + rareté communautaire + événement finissant",
    conditions: Object.freeze([
      "is_priority",
      "low_ownership_rate",
      "event_ending_soon"
    ]),
    outcome: Object.freeze({
      kind: "alert",
      strength: "strong",
      surface: "personalized_notifications",
      message: "Alerte forte : variante prioritaire, peu possédée, événement bientôt terminé."
    })
  }),
  Object.freeze({
    id: "suggest_comparison",
    label: "Suggestion de comparaison entre deux collections complémentaires",
    conditions: Object.freeze([
      "complementary_variants_gte_15",
      "both_collections_fill_gte_80"
    ]),
    outcome: Object.freeze({
      kind: "suggestion",
      action: "compare",
      surface: "complementary_friends",
      message: "Suggestion de comparaison : plus de 15 variantes complémentaires et collections bien renseignées."
    })
  })
]);

function getGraphScoringPolicy() {
  return {
    version: 1,
    measuresBehavioursAndRelations: true,
    ranksPeople: false,
    allowsHiddenUserValueScores: false,
    forbiddenUserValueScores: [...FORBIDDEN_USER_VALUE_SCORES],
    note: "Le Graph doit mesurer des comportements et des relations, pas classer la valeur des personnes."
  };
}

/**
 * Recursively scan a payload for forbidden score keys / objects.
 * @returns {{ ok: boolean, violations: string[] }}
 */
function assertNoForbiddenUserValueScores(payload, { path = "$" } = {}) {
  const violations = [];
  const walk = (value, currentPath) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${currentPath}[${i}]`));
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = `${currentPath}.${key}`;
      if (FORBIDDEN_USER_VALUE_SCORE_SET.has(key)) {
        violations.push(next);
      }
      // Also catch camel/snake aliases commonly used for prestige-style ranks.
      const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
      if (
        normalized === "prestige_score"
        || normalized === "collector_value_score"
        || normalized === "social_quality_score"
        || normalized === "hidden_social_score"
        || normalized === "user_worth_score"
      ) {
        if (!violations.includes(next)) violations.push(next);
      }
      walk(child, next);
    }
  };
  walk(payload, path);
  return { ok: violations.length === 0, violations };
}

function hoursUntil(isoOrDate) {
  if (isoOrDate == null) return null;
  const t = isoOrDate instanceof Date ? isoOrDate.getTime() : Date.parse(String(isoOrDate));
  if (!Number.isFinite(t)) return null;
  return (t - Date.now()) / 3600000;
}

/**
 * Normalize caller facts into boolean condition map.
 */
function resolveSimpleRuleConditions(facts = {}, thresholds = SIMPLE_RULE_THRESHOLDS) {
  const ownershipRate = facts.ownershipRate != null
    ? Number(facts.ownershipRate)
    : (facts.communityOwnershipRate != null ? Number(facts.communityOwnershipRate) : null);
  const endingInHours = facts.eventEndingInHours != null
    ? Number(facts.eventEndingInHours)
    : hoursUntil(facts.eventEndsAt || facts.eventEndAt);
  const complementary = Number(
    facts.complementaryVariantCount
      ?? facts.complementaryVariants
      ?? 0
  );
  const fillA = Number(facts.collectionFillPctA ?? facts.fillRateA ?? 0);
  const fillB = Number(facts.collectionFillPctB ?? facts.fillRateB ?? 0);
  const isPriority = facts.isPriority === true
    || String(facts.status || "").toLowerCase() === "priority"
    || facts.userPriority === true;

  return {
    is_priority: !!isPriority,
    low_ownership_rate: ownershipRate != null
      && Number.isFinite(ownershipRate)
      && ownershipRate <= thresholds.lowOwnershipRateMax,
    event_ending_soon: endingInHours != null
      && Number.isFinite(endingInHours)
      && endingInHours >= 0
      && endingInHours <= thresholds.eventEndingSoonHours,
    complementary_variants_gte_15: complementary >= thresholds.complementaryVariantsMin,
    both_collections_fill_gte_80: fillA >= thresholds.collectionFillMinPct
      && fillB >= thresholds.collectionFillMinPct,
    _meta: {
      ownershipRate,
      endingInHours,
      complementary,
      fillA,
      fillB,
      thresholds
    }
  };
}

/**
 * Étape 86 — evaluate simple AND-rules against explicit facts.
 * No ML, no user prestige scoring.
 */
function evaluateSimpleGraphRules(facts = {}, {
  rules = SIMPLE_GRAPH_RULES,
  thresholds = SIMPLE_RULE_THRESHOLDS
} = {}) {
  const conditions = resolveSimpleRuleConditions(facts, thresholds);
  const matches = [];

  for (const rule of rules) {
    const missing = rule.conditions.filter((c) => !conditions[c]);
    if (missing.length) continue;
    matches.push({
      ruleId: rule.id,
      label: rule.label,
      conditions: [...rule.conditions],
      outcome: { ...rule.outcome },
      // Explicitly secondary / non-personal-worth.
      ranksPeople: false
    });
  }

  const result = {
    engine: "simple_rules",
    version: 1,
    complexModels: false,
    ranksPeople: false,
    matches,
    evaluatedConditions: {
      is_priority: conditions.is_priority,
      low_ownership_rate: conditions.low_ownership_rate,
      event_ending_soon: conditions.event_ending_soon,
      complementary_variants_gte_15: conditions.complementary_variants_gte_15,
      both_collections_fill_gte_80: conditions.both_collections_fill_gte_80
    },
    scoringPolicy: getGraphScoringPolicy()
  };

  const gate = assertNoForbiddenUserValueScores(result);
  if (!gate.ok) {
    throw new Error(`forbidden_user_value_score:${gate.violations.join(",")}`);
  }
  return result;
}

module.exports = {
  FORBIDDEN_USER_VALUE_SCORES,
  FORBIDDEN_USER_VALUE_SCORE_SET,
  SIMPLE_RULE_THRESHOLDS,
  SIMPLE_GRAPH_RULES,
  getGraphScoringPolicy,
  assertNoForbiddenUserValueScores,
  resolveSimpleRuleConditions,
  evaluateSimpleGraphRules
};
