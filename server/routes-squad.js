// routes-squad.js — extracted from server.js

const security = require("../security");
const analytics = require("../analytics");
const { getRequestingUser, isAccountSuspended, isBlocked, requireSquadMember, areFriends, getRelationship, shareSquad, canViewCollection } = require("./auth");
const { app } = require("./core");
const compare = require("./compare");
const { pool } = require("./db");
const { resolveAddressee } = require("./friends/helpers");
const { getVisibleSquadMemberIds, refreshSquadStats } = require("./routes-squad-invitations");
const crypto = require("crypto");
const QRCode = require("qrcode");

// ── Squad analysis cache ──
const squadAnalysisCache = new Map();
const SQUAD_ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;
const SQUAD_ANALYSIS_CACHE_MAX_ENTRIES = 300;

function pruneSquadAnalysisCache() {
  const now = Date.now();
  for (const [key, entry] of squadAnalysisCache) {
    if (entry.expiresAt <= now) squadAnalysisCache.delete(key);
  }
  if (squadAnalysisCache.size > SQUAD_ANALYSIS_CACHE_MAX_ENTRIES) {
    const sorted = [...squadAnalysisCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = sorted.slice(0, squadAnalysisCache.size - SQUAD_ANALYSIS_CACHE_MAX_ENTRIES);
    for (const [key] of toDelete) squadAnalysisCache.delete(key);
  }
}

function getSquadAnalysisCache(key) {
  pruneSquadAnalysisCache();
  const entry = squadAnalysisCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    squadAnalysisCache.delete(key);
    return null;
  }
  return entry.data;
}

function setSquadAnalysisCache(key, data) {
  pruneSquadAnalysisCache();
  squadAnalysisCache.set(key, { data, expiresAt: Date.now() + SQUAD_ANALYSIS_CACHE_TTL_MS });
}

async function getSquadCollectionVersion(squad) {
  const result = await pool.query(
    `SELECT
      (SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM squad_members WHERE squad_id = $1 AND status = 'active') AS user_ids,
      (SELECT MAX(updated_at)::text FROM squad_members WHERE squad_id = $1 AND status = 'active') AS members_max,
      (SELECT MAX(se.updated_at)::text FROM sprite_entries se JOIN squad_members sm ON sm.user_id = se.user_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS entries_max,
      (SELECT COUNT(*)::text FROM sprite_entries se JOIN squad_members sm ON sm.user_id = se.user_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS entries_count,
      (SELECT MAX(u.updated_at)::text FROM users u JOIN squad_members sm ON sm.user_id = u.id WHERE sm.squad_id = $1 AND sm.status = 'active') AS users_max,
      (SELECT MAX(updated_at)::text FROM collection_goals WHERE squad_id = $1) AS goals_max,
      (SELECT MAX(f.updated_at)::text FROM friendships f JOIN squad_members sm ON sm.user_id = f.requester_id OR sm.user_id = f.addressee_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS friends_max,
      (SELECT MAX(b.updated_at)::text FROM user_blocks b JOIN squad_members sm ON sm.user_id = b.blocker_id OR sm.user_id = b.blocked_id WHERE sm.squad_id = $1 AND sm.status = 'active') AS blocks_max,
      (SELECT updated_at::text FROM squads WHERE id = $1) AS squad_updated`,
    [squad.id]
  );
  const r = result.rows[0];
  const payload = `${r.user_ids || ''}:${r.members_max || ''}:${r.entries_max || ''}:${r.entries_count || '0'}:${r.users_max || ''}:${r.goals_max || ''}:${r.friends_max || ''}:${r.blocks_max || ''}:${r.squad_updated || ''}`;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 12);
}

function getSquadFilterHash(req, endpoint) {
  const sorted = Object.keys(req.query).sort();
  const params = { _endpoint: endpoint };
  for (const k of sorted) params[k] = req.query[k];
  return crypto.createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 12);
}

async function getCachedOrComputeSquadAnalysis(req, squad, viewerId, endpoint, computeFn) {
  const [catalogueAll, collectionVersion] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    getSquadCollectionVersion(squad)
  ]);
  const catalogueVersion = computeCatalogueVersion(catalogueAll);
  const filterHash = getSquadFilterHash(req, endpoint);
  const key = `squad:${squad.id}:viewer:${viewerId}:cat:${catalogueVersion}:col:${collectionVersion}:filters:${filterHash}`;
  const cached = getSquadAnalysisCache(key);
  if (cached) {
    return cached;
  }
  const data = await computeFn();
  setSquadAnalysisCache(key, data);
  return data;
}

// ── Squad : secure code generation ──
function generateSquadCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return "SPRITE-" + code;
}

// ── Squad : lookup helper accepting numeric id or code ──
async function getSquadByIdOrCode(idOrCode) {
  const raw = String(idOrCode).trim();
  if (/^\d+$/.test(raw)) {
    return await pool.query(
      "SELECT id, code, name, created_by, join_open FROM squads WHERE id = $1",
      [Number(raw)]
    );
  }
  return await pool.query(
    "SELECT id, code, name, created_by, join_open FROM squads WHERE code = $1",
    [raw.toUpperCase()]
  );
}

