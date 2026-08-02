const ctx = require("./shared");

module.exports = {
  name: "rétention + suppression compte + consentement + anti-abus (Étapes 66–70)",
  async run() {
    const {  } = ctx;
    await ensureGraphEventsTable(pool);
    const {
      GRAPH_RETENTION_POLICY,
      GRAPH_CONSENT_LAYERS,
      GRAPH_UPDATE_METHODS,
      resolveUpdateMethod,
      evaluateGraphEventAcceptance,
      anonymizeUserGraphData,
      scrubPersonalContext,
      setCommunityStatsOptIn,
      getCommunityStatsOptIn,
      shouldCountEventTowardCommunity
    } = require("../server/sprite-graph-governance");

    // Étape 66
    assert.strictEqual(GRAPH_RETENTION_POLICY.dailyAggregates.retention, "permanent");
    assert.ok(GRAPH_RETENTION_POLICY.technicalLogs.retentionDays >= 30);
    assert.ok(GRAPH_RETENTION_POLICY.deliveryData.retentionDays >= 30);
    assert.strictEqual(GRAPH_RETENTION_POLICY.respectsAccountDeletion, true);

    // Étape 68 — layers
    assert.strictEqual(GRAPH_CONSENT_LAYERS.NECESSARY, "necessary");
    assert.strictEqual(GRAPH_CONSENT_LAYERS.COMMUNITY_PUBLIC, "community_public");

    // Étape 70 — updateMethod resolution
    assert.strictEqual(
      resolveUpdateMethod({ source: "import", previousCollectionCount: 0 }),
      GRAPH_UPDATE_METHODS.INITIAL_IMPORT
    );
    assert.strictEqual(
      resolveUpdateMethod({ source: "import", previousCollectionCount: 40 }),
      GRAPH_UPDATE_METHODS.BULK_IMPORT
    );
    assert.strictEqual(
      resolveUpdateMethod({ source: "api", origin: "collection.setEntry" }),
      GRAPH_UPDATE_METHODS.MANUAL_UPDATE
    );

    const user = await register(`Gov${rnd()}`);
    await pool.query(
      `UPDATE users SET last_active_at = NOW(), is_test_account = FALSE,
         community_stats_opt_in = NULL,
         cookie_consent = '{"necessary":true,"analytics":false}'::jsonb
       WHERE id = $1`,
      [user.id]
    );

    // Consent — community opt-in without gating essentials (module + API if restarted).
    await setCommunityStatsOptIn(pool, user.id, true);
    let participation = await getCommunityStatsOptIn(pool, user.id);
    assert.strictEqual(participation.participates, true);
    assert.strictEqual(participation.essentialFeaturesRequireCommunityConsent, false);

    const consentRes = await fetch(`${API}/consent`, {
      method: "PATCH",
      headers: auth(user.token),
      body: JSON.stringify({ communityStatsOptIn: true })
    });
    if (consentRes.ok) {
      const consentBody = await consentRes.json();
      assert.strictEqual(consentBody.essentialFeaturesRequireCommunityConsent, false);
      assert.strictEqual(consentBody.communityStatsOptIn, true);
    }

    await setCommunityStatsOptIn(pool, user.id, false);
    participation = await getCommunityStatsOptIn(pool, user.id);
    assert.strictEqual(participation.participates, false);

    // Étape 69 — test account excluded from community counts.
    await pool.query(`UPDATE users SET is_test_account = TRUE WHERE id = $1`, [user.id]);
    const testGate = await evaluateGraphEventAcceptance(pool, {
      actorUserId: user.id,
      source: "api",
      updateMethod: "manual_update"
    });
    assert.strictEqual(testGate.accept, true);
    assert.strictEqual(testGate.countTowardCommunity, false);
    assert.strictEqual(shouldCountEventTowardCommunity(testGate), false);

    await pool.query(`UPDATE users SET is_test_account = FALSE WHERE id = $1`, [user.id]);
    const importGate = await evaluateGraphEventAcceptance(pool, {
      actorUserId: user.id,
      source: "import",
      origin: "collection.import",
      updateMethod: "initial_import",
      changeCount: 70,
      previousCollectionCount: 0
    });
    assert.strictEqual(importGate.accept, true);
    assert.strictEqual(importGate.updateMethod, GRAPH_UPDATE_METHODS.INITIAL_IMPORT);
    assert.ok(shouldCountEventTowardCommunity(importGate));

    // Collection events stamp updateMethod.
    const variantRes = await pool.query(`SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;
    const events = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: true,
      newStatus: "owned",
      newPriority: "none",
      changeId: `gov-import-${rnd()}`
    }], {
      source: "import",
      origin: "collection.import",
      updateMethod: "initial_import",
      previousCollectionCount: 0
    });
    assert.ok(events.length >= 1);
    assert.strictEqual(events[0].context.updateMethod, "initial_import");

    // Étape 67 — anonymize on deletion path.
    const personal = scrubPersonalContext({
      note: "secret",
      catalogueVersion: "v1",
      updateMethod: "manual_update",
      username: "x"
    });
    assert.strictEqual(personal.note, undefined);
    assert.strictEqual(personal.username, undefined);
    assert.strictEqual(personal.catalogueVersion, "v1");
    assert.strictEqual(personal.anonymized, true);

    const dedupe = `gov-anon-${rnd()}`;
    await recordGraphEvent(pool, {
      eventType: GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED,
      actorUserId: user.id,
      variantId,
      spriteId,
      source: "api",
      occurredAt: new Date().toISOString(),
      context: { note: "private-note", catalogueVersion: "keep", updateMethod: "manual_update" },
      deduplicationKey: dedupe
    });

    const anon = await anonymizeUserGraphData(pool, user.id, { recalculateSensitive: false });
    assert.ok(anon.ok);
    assert.ok(anon.eventsAnonymized >= 1);

    const after = await pool.query(
      `SELECT actor_user_id, target_user_id, context
       FROM graph_events WHERE id IN (
         SELECT id FROM graph_events WHERE context->>'catalogueVersion' = 'keep'
         OR deduplication_key LIKE 'anon:%'
       )
       ORDER BY recorded_at DESC LIMIT 5`
    );
    assert.ok(after.rows.some((r) => r.actor_user_id == null));
    const scrubbedRow = after.rows.find((r) => r.context && r.context.catalogueVersion === "keep");
    if (scrubbedRow) {
      assert.strictEqual(scrubbedRow.context.note, undefined);
      assert.strictEqual(scrubbedRow.context.anonymized, true);
    }

    // Profile self payload exposes opt-in flag when server is up-to-date.
    const other = await register(`Gov2${rnd()}`);
    await setCommunityStatsOptIn(pool, other.id, true);
    const prof = await fetch(`${API}/profile/${other.id}`, { headers: auth(other.token) });
    assert.ok(prof.ok);
    const profBody = await prof.json();
    if ("communityStatsOptIn" in profBody) {
      assert.strictEqual(profBody.essentialFeaturesRequireCommunityConsent, false);
    } else {
      const p = await getCommunityStatsOptIn(pool, other.id);
      assert.strictEqual(p.essentialFeaturesRequireCommunityConsent, false);
      assert.strictEqual(p.participates, true);
    }
  }
};
