const {
  app, pool, compare, getRequestingUser, requireNotSuspended,
  recommendationGoalLimiter, isPlainObject, normalizeRecommendationVariantIds,
  normalizeRecommendationText, normalizeRecommendationDeadline,
  normalizeRecommendationNumber, getRawAssignedMemberIds, hasBlockedPair,
  insertCollectionGoalWithCapacity, logSquadGoalCreated, analytics,
  broadcastGoalUpdate, invalidateSquadAnalysisCache, MAX_RECOMMENDATION_ASSIGNEES,
  MAX_RECOMMENDATION_GAIN, MAX_USER_ID
} = require("./shared");

// ── Collection goals : convert a recommendation into a real goal ──
app.post("/api/collection-goals/from-recommendation", recommendationGoalLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const { recommendation, confirm, overrides } = req.body || {};
  if (!isPlainObject(recommendation)) {
    return res.status(400).json({ error: "Recommendation requise" });
  }
  if (overrides !== undefined && overrides !== null && !isPlainObject(overrides)) {
    return res.status(400).json({ error: "Overrides invalides" });
  }
  if (confirm !== undefined && typeof confirm !== "boolean") {
    return res.status(400).json({ error: "Confirmation invalide" });
  }

  const target = recommendation.target === undefined || recommendation.target === null ? {} : recommendation.target;
  if (!isPlainObject(target)) return res.status(400).json({ error: "Cible de recommendation invalide" });

  // Bound every client-provided array even if an override takes precedence,
  // so a forged unused field cannot turn validation into a large loop later.
  for (const candidate of [target.variantIds, overrides?.variantIds]) {
    if (candidate !== undefined && candidate !== null) {
      const normalized = normalizeRecommendationVariantIds(candidate);
      if (normalized.error) return res.status(400).json({ error: normalized.error });
    }
  }
  if (recommendation.participants !== undefined && recommendation.participants !== null) {
    if (!Array.isArray(recommendation.participants) || recommendation.participants.length > MAX_RECOMMENDATION_ASSIGNEES) {
      return res.status(400).json({ error: `Trop de participants (${MAX_RECOMMENDATION_ASSIGNEES} max)` });
    }
  }

  const rawSquadId = overrides?.squadId ?? recommendation.squadId ?? req.body?.squadId;
  let squadIdNum = null;
  if (rawSquadId !== undefined && rawSquadId !== null && rawSquadId !== "") {
    if (!/^[1-9]\d*$/.test(String(rawSquadId)) || Number(rawSquadId) > MAX_USER_ID) {
      return res.status(400).json({ error: "squadId invalide" });
    }
    squadIdNum = Number(rawSquadId);
    const membership = await pool.query(
      "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
      [squadIdNum, reqUser]
    );
    if (!membership.rows.length) {
      return res.status(403).json({ error: "Vous n'êtes pas membre actif de cette escouade" });
    }
  }

  const rawVariantIds = overrides?.variantIds !== undefined && overrides.variantIds !== null
    ? overrides.variantIds
    : (target.variantIds !== undefined && target.variantIds !== null
      ? target.variantIds
      : (target.variant_id !== undefined && target.variant_id !== null && target.variant_id !== "" ? [target.variant_id] : []));
  const normalizedVariantIds = normalizeRecommendationVariantIds(rawVariantIds);
  if (normalizedVariantIds.error) return res.status(400).json({ error: normalizedVariantIds.error });
  const cleanVariantIds = normalizedVariantIds.value;

  if (cleanVariantIds.length) {
    try {
      const catalogue = await compare.getServerCompareCatalogItemsCached();
      const knownVariantIds = new Set(catalogue.map(item => String(item.id)));
      if (cleanVariantIds.some(variantId => !knownVariantIds.has(variantId))) {
        return res.status(400).json({ error: "Une ou plusieurs variantes sont inconnues" });
      }
    } catch (err) {
      console.error("[/api/collection-goals/from-recommendation] catalogue validation failed", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  }

  const normalizedTitle = normalizeRecommendationText(overrides?.title || recommendation.title || "Nouvel objectif", {
    field: "Titre",
    maxLength: 200
  });
  if (normalizedTitle.error) return res.status(400).json({ error: normalizedTitle.error });
  const title = normalizedTitle.value;
  if (!title) return res.status(400).json({ error: "Titre requis" });

  const normalizedDeadline = normalizeRecommendationDeadline(overrides?.deadline || recommendation.deadline || null);
  if (normalizedDeadline.error) return res.status(400).json({ error: normalizedDeadline.error });
  const deadline = normalizedDeadline.value;

  const normalizedAssignedMemberIds = getRawAssignedMemberIds(recommendation, overrides);
  if (normalizedAssignedMemberIds.error) return res.status(400).json({ error: normalizedAssignedMemberIds.error });
  const assignedMemberIds = normalizedAssignedMemberIds.value;

  let assignedMemberNames = [];
  if (assignedMemberIds.length && squadIdNum) {
    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username, u.display_name
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1
         AND sm.status = 'active'
         AND sm.user_id = ANY($2::integer[])
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [squadIdNum, assignedMemberIds]
    );
    if (membersResult.rows.length !== assignedMemberIds.length) {
      return res.status(400).json({ error: "Les membres assignés doivent être des membres actifs de l'escouade" });
    }
    const membersById = new Map(membersResult.rows.map(member => [Number(member.user_id), member]));
    assignedMemberNames = assignedMemberIds.map(memberId => {
      const member = membersById.get(memberId);
      return member.display_name || member.username || String(memberId);
    });
  } else if (assignedMemberIds.length) {
    if (assignedMemberIds.length !== 1 || String(assignedMemberIds[0]) !== String(reqUser)) {
      return res.status(400).json({ error: "Un objectif personnel ne peut assigner que son créateur" });
    }
    const ownerResult = await pool.query(
      "SELECT username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL",
      [reqUser]
    );
    if (!ownerResult.rows.length) return res.status(404).json({ error: "Utilisateur introuvable" });
    assignedMemberNames = [ownerResult.rows[0].display_name || ownerResult.rows[0].username || String(reqUser)];
  }

  const blockedGoalMemberIds = [reqUser, ...assignedMemberIds].filter(Boolean);
  if (await hasBlockedPair(blockedGoalMemberIds)) {
    return res.status(403).json({ error: "Impossible de créer un objectif entre des membres bloqués" });
  }

  const normalizedExpectedGain = normalizeRecommendationNumber(recommendation.expectedCollectiveGain, {
    field: "Gain collectif attendu",
    min: 0,
    max: MAX_RECOMMENDATION_GAIN,
    integer: true,
    fallback: null
  });
  if (normalizedExpectedGain.error) return res.status(400).json({ error: normalizedExpectedGain.error });
  const expectedGain = normalizedExpectedGain.value === null ? "—" : normalizedExpectedGain.value;

  const normalizedReason = normalizeRecommendationText(recommendation.reason, {
    field: "Raison",
    maxLength: MAX_RECOMMENDATION_REASON_LENGTH,
    fallback: "Objectif issu d'une recommandation"
  });
  if (normalizedReason.error) return res.status(400).json({ error: normalizedReason.error });
  const reason = normalizedReason.value;

  const normalizedCurrentProgress = normalizeRecommendationNumber(recommendation.currentProgress, {
    field: "Progression initiale",
    min: 0,
    max: 100,
    fallback: 0
  });
  if (normalizedCurrentProgress.error) return res.status(400).json({ error: normalizedCurrentProgress.error });
  const currentProgress = normalizedCurrentProgress.value;

  const descriptionParts = [String(reason)];
  if (expectedGain !== "—") descriptionParts.push(`Gain collectif attendu : ${expectedGain} variante(s).`);
  if (currentProgress !== null) descriptionParts.push(`Progression initiale : ${currentProgress}%.`);
  if (deadline) descriptionParts.push(`Date limite : ${new Date(deadline).toLocaleString("fr-FR")}.`);
  if (assignedMemberNames.length) descriptionParts.push(`Membres assignés : ${assignedMemberNames.join(", ")}.`);
  const description = descriptionParts.join(" ").slice(0, 1000);

  const primaryVariantId = cleanVariantIds[0] || null;

  const prefill = {
    title,
    description,
    variantId: primaryVariantId,
    variantIds: cleanVariantIds,
    assignedMemberIds,
    deadline,
    squadId: squadIdNum,
    initialProgress: currentProgress,
    notifications: true
  };

  if (!confirm) {
    return res.json({ prefill });
  }

  try {
    const result = await insertCollectionGoalWithCapacity({
      userId: reqUser,
      squadId: squadIdNum,
      title,
      description: description || null,
      variantId: primaryVariantId,
      targetVariantIds: cleanVariantIds.length ? cleanVariantIds : null
    });

    if (squadIdNum) {
      logSquadGoalCreated(squadIdNum, reqUser, title).catch(err => console.error("[goals] squad activity log failed", err));
      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squadIdNum, event: "shared_goal_created", details: { goalId: result.id, title, variantIds: cleanVariantIds } });
    }

    broadcastGoalUpdate({
      id: result.id,
      title,
      description,
      variant_id: primaryVariantId,
      target_variant_ids: cleanVariantIds.length ? cleanVariantIds : null,
      squad_id: squadIdNum,
      user_id: reqUser,
      status: "active",
      created_at: result.created_at
    }, "created").catch(err => console.error("[goals] broadcast failed", err));

    if (squadIdNum) invalidateSquadAnalysisCache(squadIdNum);

    res.status(201).json({
      ok: true,
      goalId: result.id,
      createdAt: result.created_at,
      prefill
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
    }
    console.error("[/api/collection-goals/from-recommendation]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
