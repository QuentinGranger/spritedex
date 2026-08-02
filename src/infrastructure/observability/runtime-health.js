// Small in-memory view of this process' startup state. It deliberately does
// not replace database checks: readiness combines this state with a live probe.

const startedAt = new Date().toISOString();
const workers = new Set();
let migrationsComplete = false;
let referenceDataComplete = false;
let startupError = null;
let processRole = "all";

function markMigrationsComplete() {
  migrationsComplete = true;
}
function markReferenceDataComplete() {
  referenceDataComplete = true;
}
function markWorkerStarted(name) {
  if (name) workers.add(name);
}
function markStartupError(error) {
  startupError = error?.message || String(error || "startup failed");
}
function setProcessRole(role) {
  processRole = role;
}

function snapshot() {
  return {
    startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
    migrationsComplete,
    referenceDataComplete,
    startupError,
    processRole,
    workers: [...workers].sort()
  };
}

function isReady() {
  return migrationsComplete && referenceDataComplete && !startupError;
}

module.exports = {
  isReady,
  markMigrationsComplete,
  markReferenceDataComplete,
  markStartupError,
  markWorkerStarted,
  setProcessRole,
  snapshot
};
