#!/usr/bin/env node
// Thin orchestrator. All application logic lives in ./server/*.
require("dotenv").config();

const { pool } = require("./server/db");
const { app, server } = require("./server/core");
const secLog = require("./security-logger");
const eventIdempotency = require("./server/event-idempotency");
const acquisition = require("./server/notification-acquisition");
const squadCompletion = require("./server/notification-squad-completion");
const eventEndingScheduler = require("./server/notification-event-ending-scheduler");
const deliveryQueue = require("./server/notification-delivery-queue");

// Load helpers and route registrations (order preserved from the original file).
require("./server/ws");
require("./server/auth");
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
require("./server/routes-goals");
require("./server/routes-sprite-graph");
require("./server/routes-sprite-graph-admin");
require("./server/notification-events");
require("./server/recommendations");
require("./server/news");
require("./server/routes-spa");

// 404 + global error handlers must be registered after every route.
require("./server/tail");

// Schema bootstrap, reference-data seed, and periodic maintenance jobs.
const { ensureSquadTables, ensureReferenceDataSeeded, purgeDeletedAccounts } = require("./server/schema");
const { startNewsCron } = require("./server/news");

ensureSquadTables()
  .then(ensureReferenceDataSeeded)
  .then(() => {
    startNewsCron();
    acquisition.startAcquisitionBatchSweep();
    squadCompletion.startSquadCompletionBatchSweep();
    eventEndingScheduler.startWantedEventEndingScheduler();
    deliveryQueue.startDeliveryQueueWorker(pool);
    require("./server/notification-digest").startDigestSweep(pool);
    require("./server/passport-summary").startPassportRecalcWorker(pool);
    require("./server/sprite-graph-outbox").startGraphOutboxWorker(pool);
    require("./server/sprite-graph-community").startCommunityStatsDailyJob(pool);
    purgeDeletedAccounts();
    secLog.purgeOldSecurityLogs(pool);
    eventIdempotency.purgeProcessedEvents(pool);
    setInterval(() => {
      purgeDeletedAccounts();
      secLog.purgeOldSecurityLogs(pool);
      eventIdempotency.purgeProcessedEvents(pool);
    }, 24 * 60 * 60 * 1000);
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`SPRITNEX API + WebSocket running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Fatal: server bootstrap failed:", err);
    process.exit(1);
  });
