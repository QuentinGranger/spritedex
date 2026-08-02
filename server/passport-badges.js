"use strict";

// Étapes 35–40 — badge_definitions + user_badges (INTEGER user ids).
const { pool } = require("./db");
const fs = require("fs");
const path = require("path");

const VERIFICATION_STATUSES = Object.freeze([
  "declared",
  "system_confirmed",
  "community_verified",
  "officially_verified"
]);

/** French display copy for name_key / description_key. */
const BADGE_COPY = Object.freeze({
  "badge.first_collection.name": "Première collection",
  "badge.first_collection.description": "Vous avez ajouté votre première variante.",
  "badge.collection_25.name": "Collection 25 %",
  "badge.collection_25.description": "Vous avez atteint 25 % de complétion sur le catalogue publié.",
  "badge.collection_50.name": "Collection 50 %",
  "badge.collection_50.description": "Vous avez atteint 50 % de complétion sur le catalogue publié.",
  "badge.collection_75.name": "Collection 75 %",
  "badge.collection_75.description": "Vous avez atteint 75 % de complétion sur le catalogue publié.",
  "badge.collection_100.name": "Collection 100 %",
  "badge.collection_100.description": "Vous avez atteint 100 % de complétion sur une version du catalogue.",
  "badge.explorer.name": "Explorateur",
  "badge.explorer.description": "Vous avez découvert 5 familles de Sprites.",
  "badge.reliable_collection.name": "Collection fiable",
  "badge.reliable_collection.description": "Votre collection est renseignée à au moins 90 %.",
  "badge.squad_member.name": "Esprit d'escouade",
  "badge.squad_member.description": "Vous participez à une squad.",
  "badge.squad_founder.name": "Fondateur de squad",
  "badge.squad_founder.description": "Vous avez créé une squad rejointe par un autre collectionneur et active depuis au moins 24 heures.",
  "badge.complementary_collection.name": "Collection complémentaire",
  "badge.complementary_collection.description": "Votre collection complète réellement celle d’un ami ou coéquipier.",
  "badge.archivist.name": "Archiviste",
  "badge.archivist.description": "Vous avez maintenu une collection complète et à jour pendant trois mises à jour du catalogue.",
  "badge.early_collector.name": "Early Collector",
  "badge.early_collector.description": "Vous faites partie des collectionneurs présents dès le début de sprite-index.",
  "badge.all_rarities.name": "Une variante de chaque rareté",
  "badge.all_rarities.description": "Vous possédez au moins une variante de chaque rareté officielle du catalogue.",
  "badge.event_completed.name": "Événement complété",
  "badge.event_completed.description": "Vous avez complété toutes les variantes d’un événement.",
  "badge.social.name": "Social",
  "badge.social.description": "Vous avez au moins un ami.",
  "badge.event_complete.name": "Événement accompli",
  "badge.event_complete.description": "Vous avez complété au moins un événement."
});

const BADGE_COPY_EN = Object.freeze({
  "badge.first_collection.name": "First collection",
  "badge.first_collection.description": "You added your first variant.",
  "badge.collection_25.name": "Collection 25%",
  "badge.collection_25.description": "You reached 25% completion of the published catalogue.",
  "badge.collection_50.name": "Collection 50%",
  "badge.collection_50.description": "You reached 50% completion of the published catalogue.",
  "badge.collection_75.name": "Collection 75%",
  "badge.collection_75.description": "You reached 75% completion of the published catalogue.",
  "badge.collection_100.name": "Collection 100%",
  "badge.collection_100.description": "You reached 100% completion on a catalogue version.",
  "badge.explorer.name": "Explorer",
  "badge.explorer.description": "You discovered 5 Sprite families.",
  "badge.reliable_collection.name": "Reliable collection",
  "badge.reliable_collection.description": "Your collection is at least 90% filled in.",
  "badge.squad_member.name": "Squad spirit",
  "badge.squad_member.description": "You are part of a squad.",
  "badge.squad_founder.name": "Squad founder",
  "badge.squad_founder.description": "You created a squad joined by another collector and active for at least 24 hours.",
  "badge.complementary_collection.name": "Complementary collection",
  "badge.complementary_collection.description": "Your collection meaningfully complements a friend or teammate.",
  "badge.archivist.name": "Archivist",
  "badge.archivist.description": "You kept a complete, up-to-date collection across three catalogue updates.",
  "badge.early_collector.name": "Early Collector",
  "badge.early_collector.description": "You were among the collectors present from the start of sprite-index.",
  "badge.all_rarities.name": "One variant of each rarity",
  "badge.all_rarities.description": "You own at least one variant of each official catalogue rarity.",
  "badge.event_completed.name": "Event completed",
  "badge.event_completed.description": "You completed all variants of an event.",
  "badge.social.name": "Social",
  "badge.social.description": "You have at least one friend.",
  "badge.event_complete.name": "Event accomplished",
  "badge.event_complete.description": "You completed at least one event."
});

