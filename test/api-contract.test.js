"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const document = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8"));

assert.strictEqual(document.openapi, "3.1.0");
assert.ok(document.info?.title);
assert.ok(document.components?.schemas?.Error);
for (const route of [
  "/health/live",
  "/health/ready",
  "/api/sprites",
  "/api/auth/register",
  "/api/auth/login",
  "/api/collection/{userId}",
  "/api/notifications",
  "/api/push/vapid-key"
]) {
  assert.ok(document.paths[route], `OpenAPI route missing: ${route}`);
}
for (const [route, operations] of Object.entries(document.paths)) {
  for (const [method, operation] of Object.entries(operations)) {
    assert.ok(["get", "post", "put", "patch", "delete"].includes(method), `Invalid method for ${route}`);
    assert.ok(operation.summary, `Missing summary for ${method.toUpperCase()} ${route}`);
    assert.ok(
      operation.responses && Object.keys(operation.responses).length,
      `Missing responses for ${method.toUpperCase()} ${route}`
    );
  }
}

// The published contract must describe routes that are actually composed by
// Express. No database query is made while modules register handlers.
process.env.APP_URL ||= "http://127.0.0.1:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
require("../src/shared/config/register-path-alias").installSourceAlias();
const { app } = require("../server/core");
require("../server/routes-health");
require("../server/routes-sprites");
require("../server/routes-auth");
require("../server/routes-collection");
require("../server/routes-push");
const registered = new Set(
  app.router.stack.flatMap((layer) => (layer.route ? Object.keys(layer.route.methods).map(() => layer.route.path) : []))
);
for (const route of [
  "/health/live",
  "/health/ready",
  "/api/sprites",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/collection/:userId",
  "/api/push/vapid-key"
]) {
  assert.ok(registered.has(route), `OpenAPI route is not registered by Express: ${route}`);
}
console.log(`OpenAPI contract: ${Object.keys(document.paths).length} routes`);
