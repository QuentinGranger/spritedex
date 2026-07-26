"use strict";

// ── Sprite Graph daily pipeline (Étape 60) ───────────────────────────────────
// One ordered pass: eligibility → ownership → priorities → trends →
// comparison → squad snapshots → anonymization gate → publish.

const { pool } = require("./db");
const {
  resolveCatalogueContext,
  ensureCatalogueVersionColumns
} = require("./sprite-graph-catalogue");
const {
  listEligibleCommunityUserIds,
  calculateCommunityVariantStats,
  ensureCommunityStatsTables
} = require("./sprite-graph-community");
const {
  calculateComparisonDailyStats,
  calculateSpritePopularityScores,
  ensureComparisonStatsTables
} = require("./sprite-graph-comparison-stats");
const {
  calculateVariantInterestDaily,
  ensureTrendTables
} = require("./sprite-graph-trends");
const {
  calculateSquadDailyStats,
  calculateCommunitySquadProgress,
  ensureSquadDailyStatsTables,
  listEligibleSquadIds
} = require("./sprite-graph-squad-stats");
const {
  PUBLIC_ANONYMIZATION_MIN_USERS,
  applyPublicAnonymizationGate
} = require("./sprite-graph-privacy");

let dailyJobStarted = false;
let dailyJobInterval = null;

