require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const { WebSocketServer } = require("ws");
const http = require("http");
const puppeteer = require("puppeteer-core");
const { Resend } = require("resend");
const security = require("./security");
const { seedReferenceData } = require("./sprite-data");
const pushService = require("./push-service");
const secLog = require("./security-logger");

// On Render, RENDER_EXTERNAL_URL is auto-injected as the full public https URL.
// Use it as the default public base so OAuth redirects and CORS work on the
// very first deploy without manually setting OAUTH_REDIRECT_BASE.
if (!process.env.OAUTH_REDIRECT_BASE && process.env.RENDER_EXTERNAL_URL) {
  process.env.OAUTH_REDIRECT_BASE = process.env.RENDER_EXTERNAL_URL;
}

security.validateEnv();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;

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
       WHERE sm.user_id = $1`,
      [userId]
    );
    for (const row of squadsResult.rows) {
      const membersResult = await pool.query(
        `SELECT sm.user_id FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id
         WHERE s.code = $1`,
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

// ── Resend : email service ──
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.FROM_EMAIL || "SPRITNEX <quentinsavigny@protonmail.com>";
const APP_URL = process.env.OAUTH_REDIRECT_BASE || "http://localhost:3000";

async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Vérifie ton email — SPRITNEX",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SPRITNEX</h1>
          <p style="margin:0 0 24px;color:rgba(255,255,255,0.7);font-size:14px;">Confirme ton adresse email pour activer ton compte.</p>
          <a href="${verifyUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00e1ff,#8d7cff);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Vérifier mon email</a>
          <p style="margin:24px 0 0;color:rgba(255,255,255,0.4);font-size:12px;">Si tu n'as pas créé de compte, ignore cet email.</p>
        </div>
      `
    });
    console.log(`[RESEND] Verification email sent to ${toEmail}`);
  } catch (err) {
    console.error("[RESEND] Failed to send verification email:", err);
  }
}

async function sendPasswordResetEmail(toEmail, token) {
  const resetUrl = `${APP_URL}/?resetToken=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Réinitialisation de mot de passe — SPRITNEX",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SPRITNEX</h1>
          <p style="margin:0 0 24px;color:rgba(255,255,255,0.7);font-size:14px;">Une demande de réinitialisation de mot de passe a été effectuée. Ce lien expire dans 1 heure.</p>
          <a href="${resetUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00e1ff,#8d7cff);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Réinitialiser mon mot de passe</a>
          <p style="margin:24px 0 0;color:rgba(255,255,255,0.4);font-size:12px;">Si tu n'as pas fait cette demande, ignore cet email — ton mot de passe reste inchangé.</p>
        </div>
      `
    });
    console.log(`[RESEND] Password reset email sent to ${toEmail}`);
  } catch (err) {
    console.error("[RESEND] Failed to send password reset email:", err);
  }
}

// Trust the first proxy hop in production (needed for correct req.ip behind a
// reverse proxy / load balancer, which the rate limiter relies on). In dev we
// do not trust proxy headers so X-Forwarded-For cannot be spoofed.
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);

const corsOrigins = security.resolveCorsOrigins();
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(security.securityHeaders);
app.use(cookieParser());
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));
// Block server-side source / config files, then serve static assets (dotfiles
// such as .env and .git are denied outright).
app.use(security.blockSensitiveFiles);
app.use(express.static(path.join(__dirname), { dotfiles: "deny" }));

// ── Sessions : token generation ──
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createSession(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)",
    [userId, token, expiresAt]
  );
  return token;
}

async function validateSession(token) {
  if (!token) return null;
  const result = await pool.query(
    "SELECT user_id FROM sessions WHERE token = $1 AND expires_at > NOW()",
    [token]
  );
  return result.rows.length ? result.rows[0].user_id : null;
}

// ── Permissions : extract requesting user from a valid session token only ──
// SECURITY: never trust a client-supplied user id (e.g. an "x-user-id" header
// or a body field) as identity proof. Identity is derived exclusively from a
// server-issued session token, otherwise anyone could impersonate any user.
async function getRequestingUser(req) {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const userId = await validateSession(token);
    if (userId) return String(userId);
  }
  return null;
}

async function requireSameUser(req, res, paramUserId) {
  const reqUser = await getRequestingUser(req);
  if (!reqUser || String(reqUser) !== String(paramUserId)) {
    res.status(403).json({ error: "Accès interdit : vous ne pouvez modifier que votre propre collection" });
    return false;
  }
  return true;
}

async function requireSquadMember(req, res, squadId) {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) {
    res.status(401).json({ error: "Authentification requise" });
    return false;
  }
  const check = await pool.query(
    "SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2",
    [squadId, reqUser]
  );
  if (check.rows.length === 0) {
    res.status(403).json({ error: "Vous n'êtes pas membre de cette escouade" });
    return false;
  }
  return true;
}

async function shareSquad(userA, userB) {
  if (!userA || !userB) return false;
  const result = await pool.query(
    `SELECT 1 FROM squad_members a
     JOIN squad_members b ON a.squad_id = b.squad_id
     WHERE a.user_id = $1 AND b.user_id = $2
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

async function areFriends(userA, userB) {
  if (!userA || !userB) return false;
  const result = await pool.query(
    `SELECT 1 FROM friends
     WHERE status = 'accepted'
       AND ((user_id = $1 AND friend_user_id = $2)
         OR (user_id = $2 AND friend_user_id = $1))
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows.length > 0;
}

async function checkPrivacyAccess(req, targetUserId, privacy) {
  const reqUser = await getRequestingUser(req);
  if (String(reqUser) === String(targetUserId)) return "full";
  if (privacy === "public") return "full";
  if (!reqUser) return "blocked";
  if (privacy === "friends_only" && await areFriends(reqUser, targetUserId)) return "full";
  if (privacy === "squad_only" && await shareSquad(reqUser, targetUserId)) return "full";
  return "blocked";
}

// ── Server-side comparison engine (mirrors js/compare.js logic) ──────────────
const COMPARE_SERVER_RULES = {
  owned: ["owned"],
  missing: ["missing", "priority", "spotted", "unavailable"],
  recommend: ["missing", "priority", "spotted"],
  unknown: ["new", "unknown", "unsure"]
};

function compareServerIsOwned(status) { return COMPARE_SERVER_RULES.owned.includes(status); }
function compareServerIsMissing(status) { return COMPARE_SERVER_RULES.missing.includes(status); }
function compareServerIsUnknown(status) { return !status || COMPARE_SERVER_RULES.unknown.includes(status); }
function compareServerIsRecommend(status) { return COMPARE_SERVER_RULES.recommend.includes(status); }

function compareServerIsPriority(entry) {
  if (!entry) return false;
  const s = entry.status;
  if (s === "unavailable" || compareServerIsOwned(s) || compareServerIsUnknown(s)) return false;
  if (s === "priority") return true;
  return !!(entry.priority && entry.priority !== "none" && entry.priority !== "ignored");
}

function compareServerClassify(entry) {
  const s = entry?.status;
  if (compareServerIsOwned(s)) return "owned";
  if (compareServerIsMissing(s)) return "missing";
  return "unknown";
}

function compareServerDefaultEntry() { return { status: "new", priority: "none", note: "" }; }

function isVariantReleasedAndActiveServer(item) {
  const release = (item.releaseStatus || "").toLowerCase();
  if (["unreleased", "upcoming", "coming_soon", "soon", "unknown"].includes(release)) return false;
  const data = (item.dataStatus || "").toLowerCase();
  if (["archived", "legacy", "disabled"].includes(data)) return false;
  if (item.available === false || item.enabled === false || item.isReleased === false) return false;
  return true;
}

async function getServerCompareCatalogItems() {
  const [spritesRes, variantsRes] = await Promise.all([
    pool.query(`SELECT id, name, rarity, color, season_id, event_id, acquisition, availability, data_status, release_status, available, added_date FROM sprites`),
    pool.query(`SELECT id, sprite_id, variant_type, name, rarity, release_status, data_status, acquisition, availability, first_observed_at, image_path, suggested_image_path FROM sprite_variants`)
  ]);
  const spriteMap = Object.fromEntries(spritesRes.rows.map(s => [s.id, s]));
  const items = [];
  for (const v of variantsRes.rows) {
    const sprite = spriteMap[v.sprite_id];
    if (!sprite) continue;
    const variantAcquisition = buildAcquisitionMethod(v.acquisition && Object.keys(v.acquisition || {}).length ? v.acquisition : sprite.acquisition);
    const variantAvailability = buildAvailability(v.availability && Object.keys(v.availability || {}).length ? v.availability : sprite.availability);
    items.push({
      id: v.id,
      variantId: v.id,
      spriteId: sprite.id,
      variantType: v.variant_type,
      variantName: v.name || v.variant_type,
      spriteName: sprite.name || sprite.id,
      img: v.image_path || v.suggested_image_path || null,
      rarity: v.rarity || sprite.rarity,
      color: sprite.color,
      seasonId: sprite.season_id,
      eventId: sprite.event_id,
      releaseStatus: v.release_status || sprite.release_status || "",
      dataStatus: v.data_status || sprite.data_status || "",
      availabilityStatus: variantAvailability.status,
      acquisitionMethod: variantAcquisition.type,
      releaseDate: variantAvailability.startDate || v.first_observed_at || sprite.added_date,
      available: v.available !== undefined ? v.available : sprite.available
    });
  }
  return items;
}

async function loadServerCompareCollection(userId) {
  const result = await pool.query(
    "SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  const collection = {};
  for (const row of result.rows) {
    collection[row.variant_id] = {
      status: row.status || "new",
      note: row.note || "",
      priority: row.priority || "none",
      obtainedAt: row.obtained_at || null
    };
  }
  return collection;
}

function compareCollectionsServer(userA, userB, catalogue) {
  const activeCatalogue = catalogue.filter(isVariantReleasedAndActiveServer);
  const groups = { bothOwned: [], onlyUserA: [], onlyUserB: [], bothMissing: [], unknown: [] };
  const records = [];

  for (const item of activeCatalogue) {
    const a = userA.collection[item.variantId] || compareServerDefaultEntry();
    const b = userB.collection[item.variantId] || compareServerDefaultEntry();
    const sa = compareServerClassify(a);
    const sb = compareServerClassify(b);

    const record = {
      ...item,
      userA: { status: a.status, priority: a.priority, note: a.note },
      userB: { status: b.status, priority: b.priority, note: b.note }
    };

    if (sa === "unknown" || sb === "unknown") {
      groups.unknown.push(record);
    } else if (sa === "owned" && sb === "owned") {
      groups.bothOwned.push(record);
    } else if (sa === "owned" && sb !== "owned") {
      groups.onlyUserA.push(record);
    } else if (sb === "owned" && sa !== "owned") {
      groups.onlyUserB.push(record);
    } else if (sa === "missing" && sb === "missing") {
      groups.bothMissing.push(record);
    } else {
      groups.unknown.push(record);
    }
    records.push(record);
  }

  const total = activeCatalogue.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;

  const toRate = (n, d) => d ? Math.round((n / d) * 10000) / 100 : 0;
  const comparisonId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `comparison_${crypto.randomBytes(16).toString("hex")}`;

  return {
    comparisonId,
    generatedAt: new Date().toISOString(),
    users: {
      userA: { id: userA.id, displayName: userA.displayName },
      userB: { id: userB.id, displayName: userB.displayName }
    },
    summary: {
      catalogueVariantCount: total,
      bothOwnedCount,
      onlyUserACount,
      onlyUserBCount,
      bothMissingCount,
      unknownCount,
      aOwnedCount,
      bOwnedCount,
      aPossessionRate: toRate(aOwnedCount, total),
      bPossessionRate: toRate(bOwnedCount, total),
      collectiveOwnedCount,
      collectiveCompletionRate: toRate(collectiveOwnedCount, total),
      complementarityRate: toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount)
    },
    groups,
    records
  };
}

function applyServerCompareFilters(result, query) {
  let records = result.records;
  const status = query.status;
  if (status) {
    if (result.groups[status]) {
      records = result.groups[status];
    } else if (status === "differences" || status === "missingMatch") {
      records = [...result.groups.onlyUserA, ...result.groups.onlyUserB];
    } else if (status === "priorities") {
      records = records.filter(r => compareServerIsPriority(r.userA) || compareServerIsPriority(r.userB));
    }
  }

  if (query.seasonId) records = records.filter(r => r.seasonId === query.seasonId);
  if (query.eventId) records = records.filter(r => r.eventId === query.eventId);
  if (query.rarity) records = records.filter(r => r.rarity && String(r.rarity).toLowerCase() === String(query.rarity).toLowerCase());
  if (query.variantType) records = records.filter(r => r.variantType && String(r.variantType).toLowerCase() === String(query.variantType).toLowerCase());
  if (query.availability) records = records.filter(r => r.availabilityStatus === query.availability);

  const groups = { bothOwned: [], onlyUserA: [], onlyUserB: [], bothMissing: [], unknown: [] };
  for (const rec of records) {
    const sa = compareServerClassify(rec.userA);
    const sb = compareServerClassify(rec.userB);
    if (sa === "unknown" || sb === "unknown") groups.unknown.push(rec);
    else if (sa === "owned" && sb === "owned") groups.bothOwned.push(rec);
    else if (sa === "owned" && sb !== "owned") groups.onlyUserA.push(rec);
    else if (sb === "owned" && sa !== "owned") groups.onlyUserB.push(rec);
    else if (sa === "missing" && sb === "missing") groups.bothMissing.push(rec);
    else groups.unknown.push(rec);
  }

  const total = records.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;
  const toRate = (n, d) => d ? Math.round((n / d) * 10000) / 100 : 0;

  const summary = {
    ...result.summary,
    catalogueVariantCount: total,
    bothOwnedCount,
    onlyUserACount,
    onlyUserBCount,
    bothMissingCount,
    unknownCount,
    aOwnedCount,
    bOwnedCount,
    aPossessionRate: toRate(aOwnedCount, total),
    bPossessionRate: toRate(bOwnedCount, total),
    collectiveOwnedCount,
    collectiveCompletionRate: toRate(collectiveOwnedCount, total),
    complementarityRate: toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount)
  };

  return { ...result, records, groups, summary };
}

