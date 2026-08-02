const {
  app, pool, security, requireNotSuspended, requireSameUser, normalizeVariantId,
  normalizeMasteryLevel, invalidateCompareCacheForUser, invalidateSquadAnalysisCacheForUser,
  logSquadCollectionEvent, refreshSquadStats, checkAffectedGoals,
  broadcastSquadUpdate, broadcastSquadCompletionUpdate, broadcastCompareUpdate,
  broadcastFriendCollectionUpdate
} = require("./shared");
const { emitVariantAcquiredEvents, notifyCollectionChanges, scheduleSquadStatsForUser } = require("./effects");

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
    await require("../../../../../server/sprite-graph").recordCollectionGraphEvents(userId, [graphChange], {
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
      if (require("../../../../../server/passport-integrity").isOwnedMissingFlip(prevStatus, newStatus)) {
        require("../../../../../server/passport-integrity").logCollectionIntegrityEvent(userId, {
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
        const { recordOwnedVariants } = require("../../../../../server/passport-activity");
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
      require("../../../../../server/passport-summary").schedulePassportRecalc(userId, {
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
    broadcastFriendCollectionUpdate(userId);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  } finally {
    client.release();
  }
});