const BADGE_COPY_NL = Object.freeze({
  "badge.first_collection.name": "Eerste collectie",
  "badge.first_collection.description": "Je hebt je eerste variant toegevoegd.",
  "badge.collection_25.name": "Collectie 25%",
  "badge.collection_25.description": "Je hebt 25% voltooiing van de gepubliceerde catalogus bereikt.",
  "badge.collection_50.name": "Collectie 50%",
  "badge.collection_50.description": "Je hebt 50% voltooiing van de gepubliceerde catalogus bereikt.",
  "badge.collection_75.name": "Collectie 75%",
  "badge.collection_75.description": "Je hebt 75% voltooiing van de gepubliceerde catalogus bereikt.",
  "badge.collection_100.name": "Collectie 100%",
  "badge.collection_100.description": "Je hebt 100% voltooiing van een catalogusversie bereikt.",
  "badge.explorer.name": "Ontdekker",
  "badge.explorer.description": "Je hebt 5 Sprite-families ontdekt.",
  "badge.reliable_collection.name": "Betrouwbare collectie",
  "badge.reliable_collection.description": "Je collectie is voor minstens 90% ingevuld.",
  "badge.squad_member.name": "Teamgeest",
  "badge.squad_member.description": "Je maakt deel uit van een squad.",
  "badge.squad_founder.name": "Squadoprichter",
  "badge.squad_founder.description": "Je hebt een squad gemaakt waar een andere verzamelaar zich bij aansloot en die minstens 24 uur actief is.",
  "badge.complementary_collection.name": "Aanvullende collectie",
  "badge.complementary_collection.description": "Je collectie vult die van een vriend of teamgenoot daadwerkelijk aan.",
  "badge.archivist.name": "Archivaris",
  "badge.archivist.description": "Je hebt drie catalogusupdates lang een volledige, actuele collectie behouden.",
  "badge.early_collector.name": "Early Collector",
  "badge.early_collector.description": "Je behoort tot de verzamelaars die er vanaf het begin van sprite-index bij waren.",
  "badge.all_rarities.name": "Een variant van elke zeldzaamheid",
  "badge.all_rarities.description": "Je bezit minstens één variant van elke officiële zeldzaamheid in de catalogus.",
  "badge.event_completed.name": "Evenement voltooid",
  "badge.event_completed.description": "Je hebt alle varianten van een evenement voltooid.",
  "badge.social.name": "Sociaal",
  "badge.social.description": "Je hebt minstens één vriend.",
  "badge.event_complete.name": "Evenement behaald",
  "badge.event_complete.description": "Je hebt minstens één evenement voltooid."
});

/** Fixed Early Collector cutoff — never change retroactively once seeded (Étapes 47–48). */
const EARLY_COLLECTOR_BEFORE = process.env.EARLY_COLLECTOR_BEFORE || "2026-10-01T00:00:00.000Z";

const TROPHET_DIR = path.join(__dirname, "..", "trophet");

