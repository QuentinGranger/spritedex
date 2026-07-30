// ws.js — extracted from server.js

const { validateSession, canViewCollection, hashSessionToken } = require("./auth");
const { wss } = require("./core");
const { pool, shouldUseSSL } = require("./db");
const compare = require("./compare");
const security = require("../security");

// ── WebSocket : client registry ──
// Maps userId (string) -> Set of ws clients
const wsClients = new Map();
// Maps a hashed session token to every socket authenticated with it. Raw
// bearer tokens are deliberately never retained in a long-lived WS object.
const sessionSockets = new Map();

const WS_MAX_PAYLOAD_BYTES = 4 * 1024;
const WS_AUTH_TIMEOUT_MS = 10 * 1000;
const WS_SESSION_REVALIDATION_MS = 30 * 1000;
// A browser normally sends only auth/subscription frames on this channel.
// Bound both the rate and the serial promise queue so a client that floods
// many individually-valid 4 KiB frames cannot retain an unbounded backlog
// before the asynchronous handler gets a chance to run.
const WS_MESSAGE_WINDOW_MS = 10 * 1000;
const WS_MAX_MESSAGES_PER_WINDOW = 30;
const WS_MAX_QUEUED_MESSAGES = 16;
const WS_POLICY_VIOLATION_CLOSE_CODE = 1008;
const allowedWsOrigins = new Set(security.resolveCorsOrigins());

function isAllowedWebSocketOrigin(origin) {
  // Browser WebSocket handshakes always carry Origin. Reject missing or
  // malformed values too: accepting them would create a cross-site endpoint
  // outside the application's established CORS policy.
  return typeof origin === "string" && allowedWsOrigins.has(origin);
}

// `ws` otherwise accepts frames up to 100 MiB and rejects them only after
// buffering. This module is loaded before server.listen(), so updating the
// server options here applies to every subsequent upgrade without changing
// the shared core bootstrap.
wss.options.maxPayload = WS_MAX_PAYLOAD_BYTES;
wss.options.verifyClient = ({ origin }) => isAllowedWebSocketOrigin(origin);

function removeSocketFromRegistry(ws) {
  if (ws._authTimeout) {
    clearTimeout(ws._authTimeout);
    ws._authTimeout = null;
  }

  const userId = ws._userId;
  if (userId && wsClients.has(userId)) {
    const sockets = wsClients.get(userId);
    sockets.delete(ws);
    if (sockets.size === 0) wsClients.delete(userId);
  }

  const sessionHash = ws._sessionTokenHash;
  if (sessionHash && sessionSockets.has(sessionHash)) {
    const sockets = sessionSockets.get(sessionHash);
    sockets.delete(ws);
    if (sockets.size === 0) sessionSockets.delete(sessionHash);
  }

  ws._userId = null;
  ws._sessionTokenHash = null;
  ws._compareTarget = null;
  if (ws._squadCodes) ws._squadCodes.clear();
}

function closeWebSocket(ws, reason = "Authorization required") {
  removeSocketFromRegistry(ws);
  if (ws.readyState !== 0 && ws.readyState !== 1) return;
  try {
    ws.close(WS_POLICY_VIOLATION_CLOSE_CODE, reason);
  } catch {
    try { ws.terminate(); } catch {}
  }
}

function acceptInboundMessage(ws) {
  const now = Date.now();
  if (now - (ws._messageWindowStartedAt || 0) >= WS_MESSAGE_WINDOW_MS) {
    ws._messageWindowStartedAt = now;
    ws._messageCount = 0;
  }
  ws._messageCount = (ws._messageCount || 0) + 1;
  if (ws._messageCount > WS_MAX_MESSAGES_PER_WINDOW) return false;
  if ((ws._pendingMessageCount || 0) >= WS_MAX_QUEUED_MESSAGES) return false;
  ws._pendingMessageCount = (ws._pendingMessageCount || 0) + 1;
  return true;
}

