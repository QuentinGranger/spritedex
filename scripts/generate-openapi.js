#!/usr/bin/env node
"use strict";

/**
 * Rebuild openapi.json from the live Express route table.
 * Hand-authored operation details (summaries, schemas) are preserved when
 * method+path still match; new routes get documented stubs with tags/auth.
 *
 * Usage: node scripts/generate-openapi.js
 */

require("dotenv").config({ quiet: true });
process.env.APP_URL ||= "http://127.0.0.1:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.EMAIL_VERIFICATION_REQUIRED ||= "0";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OPENAPI_PATH = path.join(ROOT, "openapi.json");

require("../src/shared/config/register-path-alias").installSourceAlias();
const { app } = require("../server/core");

const ROUTE_MODULES = [
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
];

for (const mod of ROUTE_MODULES) {
  require(mod);
}

function walk(stack, out = []) {
  for (const layer of stack || []) {
    if (layer.route?.path) {
      const methods = Object.keys(layer.route.methods).filter((m) => m !== "_all");
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const routePath of paths) {
        for (const method of methods) out.push({ method: method.toLowerCase(), path: routePath });
      }
    } else if (layer.name === "router" && layer.handle?.stack) {
      walk(layer.handle.stack, out);
    }
  }
  return out;
}

function toOpenApiPath(expressPath) {
  return String(expressPath).replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
}

