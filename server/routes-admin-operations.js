"use strict";

// Operational backoffice APIs. These routes are deliberately separate from
// product APIs: every request requires the terminal-admin cookie, all writes
// are auditable, and list endpoints return operational summaries instead of
// private collection notes, e-mails or bearer capabilities.

const crypto = require("crypto");
const { app } = require("./core");
const { pool } = require("./db");
const { requireAdminCapability, requireAdminStepUp } = require("./routes-admin");
const { adminActorFromReq, listActiveAdminSessions } = require("./admin-access");
const { describeAuthz, hasCapability } = require("./admin-authz");
const { isAdminMfaConfigured } = require("./admin-totp");
const { revokeUserSockets } = require("./ws");
const { invalidateSquadAnalysisCacheForUser } = require("./squad-analysis-cache");
const { enqueuePassportRecalc } = require("./passport-summary");
const { processDeliveryQueue } = require("./notification-delivery-queue");
const { syncCatalogueMetaAndFanout } = require("./passport-summary");
const { fanoutPublishedNews } = require("./news");
const { buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities } = require("./privacy-ops");
const { rateLimit } = require("../security");
const { writeAdminAudit, withAdminAudit, AdminHttpError, notFound } = require("./admin-audit");

const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyPrefix: "admin-mutation",
  message: "Trop d’actions administratives. Réessaie dans quelques minutes."
});

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_AUDIT_EXPORT_ROWS = 5000;
const REPORT_STATUSES = new Set(["open", "resolved", "dismissed"]);
const REPORT_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const APPEAL_STATUSES = new Set(["none", "received", "accepted", "rejected"]);
const NEWS_STATUSES = new Set(["draft", "published", "archived"]);
const DATA_STATUSES = new Set(["complete", "incomplete", "verified", "unknown"]);
const AVAILABILITY_STATUSES = new Set(["available", "upcoming", "ended", "not_observed", "unknown"]);
const CONFIDENCE_LEVELS = new Set(["confirmed", "high", "medium", "low", "unknown"]);
const EDITORIAL_STATUSES = new Set(["draft", "review", "published"]);

function numberId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function pagination(req) {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(Number(req.query.pageSize) || PAGE_SIZE)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function text(value, max = 500) {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
}

function nullableDate(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function jsonValue(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function validUrl(value) {
  const raw = text(value, 2000);
  if (!raw) return null;
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch (_) {
    return null;
  }
}

function validAssetUrl(value) {
  const external = validUrl(value);
  if (external) return external;
  const raw = text(value, 2000);
  // Catalog assets may be shipped as a relative application path (for example
  // `Sprite/Water.png`). Keep the accepted alphabet deliberately narrow.
  return raw && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(raw) ? raw : null;
}

async function audit(action, targetType, targetId, { justification = null, details = {}, actor = "unknown", requireJustification = true } = {}) {
  // Prefer withAdminAudit() for DB mutations so write + audit commit together.
  // Side-effectful jobs (queue flush, passport enqueue) still call this after
  // the work; failures surface instead of being swallowed.
  await writeAdminAudit(pool, {
    actor,
    action,
    targetType,
    targetId,
    justification,
    details,
    requireJustification
  });
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("[admin] operation failed:", error.message);
      if (res.headersSent) return;
      if (error instanceof AdminHttpError || (Number.isInteger(error.status) && error.status >= 400 && error.status < 600)) {
        return res.status(error.status).json({ error: error.message || "Requête invalide" });
      }
      res.status(500).json({ error: "Opération administrative indisponible" });
    }
  };
}

function paged(rows, count, { page, pageSize }) {
  return {
    items: rows,
    page,
    pageSize,
    total: Number(count) || 0,
    hasMore: page * pageSize < (Number(count) || 0)
  };
}

// Audit details can include operational metadata, but the journal must never
// turn into a secondary store for credentials, network identifiers or raw
// personal data. Keep the useful before/after snapshots and redact unsafe
// keys before a row leaves the API.
const AUDIT_PRIVATE_DETAIL_KEY = /(?:password|secret|token|email|\bip\b|user.?agent|mfa|totp|code)/i;
function safeAuditDetails(value, depth = 0) {
  if (depth > 4 || value == null) return value == null ? value : "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 24).map((item) => safeAuditDetails(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
      key,
      AUDIT_PRIVATE_DETAIL_KEY.test(key) ? "[redacted]" : safeAuditDetails(item, depth + 1)
    ]));
  }
  return typeof value === "string" ? value.slice(0, 1000) : value;
}

function auditRowForAdmin(row) {
  return { ...row, details: safeAuditDetails(jsonValue(row.details)) };
}

function auditFilters(query = {}) {
  const values = [];
  const clauses = [];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
  const q = text(query.q, 120);
  const actor = text(query.actor, 80);
  const action = text(query.action, 100);
  const targetType = text(query.targetType, 60);
  const from = nullableDate(query.from);
  const rawTo = text(query.to, 40);
  let to = nullableDate(rawTo);
  // A date picker describes a complete local calendar day to the operator.
  // Make the end bound inclusive instead of silently omitting that day after
  // midnight.
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(rawTo || "")) {
    to = new Date(`${rawTo}T23:59:59.999Z`).toISOString();
  }
  if (from === undefined || to === undefined) return { error: "Date d’audit invalide" };
  if (q) {
    const pattern = `%${q}%`;
    values.push(pattern);
    const marker = `$${values.length}`;
    clauses.push(`(actor ILIKE ${marker} OR action ILIKE ${marker} OR target_type ILIKE ${marker} OR COALESCE(target_id, '') ILIKE ${marker} OR COALESCE(justification, '') ILIKE ${marker})`);
  }
  if (actor) add("actor ILIKE ?", `%${actor}%`);
  if (action) add("action = ?", action);
  if (targetType) add("target_type = ?", targetType);
  if (from) add("created_at >= ?::timestamptz", from);
  if (to) add("created_at <= ?::timestamptz", to);
  return { values, where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "" };
}

