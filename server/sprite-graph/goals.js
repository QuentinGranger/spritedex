"use strict";

const { GOAL_SCOPE_SET } = require("./constants");

/**
 * Étape 26 — personal | friends | squad.
 * Explicit goal.goalScope / goal.scope wins; else squad_id ⇒ squad, else personal.
 */
function resolveGoalScope(goal = null) {
  const explicit = String(
    (goal && (goal.goalScope || goal.goal_scope || goal.scope)) || ""
  ).trim().toLowerCase();
  if (GOAL_SCOPE_SET.has(explicit)) return explicit;
  if (goal && goal.squad_id) return "squad";
  return "personal";
}

/**
 * Étape 25–26 — goal.completed context.
 */
function buildGoalCompletedContext({
  goal = null,
  actorUserId = null,
  targetVariantIds = null,
  participantCount = null,
  completedAt = null,
  goalScope = null
} = {}) {
  const targetIds = Array.isArray(targetVariantIds) && targetVariantIds.length
    ? targetVariantIds.map(String)
    : (goal && Array.isArray(goal.target_variant_ids) && goal.target_variant_ids.length
      ? goal.target_variant_ids.map(String)
      : (goal && goal.variant_id ? [String(goal.variant_id)] : []));
  const createdAt = goal && goal.created_at ? new Date(goal.created_at) : null;
  const doneAt = completedAt ? new Date(completedAt) : new Date();
  let durationDays = null;
  if (createdAt && !Number.isNaN(createdAt.getTime()) && !Number.isNaN(doneAt.getTime())) {
    durationDays = Math.max(0, Math.round((doneAt - createdAt) / (24 * 60 * 60 * 1000)));
  }
  const scope = GOAL_SCOPE_SET.has(String(goalScope || "").toLowerCase())
    ? String(goalScope).toLowerCase()
    : resolveGoalScope(goal);
  const isSquad = scope === "squad";
  return {
    goalScope: scope,
    goalType: isSquad ? "event_completion"
      : (scope === "friends" ? "friends_completion" : "personal_completion"),
    participantCount: Number.isFinite(Number(participantCount))
      ? Number(participantCount)
      : (isSquad || scope === "friends" ? null : 1),
    targetVariantCount: targetIds.length,
    completedVariantCount: targetIds.length,
    durationDays,
    title: goal && goal.title ? String(goal.title).slice(0, 200) : null,
    shared: isSquad || scope === "friends",
    actorUserId: normalizeIntId(actorUserId)
  };
}

/**
 * Étape 27 — notification.opened context.
 * Étape 28 — this means the notification was consulted, not that a CTA ran.
 */
function buildNotificationOpenedContext(notification = {}, {
  channel = null,
  openedAt = null
} = {}) {
  const data = (notification && notification.data && typeof notification.data === "object")
    ? notification.data
    : {};
  const deliveredRaw = notification.delivered_at || notification.created_at || null;
  const opened = openedAt ? new Date(openedAt) : new Date();
  let delaySinceDeliverySeconds = null;
  if (deliveredRaw) {
    const delivered = new Date(deliveredRaw);
    if (!Number.isNaN(delivered.getTime()) && !Number.isNaN(opened.getTime())) {
      delaySinceDeliverySeconds = Math.max(0, Math.round((opened - delivered) / 1000));
    }
  }
  const channels = Array.isArray(data.channels) ? data.channels.map(String) : [];
  const resolvedChannel = channel
    || (channels.includes("push") ? "push"
      : (channels[0] || "in_app"));
  const destination = data.url || notification.url || data.destination || null;
  return {
    notificationType: notification.type ? String(notification.type) : null,
    category: notification.category ? String(notification.category) : null,
    channel: String(resolvedChannel).slice(0, 40),
    destination: destination ? String(destination).slice(0, 500) : null,
    delaySinceDeliverySeconds
  };
}

module.exports = { resolveGoalScope, buildGoalCompletedContext, buildNotificationOpenedContext };
