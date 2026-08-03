"use strict";

// Passport achievements + versioned event completions (Étapes 16–20).
const { pool } = require("./db");
const compare = require("./compare");
const { computeCatalogueVersion } = require("./squad-analysis-cache");
const { computePassportProgress, passportReliability } = require("./passport-math");

const PASSPORT_EXPLICIT_STATUSES = new Set(["owned", "missing", "priority", "spotted", "unavailable", "unknown"]);

const ACHIEVEMENT_DEFS = [
  {
    id: "first_collection",
    label: "Première collection",
    description: "Vous avez ajouté votre première variante.",
    check: (ctx) => ctx.ownedVariantCount >= 1
  },
  {
    id: "explorer",
    label: "Explorateur",
    description: "A découvert 5 familles de Sprites.",
    check: (ctx) => ctx.discoveredSpriteCount >= 5
  },
  {
    id: "collection_25",
    label: "Collection 25 %",
    description: "A atteint 25 % de complétion.",
    check: (ctx) => ctx.completionRatePrecise >= 25
  },
  {
    id: "collection_50",
    label: "Collection 50 %",
    description: "A atteint 50 % de complétion.",
    check: (ctx) => ctx.completionRatePrecise >= 50
  },
  {
    id: "collection_75",
    label: "Collection 75 %",
    description: "A atteint 75 % de complétion.",
    check: (ctx) => ctx.completionRatePrecise >= 75
  },
  {
    id: "collection_100",
    label: "Collection 100 %",
    description: "A atteint 100 % sur une version du catalogue.",
    check: (ctx) => ctx.completionRatePrecise >= 100
  },
  {
    id: "reliable_collection",
    label: "Collection fiable",
    description: "Collection renseignée à au moins 90 %.",
    check: (ctx) => ctx.reliabilityLevel === "complete"
  },
  {
    id: "squad_member",
    label: "Esprit d'escouade",
    description: "Participe à une squad.",
    check: (ctx) => ctx.squadCount >= 1
  },
  {
    id: "social",
    label: "Social",
    description: "A au moins un ami.",
    check: (ctx) => ctx.friendCount >= 1
  },
  {
    id: "event_complete",
    label: "Événement accompli",
    description: "A complété au moins un événement.",
    check: (ctx) => ctx.eventsCompletedCount >= 1
  }
];

const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENT_DEFS.map((d) => [d.id, d]));

function sameVariantSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const left = [...a].map(String).sort();
  const right = [...b].map(String).sort();
  return left.every((id, i) => id === right[i]);
}

function groupReleasedVariantsByEvent(catalogue) {
  const byEvent = new Map();
  for (const item of catalogue) {
    if (!item.eventId) continue;
    const eventId = String(item.eventId);
    if (!byEvent.has(eventId)) byEvent.set(eventId, new Set());
    byEvent.get(eventId).add(String(item.id));
  }
  return byEvent;
}

/**
 * Étape 18 — ensure each published event has a current requirements version.
 * When the required set changes, the previous version is closed and a new one opens.
 */
async function syncEventCollectionVersions(catalogue) {
  const byEvent = groupReleasedVariantsByEvent(catalogue);
  if (!byEvent.size) return;

  const eventIds = [...byEvent.keys()];
  // Only version events that exist in the events table (FK).
  const existing = await pool.query("SELECT id, name, end_date FROM events WHERE id = ANY($1::text[])", [eventIds]);
  const eventMeta = new Map(existing.rows.map((r) => [String(r.id), r]));

  for (const [eventId, idSet] of byEvent.entries()) {
    if (!eventMeta.has(eventId)) continue;
    const required = [...idSet].sort();
    const latest = await pool.query(
      `SELECT id, version, required_variant_ids, ended_at
       FROM event_collection_versions
       WHERE event_id = $1
       ORDER BY version DESC
       LIMIT 1`,
      [eventId]
    );
    const row = latest.rows[0];
    const currentIds = row ? (Array.isArray(row.required_variant_ids) ? row.required_variant_ids : []) : null;
    if (row && !row.ended_at && sameVariantSet(currentIds, required)) continue;

    if (row && !row.ended_at) {
      await pool.query("UPDATE event_collection_versions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL", [
        row.id
      ]);
    }
    const nextVersion = row ? Number(row.version) + 1 : 1;
    await pool.query(
      `INSERT INTO event_collection_versions (event_id, version, required_variant_ids, published_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (event_id, version) DO NOTHING`,
      [eventId, nextVersion, JSON.stringify(required)]
    );
  }
}