function csvCell(value) {
  const raw = String(value == null ? "" : value).replace(/\r?\n/g, " ");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

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

// ── 2. Players & moderation ────────────────────────────────────────────────

// Deliberately return operational identifiers and labels only: universal search
// is navigation, never an export of private profiles, notes or credentials.
app.get("/api/admin/search", requireAdminCapability(), route(async (req, res) => {
  const q = text(req.query.q, 100);
  if (!q || q.length < 2) return res.json({ query: q || "", groups: [] });
  const needle = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const allowed = (capability) => hasCapability(req.adminSession, capability);
  const tasks = [];
  const add = (key, label, capability, query, map) => {
    if (!allowed(capability)) return;
    tasks.push(query().then((result) => ({ key, label, items: result.rows.map(map) })));
  };
  add("players", "Joueurs", "players.read", () => pool.query(
    `SELECT id, username, display_name, suspended_until FROM users
     WHERE deleted_at IS NULL AND (username ILIKE $1 ESCAPE '\\' OR COALESCE(display_name, '') ILIKE $1 ESCAPE '\\')
     ORDER BY last_active_at DESC NULLS LAST LIMIT 8`, [needle]),
  (row) => ({ id: String(row.id), title: row.display_name || row.username, subtitle: `@${row.username}${row.suspended_until && new Date(row.suspended_until) > new Date() ? " · suspendu" : ""}`, action: "player" }));
  add("catalog", "Sprites & variantes", "catalog.read", () => pool.query(
    `SELECT s.id, s.name, s.rarity, NULL::text AS variant_id, NULL::text AS variant_name FROM sprites s WHERE s.id ILIKE $1 ESCAPE '\\' OR s.name ILIKE $1 ESCAPE '\\'
     UNION ALL
     SELECT sv.sprite_id AS id, s.name, sv.rarity, sv.id AS variant_id, sv.name AS variant_name FROM sprite_variants sv JOIN sprites s ON s.id = sv.sprite_id WHERE sv.id ILIKE $1 ESCAPE '\\' OR sv.name ILIKE $1 ESCAPE '\\'
     LIMIT 12`, [needle]),
  (row) => ({ id: row.variant_id || row.id, parentId: row.id, title: row.variant_name || row.name, subtitle: row.variant_id ? `Variante · ${row.name}${row.rarity ? ` · ${row.rarity}` : ""}` : `Sprite${row.rarity ? ` · ${row.rarity}` : ""}`, action: "catalog" }));
  add("events", "Événements", "events.read", () => pool.query(
    "SELECT id, name, type, end_date, data_status FROM events WHERE id ILIKE $1 ESCAPE '\\' OR name ILIKE $1 ESCAPE '\\' ORDER BY end_date DESC NULLS LAST LIMIT 8", [needle]),
  (row) => ({ id: row.id, title: row.name || row.id, subtitle: `${row.type || "événement"} · ${row.data_status || "inconnu"}`, action: "event" }));
  add("squads", "Squads", "social.read", () => pool.query(
    `SELECT s.id, s.name, s.code, s.visibility,
            (SELECT COUNT(*)::int FROM squad_members sm WHERE sm.squad_id = s.id AND sm.status = 'active') AS member_count
     FROM squads s WHERE s.name ILIKE $1 ESCAPE '\\' OR s.code ILIKE $1 ESCAPE '\\'
     ORDER BY member_count DESC NULLS LAST LIMIT 8`, [needle]),
  (row) => ({ id: String(row.id), title: row.name, subtitle: `${row.code} · ${row.member_count || 0} membres · ${row.visibility || "—"}`, action: "squad" }));
  add("invitations", "Invitations", "social.read", () => pool.query(
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
     ) invitations ORDER BY created_at DESC LIMIT 8`, [needle]),
  (row) => row.invitation_kind === "friend"
    ? ({ id: row.id, title: `@${row.inviter}`, subtitle: `Lien d’ami · ${row.status}`, action: "friendInvite" })
    : ({ id: row.id, parentId: row.squad_id, title: `${row.squad_name} · @${row.invitee}`, subtitle: `Invitation de @${row.inviter} · ${row.status}`, action: "invitation" }));
  add("notifications", "Notifications", "notifications.read", () => pool.query(
    "SELECT id, channels, status, attempts, last_error FROM notification_delivery_queue WHERE id::text ILIKE $1 ESCAPE '\\' OR COALESCE(last_error, '') ILIKE $1 ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8", [needle]),
  (row) => ({ id: String(row.id), title: `Livraison #${row.id}`, subtitle: `${(row.channels || []).join(", ") || "notification"} · ${row.status} · tentative ${row.attempts}`, action: "notification" }));
  add("audit", "Actions d’administration", "audit.read", () => pool.query(
    "SELECT id, action, target_type, target_id, actor, created_at FROM admin_audit_log WHERE id::text ILIKE $1 ESCAPE '\\' OR action ILIKE $1 ESCAPE '\\' OR COALESCE(target_id, '') ILIKE $1 ESCAPE '\\' OR actor ILIKE $1 ESCAPE '\\' ORDER BY created_at DESC LIMIT 8", [needle]),
  (row) => ({ id: String(row.id), title: row.action, subtitle: `${row.target_type || "action"}${row.target_id ? ` · ${row.target_id}` : ""} · ${row.actor || "—"}`, action: "audit" }));
  const groups = (await Promise.all(tasks)).filter((group) => group.items.length);
  res.json({ query: q, groups });
}));

app.get("/api/admin/players", requireAdminCapability("players.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const query = text(req.query.q, 80);
  const state = text(req.query.state, 20) || "all";
  const filters = ["u.deleted_at IS NULL"];
  const values = [];
  if (query) {
    values.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
    filters.push(`(u.username ILIKE $${values.length} ESCAPE '\\' OR COALESCE(u.display_name, '') ILIKE $${values.length} ESCAPE '\\')`);
  }
  if (state === "suspended") filters.push("u.suspended_until > NOW()");
  if (state === "reported") filters.push("EXISTS (SELECT 1 FROM user_reports ur WHERE ur.reported_id = u.id AND ur.status = 'open')");
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
  res.json(paged(list.rows.map(row => ({
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
    collection: { ownedVariants: row.owned_variants, releasedVariants: row.released_variants, completionRate: row.completion_rate },
    openReports: row.open_reports,
    activeInvites: row.active_invites
  })), count.rows[0]?.count, { page, pageSize }));
}));

app.patch("/api/admin/players/:userId/suspension", requireAdminCapability("players.moderate"), adminMutationLimiter, route(async (req, res) => {
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
    if (new Date(until) <= new Date()) return res.status(400).json({ error: "La suspension doit se terminer dans le futur" });
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
}));

app.get("/api/admin/players/:userId", requireAdminCapability("players.read"), route(async (req, res) => {
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
    appeal: { status: item.appeal_status, message: item.appeal_message, createdAt: item.appeal_created_at, reviewedAt: item.appeal_reviewed_at, resolution: item.appeal_resolution },
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
}));

app.get("/api/admin/players/:userId/suspension-history", requireAdminCapability("players.read"), route(async (req, res) => {
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
}));

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

// ── 3. Catalogue ───────────────────────────────────────────────────────────

app.get("/api/admin/catalog", requireAdminCapability("catalog.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const query = text(req.query.q, 100);
  const status = text(req.query.status, 20);
  const values = [];
  const where = [];
  const normalizedSlug = (alias) => `COALESCE(NULLIF(${alias}.slug, ''), REPLACE(REGEXP_REPLACE(${alias}.id, '^sprite_', ''), '_', '-'))`;
  // A legacy import created short ids ("striker") beside the canonical
  // "sprite_striker" rows. Keep legacy rows reachable through the integrity
  // filter, but never mix them into the day-to-day editorial catalogue.
  if (status !== "data_issues") where.push(`NOT EXISTS (
    SELECT 1 FROM sprites canonical
    WHERE canonical.id <> s.id AND canonical.id LIKE 'sprite\\_%' ESCAPE '\\'
      AND ${normalizedSlug("canonical")} = ${normalizedSlug("s")}
  )`);
  if (query) {
    values.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(s.name ILIKE $${values.length} ESCAPE '\\' OR s.id ILIKE $${values.length} ESCAPE '\\')`);
  }
  if (EDITORIAL_STATUSES.has(status)) where.push(`COALESCE(s.editorial_status, CASE WHEN s.is_released IS FALSE THEN 'draft' ELSE 'published' END) = '${status}'`);
  if (status === "needs_review") where.push("s.data_status IS NULL OR s.data_status IN ('incomplete', 'unknown')");
  if (status === "data_issues") where.push(`
    EXISTS (SELECT 1 FROM sprites canonical_issue
            WHERE canonical_issue.id <> s.id AND canonical_issue.id LIKE 'sprite\\_%' ESCAPE '\\'
              AND ${normalizedSlug("canonical_issue")} = ${normalizedSlug("s")})
    OR (NOT EXISTS (SELECT 1 FROM sprite_variants sv_issue WHERE sv_issue.sprite_id = s.id)
        AND COALESCE(CARDINALITY(s.variants), 0) = 0)
    OR (NULLIF(BTRIM(s.image), '') IS NULL
        AND NOT EXISTS (SELECT 1 FROM sprite_images si_issue WHERE si_issue.sprite_id = s.id))
  `);
  if (status === "unreleased") where.push("s.is_released IS FALSE");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  values.push(pageSize, offset);
  const [list, count] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.rarity, s.color, s.available,
              COALESCE(NULLIF(BTRIM(s.image), ''),
                (SELECT COALESCE(NULLIF(BTRIM(sv_preview.image_path), ''), NULLIF(BTRIM(sv_preview.suggested_image_path), ''))
                 FROM sprite_variants sv_preview
                 WHERE sv_preview.sprite_id = s.id
                 ORDER BY CASE WHEN LOWER(sv_preview.variant_type) = 'base' THEN 0 ELSE 1 END, sv_preview.updated_at DESC NULLS LAST
                 LIMIT 1),
                (SELECT NULLIF(BTRIM(si_preview.image_path), '')
                 FROM sprite_images si_preview
                 WHERE si_preview.sprite_id = s.id
                 ORDER BY CASE WHEN LOWER(si_preview.variant) = 'base' THEN 0 ELSE 1 END, si_preview.variant
                 LIMIT 1)
              ) AS image, s.event_id, s.season_id,
              s.data_status, s.is_released, s.editorial_status, s.editorial_updated_at, s.last_verified_at, s.catalog_version,
              GREATEST(COUNT(sv.id)::int, COALESCE(CARDINALITY(s.variants), 0))::int AS variant_count,
              COUNT(sv.id) FILTER (WHERE sv.data_status IS NULL OR sv.data_status IN ('incomplete', 'unknown'))::int AS variants_needing_review,
              COUNT(*) OVER (PARTITION BY LOWER(s.name))::int AS same_name_records
       FROM sprites s
       LEFT JOIN sprite_variants sv ON sv.sprite_id = s.id
       ${clause}
       GROUP BY s.id
       ORDER BY variant_count DESC, s.last_verified_at DESC NULLS LAST, s.name ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprites s ${clause}`, values.slice(0, -2))
  ]);
  res.json(paged(list.rows.map(row => ({
    id: row.id, name: row.name, rarity: row.rarity, color: row.color, available: row.available,
    image: row.image, eventId: row.event_id, seasonId: row.season_id, dataStatus: row.data_status,
    isReleased: row.is_released, editorialStatus: row.editorial_status || (row.is_released === false ? "draft" : "published"), editorialUpdatedAt: row.editorial_updated_at, lastVerifiedAt: row.last_verified_at, catalogVersion: row.catalog_version,
    variantCount: row.variant_count, variantsNeedingReview: row.variants_needing_review, sameNameRecords: row.same_name_records
  })), count.rows[0]?.count, { page, pageSize }));
}));

