"use strict";

const { NOTIFICATION_TYPES, NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS, NOTIFICATION_CHANNEL_LIST, DEFAULT_LANGUAGE, normalizeLang } = require("./constants");

const CHANNEL_DEFINITIONS = {
  [NOTIFICATION_CHANNELS.IN_APP]: {
    fr: { label: "Dans l'application", description: "Apparaît dans le centre de notifications de sprite-index." },
    en: { label: "In app", description: "Appears in the sprite-index notification center." },
    nl: { label: "In de app", description: "Verschijnt in het meldingencentrum van sprite-index." }
  },
  [NOTIFICATION_CHANNELS.PUSH]: {
    fr: { label: "Notifications push", description: "Notification sur téléphone ou navigateur, après autorisation." },
    en: { label: "Push notifications", description: "Phone or browser push, after explicit consent." },
    nl: { label: "Pushmeldingen", description: "Melding op telefoon of browser, na uitdrukkelijke toestemming." }
  },
  [NOTIFICATION_CHANNELS.EMAIL]: {
    fr: { label: "E-mails", description: "Réservé aux alertes importantes ou aux résumés." },
    en: { label: "Emails", description: "Reserved for important alerts or summaries." },
    nl: { label: "E-mails", description: "Voorbehouden aan belangrijke waarschuwingen of samenvattingen." }
  }
};

// Étape 49 — settings screen organization (stable ids; labels per language).
const SETTINGS_TYPE_LABELS = {
  [NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED]: {
    fr: "Invitations d'amis acceptées",
    en: "Accepted friend invitations",
    nl: "Geaccepteerde vriendschapsverzoeken"
  },
  [NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT]: {
    fr: "Un ami possède une variante qui me manque",
    en: "A friend owns a variant I'm missing",
    nl: "Een vriend bezit een variant die ik mis"
  },
  [NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED]: {
    fr: "Progression de mes squads",
    en: "My squad progress",
    nl: "Voortgang van mijn squads"
  },
  [NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE]: {
    fr: "Une variante prioritaire devient disponible",
    en: "A priority variant becomes available",
    nl: "Een prioriteitsvariant wordt beschikbaar"
  },
  [NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON]: {
    fr: "Un événement recherché se termine bientôt",
    en: "A wanted event is ending soon",
    nl: "Een gevolgd evenement eindigt binnenkort"
  }
};

const NOTIFICATION_SETTINGS_SCREEN = Object.freeze({
  title: { fr: "Notifications", en: "Notifications", nl: "Meldingen" },
  channels: Object.freeze([...NOTIFICATION_CHANNEL_LIST]),
  groups: Object.freeze([
    Object.freeze({
      id: "social",
      category: NOTIFICATION_CATEGORIES.SOCIAL,
      label: { fr: "Social", en: "Social", nl: "Sociaal" },
      types: Object.freeze([NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED])
    }),
    Object.freeze({
      id: "collection",
      category: NOTIFICATION_CATEGORIES.COLLECTION,
      label: { fr: "Collections et squads", en: "Collections & squads", nl: "Collecties en squads" },
      types: Object.freeze([
        NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
        NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED
      ])
    }),
    Object.freeze({
      id: "alerts",
      category: NOTIFICATION_CATEGORIES.ALERTS,
      label: { fr: "Priorités et événements", en: "Priorities & events", nl: "Prioriteiten en evenementen" },
      types: Object.freeze([
        NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE,
        NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON
      ])
    })
  ]),
  comfort: Object.freeze([
    Object.freeze({
      id: "quiet_hours",
      label: { fr: "Heures silencieuses", en: "Quiet hours", nl: "Stille uren" }
    }),
    Object.freeze({
      id: "timezone",
      label: { fr: "Fuseau horaire", en: "Time zone", nl: "Tijdzone" }
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
    en: "Immediately",
    nl: "Onmiddellijk"
  },
  [NOTIFICATION_FREQUENCIES.DAILY_DIGEST]: {
    fr: "Résumé quotidien",
    en: "Daily digest",
    nl: "Dagelijks overzicht"
  },
  [NOTIFICATION_FREQUENCIES.DISABLED]: {
    fr: "Désactivé",
    en: "Disabled",
    nl: "Uitgeschakeld"
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
  const locale = normalizeLang(lang);
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
  [PUSH_MODES.ENABLED]: { fr: "Activé", en: "Enabled", nl: "Ingeschakeld" },
  [PUSH_MODES.DISABLED]: { fr: "Désactivé", en: "Disabled", nl: "Uitgeschakeld" },
  [PUSH_MODES.PRIORITIES_ONLY]: {
    fr: "Activé seulement pour les priorités",
    en: "Enabled for priorities only",
    nl: "Alleen ingeschakeld voor prioriteiten"
  },
  [PUSH_MODES.MILESTONES_ONLY]: {
    fr: "Paliers importants uniquement",
    en: "Important milestones only",
    nl: "Alleen belangrijke mijlpalen"
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
  const locale = normalizeLang(lang);
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
  const locale = normalizeLang(lang);
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


module.exports = { isKnownFrequency, isFrequencyConfigurable, getDefaultFrequency, normalizeFrequency, getFrequencyLabel, isKnownPushMode, getDefaultTypeDelivery, getPushModeOptions, normalizePushMode, getPushModeLabel, shouldAllowPushForDelivery, getNotificationSettingsScreen, CHANNEL_DEFINITIONS, SETTINGS_TYPE_LABELS, NOTIFICATION_SETTINGS_SCREEN, NOTIFICATION_FREQUENCIES, NOTIFICATION_FREQUENCY_LIST, FREQUENCY_LABELS, FREQUENCY_CONFIGURABLE_TYPES, DEFAULT_TYPE_FREQUENCIES, PUSH_MODES, PUSH_MODE_LIST, PUSH_MODE_LABELS, TYPE_PUSH_MODE_OPTIONS, DEFAULT_TYPE_DELIVERY };
