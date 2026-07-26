// routes-goals.js — collection goals (personal or collective).

const { canViewCollection, getRequestingUser, requireNotSuspended } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const compare = require("./compare");
const security = require("../security");
const { broadcastGoalUpdate } = require("./ws");
const analytics = require("../analytics");
const pushService = require("../push-service");
const { logSquadGoalCreated, logSquadGoalCompleted } = require("./squad-activity");
const { invalidateSquadAnalysisCache } = require("./squad-analysis-cache");

const MAX_RECOMMENDATION_VARIANTS = 100;
const MAX_RECOMMENDATION_ASSIGNEES = 10; // A squad has at most ten active members.
const MAX_RECOMMENDATION_REASON_LENGTH = 600;
const MAX_RECOMMENDATION_DEADLINE_LENGTH = 64;
const MAX_RECOMMENDATION_GAIN = 10000;
const MAX_USER_ID = 2147483647;
const recommendationGoalLimiter = security.rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyPrefix: "recommendation-goal",
  message: "Trop de créations d'objectifs depuis des recommandations. Réessaie dans quelques minutes."
});

async function hasBlockedPair(userIds) {
  const ids = [...new Set(userIds.map(Number).filter(id => Number.isInteger(id) && id > 0 && id <= MAX_USER_ID))];
  if (ids.length < 2) return false;
  const result = await pool.query(
    `SELECT 1
     FROM user_blocks
     WHERE blocker_id = ANY($1::integer[])
       AND blocked_id = ANY($1::integer[])
     LIMIT 1`,
    [ids]
  );
  return result.rows.length > 0;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRecommendationText(value, { field, maxLength, fallback = null } = {}) {
  if (value === undefined || value === null || value === "") return { value: fallback };
  if (typeof value !== "string") return { error: `${field} invalide` };
  const normalized = value.trim();
  if (normalized.length > maxLength) return { error: `${field} trop long (${maxLength} max)` };
  return { value: normalized || fallback };
}

function normalizeRecommendationVariantIds(rawVariantIds) {
  if (!Array.isArray(rawVariantIds)) return { error: "Liste de variantes invalide" };
  if (rawVariantIds.length > MAX_RECOMMENDATION_VARIANTS) {
    return { error: `Trop de variantes (${MAX_RECOMMENDATION_VARIANTS} max)` };
  }

  const ids = [];
  const seen = new Set();
  for (const rawId of rawVariantIds) {
    if (typeof rawId !== "string" && typeof rawId !== "number") {
      return { error: "Identifiant de variante invalide" };
    }
    const variantId = String(rawId).trim();
    if (!variantId || variantId.length > 120) {
      return { error: "Identifiant de variante invalide" };
    }
    if (!seen.has(variantId)) {
      seen.add(variantId);
      ids.push(variantId);
    }
  }
  return { value: ids };
}

function normalizeRecommendationMemberIds(rawMemberIds) {
  if (!Array.isArray(rawMemberIds)) return { error: "Liste de membres assignés invalide" };
  if (rawMemberIds.length > MAX_RECOMMENDATION_ASSIGNEES) {
    return { error: `Trop de membres assignés (${MAX_RECOMMENDATION_ASSIGNEES} max)` };
  }

  const ids = [];
  const seen = new Set();
  for (const rawId of rawMemberIds) {
    if ((typeof rawId !== "string" && typeof rawId !== "number") || !/^\d+$/.test(String(rawId).trim())) {
      return { error: "Identifiant de membre invalide" };
    }
    const userId = Number(String(rawId).trim());
    if (!Number.isSafeInteger(userId) || userId < 1 || userId > MAX_USER_ID) {
      return { error: "Identifiant de membre invalide" };
    }
    if (!seen.has(userId)) {
      seen.add(userId);
      ids.push(userId);
    }
  }
  return { value: ids };
}

function normalizeRecommendationNumber(value, { field, min, max, fallback = null, integer = false } = {}) {
  if (value === undefined || value === null || value === "") return { value: fallback };
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
    return { error: `${field} invalide` };
  }
  return { value };
}

function normalizeRecommendationDeadline(value) {
  const text = normalizeRecommendationText(value, {
    field: "Date limite",
    maxLength: MAX_RECOMMENDATION_DEADLINE_LENGTH
  });
  if (text.error || !text.value) return text;
  const timestamp = Date.parse(text.value);
  if (!Number.isFinite(timestamp)) return { error: "Date limite invalide" };
  return { value: new Date(timestamp).toISOString() };
}

function getRawAssignedMemberIds(recommendation, overrides) {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, "assignedMemberIds") && overrides.assignedMemberIds !== null) {
    return normalizeRecommendationMemberIds(overrides.assignedMemberIds);
  }

  if (recommendation.participants === undefined || recommendation.participants === null) {
    return { value: [] };
  }
  if (!Array.isArray(recommendation.participants)) {
    return { error: "Liste de participants invalide" };
  }
  if (recommendation.participants.length > MAX_RECOMMENDATION_ASSIGNEES) {
    return { error: `Trop de participants (${MAX_RECOMMENDATION_ASSIGNEES} max)` };
  }
  const participantIds = [];
  for (const participant of recommendation.participants) {
    if (!isPlainObject(participant)) return { error: "Participant invalide" };
    participantIds.push(participant.userId);
  }
  return normalizeRecommendationMemberIds(participantIds);
}