function normalizeForMatch(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

const TROPHY_FILENAME_TO_CODE = Object.freeze({
  archivistepng: "archivist",
  collection25png: "collection_25",
  collection50png: "collection_50",
  collection75png: "collection_75",
  collection100png: "collection_100",
  collectioncomplementairepng: "complementary_collection",
  collectionfiablepng: "reliable_collection",
  earlycollectorpng: "early_collector",
  espritescouadepng: "squad_member",
  explorateurpng: "explorer",
  evenementcompletepng: "event_completed",
  fondateurdesquadpng: "squad_founder",
  premierecollectionpng: "first_collection",
  socialpng: "social",
  unevariantedechaqueraretepng: "all_rarities"
});

const TROPHY_IMAGE_MAP = (() => {
  const map = {};
  try {
    const files = fs.readdirSync(TROPHET_DIR).filter((f) => /\.(png|jpg|jpeg|webp|svg|ico)$/i.test(f));
    for (const f of files) {
      const key = normalizeForMatch(f);
      const code = TROPHY_FILENAME_TO_CODE[key];
      if (code) map[code] = "trophet/" + encodeURIComponent(f);
    }
  } catch (err) {
    // trophet directory may be missing in tests / CI
  }
  return Object.freeze(map);
})();

function getBadgeIconUrl(code) {
  return TROPHY_IMAGE_MAP[code] || null;
}

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

function resolveBadgeCopy(key, fallback = "", lang = "fr") {
  const locale = String(lang || "fr").toLowerCase().slice(0, 2);
  if (locale === "en" && BADGE_COPY_EN[key]) return BADGE_COPY_EN[key];
  if (locale === "nl" && BADGE_COPY_NL[key]) return BADGE_COPY_NL[key];
  return BADGE_COPY[key] || BADGE_COPY_EN[key] || fallback || key;
}

function labelForBadgeCode(code, lang = "fr") {
  if (!code) return null;
  const key = `badge.${code}.name`;
  return resolveBadgeCopy(key, code, lang);
}

/**
 * Étape 41 — compare the full precise rate to the threshold (no display rounding).
 * 74.999 → false for 75; 75.000 → true.
 */
function meetsCompletionThreshold(preciseRate, threshold) {
  const precise = Number(preciseRate);
  const target = Number(threshold);
  if (!Number.isFinite(precise) || !Number.isFinite(target)) return false;
  return precise >= target;
}

function evaluateRule(ruleType, ruleConfig, ctx) {
  const cfg = ruleConfig || {};
  switch (String(ruleType || "")) {
    case "first_owned_transition":
      return (ctx.ownedVariantCount || 0) >= 1;
    case "completion_threshold": {
      // Étape 41 — always use completionRatePrecise, never the rounded display.
      return meetsCompletionThreshold(ctx.completionRatePrecise, cfg.threshold);
    }
    case "discovered_sprite_count":
      return (ctx.discoveredSpriteCount || 0) >= (Number(cfg.min) || 0);
    case "reliability_level":
      return String(ctx.reliabilityLevel || "") === String(cfg.equals || "");
    case "squad_count":
      return (ctx.squadCount || 0) >= (Number(cfg.min) || 0);
    case "squad_founder_qualified":
      return ctx.squadFounderQualified === true;
    case "complementary_collection":
    case "event_completed_family":
      // Awarded via dedicated evaluators (compare / event completions).
      return false;
    case "archivist":
      return ctx.archivistQualified === true;
    case "early_collector":
      return ctx.earlyCollectorQualified === true;
    case "all_rarities":
      return ctx.allRaritiesQualified === true;
    case "friend_count":
      return (ctx.friendCount || 0) >= (Number(cfg.min) || 0);
    case "events_completed_count":
      return (ctx.eventsCompletedCount || 0) >= (Number(cfg.min) || 0);
    default:
      return false;
  }
}

/** Back-compat helper used by older tests. */
function evaluateBadgeCondition(conditions, ctx) {
  if (!conditions) return false;
  if (conditions.type === "owned_variant_count") {
    return evaluateRule("first_owned_transition", {}, ctx) && (ctx.ownedVariantCount || 0) >= (conditions.min || 0);
  }
  if (conditions.type === "completion_rate") {
    return evaluateRule("completion_threshold", { threshold: conditions.min }, ctx);
  }
  return evaluateRule(conditions.type, conditions, ctx);
}

async function ensurePassportBadgeTables(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS badge_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(80) UNIQUE NOT NULL,
      name_key VARCHAR(150) NOT NULL,
      description_key VARCHAR(200) NOT NULL,
      category VARCHAR(50) NOT NULL,
      icon_key VARCHAR(100) NOT NULL,
      rule_type VARCHAR(80) NOT NULL,
      rule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      is_revocable BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_badge_definitions_category
      ON badge_definitions (category) WHERE is_active = TRUE;

    CREATE TABLE IF NOT EXISTS user_badges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id UUID NOT NULL REFERENCES badge_definitions(id) ON DELETE CASCADE,
      unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      catalogue_version VARCHAR(80),
      progress_value NUMERIC,
      target_value NUMERIC,
      verification_status VARCHAR(30) NOT NULL DEFAULT 'declared',
      evidence JSONB,
      revoked_at TIMESTAMPTZ,
      revocation_reason TEXT,
      CHECK (verification_status IN (
        'declared',
        'system_confirmed',
        'community_verified',
        'officially_verified'
      ))
    );
    CREATE INDEX IF NOT EXISTS idx_user_badges_user
      ON user_badges (user_id, unlocked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_badges_status
      ON user_badges (verification_status);

    -- Étape 46 — catalogue review tracking for Archiviste.
    CREATE TABLE IF NOT EXISTS user_catalogue_reviews (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      catalogue_version VARCHAR(80) NOT NULL,
      reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completion_coverage_rate NUMERIC NOT NULL,
      PRIMARY KEY (user_id, catalogue_version)
    );
    CREATE INDEX IF NOT EXISTS idx_user_catalogue_reviews_user_time
      ON user_catalogue_reviews (user_id, reviewed_at DESC);
  `);

  // Étape 50 — contextual family badges (event_completed + eventVersionId).
  await db.query(`ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS context_type VARCHAR(50)`);
  await db.query(`ALTER TABLE user_badges ADD COLUMN IF NOT EXISTS context_id UUID`);
  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_badges_user_id_badge_id_key'
      ) THEN
        ALTER TABLE user_badges DROP CONSTRAINT user_badges_user_id_badge_id_key;
      END IF;
    END $$;
  `);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_badges_user_badge_context
      ON user_badges (
        user_id,
        badge_id,
        COALESCE(context_type, ''),
        COALESCE(context_id::text, '')
      );
  `);

  for (const seed of BADGE_SEED) {
    const freezeRule = !!seed.freezeRuleConfig;
    await db.query(
      `INSERT INTO badge_definitions (
         code, name_key, description_key, category, icon_key,
         rule_type, rule_config, is_active, is_hidden, is_revocable, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, $8, $9, NOW())
       ON CONFLICT (code) DO UPDATE SET
         name_key = EXCLUDED.name_key,
         description_key = EXCLUDED.description_key,
         category = EXCLUDED.category,
         icon_key = EXCLUDED.icon_key,
         rule_type = EXCLUDED.rule_type,
         rule_config = CASE
           WHEN $10::boolean THEN badge_definitions.rule_config
           ELSE EXCLUDED.rule_config
         END,
         is_active = TRUE,
         is_hidden = EXCLUDED.is_hidden,
         is_revocable = EXCLUDED.is_revocable,
         updated_at = NOW()`,
      [
        seed.code,
        seed.nameKey,
        seed.descriptionKey,
        seed.category,
        seed.iconKey,
        seed.ruleType,
        JSON.stringify(seed.ruleConfig || {}),
        !!seed.isHidden,
        !!seed.isRevocable,
        freezeRule
      ]
    );
  }

  // Migrate legacy unlocks → new codes / tables (non-contextual).
  await db.query(`
    INSERT INTO user_badges (
      user_id, badge_id, unlocked_at, catalogue_version,
      verification_status, evidence
    )
    SELECT
      a.user_id,
      d.id,
      a.unlocked_at,
      a.catalogue_version,
      CASE
        WHEN d.code IN (
          'first_collection', 'squad_member', 'squad_founder', 'social',
          'complementary_collection', 'early_collector'
        ) THEN 'system_confirmed'
        ELSE 'declared'
      END,
      COALESCE(a.meta, '{}'::jsonb)
    FROM user_passport_achievements a
    JOIN badge_definitions d ON d.code = COALESCE(
      CASE a.achievement_id
        WHEN 'first_owned' THEN 'first_collection'
        WHEN 'collector_25' THEN 'collection_25'
        WHEN 'collector_50' THEN 'collection_50'
        WHEN 'collector_90' THEN 'collection_75'
        WHEN 'collector_100' THEN 'collection_100'
        ELSE a.achievement_id
      END,
      a.achievement_id
    )
    ON CONFLICT DO NOTHING
  `);
}

async function listBadgeDefinitions(db = pool) {
  const result = await db.query(
    `SELECT id, code, name_key, description_key, category, icon_key,
            rule_type, rule_config, is_active, is_hidden, is_revocable
     FROM badge_definitions
     WHERE is_active = TRUE
     ORDER BY category ASC, code ASC`
  );
  return result.rows.map((row) => ({
    ...row,
    ruleType: row.rule_type,
    ruleConfig: row.rule_config || {},
    nameKey: row.name_key,
    descriptionKey: row.description_key,
    iconKey: row.icon_key,
    iconUrl: getBadgeIconUrl(row.code),
    label: resolveBadgeCopy(row.name_key),
    description: resolveBadgeCopy(row.description_key),
    // Back-compat for evaluateBadgeCondition callers.
    conditions: {
      type: row.rule_type,
      ...(row.rule_config || {})
    }
  }));
}

function defaultVerificationForCode(code, seedStatus) {
  if (seedStatus && VERIFICATION_STATUSES.includes(seedStatus)) return seedStatus;
  if ([
    "first_collection",
    "squad_member",
    "squad_founder",
    "social",
    "complementary_collection",
    "early_collector"
  ].includes(code)) {
    return "system_confirmed";
  }
  return "declared";
}

function progressFieldsForRule(ruleType, ruleConfig, ctx) {
  if (ruleType === "completion_threshold") {
    return {
      progressValue: Number(ctx.completionRatePrecise) || 0,
      targetValue: Number(ruleConfig.threshold) || null
    };
  }
  if (ruleType === "discovered_sprite_count") {
    return {
      progressValue: Number(ctx.discoveredSpriteCount) || 0,
      targetValue: Number(ruleConfig.min) || null
    };
  }
  if (ruleType === "first_owned_transition") {
    return {
      progressValue: Number(ctx.ownedVariantCount) || 0,
      targetValue: 1
    };
  }
  return { progressValue: null, targetValue: null };
}

/**
 * Unlock badges whose rules pass. Returns newly unlocked rows only.
 * Never re-awards an existing (user, badge) pair.
 * @param {object} [options]
 * @param {Set<string>|null} [options.onlyCodes] Étape 52 — evaluate only these codes
 */
async function unlockBadgesForUser(userId, ctx, db = pool, options = {}) {
  const defs = await listBadgeDefinitions(db);
  const seedByCode = Object.fromEntries(BADGE_SEED.map((s) => [s.code, s]));
  const unlocked = [];
  const activity = require("./passport-activity");
  const onlyCodes = options.onlyCodes instanceof Set ? options.onlyCodes : null;

  for (const def of defs) {
    if (def.is_hidden) continue;
    if (onlyCodes && !onlyCodes.has(def.code)) continue;
    if (!evaluateRule(def.rule_type, def.rule_config, ctx)) continue;

    const { progressValue, targetValue } = progressFieldsForRule(
      def.rule_type,
      def.rule_config || {},
      ctx
    );
    const verification = defaultVerificationForCode(
      def.code,
      seedByCode[def.code]?.verificationStatus
    );
    const evidence = {
      // Étape 42 — freeze catalogue size + precise rate at unlock time (historical).
      completionRatePrecise: ctx.completionRatePrecise,
      completionRateDisplay: ctx.completionRateDisplay,
      ownedVariantCount: ctx.ownedVariantCount,
      releasedVariantCount: ctx.releasedVariantCount,
      discoveredSpriteCount: ctx.discoveredSpriteCount,
      threshold: def.rule_type === "completion_threshold"
        ? Number((def.rule_config || {}).threshold)
        : null,
      ruleType: def.rule_type,
      ruleConfig: def.rule_config,
      historical: def.rule_type === "completion_threshold",
      requiredRarities: ctx.requiredRarities || null,
      ownedRarities: ctx.ownedRarities || null
    };

    const awarded = await awardBadgeByCode(userId, def.code, {
      catalogueVersion: ctx.catalogueVersion || null,
      evidence,
      progressValue,
      targetValue,
      db,
      skipActivity: false,
      verificationStatus: verification
    });
    if (!awarded) continue;
    unlocked.push({ ...awarded, badge_code: def.code, label: def.label, code: def.code });

    // Mirror legacy achievement id for older readers / migrations.
    const legacyId = Object.entries(LEGACY_CODE_MAP).find(([, code]) => code === def.code)?.[0] || def.code;
    await db.query(
      `INSERT INTO user_passport_achievements (user_id, achievement_id, unlocked_at, catalogue_version, meta)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, legacyId, awarded.unlocked_at, awarded.catalogue_version, JSON.stringify(evidence)]
    );

    try {
      const milestone = MILESTONE_BY_CODE[def.code];
      if (milestone != null) {
        await activity.writeActivity({
          userId,
          activityType: "completion_milestone",
          entityType: "milestone",
          entityId: String(milestone),
          data: { percent: milestone, badgeCode: def.code, label: def.label },
          visibility: "friends",
          db
        });
      }
    } catch (err) {
      console.error("[passport-badges] activity write failed", err.message);
    }
  }
  return unlocked;
}

