"use strict";

// ── Sprite Graph squad daily stats (Étapes 56–58) ────────────────────────────
// squad_id is INTEGER (live schema); the step doc's UUID is not used.

const { pool } = require("./db");
const {
  COMMUNITY_ELIGIBILITY,
  EXPLICIT_COLLECTION_STATUSES
} = require("./sprite-graph-community");
const { resolveCatalogueContext } = require("./sprite-graph-catalogue");

/** Étape 57 — squad eligibility for community averages. */
const SQUAD_COMMUNITY_ELIGIBILITY = Object.freeze({
  minActiveMembers: Number(process.env.GRAPH_SQUAD_MIN_MEMBERS || 2),
  minCollectionFillRate: Number(
    process.env.GRAPH_SQUAD_MIN_FILL || COMMUNITY_ELIGIBILITY.minCollectionFillRate || 0.6
  ),
  recentActivityDays: Number(
    process.env.GRAPH_SQUAD_ACTIVE_DAYS || COMMUNITY_ELIGIBILITY.recentActivityDays || 90
  ),
  requireAnalyticsConsent: process.env.GRAPH_SQUAD_REQUIRE_CONSENT !== "0"
});

function round2(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

/** node-pg DATE → local Y-M-D (avoid String(date).slice → "Sun Jul 26"). */
function toIsoDate(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function ratePercent(numerator, denominator) {
  const d = Number(denominator) || 0;
  if (d <= 0) return null;
  return round2((Number(numerator) || 0) / d * 100);
}

/**
 * Étape 58 — separate acquisition progress from catalogue-size shock.
 *
 * completionRateAfterCatalogueUpdate = same covered / new catalogue size
 * (not the final rate after acquisitions).
 */
function decomposeCatalogueVsAcquisition({
  previousCovered,
  previousCatalogueCount,
  currentCovered,
  currentCatalogueCount
} = {}) {
  const before = ratePercent(previousCovered, previousCatalogueCount);
  const afterCatalogueOnly = ratePercent(previousCovered, currentCatalogueCount);
  const afterWithAcquisitions = ratePercent(currentCovered, currentCatalogueCount);

  const catalogueExpansionImpact =
    before != null && afterCatalogueOnly != null
      ? round2(afterCatalogueOnly - before)
      : null;
  const acquisitionProgress =
    afterWithAcquisitions != null && afterCatalogueOnly != null
      ? round2(afterWithAcquisitions - afterCatalogueOnly)
      : null;

  return {
    completionRateBeforeCatalogueUpdate: before,
    completionRateAfterCatalogueUpdate: afterCatalogueOnly,
    catalogueExpansionImpact,
    acquisitionProgress,
    completionRateCurrent: afterWithAcquisitions
  };
}

async function ensureSquadDailyStatsTables(db = pool) {
  // Étape 56 — canonical daily squad stats (migrate older stub columns).
  // Create first, then ALTER (table may already exist from community stub),
  // then indexes that depend on new columns.
  await db.query(`
    CREATE TABLE IF NOT EXISTS squad_daily_stats (
      metric_date DATE NOT NULL,
      squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,

      active_member_count INTEGER NOT NULL DEFAULT 0,
      covered_variant_count INTEGER NOT NULL DEFAULT 0,
      catalogue_variant_count INTEGER NOT NULL DEFAULT 0,

      collective_completion_rate DECIMAL NOT NULL DEFAULT 0,
      unique_owner_variant_count INTEGER NOT NULL DEFAULT 0,
      shared_variant_count INTEGER NOT NULL DEFAULT 0,

      catalogue_version VARCHAR(80),
      eligible_for_community BOOLEAN NOT NULL DEFAULT FALSE,

      progress_1d DECIMAL,
      progress_7d DECIMAL,
      progress_30d DECIMAL,

      completion_rate_before_catalogue_update DECIMAL,
      completion_rate_after_catalogue_update DECIMAL,
      catalogue_expansion_impact DECIMAL,
      acquisition_progress DECIMAL,

      joins_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (metric_date, squad_id)
    );
  `);

  await db.query(`
    ALTER TABLE squad_daily_stats
      ADD COLUMN IF NOT EXISTS active_member_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS covered_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS catalogue_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS collective_completion_rate DECIMAL NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS unique_owner_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shared_variant_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80),
      ADD COLUMN IF NOT EXISTS eligible_for_community BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS progress_1d DECIMAL,
      ADD COLUMN IF NOT EXISTS progress_7d DECIMAL,
      ADD COLUMN IF NOT EXISTS progress_30d DECIMAL,
      ADD COLUMN IF NOT EXISTS completion_rate_before_catalogue_update DECIMAL,
      ADD COLUMN IF NOT EXISTS completion_rate_after_catalogue_update DECIMAL,
      ADD COLUMN IF NOT EXISTS catalogue_expansion_impact DECIMAL,
      ADD COLUMN IF NOT EXISTS acquisition_progress DECIMAL,
      ADD COLUMN IF NOT EXISTS joins_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_squad_daily_stats_date
      ON squad_daily_stats (metric_date DESC);
    CREATE INDEX IF NOT EXISTS idx_squad_daily_stats_eligible
      ON squad_daily_stats (metric_date DESC)
      WHERE eligible_for_community = TRUE;
  `);

  // Étape 57 — community-wide average squad progression.
  await db.query(`
    CREATE TABLE IF NOT EXISTS community_squad_progress_daily (
      metric_date DATE NOT NULL,
      window_days INTEGER NOT NULL DEFAULT 7,
      eligible_squad_count INTEGER NOT NULL DEFAULT 0,
      avg_completion_progress DECIMAL,
      catalogue_version VARCHAR(80),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, window_days)
    );
  `);
}

function hasAnalyticsConsent(cookieConsent) {
  if (!cookieConsent || typeof cookieConsent !== "object") return false;
  return cookieConsent.analytics === true;
}

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

async function calculateSquadDailyStats(db = pool, {
  metricDate = null,
  catalogueVersion = null,
  catalogueVariantCount = null,
  eligibleSquadIds = null
} = {}) {
  await ensureSquadDailyStatsTables(db);
  // Mirror table from Étape 55 (avoid requiring trends → circular).
  await db.query(`
    CREATE TABLE IF NOT EXISTS squad_daily_snapshots (
      metric_date DATE NOT NULL,
      squad_id INTEGER NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
      covered_variant_count INTEGER NOT NULL DEFAULT 0,
      collective_completion_rate DECIMAL,
      member_count INTEGER NOT NULL DEFAULT 0,
      unique_variant_count INTEGER NOT NULL DEFAULT 0,
      progress_1d DECIMAL,
      progress_7d DECIMAL,
      progress_30d DECIMAL,
      catalogue_version VARCHAR(80),
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, squad_id)
    );
    ALTER TABLE squad_daily_snapshots
      ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80);
  `);

  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const cat = catalogueVersion && catalogueVariantCount != null
    ? { catalogueVersion, catalogueVariantCount }
    : await resolveCatalogueContext(db);
  const version = cat.catalogueVersion;
  const catalogueCount = cat.catalogueVariantCount;

  const eligibleSet = new Set(
    (eligibleSquadIds != null
      ? eligibleSquadIds
      : await listEligibleSquadIds(db, { asOf: new Date(`${day}T23:59:59.999Z`) })
    ).map(Number)
  );

  const squads = await db.query(
    `SELECT s.id AS squad_id,
            COALESCE(m.member_count, 0)::int AS member_count
     FROM squads s
     LEFT JOIN (
       SELECT squad_id, COUNT(*)::int AS member_count
       FROM squad_members
       WHERE status = 'active'
       GROUP BY squad_id
     ) m ON m.squad_id = s.id
     WHERE COALESCE(m.member_count, 0) > 0`
  );

  const compare = require("./compare");
  let upserted = 0;

  for (const squad of squads.rows) {
    const memberIdsRes = await db.query(
      `SELECT sm.user_id, u.collection_visibility
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [squad.squad_id]
    );
    const memberIds = memberIdsRes.rows.map((r) => r.user_id);
    const activeMemberCount = memberIds.length;
    if (!activeMemberCount) continue;

    let covered = 0;
    let rate = 0;
    let uniqueOwnerVariantCount = 0;
    let sharedVariantCount = 0;
    let totalVariants = catalogueCount;

    try {
      // Étape 94 — private collections do not contribute to community squad coverage.
      const members = memberIdsRes.rows.map((r) => {
        const vis = String(r.collection_visibility || "").toLowerCase();
        return {
          userId: r.user_id,
          username: String(r.user_id),
          visible: vis !== "private"
        };
      });
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const completion = compare.getSquadCollectiveCompletion(matrix, "");
      covered = completion.coveredVariantCount || 0;
      totalVariants = completion.totalVariantCount || catalogueCount;
      rate = completion.collectiveCompletionRate != null
        ? Number(completion.collectiveCompletionRate)
        : (ratePercent(covered, totalVariants) || 0);
      uniqueOwnerVariantCount = (compare.getSquadUniqueOwners(matrix).totalUnique) || 0;
      sharedVariantCount = (compare.getSquadSharedVariants(matrix).totalShared) || 0;
    } catch (_) {
      rate = ratePercent(covered, totalVariants) || 0;
    }

    const prior = await db.query(
      `SELECT metric_date, covered_variant_count, catalogue_variant_count,
              collective_completion_rate, catalogue_version
       FROM squad_daily_stats
       WHERE squad_id = $1 AND metric_date < $2::date
       ORDER BY metric_date DESC
       LIMIT 40`,
      [squad.squad_id, day]
    );
    const byDate = new Map(
      prior.rows.map((r) => [toIsoDate(r.metric_date), r])
    );
    const rowOnOrBefore = (target) => {
      if (byDate.has(target)) return byDate.get(target);
      for (const [d, row] of byDate.entries()) {
        if (d <= target) return row;
      }
      return null;
    };

    const d1 = new Date(`${day}T00:00:00.000Z`);
    d1.setUTCDate(d1.getUTCDate() - 1);
    const d7 = new Date(`${day}T00:00:00.000Z`);
    d7.setUTCDate(d7.getUTCDate() - 7);
    const d30 = new Date(`${day}T00:00:00.000Z`);
    d30.setUTCDate(d30.getUTCDate() - 30);

    const prev1 = rowOnOrBefore(d1.toISOString().slice(0, 10));
    const prev7 = rowOnOrBefore(d7.toISOString().slice(0, 10));
    const prev30 = rowOnOrBefore(d30.toISOString().slice(0, 10));
    const prevDay = prior.rows[0] || null;

    // Étape 58 — vs previous snapshot (catalogue bias vs acquisition).
    const decomp = prevDay
      ? decomposeCatalogueVsAcquisition({
        previousCovered: prevDay.covered_variant_count,
        previousCatalogueCount: prevDay.catalogue_variant_count,
        currentCovered: covered,
        currentCatalogueCount: totalVariants
      })
      : {
        completionRateBeforeCatalogueUpdate: null,
        completionRateAfterCatalogueUpdate: null,
        catalogueExpansionImpact: null,
        acquisitionProgress: null
      };

    const rateOf = (row) => (
      row && row.collective_completion_rate != null
        ? Number(row.collective_completion_rate)
        : null
    );
    // Prefer acquisition-aware progress (ignore pure catalogue shock).
    const progressFrom = (prevRow) => {
      if (!prevRow) return null;
      if (decomp.acquisitionProgress != null && prevRow === prevDay) {
        // Day-over-day: use acquisition progress when catalogue changed.
        if (
          Number(prevRow.catalogue_variant_count) !== Number(totalVariants)
          && decomp.acquisitionProgress != null
        ) {
          return decomp.acquisitionProgress;
        }
      }
      const prevRate = rateOf(prevRow);
      if (prevRate == null || rate == null) return null;
      // Same catalogue → raw delta; different → acquisition-only delta.
      if (Number(prevRow.catalogue_variant_count) !== Number(totalVariants)) {
        const windowDecomp = decomposeCatalogueVsAcquisition({
          previousCovered: prevRow.covered_variant_count,
          previousCatalogueCount: prevRow.catalogue_variant_count,
          currentCovered: covered,
          currentCatalogueCount: totalVariants
        });
        return windowDecomp.acquisitionProgress;
      }
      return round2(rate - prevRate);
    };

    const progress1d = progressFrom(prev1);
    const progress7d = progressFrom(prev7);
    const progress30d = progressFrom(prev30);
    const eligible = eligibleSet.has(Number(squad.squad_id));

    const formulaVersion = require("./sprite-graph-formula").squadFormulaVersion();
    try {
      await require("./sprite-graph-formula").ensureFormulaVersionColumns(db);
    } catch (_) { /* ignore */ }
    await db.query(
      `INSERT INTO squad_daily_stats (
         metric_date, squad_id,
         active_member_count, covered_variant_count, catalogue_variant_count,
         collective_completion_rate, unique_owner_variant_count, shared_variant_count,
         catalogue_version, formula_version, eligible_for_community,
         progress_1d, progress_7d, progress_30d,
         completion_rate_before_catalogue_update,
         completion_rate_after_catalogue_update,
         catalogue_expansion_impact, acquisition_progress,
         calculated_at
       ) VALUES (
         $1::date, $2,
         $3, $4, $5,
         $6, $7, $8,
         $9, $10, $11,
         $12, $13, $14,
         $15, $16, $17, $18,
         NOW()
       )
       ON CONFLICT (metric_date, squad_id) DO UPDATE SET
         active_member_count = EXCLUDED.active_member_count,
         covered_variant_count = EXCLUDED.covered_variant_count,
         catalogue_variant_count = EXCLUDED.catalogue_variant_count,
         collective_completion_rate = EXCLUDED.collective_completion_rate,
         unique_owner_variant_count = EXCLUDED.unique_owner_variant_count,
         shared_variant_count = EXCLUDED.shared_variant_count,
         catalogue_version = EXCLUDED.catalogue_version,
         formula_version = EXCLUDED.formula_version,
         eligible_for_community = EXCLUDED.eligible_for_community,
         progress_1d = EXCLUDED.progress_1d,
         progress_7d = EXCLUDED.progress_7d,
         progress_30d = EXCLUDED.progress_30d,
         completion_rate_before_catalogue_update = EXCLUDED.completion_rate_before_catalogue_update,
         completion_rate_after_catalogue_update = EXCLUDED.completion_rate_after_catalogue_update,
         catalogue_expansion_impact = EXCLUDED.catalogue_expansion_impact,
         acquisition_progress = EXCLUDED.acquisition_progress,
         calculated_at = NOW()`,
      [
        day,
        squad.squad_id,
        activeMemberCount,
        covered,
        totalVariants,
        rate,
        uniqueOwnerVariantCount,
        sharedVariantCount,
        version,
        formulaVersion,
        eligible,
        progress1d,
        progress7d,
        progress30d,
        decomp.completionRateBeforeCatalogueUpdate,
        decomp.completionRateAfterCatalogueUpdate,
        decomp.catalogueExpansionImpact,
        decomp.acquisitionProgress
      ]
    );

    // Mirror to étape 55 snapshots for existing readers.
    await db.query(
      `INSERT INTO squad_daily_snapshots (
         metric_date, squad_id,
         covered_variant_count, collective_completion_rate,
         member_count, unique_variant_count,
         progress_1d, progress_7d, progress_30d,
         catalogue_version, calculated_at
       ) VALUES (
         $1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
       )
       ON CONFLICT (metric_date, squad_id) DO UPDATE SET
         covered_variant_count = EXCLUDED.covered_variant_count,
         collective_completion_rate = EXCLUDED.collective_completion_rate,
         member_count = EXCLUDED.member_count,
         unique_variant_count = EXCLUDED.unique_variant_count,
         progress_1d = EXCLUDED.progress_1d,
         progress_7d = EXCLUDED.progress_7d,
         progress_30d = EXCLUDED.progress_30d,
         catalogue_version = EXCLUDED.catalogue_version,
         calculated_at = NOW()`,
      [
        day,
        squad.squad_id,
        covered,
        rate,
        activeMemberCount,
        uniqueOwnerVariantCount,
        progress1d,
        progress7d,
        progress30d,
        version
      ]
    );
    upserted += 1;
  }

  return {
    metricDate: day,
    squads: upserted,
    catalogueVersion: version,
    catalogueVariantCount: catalogueCount,
    eligibleSquads: eligibleSet.size
  };
}

/**
 * Étape 57 — mean completion progress of eligible squads over a window.
 */
async function calculateCommunitySquadProgress(db = pool, {
  metricDate = null,
  windowDays = 7,
  catalogueVersion = null
} = {}) {
  await ensureSquadDailyStatsTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const days = Math.max(1, Math.floor(Number(windowDays) || 7));
  const version = catalogueVersion
    || (await resolveCatalogueContext(db)).catalogueVersion;

  const col = days === 1
    ? "progress_1d"
    : days <= 7
      ? "progress_7d"
      : "progress_30d";

  const result = await db.query(
    `SELECT COUNT(*)::int AS n,
            AVG(${col}) AS avg_progress
     FROM squad_daily_stats
     WHERE metric_date = $1::date
       AND eligible_for_community = TRUE
       AND ${col} IS NOT NULL`,
    [day]
  );
  const eligibleSquadCount = result.rows[0]?.n || 0;
  const avg = result.rows[0]?.avg_progress != null
    ? round2(result.rows[0].avg_progress)
    : null;

  await db.query(
    `INSERT INTO community_squad_progress_daily (
       metric_date, window_days, eligible_squad_count,
       avg_completion_progress, catalogue_version, formula_version, metadata, calculated_at
     ) VALUES ($1::date, $2, $3, $4, $5, $6, $7::jsonb, NOW())
     ON CONFLICT (metric_date, window_days) DO UPDATE SET
       eligible_squad_count = EXCLUDED.eligible_squad_count,
       avg_completion_progress = EXCLUDED.avg_completion_progress,
       catalogue_version = EXCLUDED.catalogue_version,
       formula_version = EXCLUDED.formula_version,
       metadata = EXCLUDED.metadata,
       calculated_at = NOW()`,
    [
      day,
      days,
      eligibleSquadCount,
      avg,
      version,
      require("./sprite-graph-formula").squadFormulaVersion(),
      JSON.stringify({
        formula: "sum(completion_progress) / eligible_squad_count",
        formulaVersion: require("./sprite-graph-formula").squadFormulaVersion(),
        progressColumn: col,
        note: "Progress excludes pure catalogue-expansion impact when detectable"
      })
    ]
  );

  return {
    metricDate: day,
    windowDays: days,
    eligibleSquadCount,
    avgCompletionProgress: avg,
    catalogueVersion: version
  };
}

async function getCommunitySquadProgress(db = pool, {
  metricDate = null,
  windowDays = 7
} = {}) {
  await ensureSquadDailyStatsTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const result = await db.query(
    `SELECT * FROM community_squad_progress_daily
     WHERE metric_date = $1::date AND window_days = $2`,
    [day, Math.max(1, Math.floor(Number(windowDays) || 7))]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    metricDate: row.metric_date,
    windowDays: row.window_days,
    eligibleSquadCount: row.eligible_squad_count,
    avgCompletionProgress: row.avg_completion_progress != null
      ? Number(row.avg_completion_progress)
      : null,
    catalogueVersion: row.catalogue_version
  };
}

/** Étape 84 — anonymous peer buckets (no ranking). */
function resolveSquadSizeBand(memberCount) {
  const n = Math.max(0, Math.floor(Number(memberCount) || 0));
  if (n <= 2) return { id: "2", label: "Squads de 2 membres" };
  if (n <= 3) return { id: "3", label: "Squads de 3 membres" };
  if (n <= 6) return { id: "4_6", label: "Squads de 4 à 6 membres" };
  if (n <= 10) return { id: "7_10", label: "Squads de 7 à 10 membres" };
  return { id: "11_plus", label: "Squads de 11 membres ou plus" };
}

function resolveCompletionBand(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return { id: "unknown", label: "Complétion indéterminée" };
  const r = Number(rate);
  if (r < 25) return { id: "0_25", label: "Complétion 0–25 %" };
  if (r < 50) return { id: "25_50", label: "Complétion 25–50 %" };
  if (r < 75) return { id: "50_75", label: "Complétion 50–75 %" };
  return { id: "75_100", label: "Complétion 75–100 %" };
}

/**
 * Étape 83–84 — squad community context vs anonymous peer group.
 * No competitive ranking — only gentle peer averages.
 */
async function getSquadCommunityContext(db = pool, squadId, {
  metricDate = null
} = {}) {
  await ensureSquadDailyStatsTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const id = Number(squadId);
  if (!Number.isFinite(id)) return null;

  const self = await db.query(
    `SELECT s.id, s.name, s.created_at,
            d.active_member_count, d.covered_variant_count, d.catalogue_variant_count,
            d.collective_completion_rate, d.progress_7d, d.eligible_for_community,
            d.catalogue_version
     FROM squads s
     LEFT JOIN squad_daily_stats d
       ON d.squad_id = s.id AND d.metric_date = $2::date
     WHERE s.id = $1`,
    [id, day]
  );
  if (!self.rows.length) return null;
  const row = self.rows[0];

  let memberCount = Number(row.active_member_count) || 0;
  if (!memberCount) {
    const m = await db.query(
      `SELECT COUNT(*)::int AS n FROM squad_members
       WHERE squad_id = $1 AND status = 'active'`,
      [id]
    );
    memberCount = m.rows[0]?.n || 0;
  }

  const completion = row.collective_completion_rate != null
    ? Number(row.collective_completion_rate)
    : null;
  const sizeBand = resolveSquadSizeBand(memberCount);
  const completionBand = resolveCompletionBand(completion);

  // Peer average progress among eligible squads in the same size band.
  const peers = await db.query(
    `SELECT COUNT(*)::int AS n,
            AVG(progress_7d) AS avg_progress_7d,
            AVG(collective_completion_rate) AS avg_completion
     FROM squad_daily_stats
     WHERE metric_date = $1::date
       AND eligible_for_community = TRUE
       AND squad_id <> $2
       AND active_member_count BETWEEN $3 AND $4
       AND progress_7d IS NOT NULL`,
    [
      day,
      id,
      sizeBand.id === "2" ? 2 : sizeBand.id === "3" ? 3 : sizeBand.id === "4_6" ? 4 : sizeBand.id === "7_10" ? 7 : 11,
      sizeBand.id === "2" ? 2 : sizeBand.id === "3" ? 3 : sizeBand.id === "4_6" ? 6 : sizeBand.id === "7_10" ? 10 : 1000
    ]
  );

  const peerCount = peers.rows[0]?.n || 0;
  const avgProgress = peers.rows[0]?.avg_progress_7d != null
    ? round2(peers.rows[0].avg_progress_7d)
    : null;

  const coverageLabel = completion != null
    ? `${row.name || "La squad"} couvre ${round2(completion)} % du catalogue.`
    : null;
  const peerLabel = (peerCount >= 3 && avgProgress != null)
    ? `Les squads comparables (${sizeBand.label.toLowerCase()}) progressent en moyenne de ${avgProgress} point${Math.abs(avgProgress) === 1 ? "" : "s"} par semaine.`
    : peerCount > 0
      ? `Groupe de comparaison : ${sizeBand.label} (données encore limitées).`
      : null;

  return {
    squadId: id,
    squadName: row.name,
    asOf: day,
    catalogueVersion: row.catalogue_version || null,
    coverage: {
      collectiveCompletionRate: completion,
      coveredVariantCount: row.covered_variant_count || 0,
      catalogueVariantCount: row.catalogue_variant_count || 0,
      label: coverageLabel
    },
    peerGroup: {
      sizeBand,
      completionBand,
      comparableSquadCount: peerCount,
      avgWeeklyProgressPoints: avgProgress,
      label: peerLabel,
      // Étape 84 — never expose peer identities or rankings.
      ranking: null,
      competitive: false
    },
    progress7d: row.progress_7d != null ? Number(row.progress_7d) : null,
    publicDisplay: {
      lines: [coverageLabel, peerLabel].filter(Boolean),
      tone: "encouraging",
      disclaimer: "Données issues de la communauté sprite-index — pas de classement."
    }
  };
}

module.exports = {
  SQUAD_COMMUNITY_ELIGIBILITY,
  ensureSquadDailyStatsTables,
  listEligibleSquadIds,
  decomposeCatalogueVsAcquisition,
  calculateSquadDailyStats,
  calculateCommunitySquadProgress,
  getCommunitySquadProgress,
  resolveSquadSizeBand,
  resolveCompletionBand,
  getSquadCommunityContext,
  ratePercent
};
