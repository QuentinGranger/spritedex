"use strict";

// Étapes 51–54 — central badge engine: selective eval, progress, idempotent unlocks, notifs.
const { pool } = require("./db");
const eventIdempotency = require("./event-idempotency");
const pushService = require("../push-service");
const { getBadgeIconUrl } = require("./passport-badges");

const BADGE_TRIGGERS = Object.freeze({
  "collection.variant_acquired": [
    "first_collection",
    "collection_25",
    "collection_50",
    "collection_75",
    "collection_100",
    "explorer",
    "reliable_collection",
    "all_rarities",
    "archivist",
    "early_collector",
    "event_completed",
    "event_complete"
  ],
  "collection.updated": [
    "first_collection",
    "collection_25",
    "collection_50",
    "collection_75",
    "collection_100",
    "explorer",
    "reliable_collection",
    "all_rarities",
    "archivist",
    "early_collector",
    "event_completed",
    "event_complete"
  ],
  "catalogue.published": [
    "collection_25",
    "collection_50",
    "collection_75",
    "collection_100",
    "all_rarities",
    "archivist",
    "reliable_collection"
  ],
  "squad.created": ["squad_member"],
  "squad.member_joined": ["squad_member", "squad_founder"],
  "comparison.generated": ["complementary_collection"],
  "event.completed": ["event_completed", "event_complete"],
  "account.created": ["early_collector"]
});

function normalizeTrigger(triggerEvent) {
  if (!triggerEvent) return "collection.updated";
  if (typeof triggerEvent === "string") return triggerEvent;
  if (triggerEvent && typeof triggerEvent === "object") {
    return String(triggerEvent.eventType || triggerEvent.trigger || triggerEvent.type || "collection.updated");
  }
  return "collection.updated";
}

function buildBadgeUnlockDedupeKey(userId, badgeCode, contextType = null, contextId = null) {
  const user = String(userId);
  const code = String(badgeCode || "");
  if (!user || !code) return null;
  const ctx = contextType || contextId ? `${contextType || ""}:${contextId || ""}` : "";
  return ctx ? `badge_unlock:${code}:${user}:${ctx}` : `badge_unlock:${code}:${user}`;
}

function liveProgressForBadge(def, ctx) {
  const ruleType = def.ruleType || def.rule_type;
  const cfg = def.ruleConfig || def.rule_config || {};
  const owned = Number(ctx.ownedVariantCount) || 0;
  const released = Number(ctx.releasedVariantCount) || 0;

  if (ruleType === "completion_threshold") {
    const threshold = Number(cfg.threshold);
    if (!Number.isFinite(threshold) || released < 1) {
      return { progressValue: owned, targetValue: null, progressRate: 0, remaining: null };
    }
    const needed = Math.ceil((threshold / 100) * released);
    const rate = released ? (owned / released) * 100 : 0;
    return {
      progressValue: owned,
      targetValue: needed,
      progressRate: Math.round(rate * 100) / 100,
      remaining: Math.max(0, needed - owned),
      threshold
    };
  }
  if (ruleType === "first_owned_transition") {
    return {
      progressValue: owned >= 1 ? 1 : 0,
      targetValue: 1,
      progressRate: owned >= 1 ? 100 : 0,
      remaining: owned >= 1 ? 0 : 1
    };
  }
  if (ruleType === "discovered_sprite_count") {
    const min = Number(cfg.min) || 0;
    const discovered = Number(ctx.discoveredSpriteCount) || 0;
    return {
      progressValue: discovered,
      targetValue: min,
      progressRate: min ? Math.round((discovered / min) * 10000) / 100 : 0,
      remaining: Math.max(0, min - discovered)
    };
  }
  if (ruleType === "all_rarities") {
    const required = Array.isArray(ctx.requiredRarities) ? ctx.requiredRarities.length : 0;
    const ownedR = Array.isArray(ctx.ownedRarities) ? ctx.ownedRarities.length : 0;
    return {
      progressValue: ownedR,
      targetValue: required,
      progressRate: required ? Math.round((ownedR / required) * 10000) / 100 : 0,
      remaining: Math.max(0, required - ownedR)
    };
  }
  return {
    progressValue: null,
    targetValue: null,
    progressRate: null,
    remaining: null
  };
}

