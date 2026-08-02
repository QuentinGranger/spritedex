const { pool, round2 } = require("./shared");
const { ensureSquadDailyStatsTables } = require("./schema");

/** Étape 84 — anonymous peer buckets (no ranking). */
function resolveSquadSizeBand(memberCount) {
  const n = Math.max(0, Math.floor(Number(memberCount) || 0));
  if (n <= 2) return { id: "2", label: "Squads de 2 membres" };
  if (n <= 3) return { id: "3", label: "Squads de 3 membres" };
  if (n <= 6) return { id: "4_6", label: "Squads de 4 à 6 membres" };
  if (n <= 10) return { id: "7_10", label: "Squads de 7 à 10 membres" };
  return { id: "11_plus", label: "Squads de 11 membres ou plus" };
}

module.exports = { resolveSquadSizeBand, resolveCompletionBand, getSquadCommunityContext };

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