function registerAuthenticatedSocket(ws, userId, token) {
  // Re-authentication on the same socket used to leave it registered under
  // the old identity. A connection has one immutable identity instead.
  if (ws._userId || ws._sessionTokenHash) {
    closeWebSocket(ws, "Re-authentication is not allowed");
    return false;
  }

  const sessionHash = hashSessionToken(token);
  if (!sessionHash) {
    closeWebSocket(ws, "Invalid session");
    return false;
  }

  ws._userId = String(userId);
  ws._sessionTokenHash = sessionHash;
  ws._sessionLastCheckedAt = Date.now();
  if (ws._authTimeout) {
    clearTimeout(ws._authTimeout);
    ws._authTimeout = null;
  }

  if (!wsClients.has(ws._userId)) wsClients.set(ws._userId, new Set());
  wsClients.get(ws._userId).add(ws);
  if (!sessionSockets.has(sessionHash)) sessionSockets.set(sessionHash, new Set());
  sessionSockets.get(sessionHash).add(ws);
  return true;
}

async function isSessionStillValid(sessionHash, userId) {
  if (!sessionHash || !userId) return false;
  const result = await pool.query(
    `SELECT 1
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1
       AND s.user_id = $2
       AND s.expires_at > NOW()
       AND u.deleted_at IS NULL
       AND (u.suspended_until IS NULL OR u.suspended_until <= NOW())
     LIMIT 1`,
    [sessionHash, userId]
  );
  return result.rows.length > 0;
}

async function revalidateSocketAuthorization(ws, { force = false } = {}) {
  if (!ws._userId || !ws._sessionTokenHash || ws._sessionCheckInFlight) return false;
  const now = Date.now();
  if (!force && now - (ws._sessionLastCheckedAt || 0) < WS_SESSION_REVALIDATION_MS) return true;

  ws._sessionCheckInFlight = true;
  try {
    const stillValid = await isSessionStillValid(ws._sessionTokenHash, ws._userId);
    if (!stillValid) {
      closeWebSocket(ws, "Session expired");
      return false;
    }
    ws._sessionLastCheckedAt = now;

    // Permissions can change after subscription (privacy toggle, block,
    // leaving/kicking from a squad). Do not keep a formerly valid stream.
    if (ws._compareTarget && !(await canViewCollection(ws._userId, ws._compareTarget))) {
      ws._compareTarget = null;
    }
    if (ws._squadCodes?.size) {
      const subscribedCodes = [...ws._squadCodes];
      const memberResult = await pool.query(
        `SELECT s.code
         FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE sm.user_id = $1
           AND sm.status = 'active'
           AND s.code = ANY($2::text[])`,
        [ws._userId, subscribedCodes]
      );
      const activeCodes = new Set(memberResult.rows.map(row => row.code));
      for (const code of subscribedCodes) {
        if (!activeCodes.has(code)) ws._squadCodes.delete(code);
      }
    }
    return true;
  } catch (err) {
    // If the session store cannot be checked, fail closed rather than keep a
    // possibly revoked bearer session authorized to receive private updates.
    console.warn("[ws] session revalidation failed:", err.message);
    closeWebSocket(ws, "Session validation failed");
    return false;
  } finally {
    ws._sessionCheckInFlight = false;
  }
}

// Called by the logout/revocation path with the *raw* bearer token. This is
// intentionally scoped to that session only, so other devices stay connected.
function revokeSessionSockets(token, reason = "Session revoked") {
  const sessionHash = hashSessionToken(token);
  if (!sessionHash) return 0;
  const sockets = [...(sessionSockets.get(sessionHash) || [])];
  for (const ws of sockets) closeWebSocket(ws, reason);
  return sockets.length;
}

// Used when the account itself is suspended or deleted. Unlike session
// revocation, this intentionally closes every device/session for that user.
function revokeUserSockets(userId, reason = "Account access revoked") {
  if (userId == null) return 0;
  const sockets = [...(wsClients.get(String(userId)) || [])];
  for (const ws of sockets) closeWebSocket(ws, reason);
  return sockets.length;
}