app.get("/api/admin/catalog/:spriteId", requireAdminCapability("catalog.read"), route(async (req, res) => {
  const sprite = await pool.query(
    `SELECT id, catalog_id, slug, name, official_name, rarity, color, effect, variants, available, image, event_id, season_id,
            introduced_in_update, first_observed_at, last_verified_at, officially_announced_at, ability, acquisition,
            availability, recurrence, dates, missing_fields, base_summon_cost, data_status, notes, sources, catalog_version,
            catalog_generated_at, is_released, editorial_status, editorial_updated_at
     FROM sprites WHERE id = $1`, [req.params.spriteId]
  );
  if (!sprite.rows.length) return res.status(404).json({ error: "Sprite introuvable" });
  const [variants, availability, history, spriteImages] = await Promise.all([
    pool.query(`SELECT id, sprite_id, variant_type, name, official_name, slug, rarity, image_path, suggested_image_path,
                       release_status, first_observed_at, summon_cost, sprite_chest_drop_chance_pct, extra_effect_ref,
                       effect, acquisition, availability, recurrence, dates, missing_fields, data_status, sources, editorial_status, editorial_updated_at, updated_at
                FROM sprite_variants WHERE sprite_id = $1 ORDER BY variant_type`, [req.params.spriteId]),
    pool.query(`SELECT id, start_date, end_date, status, event_id, confidence, data_status, sources, updated_at
                FROM availability_periods WHERE sprite_id = $1 ORDER BY start_date DESC NULLS LAST`, [req.params.spriteId]),
    pool.query(`SELECT id, entity_type, field, previous_value, new_value, changed_by, changed_at, reason, source_id
                FROM catalog_change_history WHERE entity_id = $1 ORDER BY changed_at DESC LIMIT 20`, [req.params.spriteId]),
    pool.query("SELECT variant, image_path FROM sprite_images WHERE sprite_id = $1", [req.params.spriteId])
  ]);
  // Some production databases still have the original seed representation:
  // `sprites.variants` + `sprite_images`, before `sprite_variants` existed.
  // Expose those as read-only compatibility rows instead of pretending the
  // sprite has no variants in the admin UI.
  const imageByVariant = new Map(spriteImages.rows.map((row) => [String(row.variant || "").toLowerCase(), row.image_path]));
  const relationalTypes = new Set(variants.rows.map((row) => String(row.variant_type || "").toLowerCase()));
  const compatibilityVariants = (Array.isArray(sprite.rows[0].variants) ? sprite.rows[0].variants : [])
    .filter((variant) => !relationalTypes.has(String(variant).toLowerCase()))
    .map((variant) => ({
      id: `${sprite.rows[0].id}::${variant}`,
      sprite_id: sprite.rows[0].id,
      variant_type: variant,
      name: variant,
      rarity: sprite.rows[0].rarity,
      image_path: imageByVariant.get(String(variant).toLowerCase()) || null,
      suggested_image_path: null,
      release_status: null,
      data_status: sprite.rows[0].data_status || "unknown",
      editorial_status: sprite.rows[0].editorial_status || "published",
      is_compatibility_variant: true
    }));
  res.json({ sprite: sprite.rows[0], variants: [...variants.rows, ...compatibilityVariants], availabilityPeriods: availability.rows, history: history.rows });
}));