/**
 * Award a badge by code (idempotent). Supports Étape 50 context for family badges.
 * Étape 53 — unique index + transaction + dedupe key `badge_unlock:{code}:{userId}`.
 */
async function awardBadgeByCode(userId, code, {
  catalogueVersion = null,
  evidence = {},
  progressValue = null,
  targetValue = null,
  contextType = null,
  contextId = null,
  verificationStatus = null,
  skipActivity = false,
  notify = false,
  db = pool
} = {}) {
  const defRes = await db.query(
    `SELECT * FROM badge_definitions WHERE code = $1 AND is_active = TRUE LIMIT 1`,
    [code]
  );
  if (!defRes.rows.length) return null;
  const def = defRes.rows[0];
  const seed = BADGE_SEED.find((s) => s.code === code);
  const verification = verificationStatus
    || defaultVerificationForCode(code, seed?.verificationStatus);

  const { buildBadgeUnlockDedupeKey } = require("./badge-engine");
  const eventIdempotency = require("./event-idempotency");
  const dedupeKey = buildBadgeUnlockDedupeKey(userId, code, contextType, contextId);

  const client = db === pool ? await pool.connect() : db;
  const ownClient = client !== db || db === pool;
  // When caller passed a transaction client, reuse it without nesting BEGIN.
  const manageTx = db === pool;
  try {
    if (manageTx) await client.query("BEGIN");

    if (dedupeKey) {
      const claimed = await eventIdempotency.claimDedupeKey(
        client,
        dedupeKey,
        "badge_award",
        userId
      );
      if (!claimed) {
        if (manageTx) await client.query("ROLLBACK");
        return null;
      }
    }

    const result = await client.query(
      `INSERT INTO user_badges (
         user_id, badge_id, unlocked_at, catalogue_version,
         progress_value, target_value, verification_status, evidence,
         context_type, context_id
       ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7::jsonb, $8, $9::uuid)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        userId,
        def.id,
        catalogueVersion,
        progressValue,
        targetValue,
        verification,
        JSON.stringify(evidence || {}),
        contextType || null,
        contextId || null
      ]
    );
    if (!result.rows.length) {
      // Badge already present — keep the award claim so we don't retry forever.
      if (manageTx) await client.query("COMMIT");
      return null;
    }
    if (manageTx) await client.query("COMMIT");

    const row = result.rows[0];
    const label = resolveBadgeCopy(def.name_key);

    try {
      const analytics = require("../analytics");
      analytics.logProductAnalyticsEvent(pool, {
        userId,
        event: "passport_badge_unlocked",
        details: {
          badgeCode: code,
          badgeId: def.id,
          contextType: contextType || null,
          contextId: contextId || null
        }
      });
    } catch (_) {}

    if (!skipActivity) {
      try {
        const activity = require("./passport-activity");
        await activity.writeActivity({
          userId,
          activityType: "badge_unlocked",
          entityType: "badge",
          entityId: code,
          data: {
            badgeId: def.id,
            badgeCode: code,
            label,
            verificationStatus: verification,
            contextType: contextType || null,
            contextId: contextId || null,
            eventName: evidence.eventName || null
          },
          visibility: "friends",
          db: manageTx ? pool : client
        });
      } catch (err) {
        console.error("[passport-badges] award activity failed", err.message);
      }
    }

    if (notify) {
      try {
        const { notifyBadgeUnlocks } = require("./badge-engine");
        await notifyBadgeUnlocks(userId, [{
          badgeCode: code,
          code,
          label: evidence.eventName ? `${label} · ${evidence.eventName}` : label,
          contextType,
          contextId
        }], { batch: false });
      } catch (err) {
        console.error("[passport-badges] award notify failed", err.message);
      }
    }

    return { ...row, badge_code: code, label, code };
  } catch (err) {
    if (manageTx) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (manageTx && ownClient) client.release();
  }
}

/**
 * Étape 43 — founder badge requires create + another member + 24h age.
 * Remains valid if the squad is later closed (historical membership counts).
 */
async function findQualifyingFoundedSquad(userId, db = pool) {
  const result = await db.query(
    `SELECT s.id, s.code, s.name, s.created_at
     FROM squads s
     WHERE s.created_by = $1
       AND s.created_at <= NOW() - INTERVAL '24 hours'
       AND EXISTS (
         SELECT 1 FROM squad_members sm
         WHERE sm.squad_id = s.id
           AND sm.user_id <> s.created_by
       )
     ORDER BY s.created_at ASC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function userQualifiesAsSquadFounder(userId, db = pool) {
  return Boolean(await findQualifyingFoundedSquad(userId, db));
}

async function maybeAwardSquadFounder(userId, db = pool) {
  const squad = await findQualifyingFoundedSquad(userId, db);
  if (!squad) return null;
  return awardBadgeByCode(userId, "squad_founder", {
    evidence: {
      squadId: squad.id,
      squadCode: squad.code,
      squadName: squad.name,
      squadCreatedAt: squad.created_at,
      ruleType: "squad_founder_qualified"
    },
    db
  });
}

/** Étape 46 — stamp a catalogue review when coverage is high enough. */
async function recordCatalogueReview(userId, catalogueVersion, coverageRate, db = pool) {
  const rate = Number(coverageRate);
  const version = String(catalogueVersion || "").slice(0, 80);
  if (!version || !Number.isFinite(rate) || rate < 90) return null;
  const result = await db.query(
    `INSERT INTO user_catalogue_reviews (user_id, catalogue_version, reviewed_at, completion_coverage_rate)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (user_id, catalogue_version) DO UPDATE SET
       reviewed_at = NOW(),
       completion_coverage_rate = GREATEST(
         user_catalogue_reviews.completion_coverage_rate,
         EXCLUDED.completion_coverage_rate
       )
     RETURNING *`,
    [userId, version, rate]
  );
  return result.rows[0] || null;
}

async function evaluateArchivistQualified(userId, {
  minCoverage = 90,
  minVersions = 3,
  maxGapDays = 30,
  db = pool
} = {}) {
  const reviews = await db.query(
    `SELECT catalogue_version, reviewed_at, completion_coverage_rate
     FROM user_catalogue_reviews
     WHERE user_id = $1 AND completion_coverage_rate >= $2
     ORDER BY reviewed_at ASC`,
    [userId, minCoverage]
  );
  const rows = reviews.rows;
  if (rows.length < minVersions) return false;
  const versions = new Set(rows.map((r) => String(r.catalogue_version)));
  if (versions.size < minVersions) return false;

  const maxGapMs = maxGapDays * 24 * 60 * 60 * 1000;
  for (let i = 1; i < rows.length; i++) {
    const gap = new Date(rows[i].reviewed_at).getTime() - new Date(rows[i - 1].reviewed_at).getTime();
    if (gap > maxGapMs) return false;
  }
  // Current catalogue must not sit unverified for more than maxGapDays.
  const last = rows[rows.length - 1];
  if (Date.now() - new Date(last.reviewed_at).getTime() > maxGapMs) return false;
  return true;
}

/**
 * Étapes 47–48 — Early Collector: fixed cutoff + real collection + verified identity.
 */
async function evaluateEarlyCollectorQualified(userId, ruleConfig = {}, db = pool) {
  const beforeIso = ruleConfig.before || EARLY_COLLECTOR_BEFORE;
  const before = new Date(beforeIso);
  if (!Number.isFinite(before.getTime())) return false;

  const userRes = await db.query(
    `SELECT id, created_at, email_verified, oauth_provider, suspended_until, deleted_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRes.rows.length) return false;
  const user = userRes.rows[0];
  if (user.deleted_at) return false;
  if (user.suspended_until && new Date(user.suspended_until) > new Date()) return false;
  if (new Date(user.created_at) >= before) return false;

  const verified = !!user.email_verified || !!(user.oauth_provider && String(user.oauth_provider).trim());
  if (!verified) return false;

  const owned = await db.query(
    `SELECT 1 FROM sprite_entries
     WHERE user_id = $1 AND LOWER(status) = 'owned'
     LIMIT 1`,
    [userId]
  );
  return owned.rows.length > 0;
}

/** Étape 49 — official rarities present in the published catalogue (versioned list). */
function requiredRaritiesFromCatalogue(catalogue) {
  const { officialRarityScore, OFFICIAL_RARITY_KEY } = require("./passport-math");
  const present = new Map();
  for (const item of catalogue || []) {
    const score = officialRarityScore(item.rarity);
    if (score > 0 && OFFICIAL_RARITY_KEY[score]) {
      present.set(score, OFFICIAL_RARITY_KEY[score]);
    }
  }
  return [...present.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, key]) => key);
}

function evaluateAllRaritiesOwned(catalogue, ownedIds) {
  const { officialRarityScore, OFFICIAL_RARITY_KEY } = require("./passport-math");
  const required = requiredRaritiesFromCatalogue(catalogue);
  if (!required.length) return { qualified: false, required, ownedRarities: [] };
  const owned = ownedIds instanceof Set ? ownedIds : new Set((ownedIds || []).map(String));
  const ownedRarities = new Set();
  for (const item of catalogue || []) {
    if (!owned.has(String(item.id))) continue;
    const score = officialRarityScore(item.rarity);
    if (score > 0 && OFFICIAL_RARITY_KEY[score]) ownedRarities.add(OFFICIAL_RARITY_KEY[score]);
  }
  const qualified = required.every((r) => ownedRarities.has(r));
  return { qualified, required, ownedRarities: [...ownedRarities] };
}

/** Étape 50 — award one event_completed badge per completed event version. */
async function awardEventCompletedBadges(userId, completions, { catalogueVersion = null, db = pool, notify = true } = {}) {
  const awarded = [];
  for (const row of completions || []) {
    const badge = await awardBadgeByCode(userId, "event_completed", {
      catalogueVersion: catalogueVersion || row.catalogueVersion || null,
      contextType: "event_version",
      contextId: row.eventVersionId,
      evidence: {
        eventId: row.eventId,
        eventName: row.eventName,
        eventVersionId: row.eventVersionId,
        version: row.version,
        catalogueVersion: catalogueVersion || row.catalogueVersion || null
      },
      db,
      notify: false
    });
    if (badge) {
      awarded.push({
        ...badge,
        badgeCode: "event_completed",
        code: "event_completed",
        label: row.eventName
          ? `Événement complété · ${row.eventName}`
          : "Événement complété",
        contextType: "event_version",
        contextId: row.eventVersionId
      });
    }
  }
  if (notify && awarded.length) {
    try {
      const { notifyBadgeUnlocks } = require("./badge-engine");
      await notifyBadgeUnlocks(userId, awarded, { batch: awarded.length > 1, db });
    } catch (err) {
      console.error("[passport-badges] event badge notify failed", err.message);
    }
  }
  return awarded;
}

function precisePercent(count, total) {
  const n = Number(count) || 0;
  const d = Number(total) || 0;
  return d > 0 ? (n / d) * 100 : 0;
}

/**
 * Étapes 44–45 — complementary_collection from a real compare engine result.
 * Awards both users when eligible. Returns { awarded: [], skippedReason }.
 */
async function evaluateAndAwardComplementaryBadge(userAId, userBId, compareResult, {
  catalogueVersion = null,
  db = pool
} = {}) {
  const aId = Number(userAId);
  const bId = Number(userBId);
  if (!Number.isSafeInteger(aId) || !Number.isSafeInteger(bId) || aId === bId) {
    return { awarded: [], skippedReason: "same_or_invalid_users" };
  }
  const summary = compareResult && compareResult.summary;
  if (!summary) return { awarded: [], skippedReason: "no_result" };
  if (summary.insufficientData) return { awarded: [], skippedReason: "insufficient_data" };

  const { areFriends, shareActiveSquad, isAccountSuspended } = require("./auth");
  const { passportReliability } = require("./passport-math");

  if (await isAccountSuspended(aId) || await isAccountSuspended(bId)) {
    return { awarded: [], skippedReason: "suspended" };
  }

  const socialOk = (await areFriends(aId, bId)) || (await shareActiveSquad(aId, bId));
  if (!socialOk) return { awarded: [], skippedReason: "no_social_link" };

  const users = await db.query(
    `SELECT id, created_at, deleted_at, suspended_until
     FROM users WHERE id = ANY($1::int[])`,
    [[aId, bId]]
  );
  if (users.rows.length < 2) return { awarded: [], skippedReason: "user_missing" };
  const now = Date.now();
  const minAgeMs = 24 * 60 * 60 * 1000;
  for (const row of users.rows) {
    if (row.deleted_at) return { awarded: [], skippedReason: "deleted" };
    if (row.suspended_until && new Date(row.suspended_until).getTime() > now) {
      return { awarded: [], skippedReason: "suspended" };
    }
    if (now - new Date(row.created_at).getTime() < minAgeMs) {
      return { awarded: [], skippedReason: "account_too_recent" };
    }
  }

  const total = Number(summary.catalogueVariantCount) || 0;
  if (total < 1) return { awarded: [], skippedReason: "empty_catalogue" };

  const aEntered = Number(summary.aEnteredCount) || 0;
  const bEntered = Number(summary.bEnteredCount) || 0;
  const aReliability = passportReliability(aEntered, total);
  const bReliability = passportReliability(bEntered, total);
  if (aReliability.rate < 80 || bReliability.rate < 80) {
    return { awarded: [], skippedReason: "reliability_below_80" };
  }

  // Exclusive owned variants (unknown pairs are already excluded from these groups).
  const exclusive = (Number(summary.onlyUserACount) || 0) + (Number(summary.onlyUserBCount) || 0);
  if (exclusive < 10) return { awarded: [], skippedReason: "exclusive_below_10" };

  const aRate = precisePercent(summary.aOwnedCount, total);
  const bRate = precisePercent(summary.bOwnedCount, total);
  const unionRate = precisePercent(summary.collectiveOwnedCount, total);
  const bestSolo = Math.max(aRate, bRate);
  const gain = unionRate - bestSolo;
  if (gain < 5 - 1e-12) return { awarded: [], skippedReason: "union_gain_below_5" };

  const evidenceBase = {
    ruleType: "complementary_collection",
    peerUserId: null,
    aOwnedRatePrecise: aRate,
    bOwnedRatePrecise: bRate,
    unionRatePrecise: unionRate,
    unionGainPoints: gain,
    exclusiveOwnedCount: exclusive,
    aReliabilityRate: aReliability.rate,
    bReliabilityRate: bReliability.rate,
    releasedVariantCount: total,
    catalogueVersion
  };

  const awarded = [];
  for (const [selfId, peerId, selfRate] of [
    [aId, bId, aRate],
    [bId, aId, bRate]
  ]) {
    const row = await awardBadgeByCode(selfId, "complementary_collection", {
      catalogueVersion,
      progressValue: gain,
      targetValue: 5,
      evidence: {
        ...evidenceBase,
        peerUserId: peerId,
        selfOwnedRatePrecise: selfRate
      },
      db,
      notify: true
    });
    if (row) awarded.push({ userId: selfId, badge: row });
  }
  return {
    awarded,
    skippedReason: awarded.length ? null : "already_unlocked",
    metrics: { aRate, bRate, unionRate, gain, exclusive }
  };
}

async function listUserBadges(userId, db = pool) {
  const result = await db.query(
    `SELECT
       ub.id AS user_badge_id,
       ub.unlocked_at,
       ub.catalogue_version,
       ub.progress_value,
       ub.target_value,
       ub.verification_status,
       ub.evidence,
       ub.revoked_at,
       ub.context_type,
       ub.context_id,
       d.id AS badge_id,
       d.code,
       d.name_key,
       d.description_key,
       d.category,
       d.icon_key,
       d.rule_type,
       d.rule_config
     FROM user_badges ub
     JOIN badge_definitions d ON d.id = ub.badge_id
     WHERE ub.user_id = $1
       AND d.is_active = TRUE
       AND ub.revoked_at IS NULL
       AND d.is_hidden = FALSE
     ORDER BY ub.unlocked_at ASC`,
    [userId]
  );
  return result.rows.map((row) => {
    const evidence = row.evidence || {};
    const threshold = evidence.threshold != null
      ? Number(evidence.threshold)
      : (row.target_value != null ? Number(row.target_value) : null);
    const releasedAtUnlock = evidence.releasedVariantCount != null
      ? Number(evidence.releasedVariantCount)
      : null;
    const isProgression = row.rule_type === "completion_threshold" || /^collection_\d+$/.test(row.code);
    const baseLabel = resolveBadgeCopy(row.name_key);
    const eventName = evidence.eventName || null;
    const label = row.code === "event_completed" && eventName
      ? `${baseLabel} · ${eventName}`
      : baseLabel;
    return {
      id: row.context_id ? `${row.code}:${row.context_id}` : row.code,
      code: row.code,
      badgeId: row.badge_id,
      userBadgeId: row.user_badge_id,
      label,
      description: resolveBadgeCopy(row.description_key),
      category: row.category,
      iconKey: row.icon_key,
      iconUrl: getBadgeIconUrl(row.code),
      ruleType: row.rule_type,
      ruleConfig: row.rule_config || {},
      unlockedAt: row.unlocked_at,
      catalogueVersion: row.catalogue_version,
      progressValue: row.progress_value != null ? Number(row.progress_value) : null,
      targetValue: row.target_value != null ? Number(row.target_value) : null,
      verificationStatus: row.verification_status,
      contextType: row.context_type,
      contextId: row.context_id,
      eventName,
      evidence,
      meta: evidence,
      isHistoricalProgression: isProgression,
      threshold,
      releasedVariantCountAtUnlock: releasedAtUnlock,
      completionRatePreciseAtUnlock: evidence.completionRatePrecise != null
        ? Number(evidence.completionRatePrecise)
        : null
    };
  });
}

module.exports = {
  VERIFICATION_STATUSES,
  BADGE_SEED,
  BADGE_COPY,
  BADGE_COPY_EN,
  BADGE_COPY_NL,
  EARLY_COLLECTOR_BEFORE,
  MILESTONE_BY_CODE,
  LEGACY_CODE_MAP,
  MILESTONE_BADGES: MILESTONE_BY_CODE,
  resolveBadgeCopy,
  labelForBadgeCode,
  meetsCompletionThreshold,
  evaluateRule,
  evaluateBadgeCondition,
  ensurePassportBadgeTables,
  listBadgeDefinitions,
  unlockBadgesForUser,
  awardBadgeByCode,
  findQualifyingFoundedSquad,
  userQualifiesAsSquadFounder,
  maybeAwardSquadFounder,
  recordCatalogueReview,
  evaluateArchivistQualified,
  evaluateEarlyCollectorQualified,
  requiredRaritiesFromCatalogue,
  evaluateAllRaritiesOwned,
  awardEventCompletedBadges,
  evaluateAndAwardComplementaryBadge,
  listUserBadges,
  getBadgeIconUrl
};
