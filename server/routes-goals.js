// routes-goals.js — collection goals (personal or collective).

const { getRequestingUser } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const analytics = require("../analytics");
const pushService = require("../push-service");
const { logSquadGoalCreated, logSquadGoalCompleted } = require("./squad-activity");

// ── Collection goals : create ──
app.post("/api/collection-goals", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const { title, description, squadId, variantId } = req.body || {};
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return res.status(400).json({ error: "Titre requis" });
  if (cleanTitle.length > 200) return res.status(400).json({ error: "Titre trop long (200 max)" });

  try {
    let squadIdNum = null;
    if (squadId) {
      if (!/^\d+$/.test(String(squadId))) {
        return res.status(400).json({ error: "squadId invalide" });
      }
      squadIdNum = Number(squadId);
      const membership = await pool.query(
        "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
        [squadIdNum, reqUser]
      );
      if (!membership.rows.length) {
        return res.status(403).json({ error: "Vous n'êtes pas membre actif de cette escouade" });
      }
    }

    const result = await pool.query(
      `INSERT INTO collection_goals (user_id, squad_id, title, description, variant_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id, created_at`,
      [reqUser, squadIdNum, cleanTitle, description ? String(description).trim().slice(0, 1000) : null, variantId ? String(variantId).trim() : null]
    );

    if (squadIdNum) {
      logSquadGoalCreated(squadIdNum, reqUser, cleanTitle).catch(err => console.error("[goals] squad activity log failed", err));
      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squadIdNum, event: "shared_goal_created", details: { goalId: result.rows[0].id, title: cleanTitle, variantId: variantId ? String(variantId).trim() : null } });
    }

    res.status(201).json({
      ok: true,
      goalId: result.rows[0].id,
      createdAt: result.rows[0].created_at
    });
  } catch (err) {
    console.error("[/api/collection-goals]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collection goals : list for the requesting user ──
app.get("/api/collection-goals", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  try {
    const result = await pool.query(
      `SELECT g.id, g.user_id, g.squad_id, g.title, g.description, g.variant_id, g.status, g.created_at, g.updated_at,
              s.code AS squad_code, s.name AS squad_name
       FROM collection_goals g
       LEFT JOIN squads s ON s.id = g.squad_id
       WHERE g.user_id = $1
          OR g.squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = $1 AND status = 'active')
       ORDER BY g.created_at DESC`,
      [reqUser]
    );
    res.json({
      goals: result.rows.map(g => ({
        id: g.id,
        userId: g.user_id,
        squadId: g.squad_id,
        squadCode: g.squad_code,
        squadName: g.squad_name,
        title: g.title,
        description: g.description,
        variantId: g.variant_id,
        status: g.status,
        createdAt: g.created_at,
        updatedAt: g.updated_at
      }))
    });
  } catch (err) {
    console.error("[/api/collection-goals]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function checkAffectedGoals(userId, variantId) {
  if (!userId || !variantId) return;
  try {
    const goals = await pool.query(
      `SELECT id, user_id, squad_id, variant_id
       FROM collection_goals
       WHERE status = 'active'
         AND variant_id = $1
         AND (
           user_id = $2
           OR squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = $2 AND status = 'active')
         )`,
      [variantId, userId]
    );

    for (const goal of goals.rows) {
      let completed = false;
      if (goal.squad_id) {
        const owned = await pool.query(
          `SELECT 1
           FROM sprite_entries se
           JOIN squad_members sm ON sm.user_id = se.user_id
           WHERE sm.squad_id = $1
             AND sm.status = 'active'
             AND se.variant_id = $2
             AND se.status = 'owned'
           LIMIT 1`,
          [goal.squad_id, variantId]
        );
        completed = owned.rows.length > 0;
      } else {
        const owned = await pool.query(
          "SELECT 1 FROM sprite_entries WHERE user_id = $1 AND variant_id = $2 AND status = 'owned' LIMIT 1",
          [goal.user_id, variantId]
        );
        completed = owned.rows.length > 0;
      }

      if (completed) {
        await pool.query(
          "UPDATE collection_goals SET status = 'completed', updated_at = NOW() WHERE id = $1",
          [goal.id]
        );
        analytics.logProductAnalyticsEvent(pool, { userId, squadId: goal.squad_id || null, event: "shared_goal_completed", details: { goalId: goal.id, variantId } });
        if (goal.squad_id) {
          logSquadGoalCompleted(goal.squad_id, userId, goal.title || null, variantId).catch(err => console.error("[goals] squad goal completed log failed", err));
        }
          const userResult = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
          const actorName = userResult.rows[0]?.username || "Quelqu'un";
          pushService.createNotification(pool, {
            recipientId: goal.user_id,
            actorId: userId,
            type: "goal_completed",
            entityId: goal.variant_id,
            context: { goalId: goal.id },
            message: `Objectif${goal.title ? ` : ${goal.title}` : ""} atteint par ${actorName}.`,
            url: "/collection"
          }).catch(err => console.error("[goals] notification failed", err));
      }
    }
  } catch (err) {
    console.error("[checkAffectedGoals]", err);
  }
}

module.exports = { checkAffectedGoals };
