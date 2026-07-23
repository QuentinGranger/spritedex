// ws.js — extracted from server.js

const { validateSession } = require("./auth");
const { wss } = require("./core");
const { Pool } = require("pg");

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

module.exports = { broadcastCompareUpdate, broadcastSquadUpdate, pool, shouldUseSSL, wsClients };
