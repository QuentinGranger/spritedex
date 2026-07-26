"use strict";

// ── Sprite Graph public payloads (Étapes 76–80) ──────────────────────────────

const { pool } = require("./db");
const {
  GRAPH_DATA_LEVELS,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  applyPublicAnonymizationGate
} = require("./sprite-graph-privacy");
const {
  ensureCommunityStatsTables,
  getCommunityVariantOwnership,
  getMostSoughtVariants,
  formatSampleSizeDisplay
} = require("./sprite-graph-community");
const {
  ensureTrendTables,
  getVariantInterestSeries,
  TREND_LABELS_FR,
  TREND_INSUFFICIENT_MESSAGE
} = require("./sprite-graph-trends");
const {
  getMostComparedSprites,
  getTopPopularSprites
} = require("./sprite-graph-comparison-stats");

const COMMUNITY_SOURCE_DISCLAIMER = "Données issues de la communauté SpriteDex";

/** Étape 80 — min distinct dates before showing a history chart / series. */
const MIN_HISTORY_POINTS = (() => {
  const n = Number(process.env.GRAPH_MIN_HISTORY_POINTS);
  return Number.isFinite(n) && n >= 2 ? Math.floor(n) : 2;
})();

function toIsoDate(value) {
  if (value == null) return null;
  // node-pg DATE → JS Date at local midnight; use local Y-M-D (not UTC).
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

function formatRateFr(rate, { digits = 1 } = {}) {
  if (rate == null || !Number.isFinite(Number(rate))) return null;
  const n = Number(rate);
  const rounded = Math.round(n * (10 ** digits)) / (10 ** digits);
  return String(rounded).replace(".", ",");
}

/**
 * Étape 76 — standardized community variant response.
 */
async function getStandardCommunityVariantResponse(db = pool, variantId, {
  metricDate = null,
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  await ensureCommunityStatsTables(db);
  await ensureTrendTables(db);

  const ownership = await getCommunityVariantOwnership(db, variantId, { metricDate, level });
  if (!ownership) {
    return {
      variantId: String(variantId),
      asOf: toIsoDate(metricDate) || new Date().toISOString().slice(0, 10),
      catalogueVersion: null,
      insufficient: true,
      message: INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
      disclaimer: COMMUNITY_SOURCE_DISCLAIMER
    };
  }
  if (ownership.insufficient) {
    return {
      variantId: String(variantId),
      asOf: toIsoDate(ownership.metricDate) || toIsoDate(metricDate),
      catalogueVersion: ownership.catalogueVersion || null,
      insufficient: true,
      message: ownership.message || INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
      dataQuality: {
        minimumSampleReached: false,
        sampleSize: ownership.sampleSize || 0,
        lastCalculatedAt: null
      },
      disclaimer: COMMUNITY_SOURCE_DISCLAIMER,
      // Étape 77 — public copy helpers (even when gated).
      publicDisplay: null
    };
  }

  const interest = await getVariantInterestSeries(db, variantId, {
    days: 30,
    level
  });

  const day = toIsoDate(ownership.metricDate)
    || toIsoDate(metricDate)
    || new Date().toISOString().slice(0, 10);

  const calcRes = await db.query(
    `SELECT calculated_at FROM community_variant_stats
     WHERE metric_date = $1::date AND variant_id = $2`,
    [day, String(variantId)]
  );
  const lastCalculatedAt = calcRes.rows[0]?.calculated_at
    ? new Date(calcRes.rows[0].calculated_at).toISOString()
    : null;

  const interestScore = interest && !interest.insufficient
    ? interest.latest?.interestScore
    : null;
  const trend = interest && !interest.insufficient ? interest.latest?.trend : null;
  const trendLabel = interest && !interest.insufficient
    ? interest.latest?.trendLabel
    : null;

  const ownershipRate = ownership.ownershipRate;
  const priorityRate = ownership.priorityRate;
  const sampleSize = ownership.sampleSize;

  // Étape 77 / 81 — concise public strings (trend gated).
  const publicDisplay = {
    ownership: ownershipRate != null
      ? `Possession communautaire : ${formatRateFr(ownershipRate, { digits: 1 })} %`
      : null,
    priority: priorityRate != null
      ? `Prioritaire chez ${formatRateFr(priorityRate, { digits: 0 })} % des collectionneurs auxquels elle manque`
      : null,
    trend: trendLabel
      ? `Tendance : ${trendLabel}`
      : (interest && !interest.insufficient ? TREND_INSUFFICIENT_MESSAGE : null),
    sample: formatSampleSizeDisplay(sampleSize),
    disclaimer: COMMUNITY_SOURCE_DISCLAIMER
  };

  // Étape 79 — official rarity vs community ownership (never mixed).
  const meta = await db.query(
    `SELECT v.id AS variant_id, v.name AS variant_name, v.rarity AS variant_rarity,
            s.id AS sprite_id, s.name AS sprite_name, s.rarity AS sprite_rarity
     FROM sprite_variants v
     JOIN sprites s ON s.id = v.sprite_id
     WHERE v.id = $1`,
    [String(variantId)]
  );
  const m = meta.rows[0] || null;
  const officialRarity = (m && (m.variant_rarity || m.sprite_rarity)) || null;

  return {
    variantId: String(variantId),
    asOf: day,
    catalogueVersion: ownership.catalogueVersion || null,
    official: {
      rarity: officialRarity,
      rarityLabel: officialRarity ? `Rareté officielle : ${officialRarity}` : null,
      spriteId: m?.sprite_id || null,
      spriteName: m?.sprite_name || null,
      variantName: m?.variant_name || null
    },
    community: {
      eligibleCollectionCount: sampleSize,
      ownerCount: ownership.ownerUserCount,
      ownershipRate,
      missingCount: ownership.missingUserCount,
      priorityCount: ownership.priorityUserCount,
      priorityRateAmongMissing: priorityRate,
      priorityAdds7d: ownership.priorityAdded7d,
      priorityAdds30d: ownership.priorityAdded30d,
      interestScore,
      trend,
      trendLabel,
      trendMessage: interest && !interest.insufficient && !trend
        ? (interest.latest?.trendMessage || TREND_INSUFFICIENT_MESSAGE)
        : null
    },
    trendEligibility: interest && !interest.insufficient
      ? interest.trendEligibility
      : null,
    dataQuality: {
      minimumSampleReached: sampleSize >= PUBLIC_ANONYMIZATION_MIN_USERS,
      sampleSize,
      lastCalculatedAt
    },
    publicDisplay,
    raritySeparation: {
      officialRarity,
      spritedexOwnershipRate: ownershipRate,
      ownershipLabel: ownershipRate != null
        ? `Taux de possession SpriteDex : ${formatRateFr(ownershipRate, { digits: 1 })} %`
        : null,
      note: "La rareté officielle et le taux de possession SpriteDex sont des indicateurs distincts."
    },
    disclaimer: COMMUNITY_SOURCE_DISCLAIMER
  };
}

/**
 * Étape 80 — ownership / priority history for a variant fiche.
 */
async function getVariantCommunityHistory(db = pool, variantId, {
  days = 30,
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  await ensureCommunityStatsTables(db);
  await ensureTrendTables(db);
  const id = String(variantId);
  const windowDays = Math.max(2, Math.min(365, Number(days) || 30));

  const rows = await db.query(
    `SELECT metric_date, ownership_rate, priority_user_count, sample_size,
            catalogue_version, calculated_at
     FROM community_variant_stats
     WHERE variant_id = $1
     ORDER BY metric_date DESC
     LIMIT $2`,
    [id, windowDays]
  );

  if (!rows.rows.length) {
    return {
      variantId: id,
      insufficient: true,
      message: INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
      showHistory: false,
      disclaimer: COMMUNITY_SOURCE_DISCLAIMER
    };
  }

  const latest = rows.rows[0];
  if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
    const gated = applyPublicAnonymizationGate({
      uniqueUserCount: latest.sample_size,
      payload: latest
    });
    if (!gated.ok) {
      return {
        variantId: id,
        insufficient: true,
        message: gated.message || INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
        showHistory: false,
        disclaimer: COMMUNITY_SOURCE_DISCLAIMER
      };
    }
  }

  const series = rows.rows.map((r) => ({
    date: toIsoDate(r.metric_date),
    ownershipRate: r.ownership_rate != null ? Number(r.ownership_rate) : null,
    priorityCount: r.priority_user_count || 0,
    sampleSize: r.sample_size || 0,
    catalogueVersion: r.catalogue_version || null
  })).reverse().filter((r) => r.date);

  const showHistory = series.length >= MIN_HISTORY_POINTS;
  const first = series[0];
  const last = series[series.length - 1];
  const ownershipDelta = (
    first && last
    && first.ownershipRate != null
    && last.ownershipRate != null
  )
    ? Math.round((last.ownershipRate - first.ownershipRate) * 100) / 100
    : null;

  // Priority evolution over ~7 days window within series.
  const lastDate = last ? new Date(`${last.date}T00:00:00.000Z`) : null;
  let priority7dAgo = null;
  if (lastDate) {
    const target = new Date(lastDate);
    target.setUTCDate(target.getUTCDate() - 7);
    const key = target.toISOString().slice(0, 10);
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].date <= key) {
        priority7dAgo = series[i].priorityCount;
        break;
      }
    }
    if (priority7dAgo == null && series.length) {
      priority7dAgo = series[0].priorityCount;
    }
  }

  const priorityNow = last ? last.priorityCount : null;
  const priorityDelta = (priorityNow != null && priority7dAgo != null)
    ? priorityNow - priority7dAgo
    : null;

  return {
    variantId: id,
    showHistory,
    minHistoryPoints: MIN_HISTORY_POINTS,
    series: showHistory ? series : [],
    ownership: showHistory ? {
      from: first ? { date: first.date, rate: first.ownershipRate } : null,
      to: last ? { date: last.date, rate: last.ownershipRate } : null,
      evolutionPoints: ownershipDelta,
      evolutionLabel: ownershipDelta != null
        ? `Évolution : ${ownershipDelta >= 0 ? "+" : ""}${formatRateFr(ownershipDelta, { digits: 1 })} points`
        : null
    } : null,
    priorities: showHistory && priorityNow != null && priority7dAgo != null ? {
      from: priority7dAgo,
      to: priorityNow,
      label: `${priority7dAgo} priorités → ${priorityNow} priorités en 7 jours`
    } : null,
    disclaimer: COMMUNITY_SOURCE_DISCLAIMER
  };
}

