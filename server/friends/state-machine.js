// friends/state-machine.js — friendship relationship state machine.

const { isBlocked, isAccountSuspended } = require("../auth");
const { pool } = require("../db");
const compare = require("../compare");
const { getActiveFriendship, canReceiveFriendRequestFrom, recentRequestCooldown } = require("./helpers");

function broadcastRelationshipUpdate(...userIds) {
  try {
    require("../ws").broadcastFriendsUpdate(userIds, "relationship");
  } catch (err) {
    // Social writes are already committed; a failed live signal must never
    // make a friendship action fail. The next refresh will still be correct.
    console.warn("[friends] live update broadcast failed", err.message);
  }
}

// Enforce a clean state machine for friend relationships.
// Only one active row exists per unordered pair (guaranteed by the partial unique index).
async function applyFriendAction(reqUser, friendId, action, options = {}) {
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
      const inserted = await pool.query(
        `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
         VALUES ($1, $2, 'pending', NOW(), NOW())
         RETURNING id`,
        [reqUser, friendId]
      );
      const friendshipId = inserted.rows[0]?.id || null;
      try {
        const {
          recordGraphEventSafe,
          GRAPH_EVENT_TYPES,
          buildFriendInvitationSentContext,
          normalizeInvitationMethod
        } = require("../sprite-graph");
        const invitationMethod = normalizeInvitationMethod(
          options.invitationMethod,
          { fallback: options.fallbackInvitationMethod || "username" }
        );
        recordGraphEventSafe({
          eventType: GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT,
          actorUserId: reqUser,
          targetUserId: friendId,
          friendshipId,
          source: options.source || "api",
          origin: options.origin || "friends.request",
          context: buildFriendInvitationSentContext({
            invitationMethod,
            invitationSource: options.invitationSource || null,
            status: "pending"
          }),
          deduplicationKey: friendshipId
            ? `${GRAPH_EVENT_TYPES.FRIEND_INVITATION_SENT}:${friendshipId}`
            : null
        });
      } catch (_) { /* optional */ }
      broadcastRelationshipUpdate(reqUser, friendId);
      return { ok: true, friendshipId };
    }

    case "accept": {
      // Trigger (Étape 11): only the addressee can accept, and only while the
      // relationship is still `pending`. Success means pending → accepted.
      if (!active || active.status !== "pending" || !isAddressee) {
        return { error: 404, message: "Aucune invitation en attente" };
      }
      const previousStatus = active.status;
      await pool.query(
        `UPDATE friendships SET status = 'accepted', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [active.id]
      );
      broadcastRelationshipUpdate(reqUser, friendId);
      return {
        ok: true,
        previousStatus,
        newStatus: "accepted",
        friendshipId: active.id,
        requesterId: active.requester_id,
        accepterId: reqUser
      };
    }

    case "decline": {
      if (!active || active.status !== "pending" || !isAddressee) {
        return { error: 404, message: "Aucune invitation en attente" };
      }
      await pool.query(
        `UPDATE friendships SET status = 'declined', responded_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [active.id]
      );
      broadcastRelationshipUpdate(reqUser, friendId);
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
      broadcastRelationshipUpdate(reqUser, friendId);
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
      broadcastRelationshipUpdate(reqUser, friendId);
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
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      broadcastRelationshipUpdate(reqUser, friendId);
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
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      broadcastRelationshipUpdate(reqUser, friendId);
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
  // A personal profile share link is also a bearer capability. Once either
  // side blocks the other, revoke both parties' links so a previously copied
  // anonymous URL cannot bypass the new privacy boundary.
  await pool.query(
    "UPDATE users SET share_token = NULL WHERE id IN ($1, $2)",
    [reqUser, userId]
  );
  // Étape 57 — purge pending social notifs, hide private reveals, stop batches.
  try {
    const blocks = require("../notification-blocks");
    await blocks.applyBlockNotificationCleanup(pool, reqUser, userId);
  } catch (err) {
    console.error("[blockUser] notification cleanup failed:", err.message);
  }
  return { ok: true };
}

module.exports = { applyFriendAction, blockUser };
