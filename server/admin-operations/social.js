"use strict";

const { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell } = require("./shared");

// ── 6. Social & squads ─────────────────────────────────────────────────────

app.get("/api/admin/social", requireAdminCapability("social.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const q = text(req.query.q, 80);
  const joinFilter = ["open", "closed"].includes(String(req.query.join)) ? String(req.query.join) : "all";
  const values = [];
  const where = [];
  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    where.push(`(LOWER(s.name) LIKE $${values.length} OR LOWER(s.code) LIKE $${values.length})`);
  }
  if (joinFilter === "open") where.push("s.join_open = TRUE");
  if (joinFilter === "closed") where.push("s.join_open = FALSE");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const listValues = [...values, pageSize, offset];
  const limitIndex = values.length + 1;
  const offsetIndex = values.length + 2;

  const [summary, squads, count, activity, pendingInvites, pendingFriendships, recentBlocks] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM friendships WHERE status = 'accepted') AS friendships,
      (SELECT COUNT(*)::int FROM friendships WHERE status = 'pending') AS pending_friendships,
      (SELECT COUNT(*)::int FROM squad_invitations WHERE status = 'pending') AS pending_squad_invitations,
      (SELECT COUNT(*)::int FROM squad_wishlist_items WHERE status = 'wanted') AS wanted_items,
      (SELECT COUNT(*)::int FROM user_blocks) AS blocks,
      (SELECT COUNT(*)::int FROM squads) AS squads,
      (SELECT COUNT(*)::int FROM squads WHERE join_open = TRUE) AS open_join_squads,
      (SELECT COUNT(*)::int FROM squad_members WHERE status = 'active') AS active_members,
      (SELECT COUNT(*)::int FROM squad_activity WHERE created_at >= NOW() - INTERVAL '24 hours') AS activity24h`),
    pool.query(`SELECT s.id, s.code, s.name, s.join_open, s.visibility, s.created_at, s.created_by,
                       (SELECT COUNT(*)::int FROM squad_members sm
                        WHERE sm.squad_id = s.id AND sm.status = 'active') AS member_count,
                       (SELECT COUNT(*)::int FROM squad_wishlist_items swi
                        WHERE swi.squad_id = s.id AND swi.status = 'wanted') AS wanted_count,
                       (SELECT COUNT(*)::int FROM squad_invitations si
                        WHERE si.squad_id = s.id AND si.status = 'pending') AS pending_invite_count,
                       (SELECT MAX(sa.created_at) FROM squad_activity sa
                        WHERE sa.squad_id = s.id) AS last_activity_at,
                       (SELECT COUNT(*)::int FROM squad_activity sa
                        WHERE sa.squad_id = s.id AND sa.created_at >= NOW() - INTERVAL '7 days') AS activity7d
                FROM squads s
                ${clause}
                ORDER BY last_activity_at DESC NULLS LAST, s.created_at DESC
                LIMIT $${limitIndex} OFFSET $${offsetIndex}`, listValues),
    pool.query(`SELECT COUNT(*)::int AS count FROM squads s ${clause}`, values),
    pool.query(`SELECT type, COUNT(*)::int AS count FROM squad_activity
                WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY type ORDER BY count DESC`),
    pool.query(`SELECT si.id, si.squad_id, si.created_at, si.expires_at,
                       s.name AS squad_name, s.code AS squad_code,
                       inviter.username AS inviter_username,
                       invitee.id AS invitee_id, invitee.username AS invitee_username
                FROM squad_invitations si
                JOIN squads s ON s.id = si.squad_id
                JOIN users inviter ON inviter.id = si.inviter_id
                JOIN users invitee ON invitee.id = si.invitee_id
                WHERE si.status = 'pending'
                ORDER BY si.created_at DESC
                LIMIT 12`),
    pool.query(`SELECT f.id, f.created_at,
                       requester.id AS requester_id, requester.username AS requester_username,
                       addressee.id AS addressee_id, addressee.username AS addressee_username
                FROM friendships f
                JOIN users requester ON requester.id = f.requester_id
                JOIN users addressee ON addressee.id = f.addressee_id
                WHERE f.status = 'pending'
                ORDER BY f.created_at DESC
                LIMIT 12`),
    pool.query(`SELECT ub.id, ub.reason, ub.created_at,
                       blocker.id AS blocker_id, blocker.username AS blocker_username,
                       blocked.id AS blocked_id, blocked.username AS blocked_username
                FROM user_blocks ub
                JOIN users blocker ON blocker.id = ub.blocker_id
                JOIN users blocked ON blocked.id = ub.blocked_id
                ORDER BY ub.created_at DESC
                LIMIT 12`)
  ]);
  res.json({
    summary: summary.rows[0],
    filters: { q: q || "", join: joinFilter },
    squads: paged(squads.rows, count.rows[0]?.count, { page, pageSize }),
    activity24h: activity.rows,
    pendingInvites: pendingInvites.rows,
    pendingFriendships: pendingFriendships.rows,
    recentBlocks: recentBlocks.rows
  });
}));

app.get("/api/admin/social/squads/:squadId", requireAdminCapability("social.read"), route(async (req, res) => {
  const squadId = numberId(req.params.squadId);
  if (!squadId) return res.status(400).json({ error: "Squad invalide" });

  const [squad, members, invites, wishlist, activity, owner] = await Promise.all([
    pool.query(
      `SELECT s.id, s.code, s.name, s.join_open, s.visibility, s.created_at, s.created_by, s.logo_url,
              (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.squad_id = s.id AND sm.status = 'active') AS member_count,
              (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.squad_id = s.id AND sm.status <> 'active') AS inactive_member_count,
              (SELECT COUNT(*)::int FROM squad_wishlist_items swi WHERE swi.squad_id = s.id AND swi.status = 'wanted') AS wanted_count,
              (SELECT COUNT(*)::int FROM squad_wishlist_items swi WHERE swi.squad_id = s.id AND swi.status = 'found') AS found_count,
              (SELECT COUNT(*)::int FROM squad_invitations si WHERE si.squad_id = s.id AND si.status = 'pending') AS pending_invite_count,
              (SELECT MAX(sa.created_at) FROM squad_activity sa WHERE sa.squad_id = s.id) AS last_activity_at,
              (SELECT COUNT(*)::int FROM squad_activity sa WHERE sa.squad_id = s.id AND sa.created_at >= NOW() - INTERVAL '7 days') AS activity7d,
              (SELECT COUNT(*)::int FROM squad_activity sa WHERE sa.squad_id = s.id AND sa.created_at >= NOW() - INTERVAL '24 hours') AS activity24h
       FROM squads s WHERE s.id = $1`,
      [squadId]
    ),
    pool.query(
      `SELECT sm.id, sm.user_id, sm.role, sm.status, sm.joined_at, sm.left_at,
              u.username, u.display_name, u.last_active_at,
              u.suspended_until, u.deleted_at
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1
       ORDER BY CASE WHEN sm.status = 'active' THEN 0 ELSE 1 END,
                CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                sm.joined_at ASC
       LIMIT 50`,
      [squadId]
    ),
    pool.query(
      `SELECT si.id, si.status, si.created_at, si.expires_at, si.responded_at,
              inviter.username AS inviter_username,
              invitee.id AS invitee_id, invitee.username AS invitee_username
       FROM squad_invitations si
       JOIN users inviter ON inviter.id = si.inviter_id
       JOIN users invitee ON invitee.id = si.invitee_id
       WHERE si.squad_id = $1
       ORDER BY CASE WHEN si.status = 'pending' THEN 0 ELSE 1 END, si.created_at DESC
       LIMIT 20`,
      [squadId]
    ),
    pool.query(
      `SELECT swi.id, swi.variant_id, swi.status, swi.created_at, swi.updated_at,
              creator.username AS created_by_username,
              assignee.username AS assigned_to_username,
              finder.username AS found_by_username
       FROM squad_wishlist_items swi
       JOIN users creator ON creator.id = swi.created_by
       LEFT JOIN users assignee ON assignee.id = swi.assigned_to
       LEFT JOIN users finder ON finder.id = swi.found_by
       WHERE swi.squad_id = $1
       ORDER BY CASE WHEN swi.status = 'wanted' THEN 0 ELSE 1 END, swi.updated_at DESC
       LIMIT 25`,
      [squadId]
    ),
    pool.query(
      `SELECT sa.id, sa.type, sa.action, sa.sprite_id, sa.created_at, sa.metadata,
              u.username
       FROM squad_activity sa
       LEFT JOIN users u ON u.id = sa.user_id
       WHERE sa.squad_id = $1
       ORDER BY sa.created_at DESC
       LIMIT 25`,
      [squadId]
    ),
    pool.query(
      `SELECT u.id, u.username, u.display_name
       FROM squads s
       LEFT JOIN users u ON u.id = s.created_by
       WHERE s.id = $1`,
      [squadId]
    )
  ]);

  if (!squad.rows.length) return res.status(404).json({ error: "Squad introuvable" });
  res.json({
    squad: squad.rows[0],
    owner: owner.rows[0]?.id ? owner.rows[0] : null,
    members: members.rows,
    invitations: invites.rows,
    wishlist: wishlist.rows,
    activity: activity.rows
  });
}));

app.patch("/api/admin/social/squads/:squadId/access", requireAdminCapability("social.write"), adminMutationLimiter, route(async (req, res) => {
  const squadId = numberId(req.params.squadId);
  const joinOpen = req.body?.joinOpen === true;
  const reason = text(req.body?.reason, 1000);
  if (!squadId || !reason) return res.status(400).json({ error: "Squad et justification requis" });
  const squad = await withAdminAudit(async (client) => {
    const result = await client.query(
      "UPDATE squads SET join_open = $2 WHERE id = $1 RETURNING id, name, code, join_open",
      [squadId, joinOpen]
    );
    if (!result.rows.length) throw notFound("Squad introuvable");
    return result.rows[0];
  }, {
    actor: adminActorFromReq(req),
    action: joinOpen ? "squad.join_opened" : "squad.join_closed",
    targetType: "squad",
    targetId: squadId,
    justification: reason
  });
  res.json({ ok: true, squad });
}));

app.post("/api/admin/social/invitations/:invitationId/cancel", requireAdminCapability("social.write"), adminMutationLimiter, route(async (req, res) => {
  const invitationId = text(req.params.invitationId, 80);
  const reason = text(req.body?.reason, 1000);
  if (!invitationId || !reason) return res.status(400).json({ error: "Invitation et justification requis" });
  const invitation = await withAdminAudit(async (client) => {
    const result = await client.query(
      `UPDATE squad_invitations
       SET status = 'cancelled', responded_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, squad_id, invitee_id, status`,
      [invitationId]
    );
    if (!result.rows.length) throw notFound("Invitation introuvable ou déjà traitée");
    return result.rows[0];
  }, {
    actor: adminActorFromReq(req),
    action: "squad.invitation_cancelled",
    targetType: "squad_invitation",
    targetId: invitationId,
    justification: reason,
    details: {}
  });
  res.json({ ok: true, invitation });
}));

