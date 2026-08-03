const { pool, resolveCatalogueContext, round2 } = require("./shared");
const { ensureSquadDailyStatsTables } = require("./schema");

async function calculateCommunitySquadProgress(
  db = pool,
  { metricDate = null, windowDays = 7, catalogueVersion = null } = {}
) {
  await ensureSquadDailyStatsTables(db);
  const day = metricDate ? String(metricDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const days = Math.max(1, Math.floor(Number(windowDays) || 7));
  const version = catalogueVersion || (await resolveCatalogueContext(db)).catalogueVersion;

  const col = days === 1 ? "progress_1d" : days <= 7 ? "progress_7d" : "progress_30d";

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
  const avg = result.rows[0]?.avg_progress != null ? round2(result.rows[0].avg_progress) : null;

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
      require("../sprite-graph-formula").squadFormulaVersion(),
      JSON.stringify({
        formula: "sum(completion_progress) / eligible_squad_count",
        formulaVersion: require("../sprite-graph-formula").squadFormulaVersion(),
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

module.exports = { calculateCommunitySquadProgress, getCommunitySquadProgress };

async function getCommunitySquadProgress(db = pool, { metricDate = null, windowDays = 7 } = {}) {
  await ensureSquadDailyStatsTables(db);
  const day = metricDate ? String(metricDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
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
    avgCompletionProgress: row.avg_completion_progress != null ? Number(row.avg_completion_progress) : null,
    catalogueVersion: row.catalogue_version
  };
}
