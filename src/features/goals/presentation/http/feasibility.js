const { app, pool, compare } = require("./shared");

async function getGoalFeasibility(goal, _reqUser) {
  const variantId =
    goal.variant_id ||
    (Array.isArray(goal.target_variant_ids) && goal.target_variant_ids.length ? goal.target_variant_ids[0] : null);
  if (!variantId) {
    return { error: "Cet objectif n'est pas lié à une variante" };
  }

  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const item = activeCatalogue.find((i) => i.id === variantId);
  if (!item) {
    return { error: "Variante non trouvée dans le catalogue actif" };
  }

  let memberIds = [];
  if (goal.squad_id) {
    const membersRes = await pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [
      goal.squad_id
    ]);
    memberIds = membersRes.rows.map((r) => r.user_id);
  } else {
    memberIds = [goal.user_id];
  }

  const activeMemberCount = memberIds.length;
  if (activeMemberCount === 0) {
    return { error: "Aucun membre dans le périmètre de l'objectif" };
  }

  const ownedRes = await pool.query(
    "SELECT COUNT(DISTINCT user_id)::int AS cnt FROM sprite_entries WHERE variant_id = $1 AND status = 'owned' AND user_id = ANY($2)",
    [variantId, memberIds]
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
  const availabilityFactor =
    {
      available_now: 1,
      available: 1,
      upcoming: 1.2,
      event: 1.2,
      not_observed: 3,
      ended: 3,
      unknown: 2
    }[availability] || 2;

  const rarity = String(item.rarity || "_none").toLowerCase();
  const rarityFactor =
    {
      common: 1,
      uncommon: 1.2,
      rare: 1.5,
      epic: 2,
      legendary: 2.5,
      mythic: 3
    }[rarity] || 2;

  const acquisition = String(item.acquisitionMethod || item.acquisition?.type || "unknown").toLowerCase();
  const acquisitionFactor =
    {
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
    [variantId]
  );
  const communityOwners = ownersRes.rows[0].cnt || 0;
  const communityRate = communityOwners / totalActive;
  const communityFactor = 1 + (1 - Math.min(1, communityRate)) * 2;

  const memberHelpFactor = Math.max(0.5, 1 - (activeMemberCount - 1) * 0.03);

  const recentRes = await pool.query(
    "SELECT COUNT(DISTINCT variant_id)::int AS cnt FROM sprite_entries WHERE user_id = ANY($1) AND status = 'owned' AND updated_at > NOW() - INTERVAL '7 days'",
    [memberIds]
  );
  const recentGains = recentRes.rows[0].cnt || 0;
  const progressionFactor = 1 / (1 + recentGains / 7);

  const difficulty =
    availabilityFactor * rarityFactor * acquisitionFactor * communityFactor * memberHelpFactor * progressionFactor;

  if (missingCount <= 0) {
    return {
      completed: true,
      variantId,
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
    variantId,
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
