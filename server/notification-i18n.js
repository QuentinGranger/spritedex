// ── Étape 62 — Notification translation catalogs ───────────────────────────
// Message templates are keyed as:
//   notifications.{type}.title
//   notifications.{type}.body
// Optional template branch:
//   notifications.{type}.{template}.title|body
//
// Placeholders use `{paramName}` interpolation.
// Sprite / variant display names must come from the localized catalog
// (FR → name, EN → official_name), not from a frozen French string.

const TRANSLATIONS = Object.freeze({
  fr: Object.freeze({
    "notifications.friend_request_accepted.title":
      "{friendName} a accepté votre invitation",
    "notifications.friend_request_accepted.body":
      "Vous pouvez maintenant comparer vos collections.",

    "notifications.friend_acquired_missing_variant.title":
      "Une nouvelle correspondance avec {friendName}",
    "notifications.friend_acquired_missing_variant.body":
      "{friendName} possède désormais {variantName}, qui manque à votre collection.",
    "notifications.friend_acquired_missing_variant.priority.title":
      "{friendName} possède une variante prioritaire",
    "notifications.friend_acquired_missing_variant.priority.body":
      "{friendName} vient d'ajouter {variantName}, que vous recherchez en priorité.",
    "notifications.friend_acquired_missing_variant.batch.title":
      "{friendName} a plusieurs variantes qui vous manquent",
    "notifications.friend_acquired_missing_variant.batch.body":
      "{friendName} possède désormais {count} variantes qui manquent à votre collection, dont {variantName}.",

    "notifications.squad_completion_increased.title":
      "{squadName} progresse",
    "notifications.squad_completion_increased.body":
      "{friendName} a ajouté {variantName}. La squad couvre maintenant {completionRate} % du catalogue.",
    "notifications.squad_completion_increased.batch.title":
      "{squadName} progresse",
    "notifications.squad_completion_increased.batch.body":
      "{squadName} a ajouté {count} nouvelles variantes et atteint {completionRate} % de complétion.",
    "notifications.squad_completion_increased.milestone.title":
      "{squadName} atteint {milestone} %",
    "notifications.squad_completion_increased.milestone.body":
      "Votre squad couvre désormais {coveredCount} variantes sur {totalVariants}.",
    "notifications.squad_completion_increased.milestone_rate.body":
      "Votre squad couvre désormais {completionRate} % du catalogue.",

    "notifications.priority_variant_available.title":
      "{variantName} est disponible",
    "notifications.priority_variant_available.body":
      "Une variante que vous recherchez en priorité est maintenant disponible.",
    "notifications.priority_variant_available.with_end.title":
      "{variantName} est disponible",
    "notifications.priority_variant_available.with_end.body":
      "{variantName} est disponible jusqu'au {availableUntil}.",

    "notifications.wanted_event_ending_soon.title":
      "{eventName} se termine {when}",
    "notifications.wanted_event_ending_soon.body":
      "Il vous manque encore {remainingCount} {remainingLabel}.",
    "notifications.wanted_event_ending_soon.empty.body":
      "Il vous manque encore des variantes prioritaires.",

    "notifications.friend_request_received.title":
      "Nouvelle demande d'ami",
    "notifications.friend_request_received.body":
      "{friendName} vous a envoyé une demande d'ami.",

    "notifications.friend_removed.title":
      "Amitié terminée",
    "notifications.friend_removed.body":
      "{friendName} a supprimé votre amitié.",

    "notifications.friend_collection_updated.title":
      "Collection mise à jour",
    "notifications.friend_collection_updated.body":
      "{friendName} a mis à jour sa collection.",

    "notifications.squad_member_joined.title":
      "Nouveau membre",
    "notifications.squad_member_joined.body":
      "{friendName} a rejoint l'escouade {squadName}.",

    "notifications.goal_completed.title":
      "Objectif atteint",
    "notifications.goal_completed.body":
      "Objectif{goalTitleSuffix} atteint par {friendName}.",
    "notifications.goal_completed.titled.body":
      "Objectif : {goalTitle} atteint par {friendName}.",

    "notifications.badge_unlocked.title":
      "Nouveau badge débloqué",
    "notifications.badge_unlocked.body":
      "{badgeLabel}",
    "notifications.badge_unlocked.batch.title":
      "Nouveaux badges débloqués",
    "notifications.badge_unlocked.batch.body":
      "Vous avez débloqué {count} badges : {badgeList}.",

    "notifications.passport_catalogue_updated.title":
      "Le catalogue a été mis à jour",
    "notifications.passport_catalogue_updated.body":
      "Votre complétion passe de {fromRate} % à {toRate} %. Renseignez les nouvelles variantes.",
    "notifications.passport_catalogue_updated.single.title":
      "Une nouvelle variante a été ajoutée",
    "notifications.passport_catalogue_updated.single.body":
      "Votre complétion passe de {fromRate} % à {toRate} %. Renseignez les nouvelles variantes.",

    "notifications.news_article.title":
      "Nouvelle actu SPRITE-INDEX",
    "notifications.news_article.body":
      "{articleTitle}",
    "notifications.news_article.batch.title":
      "{count} nouvelles actus",
    "notifications.news_article.batch.body":
      "{articleTitle}",

    "notifications.squad_activity.title":
      "SPRITE-INDEX — Escouade",
    "notifications.squad_activity.member_joined.body":
      "{friendName} a rejoint la squad.",
    "notifications.squad_activity.friendship.body":
      "{usernameA} et {usernameB} sont devenus amis.",
    "notifications.squad_activity.milestone.body":
      "La squad a atteint {threshold} % de complétion.",
    "notifications.squad_activity.goal_created.body":
      "{friendName} a créé un objectif collectif{goalTitleSuffix}.",
    "notifications.squad_activity.goal_completed.body":
      "Objectif collectif{goalTitleSuffix} atteint par {friendName}.",
    "notifications.squad_activity.collection.body":
      "{friendName} {actionLabel} {spriteName}.",

    "notifications.actions.compare": "Comparer",
    "notifications.actions.open": "Ouvrir",
    "notifications.actions.view": "Voir",
    "notifications.actions.viewPassport": "Voir mon passeport",
    "notifications.actions.updateCollection": "Mettre à jour ma collection",
    "notifications.actions.viewFriends": "Voir les amis",
    "notifications.fallback.someone": "Quelqu'un",
    "notifications.fallback.member": "Un membre",
    "notifications.fallback.player": "Un joueur",
    "notifications.fallback.article": "Un article vient d'être ajouté",
    "notifications.fallback.articles": "{count} articles sur les sprites",
    "notifications.action.obtained": "a obtenu",
    "notifications.action.spotted": "a repéré",
    "notifications.hidden.title": "Notification masquée",
  }),

  en: Object.freeze({
    "notifications.friend_request_accepted.title":
      "{friendName} accepted your friend request",
    "notifications.friend_request_accepted.body":
      "You can now compare your collections.",

    "notifications.friend_acquired_missing_variant.title":
      "A new match with {friendName}",
    "notifications.friend_acquired_missing_variant.body":
      "{friendName} now owns {variantName}, which is missing from your collection.",
    "notifications.friend_acquired_missing_variant.priority.title":
      "{friendName} owns a priority variant",
    "notifications.friend_acquired_missing_variant.priority.body":
      "{friendName} just added {variantName}, which you marked as a priority.",
    "notifications.friend_acquired_missing_variant.batch.title":
      "{friendName} has several variants you're missing",
    "notifications.friend_acquired_missing_variant.batch.body":
      "{friendName} now owns {count} variants missing from your collection, including {variantName}.",

    "notifications.squad_completion_increased.title":
      "{squadName} is progressing",
    "notifications.squad_completion_increased.body":
      "{friendName} added {variantName}. The squad now covers {completionRate}% of the catalogue.",
    "notifications.squad_completion_increased.batch.title":
      "{squadName} is progressing",
    "notifications.squad_completion_increased.batch.body":
      "{squadName} added {count} new variants and reached {completionRate}% completion.",
    "notifications.squad_completion_increased.milestone.title":
      "{squadName} reached {milestone}%",
    "notifications.squad_completion_increased.milestone.body":
      "Your squad now covers {coveredCount} variants out of {totalVariants}.",
    "notifications.squad_completion_increased.milestone_rate.body":
      "Your squad now covers {completionRate}% of the catalogue.",

    "notifications.priority_variant_available.title":
      "{variantName} is available",
    "notifications.priority_variant_available.body":
      "A variant you marked as a priority is now available.",
    "notifications.priority_variant_available.with_end.title":
      "{variantName} is available",
    "notifications.priority_variant_available.with_end.body":
      "{variantName} is available until {availableUntil}.",

    "notifications.wanted_event_ending_soon.title":
      "{eventName} ends {when}",
    "notifications.wanted_event_ending_soon.body":
      "You still need {remainingCount} {remainingLabel}.",
    "notifications.wanted_event_ending_soon.empty.body":
      "You still need priority variants from this event.",

    "notifications.friend_request_received.title":
      "New friend request",
    "notifications.friend_request_received.body":
      "{friendName} sent you a friend request.",

    "notifications.friend_removed.title":
      "Friendship ended",
    "notifications.friend_removed.body":
      "{friendName} removed your friendship.",

    "notifications.friend_collection_updated.title":
      "Collection updated",
    "notifications.friend_collection_updated.body":
      "{friendName} updated their collection.",

    "notifications.squad_member_joined.title":
      "New member",
    "notifications.squad_member_joined.body":
      "{friendName} joined the squad {squadName}.",

    "notifications.goal_completed.title":
      "Goal completed",
    "notifications.goal_completed.body":
      "Goal{goalTitleSuffix} completed by {friendName}.",
    "notifications.goal_completed.titled.body":
      "Goal: {goalTitle} completed by {friendName}.",

    "notifications.badge_unlocked.title":
      "New badge unlocked",
    "notifications.badge_unlocked.body":
      "{badgeLabel}",
    "notifications.badge_unlocked.batch.title":
      "New badges unlocked",
    "notifications.badge_unlocked.batch.body":
      "You've unlocked {count} badges: {badgeList}.",

    "notifications.passport_catalogue_updated.title":
      "The catalogue was updated",
    "notifications.passport_catalogue_updated.body":
      "Your completion went from {fromRate}% to {toRate}%. Fill in the new variants.",
    "notifications.passport_catalogue_updated.single.title":
      "A new variant was added",
    "notifications.passport_catalogue_updated.single.body":
      "Your completion went from {fromRate}% to {toRate}%. Fill in the new variants.",

    "notifications.news_article.title":
      "New SPRITE-INDEX news",
    "notifications.news_article.body":
      "{articleTitle}",
    "notifications.news_article.batch.title":
      "{count} new articles",
    "notifications.news_article.batch.body":
      "{articleTitle}",

    "notifications.squad_activity.title":
      "SPRITE-INDEX — Squad",
    "notifications.squad_activity.member_joined.body":
      "{friendName} joined the squad.",
    "notifications.squad_activity.friendship.body":
      "{usernameA} and {usernameB} became friends.",
    "notifications.squad_activity.milestone.body":
      "The squad reached {threshold}% completion.",
    "notifications.squad_activity.goal_created.body":
      "{friendName} created a collective goal{goalTitleSuffix}.",
    "notifications.squad_activity.goal_completed.body":
      "Collective goal{goalTitleSuffix} completed by {friendName}.",
    "notifications.squad_activity.collection.body":
      "{friendName} {actionLabel} {spriteName}.",

    "notifications.actions.compare": "Compare",
    "notifications.actions.open": "Open",
    "notifications.actions.view": "View",
    "notifications.actions.viewPassport": "View my passport",
    "notifications.actions.updateCollection": "Update my collection",
    "notifications.actions.viewFriends": "View friends",
    "notifications.fallback.someone": "Someone",
    "notifications.fallback.member": "A member",
    "notifications.fallback.player": "A player",
    "notifications.fallback.article": "A new article was added",
    "notifications.fallback.articles": "{count} sprite articles",
    "notifications.action.obtained": "obtained",
    "notifications.action.spotted": "spotted",
    "notifications.hidden.title": "Hidden notification",
  })
});

