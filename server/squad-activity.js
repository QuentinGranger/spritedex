// server/squad-activity.js — unified squad activity logger.
//
// All squad-facing events (collection updates, joins, friendships, goals,
// completion milestones) go through a single helper and are stored with a
// common schema: type + action + metadata JSONB context.

const { canViewCollection, getVisibility } = require("./auth");
const { pool } = require("./db");
const pushService = require("../push-service");

const PUBLIC_SQUAD_PROFILE = new Set(["public", "squad", "squad_only"]);

async function logSquadEvent({ squadId, userId, type, action, spriteId, metadata = {}, message, url }) {
  if (!squadId || !type) return;
  try {
    await pool.query(
      `INSERT INTO squad_activity (squad_id, user_id, sprite_id, type, action, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [squadId, userId || null, spriteId || null, type, action || null, JSON.stringify(metadata || {})]
    );

    if (message) {
      pushService.notifySquadMembers(pool, squadId, userId, {
        title: "SPRITNEX — Escouade",
        body: message,
        icon: "/icons/icon-192x192.png",
        url: url || `/?squad=${squadId}`
      }).catch(err => console.error("[squad-activity] push failed:", err));
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
    const username = userResult.rows[0]?.username || "Un joueur";

    const spriteResult = await pool.query("SELECT name FROM sprites WHERE id = $1", [spriteId]);
    const spriteName = spriteResult.rows[0]?.name || spriteId;

    const actionLabel = action === "owned" ? "a obtenu" : "a repéré";

    for (const row of squads.rows) {
      const squadId = row.squad_id;

      // Determine whether this variant was absent from the squad before this change.
      const membersRes = await pool.query(
        `SELECT user_id FROM squad_members
         WHERE squad_id = $1 AND status = 'active' AND user_id <> $2`,
        [squadId, userId]
      );
      const otherIds = membersRes.rows.map(r => r.user_id);
      let firstInSquad = true;
      if (otherIds.length) {
        const ownedRes = await pool.query(
          `SELECT 1 FROM sprite_entries
           WHERE user_id = ANY($1::integer[]) AND variant_id = $2 AND status = 'owned'
           LIMIT 1`,
          [otherIds, variantId]
        );
        firstInSquad = ownedRes.rows.length === 0;
      }

      const metadata = {
        variantId,
        spriteId,
        spriteName,
        firstInSquad,
        source: action === "owned" ? "owned" : "spotted"
      };

      let message = `${username} ${actionLabel} ${spriteName}`;
      if (firstInSquad) message += " (absent de la squad)";

      await logSquadEvent({
        squadId,
        userId,
        type: "collection_update",
        action,
        spriteId: variantId,
        metadata,
        message,
        url: `/?squad=${squadId}`
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
  const username = userResult.rows[0]?.username || "Un joueur";
  await logSquadEvent({
    squadId,
    userId,
    type: "member_joined",
    action: "joined",
    metadata: {},
    message: `${username} a rejoint la squad.`,
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
        message: `${uA.username} et ${uB.username} sont devenus amis.`,
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
          message: `La squad a atteint ${threshold} % de complétion.`,
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
  const username = userResult.rows[0]?.username || "Un joueur";
  await logSquadEvent({
    squadId,
    userId,
    type: "goal_created",
    action: "created",
    metadata: { goalName },
    message: `${username} a créé un objectif collectif${goalName ? ` : ${goalName}` : ""}.`,
    url: `/?squad=${squadId}`
  });
}

async function logSquadGoalCompleted(squadId, userId, goalName, variantId) {
  const userResult = await pool.query(
    "SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId]
  );
  const username = userResult.rows[0]?.username || "Un joueur";
  await logSquadEvent({
    squadId,
    userId,
    type: "goal_completed",
    action: "completed",
    metadata: { goalName, variantId },
    message: `Objectif collectif${goalName ? ` : ${goalName}` : ""} atteint par ${username}.`,
    url: `/?squad=${squadId}`
  });
}

module.exports = {
  logSquadEvent,
  logSquadCollectionEvent,
  logSquadMemberJoined,
  logSquadFriendship,
  logSquadCompletionMilestone,
  logSquadGoalCreated,
  logSquadGoalCompleted
};
