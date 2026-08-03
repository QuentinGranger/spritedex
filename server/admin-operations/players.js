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

// ── 2. Players & moderation ────────────────────────────────────────────────

// Deliberately return operational identifiers and labels only: universal search
// is navigation, never an export of private profiles, notes or credentials.
app.get(
  "/api/admin/search",
  requireAdminCapability(),
  route(async (req, res) => {
    const q = text(req.query.q, 100);
    if (!q || q.length < 2) return res.json({ query: q || "", groups: [] });
    const needle = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const allowed = (capability) => hasCapability(req.adminSession, capability);
    const tasks = [];
    const add = (key, label, capability, query, map) => {
      if (!allowed(capability)) return;
      tasks.push(query().then((result) => ({ key, label, items: result.rows.map(map) })));
    };
    add(
      "players",
      "Joueurs",
      "players.read",
      () =>
        pool.query(
          `SELECT id, username, display_name, suspended_until FROM users
     WHERE deleted_at IS NULL AND (username ILIKE $1 ESCAPE '\\' OR COALESCE(display_name, '') ILIKE $1 ESCAPE '\\')
     ORDER BY last_active_at DESC NULLS LAST LIMIT 8`,
          [needle]
        ),
      (row) => ({
        id: String(row.id),
        title: row.display_name || row.username,
        subtitle: `@${row.username}${row.suspended_until && new Date(row.suspended_until) > new Date() ? " · suspendu" : ""}`,
        action: "player"
      })
    );
    add(
      "catalog",
      "Sprites & variantes",
      "catalog.read",
      () =>
        pool.query(
          `SELECT s.id, s.name, s.rarity, NULL::text AS variant_id, NULL::text AS variant_name FROM sprites s WHERE s.id ILIKE $1 ESCAPE '\\' OR s.name ILIKE $1 ESCAPE '\\'
     UNION ALL
     SELECT sv.sprite_id AS id, s.name, sv.rarity, sv.id AS variant_id, sv.name AS variant_name FROM sprite_variants sv JOIN sprites s ON s.id = sv.sprite_id WHERE sv.id ILIKE $1 ESCAPE '\\' OR sv.name ILIKE $1 ESCAPE '\\'
     LIMIT 12`,
          [needle]
        ),
      (row) => ({
        id: row.variant_id || row.id,
        parentId: row.id,
        title: row.variant_name || row.name,
        subtitle: row.variant_id
          ? `Variante · ${row.name}${row.rarity ? ` · ${row.rarity}` : ""}`
          : `Sprite${row.rarity ? ` · ${row.rarity}` : ""}`,
        action: "catalog"
      })
    );
    add(
      "events",
      "Événements",
      "events.read",
      () =>
        pool.query(
          "SELECT id, name, type, end_date, data_status FROM events WHERE id ILIKE $1 ESCAPE '\\' OR name ILIKE $1 ESCAPE '\\' ORDER BY end_date DESC NULLS LAST LIMIT 8",
          [needle]
        ),
      (row) => ({
        id: row.id,
        title: row.name || row.id,
        subtitle: `${row.type || "événement"} · ${row.data_status || "inconnu"}`,
        action: "event"
      })
    );
    add(
      "squads",
      "Squads",
      "social.read",
      () =>
        pool.query(
          `SELECT s.id, s.name, s.code, s.visibility,
            (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.squad_id = s.id AND sm.status = 'active') AS member_count
     FROM squads s WHERE s.name ILIKE $1 ESCAPE '\\' OR s.code ILIKE $1 ESCAPE '\\'
     ORDER BY member_count DESC NULLS LAST LIMIT 8`,
          [needle]
        ),
      (row) => ({
        id: String(row.id),
        title: row.name,
        subtitle: `${row.code} · ${row.member_count || 0} membres · ${row.visibility || "—"}`,
        action: "squad"
      })
    );
    add(
      "invitations",
      "Invitations",
      "social.read",
      () =>
        pool.query(
          `SELECT * FROM (
       SELECT si.id::text AS id, si.squad_id::text AS squad_id, s.name AS squad_name, inviter.username AS inviter, invitee.username AS invitee, si.status, si.created_at, 'squad'::text AS invitation_kind
       FROM squad_invitations si JOIN squads s ON s.id = si.squad_id JOIN users inviter ON inviter.id = si.inviter_id JOIN users invitee ON invitee.id = si.invitee_id
       WHERE s.name ILIKE $1 ESCAPE '\\' OR inviter.username ILIKE $1 ESCAPE '\\' OR invitee.username ILIKE $1 ESCAPE '\\' OR si.id::text ILIKE $1 ESCAPE '\\'
       UNION ALL
       SELECT fil.id::text AS id, NULL::text AS squad_id, NULL::text AS squad_name, owner.username AS inviter, NULL::text AS invitee,
              CASE WHEN fil.revoked_at IS NOT NULL THEN 'revoked' WHEN fil.expires_at IS NOT NULL AND fil.expires_at <= NOW() THEN 'expired' ELSE 'active' END AS status,
              fil.created_at, 'friend'::text AS invitation_kind
       FROM friend_invite_links fil JOIN users owner ON owner.id = fil.owner_id
       WHERE owner.username ILIKE $1 ESCAPE '\\' OR fil.id::text ILIKE $1 ESCAPE '\\'
     ) invitations ORDER BY created_at DESC LIMIT 8`,
          [needle]
        ),
      (row) =>
        row.invitation_kind === "friend"
          ? { id: row.id, title: `@${row.inviter}`, subtitle: `Lien d’ami · ${row.status}`, action: "friendInvite" }
          : {
              id: row.id,
              parentId: row.squad_id,
              title: `${row.squad_name} · @${row.invitee}`,
              subtitle: `Invitation de @${row.inviter} · ${row.status}`,
              action: "invitation"
            }
    );
    add(
      "notifications",
      "Notifications",
      "notifications.read",
      () =>
        pool.query(
          "SELECT id, channels, status, attempts, last_error FROM notification_delivery_queue WHERE id::text ILIKE $1 ESCAPE '\\' OR COALESCE(last_error, '') ILIKE $1 ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8",
          [needle]
        ),
      (row) => ({
        id: String(row.id),
        title: `Livraison #${row.id}`,
        subtitle: `${(row.channels || []).join(", ") || "notification"} · ${row.status} · tentative ${row.attempts}`,
        action: "notification"
      })
    );
    add(
      "audit",
      "Actions d’administration",
      "audit.read",
      () =>
        pool.query(
          "SELECT id, action, target_type, target_id, actor, created_at FROM admin_audit_log WHERE id::text ILIKE $1 ESCAPE '\\' OR action ILIKE $1 ESCAPE '\\' OR COALESCE(target_id, '') ILIKE $1 ESCAPE '\\' OR actor ILIKE $1 ESCAPE '\\' ORDER BY created_at DESC LIMIT 8",
          [needle]
        ),
      (row) => ({
        id: String(row.id),
        title: row.action,
        subtitle: `${row.target_type || "action"}${row.target_id ? ` · ${row.target_id}` : ""} · ${row.actor || "—"}`,
        action: "audit"
      })
    );
    const groups = (await Promise.all(tasks)).filter((group) => group.items.length);
    res.json({ query: q, groups });
  })
);

