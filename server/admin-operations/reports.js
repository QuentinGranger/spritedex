"use strict";

const { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell } = require("./shared");

app.get("/api/admin/reports", requireAdminCapability("players.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const status = REPORT_STATUSES.has(String(req.query.status)) ? String(req.query.status) : "open";
  const priority = REPORT_PRIORITIES.has(String(req.query.priority)) ? String(req.query.priority) : null;
  const listValues = [status];
  const listWhere = ["ur.status = $1"];
  if (priority) {
    listValues.push(priority);
    listWhere.push(`ur.priority = $${listValues.length}`);
  }
  listValues.push(pageSize, offset);
  const countValues = priority ? [status, priority] : [status];
  const countPriorityClause = priority ? " AND priority = $2" : "";
  const [list, count, priorityCounts] = await Promise.all([
    pool.query(
      `SELECT ur.id, ur.reason, ur.status, ur.priority, ur.context, ur.admin_notes, ur.appeal_status, ur.appeal_message, ur.appeal_created_at, ur.appeal_reviewed_at, ur.appeal_resolution, ur.created_at, ur.reviewed_at, ur.resolution,
              reported.id AS reported_user_id, reported.username AS reported_username,
              reported.display_name AS reported_display_name,
              reported.suspended_until AS reported_suspended_until,
              reported.suspension_source AS reported_suspension_source,
              reporter.id AS reporter_user_id, reporter.username AS reporter_username,
              reporter.display_name AS reporter_display_name,
              reporter.suspended_until AS reporter_suspended_until,
              (SELECT COUNT(*)::int FROM user_reports ur2
                WHERE ur2.reporter_id = ur.reporter_id) AS reporter_total_reports,
              (SELECT COUNT(*)::int FROM user_reports ur3
                WHERE ur3.reporter_id = ur.reporter_id AND ur3.status = 'open') AS reporter_open_reports,
              (SELECT COUNT(*)::int FROM user_reports ur4
                WHERE ur4.reported_id = ur.reported_id AND ur4.status = 'open') AS reported_open_reports,
              (SELECT COUNT(*)::int FROM user_reports ur5
                WHERE ur5.reporter_id = ur.reporter_id
                  AND ur5.created_at >= NOW() - INTERVAL '7 days') AS reporter_reports_7d
       FROM user_reports ur
       JOIN users reported ON reported.id = ur.reported_id
       JOIN users reporter ON reporter.id = ur.reporter_id
       WHERE ${listWhere.join(" AND ")}
       ORDER BY CASE ur.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, ur.created_at ASC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM user_reports WHERE status = $1${countPriorityClause}`, countValues),
    pool.query(
      `SELECT priority, COUNT(*)::int AS count
       FROM user_reports
       WHERE status = $1
       GROUP BY priority`,
      [status]
    )
  ]);
  const response = paged(list.rows.map(row => ({
    id: row.id,
    reason: row.reason,
    status: row.status,
    priority: row.priority,
    context: row.context,
    adminNotes: row.admin_notes,
    appeal: { status: row.appeal_status, message: row.appeal_message, createdAt: row.appeal_created_at, reviewedAt: row.appeal_reviewed_at, resolution: row.appeal_resolution },
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    resolution: row.resolution,
    reported: {
      id: row.reported_user_id,
      username: row.reported_username,
      displayName: row.reported_display_name,
      suspendedUntil: row.reported_suspended_until,
      suspensionSource: row.reported_suspension_source,
      openReports: row.reported_open_reports
    },
    reporter: {
      id: row.reporter_user_id,
      username: row.reporter_username,
      displayName: row.reporter_display_name,
      suspendedUntil: row.reporter_suspended_until,
      totalReportsFiled: row.reporter_total_reports,
      openReportsFiled: row.reporter_open_reports,
      reportsFiledLast7d: row.reporter_reports_7d
    }
  })), count.rows[0]?.count, { page, pageSize });
  response.facets = { priorityCounts: Object.fromEntries(priorityCounts.rows.map((row) => [row.priority, row.count])) };
  res.json(response);
}));

