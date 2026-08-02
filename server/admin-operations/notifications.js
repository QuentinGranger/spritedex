"use strict";

const { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell } = require("./shared");

// ── 7. Notification operations ─────────────────────────────────────────────

app.get("/api/admin/notifications/operations", requireAdminCapability("notifications.read"), route(async (_req, res) => {
  const [queue, deliveries, push, digests, failures, health] = await Promise.all([
    pool.query("SELECT status, COUNT(*)::int AS count FROM notification_delivery_queue GROUP BY status ORDER BY status"),
    pool.query("SELECT channel, status, COUNT(*)::int AS count FROM notification_deliveries GROUP BY channel, status ORDER BY channel, status"),
    pool.query(`SELECT COUNT(*) FILTER (WHERE is_active)::int AS active,
                       COUNT(*) FILTER (WHERE NOT is_active)::int AS invalid,
                       COUNT(*) FILTER (WHERE last_used_at >= NOW() - INTERVAL '30 days')::int AS used30d
                FROM push_subscriptions`),
    pool.query("SELECT COUNT(*)::int AS count, MIN(flush_at) AS next_flush_at FROM notification_digest_queue"),
    pool.query(`SELECT id, notification_id, channels, status, attempts, max_attempts, last_error, available_at, not_before, updated_at
                FROM notification_delivery_queue WHERE status IN ('failed', 'cancelled') ORDER BY updated_at DESC LIMIT 50`),
    pool.query(`SELECT MIN(created_at) FILTER (WHERE status IN ('pending', 'processing')) AS oldest_pending_at,
                       MAX(updated_at) FILTER (WHERE status = 'failed') AS latest_failure_at,
                       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
                FROM notification_delivery_queue`)
  ]);
  res.json({ queue: queue.rows, deliveries: deliveries.rows, push: push.rows[0], digests: digests.rows[0], failedJobs: failures.rows, health: health.rows[0] });
}));

app.post("/api/admin/notifications/queue/:jobId/retry", requireAdminCapability("notifications.write"), adminMutationLimiter, route(async (req, res) => {
  const jobId = numberId(req.params.jobId);
  const reason = text(req.body?.reason, 1000);
  if (!jobId || !reason) return res.status(400).json({ error: "Job et justification requis" });
  await withAdminAudit(async (client) => {
    const result = await client.query(
      `UPDATE notification_delivery_queue
       SET status = 'pending', attempts = 0, available_at = NULL, not_before = NOW(), processed_at = NULL, last_error = NULL, updated_at = NOW()
       WHERE id = $1 AND status IN ('failed', 'cancelled') RETURNING id, notification_id`, [jobId]
    );
    if (!result.rows.length) throw notFound("Job non relançable");
    await client.query(
      "UPDATE notification_deliveries SET status = 'queued', failed_at = NULL, error_code = NULL, error_message = NULL, updated_at = NOW() WHERE notification_id = $1 AND status = 'failed'",
      [result.rows[0].notification_id]
    );
    return result.rows[0];
  }, (row) => ({
    actor: adminActorFromReq(req),
    action: "notification.delivery_retried",
    targetType: "notification_delivery",
    targetId: jobId,
    justification: reason,
    details: { notificationId: row.notification_id }
  }));
  res.json({ ok: true });
}));

app.post("/api/admin/notifications/retry-failed", requireAdminCapability("notifications.write"), adminMutationLimiter, route(async (req, res) => {
  const reason = text(req.body?.reason, 1000);
  const limit = Math.max(1, Math.min(100, Number(req.body?.limit) || 50));
  const jobIds = Array.isArray(req.body?.jobIds) ? [...new Set(req.body.jobIds.map(numberId).filter(Boolean))].slice(0, 50) : [];
  if (!reason) return res.status(400).json({ error: "Une justification est requise" });
  const result = await withAdminAudit(async (client) => {
    const jobs = await client.query(
      jobIds.length
        ? `SELECT id, notification_id FROM notification_delivery_queue WHERE id = ANY($1::bigint[]) AND status IN ('failed', 'cancelled') FOR UPDATE`
        : `SELECT id, notification_id FROM notification_delivery_queue WHERE status IN ('failed', 'cancelled') ORDER BY updated_at ASC LIMIT $1 FOR UPDATE`,
      jobIds.length ? [jobIds] : [limit]
    );
    if (!jobs.rows.length) return { retried: 0 };
    const ids = jobs.rows.map((job) => job.id);
    const notifications = [...new Set(jobs.rows.map((job) => job.notification_id))];
    await client.query(`UPDATE notification_delivery_queue SET status = 'pending', attempts = 0, available_at = NULL, not_before = NOW(), processed_at = NULL, last_error = NULL, updated_at = NOW() WHERE id = ANY($1::bigint[])`, [ids]);
    await client.query(`UPDATE notification_deliveries SET status = 'queued', failed_at = NULL, error_code = NULL, error_message = NULL, updated_at = NOW() WHERE notification_id = ANY($1::integer[]) AND status = 'failed'`, [notifications]);
    return { retried: ids.length };
  }, (result) => ({ actor: adminActorFromReq(req), action: "notification.failed_batch_retried", targetType: "notification_delivery", targetId: null, justification: reason, details: { retried: result.retried, requestedJobIds: jobIds, limit } }));
  res.json({ ok: true, ...result });
}));

app.post("/api/admin/notifications/process", requireAdminCapability("notifications.write"), adminMutationLimiter, route(async (req, res) => {
  const reason = text(req.body?.reason, 1000);
  if (!reason) return res.status(400).json({ error: "Une justification est requise" });
  // Delivery workers commit their own rows; audit the intent first so a failed
  // flush still leaves an attributable administrative decision.
  await audit("notification.queue_process_requested", "notification_delivery", null, {
    justification: reason,
    details: { limit: 20 },
    actor: adminActorFromReq(req)
  });
  const summary = await processDeliveryQueue(pool, { limit: 20 });
  await audit("notification.queue_processed", "notification_delivery", null, {
    justification: reason,
    details: summary,
    actor: adminActorFromReq(req)
  });
  res.json({ ok: true, summary });
}));

