"use strict";

// Operational backoffice APIs. These routes are deliberately separate from
// product APIs: every request requires the terminal-admin cookie, all writes
// are auditable, and list endpoints return operational summaries instead of
// private collection notes, e-mails or bearer capabilities.

const crypto = require("crypto");
const { app } = require("./core");
const { pool } = require("./db");
const { requireAdminApi } = require("./routes-admin");
const { revokeUserSockets } = require("./ws");
const { invalidateSquadAnalysisCacheForUser } = require("./squad-analysis-cache");
const { enqueuePassportRecalc } = require("./passport-summary");
const { processDeliveryQueue } = require("./notification-delivery-queue");
const { syncCatalogueMetaAndFanout } = require("./passport-summary");
const { rateLimit } = require("../security");

const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyPrefix: "admin-mutation",
  message: "Trop d’actions administratives. Réessaie dans quelques minutes."
});

const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const REPORT_STATUSES = new Set(["open", "resolved", "dismissed"]);
const NEWS_STATUSES = new Set(["draft", "published", "archived"]);
const DATA_STATUSES = new Set(["complete", "incomplete", "verified", "unknown"]);
const AVAILABILITY_STATUSES = new Set(["available", "upcoming", "ended", "not_observed", "unknown"]);
const CONFIDENCE_LEVELS = new Set(["confirmed", "high", "medium", "low", "unknown"]);

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

async function audit(action, targetType, targetId, { justification = null, details = {} } = {}) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_log (actor, action, target_type, target_id, justification, details)
       VALUES ('terminal', $1, $2, $3, $4, $5::jsonb)`,
      [action, targetType, targetId == null ? null : String(targetId), text(justification, 2000), JSON.stringify(jsonValue(details))]
    );
  } catch (error) {
    // An unavailable audit table must never turn a successful operational
    // remediation into an ambiguous client retry. Schema bootstrap recreates it.
    console.error("[admin] audit write failed:", error.message);
  }
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error("[admin] operation failed:", error.message);
      if (!res.headersSent) res.status(500).json({ error: "Opération administrative indisponible" });
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

// ── 1. Overview ────────────────────────────────────────────────────────────

app.get("/api/admin/overview", requireAdminApi, route(async (_req, res) => {
  const { wsClients } = require("./ws");
  const [users, collection, social, notifications, passport, catalog, reports] = await Promise.all([
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
    pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open FROM user_reports`)
  ]);
  const socketCount = [...wsClients.values()].reduce((total, clients) => total + clients.size, 0);
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
    database: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
  });
}));

// ── 2. Players & moderation ────────────────────────────────────────────────

