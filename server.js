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
const FROM_EMAIL = process.env.FROM_EMAIL || "SpriteDex <onboarding@resend.dev>";
const APP_URL = process.env.OAUTH_REDIRECT_BASE || "http://localhost:3000";

async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${token}`;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: toEmail,
      subject: "Vérifie ton email — SpriteDex",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SpriteDex</h1>
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
      subject: "Réinitialisation de mot de passe — SpriteDex",
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0c0f20;color:#eef0ff;border-radius:16px;">
          <h1 style="font-size:24px;margin:0 0 8px;color:#00e1ff;">SpriteDex</h1>
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

async function checkPrivacyAccess(req, targetUserId, privacy) {
  const reqUser = await getRequestingUser(req);
  if (String(reqUser) === String(targetUserId)) return "full";
  if (privacy === "public") return "full";
  if (privacy === "squad_only" && reqUser && await shareSquad(reqUser, targetUserId)) return "full";
  return "blocked";
}

// ── Sprites : données de référence ──
app.get("/api/sprites", async (req, res) => {
  try {
    const spritesResult = await pool.query(
      "SELECT id, name, rarity, color, effect, variants, available, added_date FROM sprites ORDER BY added_date, name"
    );
    const imagesResult = await pool.query(
      "SELECT sprite_id, variant, image_path FROM sprite_images"
    );
    const variantsResult = await pool.query(
      "SELECT name, label, bonus FROM variant_meta ORDER BY name"
    );

    const images = {};
    for (const row of imagesResult.rows) {
      if (!images[row.sprite_id]) images[row.sprite_id] = {};
      images[row.sprite_id][row.variant] = row.image_path;
    }

    res.json({
      sprites: spritesResult.rows.map(s => ({ ...s, images: images[s.id] || {} })),
      variantMeta: variantsResult.rows
    });
  } catch (err) {
    console.error(err);
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
  const { email, password, username: reqUsername, cguAccepted, cguVersion, ageConfirmed } = req.validatedBody;
  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Cet email est déjà utilisé" });
    }
    const { salt, hash, iterations } = hashPassword(password);
    const username = reqUsername || email.split("@")[0].replace(/[^a-zA-Z0-9_\-. ]/g, "").slice(0, 24) || "joueur";
    const emailToken = crypto.randomBytes(32).toString("hex");
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, password_salt, password_iterations, email_verify_token, cgu_accepted, cgu_version, cgu_accepted_at, age_confirmed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, username, created_at`,
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
        ageConfirmed === true
      ]
    );
    const user = result.rows[0];
    const token = await createSession(user.id);
    sendVerificationEmail(email.toLowerCase(), emailToken);
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
              push_pref_sync
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
      sync: row.push_pref_sync
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
    sync: "push_pref_sync"
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
      return genericError();
    }
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
    const entries = await pool.query(
      "SELECT sprite_id, status, priority FROM sprite_entries WHERE user_id = $1",
      [user.id]
    );
    const collection = {};
    for (const row of entries.rows) {
      collection[row.sprite_id] = { status: row.status, priority: row.priority || "none" };
    }
    res.json({
      username: user.username,
      avatarUrl: user.avatar_url || "",
      createdAt: user.created_at,
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
    if (privacy && ["public", "squad_only", "private"].includes(privacy)) {
      sets.push(`privacy = $${idx++}`);
      vals.push(privacy);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Rien à mettre à jour" });
    vals.push(userId);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`, vals);
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
    res.json({ ok: true, scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
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
      "SELECT sprite_id, status, note, priority, obtained_at, updated_at FROM sprite_entries WHERE user_id = $1",
      [userId]
    );
    const collection = {};
    for (const row of result.rows) {
      collection[row.sprite_id] = {
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
async function logSquadActivity(userId, spriteId, action) {
  try {
    const squads = await pool.query(
      `SELECT sm.squad_id FROM squad_members sm WHERE sm.user_id = $1`,
      [userId]
    );
    const userResult = await pool.query("SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
    const username = userResult.rows[0]?.username || "Un joueur";
    const actionLabel = action === "owned" ? "a obtenu" : "a repéré";
    const [spriteBase] = String(spriteId).split("_");
    const spriteResult = await pool.query("SELECT name FROM sprites WHERE id = $1", [spriteBase]);
    const spriteName = spriteResult.rows[0]?.name || spriteBase;

    for (const row of squads.rows) {
      await pool.query(
        `INSERT INTO squad_activity (squad_id, user_id, sprite_id, action) VALUES ($1, $2, $3, $4)`,
        [row.squad_id, userId, spriteId, action]
      );
      // Notify squad members asynchronously; do not block the request.
      pushService.notifySquadMembers(pool, row.squad_id, userId, {
        title: "SpriteDex — Escouade",
        body: `${username} ${actionLabel} ${spriteName}`,
        icon: "/icons/icon-192x192.png",
        url: `/?squad=${row.squad_id}`
      }).catch(err => console.error("[PUSH] squad notify failed:", err));
    }
  } catch (err) {
    console.error("Failed to log squad activity:", err);
  }
}

// ── Collection : UPSERT one entry ──
app.put("/api/collection/:userId/:spriteId", security.validateBody(security.schemas.collectionEntrySchema), async (req, res) => {
  const { userId, spriteId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  if (!spriteId || spriteId.length > 120) return res.status(400).json({ error: "spriteId invalide" });
  const { status, note, priority, obtainedAt } = req.validatedBody;
  try {
    const prev = await pool.query(
      `SELECT status FROM sprite_entries WHERE user_id = $1 AND sprite_id = $2`,
      [userId, spriteId]
    );
    const prevStatus = prev.rows.length ? prev.rows[0].status : "new";

    await pool.query(
      `INSERT INTO sprite_entries (user_id, sprite_id, status, note, priority, obtained_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, NOW())
       ON CONFLICT (user_id, sprite_id)
       DO UPDATE SET status = COALESCE($3, sprite_entries.status),
                     note = COALESCE($4, sprite_entries.note),
                     priority = COALESCE($5, sprite_entries.priority),
                     obtained_at = COALESCE($6::timestamptz, sprite_entries.obtained_at),
                     updated_at = NOW()`,
      [userId, spriteId, status || "new", note ?? "", priority || "none", obtainedAt || null]
    );

    const newStatus = status || "new";
    if (newStatus !== prevStatus) {
      pool.query(
        `INSERT INTO collection_history (user_id, sprite_id, old_status, new_status) VALUES ($1, $2, $3, $4)`,
        [userId, spriteId, prevStatus, newStatus]
      ).catch(() => {});
    }

    if ((status === "owned") && prevStatus !== "owned") {
      logSquadActivity(userId, spriteId, "owned");
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [spriteId, entry] of Object.entries(collection)) {
      if (spriteId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, COALESCE($7::timestamptz, NOW()))
         ON CONFLICT (user_id, sprite_id)
         DO UPDATE SET status = $3, note = $4, priority = $5,
                       obtained_at = COALESCE($6::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($7::timestamptz, NOW())`,
        [
          userId, spriteId,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: Object.keys(collection).length });
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [spriteId, entry] of Object.entries(collection)) {
      if (spriteId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, COALESCE($7::timestamptz, NOW()))
         ON CONFLICT (user_id, sprite_id)
         DO UPDATE SET status = $3, note = $4, priority = $5,
                       obtained_at = COALESCE($6::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($7::timestamptz, NOW())`,
        [
          userId, spriteId,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: Object.keys(collection).length });
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

async function refreshNews() {
  const [frNews, enNews, stwNews, ggNews] = await Promise.all([
    fetchFortniteAPINews(),
    fetchFortniteAPINewsEN(),
    fetchFortniteSTWNews(),
    fetchFortniteGGNews()
  ]);
  const all = [...frNews, ...enNews, ...stwNews, ...ggNews];
  let inserted = 0;
  for (const item of all) {
    try {
      await pool.query(
        `INSERT INTO sprite_news (hash, source, title, description, image, link, news_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hash) DO NOTHING`,
        [item.hash, item.source, item.title, item.description.slice(0, 500), item.image, item.link, item.date]
      );
      inserted++;
    } catch (err) {
      // duplicate or error, skip
    }
  }
  if (inserted > 0) {
    console.log(`News: ${inserted} new items inserted`);
    broadcastNews();
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
      CREATE TABLE IF NOT EXISTS sprite_images (
        sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
        variant VARCHAR(30) NOT NULL,
        image_path VARCHAR(255) NOT NULL,
        PRIMARY KEY (sprite_id, variant)
      );
      CREATE TABLE IF NOT EXISTS sprite_entries (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        sprite_id VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'new',
        note TEXT DEFAULT '',
        priority TEXT DEFAULT 'none',
        obtained_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, sprite_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sprite_entries_user ON sprite_entries (user_id);
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
    `);
    await pool.query(`ALTER TABLE squads ADD COLUMN IF NOT EXISTS join_open BOOLEAN NOT NULL DEFAULT TRUE`);
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
    await pushService.ensurePushTables(pool);
    console.log("Squad tables ready");
  } catch (err) {
    console.error("Failed to create squad tables:", err);
  }
}

// Auto-seed static reference data on a fresh database so a brand-new deploy
// has sprites immediately, without a manual `npm run seed` step. Idempotent:
// only runs when the sprites table is empty.
async function ensureReferenceDataSeeded() {
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM sprites");
    if (rows[0].n > 0) return;
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
    setInterval(purgeDeletedAccounts, 24 * 60 * 60 * 1000); // once per day
    server.listen(PORT, () => {
      console.log(`SpriteDex API + WebSocket running on http://localhost:${PORT}`);
    });
  });
