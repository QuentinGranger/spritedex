"use strict";

const { NOTIFICATION_TYPES, NOTIFICATION_CATEGORIES } = require("./constants");
const { str, num, pct, pluralFr, pluralEn, variantLabel, formatEndDate, buildPriorityVariantActionUrl, buildWantedEventActionUrl, buildSquadEngineActionUrl, buildFriendCompareActionUrl, formatThresholdRemaining, formatEventEndingWhen, FALLBACK_NAME, FALLBACK_SPRITE, FALLBACK_SQUAD, FALLBACK_EVENT } = require("./locale");
const { normalizeTimeZone } = require("../timezone");

module.exports = {
  [NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED]: {
    category: NOTIFICATION_CATEGORIES.SOCIAL,
    channels: ["in_app", "push"],
    // Étape 13 — content: title names the accepter, body invites to compare.
    fr(ctx) {
      const name = str(ctx.actorName, FALLBACK_NAME.fr);
      return {
        title: `${name} a accepté votre invitation`,
        body: "Vous pouvez maintenant comparer vos collections."
      };
    },
    en(ctx) {
      const name = str(ctx.actorName, FALLBACK_NAME.en);
      return {
        title: `${name} accepted your invitation`,
        body: "You can now compare your collections."
      };
    },
    url: (ctx) => buildFriendCompareActionUrl(ctx) || "/friends",
    data(ctx) {
      const friendId = ctx.friendId != null
        ? String(ctx.friendId)
        : (ctx.actorId != null ? String(ctx.actorId) : null);
      const friendshipId = ctx.friendshipId != null ? String(ctx.friendshipId) : null;
      const actionUrl = buildFriendCompareActionUrl(ctx);
      return {
        ...(friendId ? { friendId } : {}),
        ...(friendshipId ? { friendshipId } : {}),
        ...(actionUrl ? { actionUrl } : {})
      };
    },
    actions(ctx, lang) {
      const friendId = ctx.friendId != null
        ? String(ctx.friendId)
        : (ctx.actorId != null ? String(ctx.actorId) : null);
      const compareUrl = buildFriendCompareActionUrl(ctx) || "/friends";
      const profileUrl = friendId ? `/profile/${encodeURIComponent(friendId)}` : "/friends";
      if (lang === "en") {
        return {
          primary: { id: "compare", label: "Compare our collections", url: compareUrl },
          secondary: { id: "profile", label: "View profile", url: profileUrl }
        };
      }
      if (lang === "nl") {
        return {
          primary: { id: "compare", label: "Onze collecties vergelijken", url: compareUrl },
          secondary: { id: "profile", label: "Profiel bekijken", url: profileUrl }
        };
      }
      return {
        primary: { id: "compare", label: "Comparer nos collections", url: compareUrl },
        secondary: { id: "profile", label: "Voir le profil", url: profileUrl }
      };
    }
  },

  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: {
    category: NOTIFICATION_CATEGORIES.COLLECTION,
    channels: ["in_app", "push"],
    // Étape 19 — wording depends on recipient interest (priority vs missing)
    // and Étape 20 — batched acquisitions (count > 1).
    fr(ctx) {
      const name = str(ctx.actorName, FALLBACK_NAME.fr);
      const count = num(ctx.count);
      if (count > 1) {
        const highlight = str(ctx.highlightName || ctx.variantName, FALLBACK_SPRITE.fr);
        return {
          title: `${name} a plusieurs variantes qui vous manquent`,
          body: `${name} possède désormais ${count} variantes qui manquent à votre collection, dont ${highlight}.`
        };
      }
      const variant = variantLabel(ctx, "fr");
      if (ctx.priorityLevel === "strong" || ctx.recipientCollectionStatus === "priority") {
        return {
          title: `${name} possède une variante prioritaire`,
          body: `${name} vient d'ajouter ${variant}, que vous recherchez en priorité.`
        };
      }
      return {
        title: `Une nouvelle correspondance avec ${name}`,
        body: `${name} possède désormais ${variant}, qui manque à votre collection.`
      };
    },
    en(ctx) {
      const name = str(ctx.actorName, FALLBACK_NAME.en);
      const count = num(ctx.count);
      if (count > 1) {
        const highlight = str(ctx.highlightName || ctx.variantName, FALLBACK_SPRITE.en);
        return {
          title: `${name} has several variants you're missing`,
          body: `${name} now owns ${count} variants missing from your collection, including ${highlight}.`
        };
      }
      const variant = variantLabel(ctx, "en");
      if (ctx.priorityLevel === "strong" || ctx.recipientCollectionStatus === "priority") {
        return {
          title: `${name} owns a priority variant`,
          body: `${name} just added ${variant}, which you marked as a priority.`
        };
      }
      return {
        title: `A new match with ${name}`,
        body: `${name} now owns ${variant}, which is missing from your collection.`
      };
    },
    url: (ctx) => buildFriendCompareActionUrl(ctx, { withVariant: true }),
    data(ctx) {
      const friendId = ctx.friendId != null
        ? String(ctx.friendId)
        : (ctx.actorId != null ? String(ctx.actorId) : null);
      const variantId = ctx.variantId != null ? String(ctx.variantId) : null;
      const actionUrl = buildFriendCompareActionUrl(ctx, { withVariant: true });
      const out = {
        ...(friendId ? { friendId } : {}),
        ...(variantId ? { variantId } : {}),
        ...(ctx.recipientCollectionStatus ? { recipientCollectionStatus: ctx.recipientCollectionStatus } : {}),
        ...(actionUrl ? { actionUrl } : {})
      };
      if (num(ctx.count) > 1 && Array.isArray(ctx.variantIds)) {
        out.count = num(ctx.count);
        out.variantIds = ctx.variantIds.map(String);
      }
      return out;
    },
    actions(ctx, lang) {
      const friendId = ctx.friendId != null
        ? String(ctx.friendId)
        : (ctx.actorId != null ? String(ctx.actorId) : null);
      const compareUrl = buildFriendCompareActionUrl(ctx, { withVariant: true });
      if (lang === "en") {
        return {
          primary: { id: "compare", label: "Compare collections", url: compareUrl },
          secondary: friendId
            ? { id: "profile", label: "View profile", url: `/profile/${encodeURIComponent(friendId)}` }
            : null
        };
      }
      if (lang === "nl") {
        return {
          primary: { id: "compare", label: "Collecties vergelijken", url: compareUrl },
          secondary: friendId
            ? { id: "profile", label: "Profiel bekijken", url: `/profile/${encodeURIComponent(friendId)}` }
            : null
        };
      }
      return {
        primary: { id: "compare", label: "Comparer les collections", url: compareUrl },
        secondary: friendId
          ? { id: "profile", label: "Voir le profil", url: `/profile/${encodeURIComponent(friendId)}` }
          : null
      };
    }
  },

  [NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED]: {
    category: NOTIFICATION_CATEGORIES.COLLECTION,
    channels: ["in_app", "push"],
    // Étape 26 — ordinary progress vs milestone vs batched gains.
    fr(ctx) {
      const squad = str(ctx.squadName, FALLBACK_SQUAD.fr);
      const rate = pct(ctx.newRate ?? ctx.completionRate);
      const count = num(ctx.count);
      if (ctx.kind === "milestone" || ctx.milestone != null) {
        const milestone = ctx.milestone != null ? pct(ctx.milestone) : rate;
        const covered = num(ctx.coveredCount ?? ctx.newCoveredCount);
        const total = num(ctx.totalVariants);
        return {
          title: `${squad} atteint ${milestone} %`,
          body: total > 0
            ? `Votre squad couvre désormais ${covered} variantes sur ${total}.`
            : `Votre squad couvre désormais ${rate} % du catalogue.`
        };
      }
      if (count > 1 || ctx.kind === "batch") {
        return {
          title: `${squad} progresse`,
          body: `${squad} a ajouté ${count} nouvelles variantes et atteint ${rate} % de complétion.`
        };
      }
      const actor = str(ctx.actorName, FALLBACK_NAME.fr);
      const variant = str(ctx.variantName, FALLBACK_SPRITE.fr);
      return {
        title: `${squad} progresse`,
        body: `${actor} a ajouté ${variant}. La squad couvre maintenant ${rate} % du catalogue.`
      };
    },
    en(ctx) {
      const squad = str(ctx.squadName, FALLBACK_SQUAD.en);
      const rate = pct(ctx.newRate ?? ctx.completionRate);
      const count = num(ctx.count);
      if (ctx.kind === "milestone" || ctx.milestone != null) {
        const milestone = ctx.milestone != null ? pct(ctx.milestone) : rate;
        const covered = num(ctx.coveredCount ?? ctx.newCoveredCount);
        const total = num(ctx.totalVariants);
        return {
          title: `${squad} reached ${milestone}%`,
          body: total > 0
            ? `Your squad now covers ${covered} variants out of ${total}.`
            : `Your squad now covers ${rate}% of the catalogue.`
        };
      }
      if (count > 1 || ctx.kind === "batch") {
        return {
          title: `${squad} is progressing`,
          body: `${squad} added ${count} new variants and reached ${rate}% completion.`
        };
      }
      const actor = str(ctx.actorName, FALLBACK_NAME.en);
      const variant = str(ctx.variantName, FALLBACK_SPRITE.en);
      return {
        title: `${squad} is progressing`,
        body: `${actor} added ${variant}. The squad now covers ${rate}% of the catalogue.`
      };
    },
    url: (ctx) => buildSquadEngineActionUrl(ctx),
    data(ctx) {
      const squadId = ctx.squadId != null ? String(ctx.squadId) : null;
      const squadCode = ctx.squadCode != null ? String(ctx.squadCode) : null;
      const contributingUserId = ctx.contributingUserId != null ? String(ctx.contributingUserId) : null;
      const newVariantIds = Array.isArray(ctx.newVariantIds) ? ctx.newVariantIds.map(String) : [];
      const actionUrl = buildSquadEngineActionUrl(ctx);
      return {
        ...(squadId ? { squadId } : {}),
        ...(squadCode ? { squadCode } : {}),
        ...(contributingUserId ? { contributingUserId } : {}),
        ...(newVariantIds.length ? { newVariantIds } : {}),
        ...(ctx.previousRate != null ? { previousRate: Number(ctx.previousRate) } : {}),
        ...(ctx.newRate != null || ctx.completionRate != null
          ? { newRate: Number(ctx.newRate ?? ctx.completionRate) }
          : {}),
        ...(ctx.milestone != null ? { milestone: Number(ctx.milestone) } : {}),
        ...(actionUrl ? { actionUrl } : {})
      };
    },
    actions(ctx, lang) {
      const url = buildSquadEngineActionUrl(ctx);
      if (lang === "en") {
        return { primary: { id: "open_squad_engine", label: "Open Squad Completion Engine", url } };
      }
      if (lang === "nl") {
        return { primary: { id: "open_squad_engine", label: "Squad Completion Engine openen", url } };
      }
      return { primary: { id: "open_squad_engine", label: "Ouvrir le Squad Completion Engine", url } };
    }
  },

  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: {
    category: NOTIFICATION_CATEGORIES.ALERTS,
    channels: ["in_app", "push", "email"],
    // Étape 32 — title names the variant; body mentions priority / end date.
    fr(ctx) {
      const name = str(ctx.variantName, FALLBACK_SPRITE.fr);
      const tz = normalizeTimeZone(ctx.timeZone || ctx.timezone);
      const until = formatEndDate(ctx.availableUntil, "fr", tz);
      return {
        title: `${name} est disponible`,
        body: until
          ? `${name} est disponible jusqu'au ${until}.`
          : "Une variante que vous recherchez en priorité est maintenant disponible."
      };
    },
    en(ctx) {
      const name = str(ctx.variantName, FALLBACK_SPRITE.en);
      const tz = normalizeTimeZone(ctx.timeZone || ctx.timezone);
      const until = formatEndDate(ctx.availableUntil, "en", tz);
      return {
        title: `${name} is available`,
        body: until
          ? `${name} is available until ${until}.`
          : "A variant you marked as a priority is now available."
      };
    },
    url: (ctx) => buildPriorityVariantActionUrl(ctx),
    data(ctx) {
      const variantId = ctx.variantId != null ? String(ctx.variantId) : null;
      const eventId = ctx.eventId != null ? String(ctx.eventId) : null;
      const spriteId = ctx.spriteId != null ? String(ctx.spriteId) : null;
      const variantType = ctx.variantType != null ? String(ctx.variantType) : null;
      const actionUrl = buildPriorityVariantActionUrl(ctx);
      return {
        ...(variantId ? { variantId } : {}),
        ...(spriteId ? { spriteId } : {}),
        ...(variantType ? { variantType } : {}),
        ...(eventId ? { eventId } : {}),
        ...(ctx.availableFrom ? { availableFrom: ctx.availableFrom } : {}),
        ...(ctx.availableUntil ? { availableUntil: ctx.availableUntil } : {}),
        ...(ctx.confidence ? { confidence: String(ctx.confidence) } : {}),
        ...(ctx.availabilityPeriodId ? { availabilityPeriodId: String(ctx.availabilityPeriodId) } : {}),
        ...(actionUrl ? { actionUrl } : {})
      };
    },
    actions(ctx, lang) {
      const url = buildPriorityVariantActionUrl(ctx);
      if (lang === "en") {
        return { primary: { id: "open_variant", label: "View variant", url } };
      }
      if (lang === "nl") {
        return { primary: { id: "open_variant", label: "Variant bekijken", url } };
      }
      return { primary: { id: "open_variant", label: "Voir la variante", url } };
    }
  },

  [NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON]: {
    category: NOTIFICATION_CATEGORIES.ALERTS,
    channels: ["in_app", "push", "email"],
    // Étape 37 — one notification per event, grouping all remaining priority variants.
    // Étape 40 — "demain" / "tomorrow" computed in the user's timezone.
    fr(ctx) {
      const event = str(ctx.eventName, FALLBACK_EVENT.fr);
      const count = num(ctx.remainingCount != null ? ctx.remainingCount : ctx.wantedCount);
      const when = formatEventEndingWhen(ctx, "fr");
      const variants = pluralFr(count, "variante prioritaire", "variantes prioritaires");
      return {
        title: `${event} se termine ${when}`,
        body: count > 0
          ? `Il vous manque encore ${count} ${variants}.`
          : "Il vous manque encore des variantes prioritaires."
      };
    },
    en(ctx) {
      const event = str(ctx.eventName, FALLBACK_EVENT.en);
      const count = num(ctx.remainingCount != null ? ctx.remainingCount : ctx.wantedCount);
      const when = formatEventEndingWhen(ctx, "en");
      const variants = pluralEn(count, "priority variant", "priority variants");
      return {
        title: `${event} ends ${when}`,
        body: count > 0
          ? `You still need ${count} ${variants}.`
          : "You still need priority variants from this event."
      };
    },
    url: (ctx) => buildWantedEventActionUrl(ctx),
    data(ctx) {
      const eventId = ctx.eventId != null ? String(ctx.eventId) : null;
      const endingAt = ctx.endingAt || ctx.endDate || null;
      const timeZone = normalizeTimeZone(ctx.timeZone || ctx.timezone);
      const ids = Array.isArray(ctx.remainingPriorityVariantIds)
        ? ctx.remainingPriorityVariantIds.map(String)
        : (Array.isArray(ctx.variantIds) ? ctx.variantIds.map(String) : []);
      const remainingCount = num(
        ctx.remainingCount != null ? ctx.remainingCount : (ctx.wantedCount != null ? ctx.wantedCount : ids.length)
      );
      return {
        ...(eventId ? { eventId } : {}),
        ...(endingAt ? { endingAt } : {}),
        timeZone,
        remainingPriorityVariantIds: ids,
        remainingCount,
        ...(ctx.threshold ? { threshold: String(ctx.threshold) } : {}),
        actionUrl: buildWantedEventActionUrl(ctx)
      };
    },
    actions(ctx, lang) {
      const url = buildWantedEventActionUrl(ctx);
      if (lang === "en") {
        return { primary: { id: "open_event", label: "View event", url } };
      }
      if (lang === "nl") {
        return { primary: { id: "open_event", label: "Evenement bekijken", url } };
      }
      return { primary: { id: "open_event", label: "Voir l'événement", url } };
    }
  },

};