app.get("/api/admin/players", requireAdminApi, route(async (req, res) => {
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

app.patch("/api/admin/players/:userId/suspension", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
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
      await client.query(
        `INSERT INTO admin_audit_log (actor, action, target_type, target_id, justification, details)
         VALUES ('terminal', $1, 'player', $2, $3, $4::jsonb)`,
        [
          suspended ? "player.suspended" : "player.unsuspended",
          String(userId),
          reason,
          JSON.stringify({
            suspendedUntil: result.rows[0].suspended_until,
            source: result.rows[0].suspension_source,
            revokedSessions
          })
        ]
      );
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

app.get("/api/admin/players/:userId/suspension-history", requireAdminApi, route(async (req, res) => {
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

app.get("/api/admin/reports", requireAdminApi, route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const status = REPORT_STATUSES.has(String(req.query.status)) ? String(req.query.status) : "open";
  const [list, count] = await Promise.all([
    pool.query(
      `SELECT ur.id, ur.reason, ur.status, ur.created_at, ur.reviewed_at, ur.resolution,
              u.id AS reported_user_id, u.username AS reported_username, u.suspended_until
       FROM user_reports ur
       JOIN users u ON u.id = ur.reported_id
       WHERE ur.status = $1
       ORDER BY ur.created_at ASC
       LIMIT $2 OFFSET $3`,
      [status, pageSize, offset]
    ),
    pool.query("SELECT COUNT(*)::int AS count FROM user_reports WHERE status = $1", [status])
  ]);
  res.json(paged(list.rows.map(row => ({
    id: row.id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    resolution: row.resolution,
    reported: { id: row.reported_user_id, username: row.reported_username, suspendedUntil: row.suspended_until }
  })), count.rows[0]?.count, { page, pageSize }));
}));

app.patch("/api/admin/reports/:reportId", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const status = text(body.status, 20);
  const resolution = text(body.resolution, 1500);
  if (!REPORT_STATUSES.has(status) || status === "open") return res.status(400).json({ error: "Statut de traitement invalide" });
  if (!resolution) return res.status(400).json({ error: "Une note de résolution est requise" });
  const result = await pool.query(
    `UPDATE user_reports SET status = $2, resolution = $3, reviewed_at = NOW()
     WHERE id = $1 AND status = 'open'
     RETURNING id, reported_id`,
    [req.params.reportId, status, resolution]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Signalement introuvable ou déjà traité" });
  await audit(`report.${status}`, "report", result.rows[0].id, { justification: resolution, details: { reportedUserId: result.rows[0].reported_id } });
  res.json({ ok: true });
}));

// ── 3. Catalogue ───────────────────────────────────────────────────────────

app.get("/api/admin/catalog", requireAdminApi, route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const query = text(req.query.q, 100);
  const status = text(req.query.status, 20);
  const values = [];
  const where = [];
  if (query) {
    values.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(s.name ILIKE $${values.length} ESCAPE '\\' OR s.id ILIKE $${values.length} ESCAPE '\\')`);
  }
  if (status === "review") where.push("s.data_status IS NULL OR s.data_status IN ('incomplete', 'unknown')");
  if (status === "unreleased") where.push("s.is_released IS FALSE");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  values.push(pageSize, offset);
  const [list, count] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.rarity, s.color, s.available, s.image, s.event_id, s.season_id,
              s.data_status, s.is_released, s.last_verified_at, s.catalog_version,
              COUNT(sv.id)::int AS variant_count,
              COUNT(sv.id) FILTER (WHERE sv.data_status IS NULL OR sv.data_status IN ('incomplete', 'unknown'))::int AS variants_needing_review
       FROM sprites s
       LEFT JOIN sprite_variants sv ON sv.sprite_id = s.id
       ${clause}
       GROUP BY s.id
       ORDER BY s.last_verified_at DESC NULLS LAST, s.name ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprites s ${clause}`, values.slice(0, -2))
  ]);
  res.json(paged(list.rows.map(row => ({
    id: row.id, name: row.name, rarity: row.rarity, color: row.color, available: row.available,
    image: row.image, eventId: row.event_id, seasonId: row.season_id, dataStatus: row.data_status,
    isReleased: row.is_released, lastVerifiedAt: row.last_verified_at, catalogVersion: row.catalog_version,
    variantCount: row.variant_count, variantsNeedingReview: row.variants_needing_review
  })), count.rows[0]?.count, { page, pageSize }));
}));

app.get("/api/admin/catalog/:spriteId", requireAdminApi, route(async (req, res) => {
  const sprite = await pool.query(
    `SELECT id, name, rarity, color, effect, available, image, event_id, season_id, data_status,
            is_released, last_verified_at, availability, sources, notes, catalog_version
     FROM sprites WHERE id = $1`, [req.params.spriteId]
  );
  if (!sprite.rows.length) return res.status(404).json({ error: "Sprite introuvable" });
  const [variants, availability, history] = await Promise.all([
    pool.query(`SELECT id, sprite_id, variant_type, name, rarity, image_path, release_status, data_status,
                       availability, sources, updated_at
                FROM sprite_variants WHERE sprite_id = $1 ORDER BY variant_type`, [req.params.spriteId]),
    pool.query(`SELECT id, start_date, end_date, status, event_id, confidence, data_status, sources, updated_at
                FROM availability_periods WHERE sprite_id = $1 ORDER BY start_date DESC NULLS LAST`, [req.params.spriteId]),
    pool.query(`SELECT id, entity_type, field, previous_value, new_value, changed_by, changed_at, reason, source_id
                FROM catalog_change_history WHERE entity_id = $1 ORDER BY changed_at DESC LIMIT 20`, [req.params.spriteId])
  ]);
  res.json({ sprite: sprite.rows[0], variants: variants.rows, availabilityPeriods: availability.rows, history: history.rows });
}));