const spriteEditableFields = {
  catalogId: { column: "catalog_id", limit: 50 }, slug: { column: "slug", limit: 50 }, name: { column: "name", limit: 100 }, officialName: { column: "official_name", limit: 100 }, rarity: { column: "rarity", limit: 30 }, color: { column: "color", limit: 60 },
  effect: { column: "effect", limit: 2000 }, variants: { column: "variants", array: true }, available: { column: "available", limit: 20 }, image: { column: "image", url: true, asset: true },
  eventId: { column: "event_id", limit: 100 }, seasonId: { column: "season_id", limit: 50 }, dataStatus: { column: "data_status", limit: 20 },
  introducedInUpdate: { column: "introduced_in_update", limit: 20 }, firstObservedAt: { column: "first_observed_at", date: true }, lastVerifiedAt: { column: "last_verified_at", date: true }, officiallyAnnouncedAt: { column: "officially_announced_at", date: true }, baseSummonCost: { column: "base_summon_cost", integer: true },
  ability: { column: "ability", json: true }, acquisition: { column: "acquisition", json: true }, availability: { column: "availability", json: true }, recurrence: { column: "recurrence", json: true }, dates: { column: "dates", json: true }, missingFields: { column: "missing_fields", json: true }, notes: { column: "notes", json: true }, sources: { column: "sources", json: true }, catalogVersion: { column: "catalog_version", limit: 32 }, isReleased: { column: "is_released", boolean: true }
};

function editableUpdates(raw, fields) {
  const updates = [];
  for (const [key, rule] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    let value;
    if (rule.boolean) value = raw[key] === true;
    else if (rule.array) { try { value = raw[key] === "" || raw[key] == null ? [] : (typeof raw[key] === "string" ? JSON.parse(raw[key]) : raw[key]); if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.length > 100)) return { error: `Liste invalide : ${key}` }; } catch (_) { return { error: `JSON invalide : ${key}` }; } }
    else if (rule.integer) { value = raw[key] === "" || raw[key] == null ? null : Number(raw[key]); if (value != null && (!Number.isInteger(value) || value < 0)) return { error: `Nombre invalide : ${key}` }; }
    else if (rule.decimal) { value = raw[key] === "" || raw[key] == null ? null : Number(raw[key]); if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) return { error: `Nombre invalide : ${key}` }; }
    else if (rule.json) {
      if (raw[key] === "" || raw[key] == null) value = null;
      else { try { value = typeof raw[key] === "string" ? JSON.parse(raw[key]) : raw[key]; } catch (_) { return { error: `JSON invalide : ${key}` }; } }
    }
    else if (rule.date) {
      value = nullableDate(raw[key]);
      if (value === undefined) return { error: `Date invalide : ${key}` };
    } else if (rule.url) {
      value = rule.asset ? validAssetUrl(raw[key]) : validUrl(raw[key]);
      if (raw[key] && !value) return { error: `URL invalide : ${key}` };
    } else {
      value = text(raw[key], rule.limit);
      if (key === "dataStatus" && value && !DATA_STATUSES.has(value)) return { error: "Statut de donnée invalide" };
    }
    updates.push({ key, column: rule.column, value });
  }
  return { updates };
}

