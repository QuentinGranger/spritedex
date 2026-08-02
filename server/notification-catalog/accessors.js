"use strict";

const { CONTEXTUAL_NOTIFICATION_TYPES, NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LIST, CATEGORY_DEFINITIONS, NOTIFICATION_CHANNELS, NOTIFICATION_CHANNEL_LIST, NOTIFICATION_STATUSES, STATUS_DEFINITIONS, STATUS_TRANSITIONS, DEFAULT_LANGUAGE } = require("./constants");
const DEFINITIONS = require("./definitions");
const { CHANNEL_DEFINITIONS } = require("./settings");
const { pickLocaleCopy } = require("./renderer");

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
  return pickLocaleCopy(def, lang);
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
  return pickLocaleCopy(def, lang);
}

// ── Status accessors ──
function isKnownStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_DEFINITIONS, status);
}

// Returns the localized { label, description } for a status.
function getStatusLabel(status, lang = DEFAULT_LANGUAGE) {
  const def = STATUS_DEFINITIONS[status];
  if (!def) return null;
  return pickLocaleCopy(def, lang);
}

// Whether `to` is a legal next status from `from`.
function canTransitionStatus(from, to) {
  if (!isKnownStatus(from) || !isKnownStatus(to)) return false;
  if (from === to) return true;
  return STATUS_TRANSITIONS[from].includes(to);
}


module.exports = { isKnownCategory, getCategory, getTypesByCategory, getCategoryLabel, isKnownChannel, getTypeChannels, getChannelLabel, isKnownStatus, getStatusLabel, canTransitionStatus };
