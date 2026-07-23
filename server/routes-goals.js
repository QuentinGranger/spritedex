// routes-goals.js — collection goals (personal or collective).

const { getRequestingUser } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const compare = require("./compare");
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

      const [squadResult, activeGoalsResult] = await Promise.all([
        pool.query("SELECT max_active_goals_per_member FROM squads WHERE id = $1", [squadIdNum]),
        pool.query(
          "SELECT COUNT(*) AS cnt FROM collection_goals WHERE user_id = $1 AND squad_id = $2 AND status = 'active'",
          [reqUser, squadIdNum]
        )
      ]);

      const maxActiveGoals = squadResult.rows[0]?.max_active_goals_per_member ?? 3;
      const activeGoalCount = parseInt(activeGoalsResult.rows[0].cnt, 10);
      if (activeGoalCount >= maxActiveGoals) {
        return res.status(429).json({
          error: "Limite d'objectifs actifs atteinte",
          maxActiveGoals,
          activeGoalCount
        });
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

// ── Collection goals : feasibility score for a goal ──
app.get("/api/collection-goals/:goalId/feasibility", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const goalRes = await pool.query(
      `SELECT *
       FROM collection_goals
       WHERE id = $1
         AND status = 'active'
         AND (user_id = $2 OR squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = $2 AND status = 'active'))`,
      [req.params.goalId, reqUser]
    );
    if (!goalRes.rows.length) {
      return res.status(404).json({ error: "Objectif introuvable ou terminé" });
    }

    const result = await getGoalFeasibility(goalRes.rows[0], reqUser);
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      goalId: req.params.goalId,
      title: goalRes.rows[0].title,
      squadId: goalRes.rows[0].squad_id,
      userId: goalRes.rows[0].user_id,
      ...result
    });
  } catch (err) {
    console.error("[/api/collection-goals/:goalId/feasibility]", err);
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

async function getGoalFeasibility(goal, reqUser) {
  if (!goal.variant_id) {
    return { error: "Cet objectif n'est pas lié à une variante" };
  }

  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const item = activeCatalogue.find(i => i.id === goal.variant_id);
  if (!item) {
    return { error: "Variante non trouvée dans le catalogue actif" };
  }

  let memberIds = [];
  if (goal.squad_id) {
    const membersRes = await pool.query(
      "SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [goal.squad_id]
    );
    memberIds = membersRes.rows.map(r => r.user_id);
  } else {
    memberIds = [goal.user_id];
  }

  const activeMemberCount = memberIds.length;
  if (activeMemberCount === 0) {
    return { error: "Aucun membre dans le périmètre de l'objectif" };
  }

  const ownedRes = await pool.query(
    "SELECT COUNT(DISTINCT user_id)::int AS cnt FROM sprite_entries WHERE variant_id = $1 AND status = 'owned' AND user_id = ANY($2)",
    [goal.variant_id, memberIds]
  );
  const ownedCount = ownedRes.rows[0].cnt || 0;
  const missingCount = activeMemberCount - ownedCount;

  let endDate = item.endDate || item.availabilityEndDate || null;
  if (!endDate && item.eventId) {
    const eventRes = await pool.query("SELECT end_date FROM events WHERE id = $1", [item.eventId]);
    if (eventRes.rows.length && eventRes.rows[0].end_date) {
      endDate = eventRes.rows[0].end_date;
    }
  }

  const now = new Date();
  let remainingDays = 365;
  if (endDate) {
    const diffMs = new Date(endDate).getTime() - now.getTime();
    remainingDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  const availability = String(item.availabilityStatus || item.availability?.status || "unknown").toLowerCase();
  const availabilityFactor = {
    available_now: 1,
    available: 1,
    upcoming: 1.2,
    event: 1.2,
    not_observed: 3,
    ended: 3,
    unknown: 2
  }[availability] || 2;

  const rarity = String(item.rarity || "_none").toLowerCase();
  const rarityFactor = {
    common: 1,
    uncommon: 1.2,
    rare: 1.5,
    epic: 2,
    legendary: 2.5,
    mythic: 3
  }[rarity] || 2;

  const acquisition = String(item.acquisitionMethod || item.acquisition?.type || "unknown").toLowerCase();
  const acquisitionFactor = {
    shop: 1,
    event: 1.5,
    quest: 2,
    boss: 2.5,
    unknown: 2
  }[acquisition] || 2;

  const totalActiveRes = await pool.query(
    "SELECT COUNT(*)::int AS cnt FROM users WHERE deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())"
  );
  const totalActive = totalActiveRes.rows[0].cnt || 1;
  const ownersRes = await pool.query(
    "SELECT COUNT(DISTINCT user_id)::int AS cnt FROM sprite_entries WHERE variant_id = $1 AND status = 'owned'",
    [goal.variant_id]
  );
  const communityOwners = ownersRes.rows[0].cnt || 0;
  const communityRate = communityOwners / totalActive;
  const communityFactor = 1 + (1 - Math.min(1, communityRate)) * 2;

  const memberHelpFactor = Math.max(0.5, 1 - (activeMemberCount - 1) * 0.03);

  const recentRes = await pool.query(
    "SELECT COUNT(DISTINCT variant_id)::int AS cnt FROM sprite_entries WHERE user_id = ANY($1) AND status = 'owned' AND created_at > NOW() - INTERVAL '7 days'",
    [memberIds]
  );
  const recentGains = recentRes.rows[0].cnt || 0;
  const progressionFactor = 1 / (1 + recentGains / 7);

  const difficulty = availabilityFactor * rarityFactor * acquisitionFactor * communityFactor * memberHelpFactor * progressionFactor;

  if (missingCount <= 0) {
    return {
      completed: true,
      variantId: goal.variant_id,
      missingCount: 0,
      activeMemberCount,
      remainingDays,
      difficulty: Math.round(difficulty * 100) / 100,
      availabilityFactor,
      rarityFactor,
      acquisitionFactor,
      communityRate: Math.round(communityRate * 10000) / 100,
      feasibilityScore: null,
      display: "Objectif déjà atteint.",
      disclaimer: "Ce score est une estimation interne, pas une probabilité officielle de réussite."
    };
  }

  const weightedMissing = missingCount * difficulty;
  const feasibility = remainingDays / weightedMissing;

  return {
    completed: false,
    variantId: goal.variant_id,
    missingCount,
    activeMemberCount,
    remainingDays,
    difficulty: Math.round(difficulty * 100) / 100,
    availabilityFactor,
    rarityFactor,
    acquisitionFactor,
    communityRate: Math.round(communityRate * 10000) / 100,
    feasibilityScore: Math.round(feasibility * 100) / 100,
    display: `Faisabilité ${feasibility.toFixed(2)} : ${remainingDays} jour(s) restant(s) pour ${missingCount} obtention(s) manquante(s).`,
    disclaimer: "Ce score est une estimation interne, pas une probabilité officielle de réussite."
  };
}

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
