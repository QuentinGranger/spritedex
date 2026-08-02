#!/usr/bin/env node
// Thin orchestrator. All application logic lives in ./server/*.
require("dotenv").config();
require("./src/shared/config/register-path-alias").installSourceAlias();

const processRole = (process.env.PROCESS_ROLE || "all").trim().toLowerCase();
if (!["all", "web", "worker"].includes(processRole)) {
  throw new Error("PROCESS_ROLE invalide : utilise all, web ou worker.");
}
const runsWebServer = processRole !== "worker";
const runsBackgroundWorkers = processRole !== "web";
let backgroundWorkersStarted = false;
let workerStandbyRetryScheduled = false;

const { pool } = require("./server/db");
const { app, server } = require("./server/core");
const secLog = require("./security-logger");
const eventIdempotency = require("./server/event-idempotency");
const acquisition = require("./server/notification-acquisition");
const squadCompletion = require("./server/notification-squad-completion");
const eventEndingScheduler = require("./server/notification-event-ending-scheduler");
const deliveryQueue = require("./server/notification-delivery-queue");

// Email gate must be mounted before any module that registers /api routes.
// `server/ws` transitively loads `server/compare`, which registers compare HTTP
// handlers at require-time — so auth + this middleware come first.
require("./server/auth");
const { requireEmailVerified } = require("./server/auth");
app.use("/api", requireEmailVerified);

// Load helpers and route registrations (order preserved from the original file).
require("./server/ws");
require("./server/compare");
require("./server/catalog");
require("./server/routes-sprites");
require("./server/routes-auth");
require("./server/routes-push");
require("./server/routes-profile");
require("./server/routes-passport");
require("./server/routes-friends");
require("./server/routes-collection");
require("./server/routes-squad");
require("./server/routes-squad-invitations");
require("./server/routes-squad-wishlist");
require("./server/routes-goals");
require("./server/routes-admin");
require("./server/routes-admin-operations");
require("./server/routes-sprite-graph");
require("./server/routes-sprite-graph-admin");
require("./server/notification-events");
require("./server/recommendations");
require("./server/news");
require("./server/routes-dev-reload");
require("./server/routes-spa");
require("./server/routes-health");

// 404 + global error handlers must be registered after every route.
require("./server/tail");

// Schema bootstrap, reference-data seed, and periodic maintenance jobs.
const { ensureReferenceDataSeeded, purgeDeletedAccounts, purgeUnverifiedPasswordAccounts } = require("./server/schema");
const { migrate } = require("./server/migrations");
const runtimeHealth = require("./server/runtime-health");
const { installProcessErrorHandlers, purgeOperationalIncidents, reportError } = require("./server/monitoring");
const { startNewsCron } = require("./server/news");

installProcessErrorHandlers({ server });
runtimeHealth.setProcessRole(processRole);

// A dedicated PostgreSQL session holds this advisory lock for the lifetime of
// the active worker process. It makes an accidental second worker replica a
// warm standby instead of running cron jobs twice; queued jobs retain their
// own row-level locking as a second line of defence.
async function acquireWorkerLeadership() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [915_202_601]);
    if (!rows[0]?.acquired) {
      client.release();
      console.log("[workers] standby: another process owns the background-job lock");
      return false;
    }
    client.on("error", (error) => {
      console.error("[workers] worker leadership database connection lost:", error);
      // Without this session we no longer own a reliable singleton lease. Exit
      // so Render restarts a clean worker instead of risking duplicate crons.
      void reportError({ component: "worker_leadership", error }).finally(() => process.exit(1));
    });
    console.log("[workers] leader lock acquired");
    return true;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function startBackgroundWorkers() {
  if (backgroundWorkersStarted) return true;
  if (!await acquireWorkerLeadership()) {
    if (!workerStandbyRetryScheduled) {
      workerStandbyRetryScheduled = true;
      setInterval(() => {
        void startBackgroundWorkers().catch((error) => console.error("[workers] standby retry failed:", error));
      }, 30_000);
    }
    return false;
  }
  backgroundWorkersStarted = true;
  startNewsCron();
  runtimeHealth.markWorkerStarted("news_cron");
  acquisition.startAcquisitionBatchSweep();
  runtimeHealth.markWorkerStarted("notification_acquisition");
  squadCompletion.startSquadCompletionBatchSweep();
  runtimeHealth.markWorkerStarted("squad_completion");
  eventEndingScheduler.startWantedEventEndingScheduler();
  runtimeHealth.markWorkerStarted("wanted_event_scheduler");
  deliveryQueue.startDeliveryQueueWorker(pool);
  runtimeHealth.markWorkerStarted("notification_delivery_queue");
  require("./server/notification-digest").startDigestSweep(pool);
  runtimeHealth.markWorkerStarted("notification_digest");
  require("./server/passport-summary").startPassportRecalcWorker(pool);
  runtimeHealth.markWorkerStarted("passport_recalculation");
  require("./server/sprite-graph-outbox").startGraphOutboxWorker(pool);
  runtimeHealth.markWorkerStarted("sprite_graph_outbox");
  require("./server/sprite-graph-community").startCommunityStatsDailyJob(pool);
  runtimeHealth.markWorkerStarted("sprite_graph_daily");
  purgeDeletedAccounts();
  purgeUnverifiedPasswordAccounts();
  secLog.purgeOldSecurityLogs(pool);
  eventIdempotency.purgeProcessedEvents(pool);
  purgeOperationalIncidents();
  setInterval(() => {
    purgeDeletedAccounts();
    purgeUnverifiedPasswordAccounts();
    secLog.purgeOldSecurityLogs(pool);
    eventIdempotency.purgeProcessedEvents(pool);
    purgeOperationalIncidents();
  }, 24 * 60 * 60 * 1000);
  return true;
}

// Schema changes are applied once through versioned migrations. A PostgreSQL
// advisory lock prevents concurrent Render instances from racing at deploy.
migrate()
  .then((result) => {
    runtimeHealth.markMigrationsComplete();
    return result;
  })
  .then(ensureReferenceDataSeeded)
  .then(async () => {
    runtimeHealth.markReferenceDataComplete();
    if (runsBackgroundWorkers) await startBackgroundWorkers();
    if (!runsWebServer) {
      console.log("SPRITE-INDEX background worker ready");
      return;
    }
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`SPRITE-INDEX API + WebSocket running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    runtimeHealth.markStartupError(err);
    console.error("Fatal: server bootstrap failed:", err);
    void reportError({ component: "startup", error: err }).finally(() => process.exit(1));
  });
