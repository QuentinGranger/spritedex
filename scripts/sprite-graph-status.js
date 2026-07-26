"use strict";

// Internal-only Sprite Graph status command. It deliberately queries aggregates
// and operational counters only: it never prints raw graph events or personal
// data. Run with a DATABASE_URL that can reach the intended database.

require("dotenv").config();

const { pool } = require("../server/db");
const { getSpriteGraphControlBoard } = require("../server/sprite-graph-metrics");
const { evaluateGraphV1Readiness } = require("../server/sprite-graph-v1-validation");

const args = process.argv.slice(2);
const json = args.includes("--json");
const live = args.includes("--live");

function printHelp() {
  console.log(`Sprite Graph — contrôle interne

Usage:
  npm run sprite-graph:status
  npm run sprite-graph:status -- --live
  npm run sprite-graph:status -- --json --live

Options:
  --live  Vérifie aussi les signaux observés dans la base (types d'événements,
          colonne de version du catalogue).
  --json  Produit le rapport brut JSON, pratique pour archivage ou scripts.

DATABASE_URL doit cibler la base à examiner. La commande n'affiche jamais
d'événements bruts ni de données personnelles.`);
}

function status(ok) {
  return ok ? "OK" : "À vérifier";
}

function iso(value) {
  return value ? new Date(value).toLocaleString("fr-FR") : "Jamais";
}

function printReport({ readiness, board }) {
  const tech = board.technical;
  console.log("\nSPRITE GRAPH — CONTRÔLE INTERNE");
  console.log("=".repeat(34));
  console.log(`V1 : ${status(readiness.ready)}`);
  console.log(`Événements : ${tech.table.rowCount} au total · ${board.eventsLast24h} sur 24 h`);
  console.log(`Débit : ${tech.eventsPerMinute}/min · délai worker : ${tech.workerLagSeconds}s`);
  console.log(`Outbox : ${tech.pendingOutbox} en attente · ${tech.failedOutbox} en échec`);
  console.log(`Erreurs : ${tech.errorCount} · doublons évités : ${tech.duplicateSkipCount}`);
  console.log(`Dernière consolidation : ${board.lastConsolidation
    ? `${board.lastConsolidation.metricDate} (${iso(board.lastConsolidation.publishedAt)})`
    : "aucune"}`);
  console.log(`Échantillons du jour : ${board.sampleSizes.rows} métriques · min ${board.sampleSizes.min ?? "—"} · moy. ${board.sampleSizes.avg ?? "—"} · max ${board.sampleSizes.max ?? "—"}`);
  console.log(`Métriques publiques suspendues : ${board.publicMetricsSuspended.length ? board.publicMetricsSuspended.join(", ") : "aucune"}`);

  console.log("\nÉvénements sur 24 h :");
  if (!board.eventsByType.length) console.log("  Aucun événement.");
  for (const event of board.eventsByType) console.log(`  ${event.eventType}: ${event.count}`);

  console.log("\nValidation :");
  for (const criterion of readiness.criteria) {
    console.log(`  ${status(criterion.ok)} — ${criterion.label}`);
  }
  for (const probe of readiness.liveProbes) {
    const suffix = probe.error ? ` (${probe.error})` : probe.missing?.length ? ` — absents : ${probe.missing.join(", ")}` : "";
    console.log(`  ${status(probe.ok)} — ${probe.label}${suffix}`);
  }
  console.log();
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL est requis pour consulter le Sprite Graph.");
  }
  const [readiness, board] = await Promise.all([
    evaluateGraphV1Readiness(pool, { includeLiveProbes: live }),
    getSpriteGraphControlBoard(pool)
  ]);
  const report = { generatedAt: new Date().toISOString(), readiness, board };
  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}

main()
  .catch((error) => {
    console.error(`[sprite-graph:status] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
