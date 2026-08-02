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
  fr: Object.freeze({
    friend_request_accepted: "Comparer",
    friend_request_received: "Voir",
    friend_acquired_missing_variant: "Comparer",
    friend_collection_updated: "Ouvrir",
    friend_removed: "Voir",
    squad_completion_increased: "Ouvrir",
    squad_member_joined: "Ouvrir",
    priority_variant_available: "Voir",
    wanted_event_ending_soon: "Voir",
    goal_completed: "Ouvrir",
    badge_unlocked: "Voir mon passeport",
    passport_catalogue_updated: "Mettre à jour ma collection",
    news_article: "Voir"
  }),
  en: Object.freeze({
    friend_request_accepted: "Compare",
    friend_request_received: "View",
    friend_acquired_missing_variant: "Compare",
    friend_collection_updated: "Open",
    friend_removed: "View",
    squad_completion_increased: "Open",
    squad_member_joined: "Open",
    priority_variant_available: "View",
    wanted_event_ending_soon: "View",
    goal_completed: "Open",
    badge_unlocked: "View my passport",
    passport_catalogue_updated: "Update my collection",
    news_article: "View"
  }),
  nl: Object.freeze({
    friend_request_accepted: "Vergelijken",
    friend_request_received: "Bekijken",
    friend_acquired_missing_variant: "Vergelijken",
    friend_collection_updated: "Openen",
    friend_removed: "Bekijken",
    squad_completion_increased: "Openen",
    squad_member_joined: "Openen",
    priority_variant_available: "Bekijken",
    wanted_event_ending_soon: "Bekijken",
    goal_completed: "Openen",
    badge_unlocked: "Mijn paspoort bekijken",
    passport_catalogue_updated: "Mijn collectie bijwerken",
    news_article: "Bekijken"
  })
});

function normalizeNotificationLocale(lang) {
  const locale = String(lang || "fr").toLowerCase().slice(0, 2);
  return locale === "en" || locale === "nl" ? locale : "fr";
}

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

function normalizeAction(row = {}, lang = "fr") {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  if (data.accessRevoked || data.hiddenDueToBlock) return null;
  const primary = data.actions && data.actions.primary ? data.actions.primary : null;
  const url = (primary && primary.url) || data.actionUrl || null;
  const locale = normalizeNotificationLocale(lang || data.lang || "fr");
  const defaults = DEFAULT_ACTION_LABELS[locale] || DEFAULT_ACTION_LABELS.fr;
  // Never reuse a stored FR/EN actionLabel when it doesn't match the inbox locale.
  const storedLabelMatchesLocale = primary && primary.label && data.lang === locale;
  const label = (storedLabelMatchesLocale ? primary.label : null)
    || defaults[row.type]
    || null;
  if (!url && !label) return null;
  return {
    label: label || (locale === "en" ? "Open" : locale === "nl" ? "Openen" : "Ouvrir"),
    url: url || null
  };
}

function isPublicImageUrl(value) {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return false;
  if (raw.startsWith("/") && !raw.startsWith("//")) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

/** Prefer scraped/article art, then actor avatar. */
function resolveImageUrl(row = {}, actorUser = null) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const candidates = [
    data.image,
    data.imageUrl,
    data.thumbnail,
    data.tileImage,
    row.imageUrl,
    actorUser && (actorUser.avatar_url || actorUser.avatarUrl),
    data.actorAvatarUrl,
    data.actor && data.actor.avatarUrl
  ];
  for (const candidate of candidates) {
    if (!isPublicImageUrl(candidate)) continue;
    return String(candidate).trim().slice(0, 2048);
  }
  return null;
}