// ── Squad : create ──
app.post("/api/squads", security.squadCreateLimiter, security.validateBody(security.schemas.squadCreateSchema), async (req, res) => {
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
    res.json(squad);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Code déjà pris, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

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
  return result.rows.map(s => ({
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
app.post("/api/squads/join", security.squadJoinLimiter, security.validateBody(security.schemas.squadJoinSchema), async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const { code } = req.validatedBody;

  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, join_open, created_at FROM squads WHERE code = $1",
      [code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Code d'escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    if (squad.join_open === false) {
      return res.status(403).json({ error: "Cette escouade n'accepte plus de nouveaux membres" });
    }

    const memberCount = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squad.id]
    );
    if (parseInt(memberCount.rows[0].count) >= 10) {
      return res.status(400).json({ error: "Escouade pleine (max 10)" });
    }

    const role = String(squad.created_by) === String(userId) ? "owner" : "member";
    await pool.query(
      `INSERT INTO squad_members (squad_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (squad_id, user_id)
       DO UPDATE SET status = 'active', left_at = NULL, role = EXCLUDED.role`,
      [squad.id, userId, role]
    );
    res.json(squad);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : shareable join link + QR code ──
// Returns a one-click join link (?joinSquad=CODE) and its QR code. Members only.
// The link/QR encode ONLY the public squad code, no private identifier.
app.get("/api/squads/:code/qr", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const base = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const url = `${base}/?joinSquad=${encodeURIComponent(squad.code)}`;
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

async function getMemberFriendshipStatus(reqUser, memberId) {
  if (!reqUser || String(reqUser) === String(memberId)) {
    return { friendshipStatus: "me", canReceiveFriendRequest: false, friendRequestDirection: null };
  }
  if (await isBlocked(reqUser, memberId)) {
    return { friendshipStatus: "blocked", canReceiveFriendRequest: false, friendRequestDirection: null };
  }
  const relationship = await getRelationship(reqUser, memberId);
  const activeStatuses = ["pending", "accepted", "blocked"];
  let friendshipStatus = "none";
  let friendRequestDirection = null;
  if (relationship && activeStatuses.includes(relationship.status)) {
    friendshipStatus = relationship.status;
    if (relationship.status === "pending") {
      friendRequestDirection = String(relationship.requester_id) === String(reqUser) ? "sent" : "received";
    }
  }
  const canReceiveFriendRequest = friendshipStatus === "none" && await memberAcceptsFriendRequests(reqUser, memberId);
  return { friendshipStatus, canReceiveFriendRequest, friendRequestDirection };
}

async function memberAcceptsFriendRequests(reqUser, memberId) {
  const result = await pool.query(
    "SELECT friend_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL",
    [memberId]
  );
  if (!result.rows.length) return false;
  const setting = result.rows[0].friend_invites_from || "everyone";
  if (setting === "nobody") return false;
  if (setting === "mutual_squad_members") return true; // both members are in this squad
  return setting === "everyone";
}

// ── Squad : get squad details + members with collections ──
app.get("/api/squads/:code", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, created_by, created_at, join_open, max_active_goals_per_member FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    if (!(await requireSquadMember(req, res, squadResult.rows[0].id))) return;
    const squad = squadResult.rows[0];
    const reqUser = await getRequestingUser(req);

    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, sm.role, sm.joined_at,
              u.collection_visibility, u.visibility
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1
         AND sm.status = 'active'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY sm.joined_at`,
      [squad.id]
    );

    const allActiveMemberIds = membersResult.rows.map(m => m.id);
    const matrixMembers = membersResult.rows.map(m => ({ userId: m.id, username: m.username || String(m.id), visible: true }));
    const members = [];
    const visibleMemberIds = [];
    for (const member of membersResult.rows) {
      // Hide members who mutually blocked the requester in this squad context.
      if (reqUser && await isBlocked(reqUser, member.id)) continue;
      const canSeeCollection = String(member.id) === String(reqUser) ||
        await canViewCollection(reqUser, member.id);

      let collection = {};
      let entryCount = 0;
      let lastUpdated = null;
      if (canSeeCollection) {
        visibleMemberIds.push(member.id);
        const entriesResult = await pool.query(
          "SELECT sprite_id, status, priority, updated_at FROM sprite_entries WHERE user_id = $1",
          [member.id]
        );
        for (const row of entriesResult.rows) {
          collection[row.sprite_id] = { status: row.status, priority: row.priority || "none" };
          if (row.updated_at && (!lastUpdated || row.updated_at > lastUpdated)) {
            lastUpdated = row.updated_at;
          }
        }
        entryCount = entriesResult.rows.length;
      }

      const { friendshipStatus, canReceiveFriendRequest, friendRequestDirection } = await getMemberFriendshipStatus(reqUser, member.id);
      members.push({
        userId: member.id,
        username: member.username,
        avatarUrl: member.avatar_url || "",
        role: member.role || (String(member.id) === String(squad.created_by) ? "owner" : "member"),
        joinedAt: member.joined_at,
        collection,
        entryCount,
        lastUpdated,
        friendshipStatus,
        canReceiveFriendRequest,
        friendRequestDirection
      });
    }

    const [recommendationsList, matrix] = await Promise.all([
      compare.getSquadRecommendations(visibleMemberIds),
      compare.buildSquadCollectionMatrix(matrixMembers)
    ]);

    const completion = compare.getSquadCollectiveCompletion(matrix, squad.name);
    const averageOwnership = compare.getSquadAverageOwnership(matrix, squad.name);
    const mostComplementaryMember = compare.getSquadMostComplementaryMember(matrix, squad.name);
    const uniqueOwners = compare.getSquadUniqueOwners(matrix);
    const uniqueCountByUser = new Map(uniqueOwners.byMember.map(m => [String(m.userId), m.count]));
    for (const m of members) {
      m.uniqueVariantCount = uniqueCountByUser.get(String(m.userId)) || 0;
    }
    const mapRecommendation = (r) => ({
      variantId: r.variantId,
      spriteId: r.spriteId,
      spriteName: r.spriteName,
      variantName: r.variantName,
      img: r.img,
      availability: r.availability,
      availabilityStatus: r.availabilityStatus,
      ownedByCount: r.ownedByCount,
      wantedByCount: r.wantedByCount
    });

    const recommendations = (recommendationsList.immediate || []).map(mapRecommendation);
    const watchListRecommendations = (recommendationsList.watchList || []).map(mapRecommendation);

    res.json({
      id: squad.id,
      code: squad.code,
      name: squad.name,
      createdBy: squad.created_by,
      createdAt: squad.created_at,
      joinOpen: squad.join_open !== false,
      maxActiveGoalsPerMember: squad.max_active_goals_per_member,
      members,
      collectiveCompletionRate: completion.collectiveCompletionRate,
      coveredVariantCount: completion.coveredVariantCount,
      totalVariantCount: completion.totalVariantCount,
      collectiveCompletionDisplay: completion.display,
      averageOwnershipRate: averageOwnership.averageOwnershipRate,
      ownedVariantsSum: averageOwnership.ownedVariantsSum,
      averageVariantCount: averageOwnership.averageVariantCount,
      averageOwnershipDisplay: averageOwnership.display,
      mostComplementaryMember,
      uniqueVariantTotal: uniqueOwners.totalUnique,
      recommendations,
      watchListRecommendations,
      immediateRecommendationCount: recommendationsList.immediateCount || 0,
      watchListRecommendationCount: recommendationsList.watchListCount || 0
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : leave ──
app.post("/api/squads/:code/leave", async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });

    await pool.query(
      `UPDATE squad_members
       SET status = 'left', left_at = NOW()
       WHERE squad_id = $1 AND user_id = $2 AND status = 'active'`,
      [squadResult.rows[0].id, userId]
    );

    try {
      await refreshSquadStats(squadResult.rows[0].id);
    } catch (err) {
      console.error("[leave] refresh stats failed", err);
    }

    const remaining = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squadResult.rows[0].id]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query("DELETE FROM squads WHERE id = $1", [squadResult.rows[0].id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : kick member (creator only) ──
app.post("/api/squads/:code/kick", async (req, res) => {
  // SECURITY FIX: this was previously calling getRequestingUser() without
  // `await`, so reqUser held a pending Promise (always truthy) and every
  // String(reqUser) comparison against created_by failed — the route was
  // unusable for legitimate owners and, more importantly, was never actually
  // enforcing the ownership check it appeared to have.
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: "targetUserId requis" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut retirer un membre" });
    }
    if (String(targetUserId) === String(reqUser)) {
      return res.status(400).json({ error: "Utilisez la route leave pour vous retirer" });
    }
    if (String(targetUserId) === String(squad.created_by)) {
      return res.status(403).json({ error: "Le créateur ne peut pas être retiré" });
    }
    await pool.query(
      `UPDATE squad_members
       SET status = 'removed', left_at = NOW()
       WHERE squad_id = $1 AND user_id = $2 AND status = 'active'`,
      [squad.id, targetUserId]
    );
    try {
      await refreshSquadStats(squad.id);
    } catch (err) {
      console.error("[kick] refresh stats failed", err);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : regenerate code (creator only) ──
app.post("/api/squads/:code/regenerate", security.squadCodeLimiter, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut régénérer le code" });
    }
    const newCode = generateSquadCode();
    await pool.query("UPDATE squads SET code = $1 WHERE id = $2", [newCode, squad.id]);
    res.json({ ok: true, code: newCode });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Collision de code, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : toggle join open/closed (creator only) ──
app.post("/api/squads/:code/toggle-join", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by, join_open FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut modifier l'accès" });
    }
    const newState = squad.join_open === false ? true : false;
    await pool.query("UPDATE squads SET join_open = $1 WHERE id = $2", [newState, squad.id]);
    res.json({ ok: true, joinOpen: newState });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : update settings (creator only) ──
app.post("/api/squads/:code/settings", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const { maxActiveGoalsPerMember } = req.body || {};
    const squadResult = await pool.query(
      "SELECT id, created_by, max_active_goals_per_member FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut modifier les paramètres" });
    }

    if (maxActiveGoalsPerMember === undefined || maxActiveGoalsPerMember === null || maxActiveGoalsPerMember === "") {
      return res.status(400).json({ error: "maxActiveGoalsPerMember requis" });
    }

    const parsed = parseInt(maxActiveGoalsPerMember, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 20) {
      return res.status(400).json({ error: "maxActiveGoalsPerMember doit être entre 1 et 20" });
    }

    await pool.query("UPDATE squads SET max_active_goals_per_member = $1 WHERE id = $2", [parsed, squad.id]);
    res.json({ ok: true, maxActiveGoalsPerMember: parsed });
  } catch (err) {
    console.error("[/api/squads/:code/settings]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : invite an accepted friend into the active squad ──
// This does NOT create a friendship; it only adds the friend as a member.
app.post("/api/squads/:code/invite/:friendId", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  if (await isAccountSuspended(reqUser)) {
    return res.status(403).json({ error: "Compte suspendu" });
  }

  const friendId = Number(req.params.friendId);
  if (!friendId || isNaN(friendId)) {
    return res.status(400).json({ error: "Identifiant invalide" });
  }
  if (String(reqUser) === String(friendId)) {
    return res.status(400).json({ error: "Tu ne peux pas t'inviter toi-même" });
  }

  try {
    const squadResult = await pool.query(
      "SELECT id, created_by, join_open FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    if (await isBlocked(reqUser, friendId)) {
      return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });
    }

    const targetRes = await pool.query(
      "SELECT squad_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())",
      [friendId]
    );
    if (!targetRes.rows.length) {
      return res.status(403).json({ error: "Cet utilisateur ne peut pas être invité" });
    }

    if (!(await areFriends(reqUser, friendId))) {
      return res.status(403).json({ error: "Seuls les amis peuvent être invités dans une escouade" });
    }

    const squadInvitesFrom = targetRes.rows[0].squad_invites_from || "friends";
    if (squadInvitesFrom === "nobody") {
      return res.status(403).json({ error: "Cet utilisateur n'accepte pas les invitations d'escouade" });
    }
    if (squadInvitesFrom === "mutual_squad_members" && !(await shareSquad(reqUser, friendId))) {
      return res.status(403).json({ error: "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune" });
    }

    const alreadyMember = await pool.query(
      "SELECT status FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squad.id, friendId]
    );
    if (alreadyMember.rows.length && alreadyMember.rows[0].status === 'active') {
      return res.status(409).json({ error: "Cet utilisateur est déjà membre de l'escouade" });
    }

    const membership = await pool.query(
      "SELECT role FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
      [squad.id, reqUser]
    );
    if (!membership.rows.length) {
      return res.status(403).json({ error: "Vous n'êtes pas membre actif de cette escouade" });
    }
    const role = membership.rows[0].role;
    const canInvite = role === "owner" || role === "admin" || (role === "member" && squad.join_open !== false);
    if (!canInvite) {
      return res.status(403).json({ error: "Votre rôle ne permet pas d'inviter dans cette escouade" });
    }

    const memberCount = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squad.id]
    );
    if (parseInt(memberCount.rows[0].count) >= 10) {
      return res.status(400).json({ error: "Escouade pleine (max 10)" });
    }

    const existingPending = await pool.query(
      `SELECT id FROM squad_invitations
       WHERE squad_id = $1 AND invitee_id = $2 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [squad.id, friendId]
    );
    if (existingPending.rows.length) {
      return res.status(409).json({ error: "Une invitation est déjà en attente" });
    }

    const invitationResult = await pool.query(
      `INSERT INTO squad_invitations (squad_id, inviter_id, invitee_id, status, expires_at)
       VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '7 days')
       RETURNING id`,
      [squad.id, reqUser, friendId]
    );
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "friend_invited_to_squad", details: { friendId, source: "member_profile" } });
    res.json({ ok: true, invitationId: invitationResult.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : list squads invitable for a friend ──
// Returns the squads where the current user has invite rights, the friend is not already an active member,
// the squad is not full, and the friend accepts squad invitations.
app.get("/api/squads/invitable", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  const friendId = Number(req.query.friendId);
  if (!friendId || isNaN(friendId)) {
    return res.status(400).json({ error: "friendId invalide" });
  }

  try {
    const result = await pool.query(
      `SELECT s.id, s.code, s.name, s.join_open, sm.role,
              COALESCE(u.squad_invites_from, 'friends') AS squad_invites_from,
              (SELECT COUNT(*) FROM squad_members m WHERE m.squad_id = s.id AND m.status = 'active') AS member_count
       FROM squad_members sm
       JOIN squads s ON s.id = sm.squad_id
       JOIN users u ON u.id = $2
       WHERE sm.user_id = $1
         AND sm.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM squad_members m2
           WHERE m2.squad_id = s.id AND m2.user_id = $2 AND m2.status = 'active'
         )
         AND NOT EXISTS (
           SELECT 1 FROM squad_invitations si
           WHERE si.squad_id = s.id AND si.invitee_id = $2 AND si.status = 'pending'
             AND (si.expires_at IS NULL OR si.expires_at > NOW())
         )
         AND (
           sm.role IN ('owner', 'admin')
           OR (sm.role = 'member' AND s.join_open = TRUE)
         )`,
      [reqUser, friendId]
    );

    const rows = [];
    for (const row of result.rows) {
      if (parseInt(row.member_count) >= 10) continue;
      const invitePref = row.squad_invites_from || "friends";
      if (invitePref === "nobody") continue;
      if (invitePref === "mutual_squad_members" && !(await shareSquad(reqUser, friendId))) continue;
      if (invitePref === "friends" && !(await areFriends(reqUser, friendId))) continue;
      rows.push({
        id: row.id,
        code: row.code,
        name: row.name,
        joinOpen: row.join_open !== false,
        role: row.role
      });
    }

    res.json({ squads: rows });
  } catch (err) {
    console.error("[/api/squads/invitable]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : invite a friend by squad id (body inviteeId) ──
app.post("/api/squads/:squadId/invitations", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  if (await isAccountSuspended(reqUser)) {
    return res.status(403).json({ error: "Compte suspendu" });
  }

  const resolved = await resolveAddressee(reqUser, req.body?.inviteeId);
  if (resolved.error) return res.status(resolved.error).json({ error: resolved.message });
  const friendId = resolved.friendId;

  if (await isBlocked(reqUser, friendId)) {
    return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });
  }

  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];

    const membership = await pool.query(
      "SELECT role FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
      [squad.id, reqUser]
    );
    if (!membership.rows.length) {
      return res.status(403).json({ error: "Vous n'êtes pas membre actif de cette escouade" });
    }
    const role = membership.rows[0].role;
    const canInvite = role === "owner" || role === "admin" || (role === "member" && squad.join_open !== false);
    if (!canInvite) {
      return res.status(403).json({ error: "Votre rôle ne permet pas d'inviter dans cette escouade" });
    }

    if (!(await areFriends(reqUser, friendId))) {
      return res.status(403).json({ error: "Seuls les amis peuvent être invités dans une escouade" });
    }

    const targetRes = await pool.query(
      "SELECT squad_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())",
      [friendId]
    );
    if (!targetRes.rows.length) {
      return res.status(403).json({ error: "Cet utilisateur ne peut pas être invité" });
    }
    const squadInvitesFrom = targetRes.rows[0].squad_invites_from || "friends";
    if (squadInvitesFrom === "nobody") {
      return res.status(403).json({ error: "Cet utilisateur n'accepte pas les invitations d'escouade" });
    }
    if (squadInvitesFrom === "mutual_squad_members" && !(await shareSquad(reqUser, friendId))) {
      return res.status(403).json({ error: "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune" });
    }

    const alreadyMember = await pool.query(
      "SELECT status FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squad.id, friendId]
    );
    if (alreadyMember.rows.length && alreadyMember.rows[0].status === 'active') {
      return res.status(409).json({ error: "Cet utilisateur est déjà membre de l'escouade" });
    }

    const memberCount = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squad.id]
    );
    if (parseInt(memberCount.rows[0].count) >= 10) {
      return res.status(400).json({ error: "Escouade pleine (max 10)" });
    }

    const existingPending = await pool.query(
      `SELECT id FROM squad_invitations
       WHERE squad_id = $1 AND invitee_id = $2 AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [squad.id, friendId]
    );
    if (existingPending.rows.length) {
      return res.status(409).json({ error: "Une invitation est déjà en attente" });
    }

    const invitationResult = await pool.query(
      `INSERT INTO squad_invitations (squad_id, inviter_id, invitee_id, status, expires_at)
       VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '7 days')
       RETURNING id`,
      [squad.id, reqUser, friendId]
    );
    const source = req.body?.source || "squad_invite";
    analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "friend_invited_to_squad", details: { friendId, source } });
    if (source === "recommended") {
      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, squadId: squad.id, event: "recommended_friend_invited", details: { friendId } });
    }
    res.json({ ok: true, invitationId: invitationResult.rows[0].id });
  } catch (err) {
    console.error("[/api/squads/:squadId/invitations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : list friends invitable to a given squad ──
app.get("/api/squads/:squadId/invitable-friends", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    const squad = squadResult.rows[0];

    const membership = await pool.query(
      "SELECT role FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
      [squad.id, reqUser]
    );
    if (!membership.rows.length) {
      return res.status(403).json({ error: "Vous n'êtes pas membre actif de cette escouade" });
    }
    const role = membership.rows[0].role;
    const canInvite = role === "owner" || role === "admin" || (role === "member" && squad.join_open !== false);
    if (!canInvite) {
      return res.status(403).json({ error: "Votre rôle ne permet pas d'inviter dans cette escouade" });
    }

    const memberCount = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1 AND status = 'active'",
      [squad.id]
    );
    const isFull = parseInt(memberCount.rows[0].count) >= 10;

    const friendsRes = await pool.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, COALESCE(u.squad_invites_from, 'friends') AS squad_invites_from
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       ORDER BY u.username`,
      [reqUser]
    );

    const friends = [];
    for (const f of friendsRes.rows) {
      if (isFull) continue;
      const invitePref = f.squad_invites_from || "friends";
      if (invitePref === "nobody") continue;
      if (invitePref === "mutual_squad_members" && !(await shareSquad(reqUser, f.id))) continue;

      const alreadyMember = await pool.query(
        "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'",
        [squad.id, f.id]
      );
      if (alreadyMember.rows.length) continue;

      const existingPending = await pool.query(
        `SELECT 1 FROM squad_invitations
         WHERE squad_id = $1 AND invitee_id = $2 AND status = 'pending'
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [squad.id, f.id]
      );
      if (existingPending.rows.length) continue;

      friends.push({
        id: f.id,
        username: f.username,
        displayName: f.display_name,
        avatarUrl: f.avatar_url || ""
      });
    }

    res.json({ friends });
  } catch (err) {
    console.error("[/api/squads/:squadId/invitable-friends]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : standardized recommendations (friends to invite + member comparisons) ──
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

    const entries = result.rows.map(row => ({
      type: row.type,
      action: row.action,
      sprite_id: row.sprite_id,
      metadata: row.metadata || {},
      created_at: row.created_at,
      username: row.username,
      user_id: row.user_id
    }));

    res.json({ entries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function getSquadRecommendedFriends(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id, role FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);

  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const itemMap = new Map(catalogue.map(i => [i.id, i]));
  const total = catalogue.length;

  const memberIds = membersRes.rows.map(r => r.user_id);
  const reqUserMembership = membersRes.rows.find(r => String(r.user_id) === String(reqUser));
  if (!reqUserMembership) return [];

  const canInviteAnyone = reqUserMembership.role === "owner" || reqUserMembership.role === "admin" || (reqUserMembership.role === "member" && squad.join_open !== false);

  const memberCollections = await Promise.all(memberIds.map(id => compare.loadServerCompareCollection(id)));
  const currentOwned = new Set();
  for (const c of memberCollections) {
    for (const item of catalogue) {
      if (compare.compareServerClassify(c[item.id] || compare.compareServerDefaultEntry()) === "owned") currentOwned.add(item.id);
    }
  }
  const squadMissingCount = total - currentOwned.size;

  const friendsRes = await pool.query(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.squad_invites_from
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted'
       AND (f.requester_id = $1 OR f.addressee_id = $1)
       AND u.deleted_at IS NULL
       AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
    [reqUser]
  );

  const candidates = [];
  for (const row of friendsRes.rows) {
    if (String(row.id) === String(reqUser)) continue;
    if (memberIds.some(m => String(m) === String(row.id))) continue;
    if (await isBlocked(reqUser, row.id)) continue;
    if (!(await canViewCollection(reqUser, row.id))) continue;

    const invitePref = row.squad_invites_from || "friends";
    let canReceiveInvite = false;
    if (invitePref === "everyone") canReceiveInvite = true;
    else if (invitePref === "friends") canReceiveInvite = true; // friend of reqUser by query
    else if (invitePref === "mutual_squad_members") canReceiveInvite = await shareSquad(reqUser, row.id);
    else if (invitePref === "nobody") canReceiveInvite = false;
    if (!canReceiveInvite) continue;

    const cCollection = await compare.loadServerCompareCollection(row.id);
    const cOwned = new Set();
    const cPriority = new Set();
    for (const item of catalogue) {
      const entry = cCollection[item.id] || compare.compareServerDefaultEntry();
      const cls = compare.compareServerClassify(entry);
      if (cls === "owned") cOwned.add(item.id);
      else if (compare.compareServerIsPriority(entry)) cPriority.add(item.id);
    }

    const newVariants = [];
    const mythicNewVariants = [];
    for (const vid of cOwned) {
      if (currentOwned.has(vid)) continue;
      newVariants.push(vid);
      const item = itemMap.get(vid);
      if (item && (item.rarity || "").toLowerCase() === "mythic") mythicNewVariants.push(vid);
    }

    const inter = new Set([...cOwned].filter(v => currentOwned.has(v))).size;
    const collectiveOwned = currentOwned.size + cOwned.size - inter;
    const onlyOne = collectiveOwned - inter;
    const complementarityRate = collectiveOwned ? Math.round((onlyOne / collectiveOwned) * 10000) / 100 : 0;

    const records = catalogue.map(item => ({
      ...item,
      userA: { status: currentOwned.has(item.id) ? "owned" : "missing", priority: "none", note: "" },
      userB: { status: cOwned.has(item.id) ? "owned" : (cPriority.has(item.id) ? "priority" : "missing"), priority: cPriority.has(item.id) ? "high" : "none", note: "" }
    }));
    const complementarityScore = compare.computeComplementarityScore(complementarityRate, records);

    const coverageGain = total ? Math.round((newVariants.length / total) * 10000) / 100 : 0;
    const currentSquadCoverageCount = currentOwned.size;
    const potentialCoverageCount = currentSquadCoverageCount + newVariants.length;
    const currentCompletionRate = total ? Math.round((currentSquadCoverageCount / total) * 10000) / 100 : 0;
    const projectedCompletionRate = total ? Math.round((potentialCoverageCount / total) * 10000) / 100 : 0;

    candidates.push({
      userId: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url || "",
      newVariantsForSquad: newVariants.length,
      mythicNewVariants: mythicNewVariants.length,
      currentSquadCoverageCount,
      potentialCoverageCount,
      potentialContribution: newVariants.length,
      complementarityRate,
      complementarityScore,
      coverageGain,
      currentCompletionRate,
      projectedCompletionRate,
      canInvite: canInviteAnyone && canReceiveInvite
    });
  }

  candidates.sort((a, b) => b.newVariantsForSquad - a.newVariantsForSquad);
  return candidates.slice(0, 20);
}

// ── Squad : recommended friends to invite based on collection complementarity ──
app.get("/api/squads/:code/recommended-friends", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, join_open FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "recommended-friends", async () => {
      const candidates = await getSquadRecommendedFriends(squad, reqUser);
      return { squadCode: squad.code, squadName: squad.name, candidates };
    });
    res.json(response);
  } catch (err) {
    console.error("[/api/squads/:code/recommended-friends]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function getSquadComplementaryPairs(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const memberIds = membersRes.rows.map(r => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const allowed = [];
  for (const u of usersRes.rows) {
    if (await canViewCollection(reqUser, u.id)) allowed.push(u);
  }

  const collectionCache = new Map();
  const memberCollections = await Promise.all(
    allowed.map(async (u) => {
      const c = await compare.loadServerCompareCollection(u.id);
      collectionCache.set(String(u.id), c);
      return c;
    })
  );

  const blockedPairs = new Set();
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      if (await isBlocked(allowed[i].id, allowed[j].id)) blockedPairs.add(`${i}:${j}`);
    }
  }

  const pairs = [];
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      if (blockedPairs.has(`${i}:${j}`)) continue;
      const a = allowed[i];
      const b = allowed[j];
      const userA = { id: a.id, displayName: a.display_name || a.username, collection: memberCollections[i] };
      const userB = { id: b.id, displayName: b.display_name || b.username, collection: memberCollections[j] };

      let result = compare.getCachedCompareResult(a.id, b.id);
      if (!result) {
        result = compare.compareCollectionsServer(userA, userB, catalogue);
        compare.setCachedCompareResult(a.id, b.id, result);
      }

      pairs.push({
        userAId: a.id,
        userAName: a.display_name || a.username,
        userAAvatar: a.avatar_url || "",
        userBId: b.id,
        userBName: b.display_name || b.username,
        userBAvatar: b.avatar_url || "",
        display: `${a.display_name || a.username} × ${b.display_name || b.username}`,
        complementarityRate: result.summary.complementarityRate,
        complementarityScore: result.summary.complementarityScore,
        combinedCoverageRate: result.summary.collectiveCompletionRate,
        combinedCoverageCount: result.summary.collectiveOwnedCount,
        totalVariantCount: result.summary.catalogueVariantCount
      });
    }
  }

  pairs.sort((a, b) => b.complementarityScore - a.complementarityScore);
  return pairs.slice(0, 15);
}

async function getSquadBestPair(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const memberIds = membersRes.rows.map(r => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const allowed = [];
  for (const u of usersRes.rows) {
    if (await canViewCollection(reqUser, u.id)) allowed.push(u);
  }
  if (allowed.length < 2) return null;

  const collections = await Promise.all(allowed.map(u => compare.loadServerCompareCollection(u.id)));

  const blockedPairs = new Set();
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      if (await isBlocked(allowed[i].id, allowed[j].id)) blockedPairs.add(`${i}:${j}`);
    }
  }

  const pairs = [];
  for (let i = 0; i < allowed.length; i++) {
    for (let j = i + 1; j < allowed.length; j++) {
      if (blockedPairs.has(`${i}:${j}`)) continue;
      const a = allowed[i];
      const b = allowed[j];
      const userA = { id: a.id, displayName: a.display_name || a.username, collection: collections[i] };
      const userB = { id: b.id, displayName: b.display_name || b.username, collection: collections[j] };

      let result = compare.getCachedCompareResult(a.id, b.id);
      if (!result) {
        result = compare.compareCollectionsServer(userA, userB, catalogue);
        compare.setCachedCompareResult(a.id, b.id, result);
      }

      const s = result.summary;
      pairs.push({
        userAId: a.id,
        userAName: a.display_name || a.username,
        userAAvatar: a.avatar_url || "",
        userBId: b.id,
        userBName: b.display_name || b.username,
        userBAvatar: b.avatar_url || "",
        display: `${a.display_name || a.username} × ${b.display_name || b.username}`,
        coveredVariantCount: s.collectiveOwnedCount,
        totalVariantCount: s.catalogueVariantCount,
        coverageRate: s.collectiveCompletionRate,
        uniqueVariantCount: s.onlyUserACount + s.onlyUserBCount,
        duplicateVariantCount: s.bothOwnedCount,
        complementarityRate: s.complementarityRate,
        complementarityScore: s.complementarityScore
      });
    }
  }

  pairs.sort((a, b) => b.coverageRate - a.coverageRate || b.complementarityScore - a.complementarityScore);
  return pairs[0] || null;
}

async function getSquadBestTeams(squad, reqUser, teamSize, mode = "global", filterValue = null) {
  const size = Math.max(2, Math.min(4, parseInt(teamSize, 10) || 3));
  const validModes = new Set(["global", "mythic", "event", "duplicates", "complementarity"]);
  const rankingMode = validModes.has(mode) ? mode : "global";

  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const memberIds = membersRes.rows.map(r => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const members = [];
  for (const u of usersRes.rows) {
    if (await canViewCollection(reqUser, u.id)) {
      const collection = await compare.loadServerCompareCollection(u.id);
      const owned = new Set();
      for (const [variantId, entry] of Object.entries(collection)) {
        if (compare.compareServerIsOwned(entry.status)) owned.add(variantId);
      }
      members.push({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarUrl: u.avatar_url || "",
        owned
      });
    }
  }

  if (members.length < size) return { teamSize: size, mode: rankingMode, teams: [] };

  const blockedPairs = new Set();
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (await isBlocked(members[i].id, members[j].id)) {
        blockedPairs.add(`${i}:${j}`);
        blockedPairs.add(`${j}:${i}`);
      }
    }
  }

  const total = catalogue.length;
  const rarityTotals = {};
  const eventTotals = {};
  for (const item of catalogue) {
    const r = item.rarity || "_none";
    const e = item.eventId || "_none";
    rarityTotals[r] = (rarityTotals[r] || 0) + 1;
    eventTotals[e] = (eventTotals[e] || 0) + 1;
  }

  const teams = [];

  function evaluate(indices) {
    const union = new Set();
    let totalOwned = 0;
    const variantOwnerCount = new Map();

    for (const idx of indices) {
      const owned = members[idx].owned;
      totalOwned += owned.size;
      for (const vid of owned) {
        union.add(vid);
        variantOwnerCount.set(vid, (variantOwnerCount.get(vid) || 0) + 1);
      }
    }

    let uniqueVariantCount = 0;
    let sharedVariantCount = 0;
    for (const count of variantOwnerCount.values()) {
      if (count === 1) uniqueVariantCount++;
      else sharedVariantCount++;
    }

    const coveredVariantCount = union.size;
    const coverageRate = total ? Math.round((coveredVariantCount / total) * 10000) / 100 : 0;
    const duplicatePossessionCount = totalOwned - coveredVariantCount;

    const coverageByRarity = {};
    const coverageByEvent = {};
    for (const item of catalogue) {
      if (!union.has(item.id)) continue;
      const rarity = item.rarity || "_none";
      const eventId = item.eventId || "_none";
      coverageByRarity[rarity] = (coverageByRarity[rarity] || 0) + 1;
      coverageByEvent[eventId] = (coverageByEvent[eventId] || 0) + 1;
    }

    const mythicTotal = rarityTotals["mythic"] || 0;
    const mythicCovered = coverageByRarity["mythic"] || 0;
    const mythicCoverageRate = mythicTotal ? Math.round((mythicCovered / mythicTotal) * 10000) / 100 : 0;

    const eventId = filterValue || "_none";
    const eventTotal = eventTotals[eventId] || 0;
    const eventCovered = coverageByEvent[eventId] || 0;
    const eventCoverageRate = eventTotal ? Math.round((eventCovered / eventTotal) * 10000) / 100 : 0;

    let pairCompSum = 0;
    let pairCount = 0;
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const a = members[indices[i]].owned;
        const b = members[indices[j]].owned;
        const inter = new Set([...a].filter(x => b.has(x))).size;
        const pairUnionSize = new Set([...a, ...b]).size;
        const uniqueInPair = pairUnionSize - inter;
        const rate = pairUnionSize ? Math.round((uniqueInPair / pairUnionSize) * 10000) / 100 : 0;
        pairCompSum += rate;
        pairCount++;
      }
    }
    const averageComplementarityRate = pairCount ? Math.round((pairCompSum / pairCount) * 100) / 100 : 0;

    teams.push({
      members: indices.map(idx => ({
        userId: members[idx].id,
        username: members[idx].username,
        displayName: members[idx].displayName,
        avatarUrl: members[idx].avatarUrl
      })),
      coveredVariantCount,
      totalVariantCount: total,
      coverageRate,
      mythicCoverageRate,
      eventCoverageRate,
      uniqueVariantCount,
      sharedVariantCount,
      duplicatePossessionCount,
      averageComplementarityRate,
      coverageByRarity,
      coverageByEvent
    });
  }

  function generate(start, current) {
    if (current.length === size) {
      evaluate(current);
      return;
    }
    for (let i = start; i < members.length; i++) {
      let blocked = false;
      for (const idx of current) {
        if (blockedPairs.has(`${idx}:${i}`)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      current.push(i);
      generate(i + 1, current);
      current.pop();
    }
  }

  generate(0, []);

  switch (rankingMode) {
    case "mythic":
      teams.sort((a, b) => b.mythicCoverageRate - a.mythicCoverageRate || b.coverageRate - a.coverageRate);
      break;
    case "event":
      teams.sort((a, b) => b.eventCoverageRate - a.eventCoverageRate || b.coverageRate - a.coverageRate);
      break;
    case "duplicates":
      teams.sort((a, b) => a.duplicatePossessionCount - b.duplicatePossessionCount || b.coverageRate - a.coverageRate);
      break;
    case "complementarity":
      teams.sort((a, b) => b.averageComplementarityRate - a.averageComplementarityRate || b.coverageRate - a.coverageRate);
      break;
    default:
      teams.sort((a, b) =>
        b.coverageRate - a.coverageRate ||
        b.averageComplementarityRate - a.averageComplementarityRate ||
        b.uniqueVariantCount - a.uniqueVariantCount
      );
  }

  const ranked = teams.slice(0, 10).map((t, i) => ({ rank: i + 1, ...t }));
  return { teamSize: size, mode: rankingMode, filterValue, teams: ranked };
}

async function getSquadMinimumTeam(squad, reqUser, targetType, options = {}, method = "auto") {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const total = catalogue.length;
  const memberIds = membersRes.rows.map(r => r.user_id);

  const usersRes = await pool.query(
    `SELECT id, username, display_name, avatar_url
     FROM users
     WHERE id = ANY($1) AND deleted_at IS NULL AND (suspended_until IS NULL OR suspended_until < NOW())`,
    [memberIds]
  );

  const members = [];
  for (const u of usersRes.rows) {
    if (await canViewCollection(reqUser, u.id)) {
      const collection = await compare.loadServerCompareCollection(u.id);
      const owned = new Set();
      for (const [variantId, entry] of Object.entries(collection)) {
        if (compare.compareServerIsOwned(entry.status)) owned.add(variantId);
      }
      members.push({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarUrl: u.avatar_url || "",
        owned
      });
    }
  }

  let targetVariantIds = [];
  let minRequiredCount = 0;
  let targetLabel = "";

  if (targetType === "coverage") {
    const targetPercent = Math.max(1, Math.min(100, parseFloat(options.target) || 80));
    minRequiredCount = Math.ceil(total * targetPercent / 100);
    targetVariantIds = catalogue.map(i => i.id);
    targetLabel = `${targetPercent}% du catalogue`;
  } else if (targetType === "event") {
    if (!options.eventId) throw new Error("eventId requis");
    targetVariantIds = catalogue.filter(i => i.eventId === options.eventId).map(i => i.id);
    targetLabel = `toutes les variantes de l'événement ${options.eventId}`;
  } else if (targetType === "rarity") {
    const rarity = options.rarity || "mythic";
    targetVariantIds = catalogue.filter(i => i.rarity === rarity).map(i => i.id);
    targetLabel = `toutes les variantes ${rarity}`;
  } else if (targetType === "custom") {
    const ids = String(options.variantIds || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const validSet = new Set(catalogue.map(i => i.id));
    targetVariantIds = ids.filter(id => validSet.has(id));
    targetLabel = "liste personnalisée";
  } else {
    throw new Error("targetType invalide");
  }

  const targetSet = new Set(targetVariantIds);
  const targetTotal = targetSet.size;
  if (targetTotal === 0) return null;
  if (minRequiredCount === 0) minRequiredCount = targetTotal;

  const useGreedy = method === "greedy" || (method === "auto" && members.length > 8) || (method === "exhaustive" && members.length > 10);

  if (useGreedy) {
    const remaining = new Set(targetSet);
    const selected = [];
    const used = new Set();

    while (selected.length < members.length && remaining.size > targetTotal - minRequiredCount) {
      let bestIdx = -1;
      let bestNew = 0;

      for (let idx = 0; idx < members.length; idx++) {
        if (used.has(idx)) continue;
        let newCovered = 0;
        for (const vid of members[idx].owned) {
          if (remaining.has(vid)) newCovered++;
        }
        if (newCovered > bestNew) {
          bestNew = newCovered;
          bestIdx = idx;
        }
      }

      if (bestIdx === -1 || bestNew === 0) break;

      used.add(bestIdx);
      selected.push(bestIdx);
      for (const vid of members[bestIdx].owned) remaining.delete(vid);
    }

    const coveredTargetCount = targetTotal - remaining.size;
    const union = new Set();
    let totalOwned = 0;
    for (const idx of selected) {
      totalOwned += members[idx].owned.size;
      for (const vid of members[idx].owned) union.add(vid);
    }

    return {
      minPlayers: selected.length,
      calculationMethod: "greedy_approximation",
      targetType,
      targetLabel,
      targetTotal,
      minRequiredCount,
      coveredTargetCount,
      targetCoverageRate: targetTotal ? Math.round((coveredTargetCount / targetTotal) * 10000) / 100 : 0,
      globalCoveredVariantCount: union.size,
      globalTotalVariantCount: total,
      globalCoverageRate: total ? Math.round((union.size / total) * 10000) / 100 : 0,
      duplicatePossessionCount: totalOwned - union.size,
      members: selected.map(idx => ({
        userId: members[idx].id,
        username: members[idx].username,
        displayName: members[idx].displayName,
        avatarUrl: members[idx].avatarUrl
      }))
    };
  }

  const maxK = members.length;
  for (let k = 1; k <= maxK; k++) {
    const current = [];
    function generate(start) {
      if (current.length === k) {
        evaluate([...current]);
        return;
      }
      for (let i = start; i < members.length; i++) {
        current.push(i);
        generate(i + 1);
        current.pop();
      }
    }

    let found = null;
    function evaluate(indices) {
      if (found) return;
      const union = new Set();
      for (const idx of indices) {
        for (const vid of members[idx].owned) union.add(vid);
      }

      let coveredTargetCount = 0;
      for (const vid of union) {
        if (targetSet.has(vid)) coveredTargetCount++;
      }

      if (coveredTargetCount >= minRequiredCount) {
        let totalOwned = 0;
        for (const idx of indices) totalOwned += members[idx].owned.size;

        found = {
          minPlayers: k,
          calculationMethod: "exhaustive",
          targetType,
          targetLabel,
          targetTotal,
          minRequiredCount,
          coveredTargetCount,
          targetCoverageRate: targetTotal ? Math.round((coveredTargetCount / targetTotal) * 10000) / 100 : 0,
          globalCoveredVariantCount: union.size,
          globalTotalVariantCount: total,
          globalCoverageRate: total ? Math.round((union.size / total) * 10000) / 100 : 0,
          duplicatePossessionCount: totalOwned - union.size,
          members: indices.map(idx => ({
            userId: members[idx].id,
            username: members[idx].username,
            displayName: members[idx].displayName,
            avatarUrl: members[idx].avatarUrl
          }))
        };
      }
    }

    generate(0);
    if (found) return found;
  }

  return null;
}

async function simulateSquadAcquisition(squad, reqUser, memberId, acquireVariantIds) {
  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const total = catalogue.length;
  const validIds = new Set(catalogue.map(i => i.id));

  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const targetRow = membersResult.rows.find(r => String(r.user_id) === String(memberId));
  if (!targetRow) throw new Error("Membre introuvable dans l'escouade");
  if (!(await canViewCollection(reqUser, memberId))) {
    throw new Error("La collection de ce membre n'est pas visible");
  }

  const members = [];
  for (const r of membersResult.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    if (!visible) continue;
    const collection = await compare.loadServerCompareCollection(r.user_id);
    const owned = new Set();
    for (const [variantId, entry] of Object.entries(collection)) {
      if (compare.compareServerIsOwned(entry.status) && validIds.has(variantId)) owned.add(variantId);
    }
    members.push({ userId: r.user_id, username: r.username, owned });
  }

  const rawIds = Array.isArray(acquireVariantIds)
    ? acquireVariantIds
    : String(acquireVariantIds || "").split(",").map(s => s.trim()).filter(Boolean);
  const newVariantIds = rawIds.filter(id => validIds.has(id));
  const extraSet = new Set(newVariantIds);

  function computeCoverage(extraByUser = null) {
    const union = new Set();
    for (const m of members) {
      const isTarget = String(m.userId) === String(memberId);
      const set = extraByUser && isTarget ? new Set([...m.owned, ...extraByUser]) : m.owned;
      for (const vid of set) union.add(vid);
    }
    const coveredCount = union.size;
    const completionRate = total ? Math.round((coveredCount / total) * 10000) / 100 : 0;
    return { coveredCount, completionRate, totalVariantCount: total };
  }

  const before = computeCoverage();
  const after = computeCoverage(extraSet);

  return {
    memberId,
    acquireVariantIds: newVariantIds,
    before,
    after,
    difference: {
      coveredCount: after.coveredCount - before.coveredCount,
      completionRate: Math.round((after.completionRate - before.completionRate) * 100) / 100,
      totalVariantCount: 0
    }
  };
}

function toVariantIdList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean);
}

async function simulateSquadChanges(squad, reqUser, changes = []) {
  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const catalogueById = new Map(activeCatalogue.map(i => [i.id, i]));
  const validIds = new Set(activeCatalogue.map(i => i.id));

  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = [];
  for (const r of membersResult.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    if (!visible) continue;
    const collection = await compare.loadServerCompareCollection(r.user_id);
    const owned = new Set();
    for (const [variantId, entry] of Object.entries(collection)) {
      if (compare.compareServerIsOwned(entry.status) && validIds.has(variantId)) owned.add(variantId);
    }
    members.push({
      userId: r.user_id,
      username: r.username,
      displayName: r.display_name || r.username,
      owned
    });
  }

  let activeIds = new Set(validIds);

  function computeCoverage(memberList, idSet) {
    const union = new Set();
    for (const m of memberList) {
      for (const vid of m.owned) {
        if (idSet.has(vid)) union.add(vid);
      }
    }
    const coveredCount = union.size;
    const total = idSet.size;
    const completionRate = total ? Math.round((coveredCount / total) * 10000) / 100 : 0;
    return { coveredCount, completionRate, totalVariantCount: total };
  }

  const before = computeCoverage(members, activeIds);

  const simulatedMembers = members.map(m => ({ ...m, owned: new Set(m.owned) }));

  for (const change of changes) {
    if (!change || !change.type) continue;
    switch (change.type) {
      case "acquire": {
        const targetId = String(change.memberId);
        const variantIds = toVariantIdList(change.variantIds);
        const m = simulatedMembers.find(x => String(x.userId) === targetId);
        if (m) {
          for (const vid of variantIds) {
            if (activeIds.has(vid)) m.owned.add(vid);
          }
        }
        break;
      }
      case "join": {
        const variantIds = toVariantIdList(change.ownedVariantIds);
        const owned = new Set();
        for (const vid of variantIds) {
          if (activeIds.has(vid)) owned.add(vid);
        }
        const userId = change.memberId || `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        simulatedMembers.push({
          userId,
          username: change.username || "Nouveau membre",
          displayName: change.displayName || change.username || "Nouveau membre",
          owned
        });
        break;
      }
      case "leave": {
        const leaveId = String(change.memberId);
        const idx = simulatedMembers.findIndex(x => String(x.userId) === leaveId);
        if (idx >= 0) simulatedMembers.splice(idx, 1);
        break;
      }
      case "unavailable": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) activeIds.delete(vid);
        break;
      }
      case "add_event": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) activeIds.add(vid);
        break;
      }
      default:
        break;
    }
  }

  const after = computeCoverage(simulatedMembers, activeIds);

  return {
    before,
    after,
    difference: {
      coveredCount: after.coveredCount - before.coveredCount,
      completionRate: Math.round((after.completionRate - before.completionRate) * 100) / 100,
      totalVariantCount: after.totalVariantCount - before.totalVariantCount
    },
    appliedChanges: changes.length
  };
}

async function getSquadWhatIfImpact(squad, reqUser, change) {
  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const validIds = new Set(activeCatalogue.map(i => i.id));

  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = [];
  const memberIds = [];
  for (const r of membersResult.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    if (!visible) continue;
    const collection = await compare.loadServerCompareCollection(r.user_id);
    const owned = new Set();
    for (const [variantId, entry] of Object.entries(collection)) {
      if (compare.compareServerIsOwned(entry.status) && validIds.has(variantId)) owned.add(variantId);
    }
    members.push({ userId: r.user_id, username: r.username, displayName: r.display_name || r.username, owned });
    memberIds.push(r.user_id);
  }

  const memberSet = new Set(members.map(m => String(m.userId)));
  const activeGoals = await pool.query(
    `SELECT id, user_id, squad_id, title, variant_id
     FROM collection_goals
     WHERE status = 'active'
       AND (squad_id = $1 OR user_id = ANY($2))`,
    [squad.id, memberIds]
  );

  function computeSnapshot(memberList, idSet) {
    const variantOwnerCount = new Map();
    for (const m of memberList) {
      for (const vid of m.owned) {
        if (!idSet.has(vid)) continue;
        variantOwnerCount.set(vid, (variantOwnerCount.get(vid) || 0) + 1);
      }
    }

    let coveredCount = 0;
    let uniqueVariantCount = 0;
    let sharedVariantCount = 0;
    let duplicatePossessionCount = 0;
    for (const count of variantOwnerCount.values()) {
      coveredCount++;
      if (count === 1) uniqueVariantCount++;
      else sharedVariantCount++;
      duplicatePossessionCount += count - 1;
    }

    const total = idSet.size;
    const completionRate = total ? Math.round((coveredCount / total) * 10000) / 100 : 0;

    let mostComplementary = null;
    const uniqueByMember = new Map();
    for (const m of memberList) {
      let unique = 0;
      for (const vid of m.owned) {
        if (idSet.has(vid) && variantOwnerCount.get(vid) === 1) unique++;
      }
      if (!mostComplementary || unique > mostComplementary.uniqueVariantCount) {
        mostComplementary = { userId: m.userId, username: m.username, displayName: m.displayName, uniqueVariantCount: unique };
      }
    }

    let bestPair = null;
    let bestCoverage = -1;
    for (let i = 0; i < memberList.length; i++) {
      for (let j = i + 1; j < memberList.length; j++) {
        const union = new Set(memberList[i].owned);
        for (const vid of memberList[j].owned) union.add(vid);
        let covered = 0;
        for (const vid of union) if (idSet.has(vid)) covered++;
        if (covered > bestCoverage) {
          bestCoverage = covered;
          bestPair = {
            members: [
              { userId: memberList[i].userId, username: memberList[i].username, displayName: memberList[i].displayName },
              { userId: memberList[j].userId, username: memberList[j].username, displayName: memberList[j].displayName }
            ],
            coveredVariantCount: covered,
            coverageRate: total ? Math.round((covered / total) * 10000) / 100 : 0
          };
        }
      }
    }

    function isGoalCompleted(goal, list) {
      if (goal.squad_id) {
        return list.some(m => m.owned.has(goal.variant_id));
      }
      const m = list.find(x => String(x.userId) === String(goal.user_id));
      return m ? m.owned.has(goal.variant_id) : false;
    }

    const goals = activeGoals.rows.map(goal => ({
      goalId: goal.id,
      title: goal.title,
      variantId: goal.variant_id,
      completed: isGoalCompleted(goal, memberList)
    }));

    return {
      coveredCount,
      totalVariantCount: total,
      completionRate,
      uniqueVariantCount,
      sharedVariantCount,
      duplicatePossessionCount,
      mostComplementaryMember: mostComplementary,
      bestPair,
      goals
    };
  }

  let activeIds = new Set(validIds);
  const simulatedMembers = members.map(m => ({ ...m, owned: new Set(m.owned) }));

  if (change && change.type) {
    switch (change.type) {
      case "acquire": {
        const targetId = String(change.memberId);
        const variantIds = toVariantIdList(change.variantIds);
        const m = simulatedMembers.find(x => String(x.userId) === targetId);
        if (m) {
          for (const vid of variantIds) if (activeIds.has(vid)) m.owned.add(vid);
        }
        break;
      }
      case "join": {
        const variantIds = toVariantIdList(change.ownedVariantIds);
        const owned = new Set();
        for (const vid of variantIds) if (activeIds.has(vid)) owned.add(vid);
        const userId = change.memberId || `sim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        simulatedMembers.push({
          userId,
          username: change.username || "Nouveau membre",
          displayName: change.displayName || change.username || "Nouveau membre",
          owned
        });
        break;
      }
      case "leave": {
        const leaveId = String(change.memberId);
        const idx = simulatedMembers.findIndex(x => String(x.userId) === leaveId);
        if (idx >= 0) simulatedMembers.splice(idx, 1);
        break;
      }
      case "unavailable": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) activeIds.delete(vid);
        break;
      }
      case "add_event": {
        const variantIds = toVariantIdList(change.variantIds);
        for (const vid of variantIds) activeIds.add(vid);
        break;
      }
    }
  }

  const before = computeSnapshot(members, activeIds);
  const after = computeSnapshot(simulatedMembers, activeIds);

  const affectedGoals = after.goals
    .map((g, i) => ({ ...g, beforeCompleted: before.goals[i].completed }))
    .filter(g => g.completed !== g.beforeCompleted);

  function diff(key) {
    return Math.round((after[key] - before[key]) * 100) / 100;
  }

  return {
    change,
    before,
    after,
    difference: {
      coveredCount: after.coveredCount - before.coveredCount,
      completionRate: Math.round((after.completionRate - before.completionRate) * 100) / 100,
      totalVariantCount: after.totalVariantCount - before.totalVariantCount,
      uniqueVariantCount: after.uniqueVariantCount - before.uniqueVariantCount,
      sharedVariantCount: after.sharedVariantCount - before.sharedVariantCount,
      duplicatePossessionCount: after.duplicatePossessionCount - before.duplicatePossessionCount
    },
    affectedGoals,
    mostComplementaryMember: {
      before: before.mostComplementaryMember,
      after: after.mostComplementaryMember
    },
    bestPair: {
      before: before.bestPair,
      after: after.bestPair
    }
  };
}