wss.on("connection", (ws) => {
  ws._userId = null;
  ws._sessionTokenHash = null;
  ws._sessionLastCheckedAt = 0;
  ws._sessionCheckInFlight = false;
  ws._alive = true;
  ws._messageWindowStartedAt = Date.now();
  ws._messageCount = 0;
  ws._pendingMessageCount = 0;
  // Process inbound messages strictly in order per connection. Without this,
  // each message ran in its own async IIFE, so a `compare_subscribe` could be
  // handled before the preceding `auth` finished awaiting validateSession(),
  // leaving ws._userId still null and defeating the authorization check below.
  ws._msgQueue = Promise.resolve();

  const authTimeout = setTimeout(() => {
    if (!ws._userId) closeWebSocket(ws, "Authentication timed out");
  }, WS_AUTH_TIMEOUT_MS);
  if (typeof authTimeout.unref === "function") authTimeout.unref();
  ws._authTimeout = authTimeout;

  async function handleMessage(raw, isBinary) {
    // `maxPayload` above enforces this before buffering; reject binary frames
    // as the protocol accepts compact JSON text only.
    if (isBinary || Buffer.byteLength(raw) > WS_MAX_PAYLOAD_BYTES) {
      closeWebSocket(ws, "Invalid message");
      return;
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "auth") {
      // SECURITY: derive the WS identity from a valid session token, never
      // from a client-supplied userId. Otherwise anyone could subscribe as
      // any user and infer their squad activity from update pings.
      const userId = msg.token ? await validateSession(msg.token) : null;
      const sessionHash = hashSessionToken(msg.token);
      // A suspension is a live-access freeze, not a session deletion: the
      // same bearer remains usable for the dedicated unsuspend endpoint, but
      // cannot establish or retain a private realtime channel.
      const sessionUsable = userId && sessionHash
        ? await isSessionStillValid(sessionHash, userId)
        : false;
      if (!sessionUsable) {
        try { ws.send(JSON.stringify({ type: "auth_error" })); } catch {}
        closeWebSocket(ws, "Invalid or suspended session");
        return;
      }
      registerAuthenticatedSocket(ws, userId, msg.token);
      recordPresence(ws).catch(() => {});
    } else if (msg.type === "presence_ping" && ws._userId) {
      recordPresence(ws).catch(() => {});
    } else if (msg.type === "compare_subscribe" && msg.targetUserId) {
      // SECURITY: live compare updates carry private data (status, priority,
      // notes). Only authenticated users allowed to view the target's
      // collection may subscribe — otherwise anyone could stream any user's
      // private collection changes just by knowing their id.
      const target = String(msg.targetUserId);
      if (!ws._userId) {
        try { ws.send(JSON.stringify({ type: "compare_error", reason: "auth_required" })); } catch {}
        return;
      }
      const allowed = ws._userId === target || await canViewCollection(ws._userId, target);
      if (!allowed) {
        ws._compareTarget = null;
        try { ws.send(JSON.stringify({ type: "compare_error", reason: "forbidden" })); } catch {}
        return;
      }
      ws._compareTarget = target;
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
  }

  ws.on("message", (raw, isBinary) => {
    if (!acceptInboundMessage(ws)) {
      closeWebSocket(ws, "Message rate limit exceeded");
      return;
    }
    ws._msgQueue = ws._msgQueue
      .then(() => handleMessage(raw, isBinary))
      .catch(() => {})
      .finally(() => {
        ws._pendingMessageCount = Math.max(0, (ws._pendingMessageCount || 1) - 1);
      });
  });

  ws.on("pong", () => { ws._alive = true; });

  // Oversized/malformed frames emit `error` in ws. Listening prevents an
  // attacker from turning the new maxPayload limit into an unhandled error.
  ws.on("error", () => removeSocketFromRegistry(ws));

  ws.on("close", () => removeSocketFromRegistry(ws));
});

// Heartbeat every 30s
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return;
    if (!ws._alive) {
      removeSocketFromRegistry(ws);
      return ws.terminate();
    }
    revalidateSocketAuthorization(ws).catch(() => {});
    ws._alive = false;
    ws.ping();
  });
}, 30000);
if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

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