const FALLBACK_NAME = Object.freeze({ fr: "Un joueur", en: "A player" });
const FALLBACK_SPRITE = Object.freeze({ fr: "une variante", en: "a variant" });
const FALLBACK_SQUAD = Object.freeze({ fr: "Votre squad", en: "Your squad" });
const FALLBACK_EVENT = Object.freeze({ fr: "L'événement", en: "The event" });

function getTranslations(lang) {
  const locale = String(lang || "fr").toLowerCase().slice(0, 2);
  return TRANSLATIONS[locale] || TRANSLATIONS.fr;
}

function interpolate(template, params = {}) {
  if (template == null) return null;
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    return value == null ? "" : String(value);
  });
}

function messageKey(type, part, template = "default") {
  const base = `notifications.${type}`;
  if (!template || template === "default") return `${base}.${part}`;
  return `${base}.${template}.${part}`;
}

function lookupMessage(lang, type, part, template = "default") {
  const dict = getTranslations(lang);
  const specific = dict[messageKey(type, part, template)];
  if (specific != null) return specific;
  if (template && template !== "default") {
    return dict[messageKey(type, part, "default")] || null;
  }
  return null;
}

/**
 * Pick a localized catalog label.
 * FR → local `name`, EN → `official_name`, with sensible fallbacks.
 */
