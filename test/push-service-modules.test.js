"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const moduleDir = path.join(root, "src", "features", "notifications", "infrastructure", "push");
const modules = [
  "vapid.js",
  "subscriptions.js",
  "payload.js",
  "transports.js",
  "notify.js",
  "creation.js",
  "external-delivery.js",
  "inbox-query.js",
  "inbox-mutations.js"
];

for (const file of modules) {
  const source = fs.readFileSync(path.join(moduleDir, file), "utf8");
  assert.ok(source.split("\n").length <= 500, `push-service/${file} exceeds the 500-line module limit`);
}

const facade = fs.readFileSync(path.join(root, "push-service.js"), "utf8");
assert.ok(facade.split("\n").length <= 75, "push-service.js must remain a lightweight compatibility facade");
assert.match(facade, /@\/features\/notifications\/infrastructure\/push-service/);

const service = require("../push-service");
for (const name of [
  "getVapidPublicKey", "ensurePushTables", "registerToken", "unregisterToken",
  "getEnabledTokensForUser", "buildNotificationPayload", "dispatchNotification",
  "notifyUser", "createNotification", "deliverExternalChannels", "getNotifications",
  "markNotificationRead", "deleteNotification"
]) {
  assert.strictEqual(typeof service[name], "function", `${name} must remain public`);
}

console.log("push-service modules: ok");
