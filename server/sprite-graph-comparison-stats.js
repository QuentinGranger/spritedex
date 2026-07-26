"use strict";

// ── Sprite Graph comparison & interest aggregates (Étapes 46–52) ─────────────

const { pool } = require("./db");
const {
  GRAPH_DATA_LEVELS,
  applyPublicAnonymizationGate,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE
} = require("./sprite-graph-privacy");

/**
 * Étape 52 — public labels (never "popularité officielle" / Fortnite-wide).
 */
const INTEREST_INDEX_LABEL = "Indice d'intérêt communautaire";
const INTEREST_TREND_LABEL = "Tendance SpriteDex";

/**
 * Étape 50–51 — documented, env-overridable weights (must sum ~1).
 * GRAPH_POPULARITY_WEIGHTS=priority:0.4,collectionAdd:0.3,comparisonDiff:0.2,notification:0.1
 */
function parsePopularityWeights() {
  const defaults = {
    priority: 0.4,
    collectionAdd: 0.3,
    comparisonDiff: 0.2,
    notification: 0.1
  };
  const raw = String(process.env.GRAPH_POPULARITY_WEIGHTS || "").trim();
  if (!raw) return defaults;
  const out = { ...defaults };
  for (const part of raw.split(",")) {
    const [k, v] = part.split(":").map((s) => String(s || "").trim());
    if (k && Number.isFinite(Number(v))) out[k] = Number(v);
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum <= 0) return defaults;
  for (const key of Object.keys(out)) out[key] = out[key] / sum;
  return Object.freeze(out);
}

const POPULARITY_SCORE_WEIGHTS = parsePopularityWeights();
/** @deprecated use INTEREST_SCORE_WEIGHTS — same object, clearer name. */
const INTEREST_SCORE_WEIGHTS = POPULARITY_SCORE_WEIGHTS;

const COLLECTION_BANDS = Object.freeze([
  { id: "0_25", label: "0–25 %", min: 0, max: 25 },
  { id: "25_50", label: "25–50 %", min: 25, max: 50 },
  { id: "50_75", label: "50–75 %", min: 50, max: 75 },
  { id: "75_100", label: "75–100 %", min: 75, max: 100.0001 }
]);

function resolveCollectionBand(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return null;
  const r = Number(rate);
  for (const band of COLLECTION_BANDS) {
    if (r >= band.min && r < band.max) return band.id;
  }
  if (r >= 100) return "75_100";
  return null;
}

async function ensureComparisonStatsTables(db = pool) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS comparison_daily_stats (
      metric_date DATE NOT NULL PRIMARY KEY,
      comparisons_counted INTEGER NOT NULL DEFAULT 0,
      unique_pair_count INTEGER NOT NULL DEFAULT 0,
      unique_actor_count INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.query(`
    ALTER TABLE comparison_daily_stats
      ADD COLUMN IF NOT EXISTS avg_complementarity DECIMAL,
      ADD COLUMN IF NOT EXISTS valid_pair_version_count INTEGER NOT NULL DEFAULT 0;
  `);

  // Étape 46–47 — difference appearances (explicitly not "views").
  await db.query(`
    CREATE TABLE IF NOT EXISTS comparison_sprite_diff_stats (
      metric_date DATE NOT NULL,
      sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
      difference_appearance_count INTEGER NOT NULL DEFAULT 0,
      comparison_count INTEGER NOT NULL DEFAULT 0,
      sample_size INTEGER NOT NULL DEFAULT 0,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, sprite_id)
    );
    CREATE INDEX IF NOT EXISTS idx_comparison_sprite_diff_date
      ON comparison_sprite_diff_stats (metric_date DESC, difference_appearance_count DESC);
  `);

  // Étape 49 — complementarity by collection-size band.
  await db.query(`
    CREATE TABLE IF NOT EXISTS comparison_complementarity_by_band (
      metric_date DATE NOT NULL,
      collection_band VARCHAR(20) NOT NULL,
      unique_pair_version_count INTEGER NOT NULL DEFAULT 0,
      avg_complementarity DECIMAL,
      sample_size INTEGER NOT NULL DEFAULT 0,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, collection_band)
    );
  `);

  // Étape 50 — composite popularity score per sprite / day.
  await db.query(`
    CREATE TABLE IF NOT EXISTS sprite_popularity_scores (
      metric_date DATE NOT NULL,
      sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
      score DECIMAL NOT NULL DEFAULT 0,
      sample_size INTEGER NOT NULL DEFAULT 0,
      components JSONB NOT NULL DEFAULT '{}'::jsonb,
      weights JSONB NOT NULL DEFAULT '{}'::jsonb,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (metric_date, sprite_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sprite_popularity_scores_date
      ON sprite_popularity_scores (metric_date DESC, score DESC);
  `);
}

