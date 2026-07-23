// routes-collection.js — extracted from server.js

const pushService = require("../push-service");
const security = require("../security");
const { areFriends, canViewCollection, getRequestingUser, getVisibility, requireSameUser } = require("./auth");
const { normalizeCollection, normalizeVariantId } = require("./catalog");
const { invalidateCompareCacheForUser } = require("./compare");
const { app } = require("./core");
const { pool } = require("./db");
const { broadcastCompareUpdate, broadcastSquadUpdate } = require("./ws");
const { logSquadCollectionEvent } = require("./squad-activity");
const { refreshSquadStats, scheduleSquadStatsRefresh } = require("./routes-squad-invitations");
const { checkAffectedGoals } = require("./routes-goals");

// ── Collection : GET all entries for user ──
app.get("/api/collection/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userResult = await pool.query(
      `SELECT id, privacy, profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const user = userResult.rows[0];
    const visibility = getVisibility(user);
    const reqUser = await getRequestingUser(req);
    if (!(await canViewCollection(reqUser, userId))) {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    const canSeePriority = await canViewCollection(reqUser, userId, { visibilityKey: "priorities" });
    const canSeeNotes = await canViewCollection(reqUser, userId, { visibilityKey: "notes" });

    const result = await pool.query(
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, updated_at FROM sprite_entries WHERE user_id = $1",
      [userId]
    );
    const collection = {};
    for (const row of result.rows) {
      collection[row.variant_id] = {
        spriteId: row.sprite_id,
        status: row.status,
        note: canSeeNotes ? (row.note || "") : "",
        priority: canSeePriority ? (row.priority || "none") : "none",
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

// ── Notify friends about collection changes ─────────────────────────────
// Emits friend_collection_updated once per affected friend, plus a
// friend_priority_match for each owned variant that a friend is looking for.
async function notifyCollectionChanges(ownerId, changes) {
  if (!changes || !changes.length) return;
  try {
    const ownerRes = await pool.query(
      `SELECT username, visibility FROM users WHERE id = $1::integer AND deleted_at IS NULL`,
      [ownerId]
    );
    if (!ownerRes.rows.length) return;
    const owner = ownerRes.rows[0];
    const ownerVisibility = getVisibility(owner);
    const ownerName = owner.username || "Quelqu'un";

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
    const friendIds = friendRows.rows.map(r => r.id);

    const variantIds = changes.map(c => c.variantId);
    const priorityRes = await pool.query(
      `SELECT user_id, variant_id FROM sprite_entries
       WHERE user_id = ANY($1) AND variant_id = ANY($2) AND priority <> 'none'`,
      [friendIds, variantIds]
    );
    const prioritySet = new Set(priorityRes.rows.map(r => `${r.user_id}:${r.variant_id}`));

    for (const friend of friendRows.rows) {
      if (!(await areFriends(friend.id, ownerId))) continue;
      if (!(await canViewCollection(friend.id, ownerId))) continue;

      pushService.createNotification(pool, {
        recipientId: friend.id,
        actorId: ownerId,
        type: "friend_collection_updated",
        context: { ownerId },
        message: `${ownerName} a mis à jour sa collection.`,
        url: `/collection/${ownerId}`
      });

      for (const change of changes) {
        if (change.newStatus !== "owned" || change.oldStatus === "owned") continue;
        if (prioritySet.has(`${friend.id}:${change.variantId}`)) {
          pushService.createNotification(pool, {
            recipientId: friend.id,
            actorId: ownerId,
            type: "friend_priority_match",
            entityId: change.variantId,
            context: { variantId: change.variantId, ownerId },
            message: `${ownerName} possède maintenant une variante que vous recherchez.`,
            url: `/collection/${ownerId}`
          });
        }
      }
    }
  } catch (err) {
    console.error("[notifyCollectionChanges]", err);
  }
}

// ── Collection : UPSERT one entry ──
app.put("/api/collection/:userId/:spriteId", security.validateBody(security.schemas.collectionEntrySchema), async (req, res) => {
  const { userId } = req.params;
  let { spriteId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  if (!spriteId || spriteId.length > 120) return res.status(400).json({ error: "spriteId invalide" });
  const { variantId, spriteId: baseSpriteId } = await normalizeVariantId(spriteId);
  const { status, note, priority, obtainedAt } = req.validatedBody;
  try {
    const prev = await pool.query(
      `SELECT status FROM sprite_entries WHERE user_id = $1 AND variant_id = $2`,
      [userId, variantId]
    );
    const prevStatus = prev.rows.length ? prev.rows[0].status : "new";

    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, NOW())
       ON CONFLICT (user_id, variant_id)
       DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                     status = COALESCE($4, sprite_entries.status),
                     note = COALESCE($5, sprite_entries.note),
                     priority = COALESCE($6, sprite_entries.priority),
                     obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                     updated_at = NOW()`,
      [userId, variantId, baseSpriteId, status || "new", note ?? "", priority || "none", obtainedAt || null]
    );

    const newStatus = status || "new";
    if (newStatus !== prevStatus) {
      pool.query(
        `INSERT INTO collection_history (user_id, sprite_id, old_status, new_status) VALUES ($1, $2, $3, $4)`,
        [userId, variantId, prevStatus, newStatus]
      ).catch(() => {});
    }

    // Ensure cached collection is refreshed before squad stats/logic that depends on it.
    invalidateCompareCacheForUser(userId);

    if ((status === "owned") && prevStatus !== "owned") {
      const affectedSquads = await logSquadCollectionEvent(userId, variantId, baseSpriteId, "owned");
      for (const squadId of affectedSquads || []) {
        try { await refreshSquadStats(squadId); } catch (err) { console.error("[setEntry] refresh squad stats failed", err); }
      }
    }

    await checkAffectedGoals(userId, variantId);
    res.json({ ok: true });
    broadcastSquadUpdate(userId);
    notifyCollectionChanges(userId, [{
      variantId,
      spriteId: baseSpriteId,
      oldStatus: prevStatus,
      newStatus
    }]);
    broadcastCompareUpdate(userId, {
      changes: [{
        variantId,
        spriteId: baseSpriteId,
        status: newStatus,
        priority: priority || "none",
        note: note ?? "",
        obtainedAt: obtainedAt || null
      }]
    });
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
  const normalizedCollection = await normalizeCollection(collection);

  const variantIds = Object.keys(normalizedCollection).filter(v => !v.startsWith("fav_"));
  const prevRes = await pool.query(
    `SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries
     WHERE user_id = $1 AND variant_id = ANY($2)`,
    [userId, variantIds]
  );
  const prevMap = Object.fromEntries(prevRes.rows.map(r => [r.variant_id, r]));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, COALESCE($8::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($8::timestamptz, NOW())`,
        [
          userId, variantId, entry.spriteId || null,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    const compareChanges = [];
    const notifyChanges = [];
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      const old = prevMap[variantId];
      const newStatus = entry.status || "new";
      const newNote = entry.note || "";
      const newPriority = entry.priority || "none";
      const newObtainedAt = entry.obtainedAt || null;
      const changed = !old
        || old.status !== newStatus
        || old.note !== newNote
        || old.priority !== newPriority
        || String(old.obtained_at || "") !== String(newObtainedAt);
      if (changed) {
        notifyChanges.push({ variantId, spriteId: entry.spriteId || null, oldStatus: old ? old.status : "new", newStatus });
      }
      compareChanges.push({
        variantId,
        spriteId: entry.spriteId || null,
        status: newStatus,
        priority: newPriority,
        note: newNote,
        obtainedAt: newObtainedAt
      });
    }
    res.json({ ok: true, count: Object.keys(normalizedCollection).length });
    broadcastSquadUpdate(userId);
    invalidateCompareCacheForUser(userId);
    notifyCollectionChanges(userId, notifyChanges);
    broadcastCompareUpdate(userId, { changes: compareChanges });
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
  const normalizedCollection = await normalizeCollection(collection);

  const variantIds = Object.keys(normalizedCollection).filter(v => !v.startsWith("fav_"));
  const prevRes = await pool.query(
    `SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries
     WHERE user_id = $1 AND variant_id = ANY($2)`,
    [userId, variantIds]
  );
  const prevMap = Object.fromEntries(prevRes.rows.map(r => [r.variant_id, r]));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, COALESCE($8::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($8::timestamptz, NOW())`,
        [
          userId, variantId, entry.spriteId || null,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    const compareChanges = [];
    const notifyChanges = [];
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      const old = prevMap[variantId];
      const newStatus = entry.status || "new";
      const newNote = entry.note || "";
      const newPriority = entry.priority || "none";
      const newObtainedAt = entry.obtainedAt || null;
      const changed = !old
        || old.status !== newStatus
        || old.note !== newNote
        || old.priority !== newPriority
        || String(old.obtained_at || "") !== String(newObtainedAt);
      if (changed) {
        notifyChanges.push({ variantId, spriteId: entry.spriteId || null, oldStatus: old ? old.status : "new", newStatus });
      }
      compareChanges.push({
        variantId,
        spriteId: entry.spriteId || null,
        status: newStatus,
        priority: newPriority,
        note: newNote,
        obtainedAt: newObtainedAt
      });
    }
    res.json({ ok: true, count: Object.keys(normalizedCollection).length });
    invalidateCompareCacheForUser(userId);
    notifyCollectionChanges(userId, notifyChanges);
    broadcastCompareUpdate(userId, { changes: compareChanges });
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
    invalidateCompareCacheForUser(req.params.userId);
    broadcastCompareUpdate(req.params.userId, { type: "compare_reset" });
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