async function updateCatalogEntity({ table, idColumn, id, fields, entityType, body, actor = "unknown" }) {
  const raw = jsonValue(body.updates, body);
  const parsed = editableUpdates(raw, fields);
  if (parsed.error) return { error: parsed.error, status: 400 };
  if (!parsed.updates.length) return { error: "Aucune modification valide", status: 400 };
  const reason = text(body.reason, 1000);
  if (!reason) return { error: "Une justification est requise", status: 400 };
  const columns = parsed.updates.map(change => change.column);
  const before = await pool.query(`SELECT ${columns.map(column => `"${column}"`).join(", ")} FROM ${table} WHERE ${idColumn} = $1`, [id]);
  if (!before.rows.length) return { error: "Élément introuvable", status: 404 };
  const values = [id, ...parsed.updates.map(change => change.value)];
  const set = parsed.updates.map((change, index) => `${change.column} = $${index + 2}`).join(", ");
  const updated = await withAdminAudit(async (client) => {
    const result = await client.query(
      `UPDATE ${table} SET ${set}${table === "sprite_variants" ? ", updated_at = NOW()" : ""} WHERE ${idColumn} = $1 RETURNING *`,
      values
    );
    for (const change of parsed.updates) {
      await client.query(
        `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [entityType, String(id), change.key, JSON.stringify(before.rows[0][change.column]), JSON.stringify(change.value), text(actor, 100) || "backoffice", reason]
      );
    }
    return result.rows[0];
  }, {
    actor,
    action: "catalog.updated",
    targetType: entityType,
    targetId: id,
    justification: reason,
    details: {
      fields: parsed.updates.map(change => change.key),
      changes: Object.fromEntries(parsed.updates.map((change) => [change.key, {
        before: before.rows[0][change.column],
        after: change.value
      }]))
    }
  });
  return { value: updated, releasedChanged: parsed.updates.some(change => change.key === "isReleased") };
}

app.patch("/api/admin/catalog/:spriteId", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const result = await updateCatalogEntity({ table: "sprites", idColumn: "id", id: req.params.spriteId, fields: spriteEditableFields, entityType: "sprite", body: jsonValue(req.body), actor: adminActorFromReq(req) });
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (result.releasedChanged) syncCatalogueMetaAndFanout().catch(error => console.error("[admin] catalog fanout:", error.message));
  res.json({ ok: true, sprite: result.value });
}));

const variantEditableFields = {
  name: { column: "name", limit: 100 }, officialName: { column: "official_name", limit: 100 }, slug: { column: "slug", limit: 100 }, rarity: { column: "rarity", limit: 30 }, imagePath: { column: "image_path", url: true, asset: true }, suggestedImagePath: { column: "suggested_image_path", url: true, asset: true },
  releaseStatus: { column: "release_status", limit: 20 }, firstObservedAt: { column: "first_observed_at", date: true }, summonCost: { column: "summon_cost", integer: true }, spriteChestDropChancePct: { column: "sprite_chest_drop_chance_pct", decimal: true }, extraEffectRef: { column: "extra_effect_ref", limit: 50 }, dataStatus: { column: "data_status", limit: 20 },
  effect: { column: "effect", json: true }, acquisition: { column: "acquisition", json: true }, availability: { column: "availability", json: true }, recurrence: { column: "recurrence", json: true }, dates: { column: "dates", json: true }, missingFields: { column: "missing_fields", json: true }, sources: { column: "sources", json: true }
};

app.patch("/api/admin/catalog/variants/:variantId", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const result = await updateCatalogEntity({ table: "sprite_variants", idColumn: "id", id: req.params.variantId, fields: variantEditableFields, entityType: "variant", body: jsonValue(req.body), actor: adminActorFromReq(req) });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, variant: result.value });
}));

app.post("/api/admin/catalog/bulk-workflow", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const spriteIds = Array.isArray(req.body?.spriteIds) ? [...new Set(req.body.spriteIds.map((id) => text(id, 100)).filter(Boolean))].slice(0, 50) : [];
  const status = text(req.body?.status, 20);
  const reason = text(req.body?.reason, 1000);
  if (!spriteIds.length || !EDITORIAL_STATUSES.has(status) || !reason) return res.status(400).json({ error: "Sélection, état et justification requis" });
  const updated = await withAdminAudit(async (client) => {
    const previous = await client.query(
      `SELECT id, editorial_status, is_released FROM sprites
       WHERE id = ANY($1::text[]) FOR UPDATE`,
      [spriteIds]
    );
    const changing = previous.rows.filter((row) => (row.editorial_status || (row.is_released === false ? "draft" : "published")) !== status);
    if (!changing.length) return [];
    const ids = changing.map((row) => row.id);
    const result = await client.query(
      `UPDATE sprites SET editorial_status = $2, editorial_updated_at = NOW(), is_released = $3
       WHERE id = ANY($1::text[]) RETURNING id`,
      [ids, status, status === "published"]
    );
    for (const row of changing) {
      const before = row.editorial_status || (row.is_released === false ? "draft" : "published");
      await client.query(
        `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
         VALUES ('sprite', $1, 'editorialStatus', $2::jsonb, $3::jsonb, $4, $5)`,
        [row.id, JSON.stringify(before), JSON.stringify(status), adminActorFromReq(req), reason]
      );
    }
    return result.rows.map((row) => row.id);
  }, (ids) => ({ actor: adminActorFromReq(req), action: "catalog.bulk_workflow", targetType: "catalog", targetId: "bulk", justification: reason, details: { requested: spriteIds.length, updated: ids.length, spriteIds: ids, status, reversiblePerSprite: true } }));
  syncCatalogueMetaAndFanout().catch(error => console.error("[admin] bulk catalog workflow fanout:", error.message));
  res.json({ ok: true, requested: spriteIds.length, updated: updated.length, ids: updated });
}));

app.post("/api/admin/catalog/:spriteId/workflow", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const editorialStatus = text(req.body?.editorialStatus, 20);
  const reason = text(req.body?.reason, 1000);
  if (!EDITORIAL_STATUSES.has(editorialStatus) || !reason) return res.status(400).json({ error: "Statut éditorial et justification requis" });
  const sprite = await withAdminAudit(async (client) => {
    const previous = await client.query("SELECT editorial_status, is_released FROM sprites WHERE id = $1 FOR UPDATE", [req.params.spriteId]);
    if (!previous.rows.length) throw notFound("Sprite introuvable");
    const result = await client.query(
      `UPDATE sprites
       SET editorial_status = $2, editorial_updated_at = NOW(), is_released = $3
       WHERE id = $1 RETURNING id, name, editorial_status, editorial_updated_at, is_released`,
      [req.params.spriteId, editorialStatus, editorialStatus === "published"]
    );
    await client.query(
      `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
       VALUES ('sprite', $1, 'editorialStatus', $2::jsonb, $3::jsonb, $4, $5)`,
      [req.params.spriteId, JSON.stringify(previous.rows[0].editorial_status || (previous.rows[0].is_released === false ? "draft" : "published")), JSON.stringify(editorialStatus), adminActorFromReq(req), reason]
    );
    return { sprite: result.rows[0], previous: previous.rows[0] };
  }, (result) => ({
    actor: adminActorFromReq(req), action: `catalog.workflow_${editorialStatus}`, targetType: "sprite", targetId: req.params.spriteId, justification: reason,
    details: { changes: { editorialStatus: { before: result.previous.editorial_status || (result.previous.is_released === false ? "draft" : "published"), after: editorialStatus }, isReleased: { before: result.previous.is_released, after: editorialStatus === "published" } } }
  }));
  if (editorialStatus === "published") syncCatalogueMetaAndFanout().catch(error => console.error("[admin] catalog publish fanout:", error.message));
  res.json({ ok: true, sprite: sprite.sprite });
}));

app.post("/api/admin/catalog/variants/:variantId/workflow", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const editorialStatus = text(req.body?.editorialStatus, 20);
  const reason = text(req.body?.reason, 1000);
  if (!EDITORIAL_STATUSES.has(editorialStatus) || !reason) return res.status(400).json({ error: "Statut éditorial et justification requis" });
  const variant = await withAdminAudit(async (client) => {
    const previous = await client.query("SELECT editorial_status, release_status FROM sprite_variants WHERE id = $1 FOR UPDATE", [req.params.variantId]);
    if (!previous.rows.length) throw notFound("Variante introuvable");
    const result = await client.query("UPDATE sprite_variants SET editorial_status = $2, editorial_updated_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, sprite_id, name, editorial_status, editorial_updated_at", [req.params.variantId, editorialStatus]);
    await client.query(`INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
                        VALUES ('variant', $1, 'editorialStatus', $2::jsonb, $3::jsonb, $4, $5)`,
      [req.params.variantId, JSON.stringify(previous.rows[0].editorial_status || "published"), JSON.stringify(editorialStatus), adminActorFromReq(req), reason]);
    return { variant: result.rows[0], before: previous.rows[0].editorial_status || "published" };
  }, (result) => ({ actor: adminActorFromReq(req), action: `catalog.variant_workflow_${editorialStatus}`, targetType: "variant", targetId: req.params.variantId, justification: reason, details: { changes: { editorialStatus: { before: result.before, after: editorialStatus } } } }));
  res.json({ ok: true, variant: variant.variant });
}));

app.post("/api/admin/catalog/:spriteId/history/:historyId/rollback", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const historyId = numberId(req.params.historyId);
  const reason = text(req.body?.reason, 1000);
  if (!historyId || !reason) return res.status(400).json({ error: "Historique et justification requis" });
  const rollback = await withAdminAudit(async (client) => {
    const history = await client.query(
      `SELECT id, field, previous_value, new_value FROM catalog_change_history
       WHERE id = $1 AND entity_type = 'sprite' AND entity_id = $2 FOR UPDATE`,
      [historyId, req.params.spriteId]
    );
    if (!history.rows.length) throw notFound("Version d’historique introuvable");
    const entry = history.rows[0];
    const isWorkflow = entry.field === "editorialStatus";
    const field = spriteEditableFields[entry.field];
    if (!field && !isWorkflow) throw new AdminHttpError(400, "Cette entrée ne peut pas être restaurée automatiquement");
    const current = await client.query(isWorkflow ? "SELECT editorial_status, is_released FROM sprites WHERE id = $1 FOR UPDATE" : `SELECT "${field.column}" FROM sprites WHERE id = $1 FOR UPDATE`, [req.params.spriteId]);
    if (!current.rows.length) throw notFound("Sprite introuvable");
    const restored = entry.previous_value;
    const result = await client.query(isWorkflow
      ? "UPDATE sprites SET editorial_status = $2, editorial_updated_at = NOW(), is_released = $3 WHERE id = $1 RETURNING *"
      : `UPDATE sprites SET "${field.column}" = $2 WHERE id = $1 RETURNING *`, isWorkflow ? [req.params.spriteId, restored, restored === "published"] : [req.params.spriteId, restored]);
    await client.query(
      `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason, source_id)
       VALUES ('sprite', $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
      [req.params.spriteId, entry.field, JSON.stringify(isWorkflow ? (current.rows[0].editorial_status || (current.rows[0].is_released === false ? "draft" : "published")) : current.rows[0][field.column]), JSON.stringify(restored), adminActorFromReq(req), reason, String(entry.id)]
    );
    return { entry, sprite: result.rows[0], before: isWorkflow ? (current.rows[0].editorial_status || (current.rows[0].is_released === false ? "draft" : "published")) : current.rows[0][field.column], after: restored };
  }, (result) => ({
    actor: adminActorFromReq(req), action: "catalog.rollback", targetType: "sprite", targetId: req.params.spriteId, justification: reason,
    details: { sourceHistoryId: historyId, changes: { [result.entry.field]: { before: result.before, after: result.after } } }
  }));
  res.json({ ok: true, sprite: rollback.sprite, restoredHistoryId: historyId });
}));