/**
 * Étape 48 — one recent complementarity value per (pairKey, catalogueVersion).
 */
async function loadLatestPairComplementarity(db, { metricDate }) {
  const result = await db.query(
    `SELECT DISTINCT ON (
       COALESCE(context->>'pairKey', ''),
       COALESCE(context->>'catalogueVersion', '')
     )
       context->>'pairKey' AS pair_key,
       context->>'catalogueVersion' AS catalogue_version,
       (context->>'complementarityRate')::float AS complementarity_rate,
       (context->>'pairCollectionRate')::float AS pair_collection_rate,
       actor_user_id,
       occurred_at
     FROM graph_events
     WHERE event_type = 'comparison.completed'
       AND occurred_at::date = $1::date
       AND context ? 'complementarityRate'
       AND COALESCE(context->>'pairKey', '') <> ''
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )
     ORDER BY
       COALESCE(context->>'pairKey', ''),
       COALESCE(context->>'catalogueVersion', ''),
       occurred_at DESC`,
    [metricDate]
  );
  return result.rows.filter((r) => Number.isFinite(Number(r.complementarity_rate)));
}

async function calculateComparisonDailyStats(db = pool, {
  metricDate = null,
  catalogueVersion = null
} = {}) {
  await ensureComparisonStatsTables(db);
  try {
    await db.query(`
      ALTER TABLE comparison_daily_stats
        ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80);
      ALTER TABLE comparison_sprite_diff_stats
        ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80);
      ALTER TABLE comparison_complementarity_by_band
        ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80);
      ALTER TABLE sprite_popularity_scores
        ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80);
    `);
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

  const totals = await db.query(
    `SELECT COUNT(*)::int AS comparisons,
            COUNT(DISTINCT context->>'pairKey')::int AS pairs,
            COUNT(DISTINCT actor_user_id)::int AS actors
     FROM graph_events
     WHERE event_type = 'comparison.completed'
       AND occurred_at::date = $1::date
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )`,
    [day]
  );

  const latest = await loadLatestPairComplementarity(db, { metricDate: day });
  const valid = latest.filter((r) => Number.isFinite(Number(r.complementarity_rate)));
  const avgComplementarity = valid.length
    ? Math.round(
      (valid.reduce((s, r) => s + Number(r.complementarity_rate), 0) / valid.length) * 100
    ) / 100
    : null;

  await db.query(
    `INSERT INTO comparison_daily_stats (
       metric_date, comparisons_counted, unique_pair_count, unique_actor_count,
       avg_complementarity, valid_pair_version_count, metadata,
       catalogue_version, calculated_at
     ) VALUES ($1::date, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())
     ON CONFLICT (metric_date) DO UPDATE SET
       comparisons_counted = EXCLUDED.comparisons_counted,
       unique_pair_count = EXCLUDED.unique_pair_count,
       unique_actor_count = EXCLUDED.unique_actor_count,
       avg_complementarity = EXCLUDED.avg_complementarity,
       valid_pair_version_count = EXCLUDED.valid_pair_version_count,
       metadata = EXCLUDED.metadata,
       catalogue_version = EXCLUDED.catalogue_version,
       calculated_at = NOW()`,
    [
      day,
      totals.rows[0]?.comparisons || 0,
      totals.rows[0]?.pairs || 0,
      totals.rows[0]?.actors || 0,
      avgComplementarity,
      valid.length,
      JSON.stringify({
        metric: "avg_complementarity_per_unique_pair_catalogue_version",
        note: "difference_appearances_are_not_views"
      }),
      catVersion
    ]
  );

  // Étape 49 — by collection band.
  const bandBuckets = Object.create(null);
  for (const band of COLLECTION_BANDS) {
    bandBuckets[band.id] = { rates: [], pairs: 0 };
  }
  for (const row of valid) {
    const band = resolveCollectionBand(row.pair_collection_rate);
    if (!band || !bandBuckets[band]) continue;
    bandBuckets[band].rates.push(Number(row.complementarity_rate));
    bandBuckets[band].pairs += 1;
  }
  for (const band of COLLECTION_BANDS) {
    const bucket = bandBuckets[band.id];
    const avg = bucket.rates.length
      ? Math.round(
        (bucket.rates.reduce((s, n) => s + n, 0) / bucket.rates.length) * 100
      ) / 100
      : null;
    await db.query(
      `INSERT INTO comparison_complementarity_by_band (
         metric_date, collection_band, unique_pair_version_count,
         avg_complementarity, sample_size, catalogue_version, calculated_at
       ) VALUES ($1::date, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (metric_date, collection_band) DO UPDATE SET
         unique_pair_version_count = EXCLUDED.unique_pair_version_count,
         avg_complementarity = EXCLUDED.avg_complementarity,
         sample_size = EXCLUDED.sample_size,
         catalogue_version = EXCLUDED.catalogue_version,
         calculated_at = NOW()`,
      [day, band.id, bucket.pairs, avg, bucket.pairs, catVersion]
    );
  }

  // Étape 46–47 — sprites in differences (not views).
  const diffEvents = await db.query(
    `SELECT context->'topDifferenceSpriteIds' AS sprites
     FROM graph_events
     WHERE event_type = 'comparison.completed'
       AND occurred_at::date = $1::date
       AND jsonb_typeof(context->'topDifferenceSpriteIds') = 'array'
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c
         WHERE c.cancelled_event_id = graph_events.id
       )`,
    [day]
  );
  const appearance = new Map(); // sprite -> { appearances, comparisons }
  for (const row of diffEvents.rows) {
    const list = Array.isArray(row.sprites) ? row.sprites : [];
    const unique = new Set(list.map(String).filter(Boolean));
    for (const sid of unique) {
      const cur = appearance.get(sid) || { appearances: 0, comparisons: 0 };
      cur.appearances += 1;
      cur.comparisons += 1;
      appearance.set(sid, cur);
    }
  }
  // Clear day then upsert known sprites only (FK-safe).
  await db.query(`DELETE FROM comparison_sprite_diff_stats WHERE metric_date = $1::date`, [day]);
  const knownSprites = await db.query(
    `SELECT id FROM sprites WHERE id = ANY($1::text[])`,
    [[...appearance.keys()]]
  );
  const knownSet = new Set(knownSprites.rows.map((r) => String(r.id)));
  for (const [spriteId, counts] of appearance.entries()) {
    if (!knownSet.has(spriteId)) continue;
    await db.query(
      `INSERT INTO comparison_sprite_diff_stats (
         metric_date, sprite_id, difference_appearance_count, comparison_count,
         sample_size, catalogue_version, calculated_at
       ) VALUES ($1::date, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (metric_date, sprite_id) DO UPDATE SET
         difference_appearance_count = EXCLUDED.difference_appearance_count,
         comparison_count = EXCLUDED.comparison_count,
         sample_size = EXCLUDED.sample_size,
         catalogue_version = EXCLUDED.catalogue_version,
         calculated_at = NOW()`,
      [day, spriteId, counts.appearances, counts.comparisons, counts.comparisons, catVersion]
    );
  }

  return {
    metricDate: day,
    comparisonsCounted: totals.rows[0]?.comparisons || 0,
    uniquePairCount: totals.rows[0]?.pairs || 0,
    avgComplementarity,
    validPairVersionCount: valid.length,
    differenceSprites: appearance.size,
    catalogueVersion: catVersion
  };
}

/**
 * Étape 51 — transform raw counts into 0–100 percentile scores.
 * Ties share the average rank. Single non-zero value → 100.
 */
function percentileScores(map) {
  const entries = [...map.entries()].map(([k, v]) => [k, Number(v) || 0]);
  const out = new Map();
  if (!entries.length) return out;
  const sorted = entries.slice().sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
  const n = sorted.length;
  if (n === 1) {
    out.set(sorted[0][0], sorted[0][1] > 0 ? 100 : 0);
    return out;
  }
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j += 1;
    const avgRank = (i + j) / 2;
    const score = Math.round((avgRank / (n - 1)) * 10000) / 100;
    for (let k = i; k <= j; k++) out.set(sorted[k][0], score);
    i = j + 1;
  }
  return out;
}