async function enrichVariantRows(db, items, idKey = "variantId") {
  const ids = items.map((i) => i[idKey]).filter(Boolean);
  if (!ids.length) return items;
  const meta = await db.query(
    `SELECT v.id, v.name AS variant_name, COALESCE(v.rarity, s.rarity) AS official_rarity,
            s.id AS sprite_id, s.name AS sprite_name
     FROM sprite_variants v
     JOIN sprites s ON s.id = v.sprite_id
     WHERE v.id = ANY($1::text[])`,
    [ids]
  );
  const map = new Map(meta.rows.map((r) => [String(r.id), r]));
  return items.map((item) => {
    const m = map.get(String(item[idKey]));
    return {
      ...item,
      spriteId: m?.sprite_id || item.spriteId || null,
      spriteName: m?.sprite_name || null,
      variantName: m?.variant_name || null,
      officialRarity: m?.official_rarity || null
    };
  });
}

/**
 * Étape 78 — Tendances board (SpriteDex community only).
 */
async function getCommunityTrendsBoard(db = pool, {
  metricDate = null,
  limit = 10,
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  await ensureCommunityStatsTables(db);
  await ensureTrendTables(db);
  const day = metricDate
    ? String(metricDate).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const lim = Math.max(1, Math.min(50, Number(limit) || 10));

  // Do not render a board full of empty rankings while the community is still
  // below its privacy threshold. Internal admin callers may still inspect the
  // aggregates through their dedicated level.
  if (level === GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC) {
    const readiness = await db.query(
      `SELECT COALESCE(MAX(sample_size), 0)::int AS max_sample_size
       FROM community_variant_stats
       WHERE metric_date = $1::date`,
      [day]
    );
    const maxSampleSize = readiness.rows[0]?.max_sample_size || 0;
    const gated = applyPublicAnonymizationGate({ uniqueUserCount: maxSampleSize });
    if (!gated.ok) {
      return {
        asOf: day,
        insufficient: true,
        message: gated.message || INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
        dataQuality: {
          minimumSampleReached: false,
          maxSampleSize,
          minimumRequired: PUBLIC_ANONYMIZATION_MIN_USERS
        },
        disclaimer: COMMUNITY_SOURCE_DISCLAIMER,
        label: "Tendances SpriteDex",
        sections: {}
      };
    }
  }

  const mostOwned = await db.query(
    `SELECT variant_id, ownership_rate, sample_size, owner_user_count
     FROM community_variant_stats
     WHERE metric_date = $1::date
       AND ownership_rate IS NOT NULL
       AND sample_size >= $2
     ORDER BY ownership_rate DESC, sample_size DESC, variant_id ASC
     LIMIT $3`,
    [day, PUBLIC_ANONYMIZATION_MIN_USERS, lim]
  );

  const rarest = await db.query(
    `SELECT variant_id, ownership_rate, sample_size, owner_user_count
     FROM community_variant_stats
     WHERE metric_date = $1::date
       AND ownership_rate IS NOT NULL
       AND sample_size >= $2
     ORDER BY ownership_rate ASC, sample_size DESC, variant_id ASC
     LIMIT $3`,
    [day, PUBLIC_ANONYMIZATION_MIN_USERS, lim]
  );

  const priorityAdds = await db.query(
    `SELECT variant_id, priority_added_7d, sample_size, priority_user_count
     FROM community_variant_stats
     WHERE metric_date = $1::date
       AND priority_added_7d > 0
       AND sample_size >= $2
     ORDER BY priority_added_7d DESC, sample_size DESC, variant_id ASC
     LIMIT $3`,
    [day, PUBLIC_ANONYMIZATION_MIN_USERS, lim]
  );

  const risers = await db.query(
    `SELECT variant_id, interest_score, change_7d, trend, sample_size
     FROM variant_interest_daily
     WHERE metric_date = $1::date
       AND trend IN ('strongly_rising', 'rising')
       AND sample_size >= $2
     ORDER BY change_7d DESC NULLS LAST, interest_score DESC NULLS LAST, variant_id ASC
     LIMIT $3`,
    [day, PUBLIC_ANONYMIZATION_MIN_USERS, lim]
  );

  const sought = await getMostSoughtVariants(db, { metricDate: day, limit: lim, level });
  const compared = await getMostComparedSprites(db, { metricDate: day, limit: lim, level });
  const popular = await getTopPopularSprites(db, { metricDate: day, limit: lim, level });

  const mapOwned = await enrichVariantRows(
    db,
    mostOwned.rows.map((r) => ({
      variantId: r.variant_id,
      ownershipRate: Number(r.ownership_rate),
      sampleSize: r.sample_size,
      ownerCount: r.owner_user_count
    }))
  );
  const mapRare = await enrichVariantRows(
    db,
    rarest.rows.map((r) => ({
      variantId: r.variant_id,
      ownershipRate: Number(r.ownership_rate),
      sampleSize: r.sample_size,
      ownerCount: r.owner_user_count
    }))
  );
  const mapPriorityAdds = await enrichVariantRows(
    db,
    priorityAdds.rows.map((r) => ({
      variantId: r.variant_id,
      priorityAdds7d: r.priority_added_7d,
      priorityCount: r.priority_user_count,
      sampleSize: r.sample_size
    }))
  );
  const mapRisers = await enrichVariantRows(
    db,
    risers.rows.map((r) => ({
      variantId: r.variant_id,
      interestScore: r.interest_score != null ? Number(r.interest_score) : null,
      change7d: r.change_7d != null ? Number(r.change_7d) : null,
      trend: r.trend,
      trendLabel: TREND_LABELS_FR[r.trend] || r.trend,
      sampleSize: r.sample_size
    }))
  );

  const soughtItems = await enrichVariantRows(db, sought.items || []);

  // Compared items are sprite-level — attach sprite meta.
  const comparedItems = compared.items || [];
  const spriteIds = comparedItems.map((i) => i.spriteId).filter(Boolean);
  let spriteMeta = new Map();
  if (spriteIds.length) {
    const sm = await db.query(
      `SELECT id, name, rarity FROM sprites WHERE id = ANY($1::text[])`,
      [spriteIds]
    );
    spriteMeta = new Map(sm.rows.map((r) => [String(r.id), r]));
  }
  const comparedEnriched = comparedItems.map((i) => {
    const s = spriteMeta.get(String(i.spriteId));
    return {
      ...i,
      spriteName: s?.name || null,
      officialRarity: s?.rarity || null
    };
  });

  return {
    asOf: day,
    disclaimer: COMMUNITY_SOURCE_DISCLAIMER,
    label: "Tendances SpriteDex",
    sections: {
      mostOwned: {
        title: "Les plus possédés",
        items: mapOwned
      },
      rarestInSpritedex: {
        title: "Les plus rares dans SpriteDex",
        note: "Rareté communautaire (taux de possession), distincte de la rareté officielle",
        items: mapRare
      },
      mostSought: {
        title: "Les plus recherchés",
        items: soughtItems
      },
      mostPriorityAdds: {
        title: "Les plus souvent ajoutés en priorité",
        items: mapPriorityAdds
      },
      strongestRisers: {
        title: "Les plus fortes progressions",
        items: mapRisers
      },
      mostCompared: {
        title: "Les plus comparés",
        items: comparedEnriched
      },
      interestLeaders: {
        title: "Indice d'intérêt communautaire",
        items: (popular.items || []).map((i) => ({
          spriteId: i.spriteId,
          interestScore: i.interestScore,
          sampleSize: i.sampleSize
        }))
      }
    }
  };
}

/**
 * Étape 82 — secondary community lines for a personal comparison.
 * Never overshadow the personal compare result.
 */
async function getCompareCommunityInsights(db = pool, {
  items = [],
  aName = "Joueur A",
  bName = "Joueur B",
  level = GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC
} = {}) {
  const insights = [];
  const limited = (Array.isArray(items) ? items : []).slice(0, 12);

  for (const item of limited) {
    const variantId = item.variantId || item.id;
    if (!variantId) continue;
    const relation = item.relation || item.group || null;
    // relation: bothMissing | onlyA | onlyB
    const std = await getStandardCommunityVariantResponse(db, variantId, { level });
    if (!std || std.insufficient || !std.community) continue;

    const name = [
      std.official?.spriteName,
      std.official?.variantName && std.official.variantName !== "Base"
        ? std.official.variantName
        : null
    ].filter(Boolean).join(" ") || String(variantId);

    let personalLine = null;
    if (relation === "bothMissing") {
      personalLine = `${name} manque à ${aName} et ${bName}.`;
    } else if (relation === "onlyA") {
      personalLine = `${name} est possédée par ${aName} mais manque à ${bName}.`;
    } else if (relation === "onlyB") {
      personalLine = `${name} est possédée par ${bName} mais manque à ${aName}.`;
    }

    const ownershipLine = std.community.ownershipRate != null
      ? `Seulement ${formatRateFr(std.community.ownershipRate, { digits: 1 })} % de la communauté SpriteDex la possède.`
      : null;
    const priorityLine = std.community.priorityRateAmongMissing != null
      ? `Cette variante est prioritaire chez ${formatRateFr(std.community.priorityRateAmongMissing, { digits: 0 })} % des utilisateurs auxquels elle manque.`
      : null;

    const communityLine = relation === "bothMissing"
      ? ownershipLine
      : (priorityLine || ownershipLine);

    if (!personalLine && !communityLine) continue;
    insights.push({
      variantId: String(variantId),
      relation,
      personalLine,
      communityLine,
      // Étape 82 — explicitly secondary.
      priority: "secondary",
      ownershipRate: std.community.ownershipRate,
      priorityRateAmongMissing: std.community.priorityRateAmongMissing
    });
  }

  return {
    insights,
    disclaimer: COMMUNITY_SOURCE_DISCLAIMER,
    note: "Ces données restent secondaires par rapport à la comparaison personnelle."
  };
}

module.exports = {
  COMMUNITY_SOURCE_DISCLAIMER,
  MIN_HISTORY_POINTS,
  formatRateFr,
  getStandardCommunityVariantResponse,
  getVariantCommunityHistory,
  getCommunityTrendsBoard,
  getCompareCommunityInsights
};
