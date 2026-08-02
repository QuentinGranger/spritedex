const {
  pool, areFriends, canViewCollection, pushService, isAcquiredFromStatus,
  acquisition, emitDomainEvent, DOMAIN_EVENTS, scheduleSquadStatsRefresh
} = require("./shared");

async function notifyCollectionChanges(ownerId, changes) {
  if (!changes || !changes.length) return;
  try {
    const ownerRes = await pool.query(
      `SELECT username FROM users WHERE id = $1::integer AND deleted_at IS NULL`,
      [ownerId]
    );
    if (!ownerRes.rows.length) return;
    const ownerName = ownerRes.rows[0].username || "Quelqu'un";

    const friendRows = await pool.query(
      `SELECT u.id
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1::integer THEN f.addressee_id ELSE f.requester_id END
       WHERE f.status = 'accepted'
         AND (f.requester_id = $1::integer OR f.addressee_id = $1::integer)
         AND u.deleted_at IS NULL`,
      [ownerId]
    );
    if (!friendRows.rows.length) return;

    for (const friend of friendRows.rows) {
      if (!(await areFriends(friend.id, ownerId))) continue;
      if (!(await canViewCollection(friend.id, ownerId))) continue;

      pushService.createNotification(pool, {
        recipientId: friend.id,
        actorId: ownerId,
        type: "friend_collection_updated",
        context: { ownerId, ownerName, actorName: ownerName },
        url: `/collection/${ownerId}`
      });
    }
  } catch (err) {
    console.error("[notifyCollectionChanges]", err);
  }
}

// Étape 15 — emit collection.variant_acquired when status becomes owned from
// a non-owned status in { missing, priority, spotted, unavailable, unknown }.
async function emitVariantAcquiredEvents(ownerId, changes) {
  if (!changes || !changes.length) return;
  for (const change of changes) {
    if (change.newStatus !== "owned") continue;
    if (!isAcquiredFromStatus(change.oldStatus)) continue;
    const names = await acquisition.lookupVariantNames(change.variantId);
    await emitDomainEvent(DOMAIN_EVENTS.COLLECTION_VARIANT_ACQUIRED, {
      actorId: ownerId,
      entityType: "sprite_variant",
      entityId: change.variantId,
      context: {
        previousStatus: change.oldStatus,
        newStatus: "owned",
        variantId: change.variantId,
        variantName: names.variantName,
        spriteName: names.spriteName
      }
    });
  }
}

// Collection changes can affect both the squad completion rate and its
// recommendations (which also depend on priorities).  Keep the persisted
// squad snapshot in sync for every edit, including removals done by import.
async function scheduleSquadStatsForUser(userId) {
  const squads = await pool.query(
    `SELECT squad_id FROM squad_members
     WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  await Promise.all(squads.rows.map(({ squad_id: squadId }) =>
    scheduleSquadStatsRefresh(squadId)
  ));
}

module.exports = { emitVariantAcquiredEvents, notifyCollectionChanges, scheduleSquadStatsForUser };