/** @deprecated kept for callers; prefer percentileScores. */
function normalizeSignalMap(map) {
  const scores = percentileScores(map);
  const out = new Map();
  for (const [k, v] of scores.entries()) out.set(k, v / 100);
  return { normalized: out, max: 100 };
}

/**
 * Étape 50–52 — composite interest index (Tendance SpriteDex).
 * Components are percentile scores 0–100, then weighted.
 */
async function calculateSpritePopularityScores(db = pool, {
  metricDate = null,
  windowDays = 7,
  weights = INTEREST_SCORE_WEIGHTS,
  catalogueVersion = null
} = {}) {
  await ensureComparisonStatsTables(db);
  try {
    await db.query(
      `ALTER TABLE sprite_popularity_scores
         ADD COLUMN IF NOT EXISTS catalogue_version VARCHAR(80)`
    );
  } catch (_) { /* ignore */ }

  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const days = Math.max(1, Math.min(90, Number(windowDays) || 7));

  let catVersion = catalogueVersion;
  if (!catVersion) {
    try {
      catVersion = (await require("./sprite-graph-catalogue").resolveCatalogueContext(db))
        .catalogueVersion;
    } catch (_) {
      catVersion = null;
    }
  }

  const priority = await db.query(
    `SELECT COALESCE(sv.sprite_id, ge.sprite_id) AS sprite_id, COUNT(*)::int AS n
     FROM graph_events ge
     LEFT JOIN sprite_variants sv ON sv.id = ge.variant_id
     WHERE ge.event_type = 'collection.priority_added'
       AND ge.occurred_at >= $1::date::timestamptz - ($2::int - 1) * INTERVAL '1 day'
       AND ge.occurred_at < ($1::date + 1)::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c WHERE c.cancelled_event_id = ge.id
       )
     GROUP BY 1`,
    [day, days]
  );
  const added = await db.query(
    `SELECT COALESCE(sv.sprite_id, ge.sprite_id) AS sprite_id, COUNT(*)::int AS n
     FROM graph_events ge
     LEFT JOIN sprite_variants sv ON sv.id = ge.variant_id
     WHERE ge.event_type = 'collection.sprite_added'
       AND ge.occurred_at >= $1::date::timestamptz - ($2::int - 1) * INTERVAL '1 day'
       AND ge.occurred_at < ($1::date + 1)::timestamptz
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c WHERE c.cancelled_event_id = ge.id
       )
     GROUP BY 1`,
    [day, days]
  );
  const diffs = await db.query(
    `SELECT sprite_id, SUM(difference_appearance_count)::int AS n
     FROM comparison_sprite_diff_stats
     WHERE metric_date >= ($1::date - ($2::int - 1))
       AND metric_date <= $1::date
     GROUP BY sprite_id`,
    [day, days]
  );
  const notifs = await db.query(
    `SELECT COALESCE(sv.sprite_id, n.entity_id) AS sprite_id, COUNT(*)::int AS n
     FROM graph_events ge
     JOIN notifications n ON n.id = ge.notification_id
     LEFT JOIN sprite_variants sv ON sv.id = n.entity_id
     WHERE ge.event_type = 'notification.opened'
       AND ge.occurred_at >= $1::date::timestamptz - ($2::int - 1) * INTERVAL '1 day'
       AND ge.occurred_at < ($1::date + 1)::timestamptz
       AND n.type IN ('priority_variant_available', 'friend_acquired_missing_variant', 'wanted_event_ending_soon')
       AND NOT EXISTS (
         SELECT 1 FROM graph_event_corrections c WHERE c.cancelled_event_id = ge.id
       )
     GROUP BY 1`,
    [day, days]
  );

  const toMap = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!r.sprite_id) continue;
      m.set(String(r.sprite_id), Number(r.n) || 0);
    }
    return m;
  };
  const priorityMap = toMap(priority.rows);
  const addedMap = toMap(added.rows);
  const diffMap = toMap(diffs.rows);
  const notifMap = toMap(notifs.rows);

  const sprites = new Set([
    ...priorityMap.keys(),
    ...addedMap.keys(),
    ...diffMap.keys(),
    ...notifMap.keys()
  ]);

  // Étape 51 — each component is a 0–100 percentile.
  const priorityScore = percentileScores(priorityMap);
  const collectionScore = percentileScores(addedMap);
  const comparisonScore = percentileScores(diffMap);
  const notificationScore = percentileScores(notifMap);

  await db.query(`DELETE FROM sprite_popularity_scores WHERE metric_date = $1::date`, [day]);

  const known = await db.query(
    `SELECT id FROM sprites WHERE id = ANY($1::text[])`,
    [[...sprites]]
  );
  const knownSet = new Set(known.rows.map((r) => String(r.id)));

  let upserted = 0;
  for (const spriteId of sprites) {
    if (!knownSet.has(spriteId)) continue;
    const components = {
      priorityRaw: priorityMap.get(spriteId) || 0,
      collectionAddRaw: addedMap.get(spriteId) || 0,
      comparisonDiffRaw: diffMap.get(spriteId) || 0,
      notificationRaw: notifMap.get(spriteId) || 0,
      priorityScore: priorityScore.get(spriteId) || 0,
      collectionScore: collectionScore.get(spriteId) || 0,
      comparisonScore: comparisonScore.get(spriteId) || 0,
      notificationScore: notificationScore.get(spriteId) || 0
    };
    // Étape 51 — weighted sum of 0–100 percentile components.
    const interestScore = Math.round(
      (
        (components.priorityScore * weights.priority) +
        (components.collectionScore * weights.collectionAdd) +
        (components.comparisonScore * weights.comparisonDiff) +
        (components.notificationScore * weights.notification)
      ) * 100
    ) / 100;
    const sampleSize = components.priorityRaw
      + components.collectionAddRaw
      + components.comparisonDiffRaw
      + components.notificationRaw;

    const formulaVersion = require("./sprite-graph-formula").interestFormulaVersion();
    try {
      await require("./sprite-graph-formula").ensureFormulaVersionColumns(db);
    } catch (_) { /* ignore */ }
    await db.query(
      `INSERT INTO sprite_popularity_scores (
         metric_date, sprite_id, score, sample_size, components, weights,
         catalogue_version, formula_version, calculated_at
       ) VALUES ($1::date, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, NOW())`,
      [
        day,
        spriteId,
        interestScore,
        sampleSize,
        JSON.stringify({
          ...components,
          label: INTEREST_INDEX_LABEL,
          trendLabel: INTEREST_TREND_LABEL,
          catalogueVersion: catVersion,
          formulaVersion
        }),
        JSON.stringify(weights),
        catVersion,
        formulaVersion
      ]
    );
    upserted += 1;
  }

  return {
    metricDate: day,
    windowDays: days,
    weights,
    sprites: upserted,
    label: INTEREST_TREND_LABEL,
    indexLabel: INTEREST_INDEX_LABEL,
    catalogueVersion: catVersion,
    formula:
      "interestScore = priorityScore×0.40 + collectionScore×0.30 + comparisonScore×0.20 + notificationScore×0.10 (each component = percentile 0–100)"
  };
}

