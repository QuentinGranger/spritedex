"use strict";

const {
  crypto,
  app,
  pool,
  requireAdminCapability,
  requireAdminStepUp,
  adminActorFromReq,
  listActiveAdminSessions,
  describeAuthz,
  hasCapability,
  isAdminMfaConfigured,
  revokeUserSockets,
  invalidateSquadAnalysisCacheForUser,
  enqueuePassportRecalc,
  processDeliveryQueue,
  syncCatalogueMetaAndFanout,
  fanoutPublishedNews,
  buildUserDataExport,
  listDeletionQueue,
  purgeDeletedAccounts,
  retentionDays,
  restoreDeletedAccount,
  revokeActiveShareCapabilities,
  rateLimit,
  writeAdminAudit,
  withAdminAudit,
  AdminHttpError,
  notFound,
  adminMutationLimiter,
  PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_AUDIT_EXPORT_ROWS,
  REPORT_STATUSES,
  REPORT_PRIORITIES,
  APPEAL_STATUSES,
  NEWS_STATUSES,
  DATA_STATUSES,
  AVAILABILITY_STATUSES,
  CONFIDENCE_LEVELS,
  EDITORIAL_STATUSES,
  numberId,
  pagination,
  text,
  nullableDate,
  jsonValue,
  validUrl,
  validAssetUrl,
  audit,
  route,
  paged,
  safeAuditDetails,
  auditRowForAdmin,
  auditFilters,
  csvCell
} = require("./shared");

