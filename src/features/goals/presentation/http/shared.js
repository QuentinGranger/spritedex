// routes-goals.js — collection goals (personal or collective).

const { canViewCollection, getRequestingUser, requireNotSuspended } = require("../../../../../server/auth");
const { app } = require("../../../../../server/core");
const { pool } = require("../../../../../server/db");
const compare = require("../../../../../server/compare");
const security = require("../../../../../security");
const { broadcastGoalUpdate } = require("../../../../../server/ws");
const analytics = require("../../../../../analytics");
const pushService = require("../../../../../push-service");
const { logSquadGoalCreated, logSquadGoalCompleted } = require("../../../../../server/squad-activity");
const { invalidateSquadAnalysisCache } = require("../../../../../server/squad-analysis-cache");

const MAX_RECOMMENDATION_VARIANTS = 100;
const MAX_RECOMMENDATION_ASSIGNEES = 10; // A squad has at most ten active members.
const MAX_RECOMMENDATION_DEADLINE_LENGTH = 64;
const MAX_RECOMMENDATION_GAIN = 10000;
const MAX_USER_ID = 2147483647;
const recommendationGoalLimiter = security.rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyPrefix: "recommendation-goal",
  message: "Trop de créations d'objectifs depuis des recommandations. Réessaie dans quelques minutes."
});

async function hasBlockedPair(userIds) {
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0 && id <= MAX_USER_ID))];
  if (ids.length < 2) return false;
  const result = await pool.query(
    `SELECT 1
     FROM user_blocks
     WHERE blocker_id = ANY($1::integer[])
       AND blocked_id = ANY($1::integer[])
     LIMIT 1`,
    [ids]
  );
  return result.rows.length > 0;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRecommendationText(value, { field, maxLength, fallback = null } = {}) {
  if (value === undefined || value === null || value === "") return { value: fallback };
  if (typeof value !== "string") return { error: `${field} invalide` };
  const normalized = value.trim();
  if (normalized.length > maxLength) return { error: `${field} trop long (${maxLength} max)` };
  return { value: normalized || fallback };
}

function normalizeRecommendationVariantIds(rawVariantIds) {
  if (!Array.isArray(rawVariantIds)) return { error: "Liste de variantes invalide" };
  if (rawVariantIds.length > MAX_RECOMMENDATION_VARIANTS) {
    return { error: `Trop de variantes (${MAX_RECOMMENDATION_VARIANTS} max)` };
  }

  const ids = [];
  const seen = new Set();
  for (const rawId of rawVariantIds) {
    if (typeof rawId !== "string" && typeof rawId !== "number") {
      return { error: "Identifiant de variante invalide" };
    }
    const variantId = String(rawId).trim();
    if (!variantId || variantId.length > 120) {
      return { error: "Identifiant de variante invalide" };
    }
    if (!seen.has(variantId)) {
      seen.add(variantId);
      ids.push(variantId);
    }
  }
  return { value: ids };
}

function normalizeRecommendationMemberIds(rawMemberIds) {
  if (!Array.isArray(rawMemberIds)) return { error: "Liste de membres assignés invalide" };
  if (rawMemberIds.length > MAX_RECOMMENDATION_ASSIGNEES) {
    return { error: `Trop de membres assignés (${MAX_RECOMMENDATION_ASSIGNEES} max)` };
  }

  const ids = [];
  const seen = new Set();
  for (const rawId of rawMemberIds) {
    if ((typeof rawId !== "string" && typeof rawId !== "number") || !/^\d+$/.test(String(rawId).trim())) {
      return { error: "Identifiant de membre invalide" };
    }
    const userId = Number(String(rawId).trim());
    if (!Number.isSafeInteger(userId) || userId < 1 || userId > MAX_USER_ID) {
      return { error: "Identifiant de membre invalide" };
    }
    if (!seen.has(userId)) {
      seen.add(userId);
      ids.push(userId);
    }
  }
  return { value: ids };
}

function normalizeRecommendationNumber(value, { field, min, max, fallback = null, integer = false } = {}) {
  if (value === undefined || value === null || value === "") return { value: fallback };
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  ) {
    return { error: `${field} invalide` };
  }
  return { value };
}

