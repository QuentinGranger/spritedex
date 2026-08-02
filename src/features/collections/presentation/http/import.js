const {
  app,
  pool,
  security,
  requireNotSuspended,
  requireSameUser,
  normalizeCollection,
  normalizeMasteryLevel,
  invalidateCompareCacheForUser,
  invalidateSquadAnalysisCacheForUser,
  broadcastSquadUpdate,
  broadcastSquadCompletionUpdate,
  broadcastCompareUpdate,
  broadcastFriendCollectionUpdate
} = require("./shared");
const { emitVariantAcquiredEvents, notifyCollectionChanges, scheduleSquadStatsForUser } = require("./effects");

app.post(
  "/api/collection/:userId/import",
  requireNotSuspended,
  security.syncLimiter,
  security.validateBody(security.schemas.collectionSyncSchema),
  async (req, res) => {
    const { userId } = req.params;
    if (!(await requireSameUser(req, res, userId))) return;
    const { collection } = req.validatedBody;
    const normalizedCollection = await normalizeCollection(collection);

    const variantIds = Object.keys(normalizedCollection).filter((v) => !v.startsWith("fav_"));
    const prevRes = await pool.query(
      `SELECT id, variant_id, status, note, priority, obtained_at, mastery_level FROM sprite_entries
     WHERE user_id = $1 AND variant_id = ANY($2)`,
      [userId, variantIds]
    );
    const prevMap = Object.fromEntries(prevRes.rows.map((r) => [r.variant_id, r]));
    const prevTotalRes = await pool.query("SELECT COUNT(*)::int AS c FROM sprite_entries WHERE user_id = $1", [userId]);
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
      await client.query("DELETE FROM sprite_entries WHERE user_id = $1 AND NOT (variant_id = ANY($2))", [
        userId,
        variantIds
      ]);
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
            userId,
            variantId,
            entry.spriteId || null,
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
        const changed =
          !old ||
          old.status !== newStatus ||
          old.note !== newNote ||
          old.priority !== newPriority ||
          Number(old.mastery_level || 0) !== newMasteryLevel ||
          String(old.obtained_at || "") !== String(newObtainedAt);
        if (changed) {
          notifyChanges.push({
            variantId,
            spriteId: entry.spriteId || null,
            oldStatus: old ? old.status : "new",
            newStatus,
            oldPriority: old ? old.priority || "none" : "none",
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
            previousPriority: isNewEntry ? null : old.priority || "none",
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
        await require("../../../../../server/sprite-graph").recordCollectionGraphEvents(userId, graphChanges, {
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
        integrity: require("../../../../../server/passport-integrity").detectImportIncoherence({
          previousCount,
          nextCount,
          deletedCount,
          changes: notifyChanges,
          ownedRatio
        })
      });
      invalidateCompareCacheForUser(userId);
      invalidateSquadAnalysisCacheForUser(userId);
      scheduleSquadStatsForUser(userId).catch((err) => console.error("[import] squad stats refresh failed", err));
      broadcastSquadUpdate(userId);
      broadcastSquadCompletionUpdate(userId);
      notifyCollectionChanges(
        userId,
        notifyChanges.filter((c) => c.newStatus !== "removed")
      );
      emitVariantAcquiredEvents(
        userId,
        notifyChanges.filter((c) => c.newStatus !== "removed")
      ).catch((err) => console.error("[import] variant_acquired emit failed", err));
      broadcastCompareUpdate(userId, { changes: compareChanges });
      broadcastFriendCollectionUpdate(userId);

      setImmediate(() => {
        const integrity = require("../../../../../server/passport-integrity");
        const incoherence = integrity.detectImportIncoherence({
          previousCount,
          nextCount,
          deletedCount,
          changes: notifyChanges,
          ownedRatio
        });
        integrity
          .recordStatusHistory(userId, notifyChanges)
          .catch((err) => console.error("[import] collection_history failed", err));
        integrity
          .logCollectionIntegrityEvent(userId, {
            source: "import",
            changes: notifyChanges,
            deletedCount,
            extraFlags: incoherence.flags,
            details: { previousCount, nextCount, ownedRatio }
          })
          .catch((err) => console.error("[import] integrity log failed", err));
      });

      const ownedGains = notifyChanges
        .filter((c) => c.newStatus === "owned" && c.oldStatus !== "owned")
        .map((c) => c.variantId);
      if (ownedGains.length) {
        setImmediate(() => {
          const { recordOwnedVariants } = require("../../../../../server/passport-activity");
          recordOwnedVariants(userId, ownedGains).catch((err) =>
            console.error("[import] passport activity failed", err)
          );
          try {
            const { emitDomainEvent, DOMAIN_EVENTS } = require("../../../../../server/event-bus");
            emitDomainEvent(DOMAIN_EVENTS.COLLECTION_UPDATED, {
              actorId: userId,
              entityType: "user",
              entityId: String(userId),
              context: { source: "import", ownedGainCount: ownedGains.length }
            }).catch(() => {});
          } catch (_) {
            /* optional */
          }
          // Étape 74 — import → queue → recalc → badges (not on request thread).
          require("../../../../../server/passport-summary")
            .schedulePassportRecalc(userId, {
              mode: "queue",
              reason: "collection.import",
              triggerEvent: "collection.updated",
              collectionChanged: true,
              notify: true
            })
            .catch((err) => console.error("[import] passport recalc enqueue failed", err));
        });
      }
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ error: "Erreur import" });
    } finally {
      client.release();
    }
  }
);