app.post("/api/admin/catalog/:spriteId/availability", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const status = text(body.status, 20) || "unknown";
  const confidence = text(body.confidence, 20) || "unknown";
  const start = nullableDate(body.startDate);
  const end = nullableDate(body.endDate);
  if (!AVAILABILITY_STATUSES.has(status) || !CONFIDENCE_LEVELS.has(confidence) || start === undefined || end === undefined) {
    return res.status(400).json({ error: "Disponibilité invalide" });
  }
  if (start && end && new Date(start) > new Date(end)) return res.status(400).json({ error: "Les dates sont incohérentes" });
  const reason = text(body.reason, 1000);
  if (!reason) return res.status(400).json({ error: "Une justification est requise" });
  const exists = await pool.query("SELECT id FROM sprites WHERE id = $1", [req.params.spriteId]);
  if (!exists.rows.length) return res.status(404).json({ error: "Sprite introuvable" });
  const id = crypto.randomUUID();
  const availability = await withAdminAudit(async (client) => {
    const result = await client.query(
      `INSERT INTO availability_periods (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [id, req.params.spriteId, start, end, status, text(body.eventId, 100), confidence, text(body.dataStatus, 20) || "incomplete", JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : [])]
    );
    return result.rows[0];
  }, {
    actor: adminActorFromReq(req),
    action: "catalog.availability_created",
    targetType: "sprite",
    targetId: req.params.spriteId,
    justification: reason,
    details: { periodId: id, status, confidence }
  });
  res.status(201).json({ ok: true, availability });
}));

app.get("/api/admin/catalog-history", requireAdminCapability("catalog.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const entityId = text(req.query.entityId, 100);
  const values = [];
  const where = [];
  if (entityId) { values.push(entityId); where.push(`entity_id = $${values.length}`); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  values.push(pageSize, offset);
  const [list, count] = await Promise.all([
    pool.query(`SELECT id, entity_type, entity_id, field, previous_value, new_value, changed_by, changed_at, reason, source_id
                FROM catalog_change_history ${clause} ORDER BY changed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values),
    pool.query(`SELECT COUNT(*)::int AS count FROM catalog_change_history ${clause}`, values.slice(0, -2))
  ]);
  res.json(paged(list.rows, count.rows[0]?.count, { page, pageSize }));
}));

// ── 4. Events & editorial news ─────────────────────────────────────────────

app.get("/api/admin/events", requireAdminCapability("events.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const [list, count] = await Promise.all([
    pool.query(`SELECT e.id, e.name, e.type, e.season_id, e.start_date, e.end_date, e.data_status, e.sources, e.updated_at,
                       COUNT(ap.id)::int AS availability_count
                FROM events e LEFT JOIN availability_periods ap ON ap.event_id = e.id
                GROUP BY e.id ORDER BY e.end_date DESC NULLS LAST, e.updated_at DESC
                LIMIT $1 OFFSET $2`, [pageSize, offset]),
    pool.query("SELECT COUNT(*)::int AS count FROM events")
  ]);
  res.json(paged(list.rows, count.rows[0]?.count, { page, pageSize }));
}));

app.post("/api/admin/events", requireAdminCapability("events.write"), adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const id = text(body.id, 100);
  const name = text(body.name, 100);
  const reason = text(body.reason, 1000);
  const start = nullableDate(body.startDate);
  const end = nullableDate(body.endDate);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !name || !reason || start === undefined || end === undefined || (start && end && new Date(start) > new Date(end))) {
    return res.status(400).json({ error: "Événement et justification requis" });
  }
  const event = await withAdminAudit(async (client) => {
    const result = await client.query(
      `INSERT INTO events (id, name, type, season_id, start_date, end_date, data_status, sources, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW()) RETURNING *`,
      [id, name, text(body.type, 50), text(body.seasonId, 50), start, end, text(body.dataStatus, 20) || "incomplete", JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : [])]
    );
    return result.rows[0];
  }, {
    actor: adminActorFromReq(req),
    action: "event.created",
    targetType: "event",
    targetId: id,
    justification: reason,
    details: { name }
  });
  res.status(201).json({ ok: true, event });
}));

app.post("/api/admin/events/bulk-status", requireAdminCapability("events.write"), adminMutationLimiter, route(async (req, res) => {
  const eventIds = Array.isArray(req.body?.eventIds) ? [...new Set(req.body.eventIds.map((id) => text(id, 100)).filter(Boolean))].slice(0, 50) : [];
  const dataStatus = text(req.body?.dataStatus, 20);
  const reason = text(req.body?.reason, 1000);
  if (!eventIds.length || !DATA_STATUSES.has(dataStatus) || !reason) return res.status(400).json({ error: "Sélection, état et justification requis" });
  const updated = await withAdminAudit(async (client) => {
    const result = await client.query(`UPDATE events SET data_status = $2, updated_at = NOW() WHERE id = ANY($1::text[]) AND data_status IS DISTINCT FROM $2 RETURNING id`, [eventIds, dataStatus]);
    return result.rows.map((row) => row.id);
  }, (ids) => ({ actor: adminActorFromReq(req), action: "event.bulk_status", targetType: "event", targetId: "bulk", justification: reason, details: { requested: eventIds.length, updated: ids.length, eventIds: ids, dataStatus } }));
  res.json({ ok: true, requested: eventIds.length, updated: updated.length, ids: updated });
}));

app.patch("/api/admin/events/:eventId", requireAdminCapability("events.write"), adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const allowed = { name: "name", type: "type", seasonId: "season_id", dataStatus: "data_status" };
  const updates = [];
  for (const [key, column] of Object.entries(allowed)) if (Object.prototype.hasOwnProperty.call(body, key)) updates.push({ column, key, value: text(body[key], key === "name" ? 100 : 50) });
  for (const [key, column] of [["startDate", "start_date"], ["endDate", "end_date"]]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = nullableDate(body[key]);
    if (value === undefined) return res.status(400).json({ error: "Date invalide" });
    updates.push({ column, key, value });
  }
  if (Object.prototype.hasOwnProperty.call(body, "sources")) updates.push({ column: "sources", key: "sources", value: JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : []) , json: true });
  const reason = text(body.reason, 1000);
  if (!updates.length || !reason) return res.status(400).json({ error: "Modifications et justification requises" });
  const values = [req.params.eventId, ...updates.map(update => update.value)];
  const set = updates.map((update, index) => `${update.column} = $${index + 2}${update.json ? "::jsonb" : ""}`).join(", ");
  const auditedEvent = await withAdminAudit(async (client) => {
    const previous = await client.query(
      `SELECT ${updates.map((update) => `"${update.column}"`).join(", ")} FROM events WHERE id = $1 FOR UPDATE`,
      [req.params.eventId]
    );
    if (!previous.rows.length) throw notFound("Événement introuvable");
    const result = await client.query(`UPDATE events SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`, values);
    return {
      event: result.rows[0],
      changes: Object.fromEntries(updates.map((update) => [update.key, {
        before: previous.rows[0][update.column],
        after: update.json ? JSON.parse(update.value) : update.value
      }]))
    };
  }, (result) => ({
    actor: adminActorFromReq(req),
    action: "event.updated",
    targetType: "event",
    targetId: req.params.eventId,
    justification: reason,
    details: { fields: updates.map(update => update.key), changes: result.changes }
  }));
  res.json({ ok: true, event: auditedEvent.event });
}));