async function getMostComparedSprites(db = pool, {
  metricDate = null,
  limit = 20,
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  await ensureComparisonStatsTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const result = await db.query(
    `SELECT sprite_id, difference_appearance_count, comparison_count, sample_size
     FROM comparison_sprite_diff_stats
     WHERE metric_date = $1::date
     ORDER BY difference_appearance_count DESC, sprite_id ASC
     LIMIT $2`,
    [day, Math.max(1, Math.min(100, Number(limit) || 20))]
  );
  const items = [];
  for (const row of result.rows) {
    if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
      const gated = applyPublicAnonymizationGate({
        uniqueUserCount: row.sample_size,
        payload: row
      });
      if (!gated.ok) continue;
    }
    items.push({
      spriteId: row.sprite_id,
      differenceAppearanceCount: row.difference_appearance_count,
      comparisonCount: row.comparison_count,
      sampleSize: row.sample_size,
      // Étape 47 — never call these "views".
      metric: "difference_appearance"
    });
  }
  return {
    metricDate: day,
    socialComparisonsLevel: "user_pair_comparisons",
    spriteLevel: "difference_appearances_not_views",
    items
  };
}

async function getAverageComplementarity(db = pool, {
  metricDate = null,
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  await ensureComparisonStatsTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const daily = await db.query(
    `SELECT * FROM comparison_daily_stats WHERE metric_date = $1::date`,
    [day]
  );
  const bands = await db.query(
    `SELECT * FROM comparison_complementarity_by_band
     WHERE metric_date = $1::date ORDER BY collection_band`,
    [day]
  );
  const row = daily.rows[0];
  if (!row) return null;

  if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
    const gated = applyPublicAnonymizationGate({
      uniqueUserCount: row.valid_pair_version_count || row.unique_pair_count,
      payload: row
    });
    if (!gated.ok) {
      return {
        metricDate: day,
        insufficient: true,
        message: gated.message || INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
        minUsers: PUBLIC_ANONYMIZATION_MIN_USERS
      };
    }
  }

  return {
    metricDate: day,
    comparisonsCounted: row.comparisons_counted,
    uniquePairCount: row.unique_pair_count,
    avgComplementarity: row.avg_complementarity != null ? Number(row.avg_complementarity) : null,
    validPairVersionCount: row.valid_pair_version_count,
    byCollectionBand: bands.rows.map((b) => ({
      band: b.collection_band,
      avgComplementarity: b.avg_complementarity != null ? Number(b.avg_complementarity) : null,
      uniquePairVersionCount: b.unique_pair_version_count,
      sampleSize: b.sample_size
    })),
    method: "latest_per_pairKey_and_catalogueVersion"
  };
}

