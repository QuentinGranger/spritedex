"use strict";

// ── SPRITE-INDEX contextual notification catalog ──────────────────────────────
// Single source of truth for the "contextual notifications" feature.
//
// Design constraints (Étape 1):
//   1. Each notification has a STABLE technical id (NOTIFICATION_TYPES). These
//      ids never depend on the displayed text or the user's language, so they
//      stay valid across translations and copy changes.
//   2. French and English wordings are generated SEPARATELY (one builder per
//      language per type). We never translate a single template on the fly, so
//      each locale can phrase things idiomatically (gender, plurals, tone).
//
// A notification carries a `type` + a structured `context` (raw data such as
// names, counts, ids). The human-readable strings are derived from that pair
// by `renderNotification(type, context, lang)`. Storing the raw context (rather
// than only a frozen sentence) keeps the door open to re-render in another
// language later.

// ── Stable technical identifiers ──
// NEVER rename these values: they are persisted in the `notifications.type`
// column and referenced by clients. The keys are for code ergonomics only.
const NOTIFICATION_TYPES = Object.freeze({
  FRIEND_REQUEST_ACCEPTED: "friend_request_accepted",
  FRIEND_ACQUIRED_MISSING_VARIANT: "friend_acquired_missing_variant",
  SQUAD_COMPLETION_INCREASED: "squad_completion_increased",
  PRIORITY_VARIANT_AVAILABLE: "priority_variant_available",
  WANTED_EVENT_ENDING_SOON: "wanted_event_ending_soon",
  FRIEND_REQUEST_RECEIVED: "friend_request_received",
  FRIEND_REMOVED: "friend_removed",
  FRIEND_COLLECTION_UPDATED: "friend_collection_updated",
  SQUAD_MEMBER_JOINED: "squad_member_joined",
  GOAL_COMPLETED: "goal_completed",
  BADGE_UNLOCKED: "badge_unlocked",
  PASSPORT_CATALOGUE_UPDATED: "passport_catalogue_updated",
  NEWS_ARTICLE: "news_article",
  SQUAD_ACTIVITY: "squad_activity"
});

// The five notifications shipped in the first version, in a stable order.
const CONTEXTUAL_NOTIFICATION_TYPES = Object.freeze([
  NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
  NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
  NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED,
  NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE,
  NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON
]);

// ── Categories (Étape 2) ──
// Notifications are grouped into a few topic categories so users can mute a
// whole topic without disabling every notification. Like the type ids, the
// category ids are STABLE and language-independent; their user-facing labels
// are generated separately per language.
const NOTIFICATION_CATEGORIES = Object.freeze({
  SOCIAL: "social",
  COLLECTION: "collection",
  ALERTS: "alerts"
});

const NOTIFICATION_CATEGORY_LIST = Object.freeze([
  NOTIFICATION_CATEGORIES.SOCIAL,
  NOTIFICATION_CATEGORIES.COLLECTION,
  NOTIFICATION_CATEGORIES.ALERTS
]);

// ── Statuses (Étape 4) ──
// The lifecycle of a stored notification. Like types and categories, status
// ids are STABLE and language-independent; labels/descriptions are generated
// separately per language.
//   created   → row exists in the database
//   queued    → waiting to be sent over push / email
//   delivered → the external channel accepted / delivered the message
//   failed    → the external send failed
//   read      → the user opened it inside sprite-index
//   archived  → removed from the main inbox
//   cancelled → no longer relevant before it was ever sent
const NOTIFICATION_STATUSES = Object.freeze({
  CREATED: "created",
  QUEUED: "queued",
  DELIVERED: "delivered",
  FAILED: "failed",
  READ: "read",
  ARCHIVED: "archived",
  CANCELLED: "cancelled"
});

const NOTIFICATION_STATUS_LIST = Object.freeze([
  NOTIFICATION_STATUSES.CREATED,
  NOTIFICATION_STATUSES.QUEUED,
  NOTIFICATION_STATUSES.DELIVERED,
  NOTIFICATION_STATUSES.FAILED,
  NOTIFICATION_STATUSES.READ,
  NOTIFICATION_STATUSES.ARCHIVED,
  NOTIFICATION_STATUSES.CANCELLED
]);