function resolveBadgeUiCategory(defOrBadge) {
  const code = String(defOrBadge.badgeCode || defOrBadge.code || "");
  const cat = String(defOrBadge.category || "");
  if (code === "squad_member" || code === "squad_founder" || cat === "squads") return "squads";
  if (code === "early_collector" || cat === "legacy" || cat === "historique") return "historique";
  if (cat === "events") return "events";
  if (cat === "social") return "social";
  // progression + collection → Progression (Étape 63)
  return "progression";
}

function enrichBadgeProgressItem(def, item) {
  const code = def.code || item.badgeCode || item.code || "";
  return {
    ...item,
    category: def.category,
    uiCategory: resolveBadgeUiCategory({ ...def, badgeCode: def.code }),
    description: def.description || item.description || "",
    iconKey: def.iconKey || def.icon_key || item.iconKey || null,
    iconUrl: getBadgeIconUrl(code)
  };
}

/**
 * Étape 51 — unlocked + locked progression for passport / API.
 * Pass `ctx` when already built (e.g. after refreshPassportProgress).
 */
async function listBadgeProgress(userId, { ctx = null, db = pool } = {}) {
  const badges = require("./passport-badges");
  let evalCtx = ctx;
  if (!evalCtx) {
    const achievements = require("./passport-achievements");
    const built = await achievements.buildPassportEvalContext(userId, db, { notify: false });
    evalCtx = built.ctx;
  }
  const defs = await badges.listBadgeDefinitions(db);
  const unlocked = await badges.listUserBadges(userId, db);
  const unlockedByCode = new Map();
  for (const row of unlocked) {
    if (!row.contextId) unlockedByCode.set(row.code, row);
  }

  const progress = [];
  for (const def of defs) {
    if (def.is_hidden) continue;
    const ruleType = def.ruleType || def.rule_type;

    if (ruleType === "event_completed_family") {
      const instances = unlocked.filter((u) => u.code === def.code);
      if (instances.length) {
        for (const inst of instances) {
          progress.push(
            enrichBadgeProgressItem(def, {
              badgeCode: def.code,
              badgeId: inst.badgeId || def.id,
              status: "unlocked",
              label: inst.label,
              progressValue: inst.progressValue,
              targetValue: inst.targetValue,
              progressRate: 100,
              unlockedAt: inst.unlockedAt,
              contextType: inst.contextType,
              contextId: inst.contextId,
              eventName: inst.eventName,
              verificationStatus: inst.verificationStatus
            })
          );
        }
      } else {
        progress.push(
          enrichBadgeProgressItem(def, {
            badgeCode: def.code,
            badgeId: def.id,
            status: "locked",
            label: def.label,
            progressValue: 0,
            targetValue: null,
            progressRate: 0
          })
        );
      }
      continue;
    }

    // Complementary / founder are awarded elsewhere — still show locked shell.
    const unlockedRow = unlockedByCode.get(def.code);
    const live = liveProgressForBadge(def, evalCtx);
    if (unlockedRow) {
      progress.push(
        enrichBadgeProgressItem(def, {
          badgeCode: def.code,
          badgeId: unlockedRow.badgeId || def.id,
          status: "unlocked",
          label: unlockedRow.label || def.label,
          progressValue: unlockedRow.progressValue != null ? unlockedRow.progressValue : live.progressValue,
          targetValue: unlockedRow.targetValue != null ? unlockedRow.targetValue : live.targetValue,
          progressRate: 100,
          unlockedAt: unlockedRow.unlockedAt,
          verificationStatus: unlockedRow.verificationStatus,
          isHistoricalProgression: unlockedRow.isHistoricalProgression,
          threshold: unlockedRow.threshold,
          releasedVariantCountAtUnlock: unlockedRow.releasedVariantCountAtUnlock,
          remaining: 0
        })
      );
    } else {
      progress.push(
        enrichBadgeProgressItem(def, {
          badgeCode: def.code,
          badgeId: def.id,
          status: "locked",
          label: def.label,
          progressValue: live.progressValue,
          targetValue: live.targetValue,
          progressRate: live.progressRate,
          remaining: live.remaining != null ? live.remaining : null,
          threshold: live.threshold != null ? live.threshold : null
        })
      );
    }
  }
  return progress;
}

