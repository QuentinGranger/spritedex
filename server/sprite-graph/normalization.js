"use strict";

const crypto = require("crypto");
const { GRAPH_SOURCE_SET, GRAPH_EVENT_VERSIONS, sanitizeGraphContext } = require("./constants");

function isActivePriority(value) {
  const p = String(value || "none").toLowerCase();
  if (!p || p === "none" || p === "ignored") return false;
  return true;
}

function normalizeIntId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function normalizeContext(context) {
  // Étape 33 — strip PII / sensitive profile content before any persistence.
  return sanitizeGraphContext(context);
}

/**
 * Étape 9 — map free-form origins to canonical sources.
 * Detailed origin (e.g. collection.setEntry) is preserved in context.origin.
 */
function normalizeGraphSource(source, { defaultSource = "api" } = {}) {
  const raw = String(source == null ? "" : source)
    .trim()
    .toLowerCase();
  if (GRAPH_SOURCE_SET.has(raw)) return raw;
  if (!raw) return GRAPH_SOURCE_SET.has(defaultSource) ? defaultSource : "system";
  if (raw.includes("import")) return "import";
  if (raw.includes("migration")) return "migration";
  if (raw.includes("admin")) return "admin";
  if (raw === "ios" || raw.startsWith("ios.")) return "ios";
  if (raw === "android" || raw.startsWith("android.")) return "android";
  if (raw === "web" || raw.startsWith("web.")) return "web";
  if (raw.includes("system") || raw.includes("scheduler") || raw.includes("cron")) return "system";
  return GRAPH_SOURCE_SET.has(defaultSource) ? defaultSource : "api";
}

function resolveEventVersion(eventType, explicit) {
  if (Number.isFinite(Number(explicit))) {
    return Math.max(1, Math.floor(Number(explicit)));
  }
  return GRAPH_EVENT_VERSIONS[eventType] || 1;
}

/**
 * Étape 8 — normalize input into the common event structure (+ specific ids).
 */
function buildGraphEventEnvelope(input = {}) {
  const eventType = String(input.eventType || input.event_type || "");
  const origin = input.origin || input.sourceOrigin || null;
  const rawSource = input.source || "api";
  const source = normalizeGraphSource(rawSource, {
    defaultSource: input.defaultSource || "api"
  });
  const context = normalizeContext(input.context);
  if (origin && !context.origin) context.origin = String(origin).slice(0, 120);
  else if (rawSource && !GRAPH_SOURCE_SET.has(String(rawSource).toLowerCase()) && !context.origin) {
    context.origin = String(rawSource).slice(0, 120);
  }

  return {
    id: input.id || crypto.randomUUID(),
    eventType,
    eventVersion: resolveEventVersion(eventType, input.eventVersion ?? input.event_version),
    occurredAt: input.occurredAt || input.occurred_at || new Date().toISOString(),
    recordedAt: input.recordedAt || input.recorded_at || null,
    actorUserId: normalizeIntId(input.actorUserId ?? input.actor_user_id),
    source,
    context,
    deduplicationKey: input.deduplicationKey || input.deduplication_key || null,
    targetUserId: normalizeIntId(input.targetUserId ?? input.target_user_id),
    spriteId: input.spriteId || input.sprite_id || null,
    variantId: input.variantId || input.variant_id || null,
    squadId: normalizeIntId(input.squadId ?? input.squad_id),
    comparisonId: input.comparisonId || input.comparison_id || null,
    friendshipId: input.friendshipId || input.friendship_id || null,
    goalId: input.goalId || input.goal_id || null,
    notificationId: (() => {
      const n = Number(input.notificationId ?? input.notification_id);
      return Number.isSafeInteger(n) && n > 0 ? n : null;
    })()
  };
}

/** Map a DB row → camelCase envelope (Étape 8). */
function rowToGraphEventEnvelope(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorUserId: row.actor_user_id,
    source: row.source,
    context: row.context || {},
    deduplicationKey: row.deduplication_key,
    targetUserId: row.target_user_id,
    spriteId: row.sprite_id,
    variantId: row.variant_id,
    squadId: row.squad_id,
    comparisonId: row.comparison_id,
    friendshipId: row.friendship_id,
    goalId: row.goal_id,
    notificationId: row.notification_id
  };
}

module.exports = {
  isActivePriority,
  normalizeIntId,
  normalizeContext,
  normalizeGraphSource,
  resolveEventVersion,
  buildGraphEventEnvelope,
  rowToGraphEventEnvelope
};
