#!/usr/bin/env node
// Thin orchestrator. All application logic lives in ./server/*.
require("dotenv").config();

const { pool } = require("./server/db");
const { app, server } = require("./server/core");
const secLog = require("./security-logger");

// Load helpers and route registrations (order preserved from the original file).
require("./server/ws");
require("./server/auth");
require("./server/compare");
require("./server/catalog");
require("./server/routes-sprites");
require("./server/routes-auth");
require("./server/routes-push");
require("./server/routes-profile");
require("./server/routes-collection");
require("./server/routes-squad");
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
    purgeDeletedAccounts();
    secLog.purgeOldSecurityLogs(pool);
    setInterval(() => {
      purgeDeletedAccounts();
      secLog.purgeOldSecurityLogs(pool);
    }, 24 * 60 * 60 * 1000);
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`SPRITNEX API + WebSocket running on http://localhost:${PORT}`);
    });
  });