async function getSquadRecommendedGoals(squad, reqUser) {
  const membersResult = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = [];
  for (const r of membersResult.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    members.push({ userId: r.user_id, username: r.username, visible });
  }

  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const matrix = await compare.buildSquadCollectionMatrix(members, catalogueAll);
  if (matrix.length === 0) return { goals: [] };

  const visibleMembers = members.filter(m => m.visible);

  const totalVariants = matrix.length;
  const coveredVariants = matrix.filter(r => r.ownerCount > 0).length;
  const completionRate = totalVariants ? Math.round((coveredVariants / totalVariants) * 10000) / 100 : 0;

  const priorities = compare.getSquadAcquisitionPriority(matrix);
  const assignments = await compare.getSquadAcquisitionAssignments(matrix, priorities);

  const goals = [];

  // 1. Completion milestone goal
  const nextMilestone = Math.min(100, Math.ceil((completionRate + 0.01) / 5) * 5);
  if (nextMilestone > completionRate) {
    const targetCovered = Math.ceil((nextMilestone / 100) * totalVariants);
    const missingForMilestone = Math.max(0, targetCovered - coveredVariants);
    const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    goals.push({
      type: "completion_milestone",
      title: `Atteindre ${nextMilestone} % de complétion collective cette semaine`,
      target: { kind: "completion_rate", value: nextMilestone, missingVariants: missingForMilestone },
      participants: visibleMembers.map(m => ({ userId: m.userId, username: m.username })),
      deadline,
      currentProgress: completionRate,
      reason: `La squad est actuellement à ${completionRate} % de complétion. ${missingForMilestone} variante${missingForMilestone > 1 ? 's' : ''} supplémentaire${missingForMilestone > 1 ? 's' : ''} atteindraient l'objectif.`,
      expectedCollectiveGain: missingForMilestone
    });
  }

  // 2. Event-based goals
  const eventsResult = await pool.query(
    `SELECT id, name, end_date FROM events
     WHERE end_date IS NULL OR end_date > NOW() - INTERVAL '1 day'
     ORDER BY end_date NULLS LAST`
  );
  const eventGoals = [];
  for (const event of eventsResult.rows) {
    const eventVariants = matrix.filter(r => r.eventId === event.id);
    if (eventVariants.length === 0) continue;
    const missing = eventVariants.filter(r => r.ownerCount === 0 && r.unknownCount === 0);
    if (missing.length === 0) continue;
    const covered = eventVariants.filter(r => r.ownerCount > 0).length;
    const urgency = compare.classifyEventUrgency(event.end_date);
    const displayNames = missing.slice(0, 5).map(r => `${r.spriteName} ${r.variantName}`).join(", ");
    const suffix = missing.length > 5 ? ` et ${missing.length - 5} autres` : "";
    eventGoals.push({
      type: "event_variants",
      title: `Obtenir ${missing.length} variante${missing.length > 1 ? 's' : ''} encore manquante${missing.length > 1 ? 's' : ''} avant la fin de ${event.name}`,
      target: { kind: "event_variants", eventId: event.id, eventName: event.name, variantIds: missing.map(r => r.variantId), names: displayNames + suffix },
      participants: visibleMembers.map(m => ({ userId: m.userId, username: m.username })),
      deadline: event.end_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      currentProgress: eventVariants.length ? Math.round((covered / eventVariants.length) * 10000) / 100 : 0,
      urgency,
      reason: `L'événement ${event.name} est classé "${urgency.level}"${urgency.daysRemaining !== null ? ` et se termine dans ${urgency.daysRemaining} jour(s)` : ""}.`,
      expectedCollectiveGain: missing.length
    });
  }
  const levelOrder = { ending_today: 0, urgent: 1, soon: 2, normal: 3, unknown: 4, ended: 5 };
  eventGoals.sort((a, b) => (levelOrder[a.urgency.level] ?? 4) - (levelOrder[b.urgency.level] ?? 4) || b.expectedCollectiveGain - a.expectedCollectiveGain);
  goals.push(...eventGoals.slice(0, 3));

  // 3. Rarity goals for currently available variants missing from the squad
  const byRarity = new Map();
  for (const row of matrix) {
    if (row.ownerCount === 0 && row.unknownCount === 0 && compare.classifyRecommendationAvailability(row.availabilityStatus) === "available_now") {
      const rarity = row.rarity || "_none";
      if (!byRarity.has(rarity)) byRarity.set(rarity, []);
      byRarity.get(rarity).push(row);
    }
  }
  for (const [rarity, rows] of byRarity) {
    if (!rows.length) continue;
    const totalRarity = matrix.filter(r => (r.rarity || "_none") === rarity).length;
    const coveredRarity = matrix.filter(r => (r.rarity || "_none") === rarity && r.ownerCount > 0).length;
    const ends = rows.map(r => r.endDate).filter(Boolean).sort();
    const deadline = ends.length ? ends[0] : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const names = rows.slice(0, 5).map(r => `${r.spriteName} ${r.variantName}`).join(", ");
    const suffix = rows.length > 5 ? ` et ${rows.length - 5} autres` : "";
    goals.push({
      type: "rarity_completion",
      title: `Compléter toutes les variantes ${rarity} actuellement disponibles`,
      target: { kind: "rarity", rarity, variantIds: rows.map(r => r.variantId), names: names + suffix },
      participants: visibleMembers.map(m => ({ userId: m.userId, username: m.username })),
      deadline,
      currentProgress: totalRarity ? Math.round((coveredRarity / totalRarity) * 10000) / 100 : 0,
      reason: `${rows.length} variante${rows.length > 1 ? 's' : ''} ${rarity} disponible${rows.length > 1 ? 's' : ''} ne sont pas encore dans la collection collective.`,
      expectedCollectiveGain: rows.length
    });
  }

  // 4. Distributed assignment among top complementary members
  const topAssignments = assignments.filter(a => a.impactType === "collective" && a.responsible).slice(0, 5);
  if (topAssignments.length >= 1) {
    const variantIds = topAssignments.map(a => a.variantId);
    const names = topAssignments.slice(0, 5).map(a => `${a.spriteName} ${a.variantName}`).join(", ");
    const suffix = topAssignments.length > 5 ? ` et ${topAssignments.length - 5} autres` : "";
    const participants = [...new Map(topAssignments.map(a => [a.responsible.userId, a.responsible])).values()];
    const ends = topAssignments.map(a => a.endDate).filter(Boolean).sort();
    const deadline = ends.length ? ends[0] : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    goals.push({
      type: "distributed_assignment",
      title: `Répartir ${topAssignments.length} variantes manquantes entre ${participants.map(p => p.username).join(", ")}`,
      target: { kind: "variants_assignment", variantIds, names: names + suffix },
      participants,
      deadline,
      currentProgress: 0,
      reason: "Ces variantes sont manquantes de toute la squad et les membres sélectionnés sont les mieux placés pour les obtenir.",
      expectedCollectiveGain: topAssignments.length
    });
  }

  return { goals };
}

