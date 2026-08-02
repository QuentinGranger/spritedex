const {
  app,
  getRequestingUser,
  requireNotSuspended,
  compare,
  MAX_USER_ID,
  normalizeRecommendationText,
  normalizeRecommendationVariantIds,
  insertCollectionGoalWithCapacity,
  logSquadGoalCreated,
  analytics,
  pool,
  broadcastGoalUpdate,
  invalidateSquadAnalysisCache
} = require("./shared");

// ── Collection goals : create ──
app.post("/api/collection-goals", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const { title, description, squadId, variantId, variantIds } = req.body || {};
  const normalizedTitle = normalizeRecommendationText(title, { field: "Titre", maxLength: 200 });
  if (normalizedTitle.error) return res.status(400).json({ error: normalizedTitle.error });
  const cleanTitle = normalizedTitle.value;
  if (!cleanTitle) return res.status(400).json({ error: "Titre requis" });

  const rawVariantIds =
    variantIds !== undefined && variantIds !== null
      ? variantIds
      : variantId !== undefined && variantId !== null && variantId !== ""
        ? [variantId]
        : [];
  const normalizedVariantIds = normalizeRecommendationVariantIds(rawVariantIds);
  if (normalizedVariantIds.error) return res.status(400).json({ error: normalizedVariantIds.error });
  const targetVariantIds = normalizedVariantIds.value;
  const primaryVariantId = targetVariantIds[0] || null;

  if (targetVariantIds.length) {
    try {
      const catalogue = await compare.getServerCompareCatalogItemsCached();
      const knownVariantIds = new Set(catalogue.map((item) => String(item.id)));
      if (targetVariantIds.some((id) => !knownVariantIds.has(id))) {
        return res.status(400).json({ error: "Une ou plusieurs variantes sont inconnues" });
      }
    } catch (err) {
      console.error("[/api/collection-goals] catalogue validation failed", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  }

  const normalizedDescription = normalizeRecommendationText(description, { field: "Description", maxLength: 1000 });
  if (normalizedDescription.error) return res.status(400).json({ error: normalizedDescription.error });
  const cleanDescription = normalizedDescription.value;

  try {
    let squadIdNum = null;
    if (squadId !== undefined && squadId !== null && squadId !== "") {
      if (!/^[1-9]\d*$/.test(String(squadId)) || Number(squadId) > MAX_USER_ID) {
        return res.status(400).json({ error: "squadId invalide" });
      }
      squadIdNum = Number(squadId);
    }

    const result = await insertCollectionGoalWithCapacity({
      userId: reqUser,
      squadId: squadIdNum,
      title: cleanTitle,
      description: cleanDescription,
      variantId: primaryVariantId,
      targetVariantIds: targetVariantIds.length ? targetVariantIds : null
    });

    if (squadIdNum) {
      logSquadGoalCreated(squadIdNum, reqUser, cleanTitle).catch((err) =>
        console.error("[goals] squad activity log failed", err)
      );
      analytics.logProductAnalyticsEvent(pool, {
        userId: reqUser,
        squadId: squadIdNum,
        event: "shared_goal_created",
        details: { goalId: result.id, title: cleanTitle, variantId: primaryVariantId }
      });
    }

    broadcastGoalUpdate(
      {
        id: result.id,
        title: cleanTitle,
        description: cleanDescription,
        variant_id: primaryVariantId,
        target_variant_ids: targetVariantIds.length ? targetVariantIds : null,
        squad_id: squadIdNum,
        user_id: reqUser,
        status: "active",
        created_at: result.created_at
      },
      "created"
    ).catch((err) => console.error("[goals] broadcast failed", err));

    if (squadIdNum) invalidateSquadAnalysisCache(squadIdNum);

    res.status(201).json({
      ok: true,
      goalId: result.id,
      createdAt: result.created_at
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
    }
    console.error("[/api/collection-goals]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