async function getTopPopularSprites(db = pool, {
  metricDate = null,
  limit = 20,
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  await ensureComparisonStatsTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const result = await db.query(
    `SELECT sprite_id, score, sample_size, components, weights
     FROM sprite_popularity_scores
     WHERE metric_date = $1::date
     ORDER BY score DESC, sprite_id ASC
     LIMIT $2`,
    [day, Math.max(1, Math.min(100, Number(limit) || 20))]
  );
  const items = [];
  for (const row of result.rows) {
    if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
      const gated = applyPublicAnonymizationGate({
        uniqueUserCount: row.sample_size,
        payload: row
      });
      if (!gated.ok) continue;
    }
    items.push({
      spriteId: row.sprite_id,
      interestScore: Number(row.score),
      score: Number(row.score),
      sampleSize: row.sample_size,
      components: row.components,
      weights: row.weights,
      label: INTEREST_TREND_LABEL,
      indexLabel: INTEREST_INDEX_LABEL
    });
  }
  return {
    metricDate: day,
    // Étape 52 — product labels for SpriteDex users only (not Fortnite-wide).
    label: INTEREST_TREND_LABEL,
    indexLabel: INTEREST_INDEX_LABEL,
    weights: INTEREST_SCORE_WEIGHTS,
    formulaDocumentation:
      "interestScore = priorityScore×0.40 + collectionScore×0.30 + comparisonScore×0.20 + notificationScore×0.10; each *Score is a 0–100 percentile among Sprites that day. Weights: GRAPH_POPULARITY_WEIGHTS. Not an official Fortnite popularity metric.",
    items
  };
}

async function calculateComparisonAndPopularityStats(db = pool, opts = {}) {
  const { includeTrends = true } = opts;
  const comparison = await calculateComparisonDailyStats(db, opts);
  const popularity = await calculateSpritePopularityScores(db, opts);
  let trends = null;
  if (includeTrends) {
    try {
      trends = await require("./sprite-graph-trends").calculateInterestTrendsAndSquadSnapshots(db, opts);
    } catch (err) {
      console.error("[sprite-graph-comparison-stats] trends failed:", err.message);
    }
  }
  return { comparison, popularity, trends };
}

module.exports = {
  POPULARITY_SCORE_WEIGHTS,
  INTEREST_SCORE_WEIGHTS,
  INTEREST_INDEX_LABEL,
  INTEREST_TREND_LABEL,
  COLLECTION_BANDS,
  resolveCollectionBand,
  percentileScores,
  ensureComparisonStatsTables,
  calculateComparisonDailyStats,
  calculateSpritePopularityScores,
  calculateComparisonAndPopularityStats,
  getMostComparedSprites,
  getAverageComplementarity,
  getTopPopularSprites
};