// ── Stable catalog ID helpers ───────────────────────────────────────────────
// Collections are keyed by the stable variant id (e.g. sprite_water_holofoil).
// Each entry also carries its base sprite_id (e.g. sprite_water) so the system
// never depends on display names or a "::" separator for matching.
let catalogIdMapCache = null;
let catalogIdMapCacheTs = 0;
const CATALOG_MAP_TTL = 30_000;

async function getCatalogIdMaps() {
  const now = Date.now();
  if (catalogIdMapCache && (now - catalogIdMapCacheTs) < CATALOG_MAP_TTL) {
    return catalogIdMapCache;
  }
  const [variants, sprites] = await Promise.all([
    pool.query("SELECT id, sprite_id, variant_type FROM sprite_variants"),
    pool.query("SELECT id, slug FROM sprites")
  ]);
  const variantMap = {};
  const typeToVariantId = {};
  const spriteBySlug = {};
  const spriteById = {};
  for (const row of variants.rows) {
    variantMap[row.id] = { spriteId: row.sprite_id, type: row.variant_type };
    typeToVariantId[`${row.sprite_id}::${row.variant_type}`] = row.id;
  }
  for (const row of sprites.rows) {
    spriteById[row.id] = row.id;
    if (row.slug) spriteBySlug[row.slug] = row.id;
  }
  catalogIdMapCache = { variantMap, typeToVariantId, spriteBySlug, spriteById };
  catalogIdMapCacheTs = now;
  return catalogIdMapCache;
}

function normalizeVariantIdWithMaps(raw, maps) {
  if (!raw || typeof raw !== "string") return { variantId: raw, spriteId: null };
  if (raw.startsWith("fav_")) return { variantId: raw, spriteId: null };

  // Already a stable variant id
  if (maps.variantMap[raw]) {
    return { variantId: raw, spriteId: maps.variantMap[raw].spriteId };
  }

  // Already a base sprite id (or slug resolves to one): the base variant
  const baseFromId = maps.spriteById[raw];
  if (baseFromId) return { variantId: raw, spriteId: baseFromId };
  if (maps.spriteBySlug[raw]) {
    const sid = maps.spriteBySlug[raw];
    return { variantId: sid, spriteId: sid };
  }

  // Legacy composite "base::VariantType"
  const sepIndex = raw.indexOf("::");
  if (sepIndex !== -1) {
    const baseRaw = raw.slice(0, sepIndex);
    const typeRaw = raw.slice(sepIndex + 2);
    const baseId = maps.spriteById[baseRaw] || maps.spriteBySlug[baseRaw] || baseRaw;
    const key = `${baseId}::${typeRaw}`;
    if (maps.typeToVariantId[key]) {
      return { variantId: maps.typeToVariantId[key], spriteId: baseId };
    }
    // Case-insensitive variant type match
    for (const [k, vid] of Object.entries(maps.typeToVariantId)) {
      const [b, t] = k.split("::");
      if (b === baseId && t.toLowerCase() === typeRaw.toLowerCase()) {
        return { variantId: vid, spriteId: baseId };
      }
    }
    // Unknown variant: keep a stable-looking composite id
    return { variantId: `${baseId}::${typeRaw}`, spriteId: baseId };
  }

  return { variantId: raw, spriteId: raw };
}

async function normalizeVariantId(raw) {
  const maps = await getCatalogIdMaps();
  return normalizeVariantIdWithMaps(raw, maps);
}

async function normalizeCollection(collection) {
  const maps = await getCatalogIdMaps();
  const normalized = {};
  for (const [rawKey, entry] of Object.entries(collection)) {
    if (rawKey.startsWith("fav_")) { normalized[rawKey] = entry; continue; }
    const { variantId, spriteId } = normalizeVariantIdWithMaps(rawKey, maps);
    normalized[variantId] = { ...entry, spriteId };
  }
  return normalized;
}

// Backward-compatible alias
async function normalizeSpriteEntryId(spriteId) {
  const { variantId } = await normalizeVariantId(spriteId);
  return variantId;
}

const ACQUISITION_TYPES = new Set(["quest", "event", "exploration", "interaction", "reward", "challenge", "purchase", "automatic", "unknown"]);

function normalizeAcquisitionType(type) {
  if (!type) return "unknown";
  const lower = String(type).toLowerCase();
  if (ACQUISITION_TYPES.has(lower)) return lower;
  if (lower === "in_game" || lower === "ingame" || lower === "world" || lower === "spawn") return "exploration";
  if (lower === "shop" || lower === "store" || lower === "buy" || lower === "bought") return "purchase";
  if (lower === "mission" || lower === "questline") return "quest";
  if (lower === "battlepass" || lower === "pass" || lower === "bp") return "reward";
  if (lower === "minigame" || lower === "boss" || lower === "vault") return "challenge";
  if (lower === "npc" || lower === "character" || lower === "merchant") return "interaction";
  return "unknown";
}

function buildAcquisitionMethod(acquisition) {
  const a = acquisition || {};
  return {
    type: normalizeAcquisitionType(a.type),
    description: a.descriptionFr || a.descriptionEn || a.description || null,
    location: a.location || null,
    requirements: Array.isArray(a.requirements) ? a.requirements : [],
    confidence: a.confidence || "unknown",
  };
}

const HONEST_AVAILABILITY_STATUSES = new Set(["available", "upcoming", "ended", "not_observed", "unknown"]);

function normalizeAvailabilityStatus(status, startDate, endDate) {
  const s = (status || "").toLowerCase();
  if (HONEST_AVAILABILITY_STATUSES.has(s)) return s;

  const now = new Date().toISOString();
  const start = startDate ? new Date(startDate).toISOString() : null;
  const end = endDate ? new Date(endDate).toISOString() : null;

  if (s === "available" || s === "active" || s === "live") {
    if (end && end < now) return "ended";
    return "available";
  }
  if (s === "unreleased" || s === "coming_soon" || s === "soon") {
    if (start && start > now) return "upcoming";
    return "unknown";
  }
  if (s === "unavailable" || s === "inactive" || s === "discontinued" || s === "expired" || s === "removed" || s === "over") {
    if (end && end < now) return "ended";
    return "not_observed";
  }
  if (s === "not_observed" || s === "missing" || s === "not_seen") return "not_observed";

  if (end && end < now) return "ended";
  if (start && start > now) return "upcoming";
  return "unknown";
}

function buildAvailability(availability) {
  const a = availability || {};
  return {
    status: normalizeAvailabilityStatus(a.status, a.startDate, a.endDate),
    startDate: a.startDate || null,
    endDate: a.endDate || null,
    recurrence: a.recurrence || "unknown",
    confidence: a.confidence || "unknown",
  };
}

const RECURRENCE_STATUSES = new Set(["confirmed_recurring", "possible_return", "not_confirmed", "unknown"]);

function normalizeRecurrenceStatus(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "_");
  if (RECURRENCE_STATUSES.has(s)) return s;
  if (s.includes("recurring") || s.includes("confirmed_return") || s === "yes") return "confirmed_recurring";
  if (s.includes("possible") || s.includes("maybe") || s.includes("return")) return "possible_return";
  if (s.includes("never") || s.includes("not_confirmed") || s.includes("no_return") || s.includes("exclusive")) return "not_confirmed";
  return "unknown";
}

function buildRecurrence(recurrence) {
  if (recurrence && typeof recurrence === "object" && !Array.isArray(recurrence)) {
    return {
      status: normalizeRecurrenceStatus(recurrence.status),
      officiallyConfirmed: !!recurrence.officiallyConfirmed,
      evidence: recurrence.evidence || null,
    };
  }
  const status = normalizeRecurrenceStatus(recurrence);
  return {
    status,
    officiallyConfirmed: status === "confirmed_recurring",
    evidence: null,
  };
}

function buildDates(dates, firstObservedAt, lastVerifiedAt, officiallyAnnouncedAt) {
  const d = dates || {};
  return {
    firstObservedAt: d.firstObservedAt || firstObservedAt || null,
    officiallyAnnouncedAt: d.officiallyAnnouncedAt || officiallyAnnouncedAt || null,
    lastVerifiedAt: d.lastVerifiedAt || lastVerifiedAt || null,
  };
}

const VALID_DATA_STATUSES = new Set(["complete", "incomplete", "needs_review", "unverified", "disputed", "archived"]);

function normalizeDataStatus(status, missingFields = []) {
  let s = (status || "").toLowerCase();
  if (!VALID_DATA_STATUSES.has(s)) {
    if (s === "confirmed") s = "complete";
    else if (s === "observed") s = "unverified";
    else if (s === "legacy") s = "archived";
    else if (missingFields.length > 0) s = "incomplete";
    else s = "complete";
  }
  if (s === "complete" && missingFields.length > 0) s = "incomplete";
  return s;
}

function computeMissingFields(sprite) {
  const missing = [];
  const a = sprite.acquisitionMethod || sprite.acquisition || {};
  const av = sprite.availability || {};
  const r = sprite.recurrence || {};
  const d = sprite.dates || {};

  if (!sprite.officialName) missing.push("officialName");
  if (!sprite.seasonId) missing.push("seasonId");
  if (!sprite.image) missing.push("image");
  if (a.type === "unknown") missing.push("acquisitionMethod.type");
  if (!a.description) missing.push("acquisitionMethod.description");
  if (av.status === "unknown") missing.push("availability.status");
  if (!av.startDate && av.status !== "unknown" && av.status !== "upcoming") missing.push("availability.startDate");
  if (av.status === "ended" && !av.endDate) missing.push("availability.endDate");
  if (r.status === "unknown") missing.push("recurrence.status");
  if (!d.firstObservedAt) missing.push("dates.firstObservedAt");
  if (!d.lastVerifiedAt) missing.push("dates.lastVerifiedAt");
  if (!d.officiallyAnnouncedAt) missing.push("dates.officiallyAnnouncedAt");
  if (!Array.isArray(sprite.sources) || sprite.sources.length === 0) missing.push("sources");
  if (!Array.isArray(sprite.availabilityPeriods) || sprite.availabilityPeriods.length === 0) missing.push("availabilityPeriods");

  return missing;
}

function inferSourceType(sourceId) {
  const s = (sourceId || "").toLowerCase();
  if (s.includes("official") || s.includes("epic") || s.includes("fortnite.com") || s.includes("fortnite-api")) return "official";
  if (s.includes("in_game") || s.includes("observed")) return "in_game";
  if (s.includes("creator") || s.includes("youtuber") || s.includes("streamer")) return "creator";
  if (s.includes("community") || s.includes("discord") || s.includes("reddit")) return "community";
  if (s.includes("gg") || s.includes("database") || s.includes("wiki")) return "database";
  return "unknown";
}

function inferSourceReliability(type) {
  if (type === "official") return "primary";
  if (type === "in_game") return "primary";
  if (type === "creator") return "secondary";
  if (type === "community") return "secondary";
  if (type === "database") return "tertiary";
  return "unknown";
}

async function ensureSource(sourceId, options = {}) {
  if (!sourceId) return;
  const type = options.type || inferSourceType(sourceId);
  const reliability = options.reliability || inferSourceReliability(type);
  const title = options.title || sourceId;
  const publisher = options.publisher || null;
  const url = options.url || null;
  const publishedAt = options.publishedAt || null;
  const observedAt = options.observedAt || null;
  const lastVerifiedAt = options.lastVerifiedAt || null;

  await pool.query(
    `INSERT INTO sprite_sources (id, type, publisher, title, url, published_at, observed_at, last_verified_at, reliability, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9, NOW())
     ON CONFLICT (id) DO UPDATE SET
       type = COALESCE($2, sprite_sources.type),
       publisher = COALESCE($3, sprite_sources.publisher),
       title = COALESCE($4, sprite_sources.title),
       url = COALESCE($5, sprite_sources.url),
       published_at = COALESCE($6::timestamptz, sprite_sources.published_at),
       observed_at = COALESCE($7::timestamptz, sprite_sources.observed_at),
       last_verified_at = COALESCE($8::timestamptz, sprite_sources.last_verified_at),
       reliability = COALESCE($9, sprite_sources.reliability),
       updated_at = NOW()`,
    [sourceId, type, publisher, title, url, publishedAt, observedAt, lastVerifiedAt, reliability]
  );
}

