const {
  pool, resolveCatalogueContext, round2, ratePercent,
  decomposeCatalogueVsAcquisition, toIsoDate
} = require("./shared");
const { ensureSquadDailyStatsTables } = require("./schema");
const { listEligibleSquadIds } = require("./eligibility");

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

  const compare = require("../compare");
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

    const formulaVersion = require("../sprite-graph-formula").squadFormulaVersion();
    try {
      await require("../sprite-graph-formula").ensureFormulaVersionColumns(db);
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

module.exports = { calculateSquadDailyStats };
