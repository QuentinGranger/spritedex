"use strict";

// ── Sprite Graph — append-only event store (Étapes 1–35) ────────────────────
// Historical memory of sprite-index. PostgreSQL only; no graph DB in v1.
// Stable event type IDs must not change when UI copy changes.
// graph_events rows are never updated/deleted — corrections are new rows.
// Important events are emitted server-side after authorized, deduped writes
// (Étape 29); critical collection writes share a DB transaction (Étape 30).
// Outbox → simple worker → aggregates (Étapes 31–32). Privacy + levels (33–35).

const {
  GRAPH_DATA_LEVELS,
  GRAPH_DATA_LEVEL_SET,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  GRAPH_CONTEXT_PII_KEYS,
  sanitizeGraphContext,
  classifyGraphDataLevel,
  applyPublicAnonymizationGate
} = require("../sprite-graph-privacy");

const GRAPH_EVENT_TYPES = Object.freeze({
  COLLECTION_SPRITE_ADDED: "collection.sprite_added",
  COLLECTION_STATUS_CHANGED: "collection.status_changed",
  COLLECTION_PRIORITY_ADDED: "collection.priority_added",
  COMPARISON_COMPLETED: "comparison.completed",
  FRIEND_INVITATION_SENT: "friend_invitation.sent",
  SQUAD_JOINED: "squad.joined",
  GOAL_COMPLETED: "goal.completed",
  NOTIFICATION_OPENED: "notification.opened"
});

/**
 * Étape 28 — reserved for later (not emitted in v1).
 * Opened ≠ recommended action taken ≠ conversion.
 */
const FUTURE_GRAPH_EVENT_TYPES = Object.freeze({
  NOTIFICATION_ACTION_CLICKED: "notification.action_clicked",
  NOTIFICATION_CONVERTED: "notification.converted",
  // Étapes 46–47 — real attention signals (not emitted in v1).
  COMPARISON_SPRITE_VIEWED: "comparison.sprite_viewed",
  COMPARISON_FILTER_APPLIED: "comparison.filter_applied",
  COMPARISON_VARIANT_OPENED: "comparison.variant_opened",
  COMPARISON_SPRITE_OPENED: "comparison.sprite_opened"
});

const GRAPH_EVENT_TYPE_SET = new Set(Object.values(GRAPH_EVENT_TYPES));
// V1 keeps its eight business events stable. Interaction signals are an
// additive extension: they are useful for internal product analysis but do
// not alter completion, ownership or public community calculations.
const GRAPH_INTERACTION_EVENT_TYPES = Object.freeze({
  RECOMMENDATION_CLICKED: "recommendation.clicked",
  COMPARISON_FILTER_APPLIED: FUTURE_GRAPH_EVENT_TYPES.COMPARISON_FILTER_APPLIED,
  NOTIFICATION_ACTION_CLICKED: FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED,
  NOTIFICATION_CONVERTED: FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_CONVERTED
});
const GRAPH_INTERACTION_EVENT_TYPE_SET = new Set(Object.values(GRAPH_INTERACTION_EVENT_TYPES));
const GRAPH_RECORDABLE_EVENT_TYPE_SET = new Set([
  ...GRAPH_EVENT_TYPE_SET,
  ...GRAPH_INTERACTION_EVENT_TYPE_SET
]);

/** Étape 26 — goal scope for completion analytics. */
const GOAL_SCOPES = Object.freeze(["personal", "friends", "squad"]);
const GOAL_SCOPE_SET = new Set(GOAL_SCOPES);

/** Étape 9 — canonical interaction sources. */
const GRAPH_SOURCES = Object.freeze([
  "web",
  "ios",
  "android",
  "api",
  "import",
  "admin",
  "system",
  "migration"
]);

const GRAPH_SOURCE_SET = new Set(GRAPH_SOURCES);

/**
 * Étape 10 — current schema version per event type.
 * Bump when the meaning/shape of `context` (or required fields) changes.
 * Old rows keep their recorded event_version.
 */
const GRAPH_EVENT_VERSIONS = Object.freeze({
  [GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED]: 1,
  [GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED]: 1,
  [GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED]: 1,
  [GRAPH_EVENT_TYPES.COMPARISON_COMPLETED]: 2,
  [GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT]: 2,
  [GRAPH_EVENT_TYPES.SQUAD_JOINED]: 2,
  [GRAPH_EVENT_TYPES.GOAL_COMPLETED]: 3,
  [GRAPH_EVENT_TYPES.NOTIFICATION_OPENED]: 2,
  [GRAPH_INTERACTION_EVENT_TYPES.RECOMMENDATION_CLICKED]: 1,
  [GRAPH_INTERACTION_EVENT_TYPES.COMPARISON_FILTER_APPLIED]: 1,
  [GRAPH_INTERACTION_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED]: 1,
  [GRAPH_INTERACTION_EVENT_TYPES.NOTIFICATION_CONVERTED]: 1
});

/** Étape 21 — how a friend invitation was initiated. */
const FRIEND_INVITATION_METHODS = Object.freeze([
  "username",
  "invite_link",
  "qr_code",
  "squad_member",
  "passport"
]);

const FRIEND_INVITATION_METHOD_SET = new Set(FRIEND_INVITATION_METHODS);

/**
 * Étape 22 — public surfaces may only consume these aggregate keys.
 * Never expose actor/target, pending/declined, or individual social history.
 */
const FRIEND_INVITATION_PUBLIC_METRIC_KEYS = Object.freeze([
  "totalInvitationsSent",
  "invitationsByMethod",
  "acceptedCount",
  "acceptanceRate"
]);

/** Common envelope field names (Étape 8) — camelCase API / snake_case DB. */
const GRAPH_EVENT_COMMON_FIELDS = Object.freeze([
  "id",
  "eventType",
  "eventVersion",
  "occurredAt",
  "recordedAt",
  "actorUserId",
  "source",
  "context",
  "deduplicationKey"
]);

const GRAPH_EVENT_SPECIFIC_FIELDS = Object.freeze([
  "targetUserId",
  "spriteId",
  "variantId",
  "squadId",
  "comparisonId",
  "friendshipId",
  "goalId",
  "notificationId"
]);


module.exports = { GRAPH_EVENT_TYPES, FUTURE_GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_RECORDABLE_EVENT_TYPE_SET, GRAPH_SOURCES, GRAPH_SOURCE_SET, GRAPH_EVENT_VERSIONS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GOAL_SCOPES, GOAL_SCOPE_SET, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_METHOD_SET, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, GRAPH_DATA_LEVELS, GRAPH_DATA_LEVEL_SET, PUBLIC_ANONYMIZATION_MIN_USERS, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, GRAPH_CONTEXT_PII_KEYS, sanitizeGraphContext, classifyGraphDataLevel, applyPublicAnonymizationGate };
