"use strict";

const { pool } = require("../db");
const { BADGE_SEED } = require("./definitions");

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

module.exports = { ensurePassportBadgeTables };