async function recordEventCompletions(userId, ownedIds, catalogueVersion, { notify = true } = {}) {
  const versions = await pool.query(
    `SELECT v.id, v.event_id, v.version, v.required_variant_ids, v.ended_at, v.published_at, e.name AS event_name
     FROM event_collection_versions v
     JOIN events e ON e.id = v.event_id`
  );
  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds);
  const activity = require("./passport-activity");
  const badges = require("./passport-badges");
  const newlyCompleted = [];
  for (const row of versions.rows) {
    const required = Array.isArray(row.required_variant_ids) ? row.required_variant_ids.map(String) : [];
    if (!required.length) continue;
    if (!required.every((id) => owned.has(id))) continue;
    const inserted = await pool.query(
      `INSERT INTO user_event_completions
         (user_id, event_id, event_version_id, completed_at, catalogue_version, verification_status)
       VALUES ($1, $2, $3, NOW(), $4, 'declared')
       ON CONFLICT (user_id, event_version_id) DO NOTHING
       RETURNING id`,
      [userId, row.event_id, row.id, catalogueVersion]
    );
    if (inserted.rows.length) {
      newlyCompleted.push({
        eventId: row.event_id,
        eventName: row.event_name || row.event_id,
        eventVersionId: row.id,
        version: row.version,
        catalogueVersion
      });
      try {
        await activity.writeActivity({
          userId,
          activityType: "event_completed",
          entityType: "event",
          entityId: row.event_id,
          data: {
            eventId: row.event_id,
            eventName: row.event_name || row.event_id,
            version: row.version,
            catalogueVersion
          },
          visibility: "friends"
        });
      } catch (err) {
        console.error("[passport] event_completed activity failed", err.message);
      }
    }
  }
  if (newlyCompleted.length) {
    try {
      await badges.awardEventCompletedBadges(userId, newlyCompleted, {
        catalogueVersion,
        notify
      });
    } catch (err) {
      console.error("[passport] event_completed badges failed", err.message);
    }
  }

  // Backfill contextual event badges for prior completions (idempotent).
  try {
    const prior = await pool.query(
      `SELECT c.event_id, c.event_version_id, c.catalogue_version, v.version, e.name AS event_name
       FROM user_event_completions c
       JOIN event_collection_versions v ON v.id = c.event_version_id
       JOIN events e ON e.id = c.event_id
       WHERE c.user_id = $1`,
      [userId]
    );
    await badges.awardEventCompletedBadges(
      userId,
      prior.rows.map((row) => ({
        eventId: row.event_id,
        eventName: row.event_name || row.event_id,
        eventVersionId: row.event_version_id,
        version: row.version,
        catalogueVersion: row.catalogue_version
      })),
      { catalogueVersion, notify: false }
    );
  } catch (err) {
    console.error("[passport] event_completed badge backfill failed", err.message);
  }

  return newlyCompleted;
}

async function unlockAchievements(userId, ctx) {
  // Étape 35 — unlock via badge definitions + verification state.
  const badges = require("./passport-badges");
  return badges.unlockBadgesForUser(userId, ctx);
}

