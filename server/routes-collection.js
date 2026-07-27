// routes-collection.js — extracted from server.js

const pushService = require("../push-service");
const security = require("../security");
const { areFriends, canViewCollection, getRequestingUser, getVisibility, requireNotSuspended, requireSameUser } = require("./auth");
const { normalizeCollection, normalizeVariantId } = require("./catalog");
const { invalidateCompareCacheForUser } = require("./compare");
const { app } = require("./core");
const { pool } = require("./db");
const { broadcastCompareUpdate, broadcastSquadUpdate, broadcastSquadCompletionUpdate } = require("./ws");
const { logSquadCollectionEvent } = require("./squad-activity");
const { refreshSquadStats, scheduleSquadStatsRefresh } = require("./routes-squad-invitations");
const { checkAffectedGoals } = require("./routes-goals");
const { invalidateSquadAnalysisCacheForUser } = require("./squad-analysis-cache");
const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
const { isAcquiredFromStatus } = require("./notification-gates");
const acquisition = require("./notification-acquisition");

const MASTERY_MAX_LEVEL = 5;

function normalizeMasteryLevel(entry, status) {
  if (status !== "owned") return 0;
  const level = Number(entry?.masteryLevel);
  return Number.isInteger(level) && level >= 1 && level <= MASTERY_MAX_LEVEL ? level : 1;
}

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
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, mastery_level, updated_at FROM sprite_entries WHERE user_id = $1",
      [userId]
    );
    // variant_id values originate from persisted user data, including older
    // imports made before key validation existed.  A null-prototype record
    // keeps a legacy "__proto__" row inert while it is serialized.
    const collection = Object.create(null);
    for (const row of result.rows) {
      collection[row.variant_id] = {
        spriteId: row.sprite_id,
        status: row.status,
        note: canSeeNotes ? (row.note || "") : "",
        priority: canSeePriority ? (row.priority || "none") : "none",
        masteryLevel: row.status === "owned" ? Math.max(1, Number(row.mastery_level) || 1) : 0,
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

// ── Notify friends about generic collection edits ───────────────────────
// friend_priority_match is replaced by collection.variant_acquired →
// friend_acquired_missing_variant (Étapes 15–21). This path only emits a
// coarse friend_collection_updated for non-acquisition edits.
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

// ── Collection : UPSERT one entry ──
app.put("/api/collection/:userId/:spriteId", requireNotSuspended, security.validateBody(security.schemas.collectionEntrySchema), async (req, res) => {
  const { userId } = req.params;
  let { spriteId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  if (!spriteId || spriteId.length > 120) return res.status(400).json({ error: "spriteId invalide" });
  const { variantId, spriteId: baseSpriteId } = await normalizeVariantId(spriteId);
  if (!variantId) return res.status(400).json({ error: "spriteId invalide" });
  const { status, note, priority, obtainedAt, masteryLevel } = req.validatedBody;
  const hasObtainedAt = Object.prototype.hasOwnProperty.call(req.validatedBody, "obtainedAt");
  const hasMasteryLevel = Object.prototype.hasOwnProperty.call(req.validatedBody, "masteryLevel");
  const client = await pool.connect();
  try {
    // Étape 30 — collection write + graph event in one transaction.
    await client.query("BEGIN");
    const prev = await client.query(
      `SELECT id, status, priority, mastery_level FROM sprite_entries
       WHERE user_id = $1 AND variant_id = $2
       FOR UPDATE`,
      [userId, variantId]
    );
    const isNewEntry = prev.rows.length === 0;
    const prevStatus = isNewEntry ? "new" : prev.rows[0].status;
    const prevPriority = isNewEntry ? "none" : (prev.rows[0].priority || "none");
    const nextStatus = status ?? prevStatus;
    if (hasMasteryLevel && masteryLevel > 0 && nextStatus !== "owned") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Le niveau de maîtrise nécessite une variante possédée." });
    }
    const nextMasteryLevel = hasMasteryLevel
      ? normalizeMasteryLevel({ masteryLevel }, nextStatus)
      : null;

    const saved = await client.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, mastery_level, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, 'new'), COALESCE($5, ''), COALESCE($6, 'none'), $7::timestamptz,
               CASE WHEN COALESCE($4, 'new') = 'owned' THEN COALESCE($9, 1) ELSE 0 END, NOW())
       ON CONFLICT (user_id, variant_id)
       DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                     status = COALESCE($4, sprite_entries.status),
                     note = COALESCE($5, sprite_entries.note),
                     priority = COALESCE($6, sprite_entries.priority),
                     obtained_at = CASE WHEN $8 THEN $7::timestamptz ELSE sprite_entries.obtained_at END,
                     mastery_level = CASE
                       WHEN COALESCE($4, sprite_entries.status) <> 'owned' THEN 0
                       WHEN $10 THEN $9
                       WHEN sprite_entries.status <> 'owned' THEN 1
                       ELSE GREATEST(sprite_entries.mastery_level, 1)
                     END,
                     updated_at = NOW()
       RETURNING id, status, note, priority, obtained_at, mastery_level`,
      [
        userId,
        variantId,
        baseSpriteId,
        status ?? null,
        note ?? null,
        priority ?? null,
        hasObtainedAt && obtainedAt !== "" ? obtainedAt : null,
        hasObtainedAt,
        nextMasteryLevel,
        hasMasteryLevel
      ]
    );

    const savedEntry = saved.rows[0];
    const newStatus = savedEntry.status;
    let historyId = null;
    if (!isNewEntry && newStatus !== prevStatus) {
      try {
        const hist = await client.query(
          `INSERT INTO collection_history (user_id, sprite_id, old_status, new_status)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [userId, variantId, prevStatus, newStatus]
        );
        historyId = hist.rows[0]?.id || null;
      } catch (_) {}
    }

    const graphChange = {
      variantId,
      spriteId: baseSpriteId,
      isNewEntry,
      entryId: savedEntry.id,
      changeId: isNewEntry ? `entry_${savedEntry.id}` : (historyId != null ? `history_${historyId}` : `entry_${savedEntry.id}`),
      historyId,
      previousStatus: isNewEntry ? null : prevStatus,
      newStatus,
      previousPriority: isNewEntry ? null : prevPriority,
      newPriority: savedEntry.priority || "none"
    };
    await require("./sprite-graph").recordCollectionGraphEvents(userId, [graphChange], {
      source: "api",
      origin: "collection.setEntry",
      updateMethod: "manual_update",
      db: client,
      throwOnError: true
    });
    await client.query("COMMIT");

    if (!isNewEntry && newStatus !== prevStatus) {
      const change = { variantId, oldStatus: prevStatus, newStatus };
      // Étape 77 — soft flip signal (log only, never block fast edits).
      if (require("./passport-integrity").isOwnedMissingFlip(prevStatus, newStatus)) {
        require("./passport-integrity").logCollectionIntegrityEvent(userId, {
          source: "setEntry",
          changes: [change],
          details: { variantId }
        }).catch(() => {});
      }
    }

    // Ensure cached collection is refreshed before squad stats/logic that depends on it.
    invalidateCompareCacheForUser(userId);
    invalidateSquadAnalysisCacheForUser(userId);

    if ((status === "owned") && prevStatus !== "owned") {
      const affectedSquads = await logSquadCollectionEvent(userId, variantId, baseSpriteId, "owned");
      for (const squadId of affectedSquads || []) {
        try {
          // Étape 22 — recompute coverage and emit squad.completion_changed on real gains.
          await refreshSquadStats(squadId, {
            contributingUserId: userId,
            newVariantIds: [variantId]
          });
        } catch (err) {
          console.error("[setEntry] refresh squad stats failed", err);
        }
      }
      try {
        const { recordOwnedVariants } = require("./passport-activity");
        await recordOwnedVariants(userId, [variantId], { spriteId: baseSpriteId });
      } catch (err) {
        console.error("[setEntry] passport activity failed", err);
      }
    }

    // A demotion (owned → missing), an import-like edit, or a priority change
    // must refresh the stored squad stats too.  The owned-gain path above
    // remains synchronous so coverage notifications retain their exact gain.
    if (newStatus !== prevStatus || note !== undefined || priority !== undefined || hasObtainedAt || hasMasteryLevel) {
      scheduleSquadStatsForUser(userId).catch(err =>
        console.error("[setEntry] squad stats refresh failed", err)
      );
    }

    await checkAffectedGoals(userId, variantId);
    res.json({ ok: true, masteryLevel: savedEntry.mastery_level });
    broadcastSquadUpdate(userId);
    broadcastSquadCompletionUpdate(userId);
    if (newStatus === "owned" || prevStatus === "owned") {
      // Étape 73/74 — non-blocking recalc (immediate for single entry).
      require("./passport-summary").schedulePassportRecalc(userId, {
        mode: "immediate",
        reason: "variant_status_changed",
        triggerEvent: "collection.variant_acquired",
        collectionChanged: true,
        notify: true,
        batchNotify: true
      }).catch((err) =>
        console.error("[setEntry] passport recalc schedule failed", err)
      );
    }
    const change = {
      variantId,
      spriteId: baseSpriteId,
      oldStatus: prevStatus,
      newStatus,
      oldPriority: prevPriority,
      newPriority: savedEntry.priority || "none"
    };
    notifyCollectionChanges(userId, [change]);
    emitVariantAcquiredEvents(userId, [change]).catch(err =>
      console.error("[setEntry] variant_acquired emit failed", err)
    );
    broadcastCompareUpdate(userId, {
      changes: [{
        variantId,
        spriteId: baseSpriteId,
        status: newStatus,
        priority: savedEntry.priority || "none",
        note: savedEntry.note || "",
        obtainedAt: savedEntry.obtained_at || null,
        masteryLevel: savedEntry.mastery_level
      }]
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});

