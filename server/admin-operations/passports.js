"use strict";

const { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell } = require("./shared");

// ── 9. Passports & badges ──────────────────────────────────────────────────

app.get("/api/admin/passports", requireAdminCapability("passports.read"), route(async (_req, res) => {
  const [summaries, queues, achievements, visibility] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE recalculated_at < NOW() - INTERVAL '24 hours')::int AS stale,
                       MAX(recalculated_at) AS last_recalculated
                FROM user_passport_summaries`),
    pool.query("SELECT status, COUNT(*)::int AS count, MAX(updated_at) AS last_updated FROM passport_recalc_queue GROUP BY status ORDER BY status"),
    pool.query(`SELECT achievement_id, COUNT(*)::int AS unlocks
                FROM user_passport_achievements GROUP BY achievement_id ORDER BY unlocks DESC LIMIT 12`),
    pool.query(`SELECT passport_visibility, COUNT(*)::int AS count
                FROM collector_passports GROUP BY passport_visibility ORDER BY passport_visibility`)
  ]);
  res.json({ summaries: summaries.rows[0], queue: queues.rows, topAchievements: achievements.rows, visibility: visibility.rows });
}));

app.post("/api/admin/passports/recalculate", requireAdminCapability("passports.write"), adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const scope = text(body.scope, 20) || "stale";
  const reason = text(body.reason, 1000);
  if (!reason || !["stale", "all", "player"].includes(scope)) return res.status(400).json({ error: "Périmètre et justification requis" });
  let users;
  if (scope === "player") {
    const userId = numberId(body.userId);
    if (!userId) return res.status(400).json({ error: "Joueur invalide" });
    users = await pool.query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
  } else {
    users = await pool.query(
      `SELECT u.id FROM users u LEFT JOIN user_passport_summaries ps ON ps.user_id = u.id
       WHERE u.deleted_at IS NULL ${scope === "stale" ? "AND (ps.recalculated_at IS NULL OR ps.recalculated_at < NOW() - INTERVAL '24 hours')" : ""}
       ORDER BY u.id ASC LIMIT 500`
    );
  }
  // Record the administrative decision before enqueuing so a partial enqueue
  // remains attributable even if a later queue write fails.
  await audit("passport.recalculation_queued", "passport", scope, {
    justification: reason,
    details: { queued: users.rows.length, limited: users.rows.length === 500 },
    actor: adminActorFromReq(req)
  });
  for (const user of users.rows) {
    await enqueuePassportRecalc(user.id, { reason: "admin.recalculate", triggerEvent: "admin.recalculate", notify: false });
  }
  res.json({ ok: true, queued: users.rows.length, limited: users.rows.length === 500 });
}));