async function updateCollectionPeak(userId, progress, catalogueVersion) {
  const existing = await pool.query("SELECT * FROM user_collection_peaks WHERE user_id = $1", [userId]);
  const prev = existing.rows[0] ? Number(existing.rows[0].peak_completion_rate) : -1;
  // Étape 16 — never lower the historical record; only raise it.
  if (existing.rows[0] && progress.completionRatePrecise <= prev + 1e-9) {
    return existing.rows[0];
  }
  const result = await pool.query(
    `INSERT INTO user_collection_peaks (
       user_id, peak_completion_rate, peak_completion_display,
       peak_owned_variant_count, peak_released_variant_count,
       peak_catalogue_version, achieved_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       peak_completion_rate = EXCLUDED.peak_completion_rate,
       peak_completion_display = EXCLUDED.peak_completion_display,
       peak_owned_variant_count = EXCLUDED.peak_owned_variant_count,
       peak_released_variant_count = EXCLUDED.peak_released_variant_count,
       peak_catalogue_version = EXCLUDED.peak_catalogue_version,
       achieved_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      progress.completionRatePrecise,
      progress.completionRateDisplay,
      progress.ownedVariantCount,
      progress.releasedVariantCount,
      catalogueVersion
    ]
  );
  return result.rows[0];
}

function buildOwnedContext(catalogue, entriesRows) {
  const validIds = new Set(catalogue.map((item) => String(item.id)));
  const ownedIds = new Set();
  const explicitIds = new Set();
  for (const row of entriesRows) {
    const variantId = String(row.variant_id || "");
    if (!validIds.has(variantId)) continue;
    const status = String(row.status || "").toLowerCase();
    if (PASSPORT_EXPLICIT_STATUSES.has(status)) explicitIds.add(variantId);
    if (compare.compareServerIsOwned(status)) ownedIds.add(variantId);
  }
  const discoveredSpriteIds = new Set(
    catalogue.filter((item) => ownedIds.has(String(item.id))).map((item) => String(item.spriteId))
  );
  const progress = computePassportProgress(ownedIds.size, catalogue.length);
  const reliability = passportReliability(explicitIds.size, catalogue.length);
  return {
    ownedIds,
    explicitIds,
    discoveredSpriteCount: discoveredSpriteIds.size,
    progress,
    reliability,
    releasedVariantCount: catalogue.length
  };
}

async function getEventProgressSections(userId, ownedIds) {
  const [versionsRes, completionsRes, eventsRes] = await Promise.all([
    pool.query(
      `SELECT v.id, v.event_id, v.version, v.required_variant_ids, v.published_at, v.ended_at, e.name AS event_name, e.end_date
       FROM event_collection_versions v
       JOIN events e ON e.id = v.event_id
       ORDER BY e.name ASC, v.version DESC`
    ),
    pool.query(
      `SELECT c.id, c.event_id, c.event_version_id, c.completed_at, c.catalogue_version, c.verification_status,
              v.version, v.required_variant_ids, v.ended_at, e.name AS event_name
       FROM user_event_completions c
       JOIN event_collection_versions v ON v.id = c.event_version_id
       JOIN events e ON e.id = c.event_id
       WHERE c.user_id = $1
       ORDER BY c.completed_at DESC`,
      [userId]
    ),
    pool.query("SELECT id, name, end_date FROM events")
  ]);

  const owned = ownedIds instanceof Set ? ownedIds : new Set(ownedIds);
  const now = new Date();
  const completed = completionsRes.rows.map((row) => {
    const required = Array.isArray(row.required_variant_ids) ? row.required_variant_ids.map(String) : [];
    return {
      eventId: row.event_id,
      eventName: row.event_name || row.event_id,
      version: row.version,
      eventVersionId: row.event_version_id,
      requiredCount: required.length,
      ownedCount: required.length,
      completedAt: row.completed_at,
      catalogueVersion: row.catalogue_version,
      historical: Boolean(row.ended_at)
    };
  });

  const completedVersionIds = new Set(completionsRes.rows.map((r) => String(r.event_version_id)));
  const latestByEvent = new Map();
  for (const row of versionsRes.rows) {
    const key = String(row.event_id);
    if (!latestByEvent.has(key)) latestByEvent.set(key, row);
  }

  const inProgress = [];
  for (const row of latestByEvent.values()) {
    if (row.ended_at) continue;
    const required = Array.isArray(row.required_variant_ids) ? row.required_variant_ids.map(String) : [];
    if (!required.length) continue;
    const missingVariantIds = required.filter((id) => !owned.has(id));
    const ownedCount = required.length - missingVariantIds.length;
    if (ownedCount <= 0 || ownedCount >= required.length) continue;
    if (completedVersionIds.has(String(row.id))) continue;
    const eventEnded = row.end_date && new Date(row.end_date) < now;
    if (eventEnded) continue;
    const endDate = row.end_date || null;
    let daysRemaining = null;
    if (endDate) {
      daysRemaining = Math.ceil((new Date(endDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (!Number.isFinite(daysRemaining)) daysRemaining = null;
    }
    const progressRate = required.length ? Math.round((ownedCount / required.length) * 1000) / 10 : 0;
    inProgress.push({
      eventId: row.event_id,
      eventName: row.event_name || row.event_id,
      version: row.version,
      eventVersionId: row.id,
      requiredCount: required.length,
      ownedCount,
      remainingCount: missingVariantIds.length,
      missingVariantIds,
      progressRate,
      endDate,
      daysRemaining
    });
  }

  const historical = completed.filter((c) => c.historical);
  const activeCompleted = completed.filter((c) => !c.historical);
  const recentlyCompleted = activeCompleted.slice(0, 5);

  return {
    completedCount: completed.length,
    completed: activeCompleted,
    recentlyCompleted,
    inProgress,
    historical
  };
}

async function listPersistedAchievements(userId) {
  try {
    const badges = require("./passport-badges");
    return await badges.listUserBadges(userId);
  } catch (err) {
    // Fallback to legacy unlocks if badge tables are not ready yet.
    const result = await pool.query(
      `SELECT achievement_id, unlocked_at, catalogue_version, meta
       FROM user_passport_achievements
       WHERE user_id = $1
       ORDER BY unlocked_at ASC`,
      [userId]
    );
    return result.rows.map((row) => {
      const def = ACHIEVEMENT_BY_ID[row.achievement_id] || {
        id: row.achievement_id,
        label: row.achievement_id,
        description: ""
      };
      return {
        id: def.id,
        label: def.label,
        description: def.description,
        unlockedAt: row.unlocked_at,
        catalogueVersion: row.catalogue_version,
        verificationStatus: "declared",
        meta: row.meta || {}
      };
    });
  }
}

/**
 * Build the shared evaluation context (catalogue, ownership, social counts, qualifiers).
 * Used by refreshPassportProgress and badge-engine.listBadgeProgress.
 */
async function buildPassportEvalContext(userId, db = pool, { notify = true } = {}) {
  const badges = require("./passport-badges");
  const [catalogueAll, entriesResult, friendsResult, squadResult, foundedResult] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    db.query("SELECT variant_id, status FROM sprite_entries WHERE user_id = $1", [userId]),
    db.query(
      `SELECT COUNT(*)::int AS count FROM friendships
       WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
      [userId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS count FROM squad_members
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    ),
    db.query(`SELECT COUNT(*)::int AS count FROM squads WHERE created_by = $1`, [userId])
  ]);

  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const catalogueVersion = computeCatalogueVersion(catalogueAll);
  await syncEventCollectionVersions(catalogue);

  const ctxBase = buildOwnedContext(catalogue, entriesResult.rows);
  await recordEventCompletions(userId, ctxBase.ownedIds, catalogueVersion, { notify });

  if (ctxBase.reliability.rate >= 90) {
    await badges.recordCatalogueReview(userId, catalogueVersion, ctxBase.reliability.rate, db);
  }

  const completions = await db.query("SELECT COUNT(*)::int AS count FROM user_event_completions WHERE user_id = $1", [
    userId
  ]);

  const earlyDef = (await badges.listBadgeDefinitions(db)).find((d) => d.code === "early_collector");
  const allRarities = badges.evaluateAllRaritiesOwned(catalogue, ctxBase.ownedIds);

  const ctx = {
    ...ctxBase.progress,
    discoveredSpriteCount: ctxBase.discoveredSpriteCount,
    reliabilityLevel: ctxBase.reliability.level,
    reliabilityRate: ctxBase.reliability.rate,
    squadCount: squadResult.rows[0]?.count || 0,
    squadCreatedCount: foundedResult.rows[0]?.count || 0,
    squadFounderQualified: await badges.userQualifiesAsSquadFounder(userId, db),
    friendCount: friendsResult.rows[0]?.count || 0,
    eventsCompletedCount: completions.rows[0]?.count || 0,
    catalogueVersion,
    releasedVariantCount: ctxBase.releasedVariantCount,
    archivistQualified: await badges.evaluateArchivistQualified(userId, { db }),
    earlyCollectorQualified: await badges.evaluateEarlyCollectorQualified(
      userId,
      earlyDef?.ruleConfig || { before: badges.EARLY_COLLECTOR_BEFORE },
      db
    ),
    allRaritiesQualified: allRarities.qualified,
    requiredRarities: allRarities.required,
    ownedRarities: allRarities.ownedRarities
  };

  return {
    catalogue,
    catalogueAll,
    catalogueVersion,
    progress: ctxBase.progress,
    ownedIds: ctxBase.ownedIds,
    reliability: ctxBase.reliability,
    ctx
  };
}

