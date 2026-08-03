"use strict";

const { NOTIFICATION_TYPES, NOTIFICATION_CATEGORIES } = require("./constants");
const {
  str,
  num,
  pct,
  pluralFr,
  pluralEn,
  variantLabel,
  formatEndDate,
  buildPriorityVariantActionUrl,
  buildWantedEventActionUrl,
  buildSquadEngineActionUrl,
  buildFriendCompareActionUrl,
  formatThresholdRemaining,
  formatEventEndingWhen,
  FALLBACK_NAME,
  FALLBACK_SPRITE,
  FALLBACK_SQUAD,
  FALLBACK_EVENT
} = require("./locale");

module.exports = {
  [NOTIFICATION_TYPES.FRIEND_REQUEST_RECEIVED]: {
    category: NOTIFICATION_CATEGORIES.SOCIAL,
    channels: ["in_app", "push"],
    fr(ctx) {
      const name = str(ctx.actorName || ctx.friendName, FALLBACK_NAME.fr);
      return { title: "Nouvelle demande d'ami", body: `${name} vous a envoyé une demande d'ami.` };
    },
    en(ctx) {
      const name = str(ctx.actorName || ctx.friendName, FALLBACK_NAME.en);
      return { title: "New friend request", body: `${name} sent you a friend request.` };
    },
    url: () => "/friends",
    data(ctx) {
      const friendId = ctx.friendId != null ? String(ctx.friendId) : ctx.actorId != null ? String(ctx.actorId) : null;
      return friendId ? { friendId, actionUrl: "/friends" } : { actionUrl: "/friends" };
    },
    actions(_ctx, lang) {
      const label = lang === "en" ? "View friends" : lang === "nl" ? "Vrienden bekijken" : "Voir les amis";
      return { primary: { id: "friends", label, url: "/friends" } };
    }
  },

  [NOTIFICATION_TYPES.FRIEND_REMOVED]: {
    category: NOTIFICATION_CATEGORIES.SOCIAL,
    channels: ["in_app", "push"],
    fr(ctx) {
      const name = str(ctx.actorName || ctx.friendName, FALLBACK_NAME.fr);
      return { title: "Amitié terminée", body: `${name} a supprimé votre amitié.` };
    },
    en(ctx) {
      const name = str(ctx.actorName || ctx.friendName, FALLBACK_NAME.en);
      return { title: "Friendship ended", body: `${name} removed your friendship.` };
    },
    url: () => "/friends",
    data(ctx) {
      const friendId = ctx.friendId != null ? String(ctx.friendId) : ctx.actorId != null ? String(ctx.actorId) : null;
      return friendId ? { friendId } : {};
    }
  },

  [NOTIFICATION_TYPES.FRIEND_COLLECTION_UPDATED]: {
    category: NOTIFICATION_CATEGORIES.COLLECTION,
    channels: ["in_app", "push"],
    fr(ctx) {
      const name = str(ctx.actorName || ctx.ownerName || ctx.friendName, FALLBACK_NAME.fr);
      return { title: "Collection mise à jour", body: `${name} a mis à jour sa collection.` };
    },
    en(ctx) {
      const name = str(ctx.actorName || ctx.ownerName || ctx.friendName, FALLBACK_NAME.en);
      return { title: "Collection updated", body: `${name} updated their collection.` };
    },
    url: (ctx) => {
      const id = ctx.ownerId || ctx.friendId || ctx.actorId;
      return id ? `/collection/${encodeURIComponent(id)}` : "/friends";
    },
    data(ctx) {
      const ownerId = ctx.ownerId != null ? String(ctx.ownerId) : ctx.actorId != null ? String(ctx.actorId) : null;
      const actionUrl = ownerId ? `/collection/${encodeURIComponent(ownerId)}` : "/friends";
      return { ...(ownerId ? { ownerId, friendId: ownerId } : {}), actionUrl };
    },
    actions(ctx, lang) {
      const ownerId = ctx.ownerId || ctx.actorId;
      const url = ownerId ? `/collection/${encodeURIComponent(ownerId)}` : "/friends";
      return { primary: { id: "open", label: lang === "en" ? "Open" : lang === "nl" ? "Openen" : "Ouvrir", url } };
    }
  },

  [NOTIFICATION_TYPES.SQUAD_MEMBER_JOINED]: {
    category: NOTIFICATION_CATEGORIES.SOCIAL,
    channels: ["in_app", "push"],
    fr(ctx) {
      const name = str(ctx.actorName || ctx.joinerName, FALLBACK_NAME.fr);
      const squad = str(ctx.squadName, "l'escouade");
      return { title: "Nouveau membre", body: `${name} a rejoint l'escouade ${squad}.` };
    },
    en(ctx) {
      const name = str(ctx.actorName || ctx.joinerName, FALLBACK_NAME.en);
      const squad = str(ctx.squadName, "the squad");
      return { title: "New member", body: `${name} joined the squad ${squad}.` };
    },
    url: (ctx) =>
      ctx.squadCode
        ? `/squad/${encodeURIComponent(ctx.squadCode)}`
        : ctx.squadId
          ? `/?squad=${encodeURIComponent(ctx.squadId)}`
          : "/",
    data(ctx) {
      return {
        ...(ctx.squadId != null ? { squadId: String(ctx.squadId) } : {}),
        ...(ctx.squadCode ? { squadCode: ctx.squadCode } : {}),
        ...(ctx.squadName ? { squadName: ctx.squadName } : {})
      };
    }
  },

  [NOTIFICATION_TYPES.GOAL_COMPLETED]: {
    category: NOTIFICATION_CATEGORIES.COLLECTION,
    channels: ["in_app", "push"],
    fr(ctx) {
      const name = str(ctx.actorName || ctx.friendName, FALLBACK_NAME.fr);
      const titlePart = ctx.goalTitle ? ` : ${ctx.goalTitle}` : "";
      return { title: "Objectif atteint", body: `Objectif${titlePart} atteint par ${name}.` };
    },
    en(ctx) {
      const name = str(ctx.actorName || ctx.friendName, FALLBACK_NAME.en);
      const titlePart = ctx.goalTitle ? `: ${ctx.goalTitle}` : "";
      return { title: "Goal completed", body: `Goal${titlePart} completed by ${name}.` };
    },
    url: () => "/collection",
    data(ctx) {
      return {
        ...(ctx.goalId != null ? { goalId: String(ctx.goalId) } : {}),
        ...(ctx.goalTitle ? { goalTitle: ctx.goalTitle } : {}),
        actionUrl: "/collection"
      };
    }
  },

  [NOTIFICATION_TYPES.BADGE_UNLOCKED]: {
    category: NOTIFICATION_CATEGORIES.COLLECTION,
    channels: ["in_app", "push"],
    fr(ctx) {
      const labels = Array.isArray(ctx.badgeLabels) ? ctx.badgeLabels : [];
      if (labels.length > 1) {
        return {
          title: "Nouveaux badges débloqués",
          body: `Vous avez débloqué ${labels.length} badges : ${labels.join(", ")}.`
        };
      }
      return { title: "Nouveau badge débloqué", body: labels[0] || "Badge" };
    },
    en(ctx) {
      const labels = Array.isArray(ctx.badgeLabels) ? ctx.badgeLabels : [];
      if (labels.length > 1) {
        return {
          title: "New badges unlocked",
          body: `You've unlocked ${labels.length} badges: ${labels.join(", ")}.`
        };
      }
      return { title: "New badge unlocked", body: labels[0] || "Badge" };
    },
    url: () => "/?view=account",
    data(ctx) {
      return {
        actionUrl: "/?view=account",
        ...(Array.isArray(ctx.badgeCodes) ? { badgeCodes: ctx.badgeCodes } : {}),
        ...(Array.isArray(ctx.badgeLabels) ? { badgeLabels: ctx.badgeLabels } : {})
      };
    },
    actions(_ctx, lang) {
      return {
        primary: {
          id: "passport",
          label: lang === "en" ? "View my passport" : lang === "nl" ? "Mijn paspoort bekijken" : "Voir mon passeport",
          url: "/?view=account"
        }
      };
    }
  },

  [NOTIFICATION_TYPES.PASSPORT_CATALOGUE_UPDATED]: {
    category: NOTIFICATION_CATEGORIES.COLLECTION,
    channels: ["in_app", "push"],
    fr(ctx) {
      const added = num(ctx.addedVariantCount);
      const from = str(ctx.fromRate, "?");
      const to = str(ctx.toRate, "?");
      return {
        title: added === 1 ? "Une nouvelle variante a été ajoutée" : "Le catalogue a été mis à jour",
        body: `Votre complétion passe de ${from} % à ${to} %. Renseignez les nouvelles variantes.`
      };
    },
    en(ctx) {
      const added = num(ctx.addedVariantCount);
      const from = str(ctx.fromRate, "?");
      const to = str(ctx.toRate, "?");
      return {
        title: added === 1 ? "A new variant was added" : "The catalogue was updated",
        body: `Your completion went from ${from}% to ${to}%. Fill in the new variants.`
      };
    },
    url: () => "/?view=checklist",
    data(ctx) {
      return {
        actionUrl: "/?view=checklist",
        previousCompletionRate: ctx.previousCompletionRate ?? ctx.fromRate ?? null,
        completionRate: ctx.completionRate ?? ctx.toRate ?? null,
        catalogueVersion: ctx.catalogueVersion || null,
        addedVariantCount: ctx.addedVariantCount ?? null
      };
    },
    actions(_ctx, lang) {
      return {
        primary: {
          id: "checklist",
          label:
            lang === "en"
              ? "Update my collection"
              : lang === "nl"
                ? "Mijn collectie bijwerken"
                : "Mettre à jour ma collection",
          url: "/?view=checklist"
        }
      };
    }
  },

  [NOTIFICATION_TYPES.NEWS_ARTICLE]: {
    category: NOTIFICATION_CATEGORIES.ALERTS,
    channels: ["in_app", "push"],
    fr(ctx) {
      const count = num(ctx.count) || 1;
      const article = str(ctx.articleTitle, "Un article vient d'être ajouté");
      return {
        title: count > 1 ? `${count} nouvelles actus` : "Nouvelle actu SPRITE-INDEX",
        body: article
      };
    },
    en(ctx) {
      const count = num(ctx.count) || 1;
      const article = str(ctx.articleTitle, "A new article was added");
      return {
        title: count > 1 ? `${count} new articles` : "New SPRITE-INDEX news",
        body: article
      };
    },
    url: (ctx) => ctx.link || ctx.url || "/",
    data(ctx) {
      return {
        ...(ctx.link ? { link: ctx.link } : {}),
        ...(ctx.image ? { image: ctx.image } : {}),
        ...(ctx.newsId != null ? { newsId: ctx.newsId } : {}),
        actionUrl: ctx.link || ctx.url || "/"
      };
    }
  },

  [NOTIFICATION_TYPES.SQUAD_ACTIVITY]: {
    category: NOTIFICATION_CATEGORIES.SOCIAL,
    channels: ["push"],
    fr() {
      return { title: "SPRITE-INDEX — Escouade", body: "" };
    },
    en() {
      return { title: "SPRITE-INDEX — Squad", body: "" };
    },
    url: (ctx) => ctx.url || (ctx.squadId ? `/?squad=${encodeURIComponent(ctx.squadId)}` : "/"),
    data(ctx) {
      return { ...(ctx.squadId != null ? { squadId: String(ctx.squadId) } : {}) };
    }
  }
};
