// ── SPRITNEX security audit logger ─────────────────────────────────────────
// Records security-relevant events with a 12-month retention window.
// Events: login, register, password reset, email verification, account deletion,
// OAuth login, profile update, share link changes, consent update, push token changes.

const MAX_LOG_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 12 months

async function ensureSecurityLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email VARCHAR(255),
      ip_address INET,
      user_agent TEXT,
      event_type VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ok',
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_security_logs_user ON security_logs (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_logs_event ON security_logs (event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs (created_at DESC);
  `);
}

function safeIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

function safeUserAgent(req) {
  return req.headers["user-agent"] || null;
}

async function logSecurityEvent(pool, { req, userId, email, event, status = "ok", details = {} }) {
  try {
    await pool.query(
      `INSERT INTO security_logs (user_id, email, ip_address, user_agent, event_type, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId || null,
        email ? email.toLowerCase() : null,
        safeIp(req),
        safeUserAgent(req),
        event,
        status,
        JSON.stringify(details)
      ]
    );
  } catch (err) {
    console.error("[SECURITY LOG] Failed to log event:", err.message);
  }
}

async function purgeOldSecurityLogs(pool) {
  try {
    const result = await pool.query(
      `DELETE FROM security_logs
       WHERE created_at < NOW() - INTERVAL '12 months'
       RETURNING id`
    );
    if (result.rows.length > 0) {
      console.log(`[SECURITY LOGS] Purged ${result.rows.length} log(s) older than 12 months.`);
    }
  } catch (err) {
    console.error("[SECURITY LOGS] Failed to purge old logs:", err);
  }
}

module.exports = {
  ensureSecurityLogTable,
  logSecurityEvent,
  purgeOldSecurityLogs
};