// Broadcast a collection update to the owner's sockets and to viewers whose
// collection access is still valid at delivery time. A subscribe-time check
// alone is insufficient: privacy and friendship/block state can change later.
async function broadcastCompareUpdate(userId, payload) {
  try {
    const uid = String(userId);
    const data = JSON.stringify({ ...payload, userId: uid });
    if (!wss || !wss.clients) return;
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      if (ws._userId === uid) {
        try { ws.send(data); } catch {}
        continue;
      }
      if (ws._compareTarget !== uid || !ws._userId) continue;
      try {
        if (await canViewCollection(ws._userId, uid)) {
          ws.send(data);
        } else {
          ws._compareTarget = null;
        }
      } catch {
        // Never deliver private collection changes if authorization cannot be
        // checked; a later explicit subscription can retry after recovery.
        ws._compareTarget = null;
      }
    }
  } catch (e) {
    console.warn("broadcastCompareUpdate error", e);
  }
}

// Tell a user that their social list must be refreshed. The message carries no
// relationship or collection data, so every client still obtains the current,
// privacy-filtered view through the normal authenticated REST endpoint.
function broadcastFriendsUpdate(userIds, reason = "relationship") {
  const ids = new Set((Array.isArray(userIds) ? userIds : [userIds])
    .filter((id) => id != null)
    .map((id) => String(id)));
  if (!ids.size) return;
  const payload = JSON.stringify({ type: "friends_update", reason, timestamp: new Date().toISOString() });
  for (const userId of ids) {
    const sockets = wsClients.get(userId);
    if (!sockets) continue;
    for (const ws of sockets) {
      if (ws.readyState === 1) {
        try { ws.send(payload); } catch {}
      }
    }
  }
}

// A collection update changes completion and complementarity in the friends
// screen. Resolve accepted friends at send time so a removed/blocked user is
// never notified from a stale in-memory relationship.
async function broadcastFriendCollectionUpdate(ownerId, reason = "collection") {
  try {
    const result = await pool.query(
      `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS user_id
       FROM friendships
       WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
      [ownerId]
    );
    broadcastFriendsUpdate([ownerId, ...result.rows.map((row) => row.user_id)], reason);
  } catch (err) {
    console.warn("broadcastFriendCollectionUpdate error", err);
  }
}

async function recordPresence(ws) {
  const now = Date.now();
  if (!ws._userId || (ws._presenceLastSeenAt && now - ws._presenceLastSeenAt < 30000)) return;
  ws._presenceLastSeenAt = now;
  await pool.query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [ws._userId]);
  await broadcastFriendCollectionUpdate(ws._userId, "presence");
}

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
    const activeSquadMemberIds = new Set();
    if (goal.user_id) targetIds.add(String(goal.user_id));
    if (goal.squad_id) {
      const membersRes = await pool.query(
        "SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'",
        [goal.squad_id]
      );
      for (const row of membersRes.rows) {
        const memberId = String(row.user_id);
        targetIds.add(memberId);
        activeSquadMemberIds.add(memberId);
      }
    } else if (code) {
      // A caller can provide a squad code even if the goal row has no squad
      // id. Resolve membership afresh rather than trusting a stale WS
      // `squad_subscribe` flag.
      const membersRes = await pool.query(
        `SELECT sm.user_id
         FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE s.code = $1 AND sm.status = 'active'`,
        [code]
      );
      for (const row of membersRes.rows) activeSquadMemberIds.add(String(row.user_id));
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
          if (ws._userId && activeSquadMemberIds.has(ws._userId)) {
            ws.send(payload);
          } else {
            // Membership was revoked after the subscription was created.
            ws._squadCodes.delete(code);
          }
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

module.exports = {
  WS_AUTH_TIMEOUT_MS,
  WS_MAX_MESSAGES_PER_WINDOW,
  WS_MAX_QUEUED_MESSAGES,
  WS_MAX_PAYLOAD_BYTES,
  WS_MESSAGE_WINDOW_MS,
  broadcastCompareUpdate,
  broadcastFriendCollectionUpdate,
  broadcastFriendsUpdate,
  broadcastGoalUpdate,
  broadcastNewsUpdate,
  broadcastSquadCompletionUpdate,
  broadcastSquadUpdate,
  isAllowedWebSocketOrigin,
  pool,
  revalidateSocketAuthorization,
  revokeSessionSockets,
  revokeUserSockets,
  sessionSockets,
  shouldUseSSL,
  wsClients
};
