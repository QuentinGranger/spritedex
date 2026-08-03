"use strict";

const { EARLY_COLLECTOR_BEFORE } = require("./content");

const BADGE_SEED = [
  {
    code: "first_collection",
    nameKey: "badge.first_collection.name",
    descriptionKey: "badge.first_collection.description",
    category: "collection",
    iconKey: "badge.first_collection",
    ruleType: "first_owned_transition",
    ruleConfig: {},
    verificationStatus: "system_confirmed",
    isRevocable: false
  },
  {
    code: "collection_25",
    nameKey: "badge.collection_25.name",
    descriptionKey: "badge.collection_25.description",
    category: "progression",
    iconKey: "badge.collection_25",
    ruleType: "completion_threshold",
    ruleConfig: { threshold: 25 },
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "collection_50",
    nameKey: "badge.collection_50.name",
    descriptionKey: "badge.collection_50.description",
    category: "progression",
    iconKey: "badge.collection_50",
    ruleType: "completion_threshold",
    ruleConfig: { threshold: 50 },
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "collection_75",
    nameKey: "badge.collection_75.name",
    descriptionKey: "badge.collection_75.description",
    category: "progression",
    iconKey: "badge.collection_75",
    ruleType: "completion_threshold",
    ruleConfig: { threshold: 75 },
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "collection_100",
    nameKey: "badge.collection_100.name",
    descriptionKey: "badge.collection_100.description",
    category: "progression",
    iconKey: "badge.collection_100",
    ruleType: "completion_threshold",
    ruleConfig: { threshold: 100 },
    // Declared: computed from a self-declared collection.
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "explorer",
    nameKey: "badge.explorer.name",
    descriptionKey: "badge.explorer.description",
    category: "collection",
    iconKey: "badge.explorer",
    ruleType: "discovered_sprite_count",
    ruleConfig: { min: 5 },
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "reliable_collection",
    nameKey: "badge.reliable_collection.name",
    descriptionKey: "badge.reliable_collection.description",
    category: "collection",
    iconKey: "badge.reliable_collection",
    ruleType: "reliability_level",
    ruleConfig: { equals: "complete" },
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "squad_member",
    nameKey: "badge.squad_member.name",
    descriptionKey: "badge.squad_member.description",
    category: "social",
    iconKey: "badge.squad_member",
    ruleType: "squad_count",
    ruleConfig: { min: 1 },
    verificationStatus: "system_confirmed",
    isRevocable: false
  },
  {
    code: "squad_founder",
    nameKey: "badge.squad_founder.name",
    descriptionKey: "badge.squad_founder.description",
    category: "social",
    iconKey: "badge.squad_founder",
    // Étape 43 — not awarded on create alone; see userQualifiesAsSquadFounder.
    ruleType: "squad_founder_qualified",
    ruleConfig: { minOtherMembers: 1, minAgeHours: 24 },
    verificationStatus: "system_confirmed",
    isRevocable: false
  },
  {
    code: "complementary_collection",
    nameKey: "badge.complementary_collection.name",
    descriptionKey: "badge.complementary_collection.description",
    category: "social",
    iconKey: "badge.complementary_collection",
    ruleType: "complementary_collection",
    ruleConfig: {
      minReliability: 80,
      minExclusiveOwned: 10,
      minUnionGainPoints: 5,
      minAccountAgeHours: 24
    },
    verificationStatus: "system_confirmed",
    isRevocable: false
  },
  {
    code: "archivist",
    nameKey: "badge.archivist.name",
    descriptionKey: "badge.archivist.description",
    category: "collection",
    iconKey: "badge.archivist",
    ruleType: "archivist",
    ruleConfig: { minCoverage: 90, minVersions: 3, maxGapDays: 30 },
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "early_collector",
    nameKey: "badge.early_collector.name",
    descriptionKey: "badge.early_collector.description",
    category: "legacy",
    iconKey: "badge.early_collector",
    ruleType: "early_collector",
    ruleConfig: { before: EARLY_COLLECTOR_BEFORE },
    verificationStatus: "system_confirmed",
    isRevocable: false,
    freezeRuleConfig: true
  },
  {
    code: "all_rarities",
    nameKey: "badge.all_rarities.name",
    descriptionKey: "badge.all_rarities.description",
    category: "collection",
    iconKey: "badge.all_rarities",
    ruleType: "all_rarities",
    ruleConfig: {},
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "event_completed",
    nameKey: "badge.event_completed.name",
    descriptionKey: "badge.event_completed.description",
    category: "events",
    iconKey: "badge.event_completed",
    // Family badge — awarded with context_type=event_version (Étape 50).
    ruleType: "event_completed_family",
    ruleConfig: {},
    verificationStatus: "declared",
    isRevocable: false
  },
  {
    code: "social",
    nameKey: "badge.social.name",
    descriptionKey: "badge.social.description",
    category: "social",
    iconKey: "badge.social",
    ruleType: "friend_count",
    ruleConfig: { min: 1 },
    verificationStatus: "system_confirmed",
    isRevocable: false
  },
  {
    // Legacy generic event badge — kept for old unlocks; new awards use event_completed.
    code: "event_complete",
    nameKey: "badge.event_complete.name",
    descriptionKey: "badge.event_complete.description",
    category: "events",
    iconKey: "badge.event_complete",
    ruleType: "events_completed_count",
    ruleConfig: { min: 1 },
    verificationStatus: "declared",
    isRevocable: false,
    isHidden: true
  }
];

const MILESTONE_BY_CODE = Object.freeze({
  collection_25: 25,
  collection_50: 50,
  collection_75: 75,
  collection_100: 100
});

/** Legacy achievement_id → new badge code */
const LEGACY_CODE_MAP = Object.freeze({
  first_owned: "first_collection",
  collector_25: "collection_25",
  collector_50: "collection_50",
  collector_90: "collection_75",
  collector_100: "collection_100"
});

module.exports = { BADGE_SEED, MILESTONE_BY_CODE, LEGACY_CODE_MAP };
