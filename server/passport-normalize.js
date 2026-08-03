"use strict";

// Étape 70 — normalized passport API envelope.

function publicUserId(userId) {
  return `user_${userId}`;
}

function publicSquadId(squadId) {
  if (squadId == null) return null;
  return `squad_${squadId}`;
}

/**
 * Build the Étape 70 normalized response from a getCollectorPassport payload.
 * Omits gated-null sections cleanly; never invents private data.
 */
function normalizePassportResponse(passport, { relationship = null, actions = null, publicUrl = null } = {}) {
  if (!passport || !passport.user) return null;
  const u = passport.user;
  const c = passport.collection || null;
  const cat = passport.catalogue || null;
  const social = passport.social || {};
  const peak = c && (c.personalRecord || c.historicalPeak);
  const squad = passport.primarySquad;
  const featured = passport.featuredBadge || (passport.identity && passport.identity.featuredBadge);

  const primarySquad =
    squad && !squad.private
      ? {
          id: publicSquadId(squad.id),
          numericId: squad.id,
          name: squad.name,
          role: squad.role === "Fondateur" ? "owner" : squad.role || "member",
          memberCount: squad.memberCount != null ? squad.memberCount : undefined,
          collectiveCompletionRate: squad.collectiveCompletionRate
        }
      : squad && squad.private
        ? { private: true }
        : null;

  const badges = Array.isArray(passport.badgeProgress)
    ? passport.badgeProgress
        .filter((b) => b.status === "unlocked")
        .map((b) => ({
          code: b.badgeCode || b.code,
          label: b.label,
          category: b.uiCategory || b.category || null,
          unlockedAt: b.unlockedAt || null,
          verificationStatus: b.verificationStatus || null
        }))
    : Array.isArray(passport.badges)
      ? passport.badges.map((b) => ({
          code: b.code || b.id,
          label: b.label,
          unlockedAt: b.unlockedAt || null,
          verificationStatus: b.verificationStatus || null
        }))
      : [];

  const recentActivity = Array.isArray(passport.recentActivity)
    ? passport.recentActivity
        .filter((a) => a.activityType !== "account_created" && a.type !== "account_created")
        .map((a) => ({
          type: a.activityType || a.type,
          visibility: a.visibility || null,
          occurredAt: a.createdAt || a.occurredAt,
          data: a.data || {}
        }))
    : [];

  return {
    user: {
      id: publicUserId(u.id),
      numericId: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      avatarUrl: u.avatarUrl || "",
      joinedAt: u.createdAt || null
    },
    relationship: relationship || {
      isSelf: !!u.isSelf,
      isFriend: false,
      canCompare: !!(passport.permissions && passport.permissions.comparisons),
      canViewCollection: !!(passport.permissions && passport.permissions.statistics)
    },
    actions: actions || null,
    publicUrl: publicUrl || (u.username ? `/u/${encodeURIComponent(u.username)}` : null),
    passport: {
      catalogueVersion: (c && c.catalogueVersion) || (cat && cat.version) || null,
      lastCollectionUpdateAt: (c && c.lastUpdatedAt) || null,
      statistics: c
        ? {
            ownedSpriteCount: c.ownedSpriteCount != null ? c.ownedSpriteCount : c.discoveredSpriteCount,
            releasedSpriteCount: cat ? cat.releasedSpriteCount : null,
            ownedVariantCount: c.ownedVariantCount,
            releasedVariantCount: c.releasedVariantCount,
            completionRate: c.completionRatePrecise != null ? c.completionRatePrecise : c.completionRate,
            completionRateDisplay: c.completionRateDisplay,
            personalBestRate: peak ? peak.completionRate : null,
            personalBestRateDisplay: peak ? peak.completionRateDisplay : null,
            collectionCoverageRate: c.reliability ? c.reliability.rate : null,
            completedEventCount:
              passport.eventsCompleted != null
                ? passport.eventsCompleted
                : passport.events
                  ? passport.events.completedCount
                  : null,
            comparisonCount: social.comparisonCount != null ? social.comparisonCount : null,
            distinctComparedUsers: social.distinctCollectorsCompared != null ? social.distinctCollectorsCompared : null,
            highestOfficialRarity: c.highestOfficialRarity ? c.highestOfficialRarity.key : null,
            rarestSpecialVariant: c.rarestSpecialVariant ? c.rarestSpecialVariant.key : null
          }
        : null,
      primarySquad,
      featuredBadge: featured ? { code: featured.code, label: featured.label, badgeId: featured.badgeId } : null,
      badges,
      badgeProgress: Array.isArray(passport.badgeProgress) ? passport.badgeProgress : [],
      events: passport.events || null,
      recentActivity,
      permissions: passport.permissions || null
    }
  };
}

/**
 * Étape 66 — contextual action keys for the client.
 */
function buildPassportActions({ isSelf, isFriend, canCompare, canViewCollection, passportPublic }) {
  if (isSelf) {
    return [
      "edit_profile",
      "manage_privacy",
      "choose_primary_squad",
      "pin_badge",
      "share_passport",
      "update_collection"
    ];
  }
  if (isFriend) {
    const actions = [];
    if (canCompare) actions.push("compare_collections");
    actions.push("invite_to_squad", "create_shared_goal");
    return actions;
  }
  // Public visitor (logged-in stranger or anonymous)
  const actions = [];
  if (canViewCollection || passportPublic) actions.push("view_public_collection");
  actions.push("add_friend");
  if (canCompare) actions.push("compare_collections");
  return actions;
}

module.exports = {
  publicUserId,
  publicSquadId,
  normalizePassportResponse,
  buildPassportActions
};
