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
  WANTED_EVENT_ENDING_SOON: "wanted_event_ending_soon"
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
    en: { label: "Created", description: "The notification exists in the database." }
  },
  [NOTIFICATION_STATUSES.QUEUED]: {
    fr: { label: "En file", description: "En attente d'envoi par push ou e-mail." },
    en: { label: "Queued", description: "Waiting to be sent over push or email." }
  },
  [NOTIFICATION_STATUSES.DELIVERED]: {
    fr: { label: "Livrée", description: "Le canal externe a accepté ou livré l'envoi." },
    en: { label: "Delivered", description: "The external channel accepted or delivered it." }
  },
  [NOTIFICATION_STATUSES.FAILED]: {
    fr: { label: "Échouée", description: "L'envoi externe a échoué." },
    en: { label: "Failed", description: "The external send failed." }
  },
  [NOTIFICATION_STATUSES.READ]: {
    fr: { label: "Lue", description: "L'utilisateur l'a consultée dans sprite-index." },
    en: { label: "Read", description: "The user opened it inside sprite-index." }
  },
  [NOTIFICATION_STATUSES.ARCHIVED]: {
    fr: { label: "Archivée", description: "Retirée de la boîte principale." },
    en: { label: "Archived", description: "Removed from the main inbox." }
  },
  [NOTIFICATION_STATUSES.CANCELLED]: {
    fr: { label: "Annulée", description: "N'est plus pertinente avant son envoi." },
    en: { label: "Cancelled", description: "No longer relevant before it was sent." }
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
    en: { label: "Social", description: "Friend activity and invitations." }
  },
  [NOTIFICATION_CATEGORIES.COLLECTION]: {
    fr: { label: "Collections et escouades", description: "Progression des collections et des escouades." },
    en: { label: "Collections & squads", description: "Collection and squad progress." }
  },
  [NOTIFICATION_CATEGORIES.ALERTS]: {
    fr: { label: "Priorités et événements", description: "Variantes prioritaires et événements limités." },
    en: { label: "Priorities & events", description: "Priority variants and limited-time events." }
  }
};

const SUPPORTED_LANGUAGES = Object.freeze(["fr", "en"]);
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

// Étape 52 — global safety cap for ordinary sprite-index push notifications.
// Counted per local calendar day in the user's timezone. 0 disables the cap.
const DEFAULT_PUSH_MAX_PER_DAY = 8;

// Critical / legal / account-security pushes may bypass the daily cap.
const PUSH_DAILY_LIMIT_EXEMPT_TYPES = Object.freeze([
  "account_security",
  "legal_notice",
  "service_critical"
]);

function isExemptFromPushDailyLimit(type, context = {}) {
  const id = String(type || "").toLowerCase();
  if (PUSH_DAILY_LIMIT_EXEMPT_TYPES.includes(id)) return true;
  // Explicit context flag for system callers that don't use a stable type id yet.
  if (context && (context.bypassPushDailyLimit === true || context.critical === true)) {
    return true;
  }
  // Étape 53 — high send-priority scores may still push when the daily cap is hit.
  if (resolveSendPriority(type, context) >= PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE) {
    return true;
  }
  return false;
}

function resolvePushDailyLimit(maxPerDay) {
  if (maxPerDay === null || maxPerDay === undefined) return DEFAULT_PUSH_MAX_PER_DAY;
  const n = Number(maxPerDay);
  if (!Number.isFinite(n)) return DEFAULT_PUSH_MAX_PER_DAY;
  // 0 = unlimited (explicit opt-out of the safety cap).
  if (n <= 0) return 0;
  return Math.min(1000, Math.floor(n));
}

// Étape 53 — send priority score (higher = more important for push under the daily cap).
const SEND_PRIORITY_LEVELS = Object.freeze({
  CRITICAL: 100,
  HIGH: 75,
  NORMAL: 50,
  LOW: 25
});

// When the daily push limit is reached, only scores >= this still send push.
// Lower-priority notifications stay in-app only.
const PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE = 90;

