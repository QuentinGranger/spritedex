"use strict";

// ── Sprite Graph community aggregates (Étapes 36–45) ─────────────────────────
// Prefer specialized tables over a single sparse daily metrics table.
// IDs follow the live schema: variant/sprite VARCHAR, squad INTEGER.

const { pool } = require("./db");
const {
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  applyPublicAnonymizationGate,
  GRAPH_DATA_LEVELS
} = require("./sprite-graph-privacy");

/** Étape 39 — eligibility knobs (overridable via env). */
const COMMUNITY_ELIGIBILITY = Object.freeze({
  minCollectionFillRate: Number(process.env.GRAPH_COMMUNITY_MIN_FILL || 0.6),
  recentActivityDays: Number(process.env.GRAPH_COMMUNITY_ACTIVE_DAYS || 90),
  requireAnalyticsConsent: process.env.GRAPH_COMMUNITY_REQUIRE_CONSENT !== "0"
});

/** Statuses that count toward "collection filled enough" (eligibility). */
const EXPLICIT_COLLECTION_STATUSES = Object.freeze([
  "owned",
  "missing",
  "priority",
  "spotted",
  "unknown",
  "unsure",
  "unavailable"
]);

/**
 * Étape 41 — statuses used for ownership sample / rates.
 * `unknown` is tracked but excluded from ownership denominators.
 */
const OWNERSHIP_SAMPLE_STATUSES = Object.freeze(["owned", "missing", "priority", "spotted"]);

/** Not owned but intentionally filled (priority-rate denominator). */
const NOT_OWNED_SAMPLE_STATUSES = Object.freeze(["missing", "priority", "spotted"]);

const PRIORITY_WINDOWS_DAYS = Object.freeze([7, 30, 90]);

let dailyJobStarted = false;
let dailyJobInterval = null;

async function ensureCommunityStatsTables(db = pool) {
  // Étape 36 — generic daily metrics with non-null dimension sentinels.
  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_daily_metrics (
      metric_date DATE NOT NULL,
      metric_type VARCHAR(100) NOT NULL,
      sprite_id VARCHAR(50) NOT NULL DEFAULT '',
      variant_id VARCHAR(100) NOT NULL DEFAULT '',
      squad_id INTEGER NOT NULL DEFAULT 0,
      value_numeric DECIMAL,
      sample_size INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, metric_type, sprite_id, variant_id, squad_id)
    );
    CREATE INDEX IF NOT EXISTS idx_graph_daily_metrics_type_date
      ON graph_daily_metrics (metric_type, metric_date DESC);
  `);

  // Étape 37–38 / 41–45 — specialized community_variant_stats.
  await db.query(`
    CREATE TABLE IF NOT EXISTS community_variant_stats (
      metric_date DATE NOT NULL,
      variant_id VARCHAR(100) NOT NULL REFERENCES sprite_variants(id) ON DELETE CASCADE,

      eligible_user_count INTEGER NOT NULL,
      owner_user_count INTEGER NOT NULL,
      missing_user_count INTEGER NOT NULL,
      priority_user_count INTEGER NOT NULL,

      ownership_rate DECIMAL,
      missing_rate DECIMAL,
      priority_rate DECIMAL,

      added_count INTEGER NOT NULL DEFAULT 0,
      priority_added_count INTEGER NOT NULL DEFAULT 0,

      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (metric_date, variant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_community_variant_stats_date
      ON community_variant_stats (metric_date DESC);
  `);

  await db.query(`
    ALTER TABLE community_variant_stats
      ADD COLUMN IF NOT EXISTS spotted_user_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS unknown_user_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS not_owned_user_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS sample_size INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS priority_added_7d INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS priority_added_30d INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS priority_added_90d INTEGER NOT NULL DEFAULT 0;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS community_sprite_stats (
      metric_date DATE NOT NULL,
      sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
      eligible_user_count INTEGER NOT NULL DEFAULT 0,
      owner_user_count INTEGER NOT NULL DEFAULT 0,
      ownership_rate DECIMAL,
      sample_size INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, sprite_id)
    );

    CREATE TABLE IF NOT EXISTS comparison_daily_stats (
      metric_date DATE NOT NULL PRIMARY KEY,
      comparisons_counted INTEGER NOT NULL DEFAULT 0,
      unique_pair_count INTEGER NOT NULL DEFAULT 0,
      unique_actor_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Étape 56 — full schema owned by sprite-graph-squad-stats (stub kept for boot order).
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
      joins_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, squad_id)
    );

    CREATE TABLE IF NOT EXISTS notification_daily_stats (
      metric_date DATE NOT NULL,
      notification_type VARCHAR(80) NOT NULL,
      opened_count INTEGER NOT NULL DEFAULT 0,
      unique_actor_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, notification_type)
    );
  `);

  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS community_stats_opt_in BOOLEAN;
  `);
}

