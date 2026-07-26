// friends/invite-links-helpers.js — token generation and lookup helpers for
// friend invite links.

const crypto = require("crypto");
const { APP_URL } = require("../core");

function generateInviteToken() {
  return `f_${crypto.randomBytes(16).toString("base64url")}`;
}

function hashInviteToken(token) {
  if (typeof token !== "string" || !/^f_[A-Za-z0-9_-]{22}$/.test(token)) return null;
  return crypto.createHash("sha256").update(token).digest("hex");
}

function computeInviteLinkMeta(duration) {
  const now = new Date();
  switch (duration) {
    case "24h":
      return { expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(), maxUses: null };
    case "7d":
      return { expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(), maxUses: null };
    case "single_use":
      return { expiresAt: null, maxUses: 1 };
    case "permanent":
    default:
      return { expiresAt: null, maxUses: null };
  }
}

async function fetchInviteLink(client, token) {
  const tokenHash = hashInviteToken(token);
  if (!tokenHash) return null;
  const result = await client.query(
    `SELECT l.*, u.id AS owner_exists, u.deleted_at AS owner_deleted,
            (u.suspended_until IS NOT NULL AND u.suspended_until > NOW()) AS owner_suspended
     FROM friend_invite_links l
     JOIN users u ON u.id = l.owner_id
     WHERE l.token_hash = $1`,
    [tokenHash]
  );
  if (!result.rows.length) return null;
  const link = result.rows[0];
  if (link.owner_deleted || link.owner_suspended) return null;
  const isRevoked = !!link.revoked_at;
  const isExpired = link.expires_at && new Date(link.expires_at) < new Date();
  const isDepleted = link.max_uses !== null && link.use_count >= link.max_uses;
  if (isRevoked || isExpired || isDepleted) return { ...link, invalid: true };
  return link;
}

function buildLinkUrl(_req, token) {
  return `${APP_URL}/?invite=${encodeURIComponent(token)}`;
}

module.exports = {
  generateInviteToken,
  hashInviteToken,
  computeInviteLinkMeta,
  fetchInviteLink,
  buildLinkUrl
};
