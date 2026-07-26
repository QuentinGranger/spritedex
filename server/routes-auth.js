// routes-auth.js — extracted from server.js

const analytics = require("../analytics");
const security = require("../security");
const secLog = require("../security-logger");
const { LEGACY_PBKDF2_ITERATIONS, PBKDF2_ITERATIONS, burnPasswordWork, createSession, getRequestingUser, hashPassword, hashSessionToken, verifyPassword } = require("./auth");
const { APP_URL, app, resend, sendPasswordResetEmail, sendVerificationEmail } = require("./core");
const { pool } = require("./db");
const { revokeSessionSockets, revokeUserSockets } = require("./ws");
const { normalizeCookieConsent } = require("./consent");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { Resend } = require("resend");

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const OAUTH_EXCHANGE_TTL_MS = 5 * 60 * 1000;

function hashOpaqueToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return null;
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isOAuthExchangeChallenge(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

// ── Auth : Email register ──
app.post("/api/auth/register", security.registerLimiter, security.validateBody(security.schemas.registerSchema), async (req, res) => {
  const { email, password, username: reqUsername, displayName: reqDisplayName, cguAccepted, cguVersion, ageConfirmed, cookieConsent } = req.validatedBody;
  const consentPayload = normalizeCookieConsent(cookieConsent);
  if (!consentPayload) {
    return res.status(400).json({ error: "Consentement invalide" });
  }
  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL", [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Impossible de créer le compte" });
    }
    const { salt, hash, iterations } = await hashPassword(password);
    const rawUsername = reqUsername || email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "") || "joueur";
    const username = rawUsername.length < 3 ? `${rawUsername}_${crypto.randomBytes(3).toString("hex")}` : rawUsername.slice(0, 24);
    const { isUsernameReserved } = require("./username-history");
    if (await isUsernameReserved(username)) {
      return res.status(409).json({ error: "Ce pseudo est déjà pris ou temporairement réservé" });
    }
    const displayName = reqDisplayName || username;
    const emailToken = crypto.randomBytes(32).toString("hex");
    const emailTokenHash = hashOpaqueToken(emailToken);
    const emailTokenExpires = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
    const result = await pool.query(
      `INSERT INTO users (username, display_name, email, password_hash, password_salt, password_iterations, email_verify_token, email_verify_token_expires, cgu_accepted, cgu_version, cgu_accepted_at, age_confirmed, cookie_consent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, username, display_name, created_at`,
      [
        username,
        displayName,
        email.toLowerCase(),
        hash,
        salt,
        iterations,
        emailTokenHash,
        emailTokenExpires,
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
    res.json({ id: user.id, username: user.username, displayName: user.display_name, usernameNormalized: user.username.toLowerCase(), token, emailVerified: false, created_at: user.created_at });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Impossible de créer le compte" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Verify email ──
app.get("/api/auth/verify-email", async (req, res) => {
  const { token } = req.query;
  const tokenHash = hashOpaqueToken(token);
  if (!tokenHash) return res.status(400).json({ error: "Token invalide" });
  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified = TRUE, email_verify_token = NULL, email_verify_token_expires = NULL
       WHERE email_verify_token = $1 AND email_verify_token_expires > NOW()
       RETURNING id, username`,
      [tokenHash]
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
    await pool.query(
      "UPDATE users SET email_verify_token = $1, email_verify_token_expires = $2 WHERE id = $3",
      [hashOpaqueToken(emailToken), new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS), reqUser]
    );
    sendVerificationEmail(user.rows[0].email, emailToken);
    res.json({ ok: true, message: "Email de vérification renvoyé" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Request password reset ──
app.post("/api/auth/forgot-password", security.passwordResetLimiter, security.validateBody(security.schemas.forgotPasswordSchema), async (req, res) => {
  const { email } = req.validatedBody;
  try {
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    // Perform the same indexed UPDATE for existing and unknown addresses.  A
    // generic response alone is not enough if the known-address path performs
    // visibly more database work than the unknown-address path.
    const updated = await pool.query(
      `UPDATE users
       SET reset_token = $1, reset_token_expires = $2
       WHERE email = $3 AND deleted_at IS NULL
       RETURNING id, email`,
      [hashOpaqueToken(resetToken), resetExpires, email.toLowerCase()]
    );
    res.json({ ok: true, message: "Si un compte existe, un email a été envoyé" });
    // Keep the response path identical; any mail provider and audit-log work
    // happens after it has been sent and never reveals account existence.
    if (updated.rows.length) {
      const user = updated.rows[0];
      setImmediate(() => {
        sendPasswordResetEmail(user.email, resetToken);
        secLog.logSecurityEvent(pool, { req, userId: user.id, email: user.email, event: "password_reset_request", status: "ok" });
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Reset password with token ──
app.post("/api/auth/reset-password", security.passwordResetLimiter, security.validateBody(security.schemas.resetPasswordSchema), async (req, res) => {
  const { token, newPassword } = req.validatedBody;
  const tokenHash = hashOpaqueToken(token);
  if (!tokenHash) return res.status(400).json({ error: "Token invalide" });
  try {
    const result = await pool.query(
      "SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW() AND deleted_at IS NULL",
      [tokenHash]
    );
    if (!result.rows.length) return res.status(400).json({ error: "Token invalide ou expiré" });
    const { salt, hash, iterations } = await hashPassword(newPassword);
    await pool.query(
      "UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = $3, reset_token = NULL, reset_token_expires = NULL WHERE id = $4",
      [hash, salt, iterations, result.rows[0].id]
    );
    // Invalidate all existing sessions for security
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [result.rows[0].id]);
    revokeUserSockets(result.rows[0].id, "Password reset");
    secLog.logSecurityEvent(pool, { req, userId: result.rows[0].id, event: "password_reset_complete", status: "ok" });
    res.json({ ok: true, message: "Mot de passe réinitialisé" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Auth : Email login ──
app.post("/api/auth/login", security.loginLimiter, security.validateBody(security.schemas.loginSchema), async (req, res) => {
  const { email, password } = req.validatedBody;
  try {
    const result = await pool.query(
      "SELECT id, username, email_verified, password_hash, password_salt, password_iterations, avatar_url, privacy, created_at, suspended_until FROM users WHERE email = $1 AND deleted_at IS NULL",
      [email.toLowerCase()]
    );
    // Same generic error whether the email is unknown or the password is wrong,
    // to avoid leaking which emails have an account (user enumeration).
    const genericError = () => res.status(401).json({ error: "Email ou mot de passe incorrect" });
    if (!result.rows.length) {
      // Do the same expensive work as a password check. Otherwise an unknown
      // email returns measurably faster than a known one and defeats the
      // generic error message through timing-based account enumeration.
      await burnPasswordWork(password);
      return genericError();
    }
    const user = result.rows[0];
    const rawIterations = Number(user.password_iterations);
    // The work factor is persisted data, so keep a malformed/corrupted value
    // from turning one login request into an unbounded CPU job.
    const storedIterations = Number.isInteger(rawIterations)
      && rawIterations >= LEGACY_PBKDF2_ITERATIONS
      && rawIterations <= PBKDF2_ITERATIONS
      ? rawIterations
      : LEGACY_PBKDF2_ITERATIONS;
    let passwordMatches = false;
    if (user.password_hash && user.password_salt) {
      passwordMatches = await verifyPassword(password, user.password_hash, user.password_salt, storedIterations);
      // Older hashes use fewer iterations. Pad their work to the current
      // baseline so they do not become a timing oracle either.
      if (storedIterations < PBKDF2_ITERATIONS) {
        await burnPasswordWork(password, PBKDF2_ITERATIONS - storedIterations);
      }
    } else {
      await burnPasswordWork(password);
    }
    if (!passwordMatches) {
      secLog.logSecurityEvent(pool, { req, email, event: "login", status: "failed", details: { reason: "wrong_password" } });
      return genericError();
    }
    secLog.logSecurityEvent(pool, { req, userId: user.id, email, event: "login", status: "ok", details: { method: "email" } });
    // Transparent upgrade: if this account was hashed with a weaker (legacy)
    // work factor, re-hash the just-verified password with the current factor.
    if (storedIterations < PBKDF2_ITERATIONS) {
      try {
        const upgraded = await hashPassword(password);
        await pool.query(
          "UPDATE users SET password_hash = $1, password_salt = $2, password_iterations = $3 WHERE id = $4",
          [upgraded.hash, upgraded.salt, upgraded.iterations, user.id]
        );
      } catch (upErr) {
        console.error("[PWD-UPGRADE] Failed to re-hash password for user", user.id, upErr);
      }
    }
    const token = await createSession(user.id);
    const isSuspended = user.suspended_until && new Date(user.suspended_until) > new Date();
    res.json({
      id: user.id,
      username: user.username,
      token,
      emailVerified: user.email_verified || false,
      avatar_url: user.avatar_url || "",
      privacy: user.privacy || "squad_only",
      created_at: user.created_at,
      suspended: !!isSuspended,
      suspendedUntil: isSuspended ? user.suspended_until : null
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
    redirectUri: `${APP_URL}/api/auth/callback/google`,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scope: "openid email profile"
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    redirectUri: `${APP_URL}/api/auth/callback/discord`,
    authUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userInfoUrl: "https://discord.com/api/users/@me",
    scope: "identify email"
  }
};

function oauthCookieOptions() {
  return {
    httpOnly: true,
    maxAge: 600000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/callback"
  };
}

function safelyEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function hashOAuthExchangeCode(code) {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(code)) return null;
  return crypto.createHash("sha256").update(code).digest("hex");
}

function hashOAuthExchangeVerifier(verifier) {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(verifier)) return null;
  return crypto.createHash("sha256").update(verifier).digest("hex");
}

async function createOAuthExchangeCode(userId, verifierHash) {
  const code = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO oauth_exchange_codes (code_hash, verifier_hash, user_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hashOAuthExchangeCode(code), verifierHash, userId, new Date(Date.now() + OAUTH_EXCHANGE_TTL_MS)]
  );
  return code;
}

// ── OAuth : initiate redirect ──
app.get("/api/auth/oauth/:provider", (req, res) => {
  const provider = req.params.provider;
  const config = OAUTH_CONFIG[provider];
  if (!config || !config.clientId || !config.clientSecret) {
    return res.status(400).json({ error: `Provider ${provider} non configuré` });
  }
  const exchangeChallenge = req.query.exchange_challenge;
  if (!isOAuthExchangeChallenge(exchangeChallenge)) {
    return res.status(400).json({ error: "Client OAuth obsolète : recharge l'application avant de réessayer." });
  }

  const stateToken = crypto.randomBytes(16).toString("hex");
  const cookieOpts = oauthCookieOptions();
  // Store state in a short-lived cookie for CSRF protection
  res.cookie(`oauth_state_${provider}`, stateToken, cookieOpts);
  // Remember where to send the user back: the web app (default) or the native
  // app via a custom-scheme deep link (?return=app, used by the Capacitor shell
  // which opens this flow in the system browser).
  const returnMode = req.query.return === "app" ? "app" : "web";
  res.cookie(`oauth_return_${provider}`, returnMode, cookieOpts);
  // The SPA/native client keeps the matching verifier locally. The backend
  // sees only its SHA-256 challenge, so a deep-link interceptor cannot redeem
  // the one-time result code on its own.
  res.cookie(`oauth_exchange_${provider}`, exchangeChallenge, cookieOpts);

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
  const exchangeChallenge = req.cookies?.[`oauth_exchange_${provider}`];
  res.clearCookie(`oauth_return_${provider}`, { path: "/api/auth/callback" });
  res.clearCookie(`oauth_exchange_${provider}`, { path: "/api/auth/callback" });
  const sendResult = (query) =>
    res.redirect(returnMode === "app" ? `sprite-index://auth?${query}` : `/?${query}`);

  const code = req.query.code || req.body?.code;
  if (!code) return res.status(400).send("Code manquant");

  // SECURITY: verify the OAuth `state` matches the value we set in an httpOnly
  // cookie before initiating the redirect. This prevents CSRF login/link
  // attacks where an attacker tricks a victim into completing an OAuth flow
  // initiated by the attacker.
  const returnedState = req.query.state || req.body?.state;
  const expectedState = req.cookies?.[`oauth_state_${provider}`];
  res.clearCookie(`oauth_state_${provider}`, { path: "/api/auth/callback" });
  if (!safelyEqual(returnedState, expectedState)) {
    console.warn(`[OAuth] state mismatch for provider ${provider}`);
    return sendResult("authError=invalid_state");
  }
  if (!isOAuthExchangeChallenge(exchangeChallenge)) {
    console.warn(`[OAuth] missing exchange challenge for provider ${provider}`);
    return sendResult("authError=invalid_exchange");
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
      // Do not log the provider payload wholesale: a malformed/changed
      // response could contain credentials that do not belong in application
      // logs. The provider's public error code is enough for diagnosis.
      console.error("OAuth token exchange failed:", tokenData?.error || "provider did not return an access token");
      return sendResult("authError=token_failed");
    }

    // Get user info
    let email, username, avatarUrl, providerEmailVerified = false;
    if (provider === "google") {
      const userRes = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (!userRes.ok) return sendResult("authError=token_failed");
      const user = await userRes.json();
      email = user.email;
      username = user.name || (user.email ? user.email.split("@")[0] : "");
      avatarUrl = user.picture || "";
      providerEmailVerified = user.verified_email === true;
    } else if (provider === "discord") {
      const userRes = await fetch(config.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (!userRes.ok) return sendResult("authError=token_failed");
      const user = await userRes.json();
      email = user.email;
      username = user.global_name || user.username;
      avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : "";
      providerEmailVerified = user.verified === true;
    }

    if (!email) return sendResult("authError=no_email");
    if (!providerEmailVerified) return sendResult("authError=unverified_email");

    // Find or create user
    let userRow = await pool.query("SELECT id, username, avatar_url FROM users WHERE email = $1 AND deleted_at IS NULL", [email.toLowerCase()]);
    if (userRow.rows.length === 0) {
      // Provider display names are arbitrary (length, unicode, punctuation) but the
      // username column is VARCHAR(50) with a unique normalized index. Sanitize and
      // retry with a random suffix on collision so OAuth login never 500s.
      const cleaned = String(username || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      const baseUsername = cleaned.length >= 3 ? cleaned : `joueur_${crypto.randomBytes(3).toString("hex")}`;
      let finalUsername = baseUsername;
      let inserted = null;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        try {
          const { isUsernameReserved } = require("./username-history");
          if (await isUsernameReserved(finalUsername)) {
            finalUsername = `${baseUsername.slice(0, 40)}_${crypto.randomBytes(3).toString("hex")}`;
            continue;
          }
          inserted = await pool.query(
            `INSERT INTO users (username, email, email_verified, avatar_url, oauth_provider, age_confirmed)
             VALUES ($1, $2, TRUE, $3, $4, TRUE) RETURNING id, username, avatar_url`,
            [finalUsername, email.toLowerCase(), avatarUrl, provider]
          );
        } catch (e) {
          if (e.code === "23505") { // unique_violation (username or email)
            finalUsername = `${baseUsername.slice(0, 40)}_${crypto.randomBytes(3).toString("hex")}`;
            continue;
          }
          throw e;
        }
      }
      if (!inserted) return sendResult("authError=server_error");
      userRow = inserted;
    } else {
      // Update avatar if empty
      if (!userRow.rows[0].avatar_url && avatarUrl) {
        await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [avatarUrl, userRow.rows[0].id]);
      }
      // Mark email as verified (OAuth emails are pre-verified)
      await pool.query("UPDATE users SET email_verified = TRUE WHERE id = $1", [userRow.rows[0].id]);
    }

    const dbUser = userRow.rows[0];
    const exchangeCode = await createOAuthExchangeCode(dbUser.id, exchangeChallenge);
    secLog.logSecurityEvent(pool, { req, userId: dbUser.id, email, event: "login", status: "ok", details: { method: "oauth", provider } });

    // Return a short-lived, single-use code instead of a bearer token. The
    // client must prove possession of its local verifier to exchange it.
    sendResult(`authCode=${encodeURIComponent(exchangeCode)}`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    sendResult("authError=server_error");
  }
});

// ── OAuth : redeem a one-time result code ──
// The code can safely cross a browser redirect/deep link because it expires
// quickly, is deleted atomically on use, and is bound to a verifier that never
// appears in that URL.
app.post("/api/auth/oauth/exchange", security.oauthExchangeLimiter, async (req, res) => {
  const codeHash = hashOAuthExchangeCode(req.body?.code);
  const verifierHash = hashOAuthExchangeVerifier(req.body?.verifier);
  if (!codeHash || !verifierHash) {
    return res.status(400).json({ error: "Réponse OAuth invalide" });
  }
  try {
    const claimed = await pool.query(
      `DELETE FROM oauth_exchange_codes
       WHERE code_hash = $1 AND verifier_hash = $2 AND expires_at > NOW()
       RETURNING user_id`,
      [codeHash, verifierHash]
    );
    if (!claimed.rows.length) {
      return res.status(401).json({ error: "Réponse OAuth expirée ou déjà utilisée" });
    }
    const userResult = await pool.query(
      `SELECT id, username, avatar_url, privacy, email_verified, created_at, suspended_until
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [claimed.rows[0].user_id]
    );
    if (!userResult.rows.length) return res.status(401).json({ error: "Session indisponible" });
    const user = userResult.rows[0];
    const token = await createSession(user.id);
    pool.query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [user.id]).catch(() => {});
    const isSuspended = user.suspended_until && new Date(user.suspended_until) > new Date();
    res.json({
      id: user.id,
      username: user.username,
      token,
      emailVerified: !!user.email_verified,
      avatar_url: user.avatar_url || "",
      privacy: user.privacy || "squad_only",
      created_at: user.created_at,
      suspended: !!isSuspended,
      suspendedUntil: isSuspended ? user.suspended_until : null
    });
  } catch (err) {
    console.error("[OAuth exchange]", err);
    res.status(500).json({ error: "Erreur serveur OAuth" });
  }
});

// ── Auth : Logout ──
app.post("/api/auth/logout", async (req, res) => {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const tokenHash = hashSessionToken(token);
    if (tokenHash) {
      await pool.query("DELETE FROM sessions WHERE token = $1", [tokenHash]).catch(() => {});
      // A WebSocket authenticated with this bearer must not survive logout
      // until its periodic session revalidation.
      revokeSessionSockets(token);
    }
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
  const tokenHash = hashSessionToken(token);
  if (!tokenHash) return res.status(401).json({ error: "Session expirée" });
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, u.privacy, u.email_verified, u.created_at, u.last_active_at, u.suspended_until
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL`,
      [tokenHash]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: "Session expirée" });
    }
    pool.query("UPDATE users SET last_active_at = NOW() WHERE id = $1", [result.rows[0].id]).catch(() => {});
    const row = result.rows[0];
    const isSuspended = row.suspended_until && new Date(row.suspended_until) > new Date();
    res.json({ ...row, suspended: !!isSuspended, suspendedUntil: isSuspended ? row.suspended_until : null });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = { OAUTH_CONFIG };