function normalizeRecommendationDeadline(value) {
  const text = normalizeRecommendationText(value, {
    field: "Date limite",
    maxLength: MAX_RECOMMENDATION_DEADLINE_LENGTH
  });
  if (text.error || !text.value) return text;
  const timestamp = Date.parse(text.value);
  if (!Number.isFinite(timestamp)) return { error: "Date limite invalide" };
  return { value: new Date(timestamp).toISOString() };
}

function getRawAssignedMemberIds(recommendation, overrides) {
  if (
    overrides &&
    Object.prototype.hasOwnProperty.call(overrides, "assignedMemberIds") &&
    overrides.assignedMemberIds !== null
  ) {
    return normalizeRecommendationMemberIds(overrides.assignedMemberIds);
  }

  if (recommendation.participants === undefined || recommendation.participants === null) {
    return { value: [] };
  }
  if (!Array.isArray(recommendation.participants)) {
    return { error: "Liste de participants invalide" };
  }
  if (recommendation.participants.length > MAX_RECOMMENDATION_ASSIGNEES) {
    return { error: `Trop de participants (${MAX_RECOMMENDATION_ASSIGNEES} max)` };
  }
  const participantIds = [];
  for (const participant of recommendation.participants) {
    if (!isPlainObject(participant)) return { error: "Participant invalide" };
    participantIds.push(participant.userId);
  }
  return normalizeRecommendationMemberIds(participantIds);
}

function goalCreationError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

// Every path that creates a squad goal must use this transaction.  The active
// goal quota is per member, so lock that member's row in the squad (and the
// squad settings row) before counting.  Without the lock, parallel requests
// could all observe the same count and exceed max_active_goals_per_member.
async function insertCollectionGoalWithCapacity({
  userId,
  squadId = null,
  title,
  description,
  variantId,
  targetVariantIds
}) {
  let client;
  let committed = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    if (squadId) {
      const membership = await client.query(
        `SELECT s.max_active_goals_per_member
         FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE sm.squad_id = $1 AND sm.user_id = $2 AND sm.status = 'active'
         FOR UPDATE OF sm, s`,
        [squadId, userId]
      );
      if (!membership.rows.length) {
        throw goalCreationError(403, "Vous n'êtes pas membre actif de cette escouade");
      }

      const maxActiveGoals = membership.rows[0].max_active_goals_per_member ?? 3;
      const activeGoalsResult = await client.query(
        "SELECT COUNT(*) AS cnt FROM collection_goals WHERE user_id = $1 AND squad_id = $2 AND status = 'active'",
        [userId, squadId]
      );
      const activeGoalCount = parseInt(activeGoalsResult.rows[0].cnt, 10);
      if (activeGoalCount >= maxActiveGoals) {
        throw goalCreationError(429, "Limite d'objectifs actifs atteinte", {
          maxActiveGoals,
          activeGoalCount
        });
      }
    }

    const result = await client.query(
      `INSERT INTO collection_goals (user_id, squad_id, title, description, variant_id, target_variant_ids, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id, created_at`,
      [userId, squadId, title, description, variantId, targetVariantIds]
    );
    await client.query("COMMIT");
    committed = true;
    return result.rows[0];
  } catch (err) {
    if (client && !committed) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client?.release();
  }
}

module.exports = {
  app,
  pool,
  compare,
  canViewCollection,
  getRequestingUser,
  requireNotSuspended,
  recommendationGoalLimiter,
  broadcastGoalUpdate,
  analytics,
  pushService,
  logSquadGoalCreated,
  logSquadGoalCompleted,
  invalidateSquadAnalysisCache,
  MAX_RECOMMENDATION_ASSIGNEES,
  MAX_RECOMMENDATION_GAIN,
  MAX_USER_ID,
  hasBlockedPair,
  isPlainObject,
  normalizeRecommendationText,
  normalizeRecommendationVariantIds,
  normalizeRecommendationNumber,
  normalizeRecommendationDeadline,
  getRawAssignedMemberIds,
  insertCollectionGoalWithCapacity
};