async function buildSquadCompletionMembers(squad, reqUser) {
  const membersRes = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = [];
  for (const r of membersRes.rows) {
    const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
    members.push({ userId: r.user_id, username: r.username || String(r.user_id), visible });
  }
  return members;
}

async function getSquadCompletionScope(squad, reqUser) {
  const [catalogueAll, membersRes] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squad.id])
  ]);

  const allVariantCount = catalogueAll.length;
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);

  const totalActiveMembers = [];
  const includedMembers = [];
  let excludedPrivateCollections = 0;
  let excludedInsufficientCollections = 0;

  const MIN_EXPLICIT_ENTRIES = 0;

  for (const row of membersRes.rows) {
    const memberId = row.user_id;
    totalActiveMembers.push(memberId);

    if (!(await canViewCollection(reqUser, memberId))) {
      excludedPrivateCollections++;
      continue;
    }

    if (MIN_EXPLICIT_ENTRIES > 0) {
      const collection = await compare.loadServerCompareCollection(memberId);
      const explicitCount = compare.countServerExplicitCollectionEntries(collection);
      if (explicitCount < MIN_EXPLICIT_ENTRIES) {
        excludedInsufficientCollections++;
        continue;
      }
    }

    includedMembers.push(memberId);
  }

  const includedIds = new Set(includedMembers.map(id => String(id)));
  const membersForMatrix = membersRes.rows.map(r => ({
    userId: r.user_id,
    username: String(r.user_id),
    visible: includedIds.has(String(r.user_id))
  }));
  const matrix = await compare.buildSquadCollectionMatrix(membersForMatrix, activeCatalogue);
  const completion = compare.getSquadCollectiveCompletion(matrix, squad.name);
  const averageOwnership = compare.getSquadAverageOwnership(matrix, squad.name);

  return {
    squadCode: squad.code,
    squadName: squad.name,
    catalogueVariantCount: activeCatalogue.length,
    totalActiveMembers: totalActiveMembers.length,
    activeMemberCount: totalActiveMembers.length,
    includedMemberCount: includedMembers.length,
    excludedUnreleasedVariants: allVariantCount - activeCatalogue.length,
    excludedPrivateCollections,
    excludedInsufficientCollections,
    ...completion,
    collectiveCompletionDisplay: completion.display,
    averageOwnershipRate: averageOwnership.averageOwnershipRate,
    ownedVariantsSum: averageOwnership.ownedVariantsSum,
    averageVariantCount: averageOwnership.averageVariantCount,
    averageOwnershipDisplay: averageOwnership.display
  };
}