function roundRate(numerator, denominator, { digits = 2 } = {}) {
  const d = Number(denominator) || 0;
  if (d <= 0) return null;
  const n = Number(numerator) || 0;
  const factor = 10 ** digits;
  return Math.round((n / d) * 100 * factor) / factor;
}

function formatRateLabel(rate, { digits = 1 } = {}) {
  if (rate == null || !Number.isFinite(Number(rate))) return null;
  const n = Number(rate);
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return String(rounded).replace(".", ",");
}

/**
 * Étape 40 — ownership display.
 */
function formatCommunityOwnershipDisplay(ownershipRate, { digits = 1 } = {}) {
  const label = formatRateLabel(ownershipRate, { digits });
  if (!label) return INSUFFICIENT_COMMUNITY_DATA_MESSAGE;
  return `${label} % des collectionneurs renseignés possèdent cette variante.`;
}

/**
 * Étape 44 — priority-among-missing display.
 */
function formatCommunityPriorityDisplay(priorityRate, { digits = 0 } = {}) {
  const label = formatRateLabel(priorityRate, { digits });
  if (!label) return INSUFFICIENT_COMMUNITY_DATA_MESSAGE;
  return `${label} % des collectionneurs auxquels elle manque l'ont placée en priorité.`;
}

/**
 * Étape 42 — sample size copy.
 * Example: "échantillon de 320 collections renseignées"
 */
function formatSampleSizeDisplay(sampleSize) {
  const n = Math.max(0, Math.floor(Number(sampleSize) || 0));
  return `échantillon de ${n} collection${n === 1 ? "" : "s"} renseignée${n === 1 ? "" : "s"}`;
}

/**
 * Étape 45 — recent priority-add copy.
 * Example: "+84 ajouts en priorité sur 7 jours"
 */
function formatRecentPriorityAddsDisplay(count, days) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const d = Math.max(1, Math.floor(Number(days) || 7));
  return `+${n} ajout${n === 1 ? "" : "s"} en priorité sur ${d} jours`;
}

function isTestAccountRow(user) {
  return user.is_test_account === true;
}

function hasAnalyticsConsent(cookieConsent) {
  if (!cookieConsent || typeof cookieConsent !== "object") return false;
  return cookieConsent.analytics === true;
}

/**
 * Étape 39 — eligible community-stat users.
 */
