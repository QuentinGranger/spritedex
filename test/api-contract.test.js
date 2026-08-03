"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const document = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8"));

assert.strictEqual(document.openapi, "3.1.0");
assert.ok(document.info?.title);
assert.ok(document.components?.schemas?.Error);
assert.ok(document.components?.securitySchemes?.bearerAuth);
assert.ok(document.components?.securitySchemes?.cookieAuth);

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

for (const [route, operations] of Object.entries(document.paths)) {
  let hasHttpOp = false;
  for (const [method, operation] of Object.entries(operations)) {
    if (!HTTP_METHODS.has(method)) continue;
    hasHttpOp = true;
    assert.ok(operation.summary, `Missing summary for ${method.toUpperCase()} ${route}`);
    assert.ok(
      operation.responses && Object.keys(operation.responses).length,
      `Missing responses for ${method.toUpperCase()} ${route}`
    );
  }
  assert.ok(hasHttpOp, `OpenAPI path has no HTTP operations: ${route}`);
}

assert.ok(Object.keys(document.paths).length >= 200, "OpenAPI should document the full public HTTP surface");

function toOpenApiPath(expressPath) {
  return String(expressPath).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function walk(stack, out = []) {
  for (const layer of stack || []) {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods).filter((m) => m !== "_all" && HTTP_METHODS.has(m));
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        for (const method of methods) out.push({ method, path: routePath });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      walk(layer.handle.stack, out);
    }
  }
  return out;
}

// Compose the same route modules as production (without listening).
process.env.APP_URL ||= "http://127.0.0.1:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.EMAIL_VERIFICATION_REQUIRED ||= "0";
require("../src/shared/config/register-path-alias").installSourceAlias();
const { app } = require("../server/core");
for (const mod of [
  "../server/ws",
  "../server/compare",
  "../server/catalog",
  "../server/routes-sprites",
  "../server/routes-auth",
  "../server/routes-push",
  "../server/routes-profile",
  "../server/routes-passport",
  "../server/routes-friends",
  "../server/routes-collection",
  "../server/routes-squad",
  "../server/routes-squad-invitations",
  "../server/routes-squad-wishlist",
  "../server/routes-goals",
  "../server/routes-admin",
  "../server/routes-admin-operations",
  "../server/routes-sprite-graph",
  "../server/routes-sprite-graph-admin",
  "../server/notification-events",
  "../server/recommendations",
  "../server/news",
  "../server/routes-health"
]) {
  require(mod);
}

const registered = walk(app.router.stack).filter((op) => op.path.startsWith("/api") || op.path.startsWith("/health"));

const missingInOpenApi = [];
const openApiOps = new Set();
for (const [route, operations] of Object.entries(document.paths)) {
  for (const method of Object.keys(operations)) {
    if (HTTP_METHODS.has(method)) openApiOps.add(`${method.toUpperCase()} ${route}`);
  }
}

for (const { method, path: expressPath } of registered) {
  const openApiPath = toOpenApiPath(expressPath);
  const key = `${method.toUpperCase()} ${openApiPath}`;
  if (!openApiOps.has(key)) missingInOpenApi.push(key);
}

assert.deepStrictEqual(
  missingInOpenApi.sort(),
  [],
  `OpenAPI missing Express routes (${missingInOpenApi.length}):\n${missingInOpenApi.slice(0, 40).join("\n")}`
);

const registeredKeys = new Set(
  registered.map(({ method, path: expressPath }) => `${method.toUpperCase()} ${toOpenApiPath(expressPath)}`)
);
const undocumentedExtras = [...openApiOps].filter((key) => !registeredKeys.has(key)).sort();
assert.deepStrictEqual(
  undocumentedExtras,
  [],
  `OpenAPI documents routes not registered by Express (${undocumentedExtras.length}):\n${undocumentedExtras.slice(0, 40).join("\n")}`
);

console.log(
  `OpenAPI contract: ${Object.keys(document.paths).length} paths, ${openApiOps.size} operations (Express synced)`
);
