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

// ── 10. Privacy & audit ────────────────────────────────────────────────────

app.get(
  "/api/admin/audit",
  requireAdminCapability("audit.read"),
  route(async (req, res) => {
    const filters = auditFilters(req.query);
    if (filters.error) return res.status(400).json({ error: filters.error });
    const { page, pageSize, offset } = pagination(req);
    const values = [...filters.values];
    const limitMarker = `$${values.length + 1}`;
    const offsetMarker = `$${values.length + 2}`;
    const [rows, count, actions, targetTypes] = await Promise.all([
      pool.query(
        `SELECT id, actor, action, target_type, target_id, justification, details, created_at
       FROM admin_audit_log ${filters.where}
       ORDER BY created_at DESC, id DESC LIMIT ${limitMarker} OFFSET ${offsetMarker}`,
        [...values, pageSize, offset]
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM admin_audit_log ${filters.where}`, values),
      pool.query(
        `SELECT action, COUNT(*)::int AS count
       FROM admin_audit_log ${filters.where}
       GROUP BY action ORDER BY count DESC, action ASC LIMIT 80`,
        values
      ),
      pool.query(
        `SELECT target_type, COUNT(*)::int AS count
       FROM admin_audit_log ${filters.where}
       GROUP BY target_type ORDER BY count DESC, target_type ASC LIMIT 40`,
        values
      )
    ]);
    res.json({
      ...paged(rows.rows.map(auditRowForAdmin), count.rows[0]?.count, { page, pageSize }),
      facets: { actions: actions.rows, targetTypes: targetTypes.rows }
    });
  })
);

app.get(
  "/api/admin/audit/export",
  requireAdminCapability("audit.read"),
  route(async (req, res) => {
    const filters = auditFilters(req.query);
    if (filters.error) return res.status(400).json({ error: filters.error });
    const rows = await pool.query(
      `SELECT id, actor, action, target_type, target_id, justification, details, created_at
     FROM admin_audit_log ${filters.where}
     ORDER BY created_at DESC, id DESC LIMIT $${filters.values.length + 1}`,
      [...filters.values, MAX_AUDIT_EXPORT_ROWS]
    );
    const header = ["id", "actor", "action", "target_type", "target_id", "justification", "details", "created_at"];
    const csv = [
      header,
      ...rows.rows.map((row) => {
        const safe = auditRowForAdmin(row);
        return [
          safe.id,
          safe.actor,
          safe.action,
          safe.target_type,
          safe.target_id,
          safe.justification,
          JSON.stringify(safe.details),
          safe.created_at
        ];
      })
    ]
      .map((line) => line.map(csvCell).join(","))
      .join("\n");
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sprite-index-audit.csv"',
      "Cache-Control": "no-store"
    });
    res.send(`\uFEFF${csv}`);
  })
);

app.get(
  "/api/admin/privacy/lookup",
  requireAdminCapability("privacy.read"),
  route(async (req, res) => {
    const q = text(req.query.q, 80);
    if (!q) return res.status(400).json({ error: "Recherche requise" });
    const numeric = numberId(q.replace(/^#/, ""));
    const result = numeric
      ? await pool.query(
          `SELECT u.id, u.username, u.email, u.deleted_at, u.created_at, u.last_active_at,
              (SELECT COUNT(*)::int FROM sprite_entries se WHERE se.user_id = u.id) AS collection_entries,
              (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.user_id = u.id AND sm.status = 'active') AS active_squads
       FROM users u WHERE u.id = $1`,
          [numeric]
        )
      : await pool.query(
          `SELECT u.id, u.username, u.email, u.deleted_at, u.created_at, u.last_active_at,
              (SELECT COUNT(*)::int FROM sprite_entries se WHERE se.user_id = u.id) AS collection_entries,
              (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.user_id = u.id AND sm.status = 'active') AS active_squads
       FROM users u
       WHERE LOWER(u.username) = LOWER($1)
       ORDER BY u.deleted_at NULLS FIRST, u.id DESC
       LIMIT 5`,
          [q]
        );
    res.json({
      items: result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        email: row.email,
        deletedAt: row.deleted_at,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        collectionEntries: Number(row.collection_entries) || 0,
        activeSquads: Number(row.active_squads) || 0
      }))
    });
  })
);

app.get(
  "/api/admin/privacy",
  requireAdminCapability("privacy.read"),
  route(async (req, res) => {
    const deletionFilter = ["ready", "pending", "all"].includes(String(req.query.deletionStatus))
      ? String(req.query.deletionStatus)
      : "all";
    const [privacy, sharing, consent, deletions] = await Promise.all([
      pool.query(
        `SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deletion_requests,
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - ($1::text || ' days')::interval)::int AS ready_for_purge,
      COUNT(*) FILTER (WHERE profile_visibility = 'public' AND deleted_at IS NULL)::int AS public_profiles,
      COUNT(*) FILTER (WHERE collection_visibility = 'public' AND deleted_at IS NULL)::int AS public_collections
      FROM users`,
        [String(retentionDays())]
      ),
      pool.query(`SELECT
      (SELECT COUNT(*)::int FROM users WHERE share_token IS NOT NULL AND deleted_at IS NULL) AS passport_links,
      (SELECT COUNT(*)::int FROM compare_share_tokens WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) AS compare_links,
      (SELECT COUNT(*)::int FROM friend_invite_links WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) AS friend_invite_links`),
      pool.query(`SELECT COALESCE(cgu_version, 'unknown') AS version, COUNT(*)::int AS count
                FROM users WHERE cgu_accepted GROUP BY cgu_version ORDER BY count DESC`),
      listDeletionQueue({ limit: 40, status: deletionFilter })
    ]);
    const actor = adminActorFromReq(req);
    const sessions = await listActiveAdminSessions(req.adminSession?.publicId || null);
    const authz = describeAuthz(req.adminSession?.role);
    res.json({
      privacy: {
        ...privacy.rows[0],
        retentionDays: retentionDays()
      },
      sharing: sharing.rows[0],
      consentVersions: consent.rows,
      deletions,
      sessions,
      roles: {
        ...authz,
        operatorLabel: req.adminSession?.actorLabel || actor.split(":")[0],
        actor,
        mfaConfigured: isAdminMfaConfigured(),
        stepUpRequired: isAdminMfaConfigured()
      }
    });
  })
);

app.get(
  "/api/admin/privacy/export/:userId",
  requireAdminCapability("privacy.export"),
  requireAdminStepUp,
  route(async (req, res) => {
    const userId = numberId(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Utilisateur invalide" });
    let payload;
    try {
      payload = await buildUserDataExport(userId, { allowDeleted: true });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || "Export impossible" });
    }
    await writeAdminAudit(pool, {
      actor: adminActorFromReq(req),
      action: "privacy.export_generated",
      targetType: "user",
      targetId: userId,
      justification: text(req.query.reason, 1000) || "Export administratif des données personnelles",
      details: {
        username: payload.profile?.username || null,
        deletedAt: payload.profile?.deletedAt || null,
        collectionEntries: Object.keys(payload.collection || {}).length
      }
    });
    res.setHeader("Content-Disposition", `attachment; filename="sprite-index_admin_export_${userId}.json"`);
    res.json(payload);
  })
);

app.post(
  "/api/admin/privacy/purge",
  requireAdminCapability("privacy.purge"),
  requireAdminStepUp,
  adminMutationLimiter,
  route(async (req, res) => {
    const body = jsonValue(req.body);
    const reason = text(body.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Une justification est requise" });
    const userId = body.userId == null || body.userId === "" ? null : numberId(body.userId);
    if (body.userId != null && body.userId !== "" && !userId) {
      return res.status(400).json({ error: "Utilisateur invalide" });
    }
    const force = body.force === true;
    if (force && !userId) {
      return res.status(400).json({ error: "La purge anticipée exige un compte précis" });
    }
    const limit = Math.max(1, Math.min(50, Number(body.limit) || 25));

    const result = await withAdminAudit(
      async (client) => {
        const purged = await purgeDeletedAccounts({
          db: client,
          userId,
          limit,
          force,
          olderThanDays: force ? 0 : retentionDays()
        });
        if (userId && !purged.purged.length) {
          throw notFound(
            force
              ? "Compte introuvable ou non marqué pour suppression"
              : "Compte pas encore éligible à la purge (délai de rétention)"
          );
        }
        return purged;
      },
      (purged) => ({
        actor: adminActorFromReq(req),
        action: force ? "privacy.account_force_purged" : userId ? "privacy.account_purged" : "privacy.accounts_purged",
        targetType: userId ? "user" : "privacy",
        targetId: userId || "deletion-queue",
        justification: reason,
        details: {
          force,
          limit,
          retentionDays: retentionDays(),
          purgedIds: purged.purged.map((item) => item.id),
          purgedUsernames: purged.purged.map((item) => item.username)
        }
      })
    );

    res.json({
      ok: true,
      purged: result.purged,
      count: result.purged.length,
      retentionDays: result.retentionDays
    });
  })
);

app.post(
  "/api/admin/privacy/restore",
  requireAdminCapability("privacy.restore"),
  requireAdminStepUp,
  adminMutationLimiter,
  route(async (req, res) => {
    const body = jsonValue(req.body);
    const userId = numberId(body.userId);
    const reason = text(body.reason, 1000);
    if (!userId || !reason) return res.status(400).json({ error: "Compte et justification requis" });
    const user = await withAdminAudit(
      async (client) => {
        return restoreDeletedAccount(userId, { db: client });
      },
      (restored) => ({
        actor: adminActorFromReq(req),
        action: "privacy.account_restored",
        targetType: "user",
        targetId: userId,
        justification: reason,
        details: { username: restored.username }
      })
    );
    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.created_at,
        lastActiveAt: user.last_active_at
      }
    });
  })
);

app.post(
  "/api/admin/privacy/revoke-share-links",
  requireAdminCapability("privacy.revoke_links"),
  requireAdminStepUp,
  adminMutationLimiter,
  route(async (req, res) => {
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Une justification est requise" });
    const revoked = await withAdminAudit(
      async (client) => {
        return revokeActiveShareCapabilities({ db: client });
      },
      (result) => ({
        actor: adminActorFromReq(req),
        action: "privacy.share_links_revoked",
        targetType: "privacy",
        targetId: "share-links",
        justification: reason,
        details: result
      })
    );
    res.json({ ok: true, revoked });
  })
);