const STATUS_DEFINITIONS = {
  [NOTIFICATION_STATUSES.CREATED]: {
    fr: { label: "Créée", description: "La notification existe dans la base." },
    en: { label: "Created", description: "The notification exists in the database." },
    nl: { label: "Aangemaakt", description: "De melding bestaat in de database." }
  },
  [NOTIFICATION_STATUSES.QUEUED]: {
    fr: { label: "En file", description: "En attente d'envoi par push ou e-mail." },
    en: { label: "Queued", description: "Waiting to be sent over push or email." },
    nl: { label: "In wachtrij", description: "Wacht op verzending via push of e-mail." }
  },
  [NOTIFICATION_STATUSES.DELIVERED]: {
    fr: { label: "Livrée", description: "Le canal externe a accepté ou livré l'envoi." },
    en: { label: "Delivered", description: "The external channel accepted or delivered it." },
    nl: { label: "Bezorgd", description: "Het externe kanaal heeft de verzending geaccepteerd of bezorgd." }
  },
  [NOTIFICATION_STATUSES.FAILED]: {
    fr: { label: "Échouée", description: "L'envoi externe a échoué." },
    en: { label: "Failed", description: "The external send failed." },
    nl: { label: "Mislukt", description: "De externe verzending is mislukt." }
  },
  [NOTIFICATION_STATUSES.READ]: {
    fr: { label: "Lue", description: "L'utilisateur l'a consultée dans sprite-index." },
    en: { label: "Read", description: "The user opened it inside sprite-index." },
    nl: { label: "Gelezen", description: "De gebruiker heeft de melding in sprite-index geopend." }
  },
  [NOTIFICATION_STATUSES.ARCHIVED]: {
    fr: { label: "Archivée", description: "Retirée de la boîte principale." },
    en: { label: "Archived", description: "Removed from the main inbox." },
    nl: { label: "Gearchiveerd", description: "Verwijderd uit de hoofd-inbox." }
  },
  [NOTIFICATION_STATUSES.CANCELLED]: {
    fr: { label: "Annulée", description: "N'est plus pertinente avant son envoi." },
    en: { label: "Cancelled", description: "No longer relevant before it was sent." },
    nl: { label: "Geannuleerd", description: "Niet langer relevant vóór verzending." }
  }
};

// Allowed forward transitions, used defensively so a delivered/read/terminal
// notification is not silently downgraded. Keys/values are status ids.
const STATUS_TRANSITIONS = Object.freeze({
  created: ["queued", "delivered", "failed", "read", "archived", "cancelled"],
  queued: ["delivered", "failed", "read", "archived", "cancelled"],
  delivered: ["read", "archived"],
  failed: ["queued", "read", "archived", "cancelled"],
  read: ["archived"],
  archived: [],
  cancelled: []
});

// Stable label/description wording per category, kept separate per language
// (same principle as the notification wording).
const CATEGORY_DEFINITIONS = {
  [NOTIFICATION_CATEGORIES.SOCIAL]: {
    fr: { label: "Social", description: "Activité de vos amis et invitations." },
    en: { label: "Social", description: "Friend activity and invitations." },
    nl: { label: "Sociaal", description: "Activiteit van vrienden en uitnodigingen." }
  },
  [NOTIFICATION_CATEGORIES.COLLECTION]: {
    fr: { label: "Collections et escouades", description: "Progression des collections et des escouades." },
    en: { label: "Collections & squads", description: "Collection and squad progress." },
    nl: { label: "Collecties en squads", description: "Voortgang van collecties en squads." }
  },
  [NOTIFICATION_CATEGORIES.ALERTS]: {
    fr: { label: "Priorités et événements", description: "Variantes prioritaires et événements limités." },
    en: { label: "Priorities & events", description: "Priority variants and limited-time events." },
    nl: { label: "Prioriteiten en evenementen", description: "Prioriteitsvarianten en tijdelijke evenementen." }
  }
};

const SUPPORTED_LANGUAGES = Object.freeze(["fr", "en", "nl"]);
const DEFAULT_LANGUAGE = "fr";

// ── Channels (Étape 7) ──
// Three delivery channels. Stable ids, labels generated separately per language.
//   in_app → sprite-index notification center (on by default for important events)
//   push   → device/browser push, subject to consent, quiet hours, frequency
//            limits and push-token state
//   email  → reserved for important alerts or summaries
const NOTIFICATION_CHANNELS = Object.freeze({
  IN_APP: "in_app",
  PUSH: "push",
  EMAIL: "email"
});

const NOTIFICATION_CHANNEL_LIST = Object.freeze([
  NOTIFICATION_CHANNELS.IN_APP,
  NOTIFICATION_CHANNELS.PUSH,
  NOTIFICATION_CHANNELS.EMAIL
]);

function normalizeLang(lang) {
  const locale = String(lang == null ? "" : lang)
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(locale) ? locale : DEFAULT_LANGUAGE;
}

module.exports = {
  normalizeLang,
  NOTIFICATION_TYPES,
  CONTEXTUAL_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LIST,
  NOTIFICATION_STATUSES,
  NOTIFICATION_STATUS_LIST,
  STATUS_DEFINITIONS,
  STATUS_TRANSITIONS,
  CATEGORY_DEFINITIONS,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LIST
};
