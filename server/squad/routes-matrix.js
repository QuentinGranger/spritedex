const ctx = require("./context");
const {
  APP_URL,
  MAX_SQUAD_SIMULATION_CHANGES,
  MAX_SQUAD_SIMULATION_TEXT_LENGTH,
  MAX_SQUAD_SIMULATION_VARIANTS,
  MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH,
  MAX_USER_ID,
  QRCode,
  SQUAD_SIMULATION_TYPES,
  analytics,
  app,
  areFriends,
  canViewCollection,
  compare,
  computeCatalogueVersion,
  crypto,
  generateSquadCode,
  getCachedOrComputeSquadAnalysis,
  getRelationship,
  getRequestingUser,
  getSquadByIdOrCode,
  getViewerSafeSquadMembers,
  getVisibleSquadMemberIds,
  invalidateSquadAnalysisCache,
  isBlocked,
  isPlainObject,
  loadViewerSafeCollection,
  normalizeSimulationChange,
  normalizeSimulationChanges,
  normalizeSimulationMemberId,
  normalizeSimulationText,
  normalizeSimulationVariantIds,
  parsePositiveUserId,
  pool,
  redactCollectionPriorities,
  refreshSquadStats,
  requireNotSuspended,
  requireSquadMember,
  resolveAddressee,
  security,
  shareSquad,
  squadSimulationLimiter
} = ctx;