app.get(
  "/api/admin/players",
  requireAdminCapability("players.read"),
  route(async (req, res) => {
    const { page, pageSize, offset } = pagination(req);
    const query = text(req.query.q, 80);
    const state = text(req.query.state, 20) || "all";
    const filters = ["u.deleted_at IS NULL"];
    const values = [];
    if (query) {
      values.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
      filters.push(
        `(u.username ILIKE $${values.length} ESCAPE '\\' OR COALESCE(u.display_name, '') ILIKE $${values.length} ESCAPE '\\')`
      );
    }
    if (state === "suspended") filters.push("u.suspended_until > NOW()");
    if (state === "reported")
      filters.push("EXISTS (SELECT 1 FROM user_reports ur WHERE ur.reported_id = u.id AND ur.status = 'open')");
    if (state === "new") filters.push("u.created_at >= NOW() - INTERVAL '7 days'");
    const where = filters.join(" AND ");
    values.push(pageSize, offset);
    const [list, count] = await Promise.all([
      pool.query(
        `SELECT u.id, u.username, u.display_name, u.created_at, u.last_active_at,
              u.suspended_at, u.suspended_until, u.suspension_source, u.suspension_reason, u.email_verified,
              COALESCE(ps.owned_variant_count, 0)::int AS owned_variants,
              COALESCE(ps.released_variant_count, 0)::int AS released_variants,
              COALESCE(ps.completion_rate, 0)::float AS completion_rate,
              (SELECT COUNT(*)::int FROM user_reports ur WHERE ur.reported_id = u.id AND ur.status = 'open') AS open_reports,
              (SELECT COUNT(*)::int FROM friend_invite_links fil WHERE fil.owner_id = u.id AND fil.revoked_at IS NULL AND (fil.expires_at IS NULL OR fil.expires_at > NOW())) AS active_invites
       FROM users u
       LEFT JOIN user_passport_summaries ps ON ps.user_id = u.id
       WHERE ${where}
       ORDER BY u.last_active_at DESC NULLS LAST, u.id DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM users u WHERE ${where}`, values.slice(0, -2))
    ]);
    res.json(
      paged(
        list.rows.map((row) => ({
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          createdAt: row.created_at,
          lastActiveAt: row.last_active_at,
          suspendedAt: row.suspended_at,
          suspendedUntil: row.suspended_until,
          suspensionSource: row.suspension_source,
          suspensionReason: row.suspension_reason,
          emailVerified: row.email_verified,
          collection: {
            ownedVariants: row.owned_variants,
            releasedVariants: row.released_variants,
            completionRate: row.completion_rate
          },
          openReports: row.open_reports,
          activeInvites: row.active_invites
        })),
        count.rows[0]?.count,
        { page, pageSize }
      )
    );
  })
);