function newsIdFromRow(row = {}) {
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const fromData = Number(data.newsId);
  if (Number.isInteger(fromData) && fromData > 0) return fromData;
  const entityId = String(row.entity_id || data.entityId || "");
  const match = /^news:(\d+)$/i.exec(entityId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Pure mapper: row (+ optional actor user row) → normalized notification.
 * Pass `lang` to re-render title/body from translationKey when available.
 */
function normalizeNotification(row, actorUser = null, lang = null) {
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
  const imageUrl = resolveImageUrl(row, actorUser);

  const locale = normalizeNotificationLocale(lang || data.lang || "fr");
  let title = row.title || "";
  let body = row.body || row.message || "";

  const isHidden = !!(data.hiddenDueToBlock || data.accessRevoked
    || title === "Notification masquée" || title === "Hidden notification");
  if (isHidden) {
    try {
      const notifI18n = require("./notification-i18n");
      title = notifI18n.tNotif("notifications.hidden.title", {}, locale)
        || (locale === "en" ? "Hidden notification" : locale === "nl" ? "Verborgen melding" : "Notification masquée");
    } catch (_err) {
      title = locale === "en" ? "Hidden notification" : locale === "nl" ? "Verborgen melding" : "Notification masquée";
    }
    body = "";
  } else if (translationKey && translationParams && row.type) {
    try {
      const catalog = require("./notification-catalog");
      if (catalog.isKnownType(row.type)) {
        const rendered = catalog.renderFromTranslation(row.type, translationParams, locale, data);
        if (rendered?.title) title = rendered.title;
        if (rendered?.body) body = rendered.body;
      }
    } catch (_err) {
      // Keep stored title/body if re-render fails.
    }
  }

  return {
    id: toPublicNotificationId(row.id),
    type: row.type || null,
    category: row.category || null,
    title,
    body,
    actor,
    entity: normalizeEntity(row),
    action: normalizeAction(row, locale),
    imageUrl,
    isRead: !!(row.read_at || row.readAt || row.isRead === true),
    createdAt,
    ...(translationKey ? { translationKey } : {}),
    ...(translationParams ? { translationParams } : {})
  };
}

async function loadNewsImagesById(pool, newsIds) {
  const ids = [...new Set((newsIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map();
  if (!ids.length || !pool) return map;
  const res = await pool.query(
    `SELECT id, image FROM sprite_news
     WHERE id = ANY($1::int[]) AND image IS NOT NULL AND image <> ''`,
    [ids]
  );
  for (const row of res.rows) {
    if (isPublicImageUrl(row.image)) map.set(Number(row.id), String(row.image).slice(0, 2048));
  }
  return map;
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
 * News rows missing data.image are enriched from sprite_news.
 * Catalog display names are re-localized for the inbox language.
 */
async function normalizeNotificationList(pool, rows, lang = null) {
  const list = Array.isArray(rows) ? rows : [];
  const actors = await loadActorsById(
    pool,
    list.map((r) => r.actor_id).filter((id) => id != null)
  );
  const newsIdsNeedingImage = list
    .filter((row) => row.type === "news_article" && !resolveImageUrl(row))
    .map((row) => newsIdFromRow(row))
    .filter((id) => id != null);
  const newsImages = await loadNewsImagesById(pool, newsIdsNeedingImage);

  let notifI18n = null;
  try { notifI18n = require("./notification-i18n"); } catch (_err) { /* optional */ }

  const enrichedRows = await Promise.all(list.map(async (row) => {
    const newsId = row.type === "news_article" ? newsIdFromRow(row) : null;
    const scrapedImage = newsId != null ? newsImages.get(newsId) : null;
    const data = row.data && typeof row.data === "object" ? { ...row.data } : {};
    if (scrapedImage && !resolveImageUrl(row)) data.image = scrapedImage;

    if (
      notifI18n
      && data.translationKey
      && data.translationParams
      && typeof data.translationParams === "object"
      && (data.translationParams.variantId || data.translationParams.spriteId)
    ) {
      try {
        data.translationParams = await notifI18n.enrichParamsWithLocalizedCatalog(
          pool,
          data.translationParams,
          lang || data.lang || "fr"
        );
      } catch (_err) {
        // Keep frozen params if catalog lookup fails.
      }
    }

    return { ...row, data };
  }));

  return enrichedRows.map((row) => {
    const actor = row.actor_id != null ? actors.get(Number(row.actor_id)) : null;
    return normalizeNotification(row, actor || null, lang);
  });
}

module.exports = {
  PUBLIC_ID_PREFIX,
  DEFAULT_ACTION_LABELS,
  normalizeNotificationLocale,
  toPublicNotificationId,
  fromPublicNotificationId,
  normalizeEntityType,
  normalizeActor,
  normalizeEntity,
  normalizeAction,
  resolveImageUrl,
  normalizeNotification,
  loadActorsById,
  loadNewsImagesById,
  normalizeNotificationList
};