app.patch(
  "/api/admin/players/:userId/suspension",
  requireAdminCapability("players.moderate"),
  adminMutationLimiter,
  route(async (req, res) => {
    const userId = numberId(req.params.userId);
    const body = jsonValue(req.body);
    const suspended = body.suspended === true;
    const reason = text(body.reason, 1000);
    if (!userId) return res.status(400).json({ error: "Joueur invalide" });
    if (!reason) return res.status(400).json({ error: "Une justification est requise" });
    let until = null;
    if (suspended) {
      const parsed = nullableDate(body.until);
      if (parsed === undefined) return res.status(400).json({ error: "Date de suspension invalide" });
      until = parsed || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      if (new Date(until) <= new Date())
        return res.status(400).json({ error: "La suspension doit se terminer dans le futur" });
    }
    const client = await pool.connect();
    let result;
    let revokedSessions = 0;
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        `SELECT suspended_until, suspension_source, suspension_reason
       FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      if (!previous.rows.length) throw notFound("Joueur introuvable");
      result = await client.query(
        `UPDATE users
       SET suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
           suspended_until = CASE WHEN $2 THEN $3::timestamptz ELSE NULL END,
           suspension_source = CASE WHEN $2 THEN 'admin' ELSE NULL END,
           suspension_reason = CASE WHEN $2 THEN $4 ELSE NULL END
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, username, suspended_at, suspended_until, suspension_source`,
        [userId, suspended, until, reason]
      );
      if (result.rows.length && suspended) {
        const revoked = await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
        revokedSessions = revoked.rowCount || 0;
      }
      if (result.rows.length) {
        await writeAdminAudit(client, {
          actor: adminActorFromReq(req),
          action: suspended ? "player.suspended" : "player.unsuspended",
          targetType: "player",
          targetId: userId,
          justification: reason,
          details: {
            suspendedUntil: result.rows[0].suspended_until,
            source: result.rows[0].suspension_source,
            revokedSessions,
            changes: {
              suspendedUntil: { before: previous.rows[0].suspended_until, after: result.rows[0].suspended_until },
              suspensionSource: { before: previous.rows[0].suspension_source, after: result.rows[0].suspension_source },
              suspensionReason: { before: previous.rows[0].suspension_reason, after: suspended ? reason : null }
            }
          }
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (!result.rows.length) return res.status(404).json({ error: "Joueur introuvable" });
    if (suspended) revokeUserSockets(userId, "Account suspended by administration");
    await invalidateSquadAnalysisCacheForUser(userId);
    res.json({ ok: true, player: result.rows[0], revokedSessions });
  })
);

app.get(
  "/api/admin/players/:userId",
  requireAdminCapability("players.read"),
  route(async (req, res) => {
    const userId = numberId(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Joueur invalide" });

    const [
      player,
      reportsReceived,
      reportsFiled,
      blocks,
      friends,
      squads,
      activeSessions,
      suspensionHistory,
      adminActions
    ] = await Promise.all([
      pool.query(
        `SELECT u.id, u.username, u.display_name, u.created_at, u.last_active_at,
              u.suspended_at, u.suspended_until, u.suspension_source, u.suspension_reason,
              u.email_verified, u.deleted_at, u.profile_visibility, u.collection_visibility,
              COALESCE(ps.owned_variant_count, 0)::int AS owned_variants,
              COALESCE(ps.released_variant_count, 0)::int AS released_variants,
              COALESCE(ps.completion_rate, 0)::float AS completion_rate,
              COALESCE(ps.recalculated_at, NULL) AS passport_recalculated_at
       FROM users u
       LEFT JOIN user_passport_summaries ps ON ps.user_id = u.id
       WHERE u.id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT ur.id, ur.reason, ur.status, ur.priority, ur.context, ur.admin_notes, ur.appeal_status, ur.appeal_message, ur.appeal_created_at, ur.appeal_reviewed_at, ur.appeal_resolution, ur.created_at, ur.reviewed_at, ur.resolution,
              r.id AS reporter_id, r.username AS reporter_username,
              r.suspended_until AS reporter_suspended_until,
              (SELECT COUNT(*)::int FROM user_reports ur2
                WHERE ur2.reporter_id = ur.reporter_id) AS reporter_total_reports,
              (SELECT COUNT(*)::int FROM user_reports ur3
                WHERE ur3.reporter_id = ur.reporter_id AND ur3.status = 'open') AS reporter_open_reports,
              (SELECT COUNT(*)::int FROM user_reports ur5
                WHERE ur5.reporter_id = ur.reporter_id
                  AND ur5.created_at >= NOW() - INTERVAL '7 days') AS reporter_reports_7d
       FROM user_reports ur
       JOIN users r ON r.id = ur.reporter_id
       WHERE ur.reported_id = $1
       ORDER BY ur.created_at DESC
       LIMIT 40`,
        [userId]
      ),
      pool.query(
        `SELECT ur.id, ur.reason, ur.status, ur.priority, ur.context, ur.admin_notes, ur.appeal_status, ur.appeal_message, ur.appeal_created_at, ur.appeal_reviewed_at, ur.appeal_resolution, ur.created_at, ur.reviewed_at, ur.resolution,
              t.id AS reported_id, t.username AS reported_username,
              t.suspended_until AS reported_suspended_until
       FROM user_reports ur
       JOIN users t ON t.id = ur.reported_id
       WHERE ur.reporter_id = $1
       ORDER BY ur.created_at DESC
       LIMIT 20`,
        [userId]
      ),
      pool.query(
        `SELECT
         (SELECT COUNT(*)::int FROM user_blocks WHERE blocked_id = $1) AS blocked_by,
         (SELECT COUNT(*)::int FROM user_blocks WHERE blocker_id = $1) AS blocking`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM friendships
       WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
        [userId]
      ),
      pool.query(
        `SELECT s.id, s.code, s.name, sm.role, sm.status
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id
       WHERE sm.user_id = $1 AND sm.status = 'active'
       ORDER BY s.name ASC
       LIMIT 12`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM sessions
       WHERE user_id = $1 AND expires_at > NOW()`,
        [userId]
      ),
      pool.query(
        `SELECT id, actor, action, justification, details, created_at
       FROM admin_audit_log
       WHERE target_type = 'player'
         AND target_id = $1
         AND action IN ('player.suspended', 'player.unsuspended')
       ORDER BY created_at DESC
       LIMIT 25`,
        [String(userId)]
      ),
      pool.query(
        `SELECT id, actor, action, target_type, target_id, justification, details, created_at
       FROM admin_audit_log
       WHERE (target_type = 'player' AND target_id = $1)
          OR (action LIKE 'report.%' AND details->>'reportedUserId' = $1)
       ORDER BY created_at DESC
       LIMIT 30`,
        [String(userId)]
      )
    ]);

    if (!player.rows.length || player.rows[0].deleted_at) {
      return res.status(404).json({ error: "Joueur introuvable" });
    }

    const row = player.rows[0];
    const mapReportReceived = (item) => ({
      id: item.id,
      reason: item.reason,
      status: item.status,
      priority: item.priority,
      context: item.context,
      adminNotes: item.admin_notes,
      appeal: {
        status: item.appeal_status,
        message: item.appeal_message,
        createdAt: item.appeal_created_at,
        reviewedAt: item.appeal_reviewed_at,
        resolution: item.appeal_resolution
      },
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
      resolution: item.resolution,
      reporter: {
        id: item.reporter_id,
        username: item.reporter_username,
        suspendedUntil: item.reporter_suspended_until,
        totalReportsFiled: item.reporter_total_reports,
        openReportsFiled: item.reporter_open_reports,
        reportsFiledLast7d: item.reporter_reports_7d
      }
    });
    const mapReportFiled = (item) => ({
      id: item.id,
      reason: item.reason,
      status: item.status,
      priority: item.priority,
      createdAt: item.created_at,
      reviewedAt: item.reviewed_at,
      resolution: item.resolution,
      reported: {
        id: item.reported_id,
        username: item.reported_username,
        suspendedUntil: item.reported_suspended_until
      }
    });

    res.json({
      player: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        emailVerified: row.email_verified,
        profileVisibility: row.profile_visibility,
        collectionVisibility: row.collection_visibility,
        suspendedAt: row.suspended_at,
        suspendedUntil: row.suspended_until,
        suspensionSource: row.suspension_source,
        suspensionReason: row.suspension_reason,
        collection: {
          ownedVariants: row.owned_variants,
          releasedVariants: row.released_variants,
          completionRate: row.completion_rate,
          passportRecalculatedAt: row.passport_recalculated_at
        }
      },
      moderation: {
        openReports: reportsReceived.rows.filter((item) => item.status === "open").length,
        reportsReceived: reportsReceived.rows.map(mapReportReceived),
        reportsFiled: reportsFiled.rows.map(mapReportFiled),
        blockedBy: blocks.rows[0]?.blocked_by || 0,
        blocking: blocks.rows[0]?.blocking || 0
      },
      social: {
        friends: friends.rows[0]?.count || 0,
        squads: squads.rows.map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          role: item.role,
          status: item.status
        }))
      },
      sessions: { active: activeSessions.rows[0]?.count || 0 },
      history: {
        suspensions: suspensionHistory.rows,
        adminActions: adminActions.rows
      }
    });
  })
);

app.get(
  "/api/admin/players/:userId/suspension-history",
  requireAdminCapability("players.read"),
  route(async (req, res) => {
    const userId = numberId(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Joueur invalide" });
    const [player, history] = await Promise.all([
      pool.query(
        `SELECT id, username, display_name, suspended_at, suspended_until,
              suspension_source, suspension_reason
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [userId]
      ),
      pool.query(
        `SELECT id, actor, action, justification, details, created_at
       FROM admin_audit_log
       WHERE target_type = 'player'
         AND target_id = $1
         AND action IN ('player.suspended', 'player.unsuspended')
       ORDER BY created_at DESC
       LIMIT 25`,
        [String(userId)]
      )
    ]);
    if (!player.rows.length) return res.status(404).json({ error: "Joueur introuvable" });
    res.json({ player: player.rows[0], history: history.rows });
  })
);