function pickLocalizedName(lang, { name = null, officialName = null } = {}) {
  const locale = String(lang || "fr").toLowerCase().slice(0, 2);
  if (locale === "en") {
    return officialName || name || null;
  }
  return name || officialName || null;
}

/**
 * Load sprite/variant display names from the localized catalog.
 */
async function lookupLocalizedCatalogNames(pool, {
  variantId = null,
  spriteId = null
} = {}, lang = "fr") {
  if (!pool) return { variantName: null, spriteName: null, spriteId: null, variantId: null };
  if (variantId) {
    const res = await pool.query(
      `SELECT v.id AS variant_id, v.name AS variant_name, v.official_name AS variant_official,
              s.id AS sprite_id, s.name AS sprite_name, s.official_name AS sprite_official
       FROM sprite_variants v
       LEFT JOIN sprites s ON s.id = v.sprite_id
       WHERE v.id = $1`,
      [variantId]
    );
    const row = res.rows[0];
    if (!row) {
      return { variantName: null, spriteName: null, spriteId: null, variantId: String(variantId) };
    }
    return {
      variantId: String(row.variant_id),
      spriteId: row.sprite_id != null ? String(row.sprite_id) : null,
      variantName: pickLocalizedName(lang, {
        name: row.variant_name,
        officialName: row.variant_official
      }),
      spriteName: pickLocalizedName(lang, {
        name: row.sprite_name,
        officialName: row.sprite_official
      })
    };
  }
  if (spriteId) {
    const res = await pool.query(
      `SELECT id, name, official_name FROM sprites WHERE id = $1`,
      [spriteId]
    );
    const row = res.rows[0];
    if (!row) return { variantName: null, spriteName: null, spriteId: String(spriteId), variantId: null };
    return {
      variantId: null,
      spriteId: String(row.id),
      variantName: null,
      spriteName: pickLocalizedName(lang, {
        name: row.name,
        officialName: row.official_name
      })
    };
  }
  return { variantName: null, spriteName: null, spriteId: null, variantId: null };
}