const spriteEditableFields = {
  name: { column: "name", limit: 100 }, rarity: { column: "rarity", limit: 30 }, color: { column: "color", limit: 60 },
  effect: { column: "effect", limit: 2000 }, available: { column: "available", limit: 20 }, image: { column: "image", url: true, asset: true },
  eventId: { column: "event_id", limit: 100 }, seasonId: { column: "season_id", limit: 50 }, dataStatus: { column: "data_status", limit: 20 },
  lastVerifiedAt: { column: "last_verified_at", date: true }, isReleased: { column: "is_released", boolean: true }
};

function editableUpdates(raw, fields) {
  const updates = [];
  for (const [key, rule] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    let value;
    if (rule.boolean) value = raw[key] === true;
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

async function updateCatalogEntity({ table, idColumn, id, fields, entityType, body }) {
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
  const updated = await pool.query(`UPDATE ${table} SET ${set}${table === "sprite_variants" ? ", updated_at = NOW()" : ""} WHERE ${idColumn} = $1 RETURNING *`, values);
  for (const change of parsed.updates) {
    await pool.query(
      `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'backoffice', $6)`,
      [entityType, String(id), change.key, JSON.stringify(before.rows[0][change.column]), JSON.stringify(change.value), reason]
    );
  }
  await audit("catalog.updated", entityType, id, { justification: reason, details: { fields: parsed.updates.map(change => change.key) } });
  return { value: updated.rows[0], releasedChanged: parsed.updates.some(change => change.key === "isReleased") };
}

app.patch("/api/admin/catalog/:spriteId", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const result = await updateCatalogEntity({ table: "sprites", idColumn: "id", id: req.params.spriteId, fields: spriteEditableFields, entityType: "sprite", body: jsonValue(req.body) });
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (result.releasedChanged) syncCatalogueMetaAndFanout().catch(error => console.error("[admin] catalog fanout:", error.message));
  res.json({ ok: true, sprite: result.value });
}));

const variantEditableFields = {
  name: { column: "name", limit: 100 }, rarity: { column: "rarity", limit: 30 }, imagePath: { column: "image_path", url: true, asset: true },
  releaseStatus: { column: "release_status", limit: 20 }, dataStatus: { column: "data_status", limit: 20 }
};

app.patch("/api/admin/catalog/variants/:variantId", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const result = await updateCatalogEntity({ table: "sprite_variants", idColumn: "id", id: req.params.variantId, fields: variantEditableFields, entityType: "variant", body: jsonValue(req.body) });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, variant: result.value });
}));