// ── Collection : bulk sync ──
app.post("/api/collection/:userId/sync", requireNotSuspended, security.syncLimiter, security.validateBody(security.schemas.collectionSyncSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { collection } = req.validatedBody;
  const normalizedCollection = await normalizeCollection(collection);

  const variantIds = Object.keys(normalizedCollection).filter(v => !v.startsWith("fav_"));
  const prevRes = await pool.query(
    `SELECT id, variant_id, status, note, priority, obtained_at, mastery_level FROM sprite_entries
     WHERE user_id = $1 AND variant_id = ANY($2)`,
    [userId, variantIds]
  );
  const prevMap = Object.fromEntries(prevRes.rows.map(r => [r.variant_id, r]));

  const client = await pool.connect();
  const upsertedIds = Object.create(null);
  const compareChanges = [];
  const notifyChanges = [];
  const graphChanges = [];
  try {
    await client.query("BEGIN");
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      const entryStatus = entry.status || "new";
      const entryMasteryLevel = normalizeMasteryLevel(entry, entryStatus);
      const upsert = await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, mastery_level, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, COALESCE($9::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       mastery_level = $8,
                       updated_at = COALESCE($9::timestamptz, NOW())
         RETURNING id`,
        [
          userId, variantId, entry.spriteId || null,
          entryStatus,
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entryMasteryLevel,
          entry.updatedAt || null
        ]
      );
      upsertedIds[variantId] = upsert.rows[0]?.id;
    }
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      const old = prevMap[variantId];
      const isNewEntry = !old;
      const newStatus = entry.status || "new";
      const newNote = entry.note || "";
      const newPriority = entry.priority || "none";
      const newObtainedAt = entry.obtainedAt || null;
      const newMasteryLevel = normalizeMasteryLevel(entry, newStatus);
      const changed = !old
        || old.status !== newStatus
        || old.note !== newNote
        || old.priority !== newPriority
        || Number(old.mastery_level || 0) !== newMasteryLevel
        || String(old.obtained_at || "") !== String(newObtainedAt);
      if (changed) {
        notifyChanges.push({
          variantId,
          spriteId: entry.spriteId || null,
          oldStatus: old ? old.status : "new",
          newStatus,
          oldPriority: old ? (old.priority || "none") : "none",
          newPriority
        });
        graphChanges.push({
          variantId,
          spriteId: entry.spriteId || null,
          isNewEntry,
          entryId: upsertedIds[variantId] || (old && old.id) || null,
          changeId: isNewEntry
            ? `entry_${upsertedIds[variantId] || variantId}`
            : `sync_${upsertedIds[variantId] || variantId}_${old.status}->${newStatus}_${old.priority || "none"}->${newPriority}`,
          previousStatus: isNewEntry ? null : old.status,
          newStatus,
          previousPriority: isNewEntry ? null : (old.priority || "none"),
          newPriority
        });
      }
      compareChanges.push({
        variantId,
        spriteId: entry.spriteId || null,
        status: newStatus,
        priority: newPriority,
        note: newNote,
        obtainedAt: newObtainedAt,
        masteryLevel: newMasteryLevel
      });
    }
    // Étape 30 — persist graph events before COMMIT.
    if (graphChanges.length) {
      await require("./sprite-graph").recordCollectionGraphEvents(userId, graphChanges, {
        source: "api",
        origin: "collection.sync",
        updateMethod: graphChanges.length > 10 ? "sync_batch" : "manual_update",
        previousCollectionCount: variantIds.length,
        db: client,
        throwOnError: true
      });
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: Object.keys(normalizedCollection).length });
    broadcastSquadUpdate(userId);
    broadcastSquadCompletionUpdate(userId);
    invalidateCompareCacheForUser(userId);
    invalidateSquadAnalysisCacheForUser(userId);
    scheduleSquadStatsForUser(userId).catch(err =>
      console.error("[sync] squad stats refresh failed", err)
    );
    notifyCollectionChanges(userId, notifyChanges);
    emitVariantAcquiredEvents(userId, notifyChanges).catch(err =>
      console.error("[sync] variant_acquired emit failed", err)
    );
    // Étape 77 — history + soft integrity journal (does not slow the response path).
    if (notifyChanges.length) {
      setImmediate(() => {
        const integrity = require("./passport-integrity");
        integrity.recordStatusHistory(userId, notifyChanges).catch((err) =>
          console.error("[sync] collection_history failed", err)
        );
        integrity.logCollectionIntegrityEvent(userId, {
          source: "sync",
          changes: notifyChanges,
          details: { payloadSize: variantIds.length }
        }).catch((err) => console.error("[sync] integrity log failed", err));
      });
    }
    // Étape 22 — refresh squad coverage for newly owned variants.
    const ownedGains = notifyChanges
      .filter(c => c.newStatus === "owned" && c.oldStatus !== "owned")
      .map(c => c.variantId);
    if (ownedGains.length) {
      (async () => {
        try {
          const { recordOwnedVariants } = require("./passport-activity");
          await recordOwnedVariants(userId, ownedGains);
        } catch (err) {
          console.error("[sync] passport activity failed", err);
        }
        // Étape 74 — durable queue: don't await full passport recalc on the request path.
        try {
          const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
          await emitDomainEvent(DOMAIN_EVENTS.COLLECTION_UPDATED, {
            actorId: userId,
            entityType: "user",
            entityId: String(userId),
            context: { source: "sync", ownedGainCount: ownedGains.length }
          });
        } catch (_) { /* optional */ }
        require("./passport-summary").schedulePassportRecalc(userId, {
          mode: "queue",
          reason: "collection.updated",
          triggerEvent: "collection.updated",
          collectionChanged: true,
          notify: true
        }).catch((err) => console.error("[sync] passport recalc enqueue failed", err));
        for (const variantId of ownedGains) {
          const squads = await logSquadCollectionEvent(userId, variantId, null, "owned");
          for (const squadId of squads || []) {
            await refreshSquadStats(squadId, {
              contributingUserId: userId,
              newVariantIds: [variantId]
            });
          }
        }
      })().catch(err => console.error("[sync] squad completion refresh failed", err));
    }
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
app.post("/api/collection/:userId/import", requireNotSuspended, security.syncLimiter, security.validateBody(security.schemas.collectionSyncSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { collection } = req.validatedBody;
  const normalizedCollection = await normalizeCollection(collection);

  const variantIds = Object.keys(normalizedCollection).filter(v => !v.startsWith("fav_"));
  const prevRes = await pool.query(
    `SELECT id, variant_id, status, note, priority, obtained_at, mastery_level FROM sprite_entries
     WHERE user_id = $1 AND variant_id = ANY($2)`,
    [userId, variantIds]
  );
  const prevMap = Object.fromEntries(prevRes.rows.map(r => [r.variant_id, r]));
  const prevTotalRes = await pool.query(
    "SELECT COUNT(*)::int AS c FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  const previousCount = prevTotalRes.rows[0]?.c || 0;

  const client = await pool.connect();
  const upsertedIds = Object.create(null);
  const compareChanges = [];
  const notifyChanges = [];
  const graphChanges = [];
  let deletedCount = 0;
  try {
    await client.query("BEGIN");
    // Import is a REPLACE, not a merge: the payload is the user's complete
    // collection (e.g. a restored JSON export), so server entries absent from
    // it are deletions and must be removed. This is what propagates deletions
    // across devices — /sync stays a merge to avoid wiping data on login.
    const deletedRes = await client.query(
      `SELECT id, variant_id, status, priority FROM sprite_entries
       WHERE user_id = $1 AND NOT (variant_id = ANY($2))`,
      [userId, variantIds]
    );
    deletedCount = deletedRes.rows.length;
    await client.query(
      "DELETE FROM sprite_entries WHERE user_id = $1 AND NOT (variant_id = ANY($2))",
      [userId, variantIds]
    );
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      const entryStatus = entry.status || "new";
      const entryMasteryLevel = normalizeMasteryLevel(entry, entryStatus);
      const upsert = await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, mastery_level, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, COALESCE($9::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       mastery_level = $8,
                       updated_at = COALESCE($9::timestamptz, NOW())
         RETURNING id`,
        [
          userId, variantId, entry.spriteId || null,
          entryStatus,
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entryMasteryLevel,
          entry.updatedAt || null
        ]
      );
      upsertedIds[variantId] = upsert.rows[0]?.id;
    }
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      const old = prevMap[variantId];
      const isNewEntry = !old;
      const newStatus = entry.status || "new";
      const newNote = entry.note || "";
      const newPriority = entry.priority || "none";
      const newObtainedAt = entry.obtainedAt || null;
      const newMasteryLevel = normalizeMasteryLevel(entry, newStatus);
      const changed = !old
        || old.status !== newStatus
        || old.note !== newNote
        || old.priority !== newPriority
        || Number(old.mastery_level || 0) !== newMasteryLevel
        || String(old.obtained_at || "") !== String(newObtainedAt);
      if (changed) {
        notifyChanges.push({
          variantId,
          spriteId: entry.spriteId || null,
          oldStatus: old ? old.status : "new",
          newStatus,
          oldPriority: old ? (old.priority || "none") : "none",
          newPriority
        });
        graphChanges.push({
          variantId,
          spriteId: entry.spriteId || null,
          isNewEntry,
          entryId: upsertedIds[variantId] || (old && old.id) || null,
          changeId: isNewEntry
            ? `entry_${upsertedIds[variantId] || variantId}`
            : `import_${upsertedIds[variantId] || variantId}_${old.status}->${newStatus}`,
          previousStatus: isNewEntry ? null : old.status,
          newStatus,
          previousPriority: isNewEntry ? null : (old.priority || "none"),
          newPriority
        });
      }
      compareChanges.push({
        variantId,
        spriteId: entry.spriteId || null,
        status: newStatus,
        priority: newPriority,
        note: newNote,
        obtainedAt: newObtainedAt,
        masteryLevel: newMasteryLevel
      });
    }
    // Treat removed rows as status transitions for history (possession audit trail).
    for (const row of deletedRes.rows) {
      notifyChanges.push({
        variantId: row.variant_id,
        spriteId: null,
        oldStatus: row.status || "new",
        newStatus: "removed",
        oldPriority: row.priority || "none",
        newPriority: "none"
      });
      graphChanges.push({
        variantId: row.variant_id,
        spriteId: null,
        isNewEntry: false,
        entryId: row.id,
        changeId: `import_removed_${row.id}`,
        previousStatus: row.status || "new",
        newStatus: "removed",
        previousPriority: row.priority || "none",
        newPriority: "none"
      });
    }
    // Étape 30 — persist graph events before COMMIT.
    if (graphChanges.length) {
      await require("./sprite-graph").recordCollectionGraphEvents(userId, graphChanges, {
        source: "import",
        origin: "collection.import",
        // Étape 70 — distinguish initial import vs later bulk replace.
        updateMethod: previousCount <= 5 ? "initial_import" : "bulk_import",
        previousCollectionCount: previousCount,
        db: client,
        throwOnError: true
      });
    }
    await client.query("COMMIT");

    // After import the live count is the payload size.
    const nextCount = variantIds.length;
    const ownedInPayload = Object.values(normalizedCollection).filter(
      (e) => e && String(e.status || "").toLowerCase() === "owned"
    ).length;
    const ownedRatio = nextCount ? ownedInPayload / nextCount : 0;

    res.json({
      ok: true,
      count: Object.keys(normalizedCollection).length,
      // Soft signal only — clients may ignore (Étape 77).
      integrity: require("./passport-integrity").detectImportIncoherence({
        previousCount,
        nextCount,
        deletedCount,
        changes: notifyChanges,
        ownedRatio
      })
    });
    invalidateCompareCacheForUser(userId);
    invalidateSquadAnalysisCacheForUser(userId);
    scheduleSquadStatsForUser(userId).catch(err =>
      console.error("[import] squad stats refresh failed", err)
    );
    broadcastSquadUpdate(userId);
    broadcastSquadCompletionUpdate(userId);
    notifyCollectionChanges(userId, notifyChanges.filter((c) => c.newStatus !== "removed"));
    emitVariantAcquiredEvents(userId, notifyChanges.filter((c) => c.newStatus !== "removed")).catch(err =>
      console.error("[import] variant_acquired emit failed", err)
    );
    broadcastCompareUpdate(userId, { changes: compareChanges });

    setImmediate(() => {
      const integrity = require("./passport-integrity");
      const incoherence = integrity.detectImportIncoherence({
        previousCount,
        nextCount,
        deletedCount,
        changes: notifyChanges,
        ownedRatio
      });
      integrity.recordStatusHistory(userId, notifyChanges).catch((err) =>
        console.error("[import] collection_history failed", err)
      );
      integrity.logCollectionIntegrityEvent(userId, {
        source: "import",
        changes: notifyChanges,
        deletedCount,
        extraFlags: incoherence.flags,
        details: { previousCount, nextCount, ownedRatio }
      }).catch((err) => console.error("[import] integrity log failed", err));
    });

    const ownedGains = notifyChanges
      .filter(c => c.newStatus === "owned" && c.oldStatus !== "owned")
      .map(c => c.variantId);
    if (ownedGains.length) {
      setImmediate(() => {
        const { recordOwnedVariants } = require("./passport-activity");
        recordOwnedVariants(userId, ownedGains).catch((err) =>
          console.error("[import] passport activity failed", err)
        );
        try {
          const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
          emitDomainEvent(DOMAIN_EVENTS.COLLECTION_UPDATED, {
            actorId: userId,
            entityType: "user",
            entityId: String(userId),
            context: { source: "import", ownedGainCount: ownedGains.length }
          }).catch(() => {});
        } catch (_) { /* optional */ }
        // Étape 74 — import → queue → recalc → badges (not on request thread).
        require("./passport-summary").schedulePassportRecalc(userId, {
          mode: "queue",
          reason: "collection.import",
          triggerEvent: "collection.updated",
          collectionChanged: true,
          notify: true
        }).catch((err) =>
          console.error("[import] passport recalc enqueue failed", err)
        );
      });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur import" });
  } finally {
    client.release();
  }
});

// ── Reset ──
app.delete("/api/collection/:userId", requireNotSuspended, async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    await pool.query("DELETE FROM sprite_entries WHERE user_id = $1", [req.params.userId]);
    res.json({ ok: true });
    invalidateCompareCacheForUser(req.params.userId);
    invalidateSquadAnalysisCacheForUser(req.params.userId);
    scheduleSquadStatsForUser(req.params.userId).catch(err =>
      console.error("[reset collection] squad stats refresh failed", err)
    );
    broadcastSquadCompletionUpdate(req.params.userId);
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
