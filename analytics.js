// ── SPRITNEX comparison analytics ───────────────────────────────────────────
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

module.exports = {
  COMPARE_ANALYTICS_EVENTS,
  ensureCompareAnalyticsTable,
  logCompareAnalyticsEvent,
  getCompareAnalyticsMetrics
};
