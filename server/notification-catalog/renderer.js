"use strict";

const { NOTIFICATION_TYPES, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } = require("./constants");
const DEFINITIONS = require("./definitions");
const { str, num, formatEndDate, formatEventEndingWhen, DEFAULT_TIMEZONE } = require("./locale");
const { normalizeTimeZone } = require("../timezone");

function isKnownType(type) {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, type);
}

function normalizeLang(lang) {
  const l = str(lang).toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(l) ? l : DEFAULT_LANGUAGE;
}

/** Prefer requested locale, then English, then French. */
function pickLocaleCopy(def, lang) {
  if (!def || typeof def !== "object") return null;
  const locale = normalizeLang(lang);
  return def[locale] || def.en || def.fr || null;
}

// ── Étape 61 — structured translation payload (not final copy alone) ──
const TRANSLATION_KEY_PREFIX = "notifications.";

function pickTranslationParams(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function translationKeyForType(type) {
  if (!type) return null;
  return `${TRANSLATION_KEY_PREFIX}${type}`;
}

/**
 * Build a stable translation key + structured params from type/context.
 * Stored on the notification so copy can be regenerated later (locale,
 * channel, wording fixes) without parsing frozen title/body strings.
 */
function buildTranslationPayload(type, context = {}) {
  const ctx = context && typeof context === "object" ? context : {};
  const translationKey = translationKeyForType(type);
  if (!translationKey) return null;

  switch (type) {
    case NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED:
      return {
        translationKey,
        translationParams: pickTranslationParams({
          friendName: ctx.actorName || ctx.friendName || null,
          friendId: ctx.friendId != null ? String(ctx.friendId)
            : (ctx.actorId != null ? String(ctx.actorId) : null),
          friendshipId: ctx.friendshipId != null ? String(ctx.friendshipId) : null,
          template: "default"
        })
      };

    case NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT: {
      const count = num(ctx.count) || 1;
      const isBatch = count > 1;
      const isPriority = ctx.priorityLevel === "strong"
        || ctx.recipientCollectionStatus === "priority";
      return {
        translationKey,
        translationParams: pickTranslationParams({
          friendName: ctx.actorName || ctx.friendName || null,
          friendId: ctx.friendId != null ? String(ctx.friendId)
            : (ctx.actorId != null ? String(ctx.actorId) : null),
          variantName: ctx.highlightName || ctx.variantName || null,
          variantId: ctx.variantId != null ? String(ctx.variantId) : null,
          spriteName: ctx.spriteName || null,
          count: isBatch ? count : undefined,
          variantIds: isBatch && Array.isArray(ctx.variantIds)
            ? ctx.variantIds.map(String)
            : undefined,
          priorityLevel: ctx.priorityLevel || null,
          recipientCollectionStatus: ctx.recipientCollectionStatus || null,
          template: isBatch ? "batch" : (isPriority ? "priority" : "default")
        })
      };
    }

    case NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED: {
      const count = num(ctx.count);
      const isMilestone = ctx.kind === "milestone" || ctx.milestone != null;
      const isBatch = !isMilestone && (count > 1 || ctx.kind === "batch");
      return {
        translationKey,
        translationParams: pickTranslationParams({
          squadName: ctx.squadName || null,
          squadId: ctx.squadId != null ? String(ctx.squadId) : null,
          squadCode: ctx.squadCode || null,
          friendName: ctx.actorName || null,
          contributingUserId: ctx.contributingUserId != null
            ? String(ctx.contributingUserId)
            : null,
          variantName: ctx.variantName || null,
          variantIds: Array.isArray(ctx.newVariantIds)
            ? ctx.newVariantIds.map(String)
            : undefined,
          count: count > 0 ? count : undefined,
          completionRate: ctx.newRate ?? ctx.completionRate ?? null,
          previousRate: ctx.previousRate ?? null,
          milestone: ctx.milestone ?? null,
          coveredCount: ctx.coveredCount ?? ctx.newCoveredCount ?? null,
          totalVariants: ctx.totalVariants ?? null,
          template: isMilestone ? "milestone" : (isBatch ? "batch" : "default")
        })
      };
    }

    case NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE:
      return {
        translationKey,
        translationParams: pickTranslationParams({
          variantName: ctx.variantName || null,
          variantId: ctx.variantId != null ? String(ctx.variantId) : null,
          spriteName: ctx.spriteName || null,
          spriteId: ctx.spriteId != null ? String(ctx.spriteId) : null,
          variantType: ctx.variantType || null,
          availableUntil: ctx.availableUntil || null,
          availableFrom: ctx.availableFrom || null,
          availabilityPeriodId: ctx.availabilityPeriodId != null
            ? String(ctx.availabilityPeriodId)
            : null,
          eventId: ctx.eventId != null ? String(ctx.eventId) : null,
          confidence: ctx.confidence || null,
          template: "default"
        })
      };

    case NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON:
      return {
        translationKey,
        translationParams: pickTranslationParams({
          eventName: ctx.eventName || null,
          eventId: ctx.eventId != null ? String(ctx.eventId) : null,
          endingAt: ctx.endingAt || ctx.endDate || null,
          remainingCount: ctx.remainingCount != null
            ? num(ctx.remainingCount)
            : (ctx.wantedCount != null ? num(ctx.wantedCount) : null),
          variantIds: Array.isArray(ctx.remainingPriorityVariantIds)
            ? ctx.remainingPriorityVariantIds.map(String)
            : (Array.isArray(ctx.variantIds) ? ctx.variantIds.map(String) : undefined),
          threshold: ctx.threshold || null,
          hasStrongPriority: ctx.hasStrongPriority === true ? true : undefined,
          template: "default"
        })
      };

    default:
      return {
        translationKey,
        translationParams: pickTranslationParams({
          ...ctx,
          template: "default"
        })
      };
  }
}

/**
 * Rebuild a catalog context from stored translation params (+ optional extras).
 * Used to re-render title/body in another language or channel.
 */
function contextFromTranslationParams(translationParams = {}, extras = {}) {
  const p = translationParams && typeof translationParams === "object"
    ? translationParams
    : {};
  return {
    ...extras,
    actorName: p.friendName || p.actorName || extras.actorName || null,
    friendName: p.friendName || null,
    friendId: p.friendId || extras.friendId || null,
    friendshipId: p.friendshipId || extras.friendshipId || null,
    actorId: p.friendId || p.contributingUserId || extras.actorId || null,
    variantName: p.variantName || extras.variantName || null,
    highlightName: p.variantName || extras.highlightName || null,
    variantId: p.variantId || extras.variantId || null,
    variantIds: p.variantIds || extras.variantIds || null,
    spriteName: p.spriteName || extras.spriteName || null,
    spriteId: p.spriteId || extras.spriteId || null,
    variantType: p.variantType || extras.variantType || null,
    count: p.count != null ? p.count : extras.count,
    priorityLevel: p.priorityLevel || extras.priorityLevel || null,
    recipientCollectionStatus: p.recipientCollectionStatus || extras.recipientCollectionStatus || null,
    squadName: p.squadName || extras.squadName || null,
    squadId: p.squadId || extras.squadId || null,
    squadCode: p.squadCode || extras.squadCode || null,
    contributingUserId: p.contributingUserId || extras.contributingUserId || null,
    newVariantIds: p.variantIds || extras.newVariantIds || null,
    newRate: p.completionRate ?? extras.newRate,
    completionRate: p.completionRate ?? extras.completionRate,
    previousRate: p.previousRate ?? extras.previousRate,
    milestone: p.milestone ?? extras.milestone,
    coveredCount: p.coveredCount ?? extras.coveredCount,
    newCoveredCount: p.coveredCount ?? extras.newCoveredCount,
    totalVariants: p.totalVariants ?? extras.totalVariants,
    kind: p.template === "milestone" || p.template === "batch" ? p.template : extras.kind,
    eventName: p.eventName || extras.eventName || null,
    eventId: p.eventId || extras.eventId || null,
    endingAt: p.endingAt || extras.endingAt || null,
    endDate: p.endingAt || extras.endDate || null,
    remainingCount: p.remainingCount ?? extras.remainingCount,
    wantedCount: p.remainingCount ?? extras.wantedCount,
    remainingPriorityVariantIds: p.variantIds || extras.remainingPriorityVariantIds || null,
    threshold: p.threshold || extras.threshold || null,
    hasStrongPriority: p.hasStrongPriority ?? extras.hasStrongPriority,
    availableUntil: p.availableUntil || extras.availableUntil || null,
    availableFrom: p.availableFrom || extras.availableFrom || null,
    availabilityPeriodId: p.availabilityPeriodId || extras.availabilityPeriodId || null,
    confidence: p.confidence || extras.confidence || null
  };
}

/** Re-render from a stored translation payload (Étape 61/62). */
function renderFromTranslation(type, translationParams = {}, lang = DEFAULT_LANGUAGE, extras = {}) {
  return renderNotification(type, contextFromTranslationParams(translationParams, extras), lang);
}

// Render one notification in one language.
// Returns { title, body, url, data, actions? } or null for an unknown type.
// Étape 55 — persist grouping metadata (count, principals, first/latest, destination).
function withGroupData(data, ctx) {
  const group = ctx && ctx.group && typeof ctx.group === "object" ? ctx.group : null;
  if (!group || !group.groupKey) return data || {};
  const destination = group.destination || (data && data.actionUrl) || null;
  return {
    ...(data || {}),
    groupKey: group.groupKey,
    group: {
      groupKey: group.groupKey,
      eventCount: Number(group.eventCount) || 0,
      principalElements: Array.isArray(group.principalElements) ? group.principalElements : [],
      firstEvent: group.firstEvent || null,
      mostRecent: group.mostRecent || null,
      destination: destination || null
    }
  };
}

function buildRenderTranslationParams(type, ctx = {}, locale = DEFAULT_LANGUAGE) {
  const payload = buildTranslationPayload(type, ctx) || {
    translationKey: translationKeyForType(type),
    translationParams: {}
  };
  const params = { ...(payload.translationParams || {}) };

  // Locale-sensitive derived fields for templates.
  if (type === NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON) {
    params.when = formatEventEndingWhen(ctx, locale);
  }
  if (type === NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE && (ctx.availableUntil || params.availableUntil)) {
    const tz = normalizeTimeZone(ctx.timeZone || ctx.timezone);
    const formatted = formatEndDate(ctx.availableUntil || params.availableUntil, locale, tz);
    if (formatted) {
      params.availableUntil = formatted;
      params.availableUntilFormatted = formatted;
      if (!params.template || params.template === "default") params.template = "with_end";
    }
  }

  // Prefer already-localized names on the context (set by enrich step).
  if (ctx.variantName) params.variantName = ctx.variantName;
  if (ctx.highlightName && (!params.variantName || num(ctx.count) > 1)) {
    params.variantName = ctx.highlightName;
  }
  if (ctx.spriteName) params.spriteName = ctx.spriteName;
  if (ctx.actorName) params.friendName = ctx.actorName;
  if (ctx.squadName) params.squadName = ctx.squadName;
  if (ctx.eventName) params.eventName = ctx.eventName;

  return params;
}

function renderNotification(type, context = {}, lang = DEFAULT_LANGUAGE) {
  const def = DEFINITIONS[type];
  if (!def) return null;
  const ctx = context && typeof context === "object" ? context : {};
  const locale = normalizeLang(lang);

  // Étape 62 — prefer translation catalogs; fall back to legacy builders.
  const i18n = require("../notification-i18n");
  const translationParams = buildRenderTranslationParams(type, ctx, locale);
  const translated = i18n.renderTranslatedMessage(type, translationParams, locale);
  const builder = typeof def[locale] === "function"
    ? def[locale]
    : (typeof def.en === "function" ? def.en : def.fr);
  const built = translated || builder(ctx);

  const data = withGroupData(
    typeof def.data === "function" ? def.data(ctx) : {},
    ctx
  );
  // Keep translation payload on the rendered data for persistence / API.
  const translation = buildTranslationPayload(type, ctx);
  if (translation) {
    data.translationKey = translation.translationKey;
    data.translationParams = translation.translationParams;
  }

  const actions = typeof def.actions === "function" ? def.actions(ctx, locale) : null;
  return {
    title: built.title,
    body: built.body,
    // Étape 48 — never fall back to home; omit url when destination is unknown.
    url: (data && data.actionUrl) || (def.url ? def.url(ctx) : null) || null,
    data,
    ...(actions ? { actions } : {})
  };
}

/**
 * Étape 62 — async render that resolves sprite/variant names from the
 * localized catalog before interpolating templates.
 */
async function renderNotificationLocalized(pool, type, context = {}, lang = DEFAULT_LANGUAGE) {
  const locale = normalizeLang(lang);
  const ctx = context && typeof context === "object" ? { ...context } : {};
  const i18n = require("../notification-i18n");
  const variantId = ctx.variantId || (Array.isArray(ctx.variantIds) ? ctx.variantIds[0] : null);
  if (pool && (variantId || ctx.spriteId)) {
    const names = await i18n.lookupLocalizedCatalogNames(pool, {
      variantId: variantId || null,
      spriteId: ctx.spriteId || null
    }, locale);
    if (names.variantName) {
      ctx.variantName = names.variantName;
      if (!ctx.highlightName) ctx.highlightName = names.variantName;
    }
    if (names.spriteName) ctx.spriteName = names.spriteName;
    if (names.spriteId && !ctx.spriteId) ctx.spriteId = names.spriteId;
  }
  return renderNotification(type, ctx, locale);
}

// Render every supported locale at once: { fr: {...}, en: {...} }.
// Useful when a caller wants to persist all translations for later display.
function renderAllLocales(type, context = {}) {
  if (!DEFINITIONS[type]) return null;
  const out = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    out[lang] = renderNotification(type, context, lang);
  }
  return out;
}

function getNotificationUrl(type, context = {}) {
  const def = DEFINITIONS[type];
  if (!def || !def.url) return null;
  return def.url(context && typeof context === "object" ? context : {}) || null;
}


module.exports = { isKnownType, normalizeLang, pickLocaleCopy, pickTranslationParams, translationKeyForType, buildTranslationPayload, contextFromTranslationParams, renderFromTranslation, withGroupData, buildRenderTranslationParams, renderNotification, renderNotificationLocalized, renderAllLocales, getNotificationUrl, TRANSLATION_KEY_PREFIX };
