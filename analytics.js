// ── SPRITE-INDEX comparison analytics ───────────────────────────────────────────
// Anonymised usage events for the compare feature. No IP / user-agent / PII
// stored beyond a nullable user_id for per-user aggregates.

const COMPARE_ANALYTICS_EVENTS = new Set([
  "comparison_created",
  "comparison_viewed",
  "comparison_shared",
  "comparison_filter_used",
  "missing_match_opened",
  "priority_added_from_comparison",
  "app_returned_from_compare",
  "compare_invitation_generated"
]);

async function ensureCompareAnalyticsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS compare_analytics (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type VARCHAR(40) NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_compare_analytics_user ON compare_analytics (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_compare_analytics_event ON compare_analytics (event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_compare_analytics_created ON compare_analytics (created_at DESC);
  `);
}

async function logCompareAnalyticsEvent(pool, { userId, event, details = {} }) {
  if (!COMPARE_ANALYTICS_EVENTS.has(event)) return;
  try {
    await pool.query(
      `INSERT INTO compare_analytics (user_id, event_type, details)
       VALUES ($1, $2, $3)`,
      [userId || null, event, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[ANALYTICS] Failed to log compare event:", err.message);
  }
}

async function getCompareAnalyticsMetrics(pool, { days = 30 } = {}) {
  const since = `NOW() - INTERVAL '${Math.max(1, Math.min(365, days))} days'`;
  try {
    const totalComparisons = await pool.query(
      `SELECT COUNT(*)::int AS total FROM compare_analytics
       WHERE event_type = 'comparison_viewed' AND created_at > ${since}`
    );
    const uniqueUsers = await pool.query(
      `SELECT COUNT(DISTINCT user_id)::int AS total FROM compare_analytics
       WHERE event_type = 'comparison_viewed' AND user_id IS NOT NULL AND created_at > ${since}`
    );
    const totalShares = await pool.query(
      `SELECT COUNT(*)::int AS total FROM compare_analytics
       WHERE event_type = 'comparison_shared' AND created_at > ${since}`
    );
    const totalPriorities = await pool.query(
      `SELECT COUNT(*)::int AS total FROM compare_analytics
       WHERE event_type = 'priority_added_from_comparison' AND created_at > ${since}`
    );
    const totalReturns = await pool.query(
      `SELECT COUNT(*)::int AS total FROM compare_analytics
       WHERE event_type = 'app_returned_from_compare' AND created_at > ${since}`
    );
    const totalInvites = await pool.query(
      `SELECT COUNT(*)::int AS total FROM compare_analytics
       WHERE event_type = 'compare_invitation_generated' AND created_at > ${since}`
    );
    const topFilter = await pool.query(
      `SELECT details->>'filter' AS filter, COUNT(*)::int AS count
       FROM compare_analytics
       WHERE event_type = 'comparison_filter_used' AND created_at > ${since}
       GROUP BY details->>'filter'
       ORDER BY count DESC
       LIMIT 1`
    );
    const cmp = totalComparisons.rows[0].total || 0;
    const users = uniqueUsers.rows[0].total || 0;
    const shares = totalShares.rows[0].total || 0;
    return {
      days,
      totalComparisons: cmp,
      uniqueUsers: users,
      comparisonsPerUser: users ? Math.round((cmp / users) * 100) / 100 : 0,
      totalShares: shares,
      shareRate: cmp ? Math.round((shares / cmp) * 10000) / 100 : 0,
      topFilter: topFilter.rows[0] || null,
      totalPrioritiesAdded: totalPriorities.rows[0].total || 0,
      totalReturns: totalReturns.rows[0].total || 0,
      totalInvites: totalInvites.rows[0].total || 0
    };
  } catch (err) {
    console.error("[ANALYTICS] Metrics query failed:", err.message);
    throw err;
  }
}

const PRODUCT_ANALYTICS_EVENTS = new Set([
  "friend_invited_to_squad",
  "squad_member_friend_request_sent",
  "squad_member_comparison_opened",
  "shared_goal_created",
  "shared_goal_completed",
  "squad_recommendation_viewed",
  "recommended_friend_invited",
  "friend_joined_squad",
  // Étape 87 — Collector Passport product events
  "passport_opened",
  "passport_shared",
  "passport_comparison_started",
  "passport_badge_opened",
  "passport_badge_unlocked",
  "passport_privacy_changed",
  "passport_primary_squad_selected",
  "passport_share_card_generated"
]);

/** Client-posted passport events (UI-only interactions). */
const PASSPORT_CLIENT_ANALYTICS_EVENTS = new Set([
  "passport_shared",
  "passport_comparison_started",
  "passport_badge_opened"
]);

async function ensureProductAnalyticsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_analytics (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      squad_id INTEGER REFERENCES squads(id) ON DELETE SET NULL,
      event_type VARCHAR(50) NOT NULL,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_product_analytics_user ON product_analytics (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_product_analytics_squad ON product_analytics (squad_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_product_analytics_event ON product_analytics (event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_product_analytics_created ON product_analytics (created_at DESC);
  `);
}

async function logProductAnalyticsEvent(pool, { userId, squadId, event, details = {} }) {
  if (!PRODUCT_ANALYTICS_EVENTS.has(event)) return;
  try {
    await pool.query(
      `INSERT INTO product_analytics (user_id, squad_id, event_type, details)
       VALUES ($1, $2, $3, $4)`,
      [userId || null, squadId || null, event, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[ANALYTICS] Failed to log product event:", err.message);
  }
}

async function getProductAnalyticsMetrics(pool, { days = 30 } = {}) {
  const since = `NOW() - INTERVAL '${Math.max(1, Math.min(365, days))} days'`;
  try {
    const friendsInvited = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'friend_invited_to_squad' AND created_at > ${since}`
    );
    const recommendedFriendsInvited = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'recommended_friend_invited' AND created_at > ${since}`
    );
    const recommendationsViewed = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'squad_recommendation_viewed' AND created_at > ${since}`
    );
    const comparisonsFromSquad = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'squad_member_comparison_opened' AND created_at > ${since}`
    );
    const sharedGoalsCreated = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'shared_goal_created' AND created_at > ${since}`
    );
    const sharedGoalsCompleted = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'shared_goal_completed' AND created_at > ${since}`
    );
    const friendRequestsToMembers = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'squad_member_friend_request_sent' AND created_at > ${since}`
    );

    // Acceptance rate from real squad invitations (accepted / total) over the period.
    const invitations = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted,
         COUNT(*)::int AS total
       FROM squad_invitations
       WHERE created_at > ${since}`
    );

    const joins = await pool.query(
      `SELECT COUNT(*)::int AS total, AVG(COALESCE((details->>'completionRateDelta')::numeric, 0)) AS avg_delta
       FROM product_analytics
       WHERE event_type = 'friend_joined_squad' AND created_at > ${since}`
    );

    const invited = friendsInvited.rows[0].total || 0;
    const accepted = invitations.rows[0].accepted || 0;
    const totalInv = invitations.rows[0].total || 0;
    const recViewed = recommendationsViewed.rows[0].total || 0;

    const passport = await getPassportAnalyticsMetrics(pool, { days });

    return {
      days,
      friendsInvitedToSquad: invited,
      recommendedFriendsInvited: recommendedFriendsInvited.rows[0].total || 0,
      recommendationUsageRate: recViewed
        ? Math.round(((recommendedFriendsInvited.rows[0].total || 0) / recViewed) * 10000) / 100
        : 0,
      invitationAcceptanceRate: totalInv ? Math.round((accepted / totalInv) * 10000) / 100 : 0,
      comparisonsLaunchedFromSquad: comparisonsFromSquad.rows[0].total || 0,
      sharedGoalsCreated: sharedGoalsCreated.rows[0].total || 0,
      sharedGoalsCompleted: sharedGoalsCompleted.rows[0].total || 0,
      squadMemberFriendRequestsSent: friendRequestsToMembers.rows[0].total || 0,
      friendsJoinedSquad: joins.rows[0].total || 0,
      averageProgressAfterFriendJoin: joins.rows[0].avg_delta ? Math.round(joins.rows[0].avg_delta * 100) / 100 : 0,
      passport
    };
  } catch (err) {
    console.error("[ANALYTICS] Product metrics query failed:", err.message);
    throw err;
  }
}

