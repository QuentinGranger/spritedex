"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const client = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "server", "routes-admin-operations.js"), "utf8");
const profileRoutes = fs.readFileSync(path.join(root, "server", "routes-profile.js"), "utf8");
const authRoutes = fs.readFileSync(path.join(root, "server", "routes-auth.js"), "utf8");
const schema = fs.readFileSync(path.join(root, "server", "schema.js"), "utf8");
const publicNews = fs.readFileSync(path.join(root, "server", "news.js"), "utf8");

for (const tab of ["overview", "players", "catalog", "events", "collections", "social", "notifications", "intelligence", "passports", "privacy"]) {
  assert.match(html, new RegExp(`data-admin-tab="${tab}"`), `missing ${tab} navigation item`);
  assert.match(html, new RegExp(`data-admin-panel="${tab}"`), `missing ${tab} panel`);
}

for (const endpoint of [
  "/api/admin/overview", "/api/admin/players", "/api/admin/catalog", "/api/admin/events",
  "/api/admin/collections/integrity", "/api/admin/social", "/api/admin/notifications/operations",
  "/api/admin/passports", "/api/admin/privacy", "/suspension-history"
]) {
  assert.ok(routes.includes(endpoint), `missing protected operational endpoint ${endpoint}`);
}

assert.match(routes, /requireAdminApi/, "operational endpoints must require the admin session");
assert.match(routes, /admin_audit_log/, "administrative mutations must be auditable");
assert.match(routes, /reason.*requis|justification.*requise/i, "sensitive actions require a justification");
assert.match(schema, /suspension_source[\s\S]*'self'[\s\S]*'admin'/, "schema must distinguish self-service and admin suspensions");
assert.match(routes, /suspension_source\s*=\s*CASE WHEN \$2 THEN 'admin'/, "admin suspensions must be marked as admin-owned");
assert.match(routes, /DELETE FROM sessions WHERE user_id = \$1/, "admin suspension must revoke active sessions");
assert.match(routes, /suspension-history/, "administrators must be able to review suspension history");
assert.match(routes, /INSERT INTO admin_audit_log[\s\S]*player\.suspended/, "suspension and audit history must be written together");
assert.match(
  profileRoutes,
  /suspension_source IS DISTINCT FROM 'admin' OR suspended_until <= NOW\(\)/,
  "self-service suspension routes must not override an active admin suspension"
);
assert.match(authRoutes, /adminSuspended[\s\S]*Compte suspendu par un administrateur/, "admin-suspended users must not receive new login sessions");
assert.match(html, /id="playerSuspensionDialog"/, "suspension actions must use an accessible dialog");
assert.doesNotMatch(client, /async function handlePlayerAction[\s\S]{0,500}window\.prompt/, "player suspension must not use prompt dialogs");
assert.match(client, /data-admin-tab/, "client must wire tab navigation");
assert.match(publicNews, /WHERE status = 'published'/, "draft news must remain outside the public feed");

console.log("admin backoffice surface: ok");
