// friends/state-machine.js — friendship relationship state machine.

const { isBlocked, isAccountSuspended } = require("../auth");
const { pool } = require("../db");
const compare = require("../compare");
const { getActiveFriendship, canReceiveFriendRequestFrom, recentRequestCooldown } = require("./helpers");

// Enforce a clean state machine for friend relationships.
// Only one active row exists per unordered pair (guaranteed by the partial unique index).
async function applyFriendAction(reqUser, friendId, action) {
  const active = await getActiveFriendship(reqUser, friendId);
  const isRequester = active && Number(active.requester_id) === Number(reqUser);
  const isAddressee = active && Number(active.addressee_id) === Number(reqUser);

  // Block is the only action allowed when a block exists; unblock is handled directly.
  if (!["block", "unblock"].includes(action) && await isBlocked(reqUser, friendId)) {
    return { error: 403, message: "Blocage actif" };
  }

  switch (action) {
    case "request": {
      if (await isAccountSuspended(reqUser)) {
        return { error: 403, message: "Votre compte est suspendu" };
      }
      if (await isAccountSuspended(friendId)) {
        return { error: 403, message: "Ce compte est suspendu" };
      }
      if (active) {
        if (active.status === "pending") {
          return { error: 409, message: isRequester ? "Vous avez déjà envoyé une invitation" : "Cet utilisateur vous a déjà envoyé une invitation" };
        }
        if (active.status === "accepted") return { error: 409, message: "Vous êtes déjà amis" };
        if (active.status === "blocked") return { error: 403, message: "Vous ne pouvez pas interagir avec cet utilisateur" };
      }
      if (!(await canReceiveFriendRequestFrom(reqUser, friendId))) {
        return { error: 403, message: "Cet utilisateur n'accepte pas les invitations" };
      }
      if (await recentRequestCooldown(reqUser, friendId)) {
        return { error: 429, message: "Tu as récemment envoyé une demande. Réessaie dans 7 jours." };
      }
      await pool.query(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
         VALUES ($1, $2, 'pending', NOW(), NOW())`,
        [reqUser, friendId]
      );
      return { ok: true };
    }

    case "accept": {
      if (!active || active.status !== "pending" || !isAddressee) {
        return { error: 404, message: "Aucune invitation en attente" };
      }
      await pool.query(
        `UPDATE friendships SET status = 'accepted', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [active.id]
      );
      return { ok: true };
    }

    case "decline": {
      if (!active || active.status !== "pending" || !isAddressee) {
        return { error: 404, message: "Aucune invitation en attente" };
      }
      await pool.query(
        `UPDATE friendships SET status = 'declined', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [active.id]
      );
      return { ok: true };
    }

    case "cancel": {
      if (!active || active.status !== "pending" || !isRequester) {
        return { error: 400, message: "Aucune invitation à annuler" };
      }
      await pool.query(
        `UPDATE friendships SET status = 'cancelled', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [active.id]
      );
      return { ok: true };
    }

    case "remove": {
      if (!active || active.status !== "accepted") {
        return { error: 400, message: "Vous n'êtes pas amis" };
      }
      await pool.query(
        `UPDATE friendships SET status = 'removed', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [active.id]
      );
      return { ok: true };
    }

    case "block": {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (active) {
          // Overwrite the existing active row: requester becomes the blocker.
          await client.query(
            `UPDATE friendships
             SET requester_id = $1, addressee_id = $2, status = 'blocked', responded_at = NOW(), updated_at = NOW()
             WHERE id = $3`,
            [reqUser, friendId, active.id]
          );
        } else {
          await client.query(
            `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
             VALUES ($1, $2, 'blocked', NOW(), NOW())`,
            [reqUser, friendId]
          );
        }
        await client.query(
          `INSERT INTO user_blocks (blocker_id, blocked_id)
           VALUES ($1, $2)
           ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
          [reqUser, friendId]
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      return { ok: true };
    }

    case "unblock": {
      const blockRecord = await pool.query(
        "SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
        [reqUser, friendId]
      );
      if (blockRecord.rows.length === 0) {
        return { error: 400, message: "Cet utilisateur n'est pas bloqué" };
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (active && active.status === "blocked" && isRequester) {
          await client.query(
            `UPDATE friendships
             SET status = 'removed', responded_at = NOW(), updated_at = NOW()
             WHERE id = $1`,
            [active.id]
          );
        }
        await client.query(
          "DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2",
          [reqUser, friendId]
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      return { ok: true };
    }

    default:
      return { error: 400, message: "Action non reconnue" };
  }
}

// Shared block implementation: remove friendship/pending requests, add block record,
// and invalidate cached compare results and share tokens between the two users.
async function blockUser(reqUser, userId) {
  const outcome = await applyFriendAction(reqUser, userId, "block");
  if (outcome.error) return outcome;
  compare.invalidateCompareCacheForUser(reqUser);
  compare.invalidateCompareCacheForUser(userId);
  await pool.query(
    `UPDATE compare_share_tokens
     SET revoked_at = NOW()
     WHERE owner_user_id IN ($1, $2)
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [reqUser, userId]
  );
  return { ok: true };
}

module.exports = { applyFriendAction, blockUser };