app.post("/api/admin/catalog/:spriteId/availability", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
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
  const result = await pool.query(
    `INSERT INTO availability_periods (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [id, req.params.spriteId, start, end, status, text(body.eventId, 100), confidence, text(body.dataStatus, 20) || "incomplete", JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : [])]
  );
  await audit("catalog.availability_created", "sprite", req.params.spriteId, { justification: reason, details: { periodId: id, status, confidence } });
  res.status(201).json({ ok: true, availability: result.rows[0] });
}));

app.get("/api/admin/catalog-history", requireAdminApi, route(async (req, res) => {
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

app.get("/api/admin/events", requireAdminApi, route(async (req, res) => {
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

app.post("/api/admin/events", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const id = text(body.id, 100);
  const name = text(body.name, 100);
  const start = nullableDate(body.startDate);
  const end = nullableDate(body.endDate);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !name || start === undefined || end === undefined || (start && end && new Date(start) > new Date(end))) {
    return res.status(400).json({ error: "Événement invalide" });
  }
  const result = await pool.query(
    `INSERT INTO events (id, name, type, season_id, start_date, end_date, data_status, sources, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW()) RETURNING *`,
    [id, name, text(body.type, 50), text(body.seasonId, 50), start, end, text(body.dataStatus, 20) || "incomplete", JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : [])]
  );
  await audit("event.created", "event", id, { justification: text(body.reason, 1000), details: { name } });
  res.status(201).json({ ok: true, event: result.rows[0] });
}));

app.patch("/api/admin/events/:eventId", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
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
  const result = await pool.query(`UPDATE events SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`, values);
  if (!result.rows.length) return res.status(404).json({ error: "Événement introuvable" });
  await audit("event.updated", "event", req.params.eventId, { justification: reason, details: { fields: updates.map(update => update.key) } });
  res.json({ ok: true, event: result.rows[0] });
}));

app.get("/api/admin/news", requireAdminApi, route(async (req, res) => {
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

app.post("/api/admin/news", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const title = text(body.title, 300);
  const link = validUrl(body.link);
  const status = NEWS_STATUSES.has(String(body.status)) ? String(body.status) : "draft";
  if (!title || (body.link && !link)) return res.status(400).json({ error: "Actualité invalide" });
  const newsDate = nullableDate(body.newsDate);
  if (newsDate === undefined) return res.status(400).json({ error: "Date invalide" });
  const hash = crypto.createHash("md5").update(`admin:${title}:${Date.now()}:${crypto.randomUUID()}`).digest("hex");
  const result = await pool.query(
    `INSERT INTO sprite_news (hash, source, title, description, image, link, news_date, status, published_at, editor_note, updated_at)
     VALUES ($1, 'backoffice', $2, $3, $4, $5, $6, $7,
             CASE WHEN $7 = 'published' THEN NOW() ELSE NULL END, $8, NOW()) RETURNING *`,
    [hash, title, text(body.description, 4000) || "", validUrl(body.image), link, newsDate || new Date().toISOString(), status, text(body.editorNote, 1000)]
  );
  await audit("news.created", "news", result.rows[0].id, { justification: text(body.reason, 1000), details: { status } });
  res.status(201).json({ ok: true, news: result.rows[0] });
}));

app.patch("/api/admin/news/:newsId", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const id = numberId(req.params.newsId);
  const body = jsonValue(req.body);
  if (!id) return res.status(400).json({ error: "Actualité invalide" });
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
  const result = await pool.query(
    `UPDATE sprite_news SET ${set},
       published_at = CASE WHEN $${publicationStatusIndex} = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
       updated_at = NOW() WHERE id = $1 RETURNING *`, values
  );
  if (!result.rows.length) return res.status(404).json({ error: "Actualité introuvable" });
  await audit("news.updated", "news", id, { justification: reason, details: { fields: updates.map(update => update.key) } });
  res.json({ ok: true, news: result.rows[0] });
}));

// ── 5. Collections & integrity ─────────────────────────────────────────────

app.get("/api/admin/collections/integrity", requireAdminApi, route(async (_req, res) => {
  const [orphaned, mismatched, invalid, migration, passportQueue, latestErrors] = await Promise.all([
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
    pool.query(`SELECT id, table_name, original_key, error, created_at FROM migration_errors ORDER BY created_at DESC LIMIT 12`)
  ]);
  res.json({
    checks: {
      orphanedEntries: orphaned.rows[0]?.count || 0,
      mismatchedSpriteReferences: mismatched.rows[0]?.count || 0,
      invalidStatuses: invalid.rows[0]?.count || 0,
      migrationErrors: migration.rows[0]?.count || 0
    },
    passportQueue: passportQueue.rows,
    latestMigrationErrors: latestErrors.rows
  });
}));

app.post("/api/admin/collections/integrity/repair", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const action = text(req.body?.action, 60);
  const reason = text(req.body?.reason, 1000);
  if (action !== "backfill-sprite-references" || !reason) return res.status(400).json({ error: "Action et justification requises" });
  const result = await pool.query(
    `UPDATE sprite_entries se SET sprite_id = sv.sprite_id, updated_at = NOW()
     FROM sprite_variants sv
     WHERE sv.id = se.variant_id AND se.sprite_id IS DISTINCT FROM sv.sprite_id
     RETURNING se.id`
  );
  await audit("collection.references_repaired", "collection", "sprite_entries", { justification: reason, details: { repaired: result.rows.length } });
  res.json({ ok: true, repaired: result.rows.length });
}));

// ── 6. Social & squads ─────────────────────────────────────────────────────

app.get("/api/admin/social", requireAdminApi, route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const [summary, squads, count, activity] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM friendships WHERE status = 'accepted') AS friendships,
      (SELECT COUNT(*)::int FROM friendships WHERE status = 'pending') AS pending_friendships,
      (SELECT COUNT(*)::int FROM squad_invitations WHERE status = 'pending') AS pending_squad_invitations,
      (SELECT COUNT(*)::int FROM squad_wishlist_items WHERE status = 'wanted') AS wanted_items,
      (SELECT COUNT(*)::int FROM user_blocks) AS blocks`),
    pool.query(`SELECT s.id, s.code, s.name, s.join_open, s.visibility, s.created_at,
                       COUNT(sm.id) FILTER (WHERE sm.status = 'active')::int AS member_count,
                       COUNT(swi.id) FILTER (WHERE swi.status = 'wanted')::int AS wanted_count,
                       MAX(sa.created_at) AS last_activity_at
                FROM squads s
                LEFT JOIN squad_members sm ON sm.squad_id = s.id
                LEFT JOIN squad_wishlist_items swi ON swi.squad_id = s.id
                LEFT JOIN squad_activity sa ON sa.squad_id = s.id
                GROUP BY s.id ORDER BY last_activity_at DESC NULLS LAST, s.created_at DESC
                LIMIT $1 OFFSET $2`, [pageSize, offset]),
    pool.query("SELECT COUNT(*)::int AS count FROM squads"),
    pool.query(`SELECT type, COUNT(*)::int AS count FROM squad_activity
                WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY type ORDER BY count DESC`)
  ]);
  res.json({ summary: summary.rows[0], squads: paged(squads.rows, count.rows[0]?.count, { page, pageSize }), activity24h: activity.rows });
}));

