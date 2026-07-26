// friends/routes-invite-links.js — create / list / revoke / view / redeem / QR /
// regenerate friend invite links.

const { getRequestingUser, isBlocked, isAccountSuspended, requireNotSuspended } = require("../auth");
const { app } = require("../core");
const { pool } = require("../db");
const security = require("../../security");
const QRCode = require("qrcode");
const { pairWhereClause, getActiveFriendship, recentRequestCooldown } = require("./helpers");
const { generateInviteToken, hashInviteToken, computeInviteLinkMeta, fetchInviteLink, buildLinkUrl } = require("./invite-links-helpers");

// ── Create a friend invite link ─────────────────────────────────────────────
app.post("/api/friends/invite-links", security.capabilityLinkLimiter, security.validateBody(security.schemas.friendInviteLinkCreateSchema), async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  if (await isAccountSuspended(reqUser)) {
    return res.status(403).json({ error: "Compte suspendu" });
  }
  const { duration } = req.validatedBody;
  const { expiresAt, maxUses } = computeInviteLinkMeta(duration);
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize capacity checks per owner. An IP limiter alone can be bypassed
    // by concurrent requests from multiple addresses on the same account.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [reqUser]);
    const activeCount = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM friend_invite_links
       WHERE owner_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (max_uses IS NULL OR use_count < max_uses)`,
      [reqUser]
    );
    if ((activeCount.rows[0]?.count || 0) >= 25) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "Trop de liens actifs : révoque un lien avant d'en créer un autre" });
    }
    const result = await client.query(
      `INSERT INTO friend_invite_links (owner_id, token_hash, expires_at, max_uses)
       VALUES ($1, $2, $3, $4) RETURNING id, expires_at, max_uses, use_count, created_at`,
      [reqUser, tokenHash, expiresAt, maxUses]
    );
    await client.query("COMMIT");
    const link = result.rows[0];
    res.status(201).json({
      id: link.id,
      token,
      url: buildLinkUrl(req, token),
      expiresAt: link.expires_at,
      maxUses: link.max_uses,
      useCount: link.use_count,
      createdAt: link.created_at
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[/api/friends/invite-links]", err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// ── List my invite links ────────────────────────────────────────────────────
app.get("/api/friends/invite-links", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `SELECT id, expires_at, max_uses, use_count, revoked_at, created_at
       FROM friend_invite_links
       WHERE owner_id = $1
       ORDER BY created_at DESC`,
      [reqUser]
    );
    const now = new Date();
    const links = result.rows.map(link => {
      const expired = link.expires_at && new Date(link.expires_at) < now;
      const depleted = link.max_uses !== null && link.use_count >= link.max_uses;
      return {
        id: link.id,
        expiresAt: link.expires_at,
        maxUses: link.max_uses,
        useCount: link.use_count,
        revokedAt: link.revoked_at,
        createdAt: link.created_at,
        isExpired: expired,
        isRevoked: !!link.revoked_at,
        isValid: !link.revoked_at && !expired && !depleted
      };
    });
    res.json({ links });
  } catch (err) {
    console.error("[/api/friends/invite-links GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Revoke an invite link ─────────────────────────────────────────────────────
app.delete("/api/friends/invite-links/:id", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await pool.query(
      `UPDATE friend_invite_links
       SET revoked_at = NOW()
       WHERE id = $1 AND owner_id = $2
       RETURNING id`,
      [req.params.id, reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lien introuvable" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/friends/invite-links/:id DELETE]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── View a public invite link page ────────────────────────────────────────────
app.get("/api/friends/invite-links/:token", async (req, res) => {
  const token = req.params.token;
  const client = await pool.connect();
  try {
    const link = await fetchInviteLink(client, token);
    if (!link) return res.status(404).json({ error: "Lien introuvable" });
    if (link.invalid) return res.status(410).json({ error: "Lien expiré ou révoqué" });

    const owner = await client.query(
      "SELECT id, username, display_name AS \"displayName\", avatar_url FROM users WHERE id = $1 AND deleted_at IS NULL",
      [link.owner_id]
    );
    if (!owner.rows.length) return res.status(404).json({ error: "Utilisateur introuvable" });

    const reqUser = await getRequestingUser(req);
    let friendshipStatus = "none";
    let canUse = false;
    if (reqUser) {
      const active = await getActiveFriendship(reqUser, link.owner_id);
      friendshipStatus = active ? active.status : "none";
      canUse = !active && String(reqUser) !== String(link.owner_id) && !(await isBlocked(reqUser, link.owner_id));
    }

    res.json({
      owner: owner.rows[0],
      expiresAt: link.expires_at,
      maxUses: link.max_uses,
      useCount: link.use_count,
      friendshipStatus,
      canUse
    });
  } catch (err) {
    console.error("[/api/friends/invite-links/:token GET]", err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// ── Redeem a friend invite link ──────────────────────────────────────────────
app.post("/api/friends/invite-links/:token/use", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const token = req.params.token;
  const tokenHash = hashInviteToken(token);
  if (!tokenHash) return res.status(404).json({ error: "Lien introuvable" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const linkResult = await client.query(
      "SELECT * FROM friend_invite_links WHERE token_hash = $1 FOR UPDATE",
      [tokenHash]
    );
    if (!linkResult.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lien introuvable" });
    }
    const link = linkResult.rows[0];
    if (link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date()) || (link.max_uses !== null && link.use_count >= link.max_uses)) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "Lien expiré ou révoqué" });
    }
    if (String(reqUser) === String(link.owner_id)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Tu ne peux pas t'inviter toi-même" });
    }

    const owner = await client.query("SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL", [link.owner_id]);
    if (!owner.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    const blocked = await client.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = $1::integer AND blocked_id = $2::integer)
          OR (blocker_id = $2::integer AND blocked_id = $1::integer)`,
      [reqUser, link.owner_id]
    );
    if (blocked.rows.length) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Vous ne pouvez pas interagir avec cet utilisateur" });
    }

    if (await recentRequestCooldown(reqUser, link.owner_id)) {
      await client.query("ROLLBACK");
      return res.status(429).json({ error: "Tu as récemment refusé une demande. Réessaie dans 7 jours." });
    }

    const active = await client.query(
      `SELECT * FROM friendships
       WHERE status IN ('pending', 'accepted', 'blocked')
         AND ${pairWhereClause()}
       LIMIT 1`,
      [reqUser, link.owner_id]
    );
    if (active.rows.length) {
      await client.query("ROLLBACK");
      const row = active.rows[0];
      const status = row.status;
      return res.status(409).json({ error: status === "accepted" ? "Vous êtes déjà amis" : "Une relation existe déjà", status });
    }

    const insert = await client.query(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
       VALUES ($1, $2, 'pending', NOW(), NOW())
       RETURNING id, status, created_at`,
      [reqUser, link.owner_id]
    );
    await client.query(
      "UPDATE friend_invite_links SET use_count = use_count + 1 WHERE id = $1",
      [link.id]
    );
    await client.query("COMMIT");

    const row = insert.rows[0];
    res.status(201).json({ requestId: row.id, status: row.status, createdAt: row.created_at });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[/api/friends/invite-links/:token/use]", err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// ── Generate a QR code for an invite link ─────────────────────────────────────
// The QR code encodes ONLY the public invite URL. No email, session token or
// private user id is embedded.
app.get("/api/friends/invite-links/:token/qr", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const token = req.params.token;
  const tokenHash = hashInviteToken(token);
  if (!tokenHash) return res.status(404).json({ error: "Lien introuvable" });
  try {
    const result = await pool.query(
      `SELECT token_hash, revoked_at, expires_at, max_uses, use_count
       FROM friend_invite_links
       WHERE token_hash = $1 AND owner_id = $2`,
      [tokenHash, reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lien introuvable" });
    const link = result.rows[0];
    if (link.revoked_at || (link.expires_at && new Date(link.expires_at) < new Date()) || (link.max_uses !== null && link.use_count >= link.max_uses)) {
      return res.status(410).json({ error: "Lien expiré ou révoqué" });
    }
    const url = buildLinkUrl(req, token);
    const qr = await QRCode.toDataURL(url, { type: "image/png", margin: 2, width: 300, errorCorrectionLevel: "M" });
    res.json({ qr, url });
  } catch (err) {
    console.error("[/api/friends/invite-links/:token/qr]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Regenerate an invite link token ───────────────────────────────────────────
// Keeps the same duration settings, but creates a new token and revokes the old one.
app.post("/api/friends/invite-links/:id/regenerate", security.capabilityLinkLimiter, requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query(
      "SELECT * FROM friend_invite_links WHERE id = $1 AND owner_id = $2 FOR UPDATE",
      [req.params.id, reqUser]
    );
    if (!old.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lien introuvable" });
    }
    const oldLink = old.rows[0];
    // Mark old token as revoked
    await client.query("UPDATE friend_invite_links SET revoked_at = NOW() WHERE id = $1", [oldLink.id]);
    // Create a fresh link with the same settings
    const token = generateInviteToken();
    const tokenHash = hashInviteToken(token);
    const insert = await client.query(
      `INSERT INTO friend_invite_links (owner_id, token_hash, expires_at, max_uses)
       VALUES ($1, $2, $3, $4)
       RETURNING id, expires_at, max_uses, use_count, created_at`,
      [reqUser, tokenHash, oldLink.expires_at, oldLink.max_uses]
    );
    await client.query("COMMIT");
    const link = insert.rows[0];
    res.status(201).json({
      id: link.id,
      token,
      url: buildLinkUrl(req, token),
      expiresAt: link.expires_at,
      maxUses: link.max_uses,
      useCount: link.use_count,
      createdAt: link.created_at
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[/api/friends/invite-links/:id/regenerate]", err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

module.exports = {};
