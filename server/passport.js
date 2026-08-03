"use strict";

// Collector Passport — deterministic published-catalogue stats + section gating.
const { pool } = require("./db");
const compare = require("./compare");
const { computeCatalogueVersion } = require("./squad-analysis-cache");
const { canViewPassportSection } = require("./auth");
const { passportReliability, computePassportProgress, computeOwnedRarityStats } = require("./passport-math");
const achievements = require("./passport-achievements");
const comparisonSessions = require("./comparison-sessions");
const passportActivity = require("./passport-activity");

// Étape 4/5 — statuses that mean the collector intentionally classified a variant.
const PASSPORT_EXPLICIT_STATUSES = new Set(["owned", "missing", "priority", "spotted", "unavailable", "unknown"]);

/**
 * Étapes 24–25 — only the user-chosen primary_squad_id (no auto-pick).
 * Respects squad.visibility: private/members hide details from non-members.
 */
async function buildPrimarySquadSummary(viewerId, ownerId, settings, squadRows, catalogue) {
  const primaryId = settings && settings.primary_squad_id;
  if (primaryId == null || primaryId === "") return null;

  const squad = (squadRows || []).find((s) => String(s.id) === String(primaryId));
  if (!squad) return null;

  const isSelf = String(viewerId) === String(ownerId);
  const visibility = String(squad.visibility || "members").toLowerCase();

  let viewerIsMember = isSelf;
  if (!isSelf) {
    const mem = await pool.query(
      `SELECT 1 FROM squad_members
       WHERE squad_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [squad.id, viewerId]
    );
    viewerIsMember = mem.rows.length > 0;
  }

  const canSeeDetails = isSelf || viewerIsMember || visibility === "public";
  if (!canSeeDetails) {
    return { private: true, display: "Squad privée" };
  }

  const membersResult = await pool.query(
    `SELECT user_id, role FROM squad_members WHERE squad_id = $1 AND status = 'active'`,
    [squad.id]
  );
  const memberIds = membersResult.rows.map((row) => row.user_id);
  const summary = await compare.getSquadCollectiveCompletionSummary(memberIds, catalogue);
  const ownerMembership = membersResult.rows.find((row) => String(row.user_id) === String(ownerId));
  const isFounder =
    String(squad.created_by) === String(ownerId) || String(ownerMembership?.role || "").toLowerCase() === "owner";
  const roleLabel = isFounder
    ? "Fondateur"
    : String(ownerMembership?.role || "").toLowerCase() === "admin"
      ? "Admin"
      : "Membre";
  const rate = Number(summary.collectiveCompletionRate) || 0;

  return {
    private: false,
    id: squad.id,
    code: squad.code,
    name: squad.name,
    memberCount: memberIds.length,
    collectiveCompletionRate: Math.round(rate * 100) / 100,
    collectiveCompletionDisplay: Math.round(rate * 10) / 10,
    role: roleLabel,
    joinedAt: squad.joined_at,
    visibility
  };
}

async function ensureCollectorPassport(userId) {
  await pool.query("INSERT INTO collector_passports (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  // Étape 59 — ensure featured_badge_id exists on older installs.
  await pool
    .query(
      `
    ALTER TABLE collector_passports
      ADD COLUMN IF NOT EXISTS featured_badge_id UUID
  `
    )
    .catch(() => {});
  const result = await pool.query("SELECT * FROM collector_passports WHERE user_id = $1", [userId]);
  return result.rows[0];
}

/**
 * Étape 59 — resolve featured badge or clear it when revoked/hidden/missing.
 */
async function resolveFeaturedBadge(userId, featuredBadgeId) {
  if (!featuredBadgeId) return null;
  const result = await pool.query(
    `SELECT
       d.id AS badge_id,
       d.code,
       d.name_key,
       d.description_key,
       d.icon_key,
       d.category,
       ub.id AS user_badge_id,
       ub.unlocked_at,
       ub.context_type,
       ub.context_id,
       ub.evidence
     FROM badge_definitions d
     JOIN user_badges ub ON ub.badge_id = d.id
     WHERE ub.user_id = $1
       AND d.id = $2::uuid
       AND ub.revoked_at IS NULL
       AND d.is_active = TRUE
       AND d.is_hidden = FALSE
     ORDER BY ub.unlocked_at ASC
     LIMIT 1`,
    [userId, featuredBadgeId]
  );
  if (!result.rows.length) {
    await pool.query(
      `UPDATE collector_passports
       SET featured_badge_id = NULL, updated_at = NOW()
       WHERE user_id = $1 AND featured_badge_id = $2::uuid`,
      [userId, featuredBadgeId]
    );
    return null;
  }
  const row = result.rows[0];
  const badges = require("./passport-badges");
  const evidence = row.evidence || {};
  const baseLabel = badges.resolveBadgeCopy(row.name_key);
  const eventName = evidence.eventName || null;
  const label = row.code === "event_completed" && eventName ? `${baseLabel} · ${eventName}` : baseLabel;
  return {
    badgeId: row.badge_id,
    code: row.code,
    label,
    description: badges.resolveBadgeCopy(row.description_key),
    iconKey: row.icon_key,
    category: row.category,
    userBadgeId: row.user_badge_id,
    unlockedAt: row.unlocked_at,
    contextType: row.context_type,
    contextId: row.context_id
  };
}

/** Legacy helper kept for unit tests that still import buildBadges. */
function buildBadges(ctx) {
  return achievements.ACHIEVEMENT_DEFS.filter((def) =>
    def.check({
      ownedVariantCount: ctx.ownedCount || 0,
      discoveredSpriteCount: ctx.discoveredCount || 0,
      completionRatePrecise: ctx.completionRate || 0,
      reliabilityLevel: ctx.reliability && ctx.reliability.level,
      squadCount: ctx.squadCount || 0,
      friendCount: ctx.friendCount || 0,
      eventsCompletedCount: ctx.eventsCompleted || 0,
      catalogueVersion: "test"
    })
  ).map((def) => ({ id: def.id, label: def.label, description: def.description }));
}

/**
 * Builds a viewer-filtered passport payload.
 * Returns { status, error } on denial, or { status: 200, passport }.
 */
async function getCollectorPassport(viewerId, ownerId) {
  const id = Number(ownerId);
  if (!Number.isSafeInteger(id) || id < 1) {
    return { status: 404, error: "Utilisateur non trouvé" };
  }
  if (!viewerId) {
    // Étape 67 — allow anonymous read when the passport itself is public.
    const publicOk = await canViewPassportSection(null, id, "passport");
    if (!publicOk) {
      return { status: 401, error: "Authentification requise" };
    }
  }

  const isSelf = viewerId != null && String(viewerId) === String(id);
  const permissions = isSelf
    ? { passport: true, statistics: true, badges: true, activity: true, comparisons: true }
    : Object.fromEntries(
        await Promise.all(
          ["passport", "statistics", "badges", "activity", "comparisons"].map(async (key) => [
            key,
            await canViewPassportSection(viewerId || null, id, key)
          ])
        )
      );
  if (!permissions.passport) {
    return { status: 404, error: "Passeport non accessible" };
  }

  let isFriend = false;
  if (viewerId && !isSelf) {
    const { areFriends } = require("./auth");
    isFriend = await areFriends(viewerId, id);
  }

  // Étape 72 — do not fully recalculate on every view.
  // Owner reads refresh only when summary is missing/stale vs collection or catalogue.
  const summaryMod = require("./passport-summary");
  let summary = await summaryMod.getPassportSummary(id);
  const catalogueAllPreview = await compare.getServerCompareCatalogItemsCached();
  const currentCatalogueVersion = computeCatalogueVersion(catalogueAllPreview);
  const lastEntryRes = await pool.query(
    "SELECT MAX(updated_at) AS last_updated FROM sprite_entries WHERE user_id = $1",
    [id]
  );
  const lastEntryAt = lastEntryRes.rows[0]?.last_updated ? new Date(lastEntryRes.rows[0].last_updated) : null;
  const summaryAt = summary && summary.recalculatedAt ? new Date(summary.recalculatedAt) : null;
  const summaryStaleVsCollection = !!(lastEntryAt && (!summaryAt || summaryAt < lastEntryAt));
  const summaryStaleVsCatalogue = !!(summary && summary.catalogueVersion !== currentCatalogueVersion);

  if (!summary || (isSelf && (summaryStaleVsCollection || summaryStaleVsCatalogue))) {
    try {
      await achievements.refreshPassportProgress(id, "collection.updated", { notify: false });
      summary = await summaryMod.getPassportSummary(id);
    } catch (err) {
      console.error("[passport] summary refresh failed", err);
    }
  } else if (summaryStaleVsCatalogue) {
    summaryMod
      .enqueuePassportRecalc(id, {
        reason: "catalogue_version_drift",
        triggerEvent: "catalogue.published",
        collectionChanged: false,
        notify: false
      })
      .catch(() => {});
  }

  const [userResult, catalogueAll, entriesResult, squadResult, friendsResult, passportRow, peakResult] =
    await Promise.all([
      pool.query(
        "SELECT id, username, display_name, avatar_url, created_at FROM users WHERE id = $1 AND deleted_at IS NULL",
        [id]
      ),
      Promise.resolve(catalogueAllPreview),
      pool.query("SELECT variant_id, status, updated_at FROM sprite_entries WHERE user_id = $1", [id]),
      pool.query(
        `SELECT s.id, s.code, s.name, s.created_by, s.visibility, sm.joined_at, sm.role
       FROM squads s JOIN squad_members sm ON sm.squad_id = s.id
       WHERE sm.user_id = $1 AND sm.status = 'active'
       ORDER BY sm.joined_at ASC`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM friendships
       WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
        [id]
      ),
      ensureCollectorPassport(id),
      pool.query("SELECT * FROM user_collection_peaks WHERE user_id = $1", [id])
    ]);

  if (!userResult.rows.length) {
    return { status: 404, error: "Utilisateur non trouvé" };
  }

  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const validIds = new Set(catalogue.map((item) => String(item.id)));
  const ownedIds = new Set();
  const explicitIds = new Set();
  let lastUpdatedAt = null;

  for (const row of entriesResult.rows) {
    const variantId = String(row.variant_id || "");
    if (!validIds.has(variantId)) continue;
    const status = String(row.status || "").toLowerCase();
    if (PASSPORT_EXPLICIT_STATUSES.has(status)) explicitIds.add(variantId);
    if (compare.compareServerIsOwned(status)) ownedIds.add(variantId);
    if (row.updated_at && (!lastUpdatedAt || new Date(row.updated_at) > new Date(lastUpdatedAt))) {
      lastUpdatedAt = row.updated_at;
    }
  }

  const releasedSpriteIds = new Set(catalogue.map((item) => String(item.spriteId)));
  const discoveredSpriteIds = new Set(
    catalogue.filter((item) => ownedIds.has(String(item.id))).map((item) => String(item.spriteId))
  );

  const rarityStats = computeOwnedRarityStats(catalogue, ownedIds);

  const reliability = passportReliability(explicitIds.size, catalogue.length);
  const catalogueVersion = computeCatalogueVersion(catalogueAll);
  const releasedVariantCount = catalogue.length;
  const ownedVariantCount = ownedIds.size;
  const discoveredSpriteCount = discoveredSpriteIds.size;
  const progress = computePassportProgress(ownedVariantCount, releasedVariantCount);
  const friendCount = friendsResult.rows[0]?.count || 0;
  const squadCount = squadResult.rows.length;

  const badgeEngine = require("./badge-engine");
  const [persistedBadges, badgeProgress, eventSections, comparisonStats, recentActivityRaw] = await Promise.all([
    permissions.badges ? achievements.listPersistedAchievements(id) : Promise.resolve([]),
    permissions.badges ? badgeEngine.listBadgeProgress(id) : Promise.resolve([]),
    permissions.statistics ? achievements.getEventProgressSections(id, ownedIds) : Promise.resolve(null),
    permissions.comparisons
      ? comparisonSessions.getComparisonStatsForUser(id)
      : Promise.resolve({ comparisonCount: null, distinctCollectorsCompared: null }),
    permissions.activity
      ? passportActivity.listRecentActivity(id, { limit: Math.max(passportActivity.ACTIVITY_FEED_LIMIT, 20) })
      : Promise.resolve([])
  ]);

  const settings = passportRow || {
    show_join_date: true,
    show_last_activity: true,
    primary_squad_id: null,
    featured_badge_id: null
  };

  // Étape 65 — filter each activity row by its own visibility (not only section gate).
  let recentActivity = recentActivityRaw;
  if (permissions.activity && !isSelf) {
    let friendOk = false;
    let squadOk = false;
    if (viewerId) {
      const authHelpers = require("./auth");
      [friendOk, squadOk] = await Promise.all([
        authHelpers.areFriends(viewerId, id),
        authHelpers.shareActiveSquad(viewerId, id)
      ]);
    }
    recentActivity = recentActivityRaw.filter((item) => {
      const vis = String(item.visibility || "friends");
      if (vis === "public") return true;
      if (vis === "private") return false;
      if (vis === "friends") return friendOk;
      if (vis === "squad") return squadOk;
      return false;
    });
  }

  // Synthetic inscription entry when join date is visible.
  if (permissions.activity && settings.show_join_date && userResult.rows[0].created_at) {
    recentActivity = [
      ...recentActivity,
      {
        id: `account-created-${id}`,
        activityType: "account_created",
        type: "account_created",
        visibility: "public",
        createdAt: userResult.rows[0].created_at,
        occurredAt: userResult.rows[0].created_at,
        data: {}
      }
    ]
      .sort((a, b) => new Date(b.createdAt || b.occurredAt) - new Date(a.createdAt || a.occurredAt))
      .slice(0, 25);
  }

  // Étape 24 — never auto-select a squad when primary_squad_id is unset.
  const primarySquad = permissions.statistics
    ? await buildPrimarySquadSummary(viewerId, id, settings, squadResult.rows, catalogue)
    : null;

  const createdAt = settings.show_join_date ? userResult.rows[0].created_at : null;
  const peakRow = peakResult.rows[0] || null;
  const historicalPeak = peakRow
    ? {
        completionRate: Number(peakRow.peak_completion_rate),
        completionRateDisplay: Number(peakRow.peak_completion_display),
        ownedVariantCount: peakRow.peak_owned_variant_count,
        releasedVariantCount: peakRow.peak_released_variant_count,
        catalogueVersion: peakRow.peak_catalogue_version,
        achievedAt: peakRow.achieved_at
      }
    : null;

  // Étape 59 — featured badge must stay unlocked + visible.
  let featuredBadge = null;
  if (permissions.badges && settings.featured_badge_id) {
    featuredBadge = await resolveFeaturedBadge(id, settings.featured_badge_id);
  }

  const reliabilityQuality =
    reliability.level === "complete"
      ? "Collection complète"
      : reliability.level === "usable"
        ? "Collection exploitable"
        : "Collection à compléter";

  return {
    status: 200,
    passport: {
      user: {
        id: userResult.rows[0].id,
        username: userResult.rows[0].username,
        displayName: userResult.rows[0].display_name,
        avatarUrl: userResult.rows[0].avatar_url || "",
        createdAt,
        isSelf
      },
      // Étape 58 — identity header fields.
      identity: {
        username: userResult.rows[0].username,
        displayName: userResult.rows[0].display_name,
        avatarUrl: userResult.rows[0].avatar_url || "",
        createdAt,
        primarySquad:
          primarySquad && !primarySquad.private
            ? { id: primarySquad.id, name: primarySquad.name, role: primarySquad.role }
            : primarySquad && primarySquad.private
              ? { private: true }
              : null,
        featuredBadge: permissions.badges ? featuredBadge : null
      },
      featuredBadge: permissions.badges ? featuredBadge : null,
      permissions,
      catalogue: permissions.statistics
        ? {
            version: catalogueVersion,
            releasedSpriteCount: releasedSpriteIds.size,
            releasedVariantCount
          }
        : null,
      collection: permissions.statistics
        ? (() => {
            let collectionBlock = {
              discoveredSpriteCount,
              ownedSpriteCount: discoveredSpriteCount,
              ownedVariantCount,
              releasedVariantCount,
              completionRate: progress.completionRate,
              completionRatePrecise: progress.completionRatePrecise,
              completionRateDisplay: progress.completionRateDisplay,
              catalogueVersion,
              // Étape 55 — personal best completion rate.
              historicalPeak,
              personalRecord: historicalPeak,
              progress: {
                ownedVariantCount,
                releasedVariantCount,
                completionRate: progress.completionRate,
                completionRateDisplay: progress.completionRateDisplay,
                catalogueVersion,
                nextStep: progress.nextStep,
                historicalPeak,
                personalRecord: historicalPeak,
                lastUpdatedAt,
                quality: reliabilityQuality,
                reliability
              },
              reliability,
              reliabilityQuality,
              lastUpdatedAt,
              // Étapes 21–23 — official rarity ≠ special variant type.
              highestRarity: rarityStats.display,
              highestOfficialRarity: rarityStats.highestOfficialRarity,
              rarestSpecialVariant: rarityStats.rarestSpecialVariant,
              // Étape 61 — breakdowns that open the checklist with matching filters.
              rarityBreakdown: rarityStats.rarityBreakdown || [],
              variantTypeBreakdown: rarityStats.variantTypeBreakdown || []
            };
            // Étape 72 — prefer materialised summary for headline stats when present.
            if (summary) {
              collectionBlock = summaryMod.applySummaryToCollection(collectionBlock, summary, peakRow);
              // Keep live rarity breakdowns from entries (not stored in summary).
              collectionBlock.highestRarity = rarityStats.display;
              collectionBlock.highestOfficialRarity = rarityStats.highestOfficialRarity;
              collectionBlock.rarestSpecialVariant = rarityStats.rarestSpecialVariant;
              collectionBlock.rarityBreakdown = rarityStats.rarityBreakdown || [];
              collectionBlock.variantTypeBreakdown = rarityStats.variantTypeBreakdown || [];
              collectionBlock.reliability = {
                ...reliability,
                rate: summary.collectionCoverageRate
              };
              collectionBlock.reliabilityQuality = reliabilityQuality;
            }
            return collectionBlock;
          })()
        : null,
      eventsCompleted: permissions.statistics
        ? summary && summary.completedEventCount != null
          ? summary.completedEventCount
          : eventSections
            ? eventSections.completedCount
            : null
        : null,
      events: permissions.statistics ? eventSections : null,
      primarySquad,
      social: {
        friendCount: permissions.statistics ? friendCount : null,
        squadCount: permissions.statistics ? squadCount : null,
        // Étapes 27–30 — always read live session stats (cheap); summary lags the queue.
        comparisonCount: permissions.comparisons ? comparisonStats.comparisonCount : null,
        distinctCollectorsCompared: permissions.comparisons ? comparisonStats.distinctCollectorsCompared : null
      },
      summary:
        permissions.statistics && summary
          ? {
              catalogueVersion: summary.catalogueVersion,
              recalculatedAt: summary.recalculatedAt,
              fromSummary: true
            }
          : null,
      badges: permissions.badges ? persistedBadges : [],
      // Étape 51 — locked + unlocked with live progress.
      badgeProgress: permissions.badges ? badgeProgress : [],
      recentActivity: permissions.activity && settings.show_last_activity ? recentActivity : [],
      // Étapes 66–70 — relationship + contextual actions + public URL.
      relationship: {
        isSelf,
        isFriend,
        canCompare: !!permissions.comparisons,
        canViewCollection: !!permissions.statistics
      },
      actions: require("./passport-normalize").buildPassportActions({
        isSelf,
        isFriend,
        canCompare: !!permissions.comparisons,
        canViewCollection: !!permissions.statistics,
        passportPublic: !!permissions.passport
      }),
      publicUrl: userResult.rows[0].username ? `/u/${encodeURIComponent(userResult.rows[0].username)}` : null,
      // Étape 78 — declarative collection (cannot verify with Epic yet).
      declarative: {
        collection: "Collection déclarée par l’utilisateur",
        badges: "Calculé à partir de la collection déclarée"
      },
      // Étape 79 — no global rankings on the passport.
      rankings: require("./passport-integrity").PASSPORT_RANKINGS_DEFERRED
    }
  };
}

module.exports = {
  ensureCollectorPassport,
  getCollectorPassport,
  buildPrimarySquadSummary,
  resolveFeaturedBadge,
  passportReliability,
  buildBadges,
  computePassportProgress,
  computeOwnedRarityStats
};
