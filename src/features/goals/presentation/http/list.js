const { app, pool, getRequestingUser } = require("./shared");

// ── Collection goals : list for the requesting user ──
app.get("/api/collection-goals", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  try {
    const result = await pool.query(
      `SELECT g.id, g.user_id, g.squad_id, g.title, g.description, g.variant_id, g.target_variant_ids, g.status, g.created_at, g.updated_at,
              s.code AS squad_code, s.name AS squad_name
       FROM collection_goals g
       LEFT JOIN squads s ON s.id = g.squad_id
       WHERE g.user_id = $1
          OR g.squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = $1 AND status = 'active')
       ORDER BY g.created_at DESC`,
      [reqUser]
    );
    res.json({
      goals: result.rows.map((g) => ({
        id: g.id,
        userId: g.user_id,
        squadId: g.squad_id,
        squadCode: g.squad_code,
        squadName: g.squad_name,
        title: g.title,
        description: g.description,
        variantId: g.variant_id,
        variantIds: Array.isArray(g.target_variant_ids) ? g.target_variant_ids : g.variant_id ? [g.variant_id] : [],
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
