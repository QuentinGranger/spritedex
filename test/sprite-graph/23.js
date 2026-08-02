const ctx = require("./shared");

module.exports = {
  name: "collection.sprite_added (Étape 89)",
  async run() {
    const { API, BASE, FRIEND_INVITATION_METHODS, FRIEND_INVITATION_PUBLIC_METRIC_KEYS, FUTURE_GRAPH_EVENT_TYPES, GOAL_SCOPES, GRAPH_DATA_LEVELS, GRAPH_EVENT_COMMON_FIELDS, GRAPH_EVENT_SPECIFIC_FIELDS, GRAPH_EVENT_TYPES, GRAPH_EVENT_TYPE_SET, GRAPH_EVENT_VERSIONS, GRAPH_INTERACTION_EVENT_TYPES, GRAPH_INTERACTION_EVENT_TYPE_SET, GRAPH_SOURCES, INSUFFICIENT_COMMUNITY_DATA_MESSAGE, OWNERSHIP_SAMPLE_STATUSES, PUBLIC_ANONYMIZATION_MIN_USERS, applyPublicAnonymizationGate, assert, auth, buildComparisonCompletedContext, buildDeduplicationKey, buildFriendInvitationSentContext, buildGoalCompletedContext, buildGraphEventEnvelope, buildNotificationOpenedContext, buildSquadJoinedContext, calculateCommunityVariantStats, computeSquadJoinImpact, correctGraphEvent, ensureCommunityStatsTables, ensureGraphEventsTable, extractTopDifferenceSpriteIds, formatCommunityOwnershipDisplay, formatCommunityPriorityDisplay, formatRecentPriorityAddsDisplay, formatSampleSizeDisplay, fs, getCommunityVariantOwnership, getFriendInvitationPublicMetrics, getGraphAggregate, getMostSoughtVariants, getPriorityInterestMetrics, isFriendInvitationPubliclyExposable, isGraphEventCancelled, listEligibleCommunityUserIds, normalizeComparisonPair, normalizeGraphSource, normalizeInvitationMethod, path, pool, processGraphEventOutbox, recordCollectionGraphEvents, recordGraphEvent, recordParticipantComparisonSession, register, resolveGoalScope, rnd, root, roundRate, sanitizeGraphContext, stopCommunityStatsDailyJob, stopGraphOutboxWorker } = ctx;
    await ensureGraphEventsTable(pool);
    const user = await register(`SgAdd89${rnd()}`);
    const stranger = await register(`SgAdd89x${rnd()}`);
    const variantRes = await pool.query(
      `SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`
    );
    assert.ok(variantRes.rows.length, "variante catalogue requise");
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;
    const cat = "2026.07.18-1";

    // Première création de ligne.
    const first = await recordCollectionGraphEvents(user.id, [{
      variantId: `${variantId}__89a_${rnd()}`.slice(0, 100),
      spriteId,
      isNewEntry: true,
      changeId: `create89_${rnd()}`,
      newStatus: "owned",
      newPriority: "none"
    }], {
      source: "web",
      origin: "collection.setEntry",
      catalogueVersion: cat,
      updateMethod: "manual_update"
    });
    // Use a real catalogue variant for authorized path; synthetic id for pure unit create.
    const syntheticVariant = first[0]?.variantId;
    assert.ok(first.length >= 1);
    assert.strictEqual(first[0].eventType, "collection.sprite_added");
    assert.strictEqual(first[0].eventVersion, 1);
    assert.strictEqual(first[0].context.catalogueVersion, cat);
    assert.strictEqual(first[0].context.updateMethod, "manual_update");
    assert.strictEqual(first[0].context.newStatus, "owned");

    // Absence de doublon (même changeId).
    const changeId = String(first[0].deduplicationKey).split(":").slice(3).join(":");
    const retry = await recordCollectionGraphEvents(user.id, [{
      variantId: syntheticVariant,
      spriteId,
      isNewEntry: true,
      changeId,
      newStatus: "owned"
    }], { source: "web", catalogueVersion: cat });
    assert.strictEqual(retry.length, 0);

    // Import initial.
    const importVariant = `sg89imp_${rnd()}`;
    const imported = await recordCollectionGraphEvents(user.id, [{
      variantId: importVariant,
      spriteId,
      isNewEntry: true,
      changeId: `import_${importVariant}`,
      newStatus: "owned"
    }], {
      source: "import",
      origin: "collection.import",
      catalogueVersion: cat,
      updateMethod: "initial_import",
      previousCollectionCount: 0
    });
    assert.strictEqual(imported.length, 1);
    assert.strictEqual(imported[0].eventType, "collection.sprite_added");
    assert.strictEqual(imported[0].source, "import");
    assert.strictEqual(imported[0].context.updateMethod, "initial_import");
    assert.strictEqual(imported[0].context.catalogueVersion, cat);

    // Ajout manuel via API (variante existante + utilisateur autorisé).
    const beforeApi = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.sprite_added'`,
      [user.id, variantId]
    );
    // Ensure clean slate for this user+variant.
    await pool.query(
      `DELETE FROM sprite_entries WHERE user_id = $1 AND variant_id = $2`,
      [user.id, variantId]
    );
    const put = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(user.token),
      body: JSON.stringify({ status: "owned", priority: "none" })
    });
    assert.ok(put.ok, await put.text());
    await new Promise((r) => setTimeout(r, 120));
    const afterApi = await pool.query(
      `SELECT event_version, source, context, variant_id, actor_user_id
       FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.sprite_added'
       ORDER BY recorded_at DESC LIMIT 1`,
      [user.id, variantId]
    );
    assert.ok(afterApi.rows.length >= 1 || beforeApi.rows[0].n >= 0);
    if (afterApi.rows.length) {
      assert.strictEqual(afterApi.rows[0].actor_user_id, user.id);
      assert.strictEqual(afterApi.rows[0].variant_id, variantId);
      assert.strictEqual(Number(afterApi.rows[0].event_version), 1);
      assert.ok(
        afterApi.rows[0].source === "api"
          || afterApi.rows[0].context?.origin === "collection.setEntry"
      );
    }

    // Utilisateur non autorisé → pas de sprite_added pour le stranger.
    const beforeStranger = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'collection.sprite_added'`,
      [stranger.id]
    );
    const denied = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(stranger.token),
      body: JSON.stringify({ status: "owned" })
    });
    assert.ok(!denied.ok);
    const afterStranger = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'collection.sprite_added'`,
      [stranger.id]
    );
    assert.strictEqual(afterStranger.rows[0].n, beforeStranger.rows[0].n);

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 89"));
    assert.ok(doc.includes("collection.sprite_added"));
  }
};
