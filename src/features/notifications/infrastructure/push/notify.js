"use strict";

const { getEnabledTokensForUser, getNewsSubscriberTokens, getSquadMemberTokens } = require("./subscriptions");
const { buildNotificationPayload } = require("./payload");
const { dispatchNotification, handleDispatchResult } = require("./transports");

async function notifyUser(pool, userId, message) {
  const targets = await getEnabledTokensForUser(pool, userId);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const target of targets) {
    let result;
    try {
      result = await dispatchNotification({ pool, target, payload });
    } catch (err) {
      result = { ok: false, error: err.message, endpoint: target.endpoint };
    }
    result = await handleDispatchResult(pool, { ...target, user_id: userId }, result);
    results.push({
      platform: target.platform,
      ok: result.ok,
      error: result.error,
      permanent: !!result.permanent,
      messageId: result.messageId || null
    });
  }
  return results;
}

// Alias used by friend/squad routes for per-user notifications.
async function sendNotificationToUser(pool, userId, message) {
  return notifyUser(pool, userId, message);
}

async function notifySquadMembers(pool, squadId, senderUserId, message) {
  const targets = await getSquadMemberTokens(pool, squadId, senderUserId);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const target of targets) {
    let result;
    try {
      result = await dispatchNotification({ pool, target, payload });
    } catch (err) {
      result = { ok: false, error: err.message, endpoint: target.endpoint };
    }
    result = await handleDispatchResult(pool, target, result);
    results.push({ platform: target.platform, ok: result.ok, error: result.error, permanent: !!result.permanent });
  }
  return results;
}

async function notifyNewsSubscribers(pool, message) {
  const targets = await getNewsSubscriberTokens(pool);
  const payload = buildNotificationPayload(message);
  const results = [];
  for (const target of targets) {
    let result;
    try {
      result = await dispatchNotification({ pool, target, payload });
    } catch (err) {
      result = { ok: false, error: err.message, endpoint: target.endpoint };
    }
    result = await handleDispatchResult(pool, target, result);
    results.push({ platform: target.platform, ok: result.ok, error: result.error, permanent: !!result.permanent });
  }
  return results;
}

/** Localize news push chrome per recipient preferred_language. */
async function notifyNewsSubscribersLocalized(pool, { render, icon, url } = {}) {
  if (typeof render !== "function") {
    return notifyNewsSubscribers(pool, { title: "SPRITE-INDEX", body: "", icon, url });
  }
  const targets = await getNewsSubscriberTokens(pool);
  // Attach preferred_language
  const userIds = [...new Set(targets.map((t) => t.user_id).filter(Boolean))];
  const langByUser = new Map();
  if (userIds.length) {
    const { resolveNotificationLanguage } = require("../../../../../server/i18n");
    const langRes = await pool.query(`SELECT id, preferred_language FROM users WHERE id = ANY($1::integer[])`, [
      userIds
    ]);
    for (const row of langRes.rows) {
      langByUser.set(Number(row.id), resolveNotificationLanguage(row.preferred_language, null));
    }
  }
  const results = [];
  for (const target of targets) {
    const lang = langByUser.get(Number(target.user_id)) || "fr";
    const message = render(lang) || {};
    const payload = buildNotificationPayload({
      title: message.title,
      body: message.body,
      icon: message.icon || icon,
      url: message.url || url
    });
    let result;
    try {
      result = await dispatchNotification({ pool, target, payload });
    } catch (err) {
      result = { ok: false, error: err.message, endpoint: target.endpoint };
    }
    result = await handleDispatchResult(pool, target, result);
    results.push({ platform: target.platform, ok: result.ok, error: result.error, permanent: !!result.permanent });
  }
  return results;
}

module.exports = {
  notifyUser,
  sendNotificationToUser,
  notifySquadMembers,
  notifyNewsSubscribers,
  notifyNewsSubscribersLocalized
};
