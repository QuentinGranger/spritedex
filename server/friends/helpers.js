// friends/helpers.js — shared query and utility helpers for the friends module.

const { getRequestingUser, canViewCollection, getVisibility, shareSquad, isAccountSuspended } = require("../auth");
const { pool } = require("../db");
const compare = require("../compare");

const VALID_FRIEND_ID = /^\d+$/;
const REQUEST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

async function resolveUsers(req, friendId) {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return { error: 401, message: "Authentification requise" };
  if (!friendId || !VALID_FRIEND_ID.test(friendId)) return { error: 400, message: "Identifiant invalide" };
  if (String(reqUser) === String(friendId)) return { error: 400, message: "Tu ne peux pas t'interagir toi-même" };
  const exists = await pool.query("SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL", [friendId]);
  if (!exists.rows.length) return { error: 404, message: "Utilisateur non trouvé" };
  return { reqUser, friendId: Number(friendId) };
}

async function resolveAddressee(reqUser, addresseeId) {
  if (!addresseeId) return { error: 400, message: "Destinataire requis" };
  const id = String(addresseeId).trim();
  if (String(reqUser) === id) return { error: 400, message: "Tu ne peux pas t'inviter toi-même" };
  const isNumeric = /^\d+$/.test(id);
  let result;
  if (isNumeric) {
    result = await pool.query("SELECT id, privacy FROM users WHERE id = $1 AND deleted_at IS NULL", [Number(id)]);
  } else {
    result = await pool.query("SELECT id, privacy FROM users WHERE (username = $1 OR username_normalized = LOWER($1)) AND deleted_at IS NULL", [id]);
  }
  if (!result.rows.length) return { error: 404, message: "Utilisateur non trouvé" };
  return { friendId: result.rows[0].id, privacy: result.rows[0].privacy };
}

function pairWhereClause() {
  return `LEAST(requester_id, addressee_id) = LEAST($1::integer, $2::integer)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1::integer, $2::integer)`;
}

async function canReceiveFriendRequestFrom(reqUser, targetId) {
  if (await isAccountSuspended(reqUser) || await isAccountSuspended(targetId)) return false;
  const recipient = await pool.query(
    "SELECT friend_invites_from FROM users WHERE id = $1 AND deleted_at IS NULL",
    [targetId]
  );
  if (!recipient.rows.length) return false;
  const setting = recipient.rows[0].friend_invites_from || "everyone";
  if (setting === "nobody") return false;
  if (setting === "mutual_squad_members") {
    return await shareSquad(reqUser, targetId);
  }
  return true;
}

async function getActiveFriendship(reqUser, friendId) {
  const result = await pool.query(
    `SELECT * FROM friendships
     WHERE status IN ('pending', 'accepted', 'blocked')
       AND ${pairWhereClause()}
     LIMIT 1`,
    [reqUser, friendId]
  );
  return result.rows[0] || null;
}

function isActive(status) {
  return ["pending", "accepted", "blocked"].includes(status);
}

async function recentRequestCooldown(reqUser, friendId) {
  const result = await pool.query(
    `SELECT responded_at FROM friendships
     WHERE ${pairWhereClause()}
       AND status = 'declined'
     ORDER BY responded_at DESC
     LIMIT 1`,
    [reqUser, friendId]
  );
  if (!result.rows.length || !result.rows[0].responded_at) return false;
  return (Date.now() - new Date(result.rows[0].responded_at).getTime()) < REQUEST_COOLDOWN_MS;
}

async function getFriendCompletionRate(userId, catalog) {
  const collection = await compare.loadServerCompareCollection(userId);
  const active = catalog.filter(compare.isVariantReleasedAndActiveServer);
  if (!active.length) return 0;
  const owned = active.filter(item => compare.compareServerClassify(collection[item.id] || compare.compareServerDefaultEntry()) === "owned").length;
  return Math.round((owned / active.length) * 10000) / 100;
}

async function getLastCollectionUpdate(userId) {
  const result = await pool.query(
    "SELECT MAX(updated_at) as last_update FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  return result.rows[0]?.last_update || null;
}

async function getFriendPreviewSummary(reqUser, friendId) {
  let result = compare.getCachedCompareResult(reqUser, friendId);
  if (!result) {
    const [catalogue, collectionA, collectionB] = await Promise.all([
      compare.getServerCompareCatalogItemsCached(),
      compare.loadServerCompareCollection(reqUser),
      compare.loadServerCompareCollection(friendId)
    ]);
    const meRes = await pool.query("SELECT id, display_name, username FROM users WHERE id = $1 AND deleted_at IS NULL", [reqUser]);
    const friendRes = await pool.query("SELECT id, display_name, username FROM users WHERE id = $1 AND deleted_at IS NULL", [friendId]);
    const userA = { id: reqUser, displayName: meRes.rows[0]?.display_name || meRes.rows[0]?.username || reqUser, collection: collectionA };
    const userB = { id: friendId, displayName: friendRes.rows[0]?.display_name || friendRes.rows[0]?.username || friendId, collection: collectionB };
    result = compare.compareCollectionsServer(userA, userB, catalogue);
    compare.setCachedCompareResult(reqUser, friendId, result);
  }
  return {
    missingFromFriend: result.summary.onlyUserACount,
    missingFromMe: result.summary.onlyUserBCount,
    collectiveCompletionRate: result.summary.collectiveCompletionRate,
    totalVariants: result.summary.catalogueVariantCount,
    summary: result.summary
  };
}

async function getCommonSquad(userA, userB) {
  const result = await pool.query(
    `SELECT s.id, s.code, s.name
     FROM squads s
     JOIN squad_members a ON a.squad_id = s.id
     JOIN squad_members b ON b.squad_id = s.id
     WHERE a.user_id = $1 AND a.status = 'active'
       AND b.user_id = $2 AND b.status = 'active'
     LIMIT 1`,
    [userA, userB]
  );
  return result.rows[0] || null;
}

module.exports = {
  VALID_FRIEND_ID,
  REQUEST_COOLDOWN_MS,
  resolveUsers,
  resolveAddressee,
  pairWhereClause,
  canReceiveFriendRequestFrom,
  getActiveFriendship,
  isActive,
  recentRequestCooldown,
  getFriendCompletionRate,
  getLastCollectionUpdate,
  getFriendPreviewSummary,
  getCommonSquad
};