const SEND_PRIORITY_BY_TYPE = Object.freeze({
  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: 90,
  [NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED]: 70,
  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: 50
});

function clampSendPriority(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return SEND_PRIORITY_LEVELS.NORMAL;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Resolve the send-priority score for a notification (Étape 53).
 * Context can refine the score (24h event ending, squad milestone, etc.).
 */
function resolveSendPriority(type, context = {}) {
  if (context && context.sendPriority != null) {
    return clampSendPriority(context.sendPriority);
  }

  const id = String(type || "");

  if (id === NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON) {
    // Last-chance 24h alerts are top-tier; earlier thresholds are high but below the bypass bar.
    return String(context.threshold || "").toLowerCase() === "24h" ? 90 : 75;
  }

  if (id === NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED) {
    if (context.milestone != null || context.kind === "milestone") return 65;
    return 35;
  }

  if (Object.prototype.hasOwnProperty.call(SEND_PRIORITY_BY_TYPE, id)) {
    return SEND_PRIORITY_BY_TYPE[id];
  }

  if (PUSH_DAILY_LIMIT_EXEMPT_TYPES.includes(id.toLowerCase())) {
    return SEND_PRIORITY_LEVELS.CRITICAL;
  }

  return SEND_PRIORITY_LEVELS.NORMAL;
}

/** Map a numeric score to the named band (critique / élevée / normale / faible). */
function classifySendPriority(score) {
  const n = clampSendPriority(score);
  if (n >= SEND_PRIORITY_LEVELS.CRITICAL) return "critical";
  if (n >= SEND_PRIORITY_LEVELS.HIGH) return "high";
  if (n >= SEND_PRIORITY_LEVELS.NORMAL) return "normal";
  return "low";
}

function getSendPriorityLabel(scoreOrLevel, lang = DEFAULT_LANGUAGE) {
  const level = typeof scoreOrLevel === "string"
    ? scoreOrLevel
    : classifySendPriority(scoreOrLevel);
  const locale = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  const labels = {
    critical: { fr: "Critique", en: "Critical" },
    high: { fr: "Élevée", en: "High" },
    normal: { fr: "Normale", en: "Normal" },
    low: { fr: "Faible", en: "Low" }
  };
  return (labels[level] && labels[level][locale]) || level;
}

const CHANNEL_DEFINITIONS = {
  [NOTIFICATION_CHANNELS.IN_APP]: {
    fr: { label: "Dans l'application", description: "Apparaît dans le centre de notifications de sprite-index." },
    en: { label: "In app", description: "Appears in the sprite-index notification center." }
  },
  [NOTIFICATION_CHANNELS.PUSH]: {
    fr: { label: "Notifications push", description: "Notification sur téléphone ou navigateur, après autorisation." },
    en: { label: "Push notifications", description: "Phone or browser push, after explicit consent." }
  },
  [NOTIFICATION_CHANNELS.EMAIL]: {
    fr: { label: "E-mails", description: "Réservé aux alertes importantes ou aux résumés." },
    en: { label: "Emails", description: "Reserved for important alerts or summaries." }
  }
};

// Étape 49 — settings screen organization (stable ids; labels per language).
const SETTINGS_TYPE_LABELS = {
  [NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED]: {
    fr: "Invitations d'amis acceptées",
    en: "Accepted friend invitations"
  },
  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: {
    fr: "Un ami possède une variante qui me manque",
    en: "A friend owns a variant I'm missing"
  },
  [NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED]: {
    fr: "Progression de mes squads",
    en: "My squad progress"
  },
  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: {
    fr: "Une variante prioritaire devient disponible",
    en: "A priority variant becomes available"
  },
  [NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON]: {
    fr: "Un événement recherché se termine bientôt",
    en: "A wanted event is ending soon"
  }
};

const NOTIFICATION_SETTINGS_SCREEN = Object.freeze({
  title: { fr: "Notifications", en: "Notifications" },
  channels: Object.freeze([...NOTIFICATION_CHANNEL_LIST]),
  groups: Object.freeze([
    Object.freeze({
      id: "social",
      category: NOTIFICATION_CATEGORIES.SOCIAL,
      label: { fr: "Social", en: "Social" },
      types: Object.freeze([NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED])
    }),
    Object.freeze({
      id: "collection",
      category: NOTIFICATION_CATEGORIES.COLLECTION,
      label: { fr: "Collections et squads", en: "Collections & squads" },
      types: Object.freeze([
        NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
        NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED
      ])
    }),
    Object.freeze({
      id: "alerts",
      category: NOTIFICATION_CATEGORIES.ALERTS,
      label: { fr: "Priorités et événements", en: "Priorities & events" },
      types: Object.freeze([
        NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE,
        NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON
      ])
    })
  ]),
  comfort: Object.freeze([
    Object.freeze({
      id: "quiet_hours",
      label: { fr: "Heures silencieuses", en: "Quiet hours" }
    }),
    Object.freeze({
      id: "timezone",
      label: { fr: "Fuseau horaire", en: "Time zone" }
    })
  ])
});

// Étape 50 — delivery frequency for selected notification types.
const NOTIFICATION_FREQUENCIES = Object.freeze({
  IMMEDIATE: "immediate",
  DAILY_DIGEST: "daily_digest",
  DISABLED: "disabled"
});

const NOTIFICATION_FREQUENCY_LIST = Object.freeze([
  NOTIFICATION_FREQUENCIES.IMMEDIATE,
  NOTIFICATION_FREQUENCIES.DAILY_DIGEST,
  NOTIFICATION_FREQUENCIES.DISABLED
]);

const FREQUENCY_LABELS = {
  [NOTIFICATION_FREQUENCIES.IMMEDIATE]: {
    fr: "Immédiatement",
    en: "Immediately"
  },
  [NOTIFICATION_FREQUENCIES.DAILY_DIGEST]: {
    fr: "Résumé quotidien",
    en: "Daily digest"
  },
  [NOTIFICATION_FREQUENCIES.DISABLED]: {
    fr: "Désactivé",
    en: "Disabled"
  }
};

// Types that expose a frequency selector in settings.
const FREQUENCY_CONFIGURABLE_TYPES = Object.freeze([
  NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
  NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE,
  NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON
]);

// Defaults: alerts stay immediate; friend acquisitions too (digest is opt-in).
const DEFAULT_TYPE_FREQUENCIES = Object.freeze({
  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: NOTIFICATION_FREQUENCIES.IMMEDIATE,
  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: NOTIFICATION_FREQUENCIES.IMMEDIATE,
  [NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON]: NOTIFICATION_FREQUENCIES.IMMEDIATE
});

function isKnownFrequency(frequency) {
  return NOTIFICATION_FREQUENCY_LIST.includes(frequency);
}

function isFrequencyConfigurable(type) {
  return FREQUENCY_CONFIGURABLE_TYPES.includes(type);
}

function getDefaultFrequency(type) {
  if (!isFrequencyConfigurable(type)) return NOTIFICATION_FREQUENCIES.IMMEDIATE;
  return DEFAULT_TYPE_FREQUENCIES[type] || NOTIFICATION_FREQUENCIES.IMMEDIATE;
}

function normalizeFrequency(frequency, type = null) {
  const raw = String(frequency || "").toLowerCase().trim();
  if (isKnownFrequency(raw)) return raw;
  return type ? getDefaultFrequency(type) : NOTIFICATION_FREQUENCIES.IMMEDIATE;
}

function getFrequencyLabel(frequency, lang = DEFAULT_LANGUAGE) {
  const id = normalizeFrequency(frequency);
  const locale = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  const def = FREQUENCY_LABELS[id];
  return def ? def[locale] : id;
}

// Étape 51 — recommended default delivery matrix (in-app + push mode).
const PUSH_MODES = Object.freeze({
  ENABLED: "enabled",
  DISABLED: "disabled",
  PRIORITIES_ONLY: "priorities_only",
  MILESTONES_ONLY: "milestones_only"
});

const PUSH_MODE_LIST = Object.freeze([
  PUSH_MODES.ENABLED,
  PUSH_MODES.DISABLED,
  PUSH_MODES.PRIORITIES_ONLY,
  PUSH_MODES.MILESTONES_ONLY
]);

const PUSH_MODE_LABELS = {
  [PUSH_MODES.ENABLED]: { fr: "Activé", en: "Enabled" },
  [PUSH_MODES.DISABLED]: { fr: "Désactivé", en: "Disabled" },
  [PUSH_MODES.PRIORITIES_ONLY]: {
    fr: "Activé seulement pour les priorités",
    en: "Enabled for priorities only"
  },
  [PUSH_MODES.MILESTONES_ONLY]: {
    fr: "Paliers importants uniquement",
    en: "Important milestones only"
  }
};

// Which push modes a type may expose in settings (besides enabled/disabled).
const TYPE_PUSH_MODE_OPTIONS = Object.freeze({
  [NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED]: Object.freeze([
    PUSH_MODES.ENABLED,
    PUSH_MODES.DISABLED
  ]),
  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: Object.freeze([
    PUSH_MODES.ENABLED,
    PUSH_MODES.PRIORITIES_ONLY,
    PUSH_MODES.DISABLED
  ]),
  [NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED]: Object.freeze([
    PUSH_MODES.ENABLED,
    PUSH_MODES.MILESTONES_ONLY,
    PUSH_MODES.DISABLED
  ]),
  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: Object.freeze([
    PUSH_MODES.ENABLED,
    PUSH_MODES.DISABLED
  ]),
  [NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON]: Object.freeze([
    PUSH_MODES.ENABLED,
    PUSH_MODES.DISABLED
  ])
});

const DEFAULT_TYPE_DELIVERY = Object.freeze({
  [NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED]: Object.freeze({
    inApp: true,
    push: PUSH_MODES.ENABLED
  }),
  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: Object.freeze({
    inApp: true,
    push: PUSH_MODES.PRIORITIES_ONLY
  }),
  [NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED]: Object.freeze({
    inApp: true,
    push: PUSH_MODES.MILESTONES_ONLY
  }),
  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: Object.freeze({
    inApp: true,
    push: PUSH_MODES.ENABLED
  }),
  [NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON]: Object.freeze({
    inApp: true,
    push: PUSH_MODES.ENABLED
  })
});

function isKnownPushMode(mode) {
  return PUSH_MODE_LIST.includes(mode);
}

function getDefaultTypeDelivery(type) {
  return DEFAULT_TYPE_DELIVERY[type] || { inApp: true, push: PUSH_MODES.ENABLED };
}

function getPushModeOptions(type) {
  return TYPE_PUSH_MODE_OPTIONS[type] || [PUSH_MODES.ENABLED, PUSH_MODES.DISABLED];
}

function normalizePushMode(mode, type = null) {
  const raw = String(mode || "").toLowerCase().trim();
  const allowed = type ? getPushModeOptions(type) : PUSH_MODE_LIST;
  if (allowed.includes(raw)) return raw;
  if (isKnownPushMode(raw) && (!type || allowed.includes(raw))) return raw;
  return getDefaultTypeDelivery(type).push;
}

function getPushModeLabel(mode, lang = DEFAULT_LANGUAGE) {
  const id = isKnownPushMode(mode) ? mode : PUSH_MODES.ENABLED;
  const locale = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  return (PUSH_MODE_LABELS[id] && PUSH_MODE_LABELS[id][locale]) || id;
}

/**
 * Étape 51 — whether push is allowed for this type given the user's push mode
 * and the notification context (priority / milestone).
 */
function shouldAllowPushForDelivery(pushMode, context = {}) {
  const mode = String(pushMode || PUSH_MODES.ENABLED);
  if (mode === PUSH_MODES.DISABLED) return false;
  if (mode === PUSH_MODES.ENABLED) return true;
  if (mode === PUSH_MODES.PRIORITIES_ONLY) {
    return context.priorityLevel === "strong"
      || context.recipientCollectionStatus === "priority"
      || context.hasStrongPriority === true;
  }
  if (mode === PUSH_MODES.MILESTONES_ONLY) {
    return context.milestone != null || context.kind === "milestone";
  }
  return true;
}

function getNotificationSettingsScreen(lang = DEFAULT_LANGUAGE) {
  const locale = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  return {
    title: NOTIFICATION_SETTINGS_SCREEN.title[locale],
    channels: NOTIFICATION_SETTINGS_SCREEN.channels.map((id) => ({
      id,
      label: (CHANNEL_DEFINITIONS[id] && CHANNEL_DEFINITIONS[id][locale]?.label) || id
    })),
    groups: NOTIFICATION_SETTINGS_SCREEN.groups.map((group) => ({
      id: group.id,
      category: group.category,
      label: group.label[locale],
      types: group.types.map((typeId) => {
        const defaults = getDefaultTypeDelivery(typeId);
        return {
          id: typeId,
          label: (SETTINGS_TYPE_LABELS[typeId] && SETTINGS_TYPE_LABELS[typeId][locale]) || typeId,
          frequencyConfigurable: isFrequencyConfigurable(typeId),
          defaultFrequency: getDefaultFrequency(typeId),
          defaultInApp: defaults.inApp,
          defaultPush: defaults.push,
          pushModes: getPushModeOptions(typeId).map((id) => ({
            id,
            label: getPushModeLabel(id, locale)
          }))
        };
      })
    })),
    frequencies: NOTIFICATION_FREQUENCY_LIST.map((id) => ({
      id,
      label: getFrequencyLabel(id, locale)
    })),
    comfort: NOTIFICATION_SETTINGS_SCREEN.comfort.map((item) => ({
      id: item.id,
      label: item.label[locale]
    }))
  };
}

// ── Small locale helpers (kept per-language on purpose) ──
const FALLBACK_NAME = { fr: "Quelqu'un", en: "Someone" };
const FALLBACK_SPRITE = { fr: "une variante", en: "a variant" };
const FALLBACK_SQUAD = { fr: "Une escouade", en: "A squad" };
const FALLBACK_EVENT = { fr: "un événement", en: "an event" };

function str(value, fallback = "") {
  const s = value === undefined || value === null ? "" : String(value).trim();
  return s || fallback;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Round a percentage to at most one decimal, dropping a trailing ".0".
function pct(value) {
  const n = num(value);
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function pluralFr(count, singular, plural) {
  return num(count) <= 1 ? singular : plural;
}

function pluralEn(count, singular, plural) {
  return num(count) === 1 ? singular : plural;
}

// Format a variant with its sprite for readability: "Nom (Sprite)".
function variantLabel(context, lang) {
  const variant = str(context.variantName, FALLBACK_SPRITE[lang]);
  const sprite = str(context.spriteName);
  return sprite ? `${variant} (${sprite})` : variant;
}

const {
  normalizeTimeZone,
  calendarDaysUntil,
  formatDateInTimeZone,
  DEFAULT_TIMEZONE
} = require("./timezone");

function formatEndDate(value, lang = DEFAULT_LANGUAGE, timeZone = DEFAULT_TIMEZONE) {
  if (!value) return null;
  return formatDateInTimeZone(value, lang, timeZone);
}

// Étape 48 — contextual destinations (never the home page).
function buildPriorityVariantActionUrl(ctx = {}) {
  const spriteId = ctx.spriteId != null ? String(ctx.spriteId) : null;
  const variantType = ctx.variantType != null ? String(ctx.variantType) : null;
  if (spriteId && variantType) {
    return `/sprites/${encodeURIComponent(spriteId)}?variant=${encodeURIComponent(String(variantType))}`;
  }
  if (ctx.variantId) return `/variant/${encodeURIComponent(String(ctx.variantId))}`;
  if (spriteId) return `/sprites/${encodeURIComponent(spriteId)}`;
  return null;
}

// Étape 37/48 — event screen filtered on missing priority variants.
function buildWantedEventActionUrl(ctx = {}) {
  const eventId = ctx.eventId != null ? String(ctx.eventId) : null;
  if (!eventId) return null;
  return `/events/${encodeURIComponent(eventId)}?filter=priority`;
}

function buildSquadEngineActionUrl(ctx = {}) {
  if (ctx.squadCode) return `/squad/${encodeURIComponent(String(ctx.squadCode))}/engine`;
  if (ctx.squadId) return `/squads/${encodeURIComponent(String(ctx.squadId))}/completion`;
  return null;
}

function buildFriendCompareActionUrl(ctx = {}, { withVariant = false } = {}) {
  const friendId = ctx.friendId != null
    ? String(ctx.friendId)
    : (ctx.actorId != null ? String(ctx.actorId) : null);
  if (!friendId) return null;
  const base = `/compare/${encodeURIComponent(friendId)}`;
  if (!withVariant) return base;
  const variantId = ctx.variantId != null ? String(ctx.variantId) : null;
  return variantId ? `${base}?variantId=${encodeURIComponent(variantId)}` : base;
}

// Human phrasing for Étape 35 thresholds ("dans 3 jours", "in 24 hours").
function formatThresholdRemaining(thresholdId, lang = DEFAULT_LANGUAGE) {
  const id = String(thresholdId || "").toLowerCase();
  if (lang === "en") {
    if (id === "24h") return "in 24 hours";
    if (id === "7d") return "in 7 days";
    return "in 3 days";
  }
  if (id === "24h") return "dans 24 heures";
  if (id === "7d") return "dans 7 jours";
  return "dans 3 jours";
}

/**
 * Étape 40 — relative end wording in the user's timezone.
 * Prefers calendar labels ("demain" / "tomorrow") when endingAt is known;
 * falls back to the threshold phrase otherwise.
 */
function formatEventEndingWhen(ctx = {}, lang = DEFAULT_LANGUAGE) {
  const endingAt = ctx.endingAt || ctx.endDate;
  const timeZone = normalizeTimeZone(ctx.timeZone || ctx.timezone);
  const now = ctx.now ? new Date(ctx.now) : new Date();
  if (endingAt) {
    const days = calendarDaysUntil(endingAt, now, timeZone);
    if (days === 0) return lang === "en" ? "today" : "aujourd'hui";
    if (days === 1) return lang === "en" ? "tomorrow" : "demain";
    if (Number.isInteger(days) && days > 1 && days <= 7) {
      if (lang === "en") return `in ${days} days`;
      return `dans ${days} jours`;
    }
  }
  return formatThresholdRemaining(ctx.threshold, lang);
}

// ── Per-type wording definitions ──
// Each entry keeps `fr` and `en` builders fully independent. A builder receives
// the raw context and returns { title, body }. `url` is language-agnostic and
// only depends on ids in the context (used for deep-linking / push payloads).
const DEFINITIONS = {
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
      return { primary: { id: "open_event", label: "Voir l'événement", url } };
    }
  }
};

function isKnownType(type) {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, type);
}

