// routes-collection.js — extracted from server.js

const pushService = require("../../../../../push-service");
const security = require("../../../../../security");
const {
  areFriends,
  canViewCollection,
  getRequestingUser,
  getVisibility,
  requireNotSuspended,
  requireSameUser
} = require("../../../../../server/auth");
const { normalizeCollection, normalizeVariantId } = require("../../../../../server/catalog");
const { invalidateCompareCacheForUser } = require("../../../../../server/compare");
const { app } = require("../../../../../server/core");
const { pool } = require("../../../../../server/db");
const {
  broadcastCompareUpdate,
  broadcastFriendCollectionUpdate,
  broadcastSquadUpdate,
  broadcastSquadCompletionUpdate
} = require("../../../../../server/ws");
const { logSquadCollectionEvent } = require("../../../../../server/squad-activity");
const { refreshSquadStats, scheduleSquadStatsRefresh } = require("../../../../../server/routes-squad-invitations");
const { checkAffectedGoals } = require("../../../../../server/routes-goals");
const { invalidateSquadAnalysisCacheForUser } = require("../../../../../server/squad-analysis-cache");
const { emitDomainEvent, DOMAIN_EVENTS } = require("../../../../../server/event-bus");
const { isAcquiredFromStatus } = require("../../../../../server/notification-gates");
const acquisition = require("../../../../../server/notification-acquisition");

const MASTERY_MAX_LEVEL = 5;

function normalizeMasteryLevel(entry, status) {
  if (status !== "owned") return 0;
  const level = Number(entry?.masteryLevel);
  return Number.isInteger(level) && level >= 1 && level <= MASTERY_MAX_LEVEL ? level : 1;
}

module.exports = {
  app,
  pool,
  security,
  pushService,
  areFriends,
  canViewCollection,
  getRequestingUser,
  getVisibility,
  requireNotSuspended,
  requireSameUser,
  normalizeCollection,
  normalizeVariantId,
  normalizeMasteryLevel,
  invalidateCompareCacheForUser,
  invalidateSquadAnalysisCacheForUser,
  broadcastCompareUpdate,
  broadcastFriendCollectionUpdate,
  broadcastSquadUpdate,
  broadcastSquadCompletionUpdate,
  logSquadCollectionEvent,
  refreshSquadStats,
  scheduleSquadStatsRefresh,
  checkAffectedGoals,
  emitDomainEvent,
  DOMAIN_EVENTS,
  isAcquiredFromStatus,
  acquisition
};
