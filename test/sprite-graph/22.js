const ctx = require("./shared");

module.exports = {
  name: "contrat événements graph (Étape 88)",
  async run() {
    const {
      API,
      BASE,
      FRIEND_INVITATION_METHODS,
      FRIEND_INVITATION_PUBLIC_METRIC_KEYS,
      FUTURE_GRAPH_EVENT_TYPES,
      GOAL_SCOPES,
      GRAPH_DATA_LEVELS,
      GRAPH_EVENT_COMMON_FIELDS,
      GRAPH_EVENT_SPECIFIC_FIELDS,
      GRAPH_EVENT_TYPES,
      GRAPH_EVENT_TYPE_SET,
      GRAPH_EVENT_VERSIONS,
      GRAPH_INTERACTION_EVENT_TYPES,
      GRAPH_INTERACTION_EVENT_TYPE_SET,
      GRAPH_SOURCES,
      INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
      OWNERSHIP_SAMPLE_STATUSES,
      PUBLIC_ANONYMIZATION_MIN_USERS,
      applyPublicAnonymizationGate,
      assert,
      auth,
      buildComparisonCompletedContext,
      buildDeduplicationKey,
      buildFriendInvitationSentContext,
      buildGoalCompletedContext,
      buildGraphEventEnvelope,
      buildNotificationOpenedContext,
      buildSquadJoinedContext,
      calculateCommunityVariantStats,
      computeSquadJoinImpact,
      correctGraphEvent,
      ensureCommunityStatsTables,
      ensureGraphEventsTable,
      extractTopDifferenceSpriteIds,
      formatCommunityOwnershipDisplay,
      formatCommunityPriorityDisplay,
      formatRecentPriorityAddsDisplay,
      formatSampleSizeDisplay,
      fs,
      getCommunityVariantOwnership,
      getFriendInvitationPublicMetrics,
      getGraphAggregate,
      getMostSoughtVariants,
      getPriorityInterestMetrics,
      isFriendInvitationPubliclyExposable,
      isGraphEventCancelled,
      listEligibleCommunityUserIds,
      normalizeComparisonPair,
      normalizeGraphSource,
      normalizeInvitationMethod,
      path,
      pool,
      processGraphEventOutbox,
      recordCollectionGraphEvents,
      recordGraphEvent,
      recordParticipantComparisonSession,
      register,
      resolveGoalScope,
      rnd,
      root,
      roundRate,
      sanitizeGraphContext,
      stopCommunityStatsDailyJob,
      stopGraphOutboxWorker
    } = ctx;
    await ensureGraphEventsTable(pool);
    const user = await register(`SgEv88${rnd()}`);
    const other = await register(`SgEv88b${rnd()}`);
    const variantId = `sg88_${rnd()}`;
    const spriteId = `sg88s_${rnd()}`;
    const occurredAt = "2026-07-18T15:30:00.000Z";

    // Succès → événement créé.
    const okEv = await recordGraphEvent(
      pool,
      {
        eventType: "collection.sprite_added",
        actorUserId: user.id,
        spriteId,
        variantId,
        source: "web",
        origin: "test.etape88",
        occurredAt,
        context: { newStatus: "owned", catalogueVersion: "2026.07.18-1" },
        deduplicationKey: `etape88-ok-${user.id}-${variantId}`
      },
      { skipGovernance: true }
    );
    assert.ok(okEv && okEv.id);
    assert.strictEqual(okEv.eventType, "collection.sprite_added");
    assert.strictEqual(okEv.eventVersion, 1);
    assert.strictEqual(okEv.source, "web");
    assert.strictEqual(okEv.actorUserId, user.id);
    assert.strictEqual(okEv.variantId, variantId);
    assert.ok(okEv.occurredAt);
    assert.ok(String(okEv.occurredAt).startsWith("2026-07-18") || String(okEv.occurredAt).includes("2026"));
    assert.strictEqual(okEv.context.newStatus, "owned");
    assert.strictEqual(okEv.context.catalogueVersion, "2026.07.18-1");
    assert.strictEqual(okEv.context.origin, "test.etape88");
    for (const field of GRAPH_EVENT_COMMON_FIELDS) {
      assert.ok(field in okEv, `missing common field ${field}`);
    }

    // Déduplication.
    const dup = await recordGraphEvent(
      pool,
      {
        eventType: "collection.sprite_added",
        actorUserId: user.id,
        spriteId,
        variantId,
        source: "web",
        deduplicationKey: `etape88-ok-${user.id}-${variantId}`
      },
      { skipGovernance: true }
    );
    assert.strictEqual(dup, null);

    // Type inconnu → aucun événement.
    const unknown = await recordGraphEvent(
      pool,
      {
        eventType: "collection.not_a_real_event",
        actorUserId: user.id,
        source: "api"
      },
      { skipGovernance: true }
    );
    assert.strictEqual(unknown, null);

    // Échec métier (écriture collection refusée) → aucun nouvel event.
    const beforeFail = await pool.query(`SELECT COUNT(*)::int AS n FROM graph_events WHERE actor_user_id = $1`, [
      other.id
    ]);
    const denied = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(other.token),
      body: JSON.stringify({ status: "owned" })
    });
    assert.ok(!denied.ok, "cross-user setEntry must fail");
    const afterFail = await pool.query(`SELECT COUNT(*)::int AS n FROM graph_events WHERE actor_user_id = $1`, [
      other.id
    ]);
    assert.strictEqual(afterFail.rows[0].n, beforeFail.rows[0].n);

    // Version correcte via envelope.
    const env = buildGraphEventEnvelope({
      eventType: "collection.status_changed",
      actorUserId: user.id,
      variantId,
      source: "api"
    });
    assert.strictEqual(env.eventVersion, GRAPH_EVENT_VERSIONS["collection.status_changed"] || 1);
    assert.ok(env.occurredAt);
    assert.strictEqual(env.source, "api");

    // Transaction métier : event + entry même COMMIT.
    const client = await pool.connect();
    const txVariant = `sg88tx_${rnd()}`;
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority)
         VALUES ($1, $2, $3, 'owned', '', 'none')
         ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
        [user.id, txVariant, spriteId]
      );
      const txEv = await recordCollectionGraphEvents(
        user.id,
        [
          {
            variantId: txVariant,
            spriteId,
            isNewEntry: true,
            changeId: `tx_${txVariant}`,
            newStatus: "owned"
          }
        ],
        {
          source: "api",
          origin: "test.etape88.tx",
          catalogueVersion: "2026.07.18-1",
          db: client,
          throwOnError: true
        }
      );
      assert.strictEqual(txEv.length, 1);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    const persisted = await pool.query(
      `SELECT e.id AS entry_id, g.id AS event_id, g.context
       FROM sprite_entries e
       JOIN graph_events g
         ON g.actor_user_id = e.user_id AND g.variant_id = e.variant_id
        AND g.event_type = 'collection.sprite_added'
       WHERE e.user_id = $1 AND e.variant_id = $2`,
      [user.id, txVariant]
    );
    assert.ok(persisted.rows.length >= 1);
    assert.strictEqual(persisted.rows[0].context.catalogueVersion, "2026.07.18-1");

    const doc = fs.readFileSync(path.join(root, "SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 88"));
  }
};
