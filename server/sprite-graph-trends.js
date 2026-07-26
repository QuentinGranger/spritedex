"use strict";

// ── Sprite Graph interest evolution & squad progression (Étapes 53–55) ───────

const { pool } = require("./db");
const {
  GRAPH_DATA_LEVELS,
  applyPublicAnonymizationGate,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  PUBLIC_ANONYMIZATION_MIN_USERS
} = require("./sprite-graph-privacy");

// Labels duplicated (Étape 52) to avoid circular requires with comparison-stats.
const INTEREST_TREND_LABEL = "Tendance SpriteDex";
const INTEREST_INDEX_LABEL = "Indice d'intérêt communautaire";

/** Étape 54 — min sample before showing a trend (env: GRAPH_TREND_MIN_VOLUME). */
const TREND_MIN_VOLUME = (() => {
  const n = Number(process.env.GRAPH_TREND_MIN_VOLUME);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
})();

/**
 * Étape 81 — minimum history before displaying a trend.
 */
const TREND_DISPLAY_REQUIREMENTS = Object.freeze({
  minDaysOfData: (() => {
    const n = Number(process.env.GRAPH_TREND_MIN_DAYS);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
  })(),
  minEligibleUsers: (() => {
    const n = Number(process.env.GRAPH_TREND_MIN_USERS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  })(),
  minRelevantEvents: (() => {
    const n = Number(process.env.GRAPH_TREND_MIN_EVENTS);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
  })()
});

const TREND_INSUFFICIENT_MESSAGE = "Pas encore assez de données pour calculer une tendance.";

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
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

const TREND_CATEGORIES = Object.freeze([
  "strongly_rising",
  "rising",
  "stable",
  "falling",
  "strongly_falling"
]);

const TREND_LABELS_FR = Object.freeze({
  strongly_rising: "fortement en hausse",
  rising: "en hausse",
  stable: "stable",
  falling: "en baisse",
  strongly_falling: "fortement en baisse"
});

async function ensureTrendTables(db = pool) {
  // Étape 53 — daily variant interest series.
  await db.query(`
    CREATE TABLE IF NOT EXISTS variant_interest_daily (
      metric_date DATE NOT NULL,
      variant_id VARCHAR(100) NOT NULL REFERENCES sprite_variants(id) ON DELETE CASCADE,

      priority_user_count INTEGER NOT NULL DEFAULT 0,
      ownership_rate DECIMAL,
      interest_score DECIMAL,
      sample_size INTEGER NOT NULL DEFAULT 0,

      change_7d DECIMAL,
      change_30d DECIMAL,
      peak_interest_score DECIMAL,
      trend VARCHAR(30),

      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, variant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_variant_interest_daily_date
      ON variant_interest_daily (metric_date DESC);
    CREATE INDEX IF NOT EXISTS idx_variant_interest_daily_trend
      ON variant_interest_daily (metric_date DESC, trend)
      WHERE trend IS NOT NULL;
  `);

  // Étape 55 — daily squad coverage snapshots.
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

      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, squad_id)
    );
    CREATE INDEX IF NOT EXISTS idx_squad_daily_snapshots_date
      ON squad_daily_snapshots (metric_date DESC);
  `);
}

/**
 * Étape 81 — gate trend display on days / users / events.
 */
function evaluateTrendEligibility({
  daysOfData = 0,
  sampleSize = 0,
  relevantEventCount = 0,
  requirements = TREND_DISPLAY_REQUIREMENTS
} = {}) {
  const days = Math.max(0, Math.floor(Number(daysOfData) || 0));
  const users = Math.max(0, Math.floor(Number(sampleSize) || 0));
  const events = Math.max(0, Math.floor(Number(relevantEventCount) || 0));
  const ok = days >= requirements.minDaysOfData
    && users >= requirements.minEligibleUsers
    && events >= requirements.minRelevantEvents;
  return {
    ok,
    daysOfData: days,
    sampleSize: users,
    relevantEventCount: events,
    requirements,
    message: ok ? null : TREND_INSUFFICIENT_MESSAGE
  };
}

/**
 * Étape 54 + 81 — classify % change only when eligibility passes.
 */
function resolveInterestTrend(changePct, sampleSize, {
  minVolume = TREND_MIN_VOLUME,
  daysOfData = null,
  relevantEventCount = null,
  enforceDisplayRequirements = true
} = {}) {
  if (enforceDisplayRequirements
    && daysOfData != null
    && relevantEventCount != null) {
    const gate = evaluateTrendEligibility({
      daysOfData,
      sampleSize,
      relevantEventCount
    });
    if (!gate.ok) return null;
  } else {
    const volume = Number(sampleSize) || 0;
    if (volume < minVolume) return null;
  }
  if (changePct == null || !Number.isFinite(Number(changePct))) return null;
  const c = Number(changePct);
  if (c >= 25) return "strongly_rising";
  if (c >= 10) return "rising";
  if (c > -10) return "stable";
  if (c > -25) return "falling";
  return "strongly_falling";
}

async function countTrendHistoryDays(db, variantId, asOfDay, { includeAsOfRow = true } = {}) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM variant_interest_daily
     WHERE variant_id = $1
       AND metric_date < $2::date
       AND interest_score IS NOT NULL`,
    [String(variantId), asOfDay]
  );
  const prior = result.rows[0]?.n || 0;
  return includeAsOfRow ? prior + 1 : prior;
}