app.get("/api/squads/:code/matrix", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-matrix", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const publicMatrix = matrix.map((row) => {
        const { members, ...rest } = row;
        return rest;
      });

      return {
        squadCode: squad.code,
        squadName: squad.name,
        matrix: publicMatrix
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/matrix]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : variants missing from the whole squad ──
app.get("/api/squads/:code/missing-variants", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-missing-variants", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const result = compare.getSquadMissingVariants(matrix, squad.name);
      return {
        squadCode: squad.code,
        squadName: squad.name,
        ...result
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/missing-variants]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : unique owner variants (ownerCount === 1) ──
app.get("/api/squads/:code/unique-owners", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-unique-owners", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const result = compare.getSquadUniqueOwners(matrix);

      return {
        squadCode: squad.code,
        squadName: squad.name,
        ...result
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/unique-owners]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : shared variants (doublons / ownerCount >= 2) ──
app.get("/api/squads/:code/shared-variants", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-shared-variants", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const result = compare.getSquadSharedVariants(matrix);

      return {
        squadCode: squad.code,
        squadName: squad.name,
        ...result
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/shared-variants]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : delete (creator only) ──
app.delete("/api/squads/:code", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, created_by FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut supprimer l'escouade" });
    }
    await pool.query("DELETE FROM squads WHERE id = $1", [squad.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// SECURITY: the legacy "/api/squad/:username" route has been removed. It
// exposed ANY user's full collection (status + priority for every sprite)
// to ANYONE who knew their username, with zero authentication and zero
// regard for the "private" / "squad_only" privacy setting — a complete
// bypass of the privacy model. It was not called anywhere in the frontend
// (which uses /api/squads/:code for squad comparisons instead), so removing
// it does not affect any existing feature.

// ── Squad : acquisition priority (Level 2) ──
app.get("/api/squads/:code/acquisition-priority", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);
    const memberIds = members.map((m) => m.userId);

    const [goalsResult, memberGoalsResult, lastActiveResult] = await Promise.all([
      pool.query(
        "SELECT variant_id, user_id FROM collection_goals WHERE squad_id = $1 AND status = 'active' AND variant_id IS NOT NULL",
        [squad.id]
      ),
      pool.query(
        "SELECT user_id, COUNT(*) AS cnt FROM collection_goals WHERE user_id = ANY($1) AND status = 'active' GROUP BY user_id",
        [memberIds]
      ),
      pool.query(
        "SELECT user_id, MAX(updated_at) AS last_active FROM sprite_entries WHERE user_id = ANY($1) GROUP BY user_id",
        [memberIds]
      )
    ]);

    const activeGoalVariantIds = new Set(goalsResult.rows.map((r) => r.variant_id).filter(Boolean));
    const activeGoalVariantCounts = new Map();
    const memberGoalVariantSet = new Set();
    for (const r of goalsResult.rows) {
      if (!r.variant_id) continue;
      const key = `${r.user_id}:${r.variant_id}`;
      memberGoalVariantSet.add(key);
      activeGoalVariantCounts.set(r.variant_id, (activeGoalVariantCounts.get(r.variant_id) || 0) + 1);
    }

    const activeGoalCounts = new Map(memberGoalsResult.rows.map((r) => [String(r.user_id), parseInt(r.cnt, 10)]));
    const lastActiveByUser = new Map(lastActiveResult.rows.map((r) => [String(r.user_id), r.last_active]));

    const excludedSeasonIds = new Set(
      String(req.query.excludeSeason || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "acquisition-priority", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
      const assignments = await compare.getSquadAcquisitionAssignments(
        matrix,
        priorities,
        activeGoalCounts,
        lastActiveByUser,
        {
          excludedSeasonIds,
          activeGoalVariantCounts,
          memberGoalVariantSet,
          maxGoalAssignments: 2
        }
      );

      return {
        squadCode: squad.code,
        squadName: squad.name,
        activeGoalCount: activeGoalVariantIds.size,
        priorities: assignments
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/acquisition-priority]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : recommendations for a specific member ──
app.get("/api/squads/:code/recommendations/:memberId", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const targetUserId = req.params.memberId;
    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );
    if (!membersResult.rows.some((r) => String(r.user_id) === String(targetUserId))) {
      return res.status(404).json({ error: "Membre introuvable dans l'escouade" });
    }

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "member-recommendations", async () => {
      const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);
      const memberIds = members.map((m) => m.userId);

      const [goalsResult, memberGoalsResult, lastActiveResult] = await Promise.all([
        pool.query(
          "SELECT variant_id, user_id FROM collection_goals WHERE squad_id = $1 AND status = 'active' AND variant_id IS NOT NULL",
          [squad.id]
        ),
        pool.query(
          "SELECT user_id, COUNT(*) AS cnt FROM collection_goals WHERE user_id = ANY($1) AND status = 'active' GROUP BY user_id",
          [memberIds]
        ),
        pool.query(
          "SELECT user_id, MAX(updated_at) AS last_active FROM sprite_entries WHERE user_id = ANY($1) GROUP BY user_id",
          [memberIds]
        )
      ]);

      const activeGoalVariantIds = new Set(goalsResult.rows.map((r) => r.variant_id).filter(Boolean));
      const activeGoalVariantCounts = new Map();
      const memberGoalVariantSet = new Set();
      for (const r of goalsResult.rows) {
        if (!r.variant_id) continue;
        memberGoalVariantSet.add(`${r.user_id}:${r.variant_id}`);
        activeGoalVariantCounts.set(r.variant_id, (activeGoalVariantCounts.get(r.variant_id) || 0) + 1);
      }

      const activeGoalCounts = new Map(memberGoalsResult.rows.map((r) => [String(r.user_id), parseInt(r.cnt, 10)]));
      const lastActiveByUser = new Map(lastActiveResult.rows.map((r) => [String(r.user_id), r.last_active]));

      const excludedSeasonIds = new Set(
        String(req.query.excludeSeason || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );

      const matrix = await compare.buildSquadCollectionMatrix(members);
      const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
      const assignments = await compare.getSquadAcquisitionAssignments(
        matrix,
        priorities,
        activeGoalCounts,
        lastActiveByUser,
        {
          excludedSeasonIds,
          activeGoalVariantCounts,
          memberGoalVariantSet,
          maxGoalAssignments: 2
        }
      );

      const recommendations = compare.getSquadMemberRecommendations(matrix, assignments, targetUserId);
      const targetRow = membersResult.rows.find((r) => String(r.user_id) === String(targetUserId));

      return {
        userId: targetUserId,
        username: targetRow?.username || String(targetUserId),
        recommendations
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/recommendations/:memberId]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : collective acquisition plan ──
app.get("/api/squads/:code/collective-plan", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);
    const memberIds = members.map((m) => m.userId);

    const [goalsResult, memberGoalsResult, lastActiveResult] = await Promise.all([
      pool.query(
        "SELECT variant_id, user_id FROM collection_goals WHERE squad_id = $1 AND status = 'active' AND variant_id IS NOT NULL",
        [squad.id]
      ),
      pool.query(
        "SELECT user_id, COUNT(*) AS cnt FROM collection_goals WHERE user_id = ANY($1) AND status = 'active' GROUP BY user_id",
        [memberIds]
      ),
      pool.query(
        "SELECT user_id, MAX(updated_at) AS last_active FROM sprite_entries WHERE user_id = ANY($1) GROUP BY user_id",
        [memberIds]
      )
    ]);

    const activeGoalVariantIds = new Set(goalsResult.rows.map((r) => r.variant_id).filter(Boolean));
    const activeGoalVariantCounts = new Map();
    const memberGoalVariantSet = new Set();
    for (const r of goalsResult.rows) {
      if (!r.variant_id) continue;
      memberGoalVariantSet.add(`${r.user_id}:${r.variant_id}`);
      activeGoalVariantCounts.set(r.variant_id, (activeGoalVariantCounts.get(r.variant_id) || 0) + 1);
    }

    const activeGoalCounts = new Map(memberGoalsResult.rows.map((r) => [String(r.user_id), parseInt(r.cnt, 10)]));
    const lastActiveByUser = new Map(lastActiveResult.rows.map((r) => [String(r.user_id), r.last_active]));

    const excludedSeasonIds = new Set(
      String(req.query.excludeSeason || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "collective-plan", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
      const assignments = await compare.getSquadAcquisitionAssignments(
        matrix,
        priorities,
        activeGoalCounts,
        lastActiveByUser,
        {
          excludedSeasonIds,
          activeGoalVariantCounts,
          memberGoalVariantSet,
          maxGoalAssignments: 2
        }
      );

      const plan = compare.getSquadCollectivePlan(matrix, assignments);

      return {
        squadCode: squad.code,
        squadName: squad.name,
        totalCollectiveGain: plan.totalCollectiveGain,
        summary: `Ce plan permettrait d'ajouter jusqu'à ${plan.totalCollectiveGain} variante${plan.totalCollectiveGain > 1 ? "s" : ""} unique${plan.totalCollectiveGain > 1 ? "s" : ""} à la couverture collective.`,
        members: plan.members
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/collective-plan]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : who can help a given member the most ──
app.get("/api/squads/:code/helpful/:memberId", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const targetUserId = req.params.memberId;
    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const targetRow = membersResult.rows.find((r) => String(r.user_id) === String(targetUserId));
    if (!targetRow) return res.status(404).json({ error: "Membre introuvable dans l'escouade" });

    const members = await getViewerSafeSquadMembers(membersResult.rows, reqUser);

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "helpful-member", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const helpers = compare.getSquadHelpScores(matrix, targetUserId, {
        priorityWeight: 3,
        normalWeight: 1
      });

      const topHelper = helpers[0] || null;

      return {
        squadCode: squad.code,
        squadName: squad.name,
        targetUserId,
        targetUsername: targetRow.username || String(targetRow.user_id),
        topHelper,
        helpers
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/helpful/:memberId]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : join link redirect ──
