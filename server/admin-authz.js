"use strict";

// Least-privilege AuthZ for the terminal backoffice.
// Roles are assigned at session open (env), stored on the durable session,
// and enforced server-side. The UI only mirrors capabilities for UX.

const ADMIN_ROLES = Object.freeze(["owner", "ops", "moderator", "editor", "privacy", "readonly"]);

const ALL_CAPABILITIES = Object.freeze([
  "overview.read",
  "players.read",
  "players.moderate",
  "catalog.read",
  "catalog.write",
  "events.read",
  "events.write",
  "collections.read",
  "collections.write",
  "social.read",
  "social.write",
  "notifications.read",
  "notifications.write",
  "intelligence.read",
  "intelligence.write",
  "passports.read",
  "passports.write",
  "privacy.read",
  "privacy.export",
  "privacy.purge",
  "privacy.restore",
  "privacy.revoke_links",
  "sessions.manage",
  "admins.manage",
  "audit.read"
]);

const ROLE_CAPABILITIES = Object.freeze({
  owner: [...ALL_CAPABILITIES],
  ops: ALL_CAPABILITIES.filter((cap) => !["privacy.purge", "privacy.restore"].includes(cap)),
  moderator: [
    "overview.read",
    "players.read",
    "players.moderate",
    "social.read",
    "social.write",
    "audit.read",
    "sessions.manage"
  ],
  editor: [
    "overview.read",
    "catalog.read",
    "catalog.write",
    "events.read",
    "events.write",
    "collections.read",
    "collections.write",
    "notifications.read",
    "audit.read"
  ],
  privacy: [
    "overview.read",
    "players.read",
    "privacy.read",
    "privacy.export",
    "privacy.purge",
    "privacy.restore",
    "privacy.revoke_links",
    "sessions.manage",
    "audit.read"
  ],
  readonly: ALL_CAPABILITIES.filter((cap) => cap.endsWith(".read") || cap === "audit.read")
});

const TAB_CAPABILITY = Object.freeze({
  overview: "overview.read",
  players: "players.read",
  catalog: "catalog.read",
  events: "events.read",
  collections: "collections.read",
  social: "social.read",
  notifications: "notifications.read",
  intelligence: "intelligence.read",
  passports: "passports.read",
  privacy: "privacy.read"
});

function normalizeRole(raw) {
  const role = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "");
  return ADMIN_ROLES.includes(role) ? role : null;
}

function parseOperatorRoleMap(raw = process.env.ADMIN_OPERATOR_ROLES || "") {
  const map = new Map();
  String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [labelRaw, roleRaw] = part.split(":");
      const label = String(labelRaw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const role = normalizeRole(roleRaw);
      if (label && role) map.set(label, role);
    });
  return map;
}

function resolveOperatorRole(operatorLabel = process.env.ADMIN_OPERATOR_LABEL || "terminal") {
  const label =
    String(operatorLabel || "terminal")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "terminal";
  const mapped = parseOperatorRoleMap().get(label);
  if (mapped) return mapped;
  const fallback = normalizeRole(process.env.ADMIN_OPERATOR_ROLE || "owner");
  return fallback || "owner";
}

function listCapabilitiesForRole(role) {
  const normalized = normalizeRole(role) || "readonly";
  return [...(ROLE_CAPABILITIES[normalized] || ROLE_CAPABILITIES.readonly)];
}

function hasCapability(roleOrSession, capability) {
  const role = typeof roleOrSession === "string" ? roleOrSession : roleOrSession?.role || "readonly";
  const needed = String(capability || "").trim();
  if (!needed) return false;
  return listCapabilitiesForRole(role).includes(needed);
}

function hasAllCapabilities(roleOrSession, capabilities = []) {
  const list = Array.isArray(capabilities) ? capabilities : [capabilities];
  return list.every((capability) => hasCapability(roleOrSession, capability));
}

function describeAuthz(role = resolveOperatorRole()) {
  const normalized = normalizeRole(role) || "owner";
  const capabilities = listCapabilitiesForRole(normalized);
  return {
    mode: "terminal-rbac",
    role: normalized,
    capabilities,
    tabs: Object.fromEntries(
      Object.entries(TAB_CAPABILITY).map(([tab, capability]) => [tab, capabilities.includes(capability)])
    ),
    configuredRoles: ADMIN_ROLES.length,
    roles: ADMIN_ROLES
  };
}

module.exports = {
  ADMIN_ROLES,
  ALL_CAPABILITIES,
  ROLE_CAPABILITIES,
  TAB_CAPABILITY,
  normalizeRole,
  resolveOperatorRole,
  listCapabilitiesForRole,
  hasCapability,
  hasAllCapabilities,
  describeAuthz,
  parseOperatorRoleMap
};