function normalizeLang(lang) {
  const l = str(lang).toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(l) ? l : DEFAULT_LANGUAGE;
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
  const i18n = require("./notification-i18n");
  const translationParams = buildRenderTranslationParams(type, ctx, locale);
  const translated = i18n.renderTranslatedMessage(type, translationParams, locale);
  const built = translated || def[locale](ctx);

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
  const i18n = require("./notification-i18n");
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

// ── Category accessors ──
function isKnownCategory(category) {
  return Object.prototype.hasOwnProperty.call(CATEGORY_DEFINITIONS, category);
}

// Returns the stable category id for a notification type, or null if unknown.
function getCategory(type) {
  const def = DEFINITIONS[type];
  return def ? def.category : null;
}

// Returns the ordered list of type ids belonging to a category.
function getTypesByCategory(category) {
  return CONTEXTUAL_NOTIFICATION_TYPES.filter(type => getCategory(type) === category);
}

// Returns the localized { label, description } for a category.
function getCategoryLabel(category, lang = DEFAULT_LANGUAGE) {
  const def = CATEGORY_DEFINITIONS[category];
  if (!def) return null;
  return def[normalizeLang(lang)];
}

// ── Channel accessors ──
function isKnownChannel(channel) {
  return Object.prototype.hasOwnProperty.call(CHANNEL_DEFINITIONS, channel);
}

// The default set of channels a notification type targets. in_app is always
// included (it is the notification center); email is reserved for a few
// important types. Unknown types default to in_app only.
function getTypeChannels(type) {
  const def = DEFINITIONS[type];
  const list = def && Array.isArray(def.channels) ? def.channels : ["in_app"];
  return list.slice();
}

function getChannelLabel(channel, lang = DEFAULT_LANGUAGE) {
  const def = CHANNEL_DEFINITIONS[channel];
  if (!def) return null;
  return def[normalizeLang(lang)];
}

// ── Status accessors ──
function isKnownStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_DEFINITIONS, status);
}