async function ensureDailyPipelineTables(db = pool) {
  await ensureCommunityStatsTables(db);
  await ensureComparisonStatsTables(db);
  await ensureTrendTables(db);
  await ensureSquadDailyStatsTables(db);
  await ensureCatalogueVersionColumns(db);

  await db.query(`
    CREATE TABLE IF NOT EXISTS graph_daily_publish (
      metric_date DATE NOT NULL PRIMARY KEY,
      catalogue_version VARCHAR(80),
      eligible_user_count INTEGER NOT NULL DEFAULT 0,
      eligible_squad_count INTEGER NOT NULL DEFAULT 0,
      published_variant_count INTEGER NOT NULL DEFAULT 0,
      gated_variant_count INTEGER NOT NULL DEFAULT 0,
      published_sprite_interest_count INTEGER NOT NULL DEFAULT 0,
      gated_sprite_interest_count INTEGER NOT NULL DEFAULT 0,
      steps JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Étape 60.7–60.8 — anonymization thresholds + publish summary row.
 */
async function publishPublicAggregates(db = pool, {
  metricDate = null,
  catalogueVersion = null,
  eligibleUserCount = 0,
  eligibleSquadCount = 0,
  steps = {}
} = {}) {
  await ensureDailyPipelineTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const variants = await db.query(
    `SELECT sample_size FROM community_variant_stats WHERE metric_date = $1::date`,
    [day]
  );
  let publishedVariants = 0;
  let gatedVariants = 0;
  for (const row of variants.rows) {
    const gated = applyPublicAnonymizationGate({
      uniqueUserCount: row.sample_size,
      payload: row
    });
    if (gated.ok) publishedVariants += 1;
    else gatedVariants += 1;
  }

  const interest = await db.query(
    `SELECT sample_size FROM sprite_popularity_scores WHERE metric_date = $1::date`,
    [day]
  );
  let publishedInterest = 0;
  let gatedInterest = 0;
  for (const row of interest.rows) {
    const gated = applyPublicAnonymizationGate({
      uniqueUserCount: row.sample_size,
      payload: row
    });
    if (gated.ok) publishedInterest += 1;
    else gatedInterest += 1;
  }

  await db.query(
    `INSERT INTO graph_daily_publish (
       metric_date, catalogue_version,
       eligible_user_count, eligible_squad_count,
       published_variant_count, gated_variant_count,
       published_sprite_interest_count, gated_sprite_interest_count,
       steps, calculated_at
     ) VALUES (
       $1::date, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW()
     )
     ON CONFLICT (metric_date) DO UPDATE SET
       catalogue_version = EXCLUDED.catalogue_version,
       eligible_user_count = EXCLUDED.eligible_user_count,
       eligible_squad_count = EXCLUDED.eligible_squad_count,
       published_variant_count = EXCLUDED.published_variant_count,
       gated_variant_count = EXCLUDED.gated_variant_count,
       published_sprite_interest_count = EXCLUDED.published_sprite_interest_count,
       gated_sprite_interest_count = EXCLUDED.gated_sprite_interest_count,
       steps = EXCLUDED.steps,
       calculated_at = NOW()`,
    [
      day,
      catalogueVersion,
      eligibleUserCount,
      eligibleSquadCount,
      publishedVariants,
      gatedVariants,
      publishedInterest,
      gatedInterest,
      JSON.stringify({
        ...steps,
        anonymizationMinUsers: PUBLIC_ANONYMIZATION_MIN_USERS
      })
    ]
  );

  return {
    metricDate: day,
    catalogueVersion,
    eligibleUserCount,
    eligibleSquadCount,
    publishedVariantCount: publishedVariants,
    gatedVariantCount: gatedVariants,
    publishedSpriteInterestCount: publishedInterest,
    gatedSpriteInterestCount: gatedInterest,
    anonymizationMinUsers: PUBLIC_ANONYMIZATION_MIN_USERS
  };
}

/**
 * Étape 60 — full daily treatment (ordered).
 */
async function runSpriteGraphDailyPipeline(db = pool, {
  metricDate = null,
  windowDays = 7
} = {}) {
  await ensureDailyPipelineTables(db);
  const startedAt = new Date();
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const cat = await resolveCatalogueContext(db);
  const catalogueVersion = cat.catalogueVersion;
  const opts = {
    metricDate: day,
    catalogueVersion,
    catalogueVariantCount: cat.catalogueVariantCount,
    windowDays
  };

  // 1. Eligible users
  const eligibleUserIds = await listEligibleCommunityUserIds(db, {
    asOf: new Date(`${day}T23:59:59.999Z`)
  });

  // 2–3. Ownership rates + priorities (community_variant_stats)
  const community = await calculateCommunityVariantStats(db, {
    ...opts,
    eligibleUserIds
  });

  // 5. Comparison stats + interest scores (before trends — interest series needs scores)
  const comparison = await calculateComparisonDailyStats(db, opts);
  const popularity = await calculateSpritePopularityScores(db, opts);

  // 4. Trends (variant interest series; uses popularity scores)
  const trends = await calculateVariantInterestDaily(db, opts);

  // 6. Squad snapshots / squad_daily_stats + community progression
  const eligibleSquadIds = await listEligibleSquadIds(db, {
    asOf: new Date(`${day}T23:59:59.999Z`)
  });
  const squads = await calculateSquadDailyStats(db, {
    ...opts,
    eligibleSquadIds
  });
  const squadProgress = await calculateCommunitySquadProgress(db, {
    metricDate: day,
    windowDays: 7,
    catalogueVersion
  });

  // 7–8. Anonymization thresholds + publish summary
  const publish = await publishPublicAggregates(db, {
    metricDate: day,
    catalogueVersion,
    eligibleUserCount: eligibleUserIds.length,
    eligibleSquadCount: eligibleSquadIds.length,
    steps: {
      community,
      trends,
      comparison,
      popularity,
      squads,
      squadProgress
    }
  });

  // Étape 62/66 — nightly consolidation + optional retention policy application.
  let retention = null;
  if (process.env.GRAPH_DAILY_PRUNE_TECHNICAL === "1") {
    try {
      retention = await require("./sprite-graph-governance").applyGraphRetentionPolicy(db);
    } catch (err) {
      console.error("[sprite-graph-daily] retention prune failed:", err.message);
    }
  }

  try {
    await require("./sprite-graph-metrics").recordOpsRun(db, {
      runType: "aggregate_calc",
      startedAt,
      finishedAt: new Date(),
      ok: true,
      details: { metricDate: day, catalogueVersion, eligibleUsers: eligibleUserIds.length }
    });
  } catch (_) { /* ops best-effort */ }

  return {
    metricDate: day,
    catalogueVersion,
    eligibleUsers: eligibleUserIds.length,
    eligibleSquads: eligibleSquadIds.length,
    community,
    trends,
    comparison,
    popularity,
    squads,
    squadProgress,
    publish,
    retention,
    architecture: "event → incremental counter → nightly consolidation → official daily aggregate"
  };
}

function startSpriteGraphDailyJob(db = pool) {
  if (dailyJobStarted) return;
  dailyJobStarted = true;

  const pollMs = Number(process.env.GRAPH_COMMUNITY_STATS_POLL_MS);
  const intervalMs = Number.isFinite(pollMs) ? pollMs : 60 * 60 * 1000;

  const tick = () => {
    runSpriteGraphDailyPipeline(db).catch((err) =>
      console.error("[sprite-graph-daily] pipeline failed:", err.message)
    );
  };

  if (intervalMs <= 0) {
    console.log("[sprite-graph-daily] daily job disabled (GRAPH_COMMUNITY_STATS_POLL_MS=0)");
    return;
  }
  setTimeout(tick, 15_000).unref?.();
  dailyJobInterval = setInterval(tick, intervalMs);
  if (typeof dailyJobInterval.unref === "function") dailyJobInterval.unref();
  console.log(`[sprite-graph-daily] daily job started (every ${intervalMs}ms)`);
}

function stopSpriteGraphDailyJob() {
  if (dailyJobInterval) {
    clearInterval(dailyJobInterval);
    dailyJobInterval = null;
  }
  dailyJobStarted = false;
}

module.exports = {
  ensureDailyPipelineTables,
  runSpriteGraphDailyPipeline,
  publishPublicAggregates,
  startSpriteGraphDailyJob,
  stopSpriteGraphDailyJob
};