/**
 * Recompute peaks, unlock achievements and event completions for a user.
 * Safe to call after collection writes; failures should not block the write path.
 *
 * @param {number|string} userId
 * @param {string} [triggerEvent="collection.updated"] selective badge eval (Étape 52)
 * @param {object} [options] forwarded to evaluateUserBadges (notify, batchNotify, …)
 */
async function refreshPassportProgress(userId, triggerEvent = "collection.updated", options = {}) {
  const badges = require("./passport-badges");
  const badgeEngine = require("./badge-engine");
  const notify = options.notify !== false;
  const built = await buildPassportEvalContext(userId, pool, { notify });
  const peak = await updateCollectionPeak(userId, built.progress, built.catalogueVersion);

  const evalResult = await badgeEngine.evaluateUserBadges(userId, triggerEvent, {
    ctx: built.ctx,
    catalogueVersion: built.catalogueVersion,
    notify,
    batchNotify: options.batchNotify !== false,
    badgeCodes: options.badgeCodes
  });

  // Founder may unlock outside the filtered code set when trigger is collection.* —
  // still re-check so joins that only hit collection refresh eventually award.
  if (!triggerEvent || String(triggerEvent).startsWith("collection.")) {
    const founder = await badges.maybeAwardSquadFounder(userId);
    if (founder && notify) {
      await badgeEngine.notifyBadgeUnlocks(
        userId,
        [
          {
            badgeCode: "squad_founder",
            code: "squad_founder",
            label: "Fondateur de squad"
          }
        ],
        { batch: false }
      );
    }
  }

  // Étape 56 — snapshots after catalogue version / milestone / daily collection change.
  try {
    const snapshots = require("./passport-snapshots");
    const comparisonSessions = require("./comparison-sessions");
    const comparisonStats = await comparisonSessions.getComparisonStatsForUser(userId).catch(() => ({
      comparisonCount: 0,
      distinctCollectorsCompared: 0
    }));
    await snapshots.maybeCreatePassportStatSnapshot(
      userId,
      {
        catalogueVersion: built.catalogueVersion,
        ownedSpriteCount: built.ctx.discoveredSpriteCount || 0,
        ownedVariantCount: built.progress.ownedVariantCount || 0,
        releasedVariantCount: built.progress.releasedVariantCount || 0,
        completionRate: built.progress.completionRatePrecise || 0,
        collectionCoverageRate: built.ctx.reliabilityRate || 0,
        completedEventCount: built.ctx.eventsCompletedCount || 0,
        comparisonCount: comparisonStats.comparisonCount || 0
      },
      {
        unlockedCodes: (evalResult.unlocked || []).map((u) => u.badgeCode || u.code),
        // Only write paths set collectionChanged: true (daily snapshot gate).
        collectionChanged: options.collectionChanged === true
      }
    );

    // Étape 72 — materialised summary for fast passport reads.
    const summaryMod = require("./passport-summary");
    const peakRate = peak
      ? Number(peak.peak_completion_rate) || built.progress.completionRatePrecise || 0
      : built.progress.completionRatePrecise || 0;
    const releasedSpriteCount = new Set((built.catalogue || []).map((item) => String(item.spriteId))).size;
    let lastCollectionUpdateAt = null;
    try {
      const lastUp = await pool.query("SELECT MAX(updated_at) AS last_updated FROM sprite_entries WHERE user_id = $1", [
        userId
      ]);
      lastCollectionUpdateAt = lastUp.rows[0]?.last_updated || null;
    } catch (_) {
      /* ignore */
    }
    const rarityStats = require("./passport-math").computeOwnedRarityStats(
      built.catalogue || [],
      built.ownedIds || new Set()
    );
    await summaryMod.upsertPassportSummary(userId, {
      catalogueVersion: built.catalogueVersion,
      ownedSpriteCount: built.ctx.discoveredSpriteCount || 0,
      ownedVariantCount: built.progress.ownedVariantCount || 0,
      releasedSpriteCount,
      releasedVariantCount: built.progress.releasedVariantCount || 0,
      completionRate: built.progress.completionRatePrecise || 0,
      personalBestRate: Math.max(peakRate, built.progress.completionRatePrecise || 0),
      collectionCoverageRate: built.ctx.reliabilityRate || 0,
      completedEventCount: built.ctx.eventsCompletedCount || 0,
      comparisonCount: comparisonStats.comparisonCount || 0,
      distinctComparedUsers: comparisonStats.distinctCollectorsCompared || 0,
      highestOfficialRarity: rarityStats.highestOfficialRarity ? rarityStats.highestOfficialRarity.key : null,
      lastCollectionUpdateAt
    });
  } catch (err) {
    console.error("[passport] snapshot/summary failed", err.message);
  }

  return {
    catalogueVersion: built.catalogueVersion,
    progress: built.progress,
    peak,
    ctx: built.ctx,
    unlocked: evalResult.unlocked || []
  };
}

module.exports = {
  ACHIEVEMENT_DEFS,
  syncEventCollectionVersions,
  recordEventCompletions,
  unlockAchievements,
  updateCollectionPeak,
  buildPassportEvalContext,
  refreshPassportProgress,
  getEventProgressSections,
  listPersistedAchievements,
  buildOwnedContext,
  groupReleasedVariantsByEvent,
  sameVariantSet
};
