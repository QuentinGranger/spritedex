const {
  pool, EXPLICIT_COLLECTION_STATUSES, SQUAD_COMMUNITY_ELIGIBILITY
} = require("./shared");

function hasAnalyticsConsent(cookieConsent) {
  if (!cookieConsent || typeof cookieConsent !== "object") return false;
  return cookieConsent.analytics === true;
}

module.exports = { listEligibleSquadIds };

/**
 * Étape 57 — squads eligible for community averages.
 */
async function listEligibleSquadIds(db = pool, {
  minActiveMembers = SQUAD_COMMUNITY_ELIGIBILITY.minActiveMembers,
  minCollectionFillRate = SQUAD_COMMUNITY_ELIGIBILITY.minCollectionFillRate,
  recentActivityDays = SQUAD_COMMUNITY_ELIGIBILITY.recentActivityDays,
  requireAnalyticsConsent = SQUAD_COMMUNITY_ELIGIBILITY.requireAnalyticsConsent,
  asOf = new Date()
} = {}) {
  const catalogue = await db.query(`SELECT COUNT(*)::int AS n FROM sprite_variants`);
  const catalogueCount = catalogue.rows[0]?.n || 0;
  if (catalogueCount <= 0) return [];

  const fillRaw = Number(minCollectionFillRate);
  const fillRate = Number.isFinite(fillRaw) ? Math.min(1, Math.max(0, fillRaw)) : 0.6;
  const minEntries = Math.ceil(catalogueCount * fillRate);
  const minMembers = Math.max(2, Math.floor(Number(minActiveMembers) || 2));

  const result = await db.query(
    `WITH active_members AS (
       SELECT sm.squad_id, sm.user_id,
              u.is_test_account, u.community_stats_opt_in, u.cookie_consent,
              u.last_active_at, u.deleted_at, u.suspended_until,
              COALESCE(e.entry_count, 0)::int AS entry_count
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       LEFT JOIN (
         SELECT user_id, COUNT(*)::int AS entry_count
         FROM sprite_entries
         WHERE status = ANY($1::text[])
         GROUP BY user_id
       ) e ON e.user_id = sm.user_id
       WHERE sm.status = 'active'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < $2::timestamptz)
     )
     SELECT am.squad_id,
            COUNT(*)::int AS active_member_count,
            COUNT(*) FILTER (
              WHERE am.entry_count >= $3
                AND am.last_active_at >= ($2::timestamptz - ($4::int * INTERVAL '1 day'))
                AND am.is_test_account IS NOT TRUE
            )::int AS filled_active_count,
            BOOL_OR(
              am.last_active_at >= ($2::timestamptz - ($4::int * INTERVAL '1 day'))
            ) AS has_recent_activity
     FROM active_members am
     GROUP BY am.squad_id
     HAVING COUNT(*) >= $5
       AND BOOL_OR(
         am.last_active_at >= ($2::timestamptz - ($4::int * INTERVAL '1 day'))
       )`,
    [
      EXPLICIT_COLLECTION_STATUSES,
      asOf.toISOString(),
      minEntries,
      Math.max(1, Math.floor(recentActivityDays)),
      minMembers
    ]
  );

  // Re-check consent per squad (need ≥ minMembers consented + filled).
  const eligible = [];
  for (const row of result.rows) {
    const members = await db.query(
      `SELECT u.id, u.is_test_account, u.community_stats_opt_in, u.cookie_consent,
              u.last_active_at, u.deleted_at, u.suspended_until,
              COALESCE(e.entry_count, 0)::int AS entry_count
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       LEFT JOIN (
         SELECT user_id, COUNT(*)::int AS entry_count
         FROM sprite_entries
         WHERE status = ANY($2::text[])
         GROUP BY user_id
       ) e ON e.user_id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [row.squad_id, EXPLICIT_COLLECTION_STATUSES]
    );

    let okMembers = 0;
    for (const m of members.rows) {
      if (m.deleted_at) continue;
      if (m.suspended_until && new Date(m.suspended_until) >= asOf) continue;
      if (m.is_test_account === true) continue;
      if (m.community_stats_opt_in === false) continue;
      if (requireAnalyticsConsent) {
        if (m.community_stats_opt_in !== true && !hasAnalyticsConsent(m.cookie_consent)) {
          continue;
        }
      }
      if ((m.entry_count || 0) < minEntries) continue;
      if (!m.last_active_at) continue;
      const ageMs = asOf - new Date(m.last_active_at);
      if (ageMs > recentActivityDays * 86400000) continue;
      okMembers += 1;
    }
    // "Squad non suspendue" = at least minActiveMembers non-suspended active users.
    if (okMembers >= minMembers && row.has_recent_activity) {
      eligible.push(Number(row.squad_id));
    }
  }
  return eligible;
}
