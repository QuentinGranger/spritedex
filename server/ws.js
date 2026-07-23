// ws.js — extracted from server.js

const { validateSession, canViewCollection } = require("./auth");
const { wss } = require("./core");
const { Pool } = require("pg");
const compare = require("./compare");

// ── WebSocket : client registry ──
// Maps userId (string) -> Set of ws clients
const wsClients = new Map();

wss.on("connection", (ws) => {
  ws._userId = null;
  ws._alive = true;

  ws.on("message", (raw) => {
    // Cap inbound WS message size to avoid memory abuse.
    if (typeof raw === "string" ? raw.length > 4096 : raw.length > 4096) return;
    (async () => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === "auth") {
          // SECURITY: derive the WS identity from a valid session token, never
          // from a client-supplied userId. Otherwise anyone could subscribe as
          // any user and infer their squad activity from update pings.
          const userId = msg.token ? await validateSession(msg.token) : null;
          if (!userId) {
            try { ws.send(JSON.stringify({ type: "auth_error" })); } catch {}
            return;
          }
          ws._userId = String(userId);
          if (!wsClients.has(ws._userId)) wsClients.set(ws._userId, new Set());
          wsClients.get(ws._userId).add(ws);
        } else if (msg.type === "compare_subscribe" && msg.targetUserId) {
          ws._compareTarget = String(msg.targetUserId);
        } else if (msg.type === "compare_unsubscribe") {
          ws._compareTarget = null;
        } else if (msg.type === "squad_subscribe" && msg.squadCode && ws._userId) {
          const code = String(msg.squadCode).trim().toUpperCase();
          const member = await pool.query(
            `SELECT 1 FROM squad_members sm
             JOIN squads s ON s.id = sm.squad_id
             WHERE s.code = $1 AND sm.user_id = $2 AND sm.status = 'active'`,
            [code, ws._userId]
          );
          if (member.rows.length) {
            if (!ws._squadCodes) ws._squadCodes = new Set();
            ws._squadCodes.add(code);
          }
        } else if (msg.type === "squad_unsubscribe" && msg.squadCode) {
          if (ws._squadCodes) {
            ws._squadCodes.delete(String(msg.squadCode).trim().toUpperCase());
          }
        }
      } catch {}
    })();
  });

  ws.on("pong", () => { ws._alive = true; });

  ws.on("close", () => {
    if (ws._userId && wsClients.has(ws._userId)) {
      wsClients.get(ws._userId).delete(ws);
      if (wsClients.get(ws._userId).size === 0) wsClients.delete(ws._userId);
    }
  });
});

// Heartbeat every 30s
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws._alive) return ws.terminate();
    ws._alive = false;
    ws.ping();
  });
}, 30000);

// Broadcast squad update to all members of a user's squads
async function broadcastSquadUpdate(userId) {
  try {
    const squadsResult = await pool.query(
      `SELECT s.code FROM squads s
       JOIN squad_members sm ON sm.squad_id = s.id
       WHERE sm.user_id = $1 AND sm.status = 'active'`,
      [userId]
    );
    for (const row of squadsResult.rows) {
      const membersResult = await pool.query(
        `SELECT sm.user_id FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE s.code = $1 AND sm.status = 'active'`,
        [row.code]
      );
      const payload = JSON.stringify({ type: "squad_update", code: row.code });
      for (const member of membersResult.rows) {
        const mId = String(member.user_id);
        if (mId === String(userId)) continue;
        const sockets = wsClients.get(mId);
        if (sockets) {
          for (const ws of sockets) {
            if (ws.readyState === 1) ws.send(payload);
          }
        }
      }
    }
  } catch (e) {
    console.warn("broadcastSquadUpdate error", e);
  }
}