app.patch("/api/admin/reports/:reportId", requireAdminCapability("players.moderate"), adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const status = text(body.status, 20);
  const resolution = text(body.resolution, 1500);
  const requestedPriority = text(body.priority, 20);
  const priority = requestedPriority || null;
  const hasAdminNotes = Object.prototype.hasOwnProperty.call(body, "adminNotes");
  const adminNotes = text(body.adminNotes, 4000);
  const alsoSuspend = body.suspend === true;
  const closeRelated = body.closeRelatedOpenReports === true;
  if (!REPORT_STATUSES.has(status) || status === "open") return res.status(400).json({ error: "Statut de traitement invalide" });
  if (!resolution) return res.status(400).json({ error: "Une note de résolution est requise" });
  if (priority && !REPORT_PRIORITIES.has(priority)) return res.status(400).json({ error: "Priorité de signalement invalide" });
  if (alsoSuspend && status !== "resolved") {
    return res.status(400).json({ error: "La suspension combinée n’est disponible qu’avec une résolution" });
  }

  let until = null;
  if (alsoSuspend) {
    const parsed = nullableDate(body.until);
    if (parsed === undefined) return res.status(400).json({ error: "Date de suspension invalide" });
    until = parsed || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (new Date(until) <= new Date()) return res.status(400).json({ error: "La suspension doit se terminer dans le futur" });
  }

  const outcome = await withAdminAudit(async (client) => {
    const previousReport = await client.query(
      `SELECT priority, admin_notes
       FROM user_reports
       WHERE id = $1 AND status = 'open'
       FOR UPDATE`,
      [req.params.reportId]
    );
    if (!previousReport.rows.length) throw notFound("Signalement introuvable ou déjà traité");
    const result = await client.query(
      `UPDATE user_reports SET status = $2, resolution = $3, priority = COALESCE($4, priority),
       admin_notes = CASE WHEN $5 THEN $6 ELSE admin_notes END, reviewed_at = NOW()
       WHERE id = $1
       RETURNING id, reported_id, priority, admin_notes`,
      [req.params.reportId, status, resolution, priority, hasAdminNotes, adminNotes]
    );
    const reportedId = result.rows[0].reported_id;
    let revokedSessions = 0;
    let player = null;
    let closedRelated = 0;
    if (alsoSuspend) {
      const previousPlayer = await client.query(
        `SELECT suspended_until, suspension_source, suspension_reason
         FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [reportedId]
      );
      if (!previousPlayer.rows.length) throw notFound("Joueur signalé introuvable");
      const suspended = await client.query(
        `UPDATE users
         SET suspended_at = NOW(),
             suspended_until = $2::timestamptz,
             suspension_source = 'admin',
             suspension_reason = $3
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id, username, suspended_at, suspended_until, suspension_source`,
        [reportedId, until, resolution]
      );
      if (!suspended.rows.length) throw notFound("Joueur signalé introuvable");
      const revoked = await client.query("DELETE FROM sessions WHERE user_id = $1", [reportedId]);
      revokedSessions = revoked.rowCount || 0;
      player = suspended.rows[0];
      await writeAdminAudit(client, {
        actor: adminActorFromReq(req),
        action: "player.suspended",
        targetType: "player",
        targetId: reportedId,
        justification: resolution,
        details: {
          suspendedUntil: player.suspended_until,
          source: "admin",
          revokedSessions,
          viaReportId: result.rows[0].id,
          changes: {
            suspendedUntil: { before: previousPlayer.rows[0].suspended_until, after: player.suspended_until },
            suspensionSource: { before: previousPlayer.rows[0].suspension_source, after: "admin" },
            suspensionReason: { before: previousPlayer.rows[0].suspension_reason, after: resolution }
          }
        }
      });
    }
    if (closeRelated) {
      const related = await client.query(
        `UPDATE user_reports
         SET status = $2,
             resolution = $3,
             reviewed_at = NOW()
         WHERE reported_id = $1
           AND status = 'open'
           AND id <> $4
         RETURNING id`,
        [reportedId, status === "dismissed" ? "dismissed" : "resolved", resolution, result.rows[0].id]
      );
      closedRelated = related.rows.length;
    }
    return {
      reportId: result.rows[0].id,
      reportedId,
      revokedSessions,
      closedRelated,
      player,
      previousReport: previousReport.rows[0],
      report: result.rows[0]
    };
  }, (row) => ({
    actor: adminActorFromReq(req),
    action: alsoSuspend ? "report.resolved_with_suspension" : `report.${status}`,
    targetType: "report",
    targetId: row.reportId,
    justification: resolution,
    details: {
      reportedUserId: row.reportedId,
      suspended: alsoSuspend,
      revokedSessions: row.revokedSessions,
      closedRelatedReports: row.closedRelated,
      priority: row.report.priority,
      changes: {
        status: { before: "open", after: status },
        priority: { before: row.previousReport.priority, after: row.report.priority },
        adminNotes: { before: row.previousReport.admin_notes, after: row.report.admin_notes }
      }
    }
  }));

  if (alsoSuspend && outcome.player) {
    revokeUserSockets(outcome.reportedId, "Account suspended by administration");
    await invalidateSquadAnalysisCacheForUser(outcome.reportedId);
  }
  res.json({
    ok: true,
    suspended: alsoSuspend,
    revokedSessions: outcome.revokedSessions,
    closedRelatedReports: outcome.closedRelated,
    player: outcome.player
  });
}));

app.post("/api/admin/reports/:reportId/appeal", requireAdminCapability("players.moderate"), adminMutationLimiter, route(async (req, res) => {
  const appealStatus = text(req.body?.appealStatus, 20);
  const appealMessage = text(req.body?.appealMessage, 3000);
  const resolution = text(req.body?.resolution, 3000);
  const reason = text(req.body?.reason, 1000);
  if (!APPEAL_STATUSES.has(appealStatus) || appealStatus === "none" || !reason) return res.status(400).json({ error: "Recours et justification requis" });
  const report = await withAdminAudit(async (client) => {
    const previous = await client.query(
      `SELECT appeal_status, appeal_message, appeal_resolution
       FROM user_reports WHERE id = $1 FOR UPDATE`,
      [req.params.reportId]
    );
    if (!previous.rows.length) throw notFound("Signalement introuvable");
    const result = await client.query(
      `UPDATE user_reports SET appeal_status = $2, appeal_message = COALESCE($3, appeal_message),
       appeal_created_at = COALESCE(appeal_created_at, NOW()),
       appeal_reviewed_at = CASE WHEN $2 IN ('accepted', 'rejected') THEN NOW() ELSE appeal_reviewed_at END,
       appeal_resolution = CASE WHEN $2 IN ('accepted', 'rejected') THEN $4 ELSE appeal_resolution END
       WHERE id = $1 RETURNING id, reported_id, appeal_status, appeal_message, appeal_resolution`,
      [req.params.reportId, appealStatus, appealMessage, resolution]
    );
    return { ...result.rows[0], previous: previous.rows[0] };
  }, (row) => ({
    actor: adminActorFromReq(req),
    action: `report.appeal_${appealStatus}`,
    targetType: "report",
    targetId: row.id,
    justification: reason,
    details: {
      reportedUserId: row.reported_id,
      appealStatus,
      changes: {
        appealStatus: { before: row.previous.appeal_status, after: row.appeal_status },
        appealMessage: { before: row.previous.appeal_message, after: row.appeal_message },
        appealResolution: { before: row.previous.appeal_resolution, after: row.appeal_resolution }
      }
    }
  }));
  const { previous: _previous, ...updatedReport } = report;
  res.json({ ok: true, report: updatedReport });
}));

