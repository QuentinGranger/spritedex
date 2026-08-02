"use strict";



// Anti-spam helper: has a similar notification (same recipient + type + entity)
// been created within the last `withinHours`? Used by the notification service
// to avoid flooding a user with duplicates.
async function recentNotificationExists(pool, { recipientId, type, entityId = null, withinHours = 24 }) {
  if (!recipientId || !type) return false;
  const params = [recipientId, type, Number(withinHours) || 24];
  let entityClause = "AND entity_id IS NULL";
  if (entityId != null) {
    entityClause = "AND entity_id = $4";
    params.push(String(entityId));
  }
  const res = await pool.query(
    `SELECT 1 FROM notifications
     WHERE recipient_id = $1 AND type = $2
       AND status <> 'cancelled'
       AND created_at > NOW() - ($3::int * INTERVAL '1 hour')
       ${entityClause}
     LIMIT 1`,
    params
  );
  return res.rows.length > 0;
}

// Inbox filters for the notification center (Étape 46).
// Pure helper — exported for unit tests.
function buildNotificationInboxFilters(userId, {
  unreadOnly = false,
  category = null,
  filter = null
} = {}) {
  const conditions = [
    "recipient_id = $1",
    "archived_at IS NULL",
    "hidden_at IS NULL",
    "status <> 'cancelled'"
  ];
  const args = [userId];
  const f = String(filter || category || "").toLowerCase();
  if (unreadOnly || f === "unread") conditions.push("read_at IS NULL");
  if (f === "social") {
    conditions.push("category = 'social'");
  } else if (f === "alerts" || f === "alertes") {
    conditions.push("category = 'alerts'");
  } else if (f === "squads" || f === "squad") {
    // Squad activity lives under collection in the catalog; filter by type.
    conditions.push("(type = 'squad_completion_increased' OR type LIKE 'squad_%')");
  } else if (f === "collection" || f === "collections") {
    conditions.push("category = 'collection'");
    conditions.push("type <> 'squad_completion_increased' AND type NOT LIKE 'squad_%'");
  } else if (f && f !== "all" && f !== "unread") {
    args.push(f);
    conditions.push(`category = $${args.length}`);
  }
  return { conditions, args, filter: f || "all" };
}

// Étape 59 — opaque cursor for keyset pagination (created_at, id).
function encodeNotificationCursor(row) {
  if (!row || row.id == null || row.created_at == null) return null;
  const createdAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString();
  if (Number.isNaN(new Date(createdAt).getTime())) return null;
  return Buffer.from(JSON.stringify({ t: createdAt, i: Number(row.id) }), "utf8").toString("base64url");
}

function decodeNotificationCursor(cursor) {
  if (cursor == null || cursor === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    const id = Number(parsed?.i);
    const createdAt = parsed?.t;
    if (!createdAt || !Number.isFinite(id)) return null;
    if (Number.isNaN(new Date(createdAt).getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

async function getUnreadNotificationCount(pool, userId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM notifications
     WHERE recipient_id = $1
       AND read_at IS NULL
       AND archived_at IS NULL
       AND hidden_at IS NULL
       AND status <> 'cancelled'`,
    [userId]
  );
  return res.rows[0]?.c || 0;
}

async function getNotifications(pool, userId, {
  limit = 50,
  offset = 0,
  cursor = null,
  unreadOnly = false,
  category = null,
  filter = null,
  lang = null
} = {}) {
  const { conditions, args } = buildNotificationInboxFilters(userId, {
    unreadOnly,
    category,
    filter
  });
  const decoded = decodeNotificationCursor(cursor);
  if (decoded) {
    args.push(decoded.createdAt, decoded.id);
    conditions.push(
      `(created_at, id) < ($${args.length - 1}::timestamptz, $${args.length}::int)`
    );
  }
  const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
  const where = conditions.join(" AND ");

  // Prefer cursor pagination (Étape 59). Offset remains for older clients.
  let result;
  if (decoded || cursor != null) {
    result = await pool.query(
      `SELECT id, type, category, actor_id, entity_type, entity_id, data, title, body, status,
              read_at, created_at, delivered_at, clicked_at, archived_at, hidden_at
       FROM notifications
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${args.length + 1}`,
      [...args, pageSize + 1]
    );
  } else {
    result = await pool.query(
      `SELECT id, type, category, actor_id, entity_type, entity_id, data, title, body, status,
              read_at, created_at, delivered_at, clicked_at, archived_at, hidden_at
       FROM notifications
       WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      // Offset pagination is kept only for older clients. Bound it so a
      // crafted legacy request cannot force PostgreSQL to scan an arbitrarily
      // large notification history; current clients use the signed cursor.
      [...args, pageSize + 1, Math.max(0, Math.min(10_000, parseInt(offset, 10) || 0))]
    );
  }

  const rows = result.rows || [];
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  // Étape 60 — normalized API shape (id/actor/entity/action/isRead/createdAt).
  const serialize = require("../../../../../server/notification-serialize");
  let resolvedLang = lang;
  if (!resolvedLang) {
    try {
      const { resolveNotificationLanguage } = require("../../../../../server/i18n");
      const langRes = await pool.query(
        "SELECT preferred_language FROM users WHERE id = $1 AND deleted_at IS NULL",
        [userId]
      );
      resolvedLang = resolveNotificationLanguage(langRes.rows[0]?.preferred_language, null);
    } catch (_err) {
      resolvedLang = "fr";
    }
  }
  const normalized = await serialize.normalizeNotificationList(pool, page.map((row) => ({
    ...row,
    data: row.data || {}
  })), resolvedLang);
  // Attach legacy fields so older clients keep working during the transition.
  const notifications = normalized.map((item, idx) => {
    const row = page[idx];
    const rawData = row.data || {};
    // Keep legacy `data.image` in sync with the normalized scraped imageUrl so
    // older clients (and the dropdown) can render news art without a second hop.
    const data = item.imageUrl && !rawData.image
      ? { ...rawData, image: item.imageUrl }
      : rawData;
    return {
      ...item,
      // Legacy aliases
      actor_id: row.actor_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      data,
      context: data,
      message: item.body,
      status: row.status,
      read_at: row.read_at,
      created_at: row.created_at,
      delivered_at: row.delivered_at,
      clicked_at: row.clicked_at,
      archived_at: row.archived_at
    };
  });
  const nextCursor = hasMore && page.length
    ? encodeNotificationCursor(page[page.length - 1])
    : null;
  return { notifications, nextCursor, hasMore };
}

module.exports = { recentNotificationExists, encodeNotificationCursor, decodeNotificationCursor, buildNotificationInboxFilters, getUnreadNotificationCount, getNotifications };