async function countRelevantTrendEvents(db, variantId, {
  asOfDay,
  windowDays = 7
} = {}) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM graph_events e
     LEFT JOIN graph_event_corrections c ON c.cancelled_event_id = e.id
     WHERE c.id IS NULL
       AND e.variant_id = $1
       AND e.event_type IN (
         'collection.priority_added',
         'collection.sprite_added',
         'notification.opened'
       )
       AND e.occurred_at::date <= $2::date
       AND e.occurred_at::date >= ($2::date - ($3::int - 1))`,
    [String(variantId), asOfDay, Math.max(1, Math.floor(windowDays))]
  );
  return result.rows[0]?.n || 0;
}

function percentChange(current, previous) {
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur)) return null;
  if (!Number.isFinite(prev)) return null;
  if (prev === 0) {
    if (cur === 0) return 0;
    return null; // undefined baseline — skip trend %
  }
  return Math.round(((cur - prev) / Math.abs(prev)) * 10000) / 100;
}

/**
 * Étape 53 — upsert daily variant rows + 7d/30d/peak/trend.
 */
async function calculateVariantInterestDaily(db = pool, {
  metricDate = null,
  catalogueVersion = null
} = {}) {
  await ensureTrendTables(db);
  try {
    await db.query(
      `ALTER TABLE variant_interest_daily
         ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`
    );
  } catch (_) { /* ignore */ }
  try {
    await require("./sprite-graph-formula").ensureFormulaVersionColumns(db);
  } catch (_) { /* ignore */ }

  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  let catVersion = catalogueVersion;
  if (!catVersion) {
    try {
      catVersion = (await require("./sprite-graph-catalogue").resolveCatalogueContext(db))
        .catalogueVersion;
    } catch (_) {
      catVersion = null;
    }
  }

  // Prefer community_variant_stats for priorities/possession; interest from sprite score.
  const rows = await db.query(
    `SELECT cvs.variant_id,
            cvs.priority_user_count,
            cvs.ownership_rate,
            cvs.sample_size,
            sv.sprite_id,
            sps.score AS sprite_interest_score
     FROM community_variant_stats cvs
     JOIN sprite_variants sv ON sv.id = cvs.variant_id
     LEFT JOIN sprite_popularity_scores sps
       ON sps.sprite_id = sv.sprite_id AND sps.metric_date = cvs.metric_date
     WHERE cvs.metric_date = $1::date`,
    [day]
  );

  let upserted = 0;
  for (const row of rows.rows) {
    const interestScore = row.sprite_interest_score != null
      ? Number(row.sprite_interest_score)
      : null;
    const sampleSize = Number(row.sample_size) || 0;

    const hist = await db.query(
      `SELECT metric_date, interest_score
       FROM variant_interest_daily
       WHERE variant_id = $1
         AND metric_date < $2::date
       ORDER BY metric_date DESC
       LIMIT 40`,
      [row.variant_id, day]
    );
    const byDate = new Map(
      hist.rows.map((r) => [toIsoDate(r.metric_date), Number(r.interest_score)])
    );

    const d7 = new Date(`${day}T00:00:00.000Z`);
    d7.setUTCDate(d7.getUTCDate() - 7);
    const d30 = new Date(`${day}T00:00:00.000Z`);
    d30.setUTCDate(d30.getUTCDate() - 30);
    const key7 = d7.toISOString().slice(0, 10);
    const key30 = d30.toISOString().slice(0, 10);

    // Nearest prior score on/before the window start if exact day missing.
    const scoreOnOrBefore = (target) => {
      if (byDate.has(target)) return byDate.get(target);
      for (const [d, s] of byDate.entries()) {
        if (d <= target && Number.isFinite(s)) return s;
      }
      return null;
    };

    const change7d = percentChange(interestScore, scoreOnOrBefore(key7));
    const change30d = percentChange(interestScore, scoreOnOrBefore(key30));

    const peakRes = await db.query(
      `SELECT MAX(interest_score) AS peak
       FROM variant_interest_daily
       WHERE variant_id = $1 AND interest_score IS NOT NULL`,
      [row.variant_id]
    );
    let peak = peakRes.rows[0]?.peak != null ? Number(peakRes.rows[0].peak) : null;
    if (interestScore != null) {
      peak = peak == null ? interestScore : Math.max(peak, interestScore);
    }

    // Étape 81 — require min history before storing a trend label.
    const daysOfData = await countTrendHistoryDays(db, row.variant_id, day);
    const relevantEventCount = await countRelevantTrendEvents(db, row.variant_id, {
      asOfDay: day,
      windowDays: 7
    });
    const trend = resolveInterestTrend(change7d, sampleSize, {
      daysOfData,
      relevantEventCount,
      enforceDisplayRequirements: true
    });

    await db.query(
      `INSERT INTO variant_interest_daily (
         metric_date, variant_id,
         priority_user_count, ownership_rate, interest_score, sample_size,
         change_7d, change_30d, peak_interest_score, trend,
         catalogue_version, formula_version, calculated_at
       ) VALUES (
         $1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
       )
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         priority_user_count = EXCLUDED.priority_user_count,
         ownership_rate = EXCLUDED.ownership_rate,
         interest_score = EXCLUDED.interest_score,
         sample_size = EXCLUDED.sample_size,
         change_7d = EXCLUDED.change_7d,
         change_30d = EXCLUDED.change_30d,
         peak_interest_score = EXCLUDED.peak_interest_score,
         trend = EXCLUDED.trend,
         catalogue_version = EXCLUDED.catalogue_version,
         formula_version = EXCLUDED.formula_version,
         calculated_at = NOW()`,
      [
        day,
        row.variant_id,
        row.priority_user_count || 0,
        row.ownership_rate,
        interestScore,
        sampleSize,
        change7d,
        change30d,
        peak,
        trend,
        catVersion,
        require("./sprite-graph-formula").interestFormulaVersion()
      ]
    );
    upserted += 1;
  }

  return {
    metricDate: day,
    variants: upserted,
    label: INTEREST_TREND_LABEL,
    catalogueVersion: catVersion
  };
}

/**
 * Étape 55/56 — delegates to squad_daily_stats (canonical) + snapshot mirror.
 */
async function calculateSquadDailySnapshots(db = pool, opts = {}) {
  return require("./sprite-graph-squad-stats").calculateSquadDailyStats(db, opts);
}

async function calculateInterestTrendsAndSquadSnapshots(db = pool, opts = {}) {
  const variants = await calculateVariantInterestDaily(db, opts);
  const squads = await calculateSquadDailySnapshots(db, opts);
  return { variants, squads };
}

async function getVariantInterestSeries(db = pool, variantId, {
  days = 30,
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  await ensureTrendTables(db);
  const result = await db.query(
    `SELECT *
     FROM variant_interest_daily
     WHERE variant_id = $1
     ORDER BY metric_date DESC
     LIMIT $2`,
    [String(variantId), Math.max(1, Math.min(365, Number(days) || 30))]
  );
  if (!result.rows.length) return null;
  const latest = result.rows[0];
  if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
    const gated = applyPublicAnonymizationGate({
      uniqueUserCount: latest.sample_size,
      payload: latest
    });
    if (!gated.ok) {
      return {
        variantId: String(variantId),
        insufficient: true,
        message: gated.message || INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
        minUsers: PUBLIC_ANONYMIZATION_MIN_USERS,
        label: INTEREST_TREND_LABEL
      };
    }
  }
  const daysOfData = result.rows.filter((r) => r.interest_score != null).length;
  const relevantEventCount = await countRelevantTrendEvents(db, variantId, {
    asOfDay: toIsoDate(latest.metric_date),
    windowDays: 7
  });
  const eligibility = evaluateTrendEligibility({
    daysOfData,
    sampleSize: latest.sample_size,
    relevantEventCount
  });
  const trend = eligibility.ok ? latest.trend : null;

  return {
    variantId: String(variantId),
    label: INTEREST_TREND_LABEL,
    indexLabel: INTEREST_INDEX_LABEL,
    trendEligibility: eligibility,
    latest: {
      metricDate: toIsoDate(latest.metric_date) || latest.metric_date,
      priorityUserCount: latest.priority_user_count,
      ownershipRate: latest.ownership_rate != null ? Number(latest.ownership_rate) : null,
      interestScore: latest.interest_score != null ? Number(latest.interest_score) : null,
      sampleSize: latest.sample_size,
      change7d: latest.change_7d != null ? Number(latest.change_7d) : null,
      change30d: latest.change_30d != null ? Number(latest.change_30d) : null,
      peakInterestScore: latest.peak_interest_score != null
        ? Number(latest.peak_interest_score)
        : null,
      trend,
      trendLabel: trend ? TREND_LABELS_FR[trend] || trend : null,
      trendMessage: trend ? null : TREND_INSUFFICIENT_MESSAGE
    },
    series: result.rows.map((r) => ({
      metricDate: r.metric_date,
      priorityUserCount: r.priority_user_count,
      ownershipRate: r.ownership_rate != null ? Number(r.ownership_rate) : null,
      interestScore: r.interest_score != null ? Number(r.interest_score) : null
    })).reverse()
  };
}

async function getSquadProgression(db = pool, squadId, {
  days = 30
} = {}) {
  await ensureTrendTables(db);
  const result = await db.query(
    `SELECT *
     FROM squad_daily_snapshots
     WHERE squad_id = $1
     ORDER BY metric_date DESC
     LIMIT $2`,
    [squadId, Math.max(1, Math.min(365, Number(days) || 30))]
  );
  if (!result.rows.length) return null;
  const latest = result.rows[0];
  return {
    squadId: Number(squadId),
    latest: {
      metricDate: latest.metric_date,
      coveredVariantCount: latest.covered_variant_count,
      collectiveCompletionRate: latest.collective_completion_rate != null
        ? Number(latest.collective_completion_rate)
        : null,
      memberCount: latest.member_count,
      uniqueVariantCount: latest.unique_variant_count,
      progress1d: latest.progress_1d != null ? Number(latest.progress_1d) : null,
      progress7d: latest.progress_7d != null ? Number(latest.progress_7d) : null,
      progress30d: latest.progress_30d != null ? Number(latest.progress_30d) : null
    },
    series: result.rows.map((r) => ({
      metricDate: r.metric_date,
      coveredVariantCount: r.covered_variant_count,
      collectiveCompletionRate: r.collective_completion_rate != null
        ? Number(r.collective_completion_rate)
        : null,
      memberCount: r.member_count,
      uniqueVariantCount: r.unique_variant_count
    })).reverse()
  };
}

module.exports = {
  TREND_MIN_VOLUME,
  TREND_DISPLAY_REQUIREMENTS,
  TREND_INSUFFICIENT_MESSAGE,
  TREND_CATEGORIES,
  TREND_LABELS_FR,
  ensureTrendTables,
  evaluateTrendEligibility,
  resolveInterestTrend,
  percentChange,
  countTrendHistoryDays,
  countRelevantTrendEvents,
  calculateVariantInterestDaily,
  calculateSquadDailySnapshots,
  calculateInterestTrendsAndSquadSnapshots,
  getVariantInterestSeries,
  getSquadProgression
};