async function listEligibleCommunityUserIds(
  db = pool,
  {
    minFillRate = COMMUNITY_ELIGIBILITY.minCollectionFillRate,
    recentActivityDays = COMMUNITY_ELIGIBILITY.recentActivityDays,
    requireAnalyticsConsent = COMMUNITY_ELIGIBILITY.requireAnalyticsConsent,
    asOf = new Date()
  } = {}
) {
  const catalogue = await db.query(`SELECT COUNT(*)::int AS n FROM sprite_variants`);
  const catalogueCount = catalogue.rows[0]?.n || 0;
  if (catalogueCount <= 0) return [];

  const fillRaw = Number(minFillRate);
  const fillRate = Number.isFinite(fillRaw) ? Math.min(1, Math.max(0, fillRaw)) : 0.6;
  const minEntries = Math.ceil(catalogueCount * fillRate);
  const users = await db.query(
    `SELECT u.id, u.username, u.username_normalized, u.email,
            u.is_test_account, u.community_stats_opt_in, u.cookie_consent,
            u.last_active_at, u.deleted_at, u.suspended_until,
            COALESCE(e.entry_count, 0)::int AS entry_count
     FROM users u
     LEFT JOIN (
       SELECT user_id, COUNT(*)::int AS entry_count
       FROM sprite_entries
       WHERE status = ANY($1::text[])
       GROUP BY user_id
     ) e ON e.user_id = u.id
     WHERE u.deleted_at IS NULL
       AND (u.suspended_until IS NULL OR u.suspended_until < $2::timestamptz)
       AND u.last_active_at >= ($2::timestamptz - ($3::int * INTERVAL '1 day'))
       AND COALESCE(e.entry_count, 0) >= $4`,
    [EXPLICIT_COLLECTION_STATUSES, asOf.toISOString(), Math.max(1, Math.floor(recentActivityDays)), minEntries]
  );

  const eligible = [];
  for (const row of users.rows) {
    if (isTestAccountRow(row)) continue;
    if (row.community_stats_opt_in === false) continue;
    if (requireAnalyticsConsent) {
      if (row.community_stats_opt_in !== true && !hasAnalyticsConsent(row.cookie_consent)) {
        continue;
      }
    }
    eligible.push(Number(row.id));
  }
  return eligible;
}

async function countGraphAddsForDate(db, metricDate, eventType) {
  const result = await db.query(
    `SELECT variant_id, COUNT(*)::int AS n
     FROM graph_events
     WHERE event_type = $1
       AND occurred_at::date = $2::date
       AND variant_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )
     GROUP BY variant_id`,
    [eventType, metricDate]
  );
  const map = new Map();
  for (const row of result.rows) map.set(String(row.variant_id), row.n);
  return map;
}

/** Étape 45 — priority_added events in rolling windows (eligible actors only). */
async function countPriorityAddsByWindow(
  db,
  eligibleIds,
  variantIds,
  { asOf = new Date(), windows = PRIORITY_WINDOWS_DAYS } = {}
) {
  if (!eligibleIds.length || !variantIds.length) {
    return { 7: new Map(), 30: new Map(), 90: new Map() };
  }
  const maxDays = Math.max(...windows.map((d) => Number(d) || 0));
  const result = await db.query(
    `SELECT variant_id,
            COUNT(*) FILTER (
              WHERE occurred_at >= $3::timestamptz - INTERVAL '7 days'
            )::int AS d7,
            COUNT(*) FILTER (
              WHERE occurred_at >= $3::timestamptz - INTERVAL '30 days'
            )::int AS d30,
            COUNT(*) FILTER (
              WHERE occurred_at >= $3::timestamptz - INTERVAL '90 days'
            )::int AS d90
     FROM graph_events
     WHERE event_type = 'collection.priority_added'
       AND actor_user_id = ANY($1::int[])
       AND variant_id = ANY($2::text[])
       AND occurred_at >= $3::timestamptz - ($4::int * INTERVAL '1 day')
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )
     GROUP BY variant_id`,
    [eligibleIds, variantIds, asOf.toISOString(), maxDays]
  );
  const maps = { 7: new Map(), 30: new Map(), 90: new Map() };
  for (const row of result.rows) {
    const id = String(row.variant_id);
    maps[7].set(id, row.d7 || 0);
    maps[30].set(id, row.d30 || 0);
    maps[90].set(id, row.d90 || 0);
  }
  return maps;
}

/**
 * Étape 38–45 — recompute community_variant_stats for a calendar day.
 */