app.get("/api/admin/news", requireAdminCapability("events.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const status = NEWS_STATUSES.has(String(req.query.status)) ? String(req.query.status) : null;
  const values = [];
  const where = status ? "WHERE status = $1" : "";
  if (status) values.push(status);
  values.push(pageSize, offset);
  const [list, count] = await Promise.all([
    pool.query(`SELECT id, source, title, description, image, link, news_date, status, published_at, updated_at, editor_note
                FROM sprite_news ${where} ORDER BY news_date DESC NULLS LAST, created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprite_news ${where}`, status ? [status] : [])
  ]);
  res.json(paged(list.rows, count.rows[0]?.count, { page, pageSize }));
}));

app.post("/api/admin/news", requireAdminCapability("events.write"), adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const title = text(body.title, 300);
  const reason = text(body.reason, 1000);
  const link = validUrl(body.link);
  const status = NEWS_STATUSES.has(String(body.status)) ? String(body.status) : "draft";
  if (!title || !reason || (body.link && !link)) return res.status(400).json({ error: "Actualité et justification requises" });
  const newsDate = nullableDate(body.newsDate);
  if (newsDate === undefined) return res.status(400).json({ error: "Date invalide" });
  const hash = crypto.createHash("md5").update(`admin:${title}:${Date.now()}:${crypto.randomUUID()}`).digest("hex");
  const news = await withAdminAudit(async (client) => {
    const result = await client.query(
      `INSERT INTO sprite_news (hash, source, title, description, image, link, news_date, status, published_at, editor_note, updated_at)
       VALUES ($1, 'backoffice', $2, $3, $4, $5, $6, $7,
               CASE WHEN $7 = 'published' THEN NOW() ELSE NULL END, $8, NOW()) RETURNING *`,
      [hash, title, text(body.description, 4000) || "", validUrl(body.image), link, newsDate || new Date().toISOString(), status, text(body.editorNote, 1000)]
    );
    return result.rows[0];
  }, (created) => ({
    actor: adminActorFromReq(req),
    action: "news.created",
    targetType: "news",
    targetId: created.id,
    justification: reason,
    details: { status, title }
  }));
  let fanout = null;
  if (news.status === "published") {
    try {
      fanout = await fanoutPublishedNews(news);
    } catch (error) {
      console.error("[admin] news fanout failed:", error.message);
    }
  }
  res.status(201).json({ ok: true, news, fanout });
}));

