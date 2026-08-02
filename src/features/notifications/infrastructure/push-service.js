"use strict";

// Compatibility facade. The implementation is split by responsibility in
// push-service/ while preserving the historic CommonJS entry point.
const notificationCatalog = require("../../../../server/notification-catalog");
const vapid = require("./push/vapid");
const subscriptions = require("./push/subscriptions");
const payload = require("./push/payload");
const transports = require("./push/transports");
const notify = require("./push/notify");
const creation = require("./push/creation");
const externalDelivery = require("./push/external-delivery");
const inboxQuery = require("./push/inbox-query");
const inboxMutations = require("./push/inbox-mutations");

module.exports = {
  ...vapid,
  ...subscriptions,
  ...payload,
  dispatchNotification: transports.dispatchNotification,
  ...notify,
  ...creation,
  ...externalDelivery,
  ...inboxQuery,
  ...inboxMutations,
  NOTIFICATION_TYPES: notificationCatalog.NOTIFICATION_TYPES,
  CONTEXTUAL_NOTIFICATION_TYPES: notificationCatalog.CONTEXTUAL_NOTIFICATION_TYPES,
  NOTIFICATION_STATUSES: notificationCatalog.NOTIFICATION_STATUSES,
  renderNotification: notificationCatalog.renderNotification,
  renderAllLocales: notificationCatalog.renderAllLocales
};