/**
 * Étape 87 — passport usage measures.
 * Events come from product_analytics; completion / update rates from summaries + change log.
 */
async function getPassportAnalyticsMetrics(pool, { days = 30 } = {}) {
  const since = `NOW() - INTERVAL '${Math.max(1, Math.min(365, days))} days'`;
  try {
    const opened = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT user_id)::int AS viewers,
              COUNT(DISTINCT NULLIF(details->>'ownerId', ''))::int AS owners_viewed
       FROM product_analytics
       WHERE event_type = 'passport_opened' AND created_at > ${since}`
    );
    const shared = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'passport_shared' AND created_at > ${since}`
    );
    const comparisons = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'passport_comparison_started' AND created_at > ${since}`
    );
    const badgeUnlocks = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT user_id)::int AS users
       FROM product_analytics
       WHERE event_type = 'passport_badge_unlocked' AND created_at > ${since}`
    );
    const returningAfterBadge = await pool.query(
      `SELECT COUNT(DISTINCT o.user_id)::int AS total
       FROM product_analytics o
       WHERE o.event_type = 'passport_opened'
         AND o.created_at > ${since}
         AND EXISTS (
           SELECT 1 FROM product_analytics u
           WHERE u.event_type = 'passport_badge_unlocked'
             AND u.user_id = o.user_id
             AND u.created_at > ${since}
             AND u.created_at < o.created_at
         )`
    );
    const cards = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'passport_share_card_generated' AND created_at > ${since}`
    );
    const privacy = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'passport_privacy_changed' AND created_at > ${since}`
    );
    const primarySquad = await pool.query(
      `SELECT COUNT(*)::int AS total FROM product_analytics
       WHERE event_type = 'passport_primary_squad_selected' AND created_at > ${since}`
    );
    const avgCompletion = await pool.query(
      `SELECT COALESCE(AVG(completion_rate), 0)::float AS avg_rate,
              COUNT(*)::int AS passports
       FROM user_passport_summaries`
    );
    const collectionUpdates = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT user_id)::int AS users
       FROM collection_change_log
       WHERE created_at > ${since}`
    );

    const openedTotal = opened.rows[0].total || 0;
    const sharedTotal = shared.rows[0].total || 0;
    const updateTotal = collectionUpdates.rows[0].total || 0;
    const updateUsers = collectionUpdates.rows[0].users || 0;

    return {
      days,
      passportsOpened: openedTotal,
      uniquePassportViewers: opened.rows[0].viewers || 0,
      uniquePassportsViewed: opened.rows[0].owners_viewed || 0,
      passportShares: sharedTotal,
      shareRate: openedTotal ? Math.round((sharedTotal / openedTotal) * 10000) / 100 : 0,
      comparisonsStartedFromPassport: comparisons.rows[0].total || 0,
      badgeUnlockEvents: badgeUnlocks.rows[0].total || 0,
      usersWhoUnlockedBadge: badgeUnlocks.rows[0].users || 0,
      usersReturningAfterBadge: returningAfterBadge.rows[0].total || 0,
      shareCardsGenerated: cards.rows[0].total || 0,
      privacyChanges: privacy.rows[0].total || 0,
      primarySquadSelections: primarySquad.rows[0].total || 0,
      averageCompletionRate: Math.round((avgCompletion.rows[0].avg_rate || 0) * 1000) / 10,
      summarizedPassports: avgCompletion.rows[0].passports || 0,
      collectionUpdates: updateTotal,
      collectionUpdateUsers: updateUsers,
      collectionUpdatesPerUser: updateUsers ? Math.round((updateTotal / updateUsers) * 100) / 100 : 0
    };
  } catch (err) {
    console.error("[ANALYTICS] Passport metrics query failed:", err.message);
    throw err;
  }
}

module.exports = {
  COMPARE_ANALYTICS_EVENTS,
  ensureCompareAnalyticsTable,
  logCompareAnalyticsEvent,
  getCompareAnalyticsMetrics,
  PRODUCT_ANALYTICS_EVENTS,
  PASSPORT_CLIENT_ANALYTICS_EVENTS,
  ensureProductAnalyticsTable,
  logProductAnalyticsEvent,
  getProductAnalyticsMetrics,
  getPassportAnalyticsMetrics
};
