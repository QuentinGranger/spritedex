"use strict";

const { pool } = require("../db");
const { BADGE_SEED, MILESTONE_BY_CODE, LEGACY_CODE_MAP } = require("./definitions");
const { evaluateRule, resolveBadgeCopy } = require("./rules");
const { listBadgeDefinitions, defaultVerificationForCode, progressFieldsForRule } = require("./definitions-query");

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
  const activity = require("../passport-activity");
  const onlyCodes = options.onlyCodes instanceof Set ? options.onlyCodes : null;

  for (const def of defs) {
    if (def.is_hidden) continue;
    if (onlyCodes && !onlyCodes.has(def.code)) continue;
    if (!evaluateRule(def.rule_type, def.rule_config, ctx)) continue;

    const { progressValue, targetValue } = progressFieldsForRule(def.rule_type, def.rule_config || {}, ctx);
    const verification = defaultVerificationForCode(def.code, seedByCode[def.code]?.verificationStatus);
    const evidence = {
      // Étape 42 — freeze catalogue size + precise rate at unlock time (historical).
      completionRatePrecise: ctx.completionRatePrecise,
      completionRateDisplay: ctx.completionRateDisplay,
      ownedVariantCount: ctx.ownedVariantCount,
      releasedVariantCount: ctx.releasedVariantCount,
      discoveredSpriteCount: ctx.discoveredSpriteCount,
      threshold: def.rule_type === "completion_threshold" ? Number((def.rule_config || {}).threshold) : null,
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
async function awardBadgeByCode(
  userId,
  code,
  {
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
  } = {}
) {
  const defRes = await db.query(`SELECT * FROM badge_definitions WHERE code = $1 AND is_active = TRUE LIMIT 1`, [code]);
  if (!defRes.rows.length) return null;
  const def = defRes.rows[0];
  const seed = BADGE_SEED.find((s) => s.code === code);
  const verification = verificationStatus || defaultVerificationForCode(code, seed?.verificationStatus);

  const { buildBadgeUnlockDedupeKey } = require("../badge-engine");
  const eventIdempotency = require("../event-idempotency");
  const dedupeKey = buildBadgeUnlockDedupeKey(userId, code, contextType, contextId);

  const client = db === pool ? await pool.connect() : db;
  const ownClient = client !== db || db === pool;
  // When caller passed a transaction client, reuse it without nesting BEGIN.
  const manageTx = db === pool;
  try {
    if (manageTx) await client.query("BEGIN");

    if (dedupeKey) {
      const claimed = await eventIdempotency.claimDedupeKey(client, dedupeKey, "badge_award", userId);
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
      const analytics = require("../../analytics");
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
        const activity = require("../passport-activity");
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
        const { notifyBadgeUnlocks } = require("../badge-engine");
        await notifyBadgeUnlocks(
          userId,
          [
            {
              badgeCode: code,
              code,
              label: evidence.eventName ? `${label} · ${evidence.eventName}` : label,
              contextType,
              contextId
            }
          ],
          { batch: false }
        );
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

module.exports = { unlockBadgesForUser, awardBadgeByCode };