function computeCatalogueVersion(catalogue) {
  const active = catalogue.filter(compare.isVariantReleasedAndActiveServer);
  const payload = active
    .map(i => `${i.id}|${i.availabilityStatus || ''}|${i.endDate || ''}|${i.acquisitionMethod || ''}|${i.rarity || ''}|${i.eventId || ''}`)
    .sort()
    .join("\n");
  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 8);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  return `${today}-${hash}`;
}

async function getSquadVersionedCompletionReport(squad, reqUser) {
  const [catalogueAll, members] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    buildSquadCompletionMembers(squad, reqUser)
  ]);
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const matrix = await compare.buildSquadCollectionMatrix(members, activeCatalogue);

  const includedMembers = members.filter(m => m.visible);
  const excludedPrivateCollections = members.length - includedMembers.length;

  const completion = compare.getSquadCollectiveCompletion(matrix, squad.name);
  const averageOwnership = compare.getSquadAverageOwnership(matrix, squad.name);
  const missing = compare.getSquadMissingVariants(matrix, squad.name);
  const uniqueOwners = compare.getSquadUniqueOwners(matrix);
  const shared = compare.getSquadSharedVariants(matrix);
  const mostComplementary = compare.getSquadMostComplementaryMember(matrix, squad.name);
  const pairs = await getSquadComplementaryPairs(squad, reqUser);
  const bestPair = pairs[0] || null;

  const recommendedGoals = await getSquadRecommendedGoals(squad, reqUser);
  const bestTeam = await getSquadBestTeams(squad, reqUser, 3, "global");

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
  const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
  const priorityIds = new Set(priorities.map(p => p.variantId).filter(Boolean));
  const assignments = await compare.getSquadAcquisitionAssignments(matrix, priorities, activeGoalCounts, lastActiveByUser, {
    excludedSeasonIds: new Set(),
    activeGoalVariantCounts,
    memberGoalVariantSet,
    maxGoalAssignments: 2
  });

  const allVariants = matrix.map(r => ({
    variantId: r.variantId,
    spriteId: r.spriteId,
    spriteName: r.spriteName,
    variantName: r.variantName,
    variantType: r.variantType,
    img: r.img,
    rarity: r.rarity,
    seasonId: r.seasonId,
    eventId: r.eventId,
    availabilityStatus: r.availabilityStatus,
    ownerCount: r.ownerCount,
    missingCount: r.missingCount,
    unknownCount: r.unknownCount,
    isMissingAll: r.ownerCount === 0 && r.unknownCount === 0,
    isUniqueOwner: r.ownerCount === 1,
    isDuplicate: r.ownerCount >= 2,
    isPriority: priorityIds.has(r.variantId),
    isAvailableNow: r.availabilityStatus === "available"
  }));

  const unknownCount = matrix.reduce((sum, r) => sum + r.unknownCount, 0);
  const warnings = [];
  if (members.length === 0) warnings.push("Aucun membre actif dans l'escouade.");
  if (activeCatalogue.length === 0) warnings.push("Aucune variante active dans le catalogue.");
  if (excludedPrivateCollections > 0) {
    const plural = excludedPrivateCollections > 1;
    warnings.push(`Les calculs utilisent ${includedMembers.length} collection${includedMembers.length > 1 ? 's' : ''} sur ${members.length}. ${excludedPrivateCollections} collection${plural ? 's' : ''} privée${plural ? 's' : ''} ${plural ? 'sont' : 'est'} exclue${plural ? 's' : ''} pour confidentialité.`);
  }
  if (unknownCount > activeCatalogue.length * 0.25) warnings.push("Plus de 25 % des collections sont inconnues, les statistiques peuvent être sous-estimées.");

  return {
    engineVersion: "2.0.0",
    generatedAt: new Date().toISOString(),
    squadId: squad.code,
    catalogueVersion: computeCatalogueVersion(catalogueAll),
    summary: {
      squadCode: squad.code,
      squadName: squad.name,
      catalogueVariantCount: activeCatalogue.length,
      totalActiveMembers: members.length,
      includedMemberCount: includedMembers.length,
      excludedPrivateCollections,
      collectiveCompletionRate: completion.collectiveCompletionRate,
      coveredVariantCount: completion.coveredVariantCount,
      averageOwnershipRate: averageOwnership.averageOwnershipRate,
      totalMissing: missing.totalMissing,
      totalUnique: uniqueOwners.totalUnique,
      totalShared: shared.totalShared
    },
    analysis: {
      completion,
      averageOwnership,
      missing,
      uniqueOwners,
      shared,
      mostComplementaryMember: mostComplementary,
      bestPair,
      allVariants
    },
    recommendations: {
      activeGoalCount: activeGoalVariantIds.size,
      priorities,
      assignments,
      recommendedGoals: recommendedGoals.goals
    },
    optimization: {
      bestTeam,
      bestTeamSummary: bestTeam.teams.length
        ? `Meilleure équipe de ${bestTeam.teamSize} : ${bestTeam.teams[0].coverageRate}% de couverture.`
        : "Aucune équipe trouvée."
    },
    warnings
  };
}

