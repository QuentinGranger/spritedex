// Integration contract for infrastructure probes. Requires the live server.
const assert = require("node:assert");

const base = process.env.BASE_URL || "http://localhost:3000";

async function main() {
  const live = await fetch(`${base}/health/live`);
  assert.strictEqual(live.status, 200, "liveness must respond without business data");
  const livePayload = await live.json();
  assert.strictEqual(livePayload.status, "live");
  assert.ok(Number.isInteger(livePayload.uptimeSeconds));

  const ready = await fetch(`${base}/health/ready`);
  assert.strictEqual(ready.status, 200, "readiness must pass after database bootstrap");
  const readyPayload = await ready.json();
  assert.strictEqual(readyPayload.status, "ready");
  assert.strictEqual(readyPayload.database.status, "ok");
  assert.strictEqual(readyPayload.runtime.migrationsComplete, true);
  assert.strictEqual(readyPayload.runtime.referenceDataComplete, true);
  assert.ok(Array.isArray(readyPayload.runtime.workers));
  assert.ok(readyPayload.runtime.workers.includes("notification_delivery_queue"));

  console.log("health probes: ok");
}

main().catch((error) => {
  console.error(`health probes failed: ${error.message}`);
  process.exitCode = 1;
});