function goalCreationError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

// Every path that creates a squad goal must use this transaction.  The active
// goal quota is per member, so lock that member's row in the squad (and the
// squad settings row) before counting.  Without the lock, parallel requests
// could all observe the same count and exceed max_active_goals_per_member.
async function insertCollectionGoalWithCapacity({
  userId,
  squadId = null,
  title,
  description,
  variantId,
  targetVariantIds
}) {
  let client;
  let committed = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    if (squadId) {
      const membership = await client.query(
        `SELECT s.max_active_goals_per_member
         FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE sm.squad_id = $1 AND sm.user_id = $2 AND sm.status = 'active'
         FOR UPDATE OF sm, s`,
        [squadId, userId]
      );
      if (!membership.rows.length) {
        throw goalCreationError(403, "Vous n'êtes pas membre actif de cette escouade");
      }

      const maxActiveGoals = membership.rows[0].max_active_goals_per_member ?? 3;
      const activeGoalsResult = await client.query(
        "SELECT COUNT(*) AS cnt FROM collection_goals WHERE user_id = $1 AND squad_id = $2 AND status = 'active'",
        [userId, squadId]
      );
      const activeGoalCount = parseInt(activeGoalsResult.rows[0].cnt, 10);
      if (activeGoalCount >= maxActiveGoals) {
        throw goalCreationError(429, "Limite d'objectifs actifs atteinte", {
          maxActiveGoals,
          activeGoalCount
        });
      }
    }

    const result = await client.query(
      `INSERT INTO collection_goals (user_id, squad_id, title, description, variant_id, target_variant_ids, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id, created_at`,
      [userId, squadId, title, description, variantId, targetVariantIds]
    );
    await client.query("COMMIT");
    committed = true;
    return result.rows[0];
  } catch (err) {
    if (client && !committed) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client?.release();
  }
}

