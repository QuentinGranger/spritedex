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

app.post(
  "/api/squads",
  security.squadCreateLimiter,
  requireNotSuspended,
  security.validateBody(security.schemas.squadCreateSchema),
  async (req, res) => {
    const userId = await getRequestingUser(req);
    if (!userId) return res.status(401).json({ error: "Authentification requise" });
    const { name } = req.validatedBody;

    const code = generateSquadCode();
    const squadName = (name || "Mon escouade").trim().slice(0, 50);

    try {
      const result = await pool.query(
        `INSERT INTO squads (code, name, created_by) VALUES ($1, $2, $3) RETURNING id, code, name, created_at`,
        [code, squadName, userId]
      );
      const squad = result.rows[0];
      await pool.query(
        `INSERT INTO squad_members (squad_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
        [squad.id, userId]
      );
      try {
        const { writeActivity } = require("./passport-activity");
        await writeActivity({
          userId,
          activityType: "squad_created",
          entityType: "squad",
          entityId: String(squad.id),
          data: { squadId: squad.id, squadName: squad.name, squadCode: squad.code },
          visibility: "friends"
        });
        // Étape 43 — squad_founder is NOT awarded on create alone.
        require("./passport-summary")
          .schedulePassportRecalc(userId, {
            mode: "queue",
            reason: "squad.created",
            triggerEvent: "squad.created",
            notify: false
          })
          .catch(() => {});
      } catch (err) {
        console.error("[squads] passport activity failed", err);
      }
      res.json(squad);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "Code déjà pris, réessayez" });
      }
      console.error(err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

async function getCommonSquads(userA, userB) {
  if (!userA || !userB) return [];
  const result = await pool.query(
    `SELECT s.id, s.code, s.name, s.logo_url
     FROM squads s
     JOIN squad_members a ON a.squad_id = s.id AND a.user_id = $1 AND a.status = 'active'
     JOIN squad_members b ON b.squad_id = s.id AND b.user_id = $2 AND b.status = 'active'
     JOIN users ua ON ua.id = $1 AND ua.deleted_at IS NULL AND (ua.suspended_until IS NULL OR ua.suspended_until < NOW())
     JOIN users ub ON ub.id = $2 AND ub.deleted_at IS NULL AND (ub.suspended_until IS NULL OR ub.suspended_until < NOW())
     ORDER BY s.name`,
    [userA, userB]
  );
  return result.rows.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    logoUrl: s.logo_url || ""
  }));
}

// ── Squad : common squads between two users ──
app.get("/api/squads/common/:userA/:userB", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { userA, userB } = req.params;
  if (String(reqUser) !== String(userA) && String(reqUser) !== String(userB)) {
    return res.status(403).json({ error: "Accès refusé" });
  }
  try {
    const squads = await getCommonSquads(userA, userB);
    res.json({ squads });
  } catch (err) {
    console.error("[/api/squads/common]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : join by code ──
app.post(
  "/api/squads/join",
  security.squadJoinLimiter,
  requireNotSuspended,
  security.validateBody(security.schemas.squadJoinSchema),
  async (req, res) => {
    const userId = await getRequestingUser(req);
    if (!userId) return res.status(401).json({ error: "Authentification requise" });
    const { code } = req.validatedBody;

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      // The squad row serialises every capacity-changing path (direct join and
      // invitation acceptance).  Counting first on independent connections made
      // it possible for concurrent joins to both observe the ninth member.
      const squadResult = await client.query(
        "SELECT id, code, name, join_open, created_by, created_at FROM squads WHERE code = $1 FOR UPDATE",
        [code.trim().toUpperCase()]
      );
      if (!squadResult.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Code d'escouade introuvable" });
      }
      const { created_by: createdBy, ...squad } = squadResult.rows[0];
      if (squad.join_open === false) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Cette escouade n'accepte plus de nouveaux membres" });
      }

      const memberCount = await client.query(
        "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
        [squad.id]
      );
      if (parseInt(memberCount.rows[0].count) >= 10) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Escouade pleine (max 10)" });
      }

      const role = String(createdBy) === String(userId) ? "owner" : "member";
      await client.query(
        `INSERT INTO squad_members (squad_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (squad_id, user_id)
       DO UPDATE SET status = 'active', left_at = NULL, role = EXCLUDED.role`,
        [squad.id, userId, role]
      );
      await client.query("COMMIT");
      invalidateSquadAnalysisCache(squad.id);
      try {
        const {
          recordGraphEventSafe,
          GRAPH_EVENT_TYPES,
          computeSquadJoinImpact,
          buildSquadJoinedContext
        } = require("./sprite-graph");
        const impact = await computeSquadJoinImpact(squad.id, userId);
        recordGraphEventSafe({
          eventType: GRAPH_EVENT_TYPES.SQUAD_JOINED,
          actorUserId: userId,
          squadId: squad.id,
          source: "api",
          origin: "squad.join_code",
          context: buildSquadJoinedContext({
            inviterId: createdBy || null,
            memberRole: role,
            memberCountAfterJoin: impact.memberCountAfterJoin,
            collectiveCompletionBefore: impact.collectiveCompletionBefore,
            collectiveCompletionAfter: impact.collectiveCompletionAfter,
            newVariantsAddedToSquad: impact.newVariantsAddedToSquad,
            sharedVariantsAdded: impact.sharedVariantsAdded,
            joinSource: "join_code",
            squadName: squad.name,
            squadCode: squad.code
          }),
          deduplicationKey: `${GRAPH_EVENT_TYPES.SQUAD_JOINED}:${squad.id}:${userId}:join_code:${new Date().toISOString().slice(0, 19)}`
        });
      } catch (_) {
        /* optional */
      }
      try {
        const { writeActivity } = require("./passport-activity");
        await writeActivity({
          userId,
          activityType: "squad_joined",
          entityType: "squad",
          entityId: String(squad.id),
          data: { squadId: squad.id, squadName: squad.name, squadCode: squad.code },
          visibility: "friends"
        });
        if (createdBy) {
          const { evaluateUserBadges } = require("./badge-engine");
          await evaluateUserBadges(createdBy, "squad.member_joined", { batchNotify: false });
        }
        await require("./badge-engine").evaluateUserBadges(userId, "squad.member_joined", {
          batchNotify: false
        });
        require("./passport-summary")
          .schedulePassportRecalc(userId, {
            mode: "queue",
            reason: "squad.member_joined",
            triggerEvent: "squad.member_joined",
            notify: false
          })
          .catch(() => {});
        if (createdBy) {
          require("./passport-summary")
            .schedulePassportRecalc(createdBy, {
              mode: "queue",
              reason: "squad.member_joined",
              triggerEvent: "squad.member_joined",
              notify: false
            })
            .catch(() => {});
        }
      } catch (err) {
        console.error("[squads/join] passport activity failed", err);
      }
      res.json(squad);
    } catch (err) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      console.error(err);
      res.status(500).json({ error: "Erreur serveur" });
    } finally {
      client?.release();
    }
  }
);

// ── Squad : shareable join link + QR code ──
// Returns a one-click join link (?joinSquad=CODE) and its QR code. Members only.
// The link/QR encode ONLY the public squad code, no private identifier.
app.get("/api/squads/:code/qr", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code FROM squads WHERE code = $1", [
      req.params.code.trim().toUpperCase()
    ]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const url = `${APP_URL}/?joinSquad=${encodeURIComponent(squad.code)}`;
    let qr = null;
    try {
      qr = await QRCode.toDataURL(url, { type: "image/png", margin: 2, width: 300, errorCorrectionLevel: "M" });
    } catch (qrErr) {
      console.error("[/api/squads/:code/qr qr]", qrErr);
    }
    res.json({ code: squad.code, url, qr });
  } catch (err) {
    console.error("[/api/squads/:code/qr]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