// Build per-member completion summaries for a squad.
// Returns a Map viewerUserId -> summary object.
async function getSquadCompletionSummaryForAll(squad) {
  const membersRes = await pool.query(
    `SELECT sm.user_id, u.username, u.display_name
     FROM squad_members sm
     JOIN users u ON u.id = sm.user_id
     WHERE sm.squad_id = $1 AND sm.status = 'active'`,
    [squad.id]
  );

  const members = membersRes.rows.map(r => ({
    userId: r.user_id,
    username: r.username || String(r.user_id)
  }));

  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const activeCatalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const allMembers = members.map(m => ({ ...m, visible: true }));
  const allMatrix = await compare.buildSquadCollectionMatrix(allMembers, activeCatalogue);

  const visibility = new Map();
  await Promise.all(members.flatMap(viewer => members.map(async member => {
    const key = `${viewer.userId}:${member.userId}`;
    if (String(viewer.userId) === String(member.userId)) {
      visibility.set(key, true);
      return;
    }
    visibility.set(key, await canViewCollection(viewer.userId, member.userId));
  })));

  const { computeCatalogueVersion } = require("./squad-analysis-cache");
  const catalogueVersion = computeCatalogueVersion(catalogueAll);
  const generatedAt = new Date().toISOString();

  const summaries = new Map();
  for (const viewer of members) {
    const viewerKey = String(viewer.userId);
    const memberVisibility = members.map(m =>
      String(m.userId) === viewerKey || visibility.get(`${viewerKey}:${m.userId}`)
    );

    const derivedMatrix = allMatrix.map(row => {
      let ownerCount = 0;
      let missingCount = 0;
      let unknownCount = 0;
      const owners = [];
      const missingMembers = [];
      const unknownMembers = [];
      const maskedMembers = row.members.map((m, idx) => {
        const visible = memberVisibility[idx];
        if (!visible) {
          unknownCount++;
          unknownMembers.push(m.username);
          return { ...m, status: "unknown", priority: "none", note: "", classification: "unknown", visible: false };
        }
        if (m.classification === "owned") { ownerCount++; owners.push(m.username); }
        else if (m.classification === "missing") { missingCount++; missingMembers.push(m.username); }
        else { unknownCount++; unknownMembers.push(m.username); }
        return { ...m, visible: true };
      });

      return {
        ...row,
        ownerCount,
        missingCount,
        unknownCount,
        owners,
        missingMembers,
        unknownMembers,
        members: maskedMembers
      };
    });

    const completion = compare.getSquadCollectiveCompletion(derivedMatrix, squad.name);
    const averageOwnership = compare.getSquadAverageOwnership(derivedMatrix, squad.name);
    const missing = compare.getSquadMissingVariants(derivedMatrix, squad.name);
    const uniqueOwners = compare.getSquadUniqueOwners(derivedMatrix);
    const shared = compare.getSquadSharedVariants(derivedMatrix);
    const mostComplementary = compare.getSquadMostComplementaryMember(derivedMatrix, squad.name);

    const includedMembers = members.filter((_, idx) => memberVisibility[idx]);

    summaries.set(viewerKey, {
      squadCode: squad.code,
      squadName: squad.name,
      catalogueVariantCount: activeCatalogue.length,
      catalogueVersion,
      generatedAt,
      totalActiveMembers: members.length,
      includedMemberCount: includedMembers.length,
      excludedPrivateCollections: members.length - includedMembers.length,
      collectiveCompletionRate: completion.collectiveCompletionRate,
      coveredVariantCount: completion.coveredVariantCount,
      averageOwnershipRate: averageOwnership.averageOwnershipRate,
      totalMissing: missing.totalMissing,
      totalUnique: uniqueOwners.totalUnique,
      totalShared: shared.totalShared,
      mostComplementaryMember: mostComplementary ? {
        userId: mostComplementary.userId,
        username: mostComplementary.username,
        uniqueVariantCount: mostComplementary.uniqueVariantCount
      } : null
    });
  }

  return summaries;
}

