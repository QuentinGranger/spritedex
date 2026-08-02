const ctx = require("./context");
const { APP_URL, MAX_SQUAD_SIMULATION_CHANGES, MAX_SQUAD_SIMULATION_TEXT_LENGTH, MAX_SQUAD_SIMULATION_VARIANTS, MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH, MAX_USER_ID, QRCode, SQUAD_SIMULATION_TYPES, analytics, app, areFriends, canViewCollection, compare, computeCatalogueVersion, crypto, generateSquadCode, getCachedOrComputeSquadAnalysis, getRelationship, getRequestingUser, getSquadByIdOrCode, getViewerSafeSquadMembers, getVisibleSquadMemberIds, invalidateSquadAnalysisCache, isBlocked, isPlainObject, loadViewerSafeCollection, normalizeSimulationChange, normalizeSimulationChanges, normalizeSimulationMemberId, normalizeSimulationText, normalizeSimulationVariantIds, parsePositiveUserId, pool, redactCollectionPriorities, refreshSquadStats, requireNotSuspended, requireSquadMember, resolveAddressee, security, shareSquad, squadSimulationLimiter } = ctx;
const friends = require("./logic-friends");
const { getSquadRecommendedFriends } = friends;
const { getSquadComplementaryPairs } = friends;

app.get("/api/squads/:squadId/recommendations", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "standardized-recommendations", async () => {
      const [friendsToInvite, memberComparisons] = await Promise.all([
        getSquadRecommendedFriends(squad, reqUser),
        getSquadComplementaryPairs(squad, reqUser)
      ]);

      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "squad_recommendation_viewed", details: { friendsToInviteCount: friendsToInvite.length, memberComparisonsCount: memberComparisons.length } });

      return {
        squadId: squad.code,
        recommendations: {
          friendsToInvite: friendsToInvite.map(c => ({
            userId: c.userId,
            username: c.username,
            displayName: c.displayName,
            avatarUrl: c.avatarUrl,
            newVariantsForSquad: c.newVariantsForSquad,
            potentialContribution: c.potentialContribution,
            projectedCompletionRate: c.projectedCompletionRate,
            currentCompletionRate: c.currentCompletionRate,
            complementarityScore: c.complementarityScore
          })),
          memberComparisons: memberComparisons.map(p => ({
            userAId: p.userAId,
            userAName: p.userAName,
            userAAvatar: p.userAAvatar,
            userBId: p.userBId,
            userBName: p.userBName,
            userBAvatar: p.userBAvatar,
            complementarityScore: p.complementarityScore
          }))
        }
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:squadId/recommendations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : unified activity history ──
app.get("/api/squads/:code/history", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    if (!(await requireSquadMember(req, res, squadResult.rows[0].id))) return;
    const reqUser = await getRequestingUser(req);

    const days = parseInt(req.query.days) || 7;
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);

    const result = await pool.query(
      `SELECT sa.type, sa.action, sa.sprite_id, sa.metadata, sa.created_at,
              COALESCE(u.username, 'Utilisateur anonyme') AS username,
              u.id AS user_id
       FROM squad_activity sa
       LEFT JOIN users u ON u.id = sa.user_id
       WHERE sa.squad_id = $1 AND sa.created_at > NOW() - INTERVAL '1 day' * $2
       ORDER BY sa.created_at DESC
       LIMIT $3`,
      [squadResult.rows[0].id, days, limit]
    );

    const entries = [];
    for (const row of result.rows) {
      // These activity types disclose a concrete collection change or confirm
      // that the actor owns a goal target. Keep their shared row for
      // authorized members, but never expose it to a squad member who cannot
      // view the actor's collection (including blocks and a later privacy
      // change). Fail closed for anonymised old rows.
      if (["collection_update", "goal_completed"].includes(row.type) && (
        !row.user_id || !(await canViewCollection(reqUser, row.user_id))
      )) {
        continue;
      }
      const metadata = row.metadata && typeof row.metadata === "object"
        ? { ...row.metadata }
        : {};
      // Older rows may still carry this aggregate. It must not be used to
      // infer ownership in another member's hidden collection.
      if (row.type === "collection_update") delete metadata.firstInSquad;
      entries.push({
        type: row.type,
        action: row.action,
        sprite_id: row.sprite_id,
        metadata,
        created_at: row.created_at,
        username: row.username,
        user_id: row.user_id
      });
    }

    res.json({ entries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
