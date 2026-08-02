"use strict";

const { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell } = require("./shared");

// ── 1. Overview ────────────────────────────────────────────────────────────

app.get("/api/admin/overview", requireAdminCapability("overview.read"), route(async (_req, res) => {
  const startedAt = process.hrtime.bigint();
  const { wsClients, getWebSocketHealth } = require("./ws");
  const databaseProbeStartedAt = process.hrtime.bigint();
  const [databaseProbe, users, collection, social, notifications, passport, catalog, reports, freshness, jobs, migrations] = await Promise.all([
    pool.query("SELECT NOW() AS checked_at, pg_postmaster_start_time() AS started_at"),
    pool.query(`SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS total,
                       COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '24 hours')::int AS registrations24h,
                       COUNT(*) FILTER (WHERE deleted_at IS NULL AND last_active_at >= NOW() - INTERVAL '15 minutes')::int AS active15m,
                       COUNT(*) FILTER (WHERE deleted_at IS NULL AND suspended_until > NOW())::int AS suspended
                FROM users`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '24 hours')::int AS changes24h,
                       COUNT(*) FILTER (WHERE status = 'owned')::int AS ownedEntries
                FROM sprite_entries`),
    pool.query(`SELECT
                  (SELECT COUNT(*)::int FROM friendships WHERE status = 'pending') AS friend_requests,
                  (SELECT COUNT(*)::int FROM squad_invitations WHERE status = 'pending') AS squad_invitations,
                  (SELECT COUNT(*)::int FROM squads) AS squads`),
    pool.query(`SELECT
                  (SELECT COUNT(*)::int FROM notification_delivery_queue WHERE status IN ('pending', 'processing')) AS queued,
                  (SELECT COUNT(*)::int FROM notification_delivery_queue WHERE status = 'failed') AS failed,
                  (SELECT COUNT(*)::int FROM notification_digest_queue WHERE flush_at > NOW()) AS digests`),
    pool.query(`SELECT
                  (SELECT COUNT(*)::int FROM passport_recalc_queue WHERE status IN ('pending', 'processing')) AS queued,
                  (SELECT COUNT(*)::int FROM passport_recalc_queue WHERE status = 'failed') AS failed`),
    pool.query(`SELECT COUNT(*)::int AS variants,
                       COUNT(*) FILTER (WHERE data_status IS NULL OR data_status IN ('incomplete', 'unknown'))::int AS needsReview
                FROM sprite_variants`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open FROM user_reports`),
    pool.query(`SELECT
      (SELECT MAX(COALESCE(last_verified_at::timestamptz, updated_at)) FROM sprite_sources) AS catalog_synced_at,
      (SELECT MAX(recalculated_at) FROM user_passport_summaries) AS passport_synced_at,
      (SELECT MAX(processed_at) FROM notification_delivery_queue WHERE status = 'sent') AS notification_processed_at`),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM notification_delivery_queue WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes') AS notifications_stuck,
      (SELECT MIN(created_at) FROM notification_delivery_queue WHERE status IN ('pending', 'processing')) AS oldest_notification_at,
      (SELECT COUNT(*)::int FROM passport_recalc_queue WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '10 minutes') AS passports_stuck,
      (SELECT MIN(created_at) FROM passport_recalc_queue WHERE status IN ('pending', 'processing')) AS oldest_passport_job_at`),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM migration_errors) AS errors,
      (SELECT COUNT(*)::int FROM security_migrations) AS applied,
      (SELECT COUNT(*)::int
       FROM (VALUES ('capability_token_hashing_v1'), ('opaque_auth_token_hashing_v1'), ('admin_named_operators_v1')) required(name)
       LEFT JOIN security_migrations sm ON sm.name = required.name
       WHERE sm.name IS NULL) AS missing`)
  ]);
  const socketCount = [...wsClients.values()].reduce((total, clients) => total + clients.size, 0);
  const databaseLatencyMs = Number(process.hrtime.bigint() - databaseProbeStartedAt) / 1e6;
  const apiLatencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  res.json({
    asOf: new Date().toISOString(),
    users: users.rows[0],
    collection: collection.rows[0],
    social: social.rows[0],
    notifications: notifications.rows[0],
    passports: passport.rows[0],
    catalog: catalog.rows[0],
    moderation: reports.rows[0],
    realtime: { connectedUsers: wsClients.size, connectedClients: socketCount },
    database: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, status: "ok", latencyMs: Math.round(databaseLatencyMs), checkedAt: databaseProbe.rows[0]?.checked_at, startedAt: databaseProbe.rows[0]?.started_at },
    health: {
      api: { latencyMs: Math.round(apiLatencyMs) },
      websocket: getWebSocketHealth(),
      freshness: freshness.rows[0],
      jobs: jobs.rows[0],
      migrations: migrations.rows[0]
    }
  });
}));

// Persisted incidents are intentionally exposed only to technical operators.
// Context is already redacted by the monitoring reporter and never contains a
// request body, query parameters, credentials or bearer values.
app.get("/api/admin/monitoring/incidents", requireAdminCapability("overview.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const result = await pool.query(
    `SELECT fingerprint, component, environment, message, context,
            first_seen_at, last_seen_at, occurrences, last_alerted_at, resolved_at
     FROM operational_incidents
     ORDER BY resolved_at NULLS FIRST, last_seen_at DESC
     LIMIT $1 OFFSET $2`,
    [pageSize, offset]
  );
  const total = await pool.query("SELECT COUNT(*)::int AS count FROM operational_incidents");
  res.json({ page, pageSize, total: total.rows[0].count, incidents: result.rows });
}));

