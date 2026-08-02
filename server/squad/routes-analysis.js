const ctx = require("./context");
const { APP_URL, MAX_SQUAD_SIMULATION_CHANGES, MAX_SQUAD_SIMULATION_TEXT_LENGTH, MAX_SQUAD_SIMULATION_VARIANTS, MAX_SQUAD_SIMULATION_VARIANT_ID_LENGTH, MAX_USER_ID, QRCode, SQUAD_SIMULATION_TYPES, analytics, app, areFriends, canViewCollection, compare, computeCatalogueVersion, crypto, generateSquadCode, getCachedOrComputeSquadAnalysis, getRelationship, getRequestingUser, getSquadByIdOrCode, getViewerSafeSquadMembers, getVisibleSquadMemberIds, invalidateSquadAnalysisCache, isBlocked, isPlainObject, loadViewerSafeCollection, normalizeSimulationChange, normalizeSimulationChanges, normalizeSimulationMemberId, normalizeSimulationText, normalizeSimulationVariantIds, parsePositiveUserId, pool, redactCollectionPriorities, refreshSquadStats, requireNotSuspended, requireSquadMember, resolveAddressee, security, shareSquad, squadSimulationLimiter } = ctx;
const friends = require("./logic-friends");
const teams = require("./logic-teams");
const simulations = require("./logic-simulations");
const completion = require("./logic-completion");
const { getSquadComplementaryPairs } = friends;
const { getSquadBestPair } = teams;
const { getSquadBestTeams } = teams;
const { getSquadMinimumTeam } = teams;
const { simulateSquadAcquisition } = simulations;
const { simulateSquadChanges } = simulations;
const { getSquadWhatIfImpact } = simulations;
const { getSquadRecommendedGoals } = completion;

app.get("/api/squads/:code/complementary-pairs", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-complementary-pairs", async () => {
      const pairs = await getSquadComplementaryPairs(squad, reqUser);
      return { squadCode: squad.code, squadName: squad.name, pairs };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/complementary-pairs]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : most complementary pair ──
app.get("/api/squads/:code/most-complementary-pair", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-most-complementary-pair", async () => {
      const pairs = await getSquadComplementaryPairs(squad, reqUser);
      const mostComplementaryPair = pairs[0] || null;
      return { squadCode: squad.code, squadName: squad.name, mostComplementaryPair };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/most-complementary-pair]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : best pair by coverage ──
app.get("/api/squads/:code/best-pair", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-best-pair", async () => {
      const bestPair = await getSquadBestPair(squad, reqUser);
      if (!bestPair) return null;
      return {
        squadCode: squad.code,
        squadName: squad.name,
        bestPair,
        display: `${bestPair.userAName} et ${bestPair.userBName} forment la meilleure paire avec ${bestPair.coverageRate}% du catalogue couvert.`
      };
    });
    if (!response) {
      return res.status(404).json({ error: "Pas assez de membres visibles pour former une paire" });
    }
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/best-pair]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : best team by coverage (2-4 players) ──
app.get("/api/squads/:code/best-teams", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const teamSize = parseInt(req.query.size, 10) || 3;
    if (teamSize < 2 || teamSize > 4) {
      return res.status(400).json({ error: "La taille d'équipe doit être entre 2 et 4" });
    }

    const mode = req.query.mode || "global";
    const filterValue = req.query.eventId || req.query.rarity || null;
    if (mode === "event" && !filterValue) {
      return res.status(400).json({ error: "eventId requis pour le mode event" });
    }

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-best-teams", async () => {
      const result = await getSquadBestTeams(squad, reqUser, teamSize, mode, filterValue);
      const bestTeam = result.teams[0] || null;
      return {
        squadCode: squad.code,
        squadName: squad.name,
        teamSize,
        mode: result.mode,
        filterValue: result.filterValue,
        bestTeam,
        teams: result.teams,
        display: bestTeam
          ? `La meilleure équipe de ${teamSize} couvre ${bestTeam.coverageRate}% du catalogue avec ${bestTeam.coveredVariantCount} variantes.`
          : "Aucune équipe trouvée."
      };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/best-teams]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : minimum team for a target ──