// ── Squad : complementary member pairs ──
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
app.post("/api/squads/:code/simulate-acquisition", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const memberId = req.body.memberId;
    let acquireVariantIds = req.body.acquireVariantIds;

    if (!memberId) {
      return res.status(400).json({ error: "memberId requis" });
    }
    if (!acquireVariantIds) {
      return res.status(400).json({ error: "acquireVariantIds requis" });
    }

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
app.post("/api/squads/:code/simulate", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
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
app.post("/api/squads/:code/what-if", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const change = req.body.change || req.body;
    if (!change || !change.type) {
      return res.status(400).json({ error: "change.type requis" });
    }

    const result = await getSquadWhatIfImpact(squad, reqUser, change);
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

    const members = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

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

    const matrixMembers = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

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
app.post("/api/squads/:squadId/completion/simulate", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await getSquadByIdOrCode(req.params.squadId);
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (!(await requireSquadMember(req, res, squad.id))) return;

    const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
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
app.get("/api/squads/:code/matrix", async (req, res) => {
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

    const members = [];
    for (const row of membersResult.rows) {
      const visible = String(row.user_id) === String(reqUser) || await canViewCollection(reqUser, row.user_id);
      members.push({
        userId: row.user_id,
        username: row.username || String(row.user_id),
        visible
      });
    }

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "legacy-matrix", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const publicMatrix = matrix.map(row => {
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

    const members = [];
    for (const row of membersResult.rows) {
      const visible = String(row.user_id) === String(reqUser) || await canViewCollection(reqUser, row.user_id);
      members.push({
        userId: row.user_id,
        username: row.username || String(row.user_id),
        visible
      });
    }

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

    const members = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

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

    const members = membersResult.rows.map(r => ({
      userId: r.user_id,
      username: r.username || String(r.user_id),
      visible: true
    }));

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
app.delete("/api/squads/:code", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
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
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
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

    const members = [];
    for (const r of membersResult.rows) {
      const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
      members.push({ userId: r.user_id, username: r.username || String(r.user_id), visible });
    }
    const memberIds = members.map(m => m.userId);

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

    const excludedSeasonIds = new Set(
      String(req.query.excludeSeason || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    );

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "acquisition-priority", async () => {
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
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
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
    if (!membersResult.rows.some(r => String(r.user_id) === String(targetUserId))) {
      return res.status(404).json({ error: "Membre introuvable dans l'escouade" });
    }

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "member-recommendations", async () => {
      const members = [];
      for (const r of membersResult.rows) {
        const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
        members.push({ userId: r.user_id, username: r.username || String(r.user_id), visible });
      }
      const memberIds = members.map(m => m.userId);

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

      const activeGoalVariantIds = new Set(goalsResult.rows.map(r => r.variant_id).filter(Boolean));
      const activeGoalVariantCounts = new Map();
      const memberGoalVariantSet = new Set();
      for (const r of goalsResult.rows) {
        if (!r.variant_id) continue;
        memberGoalVariantSet.add(`${r.user_id}:${r.variant_id}`);
        activeGoalVariantCounts.set(r.variant_id, (activeGoalVariantCounts.get(r.variant_id) || 0) + 1);
      }

      const activeGoalCounts = new Map(memberGoalsResult.rows.map(r => [String(r.user_id), parseInt(r.cnt, 10)]));
      const lastActiveByUser = new Map(lastActiveResult.rows.map(r => [String(r.user_id), r.last_active]));

      const excludedSeasonIds = new Set(
        String(req.query.excludeSeason || "")
          .split(",")
          .map(s => s.trim())
          .filter(Boolean)
      );

      const matrix = await compare.buildSquadCollectionMatrix(members);
      const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
      const assignments = await compare.getSquadAcquisitionAssignments(matrix, priorities, activeGoalCounts, lastActiveByUser, {
        excludedSeasonIds,
        activeGoalVariantCounts,
        memberGoalVariantSet,
        maxGoalAssignments: 2
      });

      const recommendations = compare.getSquadMemberRecommendations(matrix, assignments, targetUserId);
      const targetRow = membersResult.rows.find(r => String(r.user_id) === String(targetUserId));

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
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
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

    const members = [];
    for (const r of membersResult.rows) {
      const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
      members.push({ userId: r.user_id, username: r.username || String(r.user_id), visible });
    }
    const memberIds = members.map(m => m.userId);

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

    const activeGoalVariantIds = new Set(goalsResult.rows.map(r => r.variant_id).filter(Boolean));
    const activeGoalVariantCounts = new Map();
    const memberGoalVariantSet = new Set();
    for (const r of goalsResult.rows) {
      if (!r.variant_id) continue;
      memberGoalVariantSet.add(`${r.user_id}:${r.variant_id}`);
      activeGoalVariantCounts.set(r.variant_id, (activeGoalVariantCounts.get(r.variant_id) || 0) + 1);
    }

    const activeGoalCounts = new Map(memberGoalsResult.rows.map(r => [String(r.user_id), parseInt(r.cnt, 10)]));
    const lastActiveByUser = new Map(lastActiveResult.rows.map(r => [String(r.user_id), r.last_active]));

    const excludedSeasonIds = new Set(
      String(req.query.excludeSeason || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    );

    const response = await getCachedOrComputeSquadAnalysis(req, squad, reqUser, "collective-plan", async () => {
      const matrix = await compare.buildSquadCollectionMatrix(members);
      const priorities = compare.getSquadAcquisitionPriority(matrix, activeGoalVariantIds);
      const assignments = await compare.getSquadAcquisitionAssignments(matrix, priorities, activeGoalCounts, lastActiveByUser, {
        excludedSeasonIds,
        activeGoalVariantCounts,
        memberGoalVariantSet,
        maxGoalAssignments: 2
      });

      const plan = compare.getSquadCollectivePlan(matrix, assignments);

      return {
        squadCode: squad.code,
        squadName: squad.name,
        totalCollectiveGain: plan.totalCollectiveGain,
        summary: `Ce plan permettrait d'ajouter jusqu'à ${plan.totalCollectiveGain} variante${plan.totalCollectiveGain > 1 ? 's' : ''} unique${plan.totalCollectiveGain > 1 ? 's' : ''} à la couverture collective.`,
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
    const squadResult = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [req.params.code.trim().toUpperCase()]);
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

    const targetRow = membersResult.rows.find(r => String(r.user_id) === String(targetUserId));
    if (!targetRow) return res.status(404).json({ error: "Membre introuvable dans l'escouade" });

    const members = [];
    for (const r of membersResult.rows) {
      const visible = String(r.user_id) === String(reqUser) || await canViewCollection(reqUser, r.user_id);
      members.push({ userId: r.user_id, username: r.username || String(r.user_id), visible });
    }

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
app.get("/squad/join/:code", (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  res.redirect(`/?joinSquad=${encodeURIComponent(code)}`);
});

module.exports = { generateSquadCode };
