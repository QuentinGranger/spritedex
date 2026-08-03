// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Sprite Graph (Étapes 1–101)
// Append-only graph_events + corrections + sources + versions
// Needs live server for API cases: npm start, then npm run test:sprite-graph
// ─────────────────────────────────────────────────────────────────
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../../server/db");
const {
  GRAPH_EVENT_TYPES,
  GRAPH_EVENT_TYPE_SET,
  GRAPH_INTERACTION_EVENT_TYPES,
  GRAPH_INTERACTION_EVENT_TYPE_SET,
  GRAPH_SOURCES,
  GRAPH_EVENT_VERSIONS,
  GRAPH_EVENT_COMMON_FIELDS,
  GRAPH_EVENT_SPECIFIC_FIELDS,
  ensureGraphEventsTable,
  recordGraphEvent,
  recordCollectionGraphEvents,
  correctGraphEvent,
  isGraphEventCancelled,
  normalizeGraphSource,
  buildGraphEventEnvelope,
  buildDeduplicationKey,
  normalizeComparisonPair,
  normalizeInvitationMethod,
  buildFriendInvitationSentContext,
  getFriendInvitationPublicMetrics,
  isFriendInvitationPubliclyExposable,
  FRIEND_INVITATION_METHODS,
  FRIEND_INVITATION_PUBLIC_METRIC_KEYS,
  computeSquadJoinImpact,
  buildSquadJoinedContext,
  buildGoalCompletedContext,
  buildNotificationOpenedContext,
  resolveGoalScope,
  GOAL_SCOPES,
  GRAPH_DATA_LEVELS,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  sanitizeGraphContext,
  applyPublicAnonymizationGate,
  buildComparisonCompletedContext,
  extractTopDifferenceSpriteIds,
  FUTURE_GRAPH_EVENT_TYPES,
  getPriorityInterestMetrics
} = require("../../server/sprite-graph");
const {
  processGraphEventOutbox,
  getGraphAggregate,
  stopGraphOutboxWorker
} = require("../../server/sprite-graph-outbox");
const {
  ensureCommunityStatsTables,
  calculateCommunityVariantStats,
  getCommunityVariantOwnership,
  getMostSoughtVariants,
  formatCommunityOwnershipDisplay,
  formatCommunityPriorityDisplay,
  formatSampleSizeDisplay,
  formatRecentPriorityAddsDisplay,
  roundRate,
  listEligibleCommunityUserIds,
  OWNERSHIP_SAMPLE_STATUSES,
  stopCommunityStatsDailyJob
} = require("../../server/sprite-graph-community");
const { recordParticipantComparisonSession } = require("../../server/comparison-sessions");

const BASE = process.env.BASE_URL || process.env.APP_URL || "http://localhost:3000";
const API = `${BASE.replace(/\/$/, "")}/api`;

function rnd() {
  return Math.random().toString(36).slice(2, 8);
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function register(username) {
  const email = `${username}_${rnd()}@example.com`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
      username,
      ageConfirmed: true,
      cguAccepted: true
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, username };
}

const root = path.join(__dirname, "../..");

module.exports = {
  API,
  BASE,
  FRIEND_INVITATION_METHODS,
  FRIEND_INVITATION_PUBLIC_METRIC_KEYS,
  FUTURE_GRAPH_EVENT_TYPES,
  GOAL_SCOPES,
  GRAPH_DATA_LEVELS,
  GRAPH_EVENT_COMMON_FIELDS,
  GRAPH_EVENT_SPECIFIC_FIELDS,
  GRAPH_EVENT_TYPES,
  GRAPH_EVENT_TYPE_SET,
  GRAPH_EVENT_VERSIONS,
  GRAPH_INTERACTION_EVENT_TYPES,
  GRAPH_INTERACTION_EVENT_TYPE_SET,
  GRAPH_SOURCES,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  OWNERSHIP_SAMPLE_STATUSES,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  applyPublicAnonymizationGate,
  assert,
  auth,
  buildComparisonCompletedContext,
  buildDeduplicationKey,
  buildFriendInvitationSentContext,
  buildGoalCompletedContext,
  buildGraphEventEnvelope,
  buildNotificationOpenedContext,
  buildSquadJoinedContext,
  calculateCommunityVariantStats,
  computeSquadJoinImpact,
  correctGraphEvent,
  ensureCommunityStatsTables,
  ensureGraphEventsTable,
  extractTopDifferenceSpriteIds,
  formatCommunityOwnershipDisplay,
  formatCommunityPriorityDisplay,
  formatRecentPriorityAddsDisplay,
  formatSampleSizeDisplay,
  fs,
  getCommunityVariantOwnership,
  getFriendInvitationPublicMetrics,
  getGraphAggregate,
  getMostSoughtVariants,
  getPriorityInterestMetrics,
  isFriendInvitationPubliclyExposable,
  isGraphEventCancelled,
  listEligibleCommunityUserIds,
  normalizeComparisonPair,
  normalizeGraphSource,
  normalizeInvitationMethod,
  path,
  pool,
  processGraphEventOutbox,
  recordCollectionGraphEvents,
  recordGraphEvent,
  recordParticipantComparisonSession,
  register,
  resolveGoalScope,
  rnd,
  root,
  roundRate,
  sanitizeGraphContext,
  stopCommunityStatsDailyJob,
  stopGraphOutboxWorker
};