function formatVariantDisplay(params, lang) {
  const variant = params.variantName || FALLBACK_SPRITE[lang] || FALLBACK_SPRITE.fr;
  const sprite = params.spriteName;
  return sprite ? `${variant} (${sprite})` : variant;
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Build interpolation params for a notification template.
 * Catalog names (variant/sprite) should already be localized by the caller
 * when a DB is available; frozen names are only fallbacks.
 */
function buildInterpolateParams(type, rawParams = {}, lang = "fr") {
  const p = rawParams && typeof rawParams === "object" ? { ...rawParams } : {};
  const locale = String(lang || "fr").toLowerCase().slice(0, 2);
  const friendName = p.friendName || p.actorName || p.ownerName || p.joinerName
    || FALLBACK_NAME[locale] || FALLBACK_NAME.fr;
  const variantLabel = formatVariantDisplay(p, locale);

  const out = {
    ...p,
    friendName,
    variantName: variantLabel,
    squadName: p.squadName || FALLBACK_SQUAD[locale] || FALLBACK_SQUAD.fr,
    eventName: p.eventName || FALLBACK_EVENT[locale] || FALLBACK_EVENT.fr,
    count: p.count != null ? Number(p.count) : undefined,
    completionRate: p.completionRate != null ? pct(p.completionRate) : undefined,
    milestone: p.milestone != null ? pct(p.milestone) : undefined,
    coveredCount: p.coveredCount != null ? Number(p.coveredCount) : undefined,
    totalVariants: p.totalVariants != null ? Number(p.totalVariants) : undefined,
    remainingCount: p.remainingCount != null ? Number(p.remainingCount) : undefined,
    availableUntil: p.availableUntilFormatted || p.availableUntil || undefined,
    when: p.when || undefined,
    goalTitle: p.goalTitle || undefined,
    goalTitleSuffix: p.goalTitle ? (locale === "en" ? `: ${p.goalTitle}` : ` : ${p.goalTitle}`) : "",
    badgeLabel: p.badgeLabel || (Array.isArray(p.badgeLabels) ? p.badgeLabels[0] : null) || undefined,
    badgeList: p.badgeList || (Array.isArray(p.badgeLabels) ? p.badgeLabels.join(", ") : undefined),
    fromRate: p.fromRate != null ? String(p.fromRate).replace(".", ",") : undefined,
    toRate: p.toRate != null ? String(p.toRate).replace(".", ",") : undefined,
    articleTitle: p.articleTitle || undefined,
    usernameA: p.usernameA || undefined,
    usernameB: p.usernameB || undefined,
    threshold: p.threshold != null ? String(p.threshold) : undefined,
    actionLabel: p.actionLabel || undefined,
    spriteName: p.spriteName || undefined
  };
  if (locale === "en" && out.fromRate) out.fromRate = String(p.fromRate);
  if (locale === "en" && out.toRate) out.toRate = String(p.toRate);

  if (type === "wanted_event_ending_soon") {
    const count = Number(out.remainingCount) || 0;
    if (locale === "en") {
      out.remainingLabel = count === 1 ? "priority variant" : "priority variants";
    } else {
      out.remainingLabel = count <= 1 ? "variante prioritaire" : "variantes prioritaires";
    }
  }

  return out;
}

function resolveTemplate(type, params = {}) {
  if (params.template && params.template !== "default") return params.template;
  if (type === "friend_acquired_missing_variant") {
    if (Number(params.count) > 1) return "batch";
    if (params.priorityLevel === "strong" || params.recipientCollectionStatus === "priority") {
      return "priority";
    }
  }
  if (type === "squad_completion_increased") {
    if (params.milestone != null) return "milestone";
    if (Number(params.count) > 1) return "batch";
  }
  if (type === "priority_variant_available" && params.availableUntil) {
    return "with_end";
  }
  if (type === "wanted_event_ending_soon" && !(Number(params.remainingCount) > 0)) {
    return "empty";
  }
  if (type === "badge_unlocked" && Number(params.count) > 1) return "batch";
  if (type === "passport_catalogue_updated" && Number(params.addedVariantCount) === 1) return "single";
  if (type === "news_article" && Number(params.count) > 1) return "batch";
  if (type === "goal_completed" && params.goalTitle) return "titled";
  if (type === "squad_activity" && params.activityTemplate) return params.activityTemplate;
  return "default";
}

/**
 * Render title/body from the translation catalogs.
 * Returns { title, body, translationKey } or null if keys are missing.
 */
function renderTranslatedMessage(type, translationParams = {}, lang = "fr") {
  if (!type) return null;
  const template = resolveTemplate(type, translationParams);
  let bodyTemplateKey = template;
  // Milestone without covered/total uses the rate-only body.
  if (
    type === "squad_completion_increased"
    && template === "milestone"
    && !(Number(translationParams.totalVariants) > 0)
  ) {
    bodyTemplateKey = "milestone_rate";
  }
  if (
    type === "wanted_event_ending_soon"
    && !(Number(translationParams.remainingCount) > 0)
  ) {
    bodyTemplateKey = "empty";
  }

  const titleTpl = lookupMessage(lang, type, "title", template === "empty" ? "default" : template);
  const bodyTpl = lookupMessage(lang, type, "body", bodyTemplateKey);
  if (!titleTpl && !bodyTpl) return null;

  const params = buildInterpolateParams(type, translationParams, lang);
  const baseKey = `notifications.${type}`;
  return {
    title: interpolate(titleTpl || lookupMessage(lang, type, "title", "default"), params) || "",
    body: interpolate(bodyTpl || lookupMessage(lang, type, "body", "default"), params) || "",
    translationKey: baseKey,
    template
  };
}

/**
 * Enrich translation params with localized catalog names (async).
 */
async function enrichParamsWithLocalizedCatalog(pool, translationParams = {}, lang = "fr") {
  const params = { ...(translationParams || {}) };
  const variantId = params.variantId || null;
  const spriteId = params.spriteId || null;
  if (!variantId && !spriteId) return params;

  const names = await lookupLocalizedCatalogNames(pool, { variantId, spriteId }, lang);
  if (names.variantName) params.variantName = names.variantName;
  if (names.spriteName) params.spriteName = names.spriteName;
  if (names.spriteId && !params.spriteId) params.spriteId = names.spriteId;
  return params;
}

function tNotif(key, params = {}, lang = "fr") {
  const dict = getTranslations(lang);
  const tpl = dict[key];
  if (tpl == null) return null;
  return interpolate(tpl, params);
}

module.exports = {
  TRANSLATIONS,
  getTranslations,
  interpolate,
  messageKey,
  lookupMessage,
  pickLocalizedName,
  lookupLocalizedCatalogNames,
  buildInterpolateParams,
  resolveTemplate,
  renderTranslatedMessage,
  tNotif,
  enrichParamsWithLocalizedCatalog
};