// Broadcast a server-computed completion summary to all active squad members.
async function broadcastSquadCompletionUpdate(userId) {
  try {
    const squadsResult = await pool.query(
      `SELECT s.id, s.code, s.name FROM squads s
       JOIN squad_members sm ON sm.squad_id = s.id
       WHERE sm.user_id = $1 AND sm.status = 'active'`,
      [userId]
    );

    for (const row of squadsResult.rows) {
      const summaries = await getSquadCompletionSummaryForAll({ id: row.id, code: row.code, name: row.name });
      for (const [viewerId, summary] of summaries) {
        const sockets = wsClients.get(viewerId);
        if (!sockets) continue;
        const payload = JSON.stringify({ type: "squad_completion_update", code: row.code, summary });
        for (const ws of sockets) {
          if (ws.readyState === 1) ws.send(payload);
        }
      }
    }
  } catch (e) {
    console.warn("broadcastSquadCompletionUpdate error", e);
  }
}

// Broadcast a collection update to the user's own sockets and to anyone
// currently comparing with that user.
function broadcastCompareUpdate(userId, payload) {
  try {
    const uid = String(userId);
    const data = JSON.stringify({ ...payload, userId: uid });
    if (!wss || !wss.clients) return;
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      if (ws._userId === uid || ws._compareTarget === uid) {
        try { ws.send(data); } catch {}
      }
    }
  } catch (e) {
    console.warn("broadcastCompareUpdate error", e);
  }
}

// Enable TLS for any non-local database (Render, Railway, Neon, Supabase, …).
// Managed providers use certs not in Node's trust store, so we relax
// rejectUnauthorized. Disable explicitly with PGSSL=disable if needed.
function shouldUseSSL(url) {
  if (!url) return false;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  if (process.env.PGSSL === "disable") return false;
  return true;
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false
    })
  : new Pool({
      database: "spritedex",
      host: "localhost",
      port: 5432,
    });

// Broadcast a goal update to the goal owner and all active squad members.
async function broadcastGoalUpdate(goal, updateType, squadCode = null) {
  try {
    if (!goal || !goal.id) return;

    let code = squadCode;
    if (!code && goal.squad_id) {
      const squadRes = await pool.query("SELECT code FROM squads WHERE id = $1", [goal.squad_id]);
      code = squadRes.rows[0]?.code || null;
    }

    const payload = JSON.stringify({
      type: "goal_update",
      updateType,
      goalId: goal.id,
      title: goal.title || null,
      description: goal.description || null,
      variantId: goal.variant_id || null,
      squadId: goal.squad_id || null,
      squadCode: code,
      userId: goal.user_id || null,
      status: goal.status || null,
      createdAt: goal.created_at || null,
      updatedAt: goal.updated_at || null,
      timestamp: new Date().toISOString()
    });

    const targetIds = new Set();
    if (goal.user_id) targetIds.add(String(goal.user_id));
    if (goal.squad_id) {
      const membersRes = await pool.query(
        "SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'",
        [goal.squad_id]
      );
      for (const row of membersRes.rows) targetIds.add(String(row.user_id));
    }

    for (const [uid, sockets] of wsClients) {
      if (!targetIds.has(uid)) continue;
      for (const ws of sockets) {
        if (ws.readyState === 1) ws.send(payload);
      }
    }

    if (code) {
      for (const ws of wss.clients) {
        if (ws.readyState === 1 && ws._squadCodes && ws._squadCodes.has(code)) {
          ws.send(payload);
        }
      }
    }
  } catch (e) {
    console.warn("broadcastGoalUpdate error", e);
  }
}

// Broadcast news and extracted events to all connected clients.
function broadcastNewsUpdate(payload) {
  try {
    const data = JSON.stringify({ type: "news_update", ...payload });
    if (!wss || !wss.clients) return;
    for (const ws of wss.clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  } catch (e) {
    console.warn("broadcastNewsUpdate error", e);
  }
}

module.exports = { broadcastCompareUpdate, broadcastGoalUpdate, broadcastNewsUpdate, broadcastSquadUpdate, broadcastSquadCompletionUpdate, pool, shouldUseSSL, wsClients };