// Collapse sprites that share the same slug into a single canonical entry.
// Prefers the "sprite_"-prefixed id (the stable scheme used by collections and
// migrations) and backfills any missing / "unknown" fields from the twin so no
// real catalog data (rarity, effect, images, variants…) is lost.
function dedupeSpritesBySlug(sprites) {
  const isUnknown = (v) => v === null || v === undefined || v === "" || v === "unknown";

  function mergePreferring(canonical, other) {
    const merged = { ...canonical };
    // Scalar fields: keep canonical value unless it is unknown/empty.
    for (const key of ["rarity", "effect", "color", "image", "officialName", "seasonId", "eventId", "addedDate"]) {
      if (isUnknown(merged[key]) && !isUnknown(other[key])) merged[key] = other[key];
    }
    // Arrays: prefer the richer (longer) one.
    for (const key of ["variants", "variantIds", "availabilityPeriods", "sourceIds", "sources"]) {
      const a = Array.isArray(merged[key]) ? merged[key] : [];
      const b = Array.isArray(other[key]) ? other[key] : [];
      if (b.length > a.length) merged[key] = b;
    }
    // Objects (images / variantDetails): prefer the one with more keys.
    for (const key of ["images", "variantDetails"]) {
      const a = merged[key] && typeof merged[key] === "object" ? merged[key] : {};
      const b = other[key] && typeof other[key] === "object" ? other[key] : {};
      if (Object.keys(b).length > Object.keys(a).length) merged[key] = b;
    }
    return merged;
  }

  const groups = new Map();
  for (const sprite of sprites) {
    const slug = sprite.slug || sprite.id.replace(/^sprite_/, "").replace(/_/g, "-");
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push(sprite);
  }

  const result = [];
  for (const group of groups.values()) {
    if (group.length === 1) { result.push(group[0]); continue; }
    // Canonical: the "sprite_"-prefixed row if present, else the first.
    const canonical = group.find(s => s.id.startsWith("sprite_")) || group[0];
    let merged = canonical;
    for (const other of group) {
      if (other === canonical) continue;
      merged = mergePreferring(merged, other);
    }
    result.push(merged);
  }
  return result;
}