function pathParams(openApiPath) {
  const names = [...openApiPath.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
  return names.map((name) => ({
    name,
    in: "path",
    required: true,
    schema: {
      type: /Id$|_id$|Id\b/.test(name) || name === "id" ? "string" : "string"
    }
  }));
}

function tagFor(openApiPath) {
  if (openApiPath.startsWith("/health")) return "Health";
  if (openApiPath.startsWith("/api/auth")) return "Auth";
  if (openApiPath.startsWith("/api/admin")) return "Admin";
  if (openApiPath.startsWith("/api/squad")) return "Squads";
  if (openApiPath.startsWith("/api/friends") || openApiPath.startsWith("/api/users")) return "Friends";
  if (
    openApiPath.startsWith("/api/passport") ||
    openApiPath.startsWith("/api/badges") ||
    openApiPath.startsWith("/api/u/")
  ) {
    return "Passport";
  }
  if (openApiPath.startsWith("/api/notifications") || openApiPath.startsWith("/api/push")) return "Notifications";
  if (
    openApiPath.startsWith("/api/compare") ||
    openApiPath.startsWith("/api/comparisons") ||
    openApiPath.startsWith("/api/analytics")
  ) {
    return "Compare";
  }
  if (openApiPath.startsWith("/api/sprite-graph")) return "SpriteGraph";
  if (
    openApiPath.startsWith("/api/collection") ||
    openApiPath.startsWith("/api/history") ||
    openApiPath.startsWith("/api/collection-goals")
  ) {
    return "Collection";
  }
  if (
    openApiPath.startsWith("/api/profile") ||
    openApiPath.startsWith("/api/consent") ||
    openApiPath.startsWith("/api/export")
  ) {
    return "Profile";
  }
  if (
    openApiPath.startsWith("/api/sprites") ||
    openApiPath.startsWith("/api/catalog") ||
    openApiPath.startsWith("/api/events") ||
    openApiPath.startsWith("/api/news") ||
    openApiPath.startsWith("/api/community")
  ) {
    return "Catalog";
  }
  if (openApiPath === "/api/openapi.json") return "Meta";
  return "API";
}

function summaryFor(method, openApiPath) {
  const leaf = openApiPath.split("/").filter(Boolean).slice(-2).join("/");
  const verb =
    {
      get: "Lit",
      post: "Crée / exécute",
      put: "Remplace",
      patch: "Met à jour",
      delete: "Supprime"
    }[method] || method.toUpperCase();
  return `${verb} ${leaf}`;
}

function defaultSecurity(openApiPath, method) {
  if (openApiPath.startsWith("/health")) return undefined;
  if (openApiPath === "/api/openapi.json") return undefined;
  if (openApiPath === "/api/sprites" && method === "get") return undefined;
  if (openApiPath === "/api/push/vapid-key" && method === "get") return undefined;
  if (openApiPath.startsWith("/api/auth/")) {
    const publicAuth = [
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/forgot-password",
      "/api/auth/reset-password",
      "/api/auth/csrf",
      "/api/auth/verify-email",
      "/api/auth/oauth/exchange"
    ];
    if (
      publicAuth.includes(openApiPath) ||
      openApiPath.startsWith("/api/auth/oauth/") ||
      openApiPath.startsWith("/api/auth/callback/")
    ) {
      return undefined;
    }
  }
  if (openApiPath.startsWith("/api/u/") && method === "get") return undefined;
  if (openApiPath.startsWith("/api/admin")) {
    return [{ adminCookieAuth: [] }];
  }
  return [{ bearerAuth: [] }, { cookieAuth: [] }];
}

function stubOperation(method, openApiPath) {
  const op = {
    tags: [tagFor(openApiPath)],
    summary: summaryFor(method, openApiPath),
    responses: {
      200: { description: "Succès" },
      400: {
        description: "Requête invalide",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      401: {
        description: "Authentification requise",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      403: {
        description: "Accès refusé",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    }
  };
  const params = pathParams(openApiPath);
  if (params.length) op.parameters = params;
  if (["post", "put", "patch"].includes(method)) {
    op.requestBody = {
      required: false,
      content: {
        "application/json": {
          schema: { type: "object", additionalProperties: true }
        }
      }
    };
  }
  const security = defaultSecurity(openApiPath, method);
  if (security) op.security = security;
  return op;
}

const existing = JSON.parse(fs.readFileSync(OPENAPI_PATH, "utf8"));
const registered = walk(app.router.stack).filter((op) => op.path.startsWith("/api") || op.path.startsWith("/health"));

const byOpenApiPath = new Map();
for (const { method, path: expressPath } of registered) {
  const openApiPath = toOpenApiPath(expressPath);
  if (!byOpenApiPath.has(openApiPath)) byOpenApiPath.set(openApiPath, new Map());
  byOpenApiPath.get(openApiPath).set(method, expressPath);
}

const paths = {};
for (const [openApiPath, methods] of [...byOpenApiPath.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const existingPath = existing.paths?.[openApiPath] || {};
  paths[openApiPath] = {};
  for (const method of [...methods.keys()].sort()) {
    const previous = existingPath[method];
    if (previous && previous.summary && previous.responses) {
      paths[openApiPath][method] = {
        ...stubOperation(method, openApiPath),
        ...previous,
        tags: previous.tags || [tagFor(openApiPath)]
      };
    } else {
      paths[openApiPath][method] = stubOperation(method, openApiPath);
    }
  }
}

const document = {
  openapi: "3.1.0",
  info: {
    title: "SPRITE-INDEX API",
    version: existing.info?.version || "1.0.1",
    description:
      "Contrat HTTP versionné de l’API SPRITE-INDEX (auth joueur, collection, social, passeport, notifications, Sprite Graph, admin)."
  },
  servers: existing.servers || [
    { url: "https://spritedex.onrender.com", description: "Production" },
    { url: "http://127.0.0.1:3000", description: "Local" }
  ],
  tags: [
    { name: "Health", description: "Disponibilité" },
    { name: "Meta", description: "Contrat et métadonnées" },
    { name: "Auth", description: "Comptes et sessions" },
    { name: "Catalog", description: "Catalogue de sprites" },
    { name: "Collection", description: "Collection et objectifs" },
    { name: "Friends", description: "Amis et recherche" },
    { name: "Squads", description: "Escouades" },
    { name: "Passport", description: "Passeport collectionneur" },
    { name: "Profile", description: "Profil et consentement" },
    { name: "Compare", description: "Comparaisons" },
    { name: "Notifications", description: "Notifications et push" },
    { name: "SpriteGraph", description: "Sprite Graph" },
    { name: "Admin", description: "Backoffice opérateurs" },
    { name: "API", description: "Autres endpoints" }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "session token",
        description: "Session opaque (Capacitor / Electron / tests)."
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "sprite_index_session",
        description: "Session HttpOnly web (CSRF requis sur les mutations)."
      },
      adminCookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "sprite_index_admin_session",
        description: "Session opérateur backoffice."
      }
    },
    schemas: {
      ...(existing.components?.schemas || {}),
      Error: existing.components?.schemas?.Error || {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } }
      }
    }
  },
  paths
};

fs.writeFileSync(OPENAPI_PATH, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `openapi.json regenerated: ${Object.keys(paths).length} paths, ${registered.length} operations (from ${registered.length} Express registrations)`
);
