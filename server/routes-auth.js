// routes-auth.js — extracted from server.js

const analytics = require("../analytics");
const security = require("../security");
const secLog = require("../security-logger");
const { LEGACY_PBKDF2_ITERATIONS, PBKDF2_ITERATIONS, createSession, getRequestingUser, hashPassword, verifyPassword } = require("./auth");
const { app, resend, sendPasswordResetEmail, sendVerificationEmail } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { Resend } = require("resend");

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

module.exports = { OAUTH_CONFIG };