async function calculateCommunityVariantStats(
  db = pool,
  { metricDate = null, variantIds = null, eligibility = null, eligibleUserIds = null, catalogueVersion = null } = {}
) {
  await ensureCommunityStatsTables(db);
  try {
    await db.query(
      `ALTER TABLE community_variant_stats
         ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`
    );
  } catch (_) {
    /* ignore */
  }

  const day = metricDate ? String(metricDate).slice(0, 10) : new Date().toISOString().slice(0, 10);

  const eligibleIds = Array.isArray(eligibleUserIds)
    ? eligibleUserIds.map(Number).filter(Number.isFinite)
    : await listEligibleCommunityUserIds(db, eligibility || {});
  if (!eligibleIds.length) {
    return { metricDate: day, variants: 0, eligibleUsers: 0, catalogueVersion: catalogueVersion || null };
  }

  let catVersion = catalogueVersion;
  if (!catVersion) {
    try {
      catVersion = (await require("./sprite-graph-catalogue").resolveCatalogueContext(db)).catalogueVersion;
    } catch (_) {
      catVersion = null;
    }
  }

  const variantsRes =
    variantIds && variantIds.length
      ? await db.query(`SELECT id FROM sprite_variants WHERE id = ANY($1::text[])`, [variantIds.map(String)])
      : await db.query(`SELECT id FROM sprite_variants`);
  const variants = variantsRes.rows.map((r) => String(r.id));
  if (!variants.length) return { metricDate: day, variants: 0, eligibleUsers: eligibleIds.length };

  const addedMap = await countGraphAddsForDate(db, day, "collection.sprite_added");
  const priorityAddedMap = await countGraphAddsForDate(db, day, "collection.priority_added");
  const windowMaps = await countPriorityAddsByWindow(db, eligibleIds, variants, {
    asOf: new Date(`${day}T23:59:59.999Z`)
  });

  // Counts among eligible users — unknown tracked separately from sample.
  const counts = await db.query(
    `SELECT se.variant_id,
            COUNT(*) FILTER (WHERE se.status = ANY($3::text[]))::int AS sample_size,
            COUNT(*) FILTER (WHERE se.status = 'owned')::int AS owned,
            COUNT(*) FILTER (WHERE se.status = 'missing')::int AS missing,
            COUNT(*) FILTER (WHERE se.status = 'priority')::int AS priority,
            COUNT(*) FILTER (WHERE se.status = 'spotted')::int AS spotted,
            COUNT(*) FILTER (WHERE se.status = 'unknown')::int AS unknown,
            COUNT(*) FILTER (WHERE se.status = ANY($4::text[]))::int AS not_owned
     FROM sprite_entries se
     WHERE se.user_id = ANY($1::int[])
       AND se.variant_id = ANY($2::text[])
       AND se.status = ANY($5::text[])
     GROUP BY se.variant_id`,
    [
      eligibleIds,
      variants,
      OWNERSHIP_SAMPLE_STATUSES,
      NOT_OWNED_SAMPLE_STATUSES,
      [...new Set([...OWNERSHIP_SAMPLE_STATUSES, "unknown"])]
    ]
  );
  const byVariant = new Map(counts.rows.map((r) => [String(r.variant_id), r]));

  const { ensureFormulaVersionColumns, communityFormulaVersion } = require("./sprite-graph-formula");
  await ensureFormulaVersionColumns(db);
  const formulaVersion = communityFormulaVersion();

  let upserted = 0;
  for (const variantId of variants) {
    const row = byVariant.get(variantId);
    const sampleSize = row ? row.sample_size : 0;
    const ownerUserCount = row ? row.owned : 0;
    const missingUserCount = row ? row.missing : 0;
    const priorityUserCount = row ? row.priority : 0;
    const spottedUserCount = row ? row.spotted : 0;
    const unknownUserCount = row ? row.unknown : 0;
    const notOwnedUserCount = row ? row.not_owned : 0;

    // Étape 41 — ownership denominator excludes unknown.
    const ownershipRate = roundRate(ownerUserCount, sampleSize);
    const missingRate = roundRate(missingUserCount, sampleSize);
    // Étape 44 — priority among those who filled without owning.
    const priorityRate = roundRate(priorityUserCount, notOwnedUserCount);

    await db.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id,
         eligible_user_count, owner_user_count, missing_user_count, priority_user_count,
         spotted_user_count, unknown_user_count, not_owned_user_count, sample_size,
         ownership_rate, missing_rate, priority_rate,
         added_count, priority_added_count,
         priority_added_7d, priority_added_30d, priority_added_90d,
         catalogue_version, formula_version, calculated_at
       ) VALUES (
         $1::date, $2,
         $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13,
         $14, $15,
         $16, $17, $18,
         $19, $20, NOW()
       )
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         eligible_user_count = EXCLUDED.eligible_user_count,
         owner_user_count = EXCLUDED.owner_user_count,
         missing_user_count = EXCLUDED.missing_user_count,
         priority_user_count = EXCLUDED.priority_user_count,
         spotted_user_count = EXCLUDED.spotted_user_count,
         unknown_user_count = EXCLUDED.unknown_user_count,
         not_owned_user_count = EXCLUDED.not_owned_user_count,
         sample_size = EXCLUDED.sample_size,
         ownership_rate = EXCLUDED.ownership_rate,
         missing_rate = EXCLUDED.missing_rate,
         priority_rate = EXCLUDED.priority_rate,
         added_count = EXCLUDED.added_count,
         priority_added_count = EXCLUDED.priority_added_count,
         priority_added_7d = EXCLUDED.priority_added_7d,
         priority_added_30d = EXCLUDED.priority_added_30d,
         priority_added_90d = EXCLUDED.priority_added_90d,
         catalogue_version = EXCLUDED.catalogue_version,
         formula_version = EXCLUDED.formula_version,
         calculated_at = NOW()`,
      [
        day,
        variantId,
        sampleSize, // eligible_user_count = renseignés (sample) for this variant
        ownerUserCount,
        missingUserCount,
        priorityUserCount,
        spottedUserCount,
        unknownUserCount,
        notOwnedUserCount,
        sampleSize,
        ownershipRate,
        missingRate,
        priorityRate,
        addedMap.get(variantId) || 0,
        priorityAddedMap.get(variantId) || 0,
        windowMaps[7].get(variantId) || 0,
        windowMaps[30].get(variantId) || 0,
        windowMaps[90].get(variantId) || 0,
        catVersion,
        formulaVersion
      ]
    );
    upserted += 1;
  }

  return {
    metricDate: day,
    variants: upserted,
    eligibleUsers: eligibleIds.length,
    catalogueVersion: catVersion
  };
}

function rowToCommunityVariantPayload(row, { level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC } = {}) {
  const sampleSize = Number(row.sample_size != null ? row.sample_size : row.eligible_user_count) || 0;
  return {
    metricDate: row.metric_date,
    catalogueVersion: row.catalogue_version || null,
    variantId: row.variant_id,
    ownershipRate: row.ownership_rate != null ? Number(row.ownership_rate) : null,
    missingRate: row.missing_rate != null ? Number(row.missing_rate) : null,
    priorityRate: row.priority_rate != null ? Number(row.priority_rate) : null,
    eligibleUserCount: row.eligible_user_count,
    ownerUserCount: row.owner_user_count,
    missingUserCount: row.missing_user_count,
    priorityUserCount: row.priority_user_count,
    spottedUserCount: row.spotted_user_count || 0,
    unknownUserCount: row.unknown_user_count || 0,
    notOwnedUserCount: row.not_owned_user_count || 0,
    sampleSize,
    sampleSizeDisplay: formatSampleSizeDisplay(sampleSize),
    priorityAdded7d: row.priority_added_7d || 0,
    priorityAdded30d: row.priority_added_30d || 0,
    priorityAdded90d: row.priority_added_90d || 0,
    recentPriorityAddsDisplay: {
      7: formatRecentPriorityAddsDisplay(row.priority_added_7d, 7),
      30: formatRecentPriorityAddsDisplay(row.priority_added_30d, 30),
      90: formatRecentPriorityAddsDisplay(row.priority_added_90d, 90)
    },
    display: formatCommunityOwnershipDisplay(row.ownership_rate),
    priorityDisplay: formatCommunityPriorityDisplay(row.priority_rate),
    level
  };
}

/**
 * Read community ownership / priority stats for a variant (public-gated).
 */
async function getCommunityVariantOwnership(
  db = pool,
  variantId,
  { metricDate = null, level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC } = {}
) {
  await ensureCommunityStatsTables(db);
  const day = metricDate ? String(metricDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const result = await db.query(
    `SELECT * FROM community_variant_stats
     WHERE metric_date = $1::date AND variant_id = $2`,
    [day, String(variantId)]
  );
  const row = result.rows[0];
  if (!row) return null;

  const payload = rowToCommunityVariantPayload(row, { level });

  if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
    const gated = applyPublicAnonymizationGate({
      uniqueUserCount: payload.sampleSize,
      payload
    });
    if (!gated.ok) {
      return {
        metricDate: day,
        variantId: String(variantId),
        level,
        insufficient: true,
        message: gated.message || INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
        minUsers: PUBLIC_ANONYMIZATION_MIN_USERS,
        sampleSize: payload.sampleSize,
        sampleSizeDisplay: payload.sampleSizeDisplay,
        display: INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
        priorityDisplay: INSUFFICIENT_COMMUNITY_DATA_MESSAGE
      };
    }
  }

  return payload;
}

/**
 * Étape 43 — most sought variants (current priority unique users).
 */
async function getMostSoughtVariants(
  db = pool,
  { metricDate = null, limit = 20, level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC } = {}
) {
  await ensureCommunityStatsTables(db);
  const day = metricDate ? String(metricDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const result = await db.query(
    `SELECT *
     FROM community_variant_stats
     WHERE metric_date = $1::date
       AND priority_user_count > 0
     ORDER BY priority_user_count DESC, sample_size DESC, variant_id ASC
     LIMIT $2`,
    [day, Math.max(1, Math.min(100, Number(limit) || 20))]
  );

  const items = [];
  for (const row of result.rows) {
    const payload = rowToCommunityVariantPayload(row, { level });
    if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
      const gated = applyPublicAnonymizationGate({
        uniqueUserCount: payload.sampleSize,
        payload
      });
      if (!gated.ok) continue;
    }
    items.push({
      variantId: payload.variantId,
      priorityUserCount: payload.priorityUserCount,
      priorityRate: payload.priorityRate,
      sampleSize: payload.sampleSize,
      sampleSizeDisplay: payload.sampleSizeDisplay,
      priorityDisplay: payload.priorityDisplay,
      recentPriorityAddsDisplay: payload.recentPriorityAddsDisplay
    });
  }
  return { metricDate: day, definition: "current_priority_unique_users", items };
}

/**
 * Étape 60 — delegates to the ordered daily pipeline.
 * Kept as a stable entrypoint for server.js.
 */
function startCommunityStatsDailyJob(db = pool) {
  if (dailyJobStarted) return;
  dailyJobStarted = true;
  require("./sprite-graph-daily").startSpriteGraphDailyJob(db);
}

function stopCommunityStatsDailyJob() {
  require("./sprite-graph-daily").stopSpriteGraphDailyJob();
  dailyJobStarted = false;
}

module.exports = {
  COMMUNITY_ELIGIBILITY,
  EXPLICIT_COLLECTION_STATUSES,
  OWNERSHIP_SAMPLE_STATUSES,
  NOT_OWNED_SAMPLE_STATUSES,
  PRIORITY_WINDOWS_DAYS,
  ensureCommunityStatsTables,
  listEligibleCommunityUserIds,
  calculateCommunityVariantStats,
  getCommunityVariantOwnership,
  getMostSoughtVariants,
  formatCommunityOwnershipDisplay,
  formatCommunityPriorityDisplay,
  formatSampleSizeDisplay,
  formatRecentPriorityAddsDisplay,
  roundRate,
  startCommunityStatsDailyJob,
  stopCommunityStatsDailyJob,
  isTestAccountRow
};
