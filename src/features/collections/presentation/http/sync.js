const {
  app, pool, security, requireNotSuspended, requireSameUser, normalizeCollection,
  normalizeMasteryLevel, invalidateCompareCacheForUser, invalidateSquadAnalysisCacheForUser,
  broadcastSquadUpdate, broadcastSquadCompletionUpdate, broadcastCompareUpdate,
  broadcastFriendCollectionUpdate, logSquadCollectionEvent, refreshSquadStats
} = require("./shared");
const { emitVariantAcquiredEvents, notifyCollectionChanges, scheduleSquadStatsForUser } = require("./effects");

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
      await require("../../../../../server/sprite-graph").recordCollectionGraphEvents(userId, graphChanges, {
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
        const integrity = require("../../../../../server/passport-integrity");
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
          const { recordOwnedVariants } = require("../../../../../server/passport-activity");
          await recordOwnedVariants(userId, ownedGains);
        } catch (err) {
          console.error("[sync] passport activity failed", err);
        }
        // Étape 74 — durable queue: don't await full passport recalc on the request path.
        try {
          const { emitDomainEvent, DOMAIN_EVENTS } = require("../../../../../server/event-bus");
          await emitDomainEvent(DOMAIN_EVENTS.COLLECTION_UPDATED, {
            actorId: userId,
            entityType: "user",
            entityId: String(userId),
            context: { source: "sync", ownedGainCount: ownedGains.length }
          });
        } catch (_) { /* optional */ }
        require("../../../../../server/passport-summary").schedulePassportRecalc(userId, {
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
    broadcastFriendCollectionUpdate(userId);
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
