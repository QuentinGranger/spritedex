// server/squad-activity.js — unified squad activity logger.
//
// All squad-facing events (collection updates, joins, friendships, goals,
// completion milestones) go through a single helper and are stored with a
// common schema: type + action + metadata JSONB context.

const { canViewCollection, getVisibility } = require("./auth");
const { pool } = require("./db");
const pushService = require("../push-service");
const notifI18n = require("./notification-i18n");
const { resolveNotificationLanguage } = require("./i18n");

const PUBLIC_SQUAD_PROFILE = new Set(["public", "squad", "squad_only"]);

function buildSquadPushPayload(lang, params = {}) {
  const locale = resolveNotificationLanguage(lang, null);
  const title = notifI18n.tNotif("notifications.squad_activity.title", {}, locale)
    || (locale === "en" ? "SPRITE-INDEX — Squad" : "SPRITE-INDEX — Escouade");
  const template = params.activityTemplate || "default";
  const bodyKey = `notifications.squad_activity.${template}.body`;
  const localized = {
    ...params,
    template,
    activityTemplate: template,
    actionLabel: locale === "en"
      ? (params.actionLabelEn || params.actionLabel)
      : (params.actionLabelFr || params.actionLabel),
    spriteName: locale === "en"
      ? (params.spriteNameEn || params.spriteName)
      : (params.spriteNameFr || params.spriteName),
    friendName: params.friendName
      || notifI18n.tNotif("notifications.fallback.player", {}, locale)
      || (locale === "en" ? "A player" : "Un joueur")
  };
  const interpolateParams = notifI18n.buildInterpolateParams("squad_activity", localized, locale);
  const body = notifI18n.tNotif(bodyKey, interpolateParams, locale) || "";
  return {
    title,
    body,
    icon: "/icons/icon-192x192.png",
    url: params.url || (params.squadId ? `/?squad=${params.squadId}` : "/")
  };
}

async function preferredLanguageForUser(userId) {
  const res = await pool.query(
    "SELECT preferred_language FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId]
  );
  return resolveNotificationLanguage(res.rows[0]?.preferred_language, null);
}

// `notifySquadMembers` is intentionally broad for non-collection activity.
// Collection activity, however, must only reach members that can currently
// view the actor's collection.  Sending selected recipients directly keeps the
// existing push preference gates while avoiding a broad squad notification.
async function notifySelectedSquadMembers(squadId, recipientIds, messageParams) {
  const ids = [...new Set((recipientIds || []).map(Number).filter(Number.isInteger))];
  if (!squadId || !ids.length || !messageParams) return;

  const recipients = await pool.query(
    `SELECT sm.user_id, u.preferred_language
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND sm.user_id = ANY($2::integer[])
       AND u.deleted_at IS NULL
       AND u.push_enabled = TRUE
       AND u.push_pref_squad_activity = TRUE`,
    [squadId, ids]
  );

  await Promise.all(recipients.rows.map(async ({ user_id: recipientId, preferred_language: preferredLanguage }) => {
    const payload = buildSquadPushPayload(preferredLanguage, {
      ...messageParams,
      squadId
    });
    return pushService.sendNotificationToUser(pool, recipientId, payload)
      .catch(err => console.error("[squad-activity] selected push failed:", err));
  }));
}

async function notifySquadMembersLocalized(squadId, excludeUserId, messageParams) {
  const result = await pool.query(
    `SELECT sm.user_id, u.preferred_language
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND sm.user_id <> $2
       AND u.deleted_at IS NULL
       AND u.push_enabled = TRUE
       AND u.push_pref_squad_activity = TRUE`,
    [squadId, excludeUserId || 0]
  );
  await Promise.all(result.rows.map(({ user_id: recipientId, preferred_language: preferredLanguage }) => {
    const payload = buildSquadPushPayload(preferredLanguage, {
      ...messageParams,
      squadId
    });
    return pushService.sendNotificationToUser(pool, recipientId, payload)
      .catch(err => console.error("[squad-activity] push failed:", err));
  }));
}

