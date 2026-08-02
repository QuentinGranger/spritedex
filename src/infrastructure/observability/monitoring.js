// Optional external error reporting. The receiver can be a Slack/Discord
// compatible incoming webhook or an internal alert relay accepting JSON.

const crypto = require("crypto");
const { pool } = require("@/infrastructure/database/postgres-pool");

const WEBHOOK_URL = String(process.env.ERROR_WEBHOOK_URL || "").trim();
const WEBHOOK_BEARER_TOKEN = String(process.env.ERROR_WEBHOOK_BEARER_TOKEN || "").trim();
const COOLDOWN_MS = Math.max(60_000, Number(process.env.ERROR_ALERT_COOLDOWN_MS) || 15 * 60_000);
const sentFingerprints = new Map();

function safeWebhookUrl() {
  if (!WEBHOOK_URL) return null;
  try {
    const url = new URL(WEBHOOK_URL);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && process.env.NODE_ENV !== "production") return url;
  } catch {
    // Invalid environment configuration disables reporting safely.
  }
  return null;
}

function truncate(value, max = 500) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function sanitizeMessage(value) {
  return truncate(value)
    .replace(/\bauthorization\s*[:=]\s*bearer\s+[^\s,;]+/gi, "authorization=[redacted]")
    .replace(/([?&](?:access_?token|api[_-]?key|auth(?:entication)?|password|secret|token)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/\b(password|passwd|token|secret|api[_-]?key|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function fingerprint(component, error) {
  return crypto.createHash("sha256")
    .update(`${component}\n${error?.name || "Error"}\n${error?.message || String(error)}`)
    .digest("hex");
}

function shouldSendInMemory(fingerprintValue) {
  const now = Date.now();
  const previous = sentFingerprints.get(fingerprintValue);
  if (previous && now - previous < COOLDOWN_MS) return false;
  sentFingerprints.set(fingerprintValue, now);
  if (sentFingerprints.size > 500) {
    for (const [key, timestamp] of sentFingerprints) {
      if (now - timestamp > COOLDOWN_MS) sentFingerprints.delete(key);
    }
  }
  return true;
}

async function recordIncident(event) {
  try {
    const result = await pool.query(
      `INSERT INTO operational_incidents
        (fingerprint, component, environment, message, context)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (fingerprint) DO UPDATE
       SET last_seen_at = NOW(),
           occurrences = operational_incidents.occurrences + 1,
           message = EXCLUDED.message,
           context = EXCLUDED.context,
           resolved_at = NULL
       RETURNING id, fingerprint, occurrences, last_alerted_at`,
      [event.fingerprint, event.component, event.environment, event.message, JSON.stringify(event.context)]
    );
    return result.rows[0];
  } catch (error) {
    // Monitoring must never make an application error worse, notably when the
    // database itself is the unavailable dependency being reported.
    console.error("[monitoring] unable to persist incident:", error.message);
    return null;
  }
}

async function claimAlert(fingerprintValue) {
  try {
    const result = await pool.query(
      `UPDATE operational_incidents
       SET last_alerted_at = NOW()
       WHERE fingerprint = $1
         AND (last_alerted_at IS NULL
              OR last_alerted_at < NOW() - ($2::bigint * INTERVAL '1 millisecond'))
       RETURNING last_alerted_at`,
      [fingerprintValue, COOLDOWN_MS]
    );
    return result.rows[0]?.last_alerted_at || null;
  } catch (error) {
    console.error("[monitoring] unable to claim incident alert:", error.message);
    return null;
  }
}

async function releaseAlertClaim(fingerprintValue) {
  await pool.query(
    `UPDATE operational_incidents
     SET last_alerted_at = NULL
     WHERE fingerprint = $1`,
    [fingerprintValue]
  ).catch((error) => console.error("[monitoring] unable to release incident alert claim:", error.message));
}

async function purgeOperationalIncidents({ retentionDays = 90 } = {}) {
  const days = Math.max(7, Math.min(3650, Number(retentionDays) || 90));
  try {
    const result = await pool.query(
      "DELETE FROM operational_incidents WHERE resolved_at IS NOT NULL AND last_seen_at < NOW() - ($1::int * INTERVAL '1 day') RETURNING id",
      [days]
    );
    return result.rowCount;
  } catch (error) {
    console.error("[monitoring] unable to purge resolved incidents:", error.message);
    return 0;
  }
}

async function reportError({ component = "application", error, context = {} } = {}) {
  const message = sanitizeMessage(error?.message || error || "Unknown error");
  const fingerprintValue = fingerprint(component, error);
  const event = {
    service: "sprite-index",
    environment: process.env.NODE_ENV || "development",
    component: truncate(component, 80),
    message,
    fingerprint: fingerprintValue,
    timestamp: new Date().toISOString(),
    context: {
      method: truncate(context.method, 12) || undefined,
      // Paths omit query parameters so tokens and personal values never leave
      // the service through monitoring.
      path: truncate(context.path, 180) || undefined,
      status: Number.isInteger(context.status) ? context.status : undefined
    }
  };
  const incident = await recordIncident(event);
  const webhook = safeWebhookUrl();
  if (!webhook) return { sent: false, event, incident };
  const alertClaim = incident
    ? await claimAlert(fingerprintValue)
    : (shouldSendInMemory(fingerprintValue) ? new Date().toISOString() : null);
  if (!alertClaim) return { sent: false, event, incident };

  const text = `[${event.environment}] ${event.component}: ${event.message}`;
  try {
    const headers = { "Content-Type": "application/json" };
    if (WEBHOOK_BEARER_TOKEN) headers.Authorization = `Bearer ${WEBHOOK_BEARER_TOKEN}`;
    const response = await fetch(webhook, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...event, text, content: text }),
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`webhook returned HTTP ${response.status}`);
    return { sent: true, event, incident };
  } catch (reportingError) {
    if (incident) await releaseAlertClaim(fingerprintValue);
    console.error("[monitoring] unable to deliver error alert:", reportingError.message);
    return { sent: false, event, incident, reportingError };
  }
}

function installProcessErrorHandlers({ server } = {}) {
  process.on("unhandledRejection", (reason) => {
    console.error("[UNHANDLED REJECTION]", reason);
    void reportError({ component: "unhandled_rejection", error: reason });
  });

  process.once("uncaughtException", (error) => {
    console.error("[UNCAUGHT EXCEPTION]", error);
    void reportError({ component: "uncaught_exception", error }).finally(() => {
      if (server?.listening) server.close(() => process.exit(1));
      else process.exit(1);
    });
  });
}

module.exports = { installProcessErrorHandlers, purgeOperationalIncidents, reportError, safeWebhookUrl, sanitizeMessage, truncate };