app.patch("/api/admin/social/squads/:squadId/access", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const squadId = numberId(req.params.squadId);
  const joinOpen = req.body?.joinOpen === true;
  const reason = text(req.body?.reason, 1000);
  if (!squadId || !reason) return res.status(400).json({ error: "Squad et justification requis" });
  const result = await pool.query("UPDATE squads SET join_open = $2 WHERE id = $1 RETURNING id, name, code, join_open", [squadId, joinOpen]);
  if (!result.rows.length) return res.status(404).json({ error: "Squad introuvable" });
  await audit(joinOpen ? "squad.join_opened" : "squad.join_closed", "squad", squadId, { justification: reason });
  res.json({ ok: true, squad: result.rows[0] });
}));

// ── 7. Notification operations ─────────────────────────────────────────────

app.get("/api/admin/notifications/operations", requireAdminApi, route(async (_req, res) => {
  const [queue, deliveries, push, digests, failures] = await Promise.all([
    pool.query("SELECT status, COUNT(*)::int AS count FROM notification_delivery_queue GROUP BY status ORDER BY status"),
    pool.query("SELECT channel, status, COUNT(*)::int AS count FROM notification_deliveries GROUP BY channel, status ORDER BY channel, status"),
    pool.query(`SELECT COUNT(*) FILTER (WHERE is_active)::int AS active,
                       COUNT(*) FILTER (WHERE NOT is_active)::int AS invalid,
                       COUNT(*) FILTER (WHERE last_used_at >= NOW() - INTERVAL '30 days')::int AS used30d
                FROM push_subscriptions`),
    pool.query("SELECT COUNT(*)::int AS count, MIN(flush_at) AS next_flush_at FROM notification_digest_queue"),
    pool.query(`SELECT id, notification_id, channels, attempts, max_attempts, last_error, updated_at
                FROM notification_delivery_queue WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 20`)
  ]);
  res.json({ queue: queue.rows, deliveries: deliveries.rows, push: push.rows[0], digests: digests.rows[0], failedJobs: failures.rows });
}));