app.get("/api/admin/news/:newsId", requireAdminCapability("events.read"), route(async (req, res) => {
  const id = numberId(req.params.newsId);
  if (!id) return res.status(400).json({ error: "Actualité invalide" });
  const result = await pool.query(
    `SELECT id, source, title, description, image, link, news_date, status, published_at, updated_at, editor_note, created_at
     FROM sprite_news WHERE id = $1`,
    [id]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Actualité introuvable" });
  res.json({ news: result.rows[0] });
}));

app.get("/api/admin/events/:eventId", requireAdminCapability("events.read"), route(async (req, res) => {
  const result = await pool.query(
    `SELECT e.id, e.name, e.type, e.season_id, e.start_date, e.end_date, e.data_status, e.sources, e.updated_at,
            COUNT(ap.id)::int AS availability_count
     FROM events e
     LEFT JOIN availability_periods ap ON ap.event_id = e.id
     WHERE e.id = $1
     GROUP BY e.id`,
    [req.params.eventId]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Événement introuvable" });
  res.json({ event: result.rows[0] });
}));

app.patch("/api/admin/news/:newsId", requireAdminCapability("events.write"), adminMutationLimiter, route(async (req, res) => {
  const id = numberId(req.params.newsId);
  const body = jsonValue(req.body);
  if (!id) return res.status(400).json({ error: "Actualité invalide" });
  const existing = await pool.query("SELECT id, status FROM sprite_news WHERE id = $1", [id]);
  if (!existing.rows.length) return res.status(404).json({ error: "Actualité introuvable" });
  const previousStatus = existing.rows[0].status;
  const updates = [];
  for (const [key, column, limit] of [["title", "title", 300], ["description", "description", 4000], ["editorNote", "editor_note", 1000]]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) updates.push({ key, column, value: text(body[key], limit) || "" });
  }
  for (const [key, column] of [["image", "image"], ["link", "link"]]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = validUrl(body[key]);
    if (body[key] && !value) return res.status(400).json({ error: "URL invalide" });
    updates.push({ key, column, value });
  }
  if (Object.prototype.hasOwnProperty.call(body, "newsDate")) {
    const value = nullableDate(body.newsDate);
    if (value === undefined) return res.status(400).json({ error: "Date invalide" });
    updates.push({ key: "newsDate", column: "news_date", value });
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!NEWS_STATUSES.has(body.status)) return res.status(400).json({ error: "Statut invalide" });
    updates.push({ key: "status", column: "status", value: body.status });
  }
  const reason = text(body.reason, 1000);
  if (!updates.length || !reason) return res.status(400).json({ error: "Modifications et justification requises" });
  const values = [id, ...updates.map(update => update.value)];
  const set = updates.map((update, index) => `${update.column} = $${index + 2}`).join(", ");
  const statusUpdate = updates.some(update => update.column === "status");
  values.push(statusUpdate ? updates.find(update => update.column === "status").value : "");
  const publicationStatusIndex = values.length;
  const auditedNews = await withAdminAudit(async (client) => {
    const previous = await client.query(
      `SELECT ${updates.map((update) => `"${update.column}"`).join(", ")} FROM sprite_news WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!previous.rows.length) throw notFound("Actualité introuvable");
    const result = await client.query(
      `UPDATE sprite_news SET ${set},
         published_at = CASE WHEN $${publicationStatusIndex} = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
         updated_at = NOW() WHERE id = $1 RETURNING *`, values
    );
    return {
      news: result.rows[0],
      changes: Object.fromEntries(updates.map((update) => [update.key, {
        before: previous.rows[0][update.column],
        after: update.value
      }]))
    };
  }, (result) => ({
    actor: adminActorFromReq(req),
    action: "news.updated",
    targetType: "news",
    targetId: id,
    justification: reason,
    details: { fields: updates.map(update => update.key), previousStatus, changes: result.changes }
  }));
  const news = auditedNews.news;
  let fanout = null;
  if (news.status === "published" && previousStatus !== "published") {
    try {
      fanout = await fanoutPublishedNews(news);
    } catch (error) {
      console.error("[admin] news fanout failed:", error.message);
    }
  }
  res.json({ ok: true, news, fanout });
}));

// ── 5. Collections & integrity ─────────────────────────────────────────────

app.get("/api/admin/collections/integrity", requireAdminCapability("collections.read"), route(async (_req, res) => {
  const [orphaned, mismatched, invalid, migration, passportQueue, latestErrors, mismatchedEntries] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM sprite_entries se
                LEFT JOIN sprite_variants sv ON sv.id = se.variant_id
                LEFT JOIN sprites s ON s.id = se.variant_id
                WHERE sv.id IS NULL AND s.id IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprite_entries se
                JOIN sprite_variants sv ON sv.id = se.variant_id
                WHERE se.sprite_id IS DISTINCT FROM sv.sprite_id`),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprite_entries
                WHERE status NOT IN ('new', 'owned', 'missing', 'priority', 'spotted', 'unavailable', 'unknown')`),
    pool.query("SELECT COUNT(*)::int AS count FROM migration_errors"),
    pool.query(`SELECT status, COUNT(*)::int AS count FROM passport_recalc_queue GROUP BY status ORDER BY status`),
    pool.query(`SELECT id, table_name, original_key, error, created_at FROM migration_errors ORDER BY created_at DESC LIMIT 12`),
    pool.query(`SELECT se.id, se.variant_id, se.sprite_id AS current_sprite_id, sv.sprite_id AS expected_sprite_id, u.username
                FROM sprite_entries se JOIN sprite_variants sv ON sv.id = se.variant_id
                LEFT JOIN users u ON u.id = se.user_id
                WHERE se.sprite_id IS DISTINCT FROM sv.sprite_id ORDER BY se.updated_at DESC LIMIT 50`)
  ]);
  res.json({
    checks: {
      orphanedEntries: orphaned.rows[0]?.count || 0,
      mismatchedSpriteReferences: mismatched.rows[0]?.count || 0,
      invalidStatuses: invalid.rows[0]?.count || 0,
      migrationErrors: migration.rows[0]?.count || 0
    },
    passportQueue: passportQueue.rows,
    latestMigrationErrors: latestErrors.rows,
    mismatchedEntries: mismatchedEntries.rows
  });
}));

app.post("/api/admin/collections/integrity/repair", requireAdminCapability("collections.write"), adminMutationLimiter, route(async (req, res) => {
  const action = text(req.body?.action, 60);
  const reason = text(req.body?.reason, 1000);
  const entryIds = Array.isArray(req.body?.entryIds) ? [...new Set(req.body.entryIds.map(numberId).filter(Boolean))].slice(0, 50) : [];
  if (action !== "backfill-sprite-references" || !reason) return res.status(400).json({ error: "Action et justification requises" });
  const repaired = await withAdminAudit(async (client) => {
    const result = await client.query(
      `UPDATE sprite_entries se SET sprite_id = sv.sprite_id, updated_at = NOW()
       FROM sprite_variants sv
       WHERE sv.id = se.variant_id AND se.sprite_id IS DISTINCT FROM sv.sprite_id
       ${entryIds.length ? "AND se.id = ANY($1::bigint[])" : ""}
       RETURNING se.id`, entryIds.length ? [entryIds] : []
    );
    return result.rows.length;
  }, (count) => ({
    actor: adminActorFromReq(req),
    action: "collection.references_repaired",
    targetType: "collection",
    targetId: "sprite_entries",
    justification: reason,
    details: { repaired: count, requestedEntryIds: entryIds }
  }));
  res.json({ ok: true, repaired });
}));

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

// ── 10. Privacy & audit ────────────────────────────────────────────────────

app.get("/api/admin/audit", requireAdminCapability("audit.read"), route(async (req, res) => {
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
}));

app.get("/api/admin/audit/export", requireAdminCapability("audit.read"), route(async (req, res) => {
  const filters = auditFilters(req.query);
  if (filters.error) return res.status(400).json({ error: filters.error });
  const rows = await pool.query(
    `SELECT id, actor, action, target_type, target_id, justification, details, created_at
     FROM admin_audit_log ${filters.where}
     ORDER BY created_at DESC, id DESC LIMIT $${filters.values.length + 1}`,
    [...filters.values, MAX_AUDIT_EXPORT_ROWS]
  );
  const header = ["id", "actor", "action", "target_type", "target_id", "justification", "details", "created_at"];
  const csv = [header, ...rows.rows.map((row) => {
    const safe = auditRowForAdmin(row);
    return [safe.id, safe.actor, safe.action, safe.target_type, safe.target_id, safe.justification, JSON.stringify(safe.details), safe.created_at];
  })].map((line) => line.map(csvCell).join(",")).join("\n");
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="sprite-index-audit.csv"',
    "Cache-Control": "no-store"
  });
  res.send(`\uFEFF${csv}`);
}));

app.get("/api/admin/privacy/lookup", requireAdminCapability("privacy.read"), route(async (req, res) => {
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
}));

app.get("/api/admin/privacy", requireAdminCapability("privacy.read"), route(async (req, res) => {
  const deletionFilter = ["ready", "pending", "all"].includes(String(req.query.deletionStatus))
    ? String(req.query.deletionStatus)
    : "all";
  const [privacy, sharing, consent, deletions] = await Promise.all([
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deletion_requests,
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - ($1::text || ' days')::interval)::int AS ready_for_purge,
      COUNT(*) FILTER (WHERE profile_visibility = 'public' AND deleted_at IS NULL)::int AS public_profiles,
      COUNT(*) FILTER (WHERE collection_visibility = 'public' AND deleted_at IS NULL)::int AS public_collections
      FROM users`, [String(retentionDays())]),
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
}));

app.get("/api/admin/privacy/export/:userId", requireAdminCapability("privacy.export"), requireAdminStepUp, route(async (req, res) => {
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
}));

app.post("/api/admin/privacy/purge", requireAdminCapability("privacy.purge"), requireAdminStepUp, adminMutationLimiter, route(async (req, res) => {
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

  const result = await withAdminAudit(async (client) => {
    const purged = await purgeDeletedAccounts({
      db: client,
      userId,
      limit,
      force,
      olderThanDays: force ? 0 : retentionDays()
    });
    if (userId && !purged.purged.length) {
      throw notFound(force
        ? "Compte introuvable ou non marqué pour suppression"
        : "Compte pas encore éligible à la purge (délai de rétention)");
    }
    return purged;
  }, (purged) => ({
    actor: adminActorFromReq(req),
    action: force ? "privacy.account_force_purged" : (userId ? "privacy.account_purged" : "privacy.accounts_purged"),
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
  }));

  res.json({
    ok: true,
    purged: result.purged,
    count: result.purged.length,
    retentionDays: result.retentionDays
  });
}));

app.post("/api/admin/privacy/restore", requireAdminCapability("privacy.restore"), requireAdminStepUp, adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const userId = numberId(body.userId);
  const reason = text(body.reason, 1000);
  if (!userId || !reason) return res.status(400).json({ error: "Compte et justification requis" });
  const user = await withAdminAudit(async (client) => {
    return restoreDeletedAccount(userId, { db: client });
  }, (restored) => ({
    actor: adminActorFromReq(req),
    action: "privacy.account_restored",
    targetType: "user",
    targetId: userId,
    justification: reason,
    details: { username: restored.username }
  }));
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
}));

app.post("/api/admin/privacy/revoke-share-links", requireAdminCapability("privacy.revoke_links"), requireAdminStepUp, adminMutationLimiter, route(async (req, res) => {
  const reason = text(req.body?.reason, 1000);
  if (!reason) return res.status(400).json({ error: "Une justification est requise" });
  const revoked = await withAdminAudit(async (client) => {
    return revokeActiveShareCapabilities({ db: client });
  }, (result) => ({
    actor: adminActorFromReq(req),
    action: "privacy.share_links_revoked",
    targetType: "privacy",
    targetId: "share-links",
    justification: reason,
    details: result
  }));
  res.json({ ok: true, revoked });
}));

module.exports = { audit };
