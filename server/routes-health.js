// Unauthenticated infrastructure probes. Keep these separate from business
// routes so providers never mistake a catalogue response for process health.

const { app } = require("./core");
const { pool } = require("./db");
const runtimeHealth = require("./runtime-health");
const { getRateLimitStoreHealth } = require("./rate-limit-store");

app.get("/health/live", (_req, res) => {
  const runtime = runtimeHealth.snapshot();
  res.set("Cache-Control", "no-store").status(200).json({
    status: "live",
    uptimeSeconds: runtime.uptimeSeconds,
    startedAt: runtime.startedAt
  });
});

app.get("/health/ready", async (_req, res) => {
  const startedAt = Date.now();
  const runtime = runtimeHealth.snapshot();
  try {
    await pool.query("SELECT 1");
    const ready = runtimeHealth.isReady();
    return res
      .set("Cache-Control", "no-store")
      .status(ready ? 200 : 503)
      .json({
        status: ready ? "ready" : "starting",
        database: { status: "ok", latencyMs: Date.now() - startedAt },
        rateLimitStore: getRateLimitStoreHealth(),
        runtime
      });
  } catch {
    return res
      .set("Cache-Control", "no-store")
      .status(503)
      .json({
        status: "not_ready",
        database: { status: "unavailable", latencyMs: Date.now() - startedAt },
        rateLimitStore: getRateLimitStoreHealth(),
        runtime
      });
  }
});
