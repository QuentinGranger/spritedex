const ctx = require("./context");
const { APP_URL, MAX_SQUAD_SIMULATION_CHANGES, MAX_SQUAD_SIMULATION_TEXT_LENGTH, MAX_SQUAD_SIMULATION_VARIANTS, MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH, MAX_USER_ID, QRCode, SQUAD_SIMULATION_TYPES, analytics, app, areFriends, canViewCollection, compare, computeCatalogueVersion, crypto, generateSquadCode, getCachedOrComputeSquadAnalysis, getRelationship, getRequestingUser, getSquadByIdOrCode, getViewerSafeSquadMembers, getVisibleSquadMemberIds, invalidateSquadAnalysisCache, isBlocked, isPlainObject, loadViewerSafeCollection, normalizeSimulationChange, normalizeSimulationChanges, normalizeSimulationMemberId, normalizeSimulationText, normalizeSimulationVariantIds, parsePositiveUserId, pool, redactCollectionPriorities, refreshSquadStats, requireNotSuspended, requireSquadMember, resolveAddressee, security, shareSquad, squadSimulationLimiter } = ctx;
const simulations = require("./logic-simulations");
const completion = require("./logic-completion");
const { simulateSquadChanges } = simulations;
const { buildSquadCompletionMembers } = completion;
const { getSquadCompletionScope } = completion;
const { getSquadVersionedCompletionReport } = completion;

