const {
  pool, canViewCollection, broadcastGoalUpdate, analytics, pushService,
  logSquadGoalCompleted, invalidateSquadAnalysisCache
} = require("./shared");

async function checkAffectedGoals(userId, variantId) {
  if (!userId || !variantId) return;
  try {
    const goals = await pool.query(
      `SELECT id, user_id, squad_id, variant_id, target_variant_ids, title, created_at
       FROM collection_goals
       WHERE status = 'active'
         AND (
           variant_id = $1
           OR (target_variant_ids IS NOT NULL AND $1 = ANY(target_variant_ids))
         )
         AND (
           user_id = $2
           OR squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = $2 AND status = 'active')
         )`,
      [variantId, userId]
    );

    for (const goal of goals.rows) {
      const targetIds = Array.isArray(goal.target_variant_ids) && goal.target_variant_ids.length
        ? goal.target_variant_ids
        : (goal.variant_id ? [goal.variant_id] : []);
      if (!targetIds.length) continue;

      let completed = false;
      if (goal.squad_id) {
        const membersRes = await pool.query(
          "SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'",
          [goal.squad_id]
        );
        const memberIds = membersRes.rows.map(r => r.user_id);
        const ownedRes = await pool.query(
          "SELECT DISTINCT variant_id FROM sprite_entries WHERE user_id = ANY($1) AND variant_id = ANY($2) AND status = 'owned'",
          [memberIds, targetIds]
        );
        completed = ownedRes.rows.length === targetIds.length;
      } else {
        const ownedRes = await pool.query(
          "SELECT DISTINCT variant_id FROM sprite_entries WHERE user_id = $1 AND variant_id = ANY($2) AND status = 'owned'",
          [goal.user_id, targetIds]
        );
        completed = ownedRes.rows.length === targetIds.length;
      }

      if (completed) {
        await pool.query(
          "UPDATE collection_goals SET status = 'completed', updated_at = NOW() WHERE id = $1",
          [goal.id]
        );
        if (goal.squad_id) invalidateSquadAnalysisCache(goal.squad_id);
        goal.status = "completed";
        goal.updated_at = new Date().toISOString();
        broadcastGoalUpdate(goal, "completed").catch(err => console.error("[goals] broadcast failed", err));
        analytics.logProductAnalyticsEvent(pool, { userId, squadId: goal.squad_id || null, event: "shared_goal_completed", details: { goalId: goal.id, variantIds: targetIds } });
        try {
          const {
            recordGraphEventSafe,
            GRAPH_EVENT_TYPES,
            buildGoalCompletedContext
          } = require("../../../../../server/sprite-graph");
          let participantCount = 1;
          if (goal.squad_id) {
            const pc = await pool.query(
              "SELECT COUNT(*)::int AS n FROM squad_members WHERE squad_id = $1 AND status = 'active'",
              [goal.squad_id]
            );
            participantCount = pc.rows[0]?.n || 1;
          }
          const goalCtx = buildGoalCompletedContext({
            goal,
            actorUserId: userId,
            targetVariantIds: targetIds,
            participantCount,
            completedAt: goal.updated_at || new Date().toISOString()
          });
          recordGraphEventSafe({
            eventType: GRAPH_EVENT_TYPES.GOAL_COMPLETED,
            actorUserId: userId,
            squadId: goal.squad_id || null,
            goalId: goal.id,
            source: "system",
            origin: "goals.checkAffected",
            context: {
              ...goalCtx,
              variantIds: targetIds
            },
            deduplicationKey: `${GRAPH_EVENT_TYPES.GOAL_COMPLETED}:${goal.id}`
          });
        } catch (_) { /* optional */ }
        if (goal.squad_id) {
          logSquadGoalCompleted(goal.squad_id, userId, goal.title || null, targetIds.join(", ")).catch(err => console.error("[goals] squad goal completed log failed", err));
          try {
            const { writeActivity } = require("../../../../../server/passport-activity");
            await writeActivity({
              userId,
              activityType: "collective_goal_completed",
              entityType: "goal",
              entityId: String(goal.id),
              data: {
                goalId: goal.id,
                goalTitle: goal.title || null,
                squadId: goal.squad_id,
                variantIds: targetIds
              },
              visibility: "friends"
            });
          } catch (err) {
            console.error("[goals] passport activity failed", err);
          }
        }
        const userResult = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
        const actorName = userResult.rows[0]?.username || "Quelqu'un";
        // Awaited so the notification is persisted before the request responds;
        // external push/email delivery is detached inside createNotification.
        // A squad goal can complete because another member acquired its
        // target. Do not turn that collection fact into a direct notification
        // for an owner who is no longer allowed to view the actor's collection.
        if (await canViewCollection(goal.user_id, userId)) {
          await pushService.createNotification(pool, {
            recipientId: goal.user_id,
            actorId: userId,
            type: "goal_completed",
            entityId: goal.variant_id,
            context: {
              goalId: goal.id,
              goalTitle: goal.title || null,
              actorName
            },
            url: "/collection"
          });
        }
      }
    }
  } catch (err) {
    console.error("[checkAffectedGoals]", err);
  }
}

module.exports = { checkAffectedGoals };