async function notifyBadgeUnlocks(userId, unlockedRows, { batch = true, db = pool } = {}) {
  if (!unlockedRows || !unlockedRows.length) return null;
  const labels = unlockedRows.map((r) => r.label || r.badgeCode || r.code).filter(Boolean);
  const codes = unlockedRows.map((r) => r.badgeCode || r.code).filter(Boolean);
  if (!labels.length) return null;

  const dedupeKey =
    batch && unlockedRows.length > 1
      ? `badge_notif_batch:${userId}:${codes.slice().sort().join(",")}`
      : buildBadgeUnlockDedupeKey(
          userId,
          codes[0],
          unlockedRows[0].contextType || unlockedRows[0].context_type,
          unlockedRows[0].contextId || unlockedRows[0].context_id
        );

  if (dedupeKey) {
    const claimed = await eventIdempotency.claimDedupeKey(db, dedupeKey, "badge_unlocked", userId);
    if (!claimed) return null;
  }

  return pushService.createNotification(db, {
    recipientId: userId,
    actorId: null,
    type: "badge_unlocked",
    category: "collection",
    entityType: "badge",
    entityId: codes[0] || null,
    url: "/?view=account",
    context: {
      badgeCodes: codes,
      badgeLabels: labels,
      count: labels.length
    },
    data: {
      actionUrl: "/?view=account",
      badgeCodes: codes
    }
  });
}

function rowsToUnlockView(rows, defsByCode = {}) {
  return (rows || [])
    .map((row) => {
      const code = row.badge_code || row.code || defsByCode[row.badge_id]?.code;
      const label = row.label || defsByCode[code]?.label || defsByCode[row.badge_id]?.label || code;
      return {
        code,
        badgeCode: code,
        label,
        contextType: row.context_type || row.contextType || null,
        contextId: row.context_id || row.contextId || null,
        unlockedAt: row.unlocked_at || row.unlockedAt || null
      };
    })
    .filter((r) => r.badgeCode);
}

/**
 * Étapes 52–54 — evaluate only badges relevant to the trigger, unlock idempotently, notify.
 *
 * @param {number|string} userId
 * @param {string|object} triggerEvent e.g. "collection.variant_acquired"
 * @param {object} [options]
 * @param {object} [options.ctx] pre-built eval context (skips rebuild)
 * @param {string[]} [options.badgeCodes] override trigger map
 * @param {boolean} [options.notify=true]
 * @param {boolean} [options.batchNotify=true] coalesce multiple unlocks into one notif
 */
async function evaluateUserBadges(userId, triggerEvent, options = {}) {
  const badges = require("./passport-badges");
  const achievements = require("./passport-achievements");
  const trigger = normalizeTrigger(triggerEvent);
  const allowedCodes = options.badgeCodes || BADGE_TRIGGERS[trigger] || null;

  let ctx = options.ctx || null;
  let catalogueVersion = options.catalogueVersion || null;
  if (!ctx) {
    const built = await achievements.buildPassportEvalContext(userId);
    ctx = built.ctx;
    catalogueVersion = built.catalogueVersion;
    await achievements.updateCollectionPeak(userId, built.progress, catalogueVersion);
  }

  if (trigger === "squad.member_joined" || trigger === "squad.created") {
    await badges.maybeAwardSquadFounder(userId);
  }

  // Complementary awards stay in the compare engine (needs full compare result).
  const unlockedRows = await badges.unlockBadgesForUser(userId, ctx, pool, {
    onlyCodes: allowedCodes ? new Set(allowedCodes) : null
  });

  const defs = await badges.listBadgeDefinitions();
  const byCode = Object.fromEntries(defs.map((d) => [d.code, d]));
  const unlockedView = rowsToUnlockView(unlockedRows, byCode);

  // Also surface founder awards from maybeAwardSquadFounder if they happened above —
  // maybeAwardSquadFounder returns a row; include when trigger is squad-related.
  if (trigger === "squad.member_joined" || trigger === "squad.created") {
    // Re-list wouldn't know "new" — founder is handled inside maybeAward + unlock filter.
  }

  if (unlockedView.length && options.notify !== false) {
    await notifyBadgeUnlocks(userId, unlockedView, {
      batch: options.batchNotify !== false && unlockedView.length > 1
    });
  }

  return {
    unlocked: unlockedView,
    trigger,
    catalogueVersion: catalogueVersion || ctx.catalogueVersion || null,
    ctx
  };
}

module.exports = {
  BADGE_TRIGGERS,
  normalizeTrigger,
  buildBadgeUnlockDedupeKey,
  liveProgressForBadge,
  resolveBadgeUiCategory,
  listBadgeProgress,
  notifyBadgeUnlocks,
  evaluateUserBadges
};