app.post("/api/admin/notifications/queue/:jobId/retry", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const jobId = numberId(req.params.jobId);
  const reason = text(req.body?.reason, 1000);
  if (!jobId || !reason) return res.status(400).json({ error: "Job et justification requis" });
  const result = await pool.query(
    `UPDATE notification_delivery_queue
     SET status = 'pending', attempts = 0, available_at = NULL, not_before = NOW(), processed_at = NULL, last_error = NULL, updated_at = NOW()
     WHERE id = $1 AND status IN ('failed', 'cancelled') RETURNING id, notification_id`, [jobId]
  );
  if (!result.rows.length) return res.status(404).json({ error: "Job non relançable" });
  await pool.query("UPDATE notification_deliveries SET status = 'queued', failed_at = NULL, error_code = NULL, error_message = NULL, updated_at = NOW() WHERE notification_id = $1 AND status = 'failed'", [result.rows[0].notification_id]);
  await audit("notification.delivery_retried", "notification_delivery", jobId, { justification: reason, details: { notificationId: result.rows[0].notification_id } });
  res.json({ ok: true });
}));

app.post("/api/admin/notifications/process", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
  const reason = text(req.body?.reason, 1000);
  if (!reason) return res.status(400).json({ error: "Une justification est requise" });
  const summary = await processDeliveryQueue(pool, { limit: 20 });
  await audit("notification.queue_processed", "notification_delivery", null, { justification: reason, details: summary });
  res.json({ ok: true, summary });
}));

// ── 9. Passports & badges ──────────────────────────────────────────────────

app.get("/api/admin/passports", requireAdminApi, route(async (_req, res) => {
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

app.post("/api/admin/passports/recalculate", requireAdminApi, adminMutationLimiter, route(async (req, res) => {
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
  for (const user of users.rows) {
    await enqueuePassportRecalc(user.id, { reason: "admin.recalculate", triggerEvent: "admin.recalculate", notify: false });
  }
  await audit("passport.recalculation_queued", "passport", scope, { justification: reason, details: { queued: users.rows.length } });
  res.json({ ok: true, queued: users.rows.length, limited: users.rows.length === 500 });
}));

// ── 10. Privacy & audit ────────────────────────────────────────────────────

app.get("/api/admin/privacy", requireAdminApi, route(async (_req, res) => {
  const [privacy, sharing, consent, audits] = await Promise.all([
    pool.query(`SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deletion_requests,
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days')::int AS ready_for_purge,
      COUNT(*) FILTER (WHERE profile_visibility = 'public')::int AS public_profiles,
      COUNT(*) FILTER (WHERE collection_visibility = 'public')::int AS public_collections
      FROM users`),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM users WHERE share_token IS NOT NULL AND deleted_at IS NULL) AS passport_links,
      (SELECT COUNT(*)::int FROM compare_share_tokens WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) AS compare_links,
      (SELECT COUNT(*)::int FROM friend_invite_links WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) AS friend_invite_links`),
    pool.query(`SELECT COALESCE(cgu_version, 'unknown') AS version, COUNT(*)::int AS count
                FROM users WHERE cgu_accepted GROUP BY cgu_version ORDER BY count DESC`),
    pool.query(`SELECT id, action, target_type, target_id, justification, details, created_at
                FROM admin_audit_log ORDER BY created_at DESC LIMIT 40`)
  ]);
  res.json({ privacy: privacy.rows[0], sharing: sharing.rows[0], consentVersions: consent.rows, audit: audits.rows, roles: { mode: "terminal", configuredRoles: 1 } });
}));

module.exports = { audit };