app.get("/api/squads/:code/minimum-team", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const targetType = req.query.targetType || "coverage";
    const validTypes = ["coverage", "event", "rarity", "custom"];
    if (!validTypes.includes(targetType)) {
      return res.status(400).json({ error: "targetType invalide" });
    }

    const options = {};
    if (targetType === "coverage") options.target = req.query.target || 80;
    if (targetType === "event") options.eventId = req.query.eventId;
    if (targetType === "rarity") options.rarity = req.query.rarity || "mythic";
    if (targetType === "custom") options.variantIds = req.query.variantIds;

    if ((targetType === "event" && !options.eventId) || (targetType === "custom" && !options.variantIds)) {
      return res.status(400).json({ error: "Paramètre manquant pour ce targetType" });
    }

    const method = req.query.method || "auto";
    if (!["auto", "greedy", "exhaustive"].includes(method)) {
      return res.status(400).json({ error: "method invalide (auto, greedy, exhaustive)" });
    }

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-minimum-team", async () => {
      const result = await getSquadMinimumTeam(squad, reqUser, targetType, options, method);
      if (!result) return null;
      return {
        squadCode: squad.code,
        squadName: squad.name,
        ...result,
        display: `${result.minPlayers} joueur${result.minPlayers > 1 ? 's' : ''} suffisent pour couvrir ${result.targetLabel} (${result.coveredTargetCount}/${result.targetTotal}).`
      };
    });
    if (!response) {
      return res.status(404).json({ error: "Aucune équipe ne peut couvrir l'objectif" });
    }
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/minimum-team]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : simulate acquisition without modifying collections ──
app.post("/api/squads/:code/simulate-acquisition", requireNotSuspended, squadSimulationLimiter, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const memberId = parsePositiveUserId(req.body?.memberId);
    if (memberId === null) return res.status(400).json({ error: "memberId invalide" });
    const normalizedAcquireVariantIds = normalizeSimulationVariantIds(req.body?.acquireVariantIds, {
      field: "acquireVariantIds",
      required: true
    });
    if (normalizedAcquireVariantIds.error) {
      return res.status(400).json({ error: normalizedAcquireVariantIds.error });
    }
    const acquireVariantIds = normalizedAcquireVariantIds.value;

    const result = await simulateSquadAcquisition(squad, reqUser, memberId, acquireVariantIds);
    res.json({
      squadCode: squad.code,
      squadName: squad.name,
      ...result
    });
  } catch (err) {
    console.error("[/api/squads/:code/simulate-acquisition]", err);
    if (err.message === "Membre introuvable dans l'escouade") {
      return res.status(404).json({ error: err.message });
    }
    if (err.message === "La collection de ce membre n'est pas visible") {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : multi-scenario simulation ──
app.post("/api/squads/:code/simulate", requireNotSuspended, squadSimulationLimiter, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
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
    console.error("[/api/squads/:code/simulate]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : what-if impact for a single change ──
app.post("/api/squads/:code/what-if", requireNotSuspended, squadSimulationLimiter, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const body = req.body;
    const change = isPlainObject(body) && Object.prototype.hasOwnProperty.call(body, "change") ? body.change : body;
    const normalizedChange = normalizeSimulationChange(change);
    if (normalizedChange.error) return res.status(400).json({ error: normalizedChange.error });

    const result = await getSquadWhatIfImpact(squad, reqUser, normalizedChange.value);
    res.json({
      squadCode: squad.code,
      squadName: squad.name,
      ...result
    });
  } catch (err) {
    console.error("[/api/squads/:code/what-if]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : most complementary member ──
app.get("/api/squads/:code/most-complementary-member", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
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

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-most-complementary-member", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const mostComplementaryMember = compare.getSquadMostComplementaryMember(matrix, squad.name);
      return { squadCode: squad.code, squadName: squad.name, mostComplementaryMember };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/most-complementary-member]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : recommended goals ──
app.get("/api/squads/:code/recommended-goals", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-recommended-goals", async () => {
      const result = await getSquadRecommendedGoals(squad, reqUser);
      return { squadCode: squad.code, squadName: squad.name, ...result };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/recommended-goals]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : Level 1 analysis ──
app.get("/api/squads/:code/analysis", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const membersResult = await pool.query(
      `SELECT sm.user_id, u.username, u.collection_visibility
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1 AND sm.status = 'active'`,
      [squad.id]
    );

    const matrixMembers = await getViewerSafeSquadMembers(membersResult.rows, reqUser);

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-analysis", async () => {
      const [matrix, pairs] = await Promise.all([
        compare.buildSquadCollectionMatrix(matrixMembers),
        getSquadComplementaryPairs(squad, reqUser)
      ]);

      const analysis = compare.getSquadLevel1Analysis(matrix, squad.name, pairs);
      return { squadCode: squad.code, squadName: squad.name, ...analysis };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/analysis]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad Completion Engine : full analysis ──
