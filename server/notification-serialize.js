// ── Étape 60 — Normalized notification API response ────────────────────────
// Transforms persisted rows into a stable client contract:
//
// {
//   id, type, category, title, body,
//   actor: { id, displayName, avatarUrl } | null,
//   entity: { type, id } | null,
//   action: { label, url } | null,
//   isRead, createdAt
// }

const { toUtcIso } = require("./timezone");

const PUBLIC_ID_PREFIX = "notification_";

const DEFAULT_ACTION_LABELS = Object.freeze({
  friend_request_accepted: "Comparer",
  friend_acquired_missing_variant: "Comparer",
  squad_completion_increased: "Ouvrir",
  priority_variant_available: "Voir",
  wanted_event_ending_soon: "Voir"
});

const ENTITY_TYPE_ALIASES = Object.freeze({
  variant: "sprite_variant",
  sprite_variant: "sprite_variant",
  event: "event",
  squad: "squad",
  friendship: "friendship",
  user: "user"
});

function toPublicNotificationId(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  if (s.startsWith(PUBLIC_ID_PREFIX)) return s;
  return `${PUBLIC_ID_PREFIX}${s}`;
}

function fromPublicNotificationId(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  const raw = s.startsWith(PUBLIC_ID_PREFIX) ? s.slice(PUBLIC_ID_PREFIX.length) : s;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeEntityType(entityType) {
  if (entityType == null || entityType === "") return null;
  const key = String(entityType).toLowerCase();
  return ENTITY_TYPE_ALIASES[key] || key;
}

function actorDisplayName(user) {
  if (!user) return null;
  return user.display_name || user.displayName || user.username || null;
}

function normalizeActor(user) {
  if (!user || user.id == null) return null;
  return {
    id: String(user.id),
    displayName: actorDisplayName(user) || String(user.id),
    avatarUrl: user.avatar_url || user.avatarUrl || null
  };
}

function normalizeEntity(row = {}) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const type = normalizeEntityType(row.entity_type || row.entityType || data.entityType || null);
  const id = row.entity_id != null
    ? String(row.entity_id)
    : (data.entityId != null ? String(data.entityId)
      : (data.variantId != null ? String(data.variantId)
        : (data.eventId != null ? String(data.eventId)
          : (data.squadId != null ? String(data.squadId) : null))));
  if (!type && !id) return null;
  if (!id) return type ? { type, id: null } : null;
  return {
    type: type || "unknown",
    id
  };
}

function normalizeAction(row = {}) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  if (data.accessRevoked) return null;
  const primary = data.actions && data.actions.primary ? data.actions.primary : null;
  const url = (primary && primary.url) || data.actionUrl || null;
  const label = (primary && primary.label)
    || DEFAULT_ACTION_LABELS[row.type]
    || null;
  if (!url && !label) return null;
  return {
    label: label || "Ouvrir",
    url: url || null
  };
}

/**
 * Pure mapper: row (+ optional actor user row) → normalized notification.
 */
function normalizeNotification(row, actorUser = null) {
  if (!row) return null;
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const createdAt = toUtcIso(row.created_at || row.createdAt) || null;
  const actor = normalizeActor(actorUser)
    || (data.actor && typeof data.actor === "object" ? normalizeActor(data.actor) : null)
    || (row.actor_id != null
      ? {
          id: String(row.actor_id),
          displayName: data.actorName || String(row.actor_id),
          avatarUrl: data.actorAvatarUrl || null
        }
      : null);

  // Étape 61 — expose structured translation payload when present.
  const translationKey = data.translationKey || null;
  const translationParams = data.translationParams && typeof data.translationParams === "object"
    ? data.translationParams
    : null;

  return {
    id: toPublicNotificationId(row.id),
    type: row.type || null,
    category: row.category || null,
    title: row.title || "",
    body: row.body || row.message || "",
    actor,
    entity: normalizeEntity(row),
    action: normalizeAction(row),
    isRead: !!(row.read_at || row.readAt || row.isRead === true),
    createdAt,
    ...(translationKey ? { translationKey } : {}),
    ...(translationParams ? { translationParams } : {})
  };
}

async function loadActorsById(pool, actorIds) {
  const ids = [...new Set((actorIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id)))];
  const map = new Map();
  if (!ids.length) return map;
  const res = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
    [ids]
  );
  for (const row of res.rows) map.set(Number(row.id), row);
  return map;
}

/**
 * Normalize a page of notification rows, batch-loading actors.
 */
async function normalizeNotificationList(pool, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const actors = await loadActorsById(
    pool,
    list.map((r) => r.actor_id).filter((id) => id != null)
  );
  return list.map((row) => {
    const actor = row.actor_id != null ? actors.get(Number(row.actor_id)) : null;
    return normalizeNotification(row, actor || null);
  });
}

module.exports = {
  PUBLIC_ID_PREFIX,
  DEFAULT_ACTION_LABELS,
  toPublicNotificationId,
  fromPublicNotificationId,
  normalizeEntityType,
  normalizeActor,
  normalizeEntity,
  normalizeAction,
  normalizeNotification,
  loadActorsById,
  normalizeNotificationList
};