// ── Collection goals : create ──
app.post("/api/collection-goals", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const { title, description, squadId, variantId, variantIds } = req.body || {};
  const normalizedTitle = normalizeRecommendationText(title, { field: "Titre", maxLength: 200 });
  if (normalizedTitle.error) return res.status(400).json({ error: normalizedTitle.error });
  const cleanTitle = normalizedTitle.value;
  if (!cleanTitle) return res.status(400).json({ error: "Titre requis" });

  const rawVariantIds = variantIds !== undefined && variantIds !== null
    ? variantIds
    : (variantId !== undefined && variantId !== null && variantId !== "" ? [variantId] : []);
  const normalizedVariantIds = normalizeRecommendationVariantIds(rawVariantIds);
  if (normalizedVariantIds.error) return res.status(400).json({ error: normalizedVariantIds.error });
  const targetVariantIds = normalizedVariantIds.value;
  const primaryVariantId = targetVariantIds[0] || null;

  if (targetVariantIds.length) {
    try {
      const catalogue = await compare.getServerCompareCatalogItemsCached();
      const knownVariantIds = new Set(catalogue.map(item => String(item.id)));
      if (targetVariantIds.some(id => !knownVariantIds.has(id))) {
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
      logSquadGoalCreated(squadIdNum, reqUser, cleanTitle).catch(err => console.error("[goals] squad activity log failed", err));
      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squadIdNum, event: "shared_goal_created", details: { goalId: result.id, title: cleanTitle, variantId: primaryVariantId } });
    }

    broadcastGoalUpdate({
      id: result.id,
      title: cleanTitle,
      description: cleanDescription,
      variant_id: primaryVariantId,
      target_variant_ids: targetVariantIds.length ? targetVariantIds : null,
      squad_id: squadIdNum,
      user_id: reqUser,
      status: "active",
      created_at: result.created_at
    }, "created").catch(err => console.error("[goals] broadcast failed", err));

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
      goals: result.rows.map(g => ({
        id: g.id,
        userId: g.user_id,
        squadId: g.squad_id,
        squadCode: g.squad_code,
        squadName: g.squad_name,
        title: g.title,
        description: g.description,
        variantId: g.variant_id,
        variantIds: Array.isArray(g.target_variant_ids) ? g.target_variant_ids : (g.variant_id ? [g.variant_id] : []),
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
  const variantId = goal.variant_id || (Array.isArray(goal.target_variant_ids) && goal.target_variant_ids.length ? goal.target_variant_ids[0] : null);
  if (!variantId) {
    return { error: "Cet objectif n'est pas lié à une variante" };
  }

  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const item = activeCatalogue.find(i => i.id === variantId);
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

  const difficulty = availabilityFactor * rarityFactor * acquisitionFactor * communityFactor * memberHelpFactor * progressionFactor;

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

async function checkAffectedGoals(userId, variantId) {
  if (!userId || !variantId) return;
  try {
    const goals = await pool.query(
      `SELECT id, user_id, squad_id, variant_id, target_variant_ids, title, created_at
       FROM collection_goals
       WHERE status = 'active'
         AND (
           variant_id = $1
           OR (target_variant_ids IS NOT NULL AND $1 = ANY(target_variant_ids))
         )
         AND (
           user_id = $2
           OR squad_id IN (SELECT squad_id FROM squad_members WHERE user_id = $2 AND status = 'active')
         )`,
      [variantId, userId]
    );

    for (const goal of goals.rows) {
      const targetIds = Array.isArray(goal.target_variant_ids) && goal.target_variant_ids.length
        ? goal.target_variant_ids
        : (goal.variant_id ? [goal.variant_id] : []);
      if (!targetIds.length) continue;

      let completed = false;
      if (goal.squad_id) {
        const membersRes = await pool.query(
          "SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'",
          [goal.squad_id]
        );
        const memberIds = membersRes.rows.map(r => r.user_id);
        const ownedRes = await pool.query(
          "SELECT DISTINCT variant_id FROM sprite_entries WHERE user_id = ANY($1) AND variant_id = ANY($2) AND status = 'owned'",
          [memberIds, targetIds]
        );
        completed = ownedRes.rows.length === targetIds.length;
      } else {
        const ownedRes = await pool.query(
          "SELECT DISTINCT variant_id FROM sprite_entries WHERE user_id = $1 AND variant_id = ANY($2) AND status = 'owned'",
          [goal.user_id, targetIds]
        );
        completed = ownedRes.rows.length === targetIds.length;
      }

      if (completed) {
        await pool.query(
          "UPDATE collection_goals SET status = 'completed', updated_at = NOW() WHERE id = $1",
          [goal.id]
        );
        if (goal.squad_id) invalidateSquadAnalysisCache(goal.squad_id);
        goal.status = "completed";
        goal.updated_at = new Date().toISOString();
        broadcastGoalUpdate(goal, "completed").catch(err => console.error("[goals] broadcast failed", err));
        analytics.logProductAnalyticsEvent(pool, { userId, squadId: goal.squad_id || null, event: "shared_goal_completed", details: { goalId: goal.id, variantIds: targetIds } });
        try {
          const {
            recordGraphEventSafe,
            GRAPH_EVENT_TYPES,
            buildGoalCompletedContext
          } = require("./sprite-graph");
          let participantCount = 1;
          if (goal.squad_id) {
            const pc = await pool.query(
              "SELECT COUNT(*)::int AS n FROM squad_members WHERE squad_id = $1 AND status = 'active'",
              [goal.squad_id]
            );
            participantCount = pc.rows[0]?.n || 1;
          }
          const goalCtx = buildGoalCompletedContext({
            goal,
            actorUserId: userId,
            targetVariantIds: targetIds,
            participantCount,
            completedAt: goal.updated_at || new Date().toISOString()
          });
          recordGraphEventSafe({
            eventType: GRAPH_EVENT_TYPES.GOAL_COMPLETED,
            actorUserId: userId,
            squadId: goal.squad_id || null,
            goalId: goal.id,
            source: "system",
            origin: "goals.checkAffected",
            context: {
              ...goalCtx,
              variantIds: targetIds
            },
            deduplicationKey: `${GRAPH_EVENT_TYPES.GOAL_COMPLETED}:${goal.id}`
          });
        } catch (_) { /* optional */ }
        if (goal.squad_id) {
          logSquadGoalCompleted(goal.squad_id, userId, goal.title || null, targetIds.join(", ")).catch(err => console.error("[goals] squad goal completed log failed", err));
          try {
            const { writeActivity } = require("./passport-activity");
            await writeActivity({
              userId,
              activityType: "collective_goal_completed",
              entityType: "goal",
              entityId: String(goal.id),
              data: {
                goalId: goal.id,
                goalTitle: goal.title || null,
                squadId: goal.squad_id,
                variantIds: targetIds
              },
              visibility: "friends"
            });
          } catch (err) {
            console.error("[goals] passport activity failed", err);
          }
        }
        const userResult = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
        const actorName = userResult.rows[0]?.username || "Quelqu'un";
        // Awaited so the notification is persisted before the request responds;
        // external push/email delivery is detached inside createNotification.
        // A squad goal can complete because another member acquired its
        // target. Do not turn that collection fact into a direct notification
        // for an owner who is no longer allowed to view the actor's collection.
        if (await canViewCollection(goal.user_id, userId)) {
          await pushService.createNotification(pool, {
            recipientId: goal.user_id,
            actorId: userId,
            type: "goal_completed",
            entityId: goal.variant_id,
            context: { goalId: goal.id },
            message: `Objectif${goal.title ? ` : ${goal.title}` : ""} atteint par ${actorName}.`,
            url: "/collection"
          });
        }
      }
    }
  } catch (err) {
    console.error("[checkAffectedGoals]", err);
  }
}

module.exports = { checkAffectedGoals };
