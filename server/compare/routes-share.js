"use strict";

const { analytics, security, secLog, APP_URL, app, pool, crypto, QRCode, canViewCollection, comparisonSessions, getRequestingUser, getVisibility, hashCapabilityToken, requireNotSuspended } = require("./shared");
const { compareCollectionsServer } = require("./complementarity");
const { getServerCompareCatalogItemsCached } = require("./cache");
const { loadServerCompareCollection } = require("./catalog");
const { loadCollectionForShare, computeDurationExpiry, parseCompareShareOptions } = require("./share-helpers");

// ── Compare share tokens ──
app.post("/api/compare/share", security.capabilityLinkLimiter, requireNotSuspended, async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const parsedOptions = parseCompareShareOptions(req.body);
    if (!parsedOptions.ok) return res.status(400).json({ error: parsedOptions.error });
    const { duration, collectionVisible, showNotes, showPriorities, allowVisitorCompare } = parsedOptions.value;

    const ownerRes = await pool.query(
      `SELECT privacy, collection_visibility, visibility FROM users WHERE id = $1 AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`,
      [reqUser]
    );
    if (!ownerRes.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const ownerVisibility = getVisibility(ownerRes.rows[0]);
    if (ownerVisibility.collection === "private") {
      return res.status(403).json({ error: "Impossible de partager une collection privée" });
    }

    const expiresAt = computeDurationExpiry(duration);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashCapabilityToken(token);

    let insert;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A link is a persistent capability. Serialize the per-owner quota so
      // concurrent requests cannot turn this endpoint into unbounded storage.
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [reqUser]);
      const activeCount = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM compare_share_tokens
         WHERE owner_user_id = $1
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [reqUser]
      );
      if ((activeCount.rows[0]?.count || 0) >= 25) {
        await client.query("ROLLBACK");
        return res.status(429).json({ error: "Trop de liens actifs : révoque un lien avant d'en créer un autre" });
      }
      insert = await client.query(
        `INSERT INTO compare_share_tokens (token, owner_user_id, expires_at, collection_visible, show_notes, show_priorities, allow_visitor_compare)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7) RETURNING id, expires_at, created_at`,
        [tokenHash, reqUser, expiresAt, collectionVisible, showNotes, showPriorities, allowVisitorCompare]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "compare_share_created", status: "ok" });
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_shared", details: { duration, source: "compare" } });
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "compare_invitation_generated", details: { source: "compare" } });
    const shareUrl = `${APP_URL}/compare/share/${token}`;
    let qr = null;
    try {
      qr = await QRCode.toDataURL(shareUrl, { type: "image/png", margin: 2, width: 300, errorCorrectionLevel: "M" });
    } catch (qrErr) {
      console.error("[/api/compare/share qr]", qrErr);
    }
    res.json({
      token,
      url: shareUrl,
      qr,
      expiresAt: insert.rows[0].expires_at,
      createdAt: insert.rows[0].created_at,
      options: { collectionVisible, showNotes, showPriorities, allowVisitorCompare }
    });
  } catch (err) {
    console.error("[/api/compare/share]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/compare/share/:token", async (req, res) => {
  try {
    const token = req.params.token;
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Token invalide" });
    const tokenHash = hashCapabilityToken(token);
    if (!tokenHash) return res.status(400).json({ error: "Token invalide" });

    const tokenRes = await pool.query(
      `SELECT t.*, u.username as owner_username, u.collection_visibility, u.privacy, u.visibility
       FROM compare_share_tokens t
       JOIN users u ON u.id = t.owner_user_id
       WHERE t.token = $1 AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > NOW())
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [tokenHash]
    );
    if (!tokenRes.rows.length) return res.status(404).json({ error: "Lien invalide, expiré ou révoqué" });
    const share = tokenRes.rows[0];
    const visitor = await getRequestingUser(req);
    const canAccess = await canViewCollection(visitor, share.owner_user_id, { shareToken: token });
    if (!canAccess) {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    await pool.query("UPDATE compare_share_tokens SET last_used_at = NOW() WHERE id = $1", [share.id]);

    // collectionVisible is an explicit owner privacy choice, independent of
    // the visibility required to resolve the share link itself.
    const ownerCollection = share.collection_visible
      ? await loadCollectionForShare(share.owner_user_id, share)
      : {};
    let visitorCollection = {};
    let visitorName = "Visiteur";
    if (visitor && share.allow_visitor_compare) {
      visitorCollection = await loadServerCompareCollection(visitor);
      const visitorRes = await pool.query("SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL", [visitor]);
      if (visitorRes.rows.length) visitorName = visitorRes.rows[0].username;
    }

    const userA = { id: share.owner_user_id, displayName: share.owner_username, collection: ownerCollection };
    const userB = { id: visitor || "visitor", displayName: visitorName, collection: visitorCollection };
    const catalogue = await getServerCompareCatalogItemsCached();
    const result = compareCollectionsServer(userA, userB, catalogue);

    analytics.logCompareAnalyticsEvent(pool, { userId: visitor, event: "comparison_viewed", details: { source: "share", ownerId: share.owner_user_id } });

    if (visitor && String(visitor) !== String(share.owner_user_id) && share.allow_visitor_compare) {
      try {
        await comparisonSessions.recordComparisonSession({
          initiatorId: visitor,
          comparedUserId: share.owner_user_id,
          source: "shared_link",
          catalogueVersion: comparisonSessions.catalogueVersionFromItems(catalogue),
          result
        });
      } catch (sessionErr) {
        console.error("[comparison-sessions] /api/compare/share", sessionErr.message);
      }
    }

    res.json({
      accessReason: "shared_link",
      options: {
        collectionVisible: share.collection_visible,
        showNotes: !!share.show_notes,
        showPriorities: !!share.show_priorities,
        allowVisitorCompare: !!share.allow_visitor_compare
      },
      result
    });
  } catch (err) {
    console.error("[/api/compare/share/:token]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/compare/share/:token", requireNotSuspended, async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const tokenHash = hashCapabilityToken(req.params.token);
    if (!tokenHash) return res.status(404).json({ error: "Lien non trouvé" });

    const result = await pool.query(
      "UPDATE compare_share_tokens SET revoked_at = NOW() WHERE token = $1 AND owner_user_id = $2 RETURNING id",
      [tokenHash, reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lien non trouvé" });
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "compare_share_revoked", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/compare/share/:token]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/compare/shares", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const result = await pool.query(
      `SELECT id, expires_at, revoked_at, collection_visible, show_notes, show_priorities, allow_visitor_compare, created_at, last_used_at
       FROM compare_share_tokens
       WHERE owner_user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC`,
      [reqUser]
    );
    res.json({ shares: result.rows });
  } catch (err) {
    console.error("[/api/compare/shares]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Lists intentionally omit bearer values. Owners can revoke a previously
// issued link by its opaque database id without having to retain the URL.
app.delete("/api/compare/shares/:shareId", requireNotSuspended, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  if (!/^\d+$/.test(req.params.shareId)) return res.status(404).json({ error: "Lien non trouvé" });
  try {
    const result = await pool.query(
      "UPDATE compare_share_tokens SET revoked_at = NOW() WHERE id = $1 AND owner_user_id = $2 AND revoked_at IS NULL RETURNING id",
      [req.params.shareId, reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lien non trouvé" });
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "compare_share_revoked", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/compare/shares/:shareId DELETE]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});


module.exports = {  };