// ── Sprites : données de référence ──
app.get("/api/sprites", async (req, res) => {
  try {
    const spritesResult = await pool.query(
      `SELECT id, name, rarity, color, effect, variants, available, added_date,
              slug, official_name, season_id, event_id, image,
              first_observed_at, last_verified_at, officially_announced_at,
              acquisition, availability, recurrence, dates, missing_fields, sources, data_status
       FROM sprites ORDER BY added_date, name`
    );
    const imagesResult = await pool.query(
      "SELECT sprite_id, variant, image_path FROM sprite_images"
    );
    const variantsResult = await pool.query(
      "SELECT name, label, bonus FROM variant_meta ORDER BY name"
    );
    const seasonsResult = await pool.query(
      "SELECT id, chapter, season, name, name_en, start_date, end_date, data_status, sources FROM seasons ORDER BY chapter, season"
    );
    const eventsResult = await pool.query(
      "SELECT id, name, type, season_id, start_date, end_date, data_status, sources FROM events ORDER BY start_date, name"
    );
    const availabilityPeriodsResult = await pool.query(
      `SELECT id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources
       FROM availability_periods ORDER BY sprite_id, start_date DESC`
    );
    const sourcesResult = await pool.query(
      "SELECT id, type, publisher, title, url, published_at, observed_at, last_verified_at, reliability, catalog_version FROM sprite_sources"
    );
    const sourcesMap = {};
    for (const row of sourcesResult.rows) {
      sourcesMap[row.id] = {
        id: row.id,
        type: row.type,
        publisher: row.publisher,
        title: row.title,
        url: row.url,
        publishedAt: row.published_at,
        observedAt: row.observed_at,
        lastVerifiedAt: row.last_verified_at,
        reliability: row.reliability,
        catalogVersion: row.catalog_version,
      };
    }
    function buildSources(sourceIds) {
      const ids = Array.isArray(sourceIds) ? sourceIds : [];
      return ids.map(id => sourcesMap[id]).filter(Boolean);
    }

    const variantDetailsResult = await pool.query(
      `SELECT id, sprite_id, variant_type AS type, name, official_name, slug, rarity, release_status,
              summon_cost, sprite_chest_drop_chance_pct, extra_effect_ref, effect, acquisition,
              first_observed_at, image_path, suggested_image_path, availability, recurrence, dates, missing_fields, data_status, sources
       FROM sprite_variants ORDER BY sprite_id, variant_type`
    );

    const images = {};
    for (const row of imagesResult.rows) {
      if (!images[row.sprite_id]) images[row.sprite_id] = {};
      images[row.sprite_id][row.variant] = row.image_path;
    }

    const variantDetails = {};
    for (const row of variantDetailsResult.rows) {
      if (!variantDetails[row.sprite_id]) variantDetails[row.sprite_id] = {};
      const effect = row.effect && Object.keys(row.effect).length ? row.effect : { type: "unknown" };
      const acquisition = buildAcquisitionMethod(row.acquisition);
      const availability = buildAvailability(row.availability);
      const recurrence = buildRecurrence(row.recurrence);
      const dates = buildDates(row.dates, row.first_observed_at, null, null);
      const missingFields = computeMissingFields({
        officialName: row.official_name || row.name,
        seasonId: null,
        image: row.image_path || row.suggested_image_path,
        acquisition,
        availability,
        recurrence,
        dates,
        sources: buildSources(row.sources),
        availabilityPeriods: [],
      });
      const dataStatus = normalizeDataStatus(row.data_status, missingFields);
      const confidence = availability.confidence || acquisition.confidence || dataStatus || "unknown";
      variantDetails[row.sprite_id][row.type] = {
        id: row.id,
        type: row.type,
        name: row.name,
        officialName: row.official_name || null,
        slug: row.slug,
        rarity: row.rarity || "unknown",
        releaseStatus: row.release_status || "unknown",
        summonCost: row.summon_cost,
        spriteChestDropChancePct: row.sprite_chest_drop_chance_pct,
        extraEffectRef: row.extra_effect_ref,
        effect,
        acquisition,
        availability,
        recurrence,
        dates,
        missingFields,
        dataStatus,
        confidence,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
        image: row.image_path || row.suggested_image_path || null,
      };
    }

    const spriteVariantIds = {};
    for (const spriteId of Object.keys(variantDetails)) {
      spriteVariantIds[spriteId] = Object.values(variantDetails[spriteId]).map(v => v.id);
    }

    const seasonsMap = {};
    for (const row of seasonsResult.rows) {
      seasonsMap[row.id] = {
        id: row.id,
        chapter: row.chapter,
        season: row.season,
        name: row.name,
        nameEn: row.name_en,
        startDate: row.start_date,
        endDate: row.end_date,
        dataStatus: row.data_status,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
      };
    }

    const eventsMap = {};
    for (const row of eventsResult.rows) {
      eventsMap[row.id] = {
        id: row.id,
        name: row.name,
        type: row.type,
        seasonId: row.season_id,
        startDate: row.start_date,
        endDate: row.end_date,
        dataStatus: row.data_status,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
      };
    }

    const availabilityPeriodsMap = {};
    for (const row of availabilityPeriodsResult.rows) {
      if (!availabilityPeriodsMap[row.sprite_id]) availabilityPeriodsMap[row.sprite_id] = [];
      availabilityPeriodsMap[row.sprite_id].push({
        id: row.id,
        spriteId: row.sprite_id,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        eventId: row.event_id,
        confidence: row.confidence,
        dataStatus: row.data_status,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
      });
    }

    const sprites = spritesResult.rows.map(s => {
      const baseImage = (variantDetails[s.id] && variantDetails[s.id].Base && (variantDetails[s.id].Base.image || variantDetails[s.id].Base.suggestedImagePath)) || null;
      const acquisition = s.acquisition || {};
      const availability = buildAvailability(s.availability);
      const recurrence = buildRecurrence(s.recurrence);
      const dates = buildDates(s.dates, s.first_observed_at, s.last_verified_at, s.officially_announced_at);
      const missingFields = computeMissingFields({
        officialName: s.official_name || null,
        seasonId: s.season_id || null,
        image: s.image || baseImage,
        acquisition: buildAcquisitionMethod(acquisition),
        availability,
        recurrence,
        dates,
        sources: buildSources(s.sources),
        availabilityPeriods: availabilityPeriodsMap[s.id] || [],
      });
      const dataStatus = normalizeDataStatus(s.data_status, missingFields);
      const season = s.season_id ? seasonsMap[s.season_id] || null : null;
      const event = s.event_id ? eventsMap[s.event_id] || null : null;
      return {
        id: s.id,
        slug: s.slug || s.id.replace(/^sprite_/, "").replace(/_/g, "-"),
        name: s.name,
        officialName: s.official_name || null,
        image: s.image || baseImage,
        variantIds: spriteVariantIds[s.id] || [],
        seasonId: s.season_id || null,
        season,
        eventId: s.event_id || null,
        event,
        acquisitionMethod: buildAcquisitionMethod(acquisition),
        availability,
        availabilityPeriods: availabilityPeriodsMap[s.id] || [],
        recurrence,
        dates,
        missingFields,
        sourceIds: s.sources || [],
        sources: buildSources(s.sources),
        dataStatus,
        confidence: availability.confidence || acquisition.confidence || dataStatus || "unknown",
        // Backward-compatible fields
        rarity: s.rarity,
        color: s.color,
        effect: s.effect,
        variants: s.variants,
        images: images[s.id] || {},
        variantDetails: variantDetails[s.id] || {},
        available: availability.status,
        addedDate: s.added_date,
      };
    });

    // ── Dedupe sprites sharing the same slug ──────────────────────────────
    // Legacy data on some deployments contains two rows per sprite under two id
    // schemes (e.g. "water" from an older catalog import and "sprite_water" from
    // the seed). This collapses them into a single canonical entry (prefer the
    // "sprite_"-prefixed id) and backfills any missing/unknown fields from the
    // twin so the checklist/cards never show duplicates.
    const dedupedSprites = dedupeSpritesBySlug(sprites);

    res.json({
      sprites: dedupedSprites,
      seasons: Object.values(seasonsMap),
      events: Object.values(eventsMap),
      variantMeta: variantsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Historique des modifications du catalogue (Étape 19) ──
// Liste les changements enregistrés (quoi, quand, pourquoi, par qui, source).
// Filtres optionnels : ?entityId=sprite_water, ?field=availability.status,
// ?limit=50&offset=0.
app.get("/api/catalog-history", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const conditions = [];
    const params = [];
    if (req.query.entityId) {
      params.push(req.query.entityId);
      conditions.push(`entity_id = $${params.length}`);
    }
    if (req.query.field) {
      params.push(req.query.field);
      conditions.push(`field = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    params.push(offset);
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, field, previous_value, new_value,
              changed_by, changed_at, reason, source_id
       FROM catalog_change_history
       ${where}
       ORDER BY changed_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({
      history: result.rows.map(r => ({
        id: r.id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        field: r.field,
        previousValue: r.previous_value,
        newValue: r.new_value,
        changedBy: r.changed_by,
        changedAt: r.changed_at,
        reason: r.reason,
        sourceId: r.source_id,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Community ownership : taux réel de possession par les collections actives SPRITNEX ──
app.get("/api/community-ownership", async (req, res) => {
  try {
    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL`
    );
    const totalActive = totalResult.rows[0]?.total || 0;

    const ownershipResult = await pool.query(
      `SELECT COALESCE(se.sprite_id, split_part(se.variant_id, '::', 1)) AS base_id,
              COUNT(DISTINCT se.user_id)::int AS owners
       FROM sprite_entries se
       JOIN users u ON u.id = se.user_id
       WHERE se.status = 'owned'
         AND u.deleted_at IS NULL
       GROUP BY base_id`
    );
    const ownershipMap = new Map(ownershipResult.rows.map(r => [r.base_id, r.owners]));

    const spritesResult = await pool.query(
      `SELECT id, name, rarity FROM sprites
       WHERE is_released IS DISTINCT FROM FALSE
       ORDER BY name`
    );

    const sprites = spritesResult.rows.map(s => {
      const owners = ownershipMap.get(s.id) || 0;
      const rate = totalActive > 0 ? owners / totalActive : 0;
      return {
        spriteId: s.id,
        name: s.name,
        rarity: s.rarity,
        owners,
        totalActive,
        ownershipRate: Number(rate.toFixed(6))
      };
    });

    res.json({ totalActive, sprites });
  } catch (err) {
    console.error("[community-ownership]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Helpers ──
// PBKDF2-HMAC-SHA512 work factor. OWASP (2023) recommends 210 000 iterations
// for PBKDF2-SHA512. Legacy accounts were hashed with 10 000 iterations; that
// count is stored per-user (password_iterations) and upgraded transparently on
// the next successful login (see /api/auth/login).
const PBKDF2_ITERATIONS = 210000;
const LEGACY_PBKDF2_ITERATIONS = 10000;

function hashPassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, "sha512").toString("hex");
  return { salt, hash, iterations };
}

function verifyPassword(password, hash, salt, iterations = LEGACY_PBKDF2_ITERATIONS) {
  if (!hash || !salt) return false;
  const result = crypto.pbkdf2Sync(password, salt, iterations || LEGACY_PBKDF2_ITERATIONS, 64, "sha512").toString("hex");
  // Constant-time comparison to avoid leaking hash-match progress via timing.
  const a = Buffer.from(result, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// SECURITY NOTE: the legacy "/api/auth/quick" (pseudo-only login, no password)
// has been removed. It allowed anyone who knew or guessed a username to obtain
// a valid session for that account with zero credentials. It was unused by the
// current UI (no button called it), so removing it does not affect any feature.

// ── Auth : Email register ──
app.post("/api/auth/register", security.registerLimiter, security.validateBody(security.schemas.registerSchema), async (req, res) => {
  const { email, password, username: reqUsername, cguAccepted, cguVersion, ageConfirmed, cookieConsent } = req.validatedBody;
  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Cet email est déjà utilisé" });
    }
    const { salt, hash, iterations } = hashPassword(password);
    const username = reqUsername || email.split("@")[0].replace(/[^a-zA-Z0-9_\-. ]/g, "").slice(0, 24) || "joueur";
    const emailToken = crypto.randomBytes(32).toString("hex");
    const consentPayload = cookieConsent && typeof cookieConsent === "object"
      ? { ...cookieConsent, consentedAt: cookieConsent.consentedAt || new Date().toISOString() }
      : { necessary: true, analytics: false, consentedAt: new Date().toISOString() };
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, password_salt, password_iterations, email_verify_token, cgu_accepted, cgu_version, cgu_accepted_at, age_confirmed, cookie_consent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, username, created_at`,
      [
        username,
        email.toLowerCase(),
        hash,
        salt,
        iterations,
        emailToken,
        cguAccepted === true,
        cguVersion || null,
        cguAccepted === true ? new Date().toISOString() : null,
        ageConfirmed === true,
        JSON.stringify(consentPayload)
      ]
    );
    const user = result.rows[0];
    const token = await createSession(user.id);
    sendVerificationEmail(email.toLowerCase(), emailToken);
    secLog.logSecurityEvent(pool, { req, userId: user.id, email, event: "register", status: "ok" });
    res.json({ id: user.id, username: user.username, token, emailVerified: false, created_at: user.created_at });
  } catch (err) {
    if (err.code === "23505") {
      if (err.constraint === "users_username_key") {
        return res.status(409).json({ error: "Ce pseudo est déjà pris" });
      }
      if (err.constraint === "users_email_key") {
        return res.status(409).json({ error: "Cet email est déjà utilisé" });
      }
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Verify email ──
app.get("/api/auth/verify-email", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token manquant" });
  try {
    const result = await pool.query(
      "UPDATE users SET email_verified = TRUE, email_verify_token = NULL WHERE email_verify_token = $1 RETURNING id, username",
      [token]
    );
    if (!result.rows.length) {
      return res.redirect("/?emailVerified=error");
    }
    secLog.logSecurityEvent(pool, { req, userId: result.rows[0].id, event: "email_verified", status: "ok" });
    res.redirect("/?emailVerified=true");
  } catch (err) {
    console.error(err);
    res.redirect("/?emailVerified=error");
  }
});

// ── Auth : Resend verification email ──
app.post("/api/auth/resend-verification", security.emailVerifLimiter, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const user = await pool.query("SELECT id, email, email_verified FROM users WHERE id = $1 AND deleted_at IS NULL", [reqUser]);
    if (!user.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    if (user.rows[0].email_verified) return res.json({ ok: true, message: "Email déjà vérifié" });
    const emailToken = crypto.randomBytes(32).toString("hex");
    await pool.query("UPDATE users SET email_verify_token = $1 WHERE id = $2", [emailToken, reqUser]);
    sendVerificationEmail(user.rows[0].email, emailToken);
    res.json({ ok: true, message: "Email de vérification renvoyé" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Request password reset ──
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email requis" });
  try {
    const user = await pool.query("SELECT id, email FROM users WHERE email = $1 AND deleted_at IS NULL", [email.toLowerCase()]);
    // Always return the same success response to prevent email enumeration
    if (!user.rows.length) return res.json({ ok: true, message: "Si un compte existe, un email a été envoyé" });
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.query(
      "UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3",
      [resetToken, resetExpires, user.rows[0].id]
    );
    sendPasswordResetEmail(user.rows[0].email, resetToken);
    secLog.logSecurityEvent(pool, { req, userId: user.rows[0].id, email: user.rows[0].email, event: "password_reset_request", status: "ok" });
    if (process.env.NODE_ENV !== "production" && !process.env.RESEND_API_KEY) {
      console.log(`[DEV ONLY — no RESEND_API_KEY set] Password reset token: ${resetToken}`);
    }
    res.json({ ok: true, message: "Si un compte existe, un email a été envoyé" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Reset password with token ──
app.post("/api/auth/reset-password", security.passwordResetLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || typeof token !== "string" || !newPassword) return res.status(400).json({ error: "Token et nouveau mot de passe requis" });
  if (newPassword.length < 6) return res.status(400).json({ error: "Mot de passe trop court (min 6 caractères)" });
  try {
    const result = await pool.query(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL",
      [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: "Token invalide ou expiré" });
    const { salt, hash, iterations } = hashPassword(newPassword);
    await pool.query(
      "UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = $3, reset_token = NULL, reset_token_expires = NULL WHERE id = $4",
      [hash, salt, iterations, result.rows[0].id]
    );
    // Invalidate all existing sessions for security
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [result.rows[0].id]);
    secLog.logSecurityEvent(pool, { req, userId: result.rows[0].id, event: "password_reset_complete", status: "ok" });
    res.json({ ok: true, message: "Mot de passe réinitialisé" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Push notifications : public VAPID key ──
app.get("/api/push/vapid-key", (req, res) => {
  res.json({ publicKey: pushService.getVapidPublicKey() });
});

// ── Push notifications : register / unregister token ──
app.post("/api/push/register", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { token, platform = "web" } = req.body || {};
  if (!token) return res.status(400).json({ error: "Token requis" });
  try {
    await pushService.registerToken(pool, reqUser, token, platform);
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "push_token_registered", status: "ok", details: { platform } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[PUSH] register error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/push/register", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Token requis" });
  try {
    await pushService.unregisterToken(pool, reqUser, token);
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "push_token_unregistered", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[PUSH] unregister error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Push notifications : user preferences ──
app.get("/api/push/preferences", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT push_enabled,
              push_pref_new_sprites,
              push_pref_new_variants,
              push_pref_squad_activity,
              push_pref_session_summary,
              push_pref_goals,
              push_pref_sync,
              push_pref_news
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const row = result.rows[0];
    res.json({
      enabled: row.push_enabled,
      newSprites: row.push_pref_new_sprites,
      newVariants: row.push_pref_new_variants,
      squadActivity: row.push_pref_squad_activity,
      sessionSummary: row.push_pref_session_summary,
      goals: row.push_pref_goals,
      sync: row.push_pref_sync,
      news: row.push_pref_news
    });
  } catch (err) {
    console.error("[PUSH] preferences get error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.patch("/api/push/preferences", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body || {};
  const fields = [];
  const values = [];
  let idx = 1;
  const map = {
    enabled: "push_enabled",
    newSprites: "push_pref_new_sprites",
    newVariants: "push_pref_new_variants",
    squadActivity: "push_pref_squad_activity",
    sessionSummary: "push_pref_session_summary",
    goals: "push_pref_goals",
    sync: "push_pref_sync",
    news: "push_pref_news"
  };
  for (const [key, col] of Object.entries(map)) {
    if (typeof body[key] === "boolean") {
      fields.push(`${col} = $${idx++}`);
      values.push(body[key]);
    }
  }
  if (fields.length === 0) return res.status(400).json({ error: "Aucune préférence à mettre à jour" });
  values.push(reqUser);
  try {
    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx}`,
      values
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[PUSH] preferences patch error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Email login ──
app.post("/api/auth/login", security.loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }
  try {
    const result = await pool.query(
      "SELECT id, username, email_verified, password_hash, password_salt, password_iterations, avatar_url, privacy, created_at FROM users WHERE email = $1 AND deleted_at IS NULL",
      [email.toLowerCase()]
    );
    // Same generic error whether the email is unknown or the password is wrong,
    // to avoid leaking which emails have an account (user enumeration).
    const genericError = () => res.status(401).json({ error: "Email ou mot de passe incorrect" });
    if (!result.rows.length) return genericError();
    const user = result.rows[0];
    const storedIterations = user.password_iterations || LEGACY_PBKDF2_ITERATIONS;
    if (!user.password_hash || !verifyPassword(password, user.password_hash, user.password_salt, storedIterations)) {
      secLog.logSecurityEvent(pool, { req, email, event: "login", status: "failed", details: { reason: "wrong_password" } });
      return genericError();
    }
    secLog.logSecurityEvent(pool, { req, userId: user.id, email, event: "login", status: "ok", details: { method: "email" } });
    // Transparent upgrade: if this account was hashed with a weaker (legacy)
    // work factor, re-hash the just-verified password with the current factor.
    if (storedIterations < PBKDF2_ITERATIONS) {
      try {
        const upgraded = hashPassword(password);
        await pool.query(
          "UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = $3 WHERE id = $4",
          [upgraded.hash, upgraded.salt, upgraded.iterations, user.id]
        );
      } catch (upErr) {
        console.error("[PWD-UPGRADE] Failed to re-hash password for user", user.id, upErr);
      }
    }
    const token = await createSession(user.id);
    res.json({
      id: user.id,
      username: user.username,
      token,
      emailVerified: user.email_verified || false,
      avatar_url: user.avatar_url || "",
      privacy: user.privacy || "squad_only",
      created_at: user.created_at
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Profile : GET ──
app.get("/api/profile/:userId", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, avatar_url, privacy, created_at, last_active_at FROM users WHERE id = $1 AND deleted_at IS NULL",
      [req.params.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const profile = result.rows[0];
    const access = await checkPrivacyAccess(req, profile.id, profile.privacy);
    if (access === "blocked") {
      return res.json({ id: profile.id, username: profile.username, privacy: profile.privacy });
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Consent update (owner only) ──
app.patch("/api/consent", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const body = req.body || {};
  const payload = body.cookieConsent && typeof body.cookieConsent === "object"
    ? { ...body.cookieConsent, consentedAt: body.cookieConsent.consentedAt || new Date().toISOString() }
    : { necessary: true, analytics: false, consentedAt: new Date().toISOString() };
  try {
    await pool.query("UPDATE users SET cookie_consent = $1 WHERE id = $2 AND deleted_at IS NULL", [JSON.stringify(payload), reqUser]);
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "consent_updated", status: "ok", details: { payload } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[CONSENT] update error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Data export (owner only) ──
app.get("/api/export", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const userResult = await pool.query(
      `SELECT id, username, email, avatar_url, privacy, created_at, last_active_at,
              email_verified, cgu_accepted, cgu_version, cgu_accepted_at,
              cookie_consent, age_confirmed, push_enabled,
              push_pref_new_sprites, push_pref_new_variants, push_pref_squad_activity,
              push_pref_session_summary, push_pref_goals, push_pref_sync
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [reqUser]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const user = userResult.rows[0];

    const collectionResult = await pool.query(
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, updated_at FROM sprite_entries WHERE user_id = $1",
      [reqUser]
    );
    const collection = {};
    for (const row of collectionResult.rows) {
      collection[row.variant_id] = {
        spriteId: row.sprite_id,
        status: row.status,
        note: row.note || "",
        priority: row.priority || "none",
        obtainedAt: row.obtained_at || null,
        updatedAt: row.updated_at
      };
    }

    const squadsResult = await pool.query(
      `SELECT s.id, s.code, s.name, s.join_open, s.created_at, sm.joined_at
       FROM squads s
       JOIN squad_members sm ON sm.squad_id = s.id
       WHERE sm.user_id = $1`,
      [reqUser]
    );

    const activityResult = await pool.query(
      `SELECT squad_id, sprite_id, action, created_at
       FROM squad_activity
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [reqUser]
    );

    const historyResult = await pool.query(
      `SELECT sprite_id, old_status, new_status, created_at
       FROM collection_history
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [reqUser]
    );

    const pushTokensResult = await pool.query(
      "SELECT platform, enabled, created_at, updated_at FROM push_tokens WHERE user_id = $1",
      [reqUser]
    );

    res.json({
      exportedAt: new Date().toISOString(),
      profile: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatar_url,
        privacy: user.privacy,
        createdAt: user.created_at,
        lastActiveAt: user.last_active_at,
        emailVerified: user.email_verified
      },
      settings: {
        privacy: user.privacy,
        pushEnabled: user.push_enabled,
        pushPreferences: {
          newSprites: user.push_pref_new_sprites,
          newVariants: user.push_pref_new_variants,
          squadActivity: user.push_pref_squad_activity,
          sessionSummary: user.push_pref_session_summary,
          goals: user.push_pref_goals,
          sync: user.push_pref_sync
        }
      },
      consent: {
        cguAccepted: user.cgu_accepted,
        cguVersion: user.cgu_version,
        cguAcceptedAt: user.cgu_accepted_at,
        ageConfirmed: user.age_confirmed,
        cookieConsent: user.cookie_consent
      },
      shareLink: user.share_token || null,
      collection,
      squads: squadsResult.rows,
      squadActivity: activityResult.rows,
      collectionHistory: historyResult.rows,
      pushTokens: pushTokensResult.rows.map(r => ({ platform: r.platform, enabled: r.enabled, createdAt: r.created_at, updatedAt: r.updated_at }))
    });
  } catch (err) {
    console.error("[EXPORT] error", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Share link : owner-only management ──
// A share link uses an opaque, cryptographically random 256-bit token instead
// of the sequential numeric user id. Anyone holding the token can view a
// READ-ONLY snapshot of the collection (status + priority only — never notes,
// email or other private fields). The owner can revoke it at any time.
app.get("/api/profile/:userId/share-link", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    const result = await pool.query("SELECT share_token FROM users WHERE id = $1 AND deleted_at IS NULL", [req.params.userId]);
    if (!result.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json({ token: result.rows[0].share_token || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/profile/:userId/share-link", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    const existing = await pool.query("SELECT share_token FROM users WHERE id = $1 AND deleted_at IS NULL", [req.params.userId]);
    if (!existing.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    // Reuse the current token unless the caller explicitly asks to rotate it.
    let token = existing.rows[0].share_token;
    if (!token || req.body?.rotate === true) {
      token = crypto.randomBytes(32).toString("hex");
      await pool.query("UPDATE users SET share_token = $1 WHERE id = $2", [token, req.params.userId]);
    }
    secLog.logSecurityEvent(pool, { req, userId: req.params.userId, event: "share_link_created", status: "ok" });
    res.json({ token });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Collision de token, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/profile/:userId/share-link", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    await pool.query("UPDATE users SET share_token = NULL WHERE id = $1", [req.params.userId]);
    secLog.logSecurityEvent(pool, { req, userId: req.params.userId, event: "share_link_revoked", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Shared profile : public read-only view via opaque token ──
// No authentication required (the unguessable token IS the credential). Only
// non-sensitive fields are exposed: username, avatar and a status/priority
// snapshot of the collection. Notes are deliberately omitted.
app.get("/api/shared/:token", async (req, res) => {
  const token = req.params.token;
  // Reject anything that is not a well-formed token before touching the DB.
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(404).json({ error: "Lien de partage invalide" });
  }
  try {
    const userResult = await pool.query(
      "SELECT id, username, avatar_url, created_at FROM users WHERE share_token = $1 AND deleted_at IS NULL",
      [token]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: "Lien de partage invalide ou révoqué" });
    }
    const user = userResult.rows[0];
    const access = await checkPrivacyAccess(req, user.id, user.privacy || "squad_only");
    if (access === "blocked") {
      return res.status(403).json({ error: "Profil non accessible" });
    }
    const entries = await pool.query(
      "SELECT variant_id, sprite_id, status, priority FROM sprite_entries WHERE user_id = $1",
      [user.id]
    );
    const collection = {};
    for (const row of entries.rows) {
      collection[row.variant_id] = { spriteId: row.sprite_id, status: row.status, priority: row.priority || "none" };
    }
    res.json({
      username: user.username,
      avatarUrl: user.avatar_url || "",
      createdAt: user.created_at,
      privacy: user.privacy || "squad_only",
      collection
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Profile : PATCH (update own profile) ──
app.patch("/api/profile/:userId", security.validateBody(security.schemas.profilePatchSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { username, avatarUrl, privacy } = req.validatedBody;
  try {
    const sets = [];
    const vals = [];
    let idx = 1;
    if (username && username.trim().length >= 2) {
      sets.push(`username = $${idx++}`);
      vals.push(username.trim());
    }
    if (avatarUrl !== undefined) {
      sets.push(`avatar_url = $${idx++}`);
      vals.push(avatarUrl || "");
    }
    if (privacy && ["public", "friends_only", "squad_only", "private"].includes(privacy)) {
      sets.push(`privacy = $${idx++}`);
      vals.push(privacy);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Rien à mettre à jour" });
    vals.push(userId);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`, vals);
    secLog.logSecurityEvent(pool, { req, userId, event: "profile_updated", status: "ok", details: { changed: sets.map(s => s.split(" = ")[0]) } });
    const updated = await pool.query(
      "SELECT id, username, avatar_url, privacy, created_at, last_active_at FROM users WHERE id = $1 AND deleted_at IS NULL",
      [userId]
    );
    res.json(updated.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Profile : DELETE (soft-delete account) ──
// The account is marked as deleted and becomes inaccessible immediately.
// Personal data is permanently purged by the cleanup cron after 30 days.
app.delete("/api/profile/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  try {
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    await pool.query("UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [userId]);
    secLog.logSecurityEvent(pool, { req, userId, event: "account_deleted", status: "ok" });
    res.json({ ok: true, scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Friends (used by friends_only privacy) ──
app.get("/api/friends", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, f.status, f.created_at
       FROM friends f
       JOIN users u ON (CASE WHEN f.user_id = $1 THEN f.friend_user_id ELSE f.user_id END) = u.id
       WHERE (f.user_id = $1 OR f.friend_user_id = $1) AND u.deleted_at IS NULL`,
      [reqUser]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/friends/:friendId/request", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const friendId = req.params.friendId;
  if (String(reqUser) === String(friendId)) return res.status(400).json({ error: "Tu ne peux pas t'ajouter toi-même" });
  try {
    const exists = await pool.query("SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", [friendId]);
    if (!exists.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    await pool.query(
      `INSERT INTO friends (user_id, friend_user_id, status) VALUES ($1, $2, 'pending')
       ON CONFLICT (user_id, friend_user_id) DO UPDATE SET status = 'pending', updated_at = NOW()`,
      [reqUser, friendId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/friends/:friendId/accept", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const friendId = req.params.friendId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO friends (user_id, friend_user_id, status, updated_at) VALUES ($1, $2, 'accepted', NOW())
       ON CONFLICT (user_id, friend_user_id) DO UPDATE SET status = 'accepted', updated_at = NOW()`,
      [reqUser, friendId]
    );
    await client.query(
      `UPDATE friends SET status = 'accepted', updated_at = NOW() WHERE user_id = $1 AND friend_user_id = $2`,
      [friendId, reqUser]
    );
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

app.delete("/api/friends/:friendId", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const friendId = req.params.friendId;
  try {
    await pool.query(
      `DELETE FROM friends WHERE (user_id = $1 AND friend_user_id = $2) OR (user_id = $2 AND friend_user_id = $1)`,
      [reqUser, friendId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── OAuth configuration ──
const OAUTH_CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.OAUTH_REDIRECT_BASE ? `${process.env.OAUTH_REDIRECT_BASE}/api/auth/callback/google` : "http://localhost:3000/api/auth/callback/google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scope: "openid email profile"
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    redirectUri: process.env.OAUTH_REDIRECT_BASE ? `${process.env.OAUTH_REDIRECT_BASE}/api/auth/callback/discord` : "http://localhost:3000/api/auth/callback/discord",
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userInfoUrl: "https://discord.com/api/users/@me",
    scope: "identify email"
  }
};

// ── OAuth : initiate redirect ──
app.get("/api/auth/oauth/:provider", (req, res) => {
  const provider = req.params.provider;
  const config = OAUTH_CONFIG[provider];
  if (!config || !config.clientId) {
    return res.status(400).json({ error: `Provider ${provider} non configuré` });
  }

  const stateToken = crypto.randomBytes(16).toString("hex");
  const cookieOpts = {
    httpOnly: true,
    maxAge: 600000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/callback"
  };
  // Store state in a short-lived cookie for CSRF protection
  res.cookie(`oauth_state_${provider}`, stateToken, cookieOpts);
  // Remember where to send the user back: the web app (default) or the native
  // app via a custom-scheme deep link (?return=app, used by the Capacitor shell
  // which opens this flow in the system browser).
  const returnMode = req.query.return === "app" ? "app" : "web";
  res.cookie(`oauth_return_${provider}`, returnMode, cookieOpts);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scope,
    state: stateToken
  });

  res.redirect(`${config.authUrl}?${params.toString()}`);
});

// ── OAuth : callback handler ──
app.all("/api/auth/callback/:provider", async (req, res) => {
  const provider = req.params.provider;
  const config = OAUTH_CONFIG[provider];
  if (!config) return res.status(400).send("Provider inconnu");

  // Where to return the user: web app ("/") or native app (custom scheme).
  const returnMode = req.cookies?.[`oauth_return_${provider}`] || "web";
  res.clearCookie(`oauth_return_${provider}`, { path: "/api/auth/callback" });
  const sendResult = (query) =>
    res.redirect(returnMode === "app" ? `spritedex://auth?${query}` : `/?${query}`);

  const code = req.query.code || req.body?.code;
  if (!code) return res.status(400).send("Code manquant");

  // SECURITY: verify the OAuth `state` matches the value we set in an httpOnly
  // cookie before initiating the redirect. This prevents CSRF login/link
  // attacks where an attacker tricks a victim into completing an OAuth flow
  // initiated by the attacker.
  const returnedState = req.query.state || req.body?.state;
  const expectedState = req.cookies?.[`oauth_state_${provider}`];
  res.clearCookie(`oauth_state_${provider}`, { path: "/api/auth/callback" });
  if (!returnedState || !expectedState || returnedState !== expectedState) {
    console.warn(`[OAuth] state mismatch for provider ${provider}`);
    return sendResult("authError=invalid_state");
  }

  try {
    // Exchange code for token
    const tokenParams = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code"
    });

    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: tokenParams.toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("OAuth token error:", tokenData);
      return sendResult("authError=token_failed");
    }

    // Get user info
    let email, username, avatarUrl;
    if (provider === "google") {
      const userRes = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userRes.json();
      email = user.email;
      username = user.name || user.email.split("@")[0];
      avatarUrl = user.picture || "";
    } else if (provider === "discord") {
      const userRes = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userRes.json();
      email = user.email;
      username = user.global_name || user.username;
      avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : "";
    }

    if (!email) return sendResult("authError=no_email");

    // Find or create user
    let userRow = await pool.query("SELECT id, username, avatar_url FROM users WHERE email = $1 AND deleted_at IS NULL", [email.toLowerCase()]);
    if (userRow.rows.length === 0) {
      userRow = await pool.query(
        `INSERT INTO users (username, email, email_verified, avatar_url, oauth_provider, age_confirmed)
         VALUES ($1, $2, TRUE, $3, $4, TRUE) RETURNING id, username, avatar_url`,
        [username, email.toLowerCase(), avatarUrl, provider]
      );
    } else {
      // Update avatar if empty
      if (!userRow.rows[0].avatar_url && avatarUrl) {
        await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [avatarUrl, userRow.rows[0].id]);
      }
      // Mark email as verified (OAuth emails are pre-verified)
      await pool.query("UPDATE users SET email_verified = TRUE WHERE id = $1", [userRow.rows[0].id]);
    }

    const dbUser = userRow.rows[0];
    const sessionToken = await createSession(dbUser.id);
    secLog.logSecurityEvent(pool, { req, userId: dbUser.id, email, event: "login", status: "ok", details: { method: "oauth", provider } });

    // Return to the app (web query string or native deep link) with the token.
    const query = `authToken=${sessionToken}&authUser=${encodeURIComponent(JSON.stringify({ id: dbUser.id, username: dbUser.username, avatar_url: dbUser.avatar_url || avatarUrl }))}`;
    sendResult(query);
  } catch (err) {
    console.error("OAuth callback error:", err);
    sendResult("authError=server_error");
  }
});

// ── Auth : Logout ──
app.post("/api/auth/logout", async (req, res) => {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    await pool.query("DELETE FROM sessions WHERE token = $1", [token]).catch(() => {});
  }
  res.json({ ok: true });
});

// ── Auth : Verify token (check session validity) ──
app.get("/api/auth/me", async (req, res) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }
  const token = authHeader.slice(7);
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, u.privacy, u.email_verified, u.created_at, u.last_active_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL`,
      [token]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: "Session expirée" });
    }
    pool.query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [result.rows[0].id]).catch(() => {});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collection : GET all entries for user ──
app.get("/api/collection/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    // Privacy check: only owner, squad mates (if squad_only), or anyone (if public)
    const userResult = await pool.query("SELECT id, privacy FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
    if (!userResult.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const access = await checkPrivacyAccess(req, userId, userResult.rows[0].privacy);
    if (access === "blocked") {
      return res.status(403).json({ error: "Collection non accessible" });
    }
    const result = await pool.query(
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, updated_at FROM sprite_entries WHERE user_id = $1",
      [userId]
    );
    const collection = {};
    for (const row of result.rows) {
      collection[row.variant_id] = {
        spriteId: row.sprite_id,
        status: row.status,
        note: row.note || "",
        priority: row.priority || "none",
        obtainedAt: row.obtained_at || null,
        updatedAt: row.updated_at,
      };
    }
    res.json(collection);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad activity logger ──
async function logSquadActivity(userId, variantId, spriteId, action) {
  try {
    const squads = await pool.query(
      `SELECT sm.squad_id FROM squad_members sm WHERE sm.user_id = $1`,
      [userId]
    );
    const userResult = await pool.query("SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
    const username = userResult.rows[0]?.username || "Un joueur";
    const actionLabel = action === "owned" ? "a obtenu" : "a repéré";
    const spriteResult = await pool.query("SELECT name FROM sprites WHERE id = $1", [spriteId]);
    const spriteName = spriteResult.rows[0]?.name || spriteId;

    for (const row of squads.rows) {
      await pool.query(
        `INSERT INTO squad_activity (squad_id, user_id, sprite_id, action) VALUES ($1, $2, $3, $4)`,
        [row.squad_id, userId, variantId, action]
      );
      // Notify squad members asynchronously; do not block the request.
      pushService.notifySquadMembers(pool, row.squad_id, userId, {
        title: "SPRITNEX — Escouade",
        body: `${username} ${actionLabel} ${spriteName}`,
        icon: "/icons/icon-192x192.png",
        url: `/?squad=${row.squad_id}`
      }).catch(err => console.error("[PUSH] squad notify failed:", err));
    }
  } catch (err) {
    console.error("Failed to log squad activity:", err);
  }
}

// ── Comparisons : GET comparison between two users ──
app.get("/api/comparisons/users/:userAId/:userBId", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const { userAId, userBId } = req.params;
    const usersResult = await pool.query(
      "SELECT id, username, privacy FROM users WHERE id = ANY($1) AND deleted_at IS NULL",
      [[userAId, userBId]]
    );
    const userMap = Object.fromEntries(usersResult.rows.map(u => [u.id, u]));
    if (!userMap[userAId] || !userMap[userBId]) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    const accessA = await checkPrivacyAccess(req, userAId, userMap[userAId].privacy || "private");
    const accessB = await checkPrivacyAccess(req, userBId, userMap[userBId].privacy || "private");
    if (accessA === "blocked" || accessB === "blocked") {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    const [catalogue, collectionA, collectionB] = await Promise.all([
      getServerCompareCatalogItems(),
      loadServerCompareCollection(userAId),
      loadServerCompareCollection(userBId)
    ]);

    const userA = { id: userAId, displayName: userMap[userAId].username || userAId, collection: collectionA };
    const userB = { id: userBId, displayName: userMap[userBId].username || userBId, collection: collectionB };

    let result = compareCollectionsServer(userA, userB, catalogue);
    result = applyServerCompareFilters(result, req.query);

    res.json(result);
  } catch (err) {
    console.error("[/api/comparisons]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collection : UPSERT one entry ──
app.put("/api/collection/:userId/:spriteId", security.validateBody(security.schemas.collectionEntrySchema), async (req, res) => {
  const { userId } = req.params;
  let { spriteId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  if (!spriteId || spriteId.length > 120) return res.status(400).json({ error: "spriteId invalide" });
  const { variantId, spriteId: baseSpriteId } = await normalizeVariantId(spriteId);
  const { status, note, priority, obtainedAt } = req.validatedBody;
  try {
    const prev = await pool.query(
      `SELECT status FROM sprite_entries WHERE user_id = $1 AND variant_id = $2`,
      [userId, variantId]
    );
    const prevStatus = prev.rows.length ? prev.rows[0].status : "new";

    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, NOW())
       ON CONFLICT (user_id, variant_id)
       DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                     status = COALESCE($4, sprite_entries.status),
                     note = COALESCE($5, sprite_entries.note),
                     priority = COALESCE($6, sprite_entries.priority),
                     obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                     updated_at = NOW()`,
      [userId, variantId, baseSpriteId, status || "new", note ?? "", priority || "none", obtainedAt || null]
    );

    const newStatus = status || "new";
    if (newStatus !== prevStatus) {
      pool.query(
        `INSERT INTO collection_history (user_id, sprite_id, old_status, new_status) VALUES ($1, $2, $3, $4)`,
        [userId, variantId, prevStatus, newStatus]
      ).catch(() => {});
    }

    if ((status === "owned") && prevStatus !== "owned") {
      logSquadActivity(userId, variantId, baseSpriteId, "owned");
    }

    res.json({ ok: true });
    broadcastSquadUpdate(userId);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collection : bulk sync ──
app.post("/api/collection/:userId/sync", security.syncLimiter, security.validateBody(security.schemas.collectionSyncSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { collection } = req.validatedBody;
  const normalizedCollection = await normalizeCollection(collection);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, COALESCE($8::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($8::timestamptz, NOW())`,
        [
          userId, variantId, entry.spriteId || null,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: Object.keys(normalizedCollection).length });
    broadcastSquadUpdate(userId);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur sync" });
  } finally {
    client.release();
  }
});

// ── Collection : bulk import (legacy) ──
// SECURITY: this route previously had NO authentication check at all, letting
// anyone overwrite any user's collection just by knowing their userId. It is
// unused by the current frontend (which uses /sync instead), but is kept for
// backward compatibility with the same access control as /sync.
app.post("/api/collection/:userId/import", security.syncLimiter, security.validateBody(security.schemas.collectionSyncSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { collection } = req.validatedBody;
  const normalizedCollection = await normalizeCollection(collection);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, COALESCE($8::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($8::timestamptz, NOW())`,
        [
          userId, variantId, entry.spriteId || null,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: Object.keys(normalizedCollection).length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur import" });
  } finally {
    client.release();
  }
});

// ── Reset ──
app.delete("/api/collection/:userId", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    await pool.query("DELETE FROM sprite_entries WHERE user_id = $1", [req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collection history ──
// SECURITY: this route had no access control at all — anyone could read any
// user's full change history just by guessing/knowing a userId. History is
// private (not shared with squads, unlike squad_activity), so only the owner
// may read it.
app.get("/api/history/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const result = await pool.query(
      `SELECT sprite_id, old_status, new_status, created_at
       FROM collection_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM collection_history WHERE user_id = $1`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].count);

    const weekResult = await pool.query(
      `SELECT date_trunc('week', created_at) AS week, COUNT(*) AS changes,
              COUNT(*) FILTER (WHERE new_status = 'owned') AS acquisitions
       FROM collection_history
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '12 weeks'
       GROUP BY week ORDER BY week DESC`,
      [userId]
    );

    res.json({
      history: result.rows,
      total,
      hasMore: offset + result.rows.length < total,
      weeklyStats: weekResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

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
      `INSERT INTO squad_members (squad_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
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
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1",
      [squad.id]
    );
    if (parseInt(memberCount.rows[0].count) >= 10) {
      return res.status(400).json({ error: "Escouade pleine (max 10)" });
    }

    await pool.query(
      `INSERT INTO squad_members (squad_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [squad.id, userId]
    );
    res.json(squad);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : get squad details + members with collections ──
app.get("/api/squads/:code", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, created_by, created_at FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    if (!(await requireSquadMember(req, res, squadResult.rows[0].id))) return;
    const squad = squadResult.rows[0];

    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, sm.joined_at
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1
       ORDER BY sm.joined_at`,
      [squad.id]
    );

    const members = [];
    for (const member of membersResult.rows) {
      const entriesResult = await pool.query(
        "SELECT sprite_id, status, priority, updated_at FROM sprite_entries WHERE user_id = $1",
        [member.id]
      );
      const collection = {};
      let lastUpdated = null;
      for (const row of entriesResult.rows) {
        collection[row.sprite_id] = { status: row.status, priority: row.priority || "none" };
        if (row.updated_at && (!lastUpdated || row.updated_at > lastUpdated)) {
          lastUpdated = row.updated_at;
        }
      }
      members.push({
        userId: member.id,
        username: member.username,
        avatarUrl: member.avatar_url || "",
        role: String(member.id) === String(squad.created_by) ? "owner" : "member",
        collection,
        entryCount: entriesResult.rows.length,
        lastUpdated
      });
    }

    res.json({
      id: squad.id,
      code: squad.code,
      name: squad.name,
      createdBy: squad.created_by,
      createdAt: squad.created_at,
      joinOpen: squad.join_open !== false,
      members
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
      "DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squadResult.rows[0].id, userId]
    );

    const remaining = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1",
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
    await pool.query(
      "DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squad.id, targetUserId]
    );
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

// ── Squad : history ──
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
      `SELECT sa.sprite_id, sa.action, sa.created_at, u.username
       FROM squad_activity sa
       JOIN users u ON u.id = sa.user_id
       WHERE sa.squad_id = $1 AND sa.created_at > NOW() - INTERVAL '1 day' * $2
       ORDER BY sa.created_at DESC
       LIMIT $3`,
      [squadResult.rows[0].id, days, limit]
    );

    res.json({ entries: result.rows });
  } catch (err) {
    console.error(err);
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

// ── News : sprite update system ──
const SPRITE_KEYWORDS = [
  "sprite", "sprites", "esprit", "esprits",
  "gummy", "gold", "galaxy", "holofoil", "rift",
  "legendary", "mythic", "légendaire", "mythique",
  "mastery monday", "catch up",
  "gold hours", "gummy hours", "galaxy hours",
  "collecte effrénée", "pouvoir d'esprit"
];

const EVENT_PATTERNS = [
  { regex: /mastery monday|lundi de la maîtrise/i, type: "weekly_event", name: "Mastery Monday" },
  { regex: /holofoil hours/i, type: "weekly_event", name: "Holofoil Hours" },
  { regex: /gold\s*(?:&\s*gummy|\s*hours|fish)|gummy\s*hours|mythic goldfish/i, type: "weekly_event", name: "Gold & Gummy Hours" },
  { regex: /galaxy hours/i, type: "weekly_event", name: "Galaxy Hours" },
  { regex: /catch up day|catch up/i, type: "catch_up_event", name: "Catch Up Day" },
  { regex: /gone wild/i, type: "seasonal_event", name: "Gone Wild" },
  { regex: /summer hits|summer adventure|fun in the sun/i, type: "seasonal_event", name: "Summer Event" },
];

function detectEventInfo(text) {
  const normalized = (text || "").toLowerCase();
  for (const pattern of EVENT_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return { type: pattern.type, name: pattern.name };
    }
  }
  const newSpriteMatch = text.match(/new sprites?[:—]\s*(.+)/i);
  if (newSpriteMatch) {
    return { type: "content_update", name: `New Sprites: ${newSpriteMatch[1].trim().slice(0, 60)}` };
  }
  return null;
}

function matchesSpriteKeywords(text) {
  const lower = text.toLowerCase();
  return SPRITE_KEYWORDS.some(kw => lower.includes(kw));
}

function newsHash(source, title, date) {
  return crypto.createHash("md5").update(`${source}|${title}|${date}`).digest("hex");
}

async function fetchFortniteAPINews() {
  const results = [];
  try {
    const res = await fetch("https://fortnite-api.com/v2/news/br?language=fr");
    if (!res.ok) return results;
    const json = await res.json();
    const motds = json.data?.motds || [];
    for (const item of motds) {
      const text = `${item.title || ""} ${item.body || ""}`;
      if (matchesSpriteKeywords(text)) {
        results.push({
          source: "fortnite-api",
          title: item.title || "News Fortnite",
          description: item.body || "",
          image: item.image || null,
          date: new Date().toISOString(),
          link: "https://fortnite.com/news?lang=fr",
          hash: newsHash("fortnite-api", item.title || "", item.id || "")
        });
      }
    }
  } catch (err) {
    console.error("Fortnite-API news fetch failed:", err.message);
  }
  return results;
}

async function fetchFortniteAPINewsEN() {
  const results = [];
  try {
    const res = await fetch("https://fortnite-api.com/v2/news/br?language=en");
    if (!res.ok) return results;
    const json = await res.json();
    const motds = json.data?.motds || [];
    for (const item of motds) {
      const text = `${item.title || ""} ${item.body || ""}`;
      if (matchesSpriteKeywords(text)) {
        results.push({
          source: "fortnite-api-en",
          title: item.title || "Fortnite News",
          description: item.body || "",
          image: item.image || null,
          date: new Date().toISOString(),
          link: "https://fortnite.com/news?lang=en",
          hash: newsHash("fortnite-api-en", item.title || "", item.id || "")
        });
      }
    }
  } catch (err) {
    console.error("Fortnite-API EN news fetch failed:", err.message);
  }
  return results;
}

async function fetchFortniteGGNews() {
  const results = [];
  let browser = null;
  try {
    const executablePath = process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    browser = await puppeteer.launch({
      executablePath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
    await page.goto("https://fortnite.gg/news", { waitUntil: "networkidle2", timeout: 30000 });

    const items = await page.evaluate(() => {
      const entries = [];
      const articles = document.querySelectorAll("article, .news-item, [class*='news']");
      if (articles.length > 0) {
        articles.forEach(el => {
          const title = (el.querySelector("h2, h3, .title, [class*='title']") || {}).textContent || "";
          const desc = (el.querySelector("p, .desc, .description, [class*='desc']") || {}).textContent || "";
          const date = (el.querySelector("time, .date, [class*='date']") || {}).textContent || "";
          const img = (el.querySelector("img") || {}).src || null;
          if (title.trim()) entries.push({ title: title.trim(), desc: desc.trim(), date: date.trim(), img });
        });
      }
      if (entries.length === 0) {
        const body = document.body.innerText;
        const lines = body.split("\n").map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          if (/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(lines[i])) {
            entries.push({ title: lines[i + 1] || "", desc: lines[i + 2] || "", date: lines[i], img: null });
          }
        }
      }
      return entries;
    });

    for (const item of items) {
      const text = `${item.title} ${item.desc}`;
      if (matchesSpriteKeywords(text)) {
        const dateStr = item.date ? (new Date(item.date).toISOString() || new Date().toISOString()) : new Date().toISOString();
        results.push({
          source: "fortnite.gg",
          title: item.title,
          description: item.desc.slice(0, 300),
          image: item.img,
          date: dateStr,
          link: "https://fortnite.gg/news",
          hash: newsHash("fortnite.gg", item.title, item.date || "")
        });
      }
    }
    console.log(`Fortnite.gg scraped: ${items.length} items, ${results.length} matched`);
  } catch (err) {
    console.error("Fortnite.gg scrape failed:", err.message);
  } finally {
    if (browser) await browser.close();
  }
  return results;
}

async function fetchFortniteSTWNews() {
  const results = [];
  try {
    const res = await fetch("https://fortnite-api.com/v2/news/stw?language=fr");
    if (!res.ok) return results;
    const json = await res.json();
    const motds = json.data?.messages || [];
    for (const item of motds) {
      const text = `${item.title || ""} ${item.body || ""}`;
      if (matchesSpriteKeywords(text)) {
        results.push({
          source: "fortnite-stw",
          title: item.title || "News STW",
          description: item.body || "",
          image: item.image || null,
          date: new Date().toISOString(),
          link: null,
          hash: newsHash("fortnite-stw", item.title || "", item.title || "")
        });
      }
    }
  } catch (err) {
    console.error("Fortnite STW news fetch failed:", err.message);
  }
  return results;
}

async function extractEventsFromNews(newsItems) {
  const spritesRes = await pool.query("SELECT id, name FROM sprites");
  const sprites = spritesRes.rows;
  const seasonRes = await pool.query("SELECT id FROM seasons ORDER BY start_date DESC NULLS LAST LIMIT 1");
  const fallbackSeasonId = seasonRes.rows[0]?.id || null;

  const insertedEventIds = new Set();
  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const eventInfo = detectEventInfo(text);
    if (!eventInfo) continue;

    const eventId = "event_" + crypto.createHash("md5").update(`${eventInfo.name}|${item.date || ""}|${item.source}`).digest("hex").slice(0, 16);
    if (insertedEventIds.has(eventId)) continue;
    insertedEventIds.add(eventId);

    try {
      await pool.query(
        `INSERT INTO events (id, name, type, season_id, start_date, end_date, data_status, sources)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = $2, type = $3, season_id = $4, start_date = $5::timestamptz, end_date = $6, data_status = $7, sources = $8`,
        [
          eventId,
          eventInfo.name,
          eventInfo.type,
          fallbackSeasonId,
          item.date || null,
          null,
          "observed",
          JSON.stringify([item.source]),
        ]
      );
    } catch (err) {
      console.error("[EVENTS] failed to insert event", eventId, err.message);
      continue;
    }

    // Link explicitly mentioned sprites to this event (only if they have no event yet)
    if (["content_update", "catch_up_event", "seasonal_event"].includes(eventInfo.type)) {
      const normalizedText = text.toLowerCase();
      for (const sprite of sprites) {
        if (!sprite.name) continue;
        const spriteNameLower = sprite.name.toLowerCase();
        const shortName = spriteNameLower.replace(" sprite", "").trim();
        if (normalizedText.includes(spriteNameLower) || (shortName.length > 2 && normalizedText.includes(shortName))) {
          await pool.query(
            `UPDATE sprites SET event_id = $1 WHERE id = $2 AND event_id IS NULL`,
            [eventId, sprite.id]
          ).catch(() => {});
        }
      }
    }
  }

  if (insertedEventIds.size > 0) {
    console.log(`[EVENTS] ${insertedEventIds.size} events extracted from news`);
  }
}

async function extractAvailabilityFromNews(newsItems) {
  const spritesRes = await pool.query("SELECT id, name, availability, dates, first_observed_at, officially_announced_at FROM sprites");
  const sprites = spritesRes.rows;
  let updated = 0;
  const insertedPeriodIds = new Set();

  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const normalizedText = text.toLowerCase();

    // Skip recurring weekly events (they don't change a sprite's base availability)
    const eventInfo = detectEventInfo(text);
    if (eventInfo && eventInfo.type === "weekly_event") continue;

    let status = null;
    if (/new sprites?|have arrived|now appearing|are appearing|sont apparus|sont arriv[eé]s|disponible maintenant|available now|hit the island|drop into|now in/i.test(normalizedText)) {
      status = "available";
    } else if (/coming soon|bientôt disponible|announced|annonce officielle|kicks off|coming to the island/i.test(normalizedText)) {
      status = "upcoming";
    } else if (/no longer|n'?est plus|removed|leaves the island|leaving the island|gone from|disappeared/i.test(normalizedText)) {
      status = "not_observed";
    }
    if (!status) continue;

    const newsDate = item.date ? new Date(item.date).toISOString() : new Date().toISOString();
    const confidence = (item.source && (item.source.includes("official") || item.source.includes("fortnite-api"))) ? "official" : "observed";

    for (const sprite of sprites) {
      if (!sprite.name) continue;
      const spriteNameLower = sprite.name.toLowerCase();
      const shortName = spriteNameLower.replace(" sprite", "").trim();
      if (!normalizedText.includes(spriteNameLower) && !(shortName.length > 2 && normalizedText.includes(shortName))) continue;

      const current = sprite.availability || {};
      const newAvailability = {
        ...current,
        status,
        confidence,
      };

      if (status === "available") {
        newAvailability.startDate = current.startDate || newsDate;
        newAvailability.endDate = null;
      } else if (status === "upcoming") {
        newAvailability.startDate = null;
        newAvailability.endDate = null;
      } else if (status === "not_observed") {
        // Keep existing start/end and only mark as no longer observed
        if (current.endDate) newAvailability.endDate = current.endDate;
      }

      const newDates = buildDates(sprite.dates, sprite.first_observed_at, newsDate, sprite.officially_announced_at);
      await pool.query(
        `UPDATE sprites SET availability = $1, dates = $2, last_verified_at = $3 WHERE id = $4`,
        [JSON.stringify(newAvailability), JSON.stringify(newDates), newsDate, sprite.id]
      );

      const periodStart = status === "upcoming" ? null : (newAvailability.startDate || newsDate);
      const eventKey = "";
      const periodId = "availability_" + crypto.createHash("md5").update(`${sprite.id}|${periodStart || "unknown"}|${eventKey}`).digest("hex").slice(0, 16);
      if (!insertedPeriodIds.has(periodId)) {
        insertedPeriodIds.add(periodId);
        await pool.query(
          `INSERT INTO availability_periods (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
           VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             end_date = COALESCE($4::timestamptz, availability_periods.end_date),
             status = COALESCE($5, availability_periods.status),
             confidence = COALESCE($7, availability_periods.confidence),
             data_status = COALESCE($8, availability_periods.data_status),
             sources = COALESCE($9, availability_periods.sources)`,
          [periodId, sprite.id, periodStart, newAvailability.endDate, status, null, confidence, "complete", JSON.stringify([item.source])]
        );
      }
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[AVAILABILITY] ${updated} sprite availability updates extracted from news`);
  }
}

async function extractRecurrenceFromNews(newsItems) {
  const spritesRes = await pool.query("SELECT id, name, recurrence, dates, first_observed_at, officially_announced_at FROM sprites");
  const sprites = spritesRes.rows;
  let updated = 0;

  for (const item of newsItems) {
    const text = `${item.title || ""} ${item.description || ""}`;
    const normalizedText = text.toLowerCase();
    const newsDate = item.date ? new Date(item.date).toISOString() : new Date().toISOString();

    const officiallyConfirmed = /officially|epic games confirms|confirmed by epic|announced by epic|officiellement/i.test(normalizedText);
    let status = null;

    if (/confirmed recurring|confirmed to return|officially returning|will return|epic games confirms.*return/i.test(normalizedText)) {
      status = "confirmed_recurring";
    } else if (/never returning|won'?t return|not returning|exclusive|limited time only|gone for good|last chance forever|n'?est plus disponible|n'?est plus de retour/i.test(normalizedText)) {
      status = "not_confirmed";
    } else if (/returns|de retour|returning|back|back in|may return|could return|possible return|retour possible/i.test(normalizedText)) {
      status = officiallyConfirmed ? "confirmed_recurring" : "possible_return";
    }

    if (!status) continue;

    const evidence = item.title || item.description || null;
    for (const sprite of sprites) {
      if (!sprite.name) continue;
      const spriteNameLower = sprite.name.toLowerCase();
      const shortName = spriteNameLower.replace(" sprite", "").trim();
      if (!normalizedText.includes(spriteNameLower) && !(shortName.length > 2 && normalizedText.includes(shortName))) continue;

      const current = buildRecurrence(sprite.recurrence);
      // Do not downgrade a confirmed recurrence to a possible one unless official
      if (current.status === "confirmed_recurring" && status !== "confirmed_recurring") continue;

      const newRecurrence = {
        status,
        officiallyConfirmed: status === "confirmed_recurring" || officiallyConfirmed,
        evidence,
      };

      const newDates = buildDates(sprite.dates, sprite.first_observed_at, newsDate, sprite.officially_announced_at);
      await pool.query(
        `UPDATE sprites SET recurrence = $1, dates = $2, last_verified_at = $3 WHERE id = $4`,
        [JSON.stringify(newRecurrence), JSON.stringify(newDates), newsDate, sprite.id]
      );
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[RECURRENCE] ${updated} sprite recurrence updates extracted from news`);
  }
}

async function refreshNews() {
  const [frNews, enNews, stwNews, ggNews] = await Promise.all([
    fetchFortniteAPINews(),
    fetchFortniteAPINewsEN(),
    fetchFortniteSTWNews(),
    fetchFortniteGGNews()
  ]);
  const all = [...frNews, ...enNews, ...stwNews, ...ggNews];
  const insertedItems = [];
  for (const item of all) {
    try {
      const result = await pool.query(
        `INSERT INTO sprite_news (hash, source, title, description, image, link, news_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hash) DO NOTHING
         RETURNING id, title`,
        [item.hash, item.source, item.title, item.description.slice(0, 500), item.image, item.link, item.date]
      );
      if (result.rows.length > 0) {
        insertedItems.push(item);
      }
    } catch (err) {
      // duplicate or error, skip
    }
  }
  if (insertedItems.length > 0) {
    console.log(`News: ${insertedItems.length} new items inserted`);
    broadcastNews();
    notifyNewsSubscribers(insertedItems);
  }

  // Extract events, availability and recurrence from scraped news (existing + newly inserted)
  const existingNews = await pool.query(
    "SELECT source, title, description, image, link, news_date AS date FROM sprite_news ORDER BY news_date DESC LIMIT 500"
  );
  for (const item of existingNews.rows) {
    await ensureSource(item.source, {
      title: item.title,
      url: item.link,
      publishedAt: item.date,
    });
  }
  await extractEventsFromNews(existingNews.rows);
  await extractAvailabilityFromNews(existingNews.rows);
  await extractRecurrenceFromNews(existingNews.rows);
}

async function notifyNewsSubscribers(items) {
  if (!items.length) return;
  const title = items.length === 1
    ? "Nouvelle actu SPRITNEX"
    : `${items.length} nouvelles actus`;
  const body = items.length === 1
    ? items[0].title || "Un article vient d'être ajouté"
    : items[0].title || `${items.length} articles sur les sprites`;
  try {
    const results = await pushService.notifyNewsSubscribers(pool, {
      title,
      body,
      icon: items[0].image || "/icons/icon-192x192.png",
      url: items[0].link || "/"
    });
    const ok = results.filter(r => r.ok).length;
    console.log(`[PUSH] News notification sent to ${ok}/${results.length} devices`);
  } catch (err) {
    console.error("[PUSH] Failed to send news notification:", err);
  }
}

function broadcastNews() {
  const msg = JSON.stringify({ type: "news_update" });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

let newsInterval = null;
async function startNewsCron() {
  await pool.query(`UPDATE sprite_news SET link = 'https://fortnite.com/news?lang=fr' WHERE (link IS NULL OR link = 'https://www.fortnite.com/news') AND source LIKE 'fortnite-api%'`).catch(() => {});
  await pool.query(`UPDATE sprite_news SET link = 'https://fortnite.gg/news' WHERE link IS NULL AND source = 'fortnite.gg'`).catch(() => {});
  refreshNews();
  newsInterval = setInterval(refreshNews, 30 * 60 * 1000);
}

// ── News : API endpoint ──
app.get("/api/news", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const result = await pool.query(
      `SELECT id, source, title, description, image, link, news_date, created_at
       FROM sprite_news
       ORDER BY news_date DESC, created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await pool.query(`SELECT COUNT(*) FROM sprite_news`);
    const total = parseInt(countResult.rows[0].count);
    res.json({ news: result.rows, total, hasMore: offset + result.rows.length < total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : join link redirect ──
app.get("/squad/join/:code", (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  res.redirect(`/?joinSquad=${encodeURIComponent(code)}`);
});

// ── 404 handler ──
// Reached only when no route or static asset matched. API paths get a clean
// JSON 404; everything else gets the themed 404.html page (status 404).
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Ressource introuvable" });
  }
  res.status(404).sendFile(path.join(__dirname, "404.html"));
});

// ── Global error handler ──
// Catches malformed JSON bodies, payload-too-large errors and any unexpected
// errors, returning a clean JSON message. Stack traces are never sent to the
// client (they are only logged server-side).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Requête trop volumineuse" });
  }
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({ error: "JSON invalide" });
  }
  console.error("[UNHANDLED]", err);
  res.status(500).json({ error: "Erreur serveur" });
});

// ── DB init : ensure ALL tables exist (idempotent schema bootstrap) ──
// Runs on every boot. Creates the full schema if missing so the app can be
// deployed against a brand-new empty PostgreSQL database with zero manual SQL.
async function ensureSquadTables() {
  try {
    // Core reference + user tables (previously created manually in dev).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sprites (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        rarity VARCHAR(30) NOT NULL,
        color VARCHAR(60) NOT NULL,
        effect TEXT NOT NULL,
        variants TEXT[] NOT NULL,
        available VARCHAR(20) NOT NULL DEFAULT 'available',
        added_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS variant_meta (
        name VARCHAR(30) PRIMARY KEY,
        label VARCHAR(50) NOT NULL,
        bonus TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS seasons (
        id VARCHAR(50) PRIMARY KEY,
        chapter INTEGER,
        season INTEGER,
        name VARCHAR(100),
        name_en VARCHAR(100),
        start_date DATE,
        end_date DATE,
        data_status VARCHAR(20) DEFAULT 'incomplete',
        sources JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_seasons_chapter ON seasons(chapter, season);
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(100),
        type VARCHAR(50),
        season_id VARCHAR(50),
        start_date DATE,
        end_date DATE,
        data_status VARCHAR(20) DEFAULT 'incomplete',
        sources JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_events_season ON events(season_id);
      ALTER TABLE sprites
      ADD COLUMN IF NOT EXISTS catalog_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS slug VARCHAR(50),
      ADD COLUMN IF NOT EXISTS official_name VARCHAR(100),
      ADD COLUMN IF NOT EXISTS season_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS event_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS image VARCHAR(255),
      ADD COLUMN IF NOT EXISTS introduced_in_update VARCHAR(20),
      ADD COLUMN IF NOT EXISTS first_observed_at DATE,
      ADD COLUMN IF NOT EXISTS last_verified_at DATE,
      ADD COLUMN IF NOT EXISTS officially_announced_at DATE,
      ADD COLUMN IF NOT EXISTS ability JSONB,
      ADD COLUMN IF NOT EXISTS acquisition JSONB,
      ADD COLUMN IF NOT EXISTS availability JSONB,
      ADD COLUMN IF NOT EXISTS recurrence JSONB,
      ADD COLUMN IF NOT EXISTS dates JSONB,
      ADD COLUMN IF NOT EXISTS missing_fields JSONB,
      ADD COLUMN IF NOT EXISTS base_summon_cost INTEGER,
      ADD COLUMN IF NOT EXISTS data_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS notes JSONB,
      ADD COLUMN IF NOT EXISTS sources JSONB,
      ADD COLUMN IF NOT EXISTS catalog_version VARCHAR(32),
      ADD COLUMN IF NOT EXISTS catalog_generated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS is_released BOOLEAN DEFAULT TRUE;
      CREATE TABLE IF NOT EXISTS sprite_images (
        sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
        variant VARCHAR(30) NOT NULL,
        image_path VARCHAR(255) NOT NULL,
        PRIMARY KEY (sprite_id, variant)
      );
      CREATE TABLE IF NOT EXISTS availability_periods (
        id VARCHAR(100) PRIMARY KEY,
        sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
        start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'unknown',
        event_id VARCHAR(100),
        confidence VARCHAR(20) DEFAULT 'unknown',
        data_status VARCHAR(20) DEFAULT 'incomplete',
        sources JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (sprite_id, start_date, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_availability_periods_sprite ON availability_periods(sprite_id);
      CREATE INDEX IF NOT EXISTS idx_availability_periods_dates ON availability_periods(start_date, end_date);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sprite_sources (
        id VARCHAR(100) PRIMARY KEY,
        type VARCHAR(30),
        publisher VARCHAR(100),
        title TEXT,
        url TEXT,
        published_at TIMESTAMPTZ,
        observed_at TIMESTAMPTZ,
        last_verified_at TIMESTAMPTZ,
        reliability VARCHAR(20),
        catalog_version VARCHAR(32),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE sprite_sources
        ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    `);
    await pool.query(`
      ALTER TABLE availability_periods ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unknown';
      CREATE TABLE IF NOT EXISTS sprite_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        variant_id VARCHAR(100) NOT NULL,
        sprite_id VARCHAR(50),
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        note TEXT DEFAULT '',
        priority TEXT DEFAULT 'none',
        obtained_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, variant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sprite_entries_user ON sprite_entries (user_id);

      -- Migrate old schema where the variant id was stored in a column named sprite_id
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sprite_entries' AND column_name='sprite_id')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sprite_entries' AND column_name='variant_id') THEN
          ALTER TABLE sprite_entries RENAME COLUMN sprite_id TO variant_id;
        END IF;
      END $$;

      ALTER TABLE sprite_entries ADD COLUMN IF NOT EXISTS sprite_id VARCHAR(50);

      -- Backfill base sprite_id from variant_id using the catalog mapping
      UPDATE sprite_entries se
      SET sprite_id = COALESCE(
        (SELECT sv.sprite_id FROM sprite_variants sv WHERE sv.id = se.variant_id LIMIT 1),
        split_part(se.variant_id, '::', 1),
        se.variant_id
      )
      WHERE sprite_id IS NULL;

      -- Ensure the unique constraint on (user_id, variant_id) is present
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'sprite_entries' AND indexdef LIKE '%(user_id, variant_id)%'
        ) THEN
          ALTER TABLE sprite_entries ADD CONSTRAINT unique_user_variant UNIQUE (user_id, variant_id);
        END IF;
      END $$;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy VARCHAR(20) DEFAULT 'squad_only';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token VARCHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(64);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_iterations INTEGER;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cgu_accepted BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cgu_version VARCHAR(32);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cgu_accepted_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS age_confirmed BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cookie_consent JSONB;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS squads (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(50) NOT NULL DEFAULT 'Mon escouade',
        created_by INTEGER REFERENCES users(id),
        join_open BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS squad_members (
        squad_id INTEGER REFERENCES squads(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (squad_id, user_id)
      );
      -- The primary key (squad_id, user_id) does not efficiently serve
      -- lookups by user_id alone (used by shareSquad() to find common squads
      -- between two users on every privacy check) — add a dedicated index.
      CREATE INDEX IF NOT EXISTS idx_squad_members_user ON squad_members (user_id);

      CREATE TABLE IF NOT EXISTS friends (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        friend_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, friend_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends (friend_user_id);
    `);
    await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS join_open BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sprite_variants (
        id VARCHAR(100) PRIMARY KEY,
        sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
        variant_type VARCHAR(30) NOT NULL,
        name VARCHAR(100) NOT NULL,
        official_name VARCHAR(100),
        slug VARCHAR(100),
        rarity VARCHAR(30),
        release_status VARCHAR(20),
        first_observed_at DATE,
        summon_cost INTEGER,
        sprite_chest_drop_chance_pct NUMERIC,
        extra_effect_ref VARCHAR(50),
        effect JSONB,
        acquisition JSONB,
        image_path VARCHAR(255),
        suggested_image_path VARCHAR(255),
        availability JSONB,
        data_status VARCHAR(20),
        sources JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (sprite_id, variant_type)
      );
      CREATE INDEX IF NOT EXISTS idx_sprite_variants_sprite ON sprite_variants(sprite_id);
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS official_name VARCHAR(100);
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS rarity VARCHAR(30);
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS effect JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS acquisition JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS recurrence JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS dates JSONB;
      ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS missing_fields JSONB;
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS squad_activity (
        id SERIAL PRIMARY KEY,
        squad_id INTEGER REFERENCES squads(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        sprite_id TEXT NOT NULL,
        action VARCHAR(20) NOT NULL DEFAULT 'owned',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_squad_activity_squad ON squad_activity (squad_id, created_at DESC);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sprite_news (
        id SERIAL PRIMARY KEY,
        hash VARCHAR(32) UNIQUE NOT NULL,
        source VARCHAR(30) NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        image TEXT,
        link TEXT,
        news_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS collection_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        sprite_id TEXT NOT NULL,
        old_status VARCHAR(20),
        new_status VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_collection_history_user ON collection_history (user_id, created_at DESC);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS legacy_sprite_name_map (
        old_name TEXT PRIMARY KEY,
        sprite_id TEXT NOT NULL,
        variant_name TEXT NOT NULL DEFAULT 'Base',
        status TEXT NOT NULL DEFAULT 'mapped',
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migration_errors (
        id SERIAL PRIMARY KEY,
        table_name TEXT NOT NULL,
        original_key TEXT NOT NULL,
        user_id INTEGER,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog_change_history (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(30) NOT NULL DEFAULT 'sprite',
        entity_id VARCHAR(100) NOT NULL,
        field VARCHAR(100) NOT NULL,
        previous_value JSONB,
        new_value JSONB,
        changed_by VARCHAR(100),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason TEXT,
        source_id VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_change_history_entity ON catalog_change_history (entity_id, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_change_history_changed_at ON catalog_change_history (changed_at DESC);
    `);
    await pushService.ensurePushTables(pool);
    await secLog.ensureSecurityLogTable(pool);
    console.log("Squad tables ready");
  } catch (err) {
    console.error("Failed to create squad tables:", err);
  }
}

// Auto-seed static reference data on every boot. seedReferenceData is idempotent
// (upserts), so new sprites/images added to sprite-data.js are synced into
// existing databases as well as fresh ones.
async function ensureReferenceDataSeeded() {
  try {
    const counts = await seedReferenceData(pool);
    console.log(`Seeded reference data: ${counts.sprites} sprites, ${counts.variants} variants, ${counts.images} images`);
  } catch (err) {
    console.error("Failed to seed reference data:", err);
  }
}

// ── Account deletion cleanup ──
// Permanently removes accounts marked for deletion more than 30 days ago.
// CASCADE constraints handle sprite_entries, sessions, squad_members, etc.
async function purgeDeletedAccounts() {
  try {
    const result = await pool.query(
      `DELETE FROM users
       WHERE deleted_at IS NOT NULL
         AND deleted_at < NOW() - INTERVAL '30 days'
       RETURNING id`
    );
    if (result.rows.length > 0) {
      console.log(`[PURGE] ${result.rows.length} deleted account(s) permanently removed.`);
    }
  } catch (err) {
    console.error("[PURGE] Failed to purge deleted accounts:", err);
  }
}

ensureSquadTables()
  .then(ensureReferenceDataSeeded)
  .then(() => {
    startNewsCron();
    purgeDeletedAccounts();
    secLog.purgeOldSecurityLogs(pool);
    setInterval(() => {
      purgeDeletedAccounts();
      secLog.purgeOldSecurityLogs(pool);
    }, 24 * 60 * 60 * 1000); // once per day
    server.listen(PORT, () => {
      console.log(`SPRITNEX API + WebSocket running on http://localhost:${PORT}`);
    });
  });