app.get("/api/squads/:squadId/completion", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "completion", async () => {
      const members = await buildSquadCompletionMembers(squad, reqUser);
      const matrix = await compare.buildSquadCollectionMatrix(members);

      const scope = await getSquadCompletionScope(squad, reqUser);
      const completion = compare.getSquadCollectiveCompletion(matrix, squad.name);
      const averageOwnership = compare.getSquadAverageOwnership(matrix, squad.name);
      const missing = compare.getSquadMissingVariants(matrix, squad.name);
      const uniqueOwners = compare.getSquadUniqueOwners(matrix);
      const shared = compare.getSquadSharedVariants(matrix);
      const mostComplementary = compare.getSquadMostComplementaryMember(matrix, squad.name);
      const pairs = await getSquadComplementaryPairs(squad, reqUser);
      const bestPair = pairs[0] || null;

      return {
        squadCode: squad.code,
        squadName: squad.name,
        ...scope,
        scope,
        completion,
        averageOwnership,
        missing,
        uniqueOwners,
        shared,
        mostComplementary,
        bestPair
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:squadId/completion]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : missing variants ──
app.get("/api/squads/:squadId/completion/missing", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "missing", async () => {
      const members = await buildSquadCompletionMembers(squad, reqUser);
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const result = compare.getSquadMissingVariants(matrix, squad.name);
      const missingFromEntireSquad = matrix.filter(r => r.ownerCount === 0 && r.unknownCount === 0).map(r => ({
        variantId: r.variantId,
        spriteId: r.spriteId,
        spriteName: r.spriteName,
        variantName: r.variantName,
        rarity: r.rarity,
        availabilityStatus: r.availabilityStatus,
        eventId: r.eventId
      }));

      return {
        squadCode: squad.code,
        squadName: squad.name,
        ...result,
        missingFromEntireSquad
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:squadId/completion/missing]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : complementarity ──
app.get("/api/squads/:squadId/completion/complementarity", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "complementarity", async () => {
      const members = await buildSquadCompletionMembers(squad, reqUser);
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const pairs = await getSquadComplementaryPairs(squad, reqUser);
      const bestPair = pairs[0] || null;

      return {
        squadCode: squad.code,
        squadName: squad.name,
        mostComplementaryMember: compare.getSquadMostComplementaryMember(matrix, squad.name),
        uniqueOwners: compare.getSquadUniqueOwners(matrix),
        bestPair
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:squadId/completion/complementarity]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : recommendations ──
app.get("/api/squads/:squadId/completion/recommendations", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "recommendations", async () => {
      const members = await buildSquadCompletionMembers(squad, reqUser);
      const memberIds = members.map(m => m.userId);

      const [goalsResult, memberGoalsResult, lastActiveResult] = await Promise.all([
        pool.query("SELECT variant_id, user_id FROM collection_goals WHERE squad_id = $1 AND status = 'active' AND variant_id IS NOT NULL", [squad.id]),
        pool.query("SELECT user_id, COUNT(*) AS cnt FROM collection_goals WHERE user_id = ANY($1) AND status = 'active' GROUP BY user_id", [memberIds]),
        pool.query("SELECT user_id, MAX(updated_at) AS last_active FROM sprite_entries WHERE user_id = ANY($1) GROUP BY user_id", [memberIds])
      ]);

      const activeGoalVariantIds = new Set(goalsResult.rows.map(r => r.variant_id).filter(Boolean));
      const activeGoalVariantCounts = new Map();
      const memberGoalVariantSet = new Set();
      for (const r of goalsResult.rows) {
        if (!r.variant_id) continue;
        const key = `${r.user_id}:${r.variant_id}`;
        memberGoalVariantSet.add(key);
        activeGoalVariantCounts.set(r.variant_id, (activeGoalVariantCounts.get(r.variant_id) || 0) + 1);
      }

      const activeGoalCounts = new Map(memberGoalsResult.rows.map(r => [String(r.user_id), parseInt(r.cnt, 10)]));
      const lastActiveByUser = new Map(lastActiveResult.rows.map(r => [String(r.user_id), r.last_active]));
      const excludedSeasonIds = new Set(String(req.query.excludeSeason || "").split(",").map(s => s.trim()).filter(Boolean));

      const matrix = await compare.buildSquadCollectionMatrix(members);
      const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
      const assignments = await compare.getSquadAcquisitionAssignments(matrix, priorities, activeGoalCounts, lastActiveByUser, {
        excludedSeasonIds,
        activeGoalVariantCounts,
        memberGoalVariantSet,
        maxGoalAssignments: 2
      });

      return {
        squadCode: squad.code,
        squadName: squad.name,
        activeGoalCount: activeGoalVariantIds.size,
        priorities,
        assignments
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:squadId/completion/recommendations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : best team combinations ──
app.get("/api/squads/:squadId/completion/combinations", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "combinations", async () => {
      const size = Math.max(2, Math.min(4, parseInt(req.query.size, 10) || 3));
      const target = String(req.query.target || "all").toLowerCase();
      const eventId = req.query.eventId || null;

      let mode = "global";
      let filterValue = null;
      if (target === "mythic") {
        mode = "mythic";
      } else if (eventId) {
        mode = "event";
        filterValue = eventId;
      }

      const result = await getSquadBestTeams(squad, reqUser, size, mode, filterValue);
      return {
        squadCode: squad.code,
        squadName: squad.name,
        ...result
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:squadId/completion/combinations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : simulate completion changes ──
app.post("/api/squads/:squadId/completion/simulate", requireNotSuspended, squadSimulationLimiter, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const normalizedChanges = normalizeSimulationChanges(req.body?.changes);
    if (normalizedChanges.error) return res.status(400).json({ error: normalizedChanges.error });
    const changes = normalizedChanges.value;
    const result = await simulateSquadChanges(squad, reqUser, changes);

    res.json({
      squadCode: squad.code,
      squadName: squad.name,
      ...result
    });
  } catch (err) {
    console.error("[/api/squads/:squadId/completion/simulate]", err);
    if (err.message === "Membre introuvable dans l'escouade") {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : versioned report ──
app.get("/api/squads/:squadId/completion/report", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const report = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "report", async () => getSquadVersionedCompletionReport(squad, reqUser));
    res.json(report);
  } catch (err) {
    console.error("[/api/squads/:squadId/completion/report]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : collective collection matrix (variant x member) ──