// Returns the localized { label, description } for a status.
function getStatusLabel(status, lang = DEFAULT_LANGUAGE) {
  const def = STATUS_DEFINITIONS[status];
  if (!def) return null;
  return def[normalizeLang(lang)];
}

// Whether `to` is a legal next status from `from`.
function canTransitionStatus(from, to) {
  if (!isKnownStatus(from) || !isKnownStatus(to)) return false;
  if (from === to) return true;
  return STATUS_TRANSITIONS[from].includes(to);
}

module.exports = {
  NOTIFICATION_TYPES,
  CONTEXTUAL_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LIST,
  NOTIFICATION_STATUSES,
  NOTIFICATION_STATUS_LIST,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LIST,
  DEFAULT_PUSH_MAX_PER_DAY,
  PUSH_DAILY_LIMIT_EXEMPT_TYPES,
  PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE,
  isExemptFromPushDailyLimit,
  resolvePushDailyLimit,
  SEND_PRIORITY_LEVELS,
  SEND_PRIORITY_BY_TYPE,
  resolveSendPriority,
  classifySendPriority,
  getSendPriorityLabel,
  clampSendPriority,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  isKnownType,
  isKnownCategory,
  isKnownStatus,
  isKnownChannel,
  renderNotification,
  renderNotificationLocalized,
  renderAllLocales,
  renderFromTranslation,
  TRANSLATION_KEY_PREFIX,
  translationKeyForType,
  buildTranslationPayload,
  contextFromTranslationParams,
  getNotificationUrl,
  getCategory,
  getTypesByCategory,
  getCategoryLabel,
  getStatusLabel,
  canTransitionStatus,
  getTypeChannels,
  getChannelLabel,
  formatEventEndingWhen,
  formatThresholdRemaining,
  buildPriorityVariantActionUrl,
  buildWantedEventActionUrl,
  buildSquadEngineActionUrl,
  buildFriendCompareActionUrl,
  NOTIFICATION_SETTINGS_SCREEN,
  getNotificationSettingsScreen,
  NOTIFICATION_FREQUENCIES,
  NOTIFICATION_FREQUENCY_LIST,
  FREQUENCY_CONFIGURABLE_TYPES,
  DEFAULT_TYPE_FREQUENCIES,
  isKnownFrequency,
  isFrequencyConfigurable,
  getDefaultFrequency,
  normalizeFrequency,
  getFrequencyLabel,
  PUSH_MODES,
  PUSH_MODE_LIST,
  DEFAULT_TYPE_DELIVERY,
  TYPE_PUSH_MODE_OPTIONS,
  isKnownPushMode,
  getDefaultTypeDelivery,
  getPushModeOptions,
  normalizePushMode,
  getPushModeLabel,
  shouldAllowPushForDelivery
};