async function logSquadEvent({
  squadId,
  userId,
  type,
  action,
  spriteId,
  metadata = {},
  messageParams = null,
  url,
  recipientIds = null
}) {
  if (!squadId || !type) return;
  try {
    await pool.query(
      `INSERT INTO squad_activity (squad_id, user_id, sprite_id, type, action, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [squadId, userId || null, spriteId || null, type, action || null, JSON.stringify(metadata || {})]
    );

    if (messageParams) {
      const params = {
        ...messageParams,
        url: url || messageParams.url || `/?squad=${squadId}`,
        squadId
      };
      const send = Array.isArray(recipientIds)
        ? notifySelectedSquadMembers(squadId, recipientIds, params)
        : notifySquadMembersLocalized(squadId, userId, params);
      send.catch(err => console.error("[squad-activity] push failed:", err));
    }
  } catch (err) {
    console.error("[logSquadEvent]", err);
  }
}

async function logSquadCollectionEvent(userId, variantId, spriteId, action) {
  try {
    const squads = await pool.query(
      `SELECT sm.squad_id FROM squad_members sm WHERE sm.user_id = $1 AND sm.status = 'active'`,
      [userId]
    );
    if (!squads.rows.length) return [];

    const userResult = await pool.query(
      "SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL",
      [userId]
    );
    const username = userResult.rows[0]?.username || null;

    const spriteResult = await pool.query("SELECT name, official_name FROM sprites WHERE id = $1", [spriteId]);
    const spriteNameFr = spriteResult.rows[0]?.name || spriteId;
    const spriteNameEn = spriteResult.rows[0]?.official_name || spriteNameFr;

    for (const row of squads.rows) {
      const squadId = row.squad_id;

      const membersRes = await pool.query(
        `SELECT user_id FROM squad_members
         WHERE squad_id = $1 AND status = 'active' AND user_id <> $2`,
        [squadId, userId]
      );
      const otherIds = membersRes.rows.map(r => r.user_id);
      const visibleRecipientIds = [];
      for (const otherId of otherIds) {
        // Squad membership is never an implicit permission to inspect a
        // collection.  This also covers either direction of a user block.
        if (await canViewCollection(otherId, userId)) visibleRecipientIds.push(otherId);
      }
      const metadata = {
        variantId,
        spriteId,
        action,
        username
      };

      await logSquadEvent({
        squadId,
        userId,
        type: "collection_update",
        action,
        spriteId,
        metadata,
        messageParams: {
          activityTemplate: "collection",
          friendName: username,
          spriteName: spriteNameFr,
          // Recipients re-resolve actionLabel by lang in buildSquadPushPayload via params:
          actionLabelFr: action === "owned" ? "a obtenu" : "a repéré",
          actionLabelEn: action === "owned" ? "obtained" : "spotted",
          spriteNameFr,
          spriteNameEn
        },
        url: `/?squad=${squadId}`,
        recipientIds: visibleRecipientIds
      });
    }

    return squads.rows.map(r => r.squad_id);
  } catch (err) {
    console.error("[logSquadCollectionEvent]", err);
  }
}

async function logSquadMemberJoined(squadId, userId) {
  const userResult = await pool.query(
    "SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId]
  );
  const username = userResult.rows[0]?.username || null;
  await logSquadEvent({
    squadId,
    userId,
    type: "member_joined",
    action: "joined",
    metadata: {},
    messageParams: {
      activityTemplate: "member_joined",
      friendName: username
    },
    url: `/?squad=${squadId}`
  });
}

async function logSquadFriendship(userA, userB) {
  try {
    const [userARes, userBRes, squads] = await Promise.all([
      pool.query("SELECT id, username, deleted_at, profile_visibility, visibility FROM users WHERE id = $1", [userA]),
      pool.query("SELECT id, username, deleted_at, profile_visibility, visibility FROM users WHERE id = $1", [userB]),
      pool.query(
        `SELECT a.squad_id
         FROM squad_members a
         JOIN squad_members b ON a.squad_id = b.squad_id AND a.user_id <> b.user_id
         WHERE a.user_id = $1 AND b.user_id = $2
           AND a.status = 'active' AND b.status = 'active'`,
        [userA, userB]
      )
    ]);
    if (!userARes.rows.length || !userBRes.rows.length) return;
    const uA = userARes.rows[0];
    const uB = userBRes.rows[0];
    if (uA.deleted_at || uB.deleted_at) return;

    const visA = getVisibility(uA).profile;
    const visB = getVisibility(uB).profile;
    const bothAllowSquad = PUBLIC_SQUAD_PROFILE.has(visA) && PUBLIC_SQUAD_PROFILE.has(visB);
    if (!bothAllowSquad) return;

    for (const row of squads.rows) {
      await logSquadEvent({
        squadId: row.squad_id,
        userId: userA,
        type: "friendship",
        action: "accepted",
        metadata: {
          userA: String(userA),
          userB: String(userB),
          usernameA: uA.username,
          usernameB: uB.username
        },
        messageParams: {
          activityTemplate: "friendship",
          usernameA: uA.username,
          usernameB: uB.username
        },
        url: `/?squad=${row.squad_id}`
      });
    }
  } catch (err) {
    console.error("[logSquadFriendship]", err);
  }
}

async function logSquadCompletionMilestone(squadId, newRate) {
  try {
    if (newRate === null || newRate === undefined || isNaN(newRate)) return;
    const thresholds = [100, 90, 80, 75, 50, 25];
    const prevRes = await pool.query(
      "SELECT collective_completion_rate FROM squad_stats WHERE squad_id = $1",
      [squadId]
    );
    const prevRate = prevRes.rows.length ? parseFloat(prevRes.rows[0].collective_completion_rate) : 0;

    for (const threshold of thresholds) {
      if (newRate >= threshold && prevRate < threshold) {
        await logSquadEvent({
          squadId,
          userId: null,
          type: "milestone",
          action: "completion",
          metadata: { completionRate: newRate, threshold },
          messageParams: {
            activityTemplate: "milestone",
            threshold
          },
          url: `/?squad=${squadId}`
        });
        // Log only the highest newly crossed threshold per update.
        break;
      }
    }
  } catch (err) {
    console.error("[logSquadCompletionMilestone]", err);
  }
}

async function logSquadGoalCreated(squadId, userId, goalName) {
  const userResult = await pool.query(
    "SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId]
  );
  const username = userResult.rows[0]?.username || null;
  await logSquadEvent({
    squadId,
    userId,
    type: "goal_created",
    action: "created",
    metadata: { goalName },
    messageParams: {
      activityTemplate: "goal_created",
      friendName: username,
      goalTitle: goalName || null
    },
    url: `/?squad=${squadId}`
  });
}

async function logSquadGoalCompleted(squadId, userId, goalName, variantId) {
  const userResult = await pool.query(
    "SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId]
  );
  const username = userResult.rows[0]?.username || null;
  const members = await pool.query(
    `SELECT sm.user_id
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1
       AND sm.status = 'active'
       AND sm.user_id <> $2
       AND u.deleted_at IS NULL`,
    [squadId, userId]
  );
  const recipientIds = [];
  for (const row of members.rows) {
    // Completing a goal from a collection edit confirms that this actor owns
    // the target variant(s); it follows the same collection visibility rule as
    // a direct collection_update.
    if (await canViewCollection(row.user_id, userId)) recipientIds.push(row.user_id);
  }
  await logSquadEvent({
    squadId,
    userId,
    type: "goal_completed",
    action: "completed",
    metadata: { goalName, variantId },
    messageParams: {
      activityTemplate: "goal_completed",
      friendName: username,
      goalTitle: goalName || null
    },
    url: `/?squad=${squadId}`,
    recipientIds
  });
}

module.exports = {
  logSquadEvent,
  logSquadCollectionEvent,
  logSquadMemberJoined,
  logSquadFriendship,
  logSquadCompletionMilestone,
  logSquadGoalCreated,
  logSquadGoalCompleted,
  buildSquadPushPayload
};
