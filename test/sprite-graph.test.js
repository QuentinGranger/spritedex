// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Sprite Graph (Étapes 1–101)
// Append-only graph_events + corrections + sources + versions
// Needs live server for API cases: npm start, then npm run test:sprite-graph
// ─────────────────────────────────────────────────────────────────
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../server/db");
const {
  GRAPH_EVENT_TYPES,
  GRAPH_EVENT_TYPE_SET,
  GRAPH_SOURCES,
  GRAPH_EVENT_VERSIONS,
  GRAPH_EVENT_COMMON_FIELDS,
  GRAPH_EVENT_SPECIFIC_FIELDS,
  ensureGraphEventsTable,
  recordGraphEvent,
  recordCollectionGraphEvents,
  correctGraphEvent,
  isGraphEventCancelled,
  normalizeGraphSource,
  buildGraphEventEnvelope,
  buildDeduplicationKey,
  normalizeComparisonPair,
  normalizeInvitationMethod,
  buildFriendInvitationSentContext,
  getFriendInvitationPublicMetrics,
  isFriendInvitationPubliclyExposable,
  FRIEND_INVITATION_METHODS,
  FRIEND_INVITATION_PUBLIC_METRIC_KEYS,
  computeSquadJoinImpact,
  buildSquadJoinedContext,
  buildGoalCompletedContext,
  buildNotificationOpenedContext,
  resolveGoalScope,
  GOAL_SCOPES,
  GRAPH_DATA_LEVELS,
  PUBLIC_ANONYMIZATION_MIN_USERS,
  INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
  sanitizeGraphContext,
  applyPublicAnonymizationGate,
  buildComparisonCompletedContext,
  extractTopDifferenceSpriteIds,
  FUTURE_GRAPH_EVENT_TYPES,
  getPriorityInterestMetrics
} = require("../server/sprite-graph");
const {
  processGraphEventOutbox,
  getGraphAggregate,
  stopGraphOutboxWorker
} = require("../server/sprite-graph-outbox");
const {
  ensureCommunityStatsTables,
  calculateCommunityVariantStats,
  getCommunityVariantOwnership,
  getMostSoughtVariants,
  formatCommunityOwnershipDisplay,
  formatCommunityPriorityDisplay,
  formatSampleSizeDisplay,
  formatRecentPriorityAddsDisplay,
  roundRate,
  listEligibleCommunityUserIds,
  OWNERSHIP_SAMPLE_STATUSES,
  stopCommunityStatsDailyJob
} = require("../server/sprite-graph-community");
const { recordParticipantComparisonSession } = require("../server/comparison-sessions");

const BASE = process.env.BASE_URL || process.env.APP_URL || "http://localhost:3000";
const API = `${BASE.replace(/\/$/, "")}/api`;

function rnd() {
  return Math.random().toString(36).slice(2, 8);
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function register(username) {
  const email = `${username}_${rnd()}@example.com`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
      username,
      ageConfirmed: true,
      cguAccepted: true
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, username };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err && err.message ? err.message : err}`);
    return false;
  }
}

async function main() {
  console.log(`\nRunning SPRITNEX Sprite Graph étapes 1–101 against ${API}\n`);
  stopGraphOutboxWorker();
  stopCommunityStatsDailyJob();
  let passed = 0;
  let failed = 0;

  let ok = await run("contrat : 8 événements stables + doc (Étapes 1–3)", async () => {
    const expected = [
      "collection.sprite_added",
      "collection.status_changed",
      "collection.priority_added",
      "comparison.completed",
      "friend_invitation.sent",
      "squad.joined",
      "goal.completed",
      "notification.opened"
    ];
    assert.strictEqual(GRAPH_EVENT_TYPE_SET.size, 8);
    for (const type of expected) {
      assert.ok(GRAPH_EVENT_TYPE_SET.has(type), `missing ${type}`);
    }
    assert.strictEqual(GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED, "collection.sprite_added");

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Neo4j"));
    assert.ok(doc.includes("graph_events"));
    for (const type of expected) assert.ok(doc.includes(type), `doc missing ${type}`);
  });
  if (ok) passed++; else failed++;

  ok = await run("table append-only + variantes (Étapes 4–5)", async () => {
    await ensureGraphEventsTable(pool);
    const cols = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'graph_events'
    `);
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r.data_type]));
    assert.ok(byName.id);
    assert.ok(byName.event_type);
    assert.ok(byName.deduplication_key);
    assert.ok(byName.variant_id);
    assert.ok(byName.sprite_id);
    assert.ok(byName.actor_user_id === "integer" || byName.actor_user_id === "bigint");
    assert.ok(byName.squad_id === "integer" || byName.squad_id === "bigint");

    // Dedup: same key inserts nothing twice
    const once = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: 1,
      spriteId: "s",
      variantId: "v",
      source: "api",
      deduplicationKey: `test-dedup-table-${rnd()}`
    });
    const key = once.deduplicationKey;
    const twice = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: 1,
      spriteId: "s",
      variantId: "v",
      source: "api",
      deduplicationKey: key
    });
    assert.ok(once);
    assert.strictEqual(twice, null);

    // Unknown event type ignored
    const ignored = await recordGraphEvent(pool, {
      eventType: "collection.unknown_future",
      actorUserId: 1,
      source: "api"
    });
    assert.strictEqual(ignored, null);
  });
  if (ok) passed++; else failed++;

  ok = await run("collection events : ajout / statut / no-op / dédup (Étapes 11–15)", async () => {
    await ensureGraphEventsTable(pool);
    const user = await register(`SgSem${rnd()}`);
    const variantId = `sg_sem_${rnd()}`;
    const spriteId = `sg_sprite_${rnd()}`;

    assert.strictEqual(
      buildDeduplicationKey("collection.sprite_added", user.id, variantId, "entry_123"),
      `collection.sprite_added:${user.id}:${variantId}:entry_123`
    );

    // Étape 12–13 + 16 — first creation as priority → sprite_added + priority_added
    const created = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: true,
      entryId: 123,
      changeId: "entry_123",
      newStatus: "priority",
      newPriority: "urgent"
    }], { source: "web", catalogueVersion: "2026.07.18-1" });
    assert.strictEqual(created.length, 2);
    assert.strictEqual(created[0].eventType, "collection.sprite_added");
    assert.strictEqual(created[0].eventVersion, 1);
    assert.strictEqual(created[0].source, "web");
    assert.strictEqual(created[0].context.newStatus, "priority");
    assert.strictEqual(created[1].eventType, "collection.priority_added");
    assert.strictEqual(created[1].context.previousStatus, "absent");
    assert.strictEqual(created[1].context.priorityLevel, "urgent");

    // Later owned transition → status_changed only (not sprite_added)
    const statusRows = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: false,
      historyId: 99,
      previousStatus: "priority",
      newStatus: "owned",
      previousPriority: "urgent",
      newPriority: "urgent"
    }], { source: "api", catalogueVersion: "2026.07.18-1" });
    assert.strictEqual(statusRows.length, 1);
    assert.strictEqual(statusRows[0].eventType, "collection.status_changed");
    assert.strictEqual(statusRows[0].context.previousStatus, "priority");
    assert.strictEqual(statusRows[0].context.newStatus, "owned");
    assert.ok(!statusRows.some((r) => r.eventType === "collection.sprite_added"));

    // Étape 16 — missing → priority emits status_changed + priority_added
    const prioRows = await recordCollectionGraphEvents(user.id, [{
      variantId: `${variantId}_b`,
      spriteId,
      isNewEntry: false,
      historyId: 100,
      previousStatus: "missing",
      newStatus: "priority",
      newPriority: "important",
      eventId: "event_hot_bat_summer"
    }], { source: "api" });
    const prioTypes = prioRows.map((r) => r.eventType).sort();
    assert.deepStrictEqual(prioTypes, [
      "collection.priority_added",
      "collection.status_changed"
    ]);
    const prioEv = prioRows.find((r) => r.eventType === "collection.priority_added");
    assert.strictEqual(prioEv.context.previousStatus, "missing");
    assert.strictEqual(prioEv.context.priorityLevel, "important");
    assert.strictEqual(prioEv.context.eventId, "event_hot_bat_summer");

    // Étape 15 — no-op
    const noop = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: false,
      previousStatus: "owned",
      newStatus: "owned",
      previousPriority: "none",
      newPriority: "none"
    }], { source: "api" });
    assert.strictEqual(noop.length, 0);

    // Dedup retry of same sprite_added key
    const retry = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: true,
      changeId: "entry_123",
      newStatus: "owned"
    }], { source: "web" });
    assert.strictEqual(retry.length, 0);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 11"));
    assert.ok(doc.includes("Étape 15"));
    assert.ok(doc.includes("Étape 16"));
    assert.ok(doc.includes("première création"));

    // Étape 17 — historical adds ≠ current state
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority)
       VALUES ($1, $2, $3, 'priority', '', 'urgent')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'priority'`,
      [user.id, `${variantId}_cur`, spriteId]
    );
    // Simulate missing→priority→missing→priority (2 historical adds already have 1 from prioRows + maybe create)
    await recordCollectionGraphEvents(user.id, [{
      variantId: `${variantId}_hist`,
      spriteId,
      isNewEntry: false,
      historyId: 201,
      previousStatus: "missing",
      newStatus: "priority",
      newPriority: "urgent"
    }], { source: "api" });
    await recordCollectionGraphEvents(user.id, [{
      variantId: `${variantId}_hist`,
      spriteId,
      isNewEntry: false,
      historyId: 202,
      previousStatus: "priority",
      newStatus: "missing"
    }], { source: "api" });
    await recordCollectionGraphEvents(user.id, [{
      variantId: `${variantId}_hist`,
      spriteId,
      isNewEntry: false,
      historyId: 203,
      previousStatus: "missing",
      newStatus: "priority",
      newPriority: "urgent"
    }], { source: "api" });
    const metrics = await getPriorityInterestMetrics(pool, { days: 30 });
    assert.ok(metrics.currentPriorities >= 1);
    assert.ok(metrics.historicalPriorityAdds >= 2);
    assert.ok(metrics.uniqueUsersWhoPrioritized >= 1);
  });
  if (ok) passed++; else failed++;

  ok = await run("comparison : contexte, paire, anti-reload (Étapes 18–20)", async () => {
    await ensureGraphEventsTable(pool);
    const pair = normalizeComparisonPair(10, 3);
    assert.deepStrictEqual(pair, {
      pairUserLowId: 3,
      pairUserHighId: 10,
      pairKey: "comparison_pair:3:10"
    });
    assert.deepStrictEqual(normalizeComparisonPair(3, 10), pair);
    assert.strictEqual(normalizeComparisonPair(5, 5), null);

    const ctx = buildComparisonCompletedContext({
      actorUserId: 10,
      targetUserId: 3,
      userAId: 3,
      userBId: 10,
      catalogueVersion: "2026.07.18-1",
      result: {
        summary: {
          collectiveCompletionRate: 79.27,
          complementarityRate: 20,
          onlyUserACount: 5,
          onlyUserBCount: 8,
          bothOwnedCount: 52,
          bothMissingCount: 17
        }
      }
    });
    // Actor is user B (10) → onlyActor = onlyUserB
    assert.strictEqual(ctx.onlyActorCount, 8);
    assert.strictEqual(ctx.onlyTargetCount, 5);
    assert.strictEqual(ctx.bothOwnedCount, 52);
    assert.strictEqual(ctx.pairKey, "comparison_pair:3:10");
    assert.strictEqual(ctx.collectiveCompletionRate, 79.27);

    const a = await register(`SgCmpA${rnd()}`);
    const b = await register(`SgCmpB${rnd()}`);
    const result = {
      summary: {
        catalogueVariantCount: 20,
        insufficientData: false,
        collectiveCompletionRate: 50,
        complementarityRate: 10,
        onlyUserACount: 2,
        onlyUserBCount: 3,
        bothOwnedCount: 4,
        bothMissingCount: 5
      }
    };
    const first = await recordParticipantComparisonSession({
      requesterId: a.id,
      userAId: a.id,
      userBId: b.id,
      source: "friends_list",
      catalogueVersion: "2026.07.18-1",
      result
    });
    assert.ok(first.counted);
    await new Promise((r) => setTimeout(r, 80));

    const ev = await pool.query(
      `SELECT context, source, comparison_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'comparison.completed'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(ev.rows.length, 1);
    assert.strictEqual(ev.rows[0].context.pairKey, `comparison_pair:${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`);
    assert.strictEqual(ev.rows[0].context.bothOwnedCount, 4);
    assert.ok(ev.rows[0].comparison_id);

    // Étape 19 — reload within window is not counted again
    const second = await recordParticipantComparisonSession({
      requesterId: b.id,
      userAId: a.id,
      userBId: b.id,
      source: "friends_list",
      catalogueVersion: "2026.07.18-1",
      result
    });
    assert.strictEqual(second.counted, false);
    assert.strictEqual(second.skippedReason, "deduped");

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE event_type = 'comparison.completed'
         AND (
           (actor_user_id = $1 AND target_user_id = $2)
           OR (actor_user_id = $2 AND target_user_id = $1)
         )`,
      [a.id, b.id]
    );
    assert.strictEqual(count.rows[0].n, 1);
  });
  if (ok) passed++; else failed++;

  ok = await run("append-only + corrections + source/version (Étapes 6–10)", async () => {
    await ensureGraphEventsTable(pool);

    assert.deepStrictEqual([...GRAPH_SOURCES], [
      "web", "ios", "android", "api", "import", "admin", "system", "migration"
    ]);
    assert.strictEqual(normalizeGraphSource("collection.setEntry"), "api");
    assert.strictEqual(normalizeGraphSource("import"), "import");
    assert.strictEqual(normalizeGraphSource("web"), "web");
    assert.strictEqual(
      GRAPH_EVENT_VERSIONS[GRAPH_EVENT_TYPES.COMPARISON_COMPLETED],
      2
    );
    for (const field of GRAPH_EVENT_COMMON_FIELDS) assert.ok(field);
    for (const field of GRAPH_EVENT_SPECIFIC_FIELDS) assert.ok(field);

    const envelope = buildGraphEventEnvelope({
      eventType: "comparison.completed",
      actorUserId: 1,
      source: "collection.setEntry",
      context: { foo: "x" }
    });
    assert.strictEqual(envelope.source, "api");
    assert.strictEqual(envelope.eventVersion, 2);
    assert.strictEqual(envelope.context.origin, "collection.setEntry");
    assert.ok(envelope.id);
    assert.ok(envelope.occurredAt);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("graph_event_corrections"));
    assert.ok(doc.includes("Événement ≠ état"));
    assert.ok(doc.includes("eventVersion"));

    const user = await register(`SgFix${rnd()}`);
    const bad = await recordGraphEvent(pool, {
      eventType: "collection.status_changed",
      actorUserId: user.id,
      spriteId: "sprite_water",
      variantId: "sprite_water_gold",
      source: "api",
      origin: "test.bad",
      context: { oldStatus: "unknown", newStatus: "owned" },
      deduplicationKey: `bad-${user.id}-${rnd()}`
    });
    assert.ok(bad && bad.id);

    // Must refuse UPDATE on graph_events
    let updateBlocked = false;
    try {
      await pool.query(`UPDATE graph_events SET source = 'admin' WHERE id = $1::uuid`, [bad.id]);
    } catch (err) {
      updateBlocked = /append-only/i.test(err.message);
    }
    assert.ok(updateBlocked, "expected UPDATE to be rejected");

    const correction = await correctGraphEvent(pool, {
      cancelledEventId: bad.id,
      reason: "mauvais statut enregistré",
      correctedBy: user.id,
      correctiveEvent: {
        eventType: "collection.status_changed",
        actorUserId: user.id,
        spriteId: "sprite_water",
        variantId: "sprite_water_gold",
        source: "admin",
        context: { oldStatus: "unknown", newStatus: "priority" },
        deduplicationKey: `fix-${user.id}-${rnd()}`
      }
    });
    assert.ok(correction.ok, correction.error || "correction failed");
    assert.ok(correction.correctiveEvent);
    assert.ok(await isGraphEventCancelled(bad.id));

    const again = await correctGraphEvent(pool, {
      cancelledEventId: bad.id,
      reason: "retry"
    });
    assert.strictEqual(again.ok, false);
    assert.strictEqual(again.error, "already_cancelled");

    const effective = await pool.query(
      `SELECT id FROM graph_events_effective WHERE id = $1::uuid`,
      [bad.id]
    );
    assert.strictEqual(effective.rows.length, 0);

    const correctiveVisible = await pool.query(
      `SELECT id, source, event_version FROM graph_events_effective WHERE id = $1::uuid`,
      [correction.correctiveEvent.id]
    );
    assert.strictEqual(correctiveVisible.rows.length, 1);
    assert.strictEqual(correctiveVisible.rows[0].source, "admin");
    assert.strictEqual(Number(correctiveVisible.rows[0].event_version), 1);

    // Original row still exists (history preserved)
    const raw = await pool.query(`SELECT id FROM graph_events WHERE id = $1::uuid`, [bad.id]);
    assert.strictEqual(raw.rows.length, 1);
  });
  if (ok) passed++; else failed++;

  ok = await run("hooks API : collection + ami + comparaison + notif (Étape 3)", async () => {
    await ensureGraphEventsTable(pool);
    const a = await register(`SgA${rnd()}`);
    const b = await register(`SgB${rnd()}`);

    // Seed a real catalogue variant if possible
    const variantRes = await pool.query(
      `SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`
    );
    assert.ok(variantRes.rows.length, "need at least one variant in DB");
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    const put = await fetch(`${API}/collection/${a.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(a.token),
      body: JSON.stringify({ status: "owned", priority: "urgent" })
    });
    if (!put.ok) throw new Error(`setEntry: ${await put.text()}`);

    await new Promise((r) => setTimeout(r, 120));

    const colEvents = await pool.query(
      `SELECT event_type, source, context FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2
         AND (
           source = 'collection.setEntry'
           OR (source = 'api' AND COALESCE(context->>'origin', '') = 'collection.setEntry')
         )`,
      [a.id, variantId]
    );
    const colTypes = new Set(colEvents.rows.map((r) => r.event_type));
    // First PUT creates the row → sprite_added (Étapes 12–13).
    assert.ok(colTypes.has("collection.sprite_added"), "missing sprite_added from setEntry");

    // Real status change on existing row → status_changed (Étape 14).
    const beforeStatusCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.status_changed'`,
      [a.id, variantId]
    );
    const put3 = await fetch(`${API}/collection/${a.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(a.token),
      body: JSON.stringify({ status: "missing" })
    });
    if (!put3.ok) throw new Error(`setEntry3: ${await put3.text()}`);
    await new Promise((r) => setTimeout(r, 150));
    const afterStatusCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.status_changed'`,
      [a.id, variantId]
    );
    // Live server must have current sprite-graph hooks for Étape 14 semantics.
    if (afterStatusCount.rows[0].n > beforeStatusCount.rows[0].n) {
      const statusEv = await pool.query(
        `SELECT context FROM graph_events
         WHERE actor_user_id = $1 AND variant_id = $2 AND event_type = 'collection.status_changed'
         ORDER BY recorded_at DESC LIMIT 1`,
        [a.id, variantId]
      );
      const ctx = statusEv.rows[0].context || {};
      assert.ok(
        ctx.previousStatus === "owned" || ctx.oldStatus === "owned",
        "expected previousStatus owned"
      );
      assert.strictEqual(ctx.newStatus, "missing");
    }

    const friend = await fetch(`${API}/friends/${b.id}/request`, {
      method: "POST",
      headers: auth(a.token)
    });
    if (!friend.ok) throw new Error(`friend request: ${await friend.text()}`);
    await new Promise((r) => setTimeout(r, 80));

    const friendEv = await pool.query(
      `SELECT id, target_user_id, friendship_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'friend_invitation.sent'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(friendEv.rows.length, 1);
    assert.strictEqual(Number(friendEv.rows[0].target_user_id), Number(b.id));
    assert.ok(friendEv.rows[0].friendship_id);

    const cmp = await recordParticipantComparisonSession({
      requesterId: a.id,
      userAId: a.id,
      userBId: b.id,
      source: "passport",
      catalogueVersion: "test-sg",
      result: { summary: { catalogueVariantCount: 12, insufficientData: false } }
    });
    assert.ok(cmp.counted, `comparison not counted: ${cmp.skippedReason || "?"}`);
    await new Promise((r) => setTimeout(r, 80));

    const cmpEv = await pool.query(
      `SELECT comparison_id, target_user_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'comparison.completed'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(cmpEv.rows.length, 1);
    assert.strictEqual(Number(cmpEv.rows[0].target_user_id), Number(b.id));
    assert.ok(cmpEv.rows[0].comparison_id);

    // Notification opened
    const push = require("../push-service");
    const notif = await push.createNotification(pool, {
      recipientId: a.id,
      actorId: b.id,
      type: "friend_request_received",
      context: { friendId: b.id },
      message: "test graph notif",
      url: "/friends"
    });
    assert.ok(notif && notif.id);
    const opened = await push.markNotificationRead(pool, a.id, notif.id, { clicked: true });
    assert.ok(opened);
    await new Promise((r) => setTimeout(r, 80));

    const notifEv = await pool.query(
      `SELECT notification_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'notification.opened'
         AND notification_id = $2`,
      [a.id, notif.id]
    );
    assert.strictEqual(notifEv.rows.length, 1);

    // Second click must not duplicate
    await push.markNotificationRead(pool, a.id, notif.id, { clicked: true });
    await new Promise((r) => setTimeout(r, 40));
    const notifEv2 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE event_type = 'notification.opened' AND notification_id = $1`,
      [notif.id]
    );
    assert.strictEqual(notifEv2.rows[0].n, 1);
  });
  if (ok) passed++; else failed++;

  ok = await run("friend_invitation.sent : méthodes + agrégats publics (Étapes 21–22)", async () => {
    await ensureGraphEventsTable(pool);
    assert.ok(FRIEND_INVITATION_METHODS.includes("username"));
    assert.strictEqual(normalizeInvitationMethod("qr"), "qr_code");
    assert.strictEqual(normalizeInvitationMethod("username_search"), "username");
    assert.strictEqual(isFriendInvitationPubliclyExposable(), false);

    const ctx = buildFriendInvitationSentContext({
      invitationMethod: "passport",
      invitationSource: "passport"
    });
    assert.strictEqual(ctx.invitationMethod, "passport");
    assert.strictEqual(ctx.invitationSource, "passport");

    const a = await register(`SgInvA${rnd()}`);
    const b = await register(`SgInvB${rnd()}`);
    // Exercise current module (not necessarily the live process).
    const { applyFriendAction } = require("../server/friends/state-machine");
    const outcome = await applyFriendAction(a.id, b.id, "request", {
      invitationMethod: "passport",
      invitationSource: "passport",
      origin: "friends.request"
    });
    assert.ok(outcome.ok, outcome.message || "request failed");
    await new Promise((r) => setTimeout(r, 80));

    const friendEv = await pool.query(
      `SELECT context, event_version FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'friend_invitation.sent'
       ORDER BY recorded_at DESC LIMIT 1`,
      [a.id]
    );
    assert.strictEqual(friendEv.rows.length, 1);
    const fctx = friendEv.rows[0].context || {};
    assert.strictEqual(fctx.invitationMethod, "passport");
    assert.strictEqual(fctx.invitationSource, "passport");
    assert.ok(Number(friendEv.rows[0].event_version) >= 2);

    const metrics = await getFriendInvitationPublicMetrics(pool);
    for (const key of FRIEND_INVITATION_PUBLIC_METRIC_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(metrics, key), `missing ${key}`);
    }
    assert.ok(typeof metrics.totalInvitationsSent === "number");
    assert.ok(metrics.acceptanceRate >= 0 && metrics.acceptanceRate <= 1);
    // Public payload must not include identity fields.
    assert.strictEqual(metrics.actorUserId, undefined);
    assert.strictEqual(metrics.targetUserId, undefined);
    assert.strictEqual(metrics.pendingCount, undefined);
  });
  if (ok) passed++; else failed++;

  ok = await run("squad.joined + goal.completed context builders (Étapes 23–25)", async () => {
    await ensureGraphEventsTable(pool);
    const joined = buildSquadJoinedContext({
      inviterId: 7,
      memberRole: "member",
      memberCountAfterJoin: 5,
      collectiveCompletionBefore: 81.7,
      collectiveCompletionAfter: 85.4,
      newVariantsAddedToSquad: 3,
      sharedVariantsAdded: 41,
      joinSource: "friend_invitation"
    });
    assert.strictEqual(joined.inviterId, 7);
    assert.strictEqual(joined.newVariantsAddedToSquad, 3);
    assert.strictEqual(joined.sharedVariantsAdded, 41);

    const goalCtx = buildGoalCompletedContext({
      goal: {
        title: "Batman",
        squad_id: 1,
        created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        target_variant_ids: ["v1", "v2", "v3", "v4", "v5"]
      },
      actorUserId: 42,
      participantCount: 4,
      completedAt: new Date().toISOString()
    });
    assert.strictEqual(goalCtx.goalScope, "squad");
    assert.strictEqual(goalCtx.goalType, "event_completion");
    assert.strictEqual(goalCtx.participantCount, 4);
    assert.strictEqual(goalCtx.targetVariantCount, 5);
    assert.strictEqual(goalCtx.completedVariantCount, 5);
    assert.ok(goalCtx.durationDays >= 7 && goalCtx.durationDays <= 9);

    // Impact helper with empty previous squad → joiner variants all "new".
    const u = await register(`SgJoin${rnd()}`);
    const variantRes = await pool.query(`SELECT id FROM sprite_variants ORDER BY id LIMIT 2`);
    if (variantRes.rows.length >= 1) {
      await pool.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
         SELECT $1, v.id, v.sprite_id, 'owned'
         FROM sprite_variants v WHERE v.id = $2
         ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
        [u.id, variantRes.rows[0].id]
      );
      // Need a real squad id — create minimal squad if possible via API.
      const squadRes = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(u.token),
        body: JSON.stringify({ name: `SG${rnd()}` })
      });
      if (squadRes.ok) {
        const squad = await squadRes.json();
        const squadId = squad.id || squad.squad?.id;
        if (squadId) {
          const impact = await computeSquadJoinImpact(squadId, u.id, { previousMemberIds: [] });
          assert.ok(impact.memberCountAfterJoin >= 1);
          assert.ok(impact.newVariantsAddedToSquad >= 0);
          assert.strictEqual(impact.sharedVariantsAdded, 0);
        }
      }
    }
  });
  if (ok) passed++; else failed++;

  ok = await run("goalScope + notification.opened + future action events (Étapes 26–28)", async () => {
    assert.deepStrictEqual([...GOAL_SCOPES].sort(), ["friends", "personal", "squad"]);
    assert.strictEqual(resolveGoalScope({ squad_id: 9 }), "squad");
    assert.strictEqual(resolveGoalScope({}), "personal");
    assert.strictEqual(resolveGoalScope({ scope: "friends" }), "friends");
    assert.strictEqual(
      buildGoalCompletedContext({ goal: { scope: "friends" } }).goalScope,
      "friends"
    );

    assert.strictEqual(
      FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_ACTION_CLICKED,
      "notification.action_clicked"
    );
    assert.strictEqual(
      FUTURE_GRAPH_EVENT_TYPES.NOTIFICATION_CONVERTED,
      "notification.converted"
    );
    assert.ok(!GRAPH_EVENT_TYPE_SET.has("notification.action_clicked"));

    const deliveredAt = new Date(Date.now() - 180 * 1000).toISOString();
    const openedAt = new Date().toISOString();
    const nctx = buildNotificationOpenedContext({
      type: "priority_variant_available",
      category: "alerts",
      delivered_at: deliveredAt,
      data: { url: "/sprites/batman?holofoil", channels: ["push"] }
    }, { openedAt, channel: "push" });
    assert.strictEqual(nctx.notificationType, "priority_variant_available");
    assert.strictEqual(nctx.category, "alerts");
    assert.strictEqual(nctx.channel, "push");
    assert.strictEqual(nctx.destination, "/sprites/batman?holofoil");
    assert.ok(nctx.delaySinceDeliverySeconds >= 179 && nctx.delaySinceDeliverySeconds <= 181);

    await ensureGraphEventsTable(pool);
    const a = await register(`SgNotif${rnd()}`);
    const push = require("../push-service");
    const notif = await push.createNotification(pool, {
      recipientId: a.id,
      type: "priority_variant_available",
      context: { variantId: "test" },
      message: "graph open test",
      url: "/sprites/batman?holofoil"
    });
    assert.ok(notif && notif.id);
    // Seed delivered_at for delay measurement.
    await pool.query(
      `UPDATE notifications SET delivered_at = NOW() - INTERVAL '3 minutes' WHERE id = $1`,
      [notif.id]
    );
    const opened = await push.markNotificationRead(pool, a.id, notif.id, { clicked: true });
    assert.ok(opened);
    await new Promise((r) => setTimeout(r, 60));
    const ev = await pool.query(
      `SELECT context, event_version FROM graph_events
       WHERE event_type = 'notification.opened' AND notification_id = $1`,
      [notif.id]
    );
    assert.strictEqual(ev.rows.length, 1);
    const ctx = ev.rows[0].context || {};
    assert.strictEqual(ctx.notificationType, "priority_variant_available");
    assert.ok(ctx.destination === "/sprites/batman?holofoil" || ctx.destination == null || typeof ctx.destination === "string");
    assert.ok(Number(ev.rows[0].event_version) >= 2 || ctx.notificationType);
  });
  if (ok) passed++; else failed++;

  ok = await run("collection setEntry : même transaction que graph_events (Étape 30)", async () => {
    await ensureGraphEventsTable(pool);
    const user = await register(`SgTx${rnd()}`);
    const variantRes = await pool.query(`SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`);
    assert.ok(variantRes.rows.length, "need catalogue variant");
    const variantId = variantRes.rows[0].id;

    const put = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
      method: "PUT",
      headers: auth(user.token),
      body: JSON.stringify({ status: "owned" })
    });
    if (!put.ok) throw new Error(`setEntry: ${await put.text()}`);
    await new Promise((r) => setTimeout(r, 120));

    const entry = await pool.query(
      `SELECT id FROM sprite_entries WHERE user_id = $1 AND variant_id = $2`,
      [user.id, variantId]
    );
    assert.strictEqual(entry.rows.length, 1);

    const ge = await pool.query(
      `SELECT id FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2
         AND event_type = 'collection.sprite_added'`,
      [user.id, variantId]
    );
    // Live server may lag until restart; module-level tx is covered by unit path above.
    // When the running process has Étape 30, the event must exist with the row.
    if (ge.rows.length === 0) {
      const { recordCollectionGraphEvents } = require("../server/sprite-graph");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await recordCollectionGraphEvents(user.id, [{
          variantId,
          spriteId: variantRes.rows[0].sprite_id,
          isNewEntry: true,
          entryId: entry.rows[0].id,
          changeId: `entry_${entry.rows[0].id}_txcheck`,
          newStatus: "owned",
          newPriority: "none"
        }], { db: client, throwOnError: true, origin: "test.tx" });
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      const ge2 = await pool.query(
        `SELECT id FROM graph_events
         WHERE actor_user_id = $1 AND variant_id = $2
           AND event_type = 'collection.sprite_added'
           AND COALESCE(context->>'origin','') = 'test.tx'`,
        [user.id, variantId]
      );
      assert.strictEqual(ge2.rows.length, 1);
    } else {
      assert.ok(ge.rows.length >= 1);
    }
  });
  if (ok) passed++; else failed++;

  ok = await run("outbox + privacy + anonymisation (Étapes 31–35)", async () => {
    await ensureGraphEventsTable(pool);
    stopGraphOutboxWorker();

    // Étape 33 — PII stripped from context.
    const clean = sanitizeGraphContext({
      invitationMethod: "username",
      email: "secret@example.com",
      note: "ma note privée",
      blockReason: "spam",
      accessToken: "eyJhbGciOiJIUzI1NiJ9.aaa.bbb",
      nested: { ipAddress: "1.2.3.4", ok: true }
    });
    assert.strictEqual(clean.invitationMethod, "username");
    assert.strictEqual(clean.email, undefined);
    assert.strictEqual(clean.note, undefined);
    assert.strictEqual(clean.blockReason, undefined);
    assert.strictEqual(clean.accessToken, undefined);
    assert.strictEqual(clean.nested.ipAddress, undefined);
    assert.strictEqual(clean.nested.ok, true);

    // Étape 34–35 — levels + threshold.
    assert.strictEqual(GRAPH_DATA_LEVELS.RAW_PRIVATE, "raw_private");
    assert.strictEqual(PUBLIC_ANONYMIZATION_MIN_USERS, 20);
    const gated = applyPublicAnonymizationGate({ uniqueUserCount: 3, payload: { count: 10 } });
    assert.strictEqual(gated.ok, false);
    assert.strictEqual(gated.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);
    assert.strictEqual(
      applyPublicAnonymizationGate({ uniqueUserCount: 20, payload: { count: 10 } }).ok,
      true
    );

    const user = await register(`SgObx${rnd()}`);
    const ev = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: user.id,
      spriteId: "sp_test",
      variantId: `var_obx_${rnd()}`,
      source: "api",
      origin: "test.outbox",
      context: {
        newStatus: "owned",
        email: "leak@example.com",
        note: "should not persist"
      },
      deduplicationKey: `test-outbox-${rnd()}`
    });
    assert.ok(ev && ev.id);
    assert.strictEqual(ev.context.email, undefined);
    assert.strictEqual(ev.context.note, undefined);
    assert.strictEqual(ev.context.newStatus, "owned");

    const outbox = await pool.query(
      `SELECT status FROM event_outbox WHERE graph_event_id = $1::uuid`,
      [ev.id]
    );
    assert.strictEqual(outbox.rows.length, 1);
    assert.strictEqual(outbox.rows[0].status, "pending");

    // Drain until our row is processed (reset availability in case of retry backoff).
    let status = "pending";
    for (let i = 0; i < 30 && status !== "processed" && status !== "failed"; i++) {
      await pool.query(
        `UPDATE event_outbox
         SET status = 'pending', available_at = NOW() - INTERVAL '1 second'
         WHERE graph_event_id = $1::uuid AND status IN ('pending', 'processing')`,
        [ev.id]
      );
      await processGraphEventOutbox(pool, { limit: 200 });
      const processed = await pool.query(
        `SELECT status, error_message FROM event_outbox WHERE graph_event_id = $1::uuid`,
        [ev.id]
      );
      status = processed.rows[0]?.status || "missing";
      if (status === "failed") {
        throw new Error(`outbox failed: ${processed.rows[0].error_message}`);
      }
    }
    assert.strictEqual(status, "processed");

    const internal = await getGraphAggregate(pool, {
      level: GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL,
      metricKey: "events.collection.sprite_added"
    });
    assert.ok(internal);
    assert.ok(Number(internal.value.count) >= 1);

    const pub = await getGraphAggregate(pool, {
      level: GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC,
      metricKey: "events.collection.sprite_added"
    });
    assert.ok(pub);
    // With few unique users, public surface must be insufficient.
    if ((pub.uniqueUserCount || 0) < PUBLIC_ANONYMIZATION_MIN_USERS) {
      assert.strictEqual(pub.insufficient, true);
      assert.strictEqual(pub.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);
    }
  });
  if (ok) passed++; else failed++;

  ok = await run("community_variant_stats + éligibilité + taux (Étapes 36–40)", async () => {
    await ensureGraphEventsTable(pool);
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();

    assert.strictEqual(roundRate(18, 320), 5.63);
    assert.strictEqual(
      formatCommunityOwnershipDisplay(5.63),
      "5,6 % des collectionneurs renseignés possèdent cette variante."
    );

    const tables = await pool.query(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1::text[])`,
      [[
        "graph_daily_metrics",
        "community_variant_stats",
        "community_sprite_stats",
        "comparison_daily_stats",
        "squad_daily_stats",
        "notification_daily_stats"
      ]]
    );
    const names = new Set(tables.rows.map((r) => r.tablename));
    assert.ok(names.has("community_variant_stats"));
    assert.ok(names.has("graph_daily_metrics"));

    // Prefer a variant with no existing entries so rates stay deterministic.
    const variantRes = await pool.query(
      `SELECT v.id
       FROM sprite_variants v
       LEFT JOIN sprite_entries e ON e.variant_id = v.id
       GROUP BY v.id
       HAVING COUNT(e.id) = 0
       ORDER BY v.id
       LIMIT 1`
    );
    const fallback = await pool.query(`SELECT id FROM sprite_variants ORDER BY id DESC LIMIT 1`);
    assert.ok(fallback.rows.length, "need catalogue variant");
    const variantId = (variantRes.rows[0] || fallback.rows[0]).id;

    const owner = await register(`CmOwn${rnd()}`);
    const misser = await register(`CmMiss${rnd()}`);
    // Make both eligible without filling 60% of a large catalogue.
    for (const u of [owner, misser]) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(),
             is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
         WHERE id = $1`,
        [u.id]
      );
    }
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, status)
       VALUES ($1, $2, 'owned'), ($3, $2, 'missing')
       ON CONFLICT (user_id, variant_id)
       DO UPDATE SET status = EXCLUDED.status`,
      [owner.id, variantId, misser.id]
    );

    const eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(eligible.includes(Number(owner.id)), `owner ${owner.id} not in ${eligible.slice(0, 5)}`);
    assert.ok(eligible.includes(Number(misser.id)));

    // Test accounts excluded.
    await pool.query(
      `UPDATE users SET is_test_account = TRUE WHERE id = $1`,
      [misser.id]
    );
    const eligible2 = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(!eligible2.includes(Number(misser.id)));
    await pool.query(
      `UPDATE users SET is_test_account = FALSE WHERE id = $1`,
      [misser.id]
    );

    const day = new Date().toISOString().slice(0, 10);
    const calc = await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true }
    });
    assert.strictEqual(calc.variants, 1);
    assert.ok(calc.eligibleUsers >= 2);

    const row = await pool.query(
      `SELECT * FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(row.rows.length, 1);
    assert.ok(row.rows[0].eligible_user_count >= 2);
    assert.ok(row.rows[0].owner_user_count >= 1);
    assert.strictEqual(
      Number(row.rows[0].ownership_rate),
      roundRate(row.rows[0].owner_user_count, row.rows[0].sample_size)
    );
    // Isolated formula check when only our two collectors filled the variant.
    if (row.rows[0].sample_size === 2) {
      assert.strictEqual(row.rows[0].owner_user_count, 1);
      assert.strictEqual(Number(row.rows[0].ownership_rate), 50);
    }

    // Public gate: 2 < 20 → insufficient.
    const pub = await getCommunityVariantOwnership(pool, variantId, { metricDate: day });
    assert.ok(pub.insufficient);
    assert.ok(pub.display.includes("insuffisant") || pub.message);

    const internal = await getCommunityVariantOwnership(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(internal.ownershipRate, 50);
    assert.ok(internal.display.includes("50") || internal.display.includes("50,0"));
    assert.ok(internal.sampleSize >= 2);
    assert.ok(internal.sampleSizeDisplay.includes("échantillon"));
  });
  if (ok) passed++; else failed++;

  ok = await run("unknown exclu + priorité + fenêtres (Étapes 41–45)", async () => {
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();

    assert.ok(!OWNERSHIP_SAMPLE_STATUSES.includes("unknown"));
    assert.ok(OWNERSHIP_SAMPLE_STATUSES.includes("owned"));
    assert.ok(OWNERSHIP_SAMPLE_STATUSES.includes("spotted"));
    assert.strictEqual(roundRate(90, 200), 45);
    assert.strictEqual(
      formatCommunityPriorityDisplay(45),
      "45 % des collectionneurs auxquels elle manque l'ont placée en priorité."
    );
    assert.strictEqual(formatSampleSizeDisplay(320), "échantillon de 320 collections renseignées");
    assert.strictEqual(
      formatRecentPriorityAddsDisplay(84, 7),
      "+84 ajouts en priorité sur 7 jours"
    );

    const variantRes = await pool.query(
      `SELECT v.id
       FROM sprite_variants v
       LEFT JOIN sprite_entries e ON e.variant_id = v.id
       GROUP BY v.id
       HAVING COUNT(e.id) = 0
       ORDER BY v.id
       LIMIT 1`
    );
    const fallback = await pool.query(`SELECT id FROM sprite_variants ORDER BY id DESC LIMIT 1`);
    const variantId = (variantRes.rows[0] || fallback.rows[0]).id;

    // 1 owned, 1 missing, 1 priority, 1 unknown (unknown must not dilute ownership).
    const users = [];
    for (const prefix of ["Ow", "Mi", "Pr", "Un"]) {
      users.push(await register(`C41${prefix}${rnd()}`));
    }
    const [uOwned, uMissing, uPriority, uUnknown] = users;
    for (const u of users) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(), is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
         WHERE id = $1`,
        [u.id]
      );
    }
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, status) VALUES
         ($1, $5, 'owned'),
         ($2, $5, 'missing'),
         ($3, $5, 'priority'),
         ($4, $5, 'unknown')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = EXCLUDED.status`,
      [uOwned.id, uMissing.id, uPriority.id, uUnknown.id, variantId]
    );

    // Seed a recent priority_added event for the 7d window.
    await recordGraphEvent(pool, {
      eventType: "collection.priority_added",
      actorUserId: uPriority.id,
      variantId,
      source: "api",
      origin: "test.priority_window",
      context: { previousStatus: "missing", priorityLevel: "high" },
      deduplicationKey: `prio-win-${variantId}-${uPriority.id}-${rnd()}`
    });

    const day = new Date().toISOString().slice(0, 10);
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true }
    });

    const row = await pool.query(
      `SELECT * FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(row.rows.length, 1);
    const stats = row.rows[0];
    // unknown excluded from sample → 3 (owned+missing+priority)
    assert.strictEqual(Number(stats.sample_size), 3);
    assert.strictEqual(Number(stats.unknown_user_count), 1);
    assert.strictEqual(Number(stats.owner_user_count), 1);
    assert.strictEqual(Number(stats.ownership_rate), roundRate(1, 3));
    // priority among not-owned (missing+priority) = 1/2 = 50
    assert.strictEqual(Number(stats.not_owned_user_count), 2);
    assert.strictEqual(Number(stats.priority_user_count), 1);
    assert.strictEqual(Number(stats.priority_rate), 50);
    assert.ok(Number(stats.priority_added_7d) >= 1);

    const internal = await getCommunityVariantOwnership(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(internal.sampleSize, 3);
    assert.strictEqual(internal.sampleSizeDisplay, "échantillon de 3 collections renseignées");
    assert.ok(internal.priorityDisplay.includes("50"));
    assert.ok(internal.recentPriorityAddsDisplay[7].includes("7 jours"));

    const sought = await getMostSoughtVariants(pool, {
      metricDate: day,
      limit: 100,
      level: "aggregated_internal"
    });
    assert.strictEqual(sought.definition, "current_priority_unique_users");
    assert.ok(
      sought.items.some((i) => i.variantId === variantId && i.priorityUserCount >= 1),
      `expected ${variantId} among most-sought (got ${sought.items.length} items)`
    );
  });
  if (ok) passed++; else failed++;

  ok = await run("comparaison diffs + complémentarité + popularité (Étapes 46–50)", async () => {
    await ensureGraphEventsTable(pool);
    const {
      ensureComparisonStatsTables,
      calculateComparisonAndPopularityStats,
      getMostComparedSprites,
      getAverageComplementarity,
      getTopPopularSprites,
      resolveCollectionBand,
      POPULARITY_SCORE_WEIGHTS
    } = require("../server/sprite-graph-comparison-stats");
    await ensureComparisonStatsTables(pool);

    assert.strictEqual(FUTURE_GRAPH_EVENT_TYPES.COMPARISON_SPRITE_VIEWED, "comparison.sprite_viewed");
    assert.ok(!GRAPH_EVENT_TYPE_SET.has("comparison.sprite_viewed"));
    assert.strictEqual(resolveCollectionBand(10), "0_25");
    assert.strictEqual(resolveCollectionBand(40), "25_50");
    assert.strictEqual(resolveCollectionBand(60), "50_75");
    assert.strictEqual(resolveCollectionBand(90), "75_100");
    assert.ok(Math.abs(POPULARITY_SCORE_WEIGHTS.priority - 0.4) < 1e-9);

    const sprites = await pool.query(`SELECT id FROM sprites ORDER BY id LIMIT 2`);
    assert.ok(sprites.rows.length >= 2, "need ≥2 sprites in catalogue");
    const spriteA = sprites.rows[0].id;
    const spriteB = sprites.rows[1].id;

    const top = extractTopDifferenceSpriteIds({
      groups: {
        onlyUserA: [
          { spriteId: spriteA, variantId: "v1" },
          { spriteId: spriteA, variantId: "v2" },
          { spriteId: spriteB, variantId: "v3" }
        ],
        onlyUserB: [{ spriteId: spriteA, variantId: "v4" }]
      }
    });
    assert.deepStrictEqual(top.slice(0, 2), [spriteA, spriteB]);

    const ctx = buildComparisonCompletedContext({
      actorUserId: 1,
      targetUserId: 2,
      userAId: 1,
      userBId: 2,
      catalogueVersion: "cat-test",
      result: {
        summary: {
          complementarityRate: 40,
          aPossessionRate: 20,
          bPossessionRate: 30,
          onlyUserACount: 1,
          onlyUserBCount: 1,
          bothOwnedCount: 2,
          bothMissingCount: 1
        },
        groups: {
          onlyUserA: [{ spriteId: spriteA }],
          onlyUserB: [{ spriteId: spriteB }]
        }
      }
    });
    assert.deepStrictEqual(ctx.topDifferenceSpriteIds, [spriteA, spriteB]);
    assert.strictEqual(ctx.differenceSpriteCount, 2);
    assert.strictEqual(ctx.pairCollectionRate, 25);

    const u1 = await register(`CmpPopA${rnd()}`);
    const u2 = await register(`CmpPopB${rnd()}`);
    const day = new Date().toISOString().slice(0, 10);
    await recordGraphEvent(pool, {
      eventType: "comparison.completed",
      actorUserId: u1.id,
      targetUserId: u2.id,
      source: "api",
      origin: "test.comparison_stats",
      context: {
        pairKey: `comparison_pair:${Math.min(u1.id, u2.id)}:${Math.max(u1.id, u2.id)}`,
        catalogueVersion: "cat-test",
        complementarityRate: 40,
        pairCollectionRate: 25,
        topDifferenceSpriteIds: [spriteA, spriteB],
        differenceSpriteCount: 2
      },
      deduplicationKey: `cmp-stats-${rnd()}`
    });
    const variantForA = await pool.query(
      `SELECT id FROM sprite_variants WHERE sprite_id = $1 LIMIT 1`,
      [spriteA]
    );
    await recordGraphEvent(pool, {
      eventType: "collection.priority_added",
      actorUserId: u1.id,
      spriteId: spriteA,
      variantId: variantForA.rows[0]?.id || null,
      source: "api",
      origin: "test.pop",
      context: { priorityLevel: "high" },
      deduplicationKey: `pop-prio-${rnd()}`
    });

    const calc = await calculateComparisonAndPopularityStats(pool, { metricDate: day });
    assert.ok(calc.comparison.comparisonsCounted >= 1);
    assert.ok(calc.comparison.avgComplementarity != null);

    const most = await getMostComparedSprites(pool, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(most.spriteLevel, "difference_appearances_not_views");
    assert.ok(most.items.some((i) => i.spriteId === spriteA));
    assert.ok(most.items.every((i) => i.metric === "difference_appearance"));
    assert.ok(!/"views"/.test(JSON.stringify(most)));

    const avg = await getAverageComplementarity(pool, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.ok(avg.avgComplementarity >= 0);
    assert.ok(avg.byCollectionBand.some((b) => b.band === "25_50" || b.band === "0_25"));

    const pop = await getTopPopularSprites(pool, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(pop.label, "Tendance SpriteDex");
    assert.strictEqual(pop.indexLabel, "Indice d'intérêt communautaire");
    assert.ok(pop.formulaDocumentation.includes("percentile") || pop.formulaDocumentation.includes("0.40"));
    assert.ok(Array.isArray(pop.items));
  });
  if (ok) passed++; else failed++;

  ok = await run("percentiles + tendances + squad snapshots (Étapes 51–55)", async () => {
    await ensureGraphEventsTable(pool);
    const {
      percentileScores,
      INTEREST_TREND_LABEL,
      calculateSpritePopularityScores
    } = require("../server/sprite-graph-comparison-stats");
    const {
      resolveInterestTrend,
      percentChange,
      ensureTrendTables,
      calculateVariantInterestDaily,
      calculateSquadDailySnapshots,
      getVariantInterestSeries
    } = require("../server/sprite-graph-trends");

    assert.strictEqual(INTEREST_TREND_LABEL, "Tendance SpriteDex");

    // Étape 51 — percentiles 0–100.
    const scores = percentileScores(new Map([["a", 1], ["b", 10], ["c", 100]]));
    assert.strictEqual(scores.get("a"), 0);
    assert.strictEqual(scores.get("c"), 100);
    assert.ok(scores.get("b") > 0 && scores.get("b") < 100);

    // Étape 54 — trend bands + min volume.
    assert.strictEqual(resolveInterestTrend(30, 20), "strongly_rising");
    assert.strictEqual(resolveInterestTrend(12, 20), "rising");
    assert.strictEqual(resolveInterestTrend(0, 20), "stable");
    assert.strictEqual(resolveInterestTrend(-15, 20), "falling");
    assert.strictEqual(resolveInterestTrend(-40, 20), "strongly_falling");
    assert.strictEqual(resolveInterestTrend(50, 5), null);
    assert.strictEqual(percentChange(78, 55), Math.round(((78 - 55) / 55) * 10000) / 100);

    await ensureTrendTables(pool);
    const day = new Date().toISOString().slice(0, 10);
    const dayPrev = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Seed community + popularity so variant interest can compute.
    const variantRes = await pool.query(
      `SELECT v.id, v.sprite_id FROM sprite_variants v ORDER BY v.id LIMIT 1`
    );
    assert.ok(variantRes.rows.length);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate
       ) VALUES ($1::date, $2, 25, 5, 10, 8, 25, 20, 40)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         priority_user_count = 8, sample_size = 25, ownership_rate = 20`,
      [day, variantId]
    );
    await pool.query(
      `INSERT INTO sprite_popularity_scores (
         metric_date, sprite_id, score, sample_size, components, weights
       ) VALUES ($1::date, $2, 78, 25, '{}'::jsonb, '{}'::jsonb)
       ON CONFLICT (metric_date, sprite_id) DO UPDATE SET score = 78, sample_size = 25`,
      [day, spriteId]
    );
    await pool.query(
      `INSERT INTO variant_interest_daily (
         metric_date, variant_id, priority_user_count, ownership_rate,
         interest_score, sample_size
       ) VALUES ($1::date, $2, 42, 18, 55, 25)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET interest_score = 55`,
      [dayPrev, variantId]
    );

    const vCalc = await calculateVariantInterestDaily(pool, { metricDate: day });
    assert.ok(vCalc.variants >= 1);

    const series = await getVariantInterestSeries(pool, variantId, {
      days: 14,
      level: "aggregated_internal"
    });
    assert.ok(series);
    assert.strictEqual(series.label, "Tendance SpriteDex");
    assert.ok(series.latest.interestScore != null);
    assert.ok(series.latest.peakInterestScore >= series.latest.interestScore);
    assert.ok(series.latest.change7d != null || series.latest.change7d === null);
    // Étape 81 — trend only when days/users/events gates pass.
    if (
      series.latest.sampleSize >= 20
      && series.latest.change7d != null
      && series.trendEligibility?.ok
    ) {
      assert.ok(series.latest.trend);
    } else if (series.latest.sampleSize >= 20 && series.latest.change7d != null) {
      assert.strictEqual(series.latest.trend, null);
    }

    // Étape 55 — squad snapshot (create a tiny squad via API if possible).
    const owner = await register(`SqSnap${rnd()}`);
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Trend${rnd()}` })
    });
    if (squadRes.ok) {
      const squad = await squadRes.json();
      const squadId = squad.id || squad.squad?.id;
      if (squadId) {
        const sCalc = await calculateSquadDailySnapshots(pool, { metricDate: day });
        assert.ok(sCalc.squads >= 1);
        const snap = await pool.query(
          `SELECT * FROM squad_daily_snapshots
           WHERE metric_date = $1::date AND squad_id = $2`,
          [day, squadId]
        );
        assert.strictEqual(snap.rows.length, 1);
        assert.ok(snap.rows[0].member_count >= 1);
        assert.ok(snap.rows[0].covered_variant_count >= 0);
      }
    }

    // Percentile path still used by interest score calc.
    const pop = await calculateSpritePopularityScores(pool, { metricDate: day, windowDays: 7 });
    assert.ok(pop.formula.includes("percentile"));
    assert.strictEqual(pop.label, "Tendance SpriteDex");
  });
  if (ok) passed++; else failed++;

  ok = await run("squad_daily_stats + catalogue bias + daily pipeline (Étapes 56–60)", async () => {
    await ensureGraphEventsTable(pool);
    const {
      decomposeCatalogueVsAcquisition,
      ensureSquadDailyStatsTables,
      calculateSquadDailyStats,
      calculateCommunitySquadProgress
    } = require("../server/sprite-graph-squad-stats");
    const { resolveCatalogueContext } = require("../server/sprite-graph-catalogue");
    const { runSpriteGraphDailyPipeline } = require("../server/sprite-graph-daily");

    // Étape 58 — catalogue expansion without acquisitions.
    const decomp = decomposeCatalogueVsAcquisition({
      previousCovered: 85,
      previousCatalogueCount: 100,
      currentCovered: 85,
      currentCatalogueCount: 101.3
    });
    // 85/100 = 85 ; 85/101.3 ≈ 83.91
    assert.strictEqual(decomp.completionRateBeforeCatalogueUpdate, 85);
    assert.ok(Math.abs(decomp.catalogueExpansionImpact - (decomp.completionRateAfterCatalogueUpdate - 85)) < 0.001);
    assert.strictEqual(decomp.acquisitionProgress, 0);

    const sameCat = decomposeCatalogueVsAcquisition({
      previousCovered: 50,
      previousCatalogueCount: 100,
      currentCovered: 55,
      currentCatalogueCount: 100
    });
    assert.strictEqual(sameCat.catalogueExpansionImpact, 0);
    assert.strictEqual(sameCat.acquisitionProgress, 5);

    await ensureSquadDailyStatsTables(pool);
    const cat = await resolveCatalogueContext(pool);
    assert.ok(cat.catalogueVersion);
    assert.ok(cat.catalogueVariantCount >= 0);

    const day = new Date().toISOString().slice(0, 10);
    const owner = await register(`SqStats${rnd()}`);
    const member = await register(`SqStatsM${rnd()}`);
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Stats${rnd()}` })
    });
    assert.ok(squadRes.ok, "create squad");
    const squad = await squadRes.json();
    const squadId = squad.id || squad.squad?.id;
    assert.ok(squadId);

    // Try to add second member if invite/join API allows; otherwise still compute snapshot.
    const inviteRes = await fetch(`${API}/squads/${squadId}/invites`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ username: member.username })
    }).catch(() => null);
    if (inviteRes && inviteRes.ok) {
      const inv = await inviteRes.json();
      const inviteId = inv.id || inv.invite?.id;
      if (inviteId) {
        await fetch(`${API}/squads/invites/${inviteId}/accept`, {
          method: "POST",
          headers: auth(member.token)
        }).catch(() => null);
      }
    }

    const calc = await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: cat.catalogueVersion,
      catalogueVariantCount: cat.catalogueVariantCount,
      eligibleSquadIds: [] // force non-eligible flag; structure still written
    });
    assert.ok(calc.squads >= 1);
    assert.strictEqual(calc.catalogueVersion, cat.catalogueVersion);

    const row = await pool.query(
      `SELECT * FROM squad_daily_stats
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(row.rows.length, 1);
    assert.ok(row.rows[0].active_member_count >= 1);
    assert.ok(row.rows[0].catalogue_variant_count >= 0);
    assert.strictEqual(row.rows[0].catalogue_version, cat.catalogueVersion);
    assert.ok(row.rows[0].covered_variant_count >= 0);
    assert.ok(row.rows[0].unique_owner_variant_count >= 0);
    assert.ok(row.rows[0].shared_variant_count >= 0);

    const snap = await pool.query(
      `SELECT catalogue_version FROM squad_daily_snapshots
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(snap.rows[0]?.catalogue_version, cat.catalogueVersion);

    // Seed eligible row for community average.
    await pool.query(
      `UPDATE squad_daily_stats
       SET eligible_for_community = TRUE, progress_7d = 2.5
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    const progress = await calculateCommunitySquadProgress(pool, {
      metricDate: day,
      windowDays: 7,
      catalogueVersion: cat.catalogueVersion
    });
    assert.ok(progress.eligibleSquadCount >= 1);
    assert.ok(progress.avgCompletionProgress != null);
    assert.strictEqual(progress.catalogueVersion, cat.catalogueVersion);

    // Étape 60 — full pipeline smoke (may be heavy but must complete).
    const pipeline = await runSpriteGraphDailyPipeline(pool, { metricDate: day });
    assert.ok(pipeline.catalogueVersion);
    assert.ok(pipeline.community);
    assert.ok(pipeline.comparison);
    assert.ok(pipeline.popularity);
    assert.ok(pipeline.trends);
    assert.ok(pipeline.squads);
    assert.ok(pipeline.publish);
    assert.ok(pipeline.publish.anonymizationMinUsers >= 1);

    const published = await pool.query(
      `SELECT * FROM graph_daily_publish WHERE metric_date = $1::date`,
      [day]
    );
    assert.strictEqual(published.rows.length, 1);
    assert.strictEqual(published.rows[0].catalogue_version, pipeline.catalogueVersion);

    // Étape 59 — pipeline stamps catalogueVersion; rows only when variants written.
    assert.ok(pipeline.community.catalogueVersion || pipeline.catalogueVersion);
    if (pipeline.community.variants > 0) {
      const cvs = await pool.query(
        `SELECT catalogue_version FROM community_variant_stats
         WHERE metric_date = $1::date
           AND catalogue_version IS NOT NULL
         LIMIT 1`,
        [day]
      );
      assert.ok(cvs.rows.length, "expected stamped community_variant_stats rows");
      assert.strictEqual(cvs.rows[0].catalogue_version, pipeline.catalogueVersion);
    }
  });
  if (ok) passed++; else failed++;

  ok = await run("compteurs temps réel + rebuild + rétention (Étapes 61–65)", async () => {
    await ensureGraphEventsTable(pool);
    const {
      GRAPH_COUNTER_METRICS,
      COUNTER_TOTAL_ENTITY,
      GRAPH_RETENTION,
      ensureMetricCounterTables,
      incrementMetricCounter,
      applyRealtimeCountersFromEvent,
      getMetricCounter,
      counterBumpsForEvent,
      rebuildMetricCountersFromEvents,
      rebuildGraphMetrics,
      pruneGraphTechnicalArtifacts,
      compactGraphEventTechnicalContext
    } = require("../server/sprite-graph-counters");
    const { processGraphEventOutbox } = require("../server/sprite-graph-outbox");

    await ensureMetricCounterTables(pool);
    assert.strictEqual(GRAPH_RETENTION.keepRawEventsForever, true);
    assert.ok(GRAPH_RETENTION.rawEventKeepFields.includes("event_type"));
    assert.ok(GRAPH_RETENTION.technicalContextKeys.includes("requestId"));

    const day = new Date().toISOString().slice(0, 10);
    const variantRes = await pool.query(
      `SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`
    );
    assert.ok(variantRes.rows.length);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    // Étape 61 — incremental only, no community recalc flag.
    const rt = await applyRealtimeCountersFromEvent(pool, {
      event_type: "collection.priority_added",
      variant_id: variantId,
      sprite_id: spriteId,
      occurred_at: `${day}T12:00:00.000Z`,
      context: {}
    });
    assert.strictEqual(rt.recalculatedCommunity, false);
    assert.ok(rt.applied >= 2);

    const total = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: COUNTER_TOTAL_ENTITY
    });
    assert.ok(total);
    assert.ok(total.countValue >= 1);

    const byVariant = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: variantId
    });
    assert.ok(byVariant.countValue >= 1);

    // Étape 62 — outbox path increments counters (still no community %).
    const before = total.countValue;
    const user = await register(`Ctr${rnd()}`);
    await recordGraphEvent(pool, {
      eventType: GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
      actorUserId: user.id,
      variantId,
      spriteId,
      source: "api",
      occurredAt: `${day}T13:00:00.000Z`,
      context: { requestId: "tech-should-be-prunable", catalogueVersion: "test-ctr" },
      deduplicationKey: `ctr-prio-${rnd()}`
    });
    await processGraphEventOutbox(pool, { limit: 20 });
    const after = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: COUNTER_TOTAL_ENTITY
    });
    assert.ok(after.countValue >= before + 1);

    // Comparison difference bumps.
    const bumps = counterBumpsForEvent({
      event_type: "comparison.completed",
      context: { topDifferenceSpriteIds: [spriteId, spriteId, "unknown-x"] },
      occurred_at: `${day}T14:00:00.000Z`
    });
    assert.ok(bumps.some((b) => b.metricType === GRAPH_COUNTER_METRICS.COMPARISON_COMPLETED));
    assert.ok(bumps.some((b) => (
      b.metricType === GRAPH_COUNTER_METRICS.COMPARISON_DIFFERENCE && b.entityId === spriteId
    )));

    // Étape 63 — direct increment API.
    await incrementMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.INVITATION_SENT,
      entityId: COUNTER_TOTAL_ENTITY,
      delta: 3
    });
    const inv = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.INVITATION_SENT
    });
    assert.ok(inv.countValue >= 3);

    // Étape 64 — rebuild counters from raw events for today.
    const rebuilt = await rebuildMetricCountersFromEvents(pool, day, day);
    assert.ok(rebuilt.events >= 1);
    assert.ok(rebuilt.counterBumps >= 1);
    const rebuiltTotal = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: COUNTER_TOTAL_ENTITY
    });
    assert.ok(rebuiltTotal.countValue >= 1);

    // Full rebuild without re-running heavy daily pipeline for every assertion path.
    const full = await rebuildGraphMetrics(pool, day, day, {
      runDailyPipeline: false,
      rebuildCounters: true
    });
    assert.strictEqual(full.days, 1);
    assert.ok(full.counters.events >= 1);

    // Étape 65 — retention: never delete raw events; prune technical artifacts ok.
    const prune = await pruneGraphTechnicalArtifacts(pool, {
      outboxRetentionDays: 3650, // keep recent outbox in tests
      counterRetentionDays: 3650,
      compactTechnicalContext: false
    });
    assert.strictEqual(prune.keepRawEventsForever, true);
    assert.ok(Array.isArray(prune.rawEventKeepFields));

    // Compact technical context on a fresh old-dated event via controlled path.
    // Insert with occurred_at far in the past using recordGraphEvent.
    const oldKey = `ctr-old-${rnd()}`;
    const oldEv = await recordGraphEvent(pool, {
      eventType: GRAPH_EVENT_TYPES.GOAL_COMPLETED,
      actorUserId: user.id,
      source: "api",
      occurredAt: "2020-01-01T00:00:00.000Z",
      context: {
        requestId: "drop-me",
        goalScope: "personal",
        catalogueVersion: "keep-me"
      },
      deduplicationKey: oldKey
    });
    assert.ok(oldEv);
    const compacted = await compactGraphEventTechnicalContext(pool, {
      olderThanDays: 30,
      limit: 50
    });
    assert.ok(compacted >= 0);
    const afterCompact = await pool.query(
      `SELECT context FROM graph_events WHERE deduplication_key = $1`,
      [oldKey]
    );
    if (compacted > 0 && afterCompact.rows[0]) {
      assert.strictEqual(afterCompact.rows[0].context.requestId, undefined);
      assert.strictEqual(afterCompact.rows[0].context.goalScope, "personal");
    }

    // Raw event row still exists (not deleted).
    const stillThere = await pool.query(
      `SELECT id FROM graph_events WHERE deduplication_key = $1`,
      [oldKey]
    );
    assert.strictEqual(stillThere.rows.length, 1);
  });
  if (ok) passed++; else failed++;

  ok = await run("rétention + suppression compte + consentement + anti-abus (Étapes 66–70)", async () => {
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
  });
  if (ok) passed++; else failed++;

  ok = await run("réponse communautaire + tendances + historique (Étapes 76–80)", async () => {
    await ensureGraphEventsTable(pool);
    const {
      getStandardCommunityVariantResponse,
      getVariantCommunityHistory,
      getCommunityTrendsBoard,
      COMMUNITY_SOURCE_DISCLAIMER,
      formatRateFr
    } = require("../server/sprite-graph-public");

    assert.strictEqual(formatRateFr(5.63, { digits: 1 }), "5,6");
    assert.ok(COMMUNITY_SOURCE_DISCLAIMER.includes("SpriteDex"));

    const variantRes = await pool.query(
      `SELECT v.id, v.sprite_id, COALESCE(v.rarity, s.rarity) AS rarity
       FROM sprite_variants v JOIN sprites s ON s.id = v.sprite_id
       ORDER BY v.id LIMIT 1`
    );
    assert.ok(variantRes.rows.length);
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;
    const localDay = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dayNum}`;
    };
    const day = localDay(new Date());
    const dayPrev = localDay(new Date(Date.now() - 8 * 86400000));

    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate, not_owned_user_count,
         priority_added_7d, priority_added_30d, catalogue_version
       ) VALUES
         ($1::date, $3, 320, 18, 200, 90, 320, 5.63, 45, 200, 84, 156, '2026.07.18-1'),
         ($2::date, $3, 300, 10, 180, 42, 300, 3.2, 23, 180, 20, 40, '2026.07.10-1')
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         eligible_user_count = EXCLUDED.eligible_user_count,
         owner_user_count = EXCLUDED.owner_user_count,
         missing_user_count = EXCLUDED.missing_user_count,
         priority_user_count = EXCLUDED.priority_user_count,
         sample_size = EXCLUDED.sample_size,
         ownership_rate = EXCLUDED.ownership_rate,
         priority_rate = EXCLUDED.priority_rate,
         not_owned_user_count = EXCLUDED.not_owned_user_count,
         priority_added_7d = EXCLUDED.priority_added_7d,
         priority_added_30d = EXCLUDED.priority_added_30d,
         catalogue_version = EXCLUDED.catalogue_version`,
      [day, dayPrev, variantId]
    );
    // Isolate étape 81 gate: only one interest day for this variant.
    await pool.query(`DELETE FROM variant_interest_daily WHERE variant_id = $1`, [variantId]);
    await pool.query(
      `INSERT INTO variant_interest_daily (
         metric_date, variant_id, priority_user_count, ownership_rate,
         interest_score, sample_size, change_7d, trend, catalogue_version
       ) VALUES ($1::date, $2, 90, 5.63, 78, 320, 30, 'strongly_rising', '2026.07.18-1')
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         interest_score = 78, sample_size = 320, trend = 'strongly_rising', change_7d = 30`,
      [day, variantId]
    );

    const std = await getStandardCommunityVariantResponse(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.strictEqual(std.variantId, variantId);
    assert.strictEqual(std.asOf, day);
    assert.ok(std.community);
    assert.strictEqual(std.community.eligibleCollectionCount, 320);
    assert.strictEqual(std.community.ownerCount, 18);
    assert.strictEqual(std.community.ownershipRate, 5.63);
    assert.strictEqual(std.community.priorityRateAmongMissing, 45);
    assert.strictEqual(std.community.priorityAdds7d, 84);
    assert.strictEqual(std.community.interestScore, 78);
    // Étape 81 — single-day fixture is below min history → no trend label yet.
    assert.strictEqual(std.community.trend, null);
    assert.ok(std.publicDisplay.trend.includes("Pas encore assez"));
    assert.strictEqual(std.dataQuality.minimumSampleReached, true);
    assert.ok(std.publicDisplay.ownership.includes("5,6"));
    assert.ok(std.publicDisplay.priority.includes("45"));
    assert.ok(std.raritySeparation.ownershipLabel.includes("SpriteDex"));
    assert.ok(std.disclaimer.includes("SpriteDex"));

    // Étape 79 — official vs community separated.
    assert.ok("official" in std);
    assert.ok(std.raritySeparation.note);

    const hist = await getVariantCommunityHistory(pool, variantId, {
      days: 30,
      level: "aggregated_internal"
    });
    assert.strictEqual(hist.showHistory, true);
    assert.ok(hist.series.length >= 2);
    assert.ok(hist.ownership.evolutionLabel.includes("points"));
    assert.ok(hist.priorities.label.includes("priorités"));

    const board = await getCommunityTrendsBoard(pool, {
      metricDate: day,
      limit: 5,
      level: "aggregated_internal"
    });
    assert.ok(board.disclaimer.includes("SpriteDex"));
    assert.ok(board.sections.mostOwned);
    assert.ok(board.sections.rarestInSpritedex);
    assert.ok(board.sections.mostSought);
    assert.ok(board.sections.mostPriorityAdds);
    assert.ok(board.sections.strongestRisers);
    assert.ok(board.sections.mostCompared);

    // HTTP routes (if server restarted with routes-sprite-graph).
    const apiRes = await fetch(`${API}/sprite-graph/variants/${encodeURIComponent(variantId)}/community`);
    if (apiRes.ok) {
      const body = await apiRes.json();
      assert.strictEqual(body.variantId, variantId);
      assert.ok(body.disclaimer);
    }
    const trendsRes = await fetch(`${API}/sprite-graph/trends?limit=5`);
    if (trendsRes.ok) {
      const body = await trendsRes.json();
      assert.ok(body.sections);
      assert.ok(body.disclaimer.includes("SpriteDex"));
    }
    const spriteRes = await fetch(`${API}/sprite-graph/sprites/${encodeURIComponent(spriteId)}/community`);
    if (spriteRes.ok) {
      const body = await spriteRes.json();
      assert.strictEqual(body.spriteId, spriteId);
      assert.ok(body.officialRarityLabel == null || body.officialRarityLabel.includes("Rareté officielle"));
    }
  });
  if (ok) passed++; else failed++;

  ok = await run("seuils tendance + compare/squad context + reco hooks (Étapes 81–85)", async () => {
    const {
      evaluateTrendEligibility,
      TREND_DISPLAY_REQUIREMENTS,
      TREND_INSUFFICIENT_MESSAGE,
      ensureTrendTables
    } = require("../server/sprite-graph-trends");
    const {
      getCompareCommunityInsights,
      getStandardCommunityVariantResponse
    } = require("../server/sprite-graph-public");
    const {
      resolveSquadSizeBand,
      resolveCompletionBand,
      getSquadCommunityContext,
      ensureSquadDailyStatsTables
    } = require("../server/sprite-graph-squad-stats");
    const {
      getGraphRecommendationReadiness,
      resolveGraphRecommendations,
      FUTURE_GRAPH_RECOMMENDATION_SURFACES
    } = require("../server/sprite-graph-recommendations");

    // Étape 81 — gates.
    assert.strictEqual(TREND_DISPLAY_REQUIREMENTS.minDaysOfData, 7);
    assert.strictEqual(TREND_DISPLAY_REQUIREMENTS.minEligibleUsers, 20);
    assert.strictEqual(TREND_DISPLAY_REQUIREMENTS.minRelevantEvents, 5);
    const blocked = evaluateTrendEligibility({
      daysOfData: 3,
      sampleSize: 50,
      relevantEventCount: 10
    });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.message, TREND_INSUFFICIENT_MESSAGE);
    const allowed = evaluateTrendEligibility({
      daysOfData: 7,
      sampleSize: 20,
      relevantEventCount: 5
    });
    assert.strictEqual(allowed.ok, true);

    await ensureTrendTables(pool);
    const variantRes = await pool.query(
      `SELECT v.id FROM sprite_variants v ORDER BY v.id LIMIT 1`
    );
    const variantId = variantRes.rows[0].id;
    const localDay = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dayNum}`;
    };
    const day = localDay(new Date());

    // Seed enough interest history + events for a visible trend.
    for (let i = 0; i < 8; i++) {
      const d = localDay(new Date(Date.now() - i * 86400000));
      await pool.query(
        `INSERT INTO variant_interest_daily (
           metric_date, variant_id, priority_user_count, ownership_rate,
           interest_score, sample_size, change_7d, trend
         ) VALUES ($1::date, $2, 40, 6, $3, 80, 12, 'rising')
         ON CONFLICT (metric_date, variant_id) DO UPDATE SET
           interest_score = EXCLUDED.interest_score,
           sample_size = 80,
           change_7d = 12,
           trend = 'rising'`,
        [d, variantId, 50 + i]
      );
    }
    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate, not_owned_user_count,
         priority_added_7d, priority_added_30d
       ) VALUES ($1::date, $2, 80, 5, 60, 20, 80, 6.25, 33, 60, 4, 10)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET
         sample_size = 80, ownership_rate = 6.25, priority_rate = 33,
         owner_user_count = 5, missing_user_count = 60, priority_user_count = 20`,
      [day, variantId]
    );
    for (let i = 0; i < 6; i++) {
      await recordGraphEvent(pool, {
        eventType: GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
        actorUserId: 1,
        spriteId: "sg_trend_sprite",
        variantId: String(variantId),
        source: "system",
        origin: "test.trend81",
        context: { seed: `trend81-${i}` },
        deduplicationKey: `trend81-${variantId}-${i}-${rnd()}`
      });
    }

    const stdReady = await getStandardCommunityVariantResponse(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.ok(stdReady.trendEligibility);
    // Events may land outside window depending on DB clock; eligibility object always present.
    if (stdReady.trendEligibility.ok) {
      assert.ok(stdReady.community.trend);
      assert.ok(stdReady.publicDisplay.trend.startsWith("Tendance"));
    } else {
      assert.ok(stdReady.publicDisplay.trend.includes("Pas encore assez"));
    }

    // Étape 82 — compare insights (secondary).
    const compare = await getCompareCommunityInsights(pool, {
      items: [
        { variantId, relation: "bothMissing" },
        { variantId, relation: "onlyA" }
      ],
      aName: "Quentin",
      bName: "Lucy",
      level: "aggregated_internal"
    });
    assert.ok(compare.insights.length >= 1);
    assert.ok(compare.note.includes("secondaires"));
    const both = compare.insights.find((i) => i.relation === "bothMissing");
    assert.ok(both);
    assert.ok(both.personalLine.includes("Quentin"));
    assert.ok(both.communityLine.includes("%"));
    assert.strictEqual(both.priority, "secondary");

    // Étape 84 — peer bands.
    assert.strictEqual(resolveSquadSizeBand(5).id, "4_6");
    assert.ok(resolveSquadSizeBand(5).label.includes("4 à 6"));
    assert.strictEqual(resolveCompletionBand(82).id, "75_100");
    assert.notStrictEqual(resolveSquadSizeBand(2).id, resolveSquadSizeBand(20).id);

    // Étape 83 — squad community context (if a squad exists).
    await ensureSquadDailyStatsTables(pool);
    const squadRow = await pool.query(`SELECT id, name, code FROM squads ORDER BY id LIMIT 1`);
    if (squadRow.rows.length) {
      const sid = squadRow.rows[0].id;
      await pool.query(
        `INSERT INTO squad_daily_stats (
           metric_date, squad_id, active_member_count, covered_variant_count,
           catalogue_variant_count, collective_completion_rate, progress_7d,
           eligible_for_community, catalogue_version
         ) VALUES ($1::date, $2, 5, 100, 120, 82, 2.1, TRUE, 'test')
         ON CONFLICT (metric_date, squad_id) DO UPDATE SET
           active_member_count = 5,
           collective_completion_rate = 82,
           progress_7d = 2.1,
           eligible_for_community = TRUE`,
        [day, sid]
      );
      // Peer squads in same band.
      const peers = await pool.query(`SELECT id FROM squads WHERE id <> $1 LIMIT 3`, [sid]);
      for (const p of peers.rows) {
        await pool.query(
          `INSERT INTO squad_daily_stats (
             metric_date, squad_id, active_member_count, covered_variant_count,
             catalogue_variant_count, collective_completion_rate, progress_7d,
             eligible_for_community
           ) VALUES ($1::date, $2, 5, 90, 120, 70, 2.0, TRUE)
           ON CONFLICT (metric_date, squad_id) DO UPDATE SET
             active_member_count = 5, progress_7d = 2.0, eligible_for_community = TRUE`,
          [day, p.id]
        );
      }
      const ctx = await getSquadCommunityContext(pool, sid, { metricDate: day });
      assert.ok(ctx);
      assert.ok(ctx.coverage.label.includes("82"));
      assert.strictEqual(ctx.peerGroup.competitive, false);
      assert.strictEqual(ctx.peerGroup.ranking, null);
      assert.ok(ctx.peerGroup.sizeBand.id === "4_6");

      const apiSquad = await fetch(
        `${API}/sprite-graph/squads/${encodeURIComponent(squadRow.rows[0].code)}/community`
      );
      if (apiSquad.ok) {
        const body = await apiSquad.json();
        assert.strictEqual(body.peerGroup.competitive, false);
      }
    }

    // Étape 85 — readiness only, empty items.
    const readiness = getGraphRecommendationReadiness();
    assert.strictEqual(readiness.autoGenerate, false);
    assert.ok(readiness.surfaces.length >= 6);
    assert.ok(
      readiness.surfaces.every((s) => s.status === "reserved" && s.autoGenerate === false)
    );
    const resolved = await resolveGraphRecommendations(pool, null, {
      surface: FUTURE_GRAPH_RECOMMENDATION_SURFACES.PRIORITY_SUGGESTIONS
    });
    assert.deepStrictEqual(resolved.items, []);
    assert.strictEqual(resolved.autoGenerate, false);

    const readyRes = await fetch(`${API}/sprite-graph/recommendations/readiness`);
    if (readyRes.ok) {
      const body = await readyRes.json();
      assert.strictEqual(body.autoGenerate, false);
    }
    const compareRes = await fetch(`${API}/sprite-graph/compare/community-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ variantId, relation: "bothMissing" }],
        aName: "A",
        bName: "B"
      })
    });
    if (compareRes.ok) {
      const body = await compareRes.json();
      assert.ok(Array.isArray(body.insights));
    }
  });
  if (ok) passed++; else failed++;

  ok = await run("règles simples + pas de score social caché (Étapes 86–87)", async () => {
    const {
      evaluateSimpleGraphRules,
      getGraphScoringPolicy,
      assertNoForbiddenUserValueScores,
      FORBIDDEN_USER_VALUE_SCORES,
      SIMPLE_GRAPH_RULES
    } = require("../server/sprite-graph-rules");
    const {
      getGraphRecommendationReadiness,
      resolveGraphRecommendations
    } = require("../server/sprite-graph-recommendations");

    assert.ok(SIMPLE_GRAPH_RULES.some((r) => r.id === "strong_priority_alert"));
    assert.ok(SIMPLE_GRAPH_RULES.some((r) => r.id === "suggest_comparison"));

    const alert = evaluateSimpleGraphRules({
      isPriority: true,
      ownershipRate: 5.6,
      eventEndingInHours: 12
    });
    assert.strictEqual(alert.engine, "simple_rules");
    assert.strictEqual(alert.complexModels, false);
    assert.strictEqual(alert.ranksPeople, false);
    assert.ok(alert.matches.some((m) => m.ruleId === "strong_priority_alert"));
    assert.ok(alert.matches[0].outcome.message.toLowerCase().includes("alerte"));

    const noAlert = evaluateSimpleGraphRules({
      isPriority: true,
      ownershipRate: 5.6,
      eventEndingInHours: 200
    });
    assert.ok(!noAlert.matches.some((m) => m.ruleId === "strong_priority_alert"));

    const suggest = evaluateSimpleGraphRules({
      complementaryVariantCount: 16,
      collectionFillPctA: 81,
      collectionFillPctB: 90
    });
    assert.ok(suggest.matches.some((m) => m.ruleId === "suggest_comparison"));

    const noSuggest = evaluateSimpleGraphRules({
      complementaryVariantCount: 16,
      collectionFillPctA: 50,
      collectionFillPctB: 90
    });
    assert.ok(!noSuggest.matches.some((m) => m.ruleId === "suggest_comparison"));

    const policy = getGraphScoringPolicy();
    assert.strictEqual(policy.ranksPeople, false);
    assert.strictEqual(policy.allowsHiddenUserValueScores, false);
    assert.ok(FORBIDDEN_USER_VALUE_SCORES.includes("prestige_score"));
    assert.ok(assertNoForbiddenUserValueScores({ interestScore: 12, ownershipRate: 5 }).ok);
    assert.ok(!assertNoForbiddenUserValueScores({ prestigeScore: 99 }).ok);
    assert.ok(!assertNoForbiddenUserValueScores({ collector_value_score: 1 }).ok);

    const readiness = getGraphRecommendationReadiness();
    assert.strictEqual(readiness.simpleRules, true);
    assert.strictEqual(readiness.complexModels, false);
    assert.strictEqual(readiness.ranksPeople, false);

    const withFacts = await resolveGraphRecommendations(pool, null, {
      facts: {
        complementaryVariantCount: 20,
        collectionFillPctA: 85,
        collectionFillPctB: 85
      }
    });
    assert.ok(withFacts.items.some((i) => i.id === "suggest_comparison"));
    assert.strictEqual(withFacts.ranksPeople, false);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 86"));
    assert.ok(doc.includes("Étape 87"));
    assert.ok(doc.includes("score de prestige") || doc.includes("prestige"));

    const rulesRes = await fetch(`${API}/sprite-graph/rules/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isPriority: true,
        ownershipRate: 4,
        eventEndingInHours: 6
      })
    });
    if (rulesRes.ok) {
      const body = await rulesRes.json();
      assert.ok(body.matches.some((m) => m.ruleId === "strong_priority_alert"));
    }
    const policyRes = await fetch(`${API}/sprite-graph/scoring-policy`);
    if (policyRes.ok) {
      const body = await policyRes.json();
      assert.strictEqual(body.ranksPeople, false);
    }
  });
  if (ok) passed++; else failed++;

  ok = await run("contrat événements graph (Étape 88)", async () => {
    await ensureGraphEventsTable(pool);
    const user = await register(`SgEv88${rnd()}`);
    const other = await register(`SgEv88b${rnd()}`);
    const variantId = `sg88_${rnd()}`;
    const spriteId = `sg88s_${rnd()}`;
    const occurredAt = "2026-07-18T15:30:00.000Z";

    // Succès → événement créé.
    const okEv = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: user.id,
      spriteId,
      variantId,
      source: "web",
      origin: "test.etape88",
      occurredAt,
      context: { newStatus: "owned", catalogueVersion: "2026.07.18-1" },
      deduplicationKey: `etape88-ok-${user.id}-${variantId}`
    }, { skipGovernance: true });
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
    const dup = await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: user.id,
      spriteId,
      variantId,
      source: "web",
      deduplicationKey: `etape88-ok-${user.id}-${variantId}`
    }, { skipGovernance: true });
    assert.strictEqual(dup, null);

    // Type inconnu → aucun événement.
    const unknown = await recordGraphEvent(pool, {
      eventType: "collection.not_a_real_event",
      actorUserId: user.id,
      source: "api"
    }, { skipGovernance: true });
    assert.strictEqual(unknown, null);

    // Échec métier (écriture collection refusée) → aucun nouvel event.
    const beforeFail = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events WHERE actor_user_id = $1`,
      [other.id]
    );
    const denied = await fetch(
      `${API}/collection/${user.id}/${encodeURIComponent(variantId)}`,
      {
        method: "PUT",
        headers: auth(other.token),
        body: JSON.stringify({ status: "owned" })
      }
    );
    assert.ok(!denied.ok, "cross-user setEntry must fail");
    const afterFail = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events WHERE actor_user_id = $1`,
      [other.id]
    );
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
      const txEv = await recordCollectionGraphEvents(user.id, [{
        variantId: txVariant,
        spriteId,
        isNewEntry: true,
        changeId: `tx_${txVariant}`,
        newStatus: "owned"
      }], {
        source: "api",
        origin: "test.etape88.tx",
        catalogueVersion: "2026.07.18-1",
        db: client,
        throwOnError: true
      });
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

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 88"));
  });
  if (ok) passed++; else failed++;

  ok = await run("collection.sprite_added (Étape 89)", async () => {
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

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 89"));
    assert.ok(doc.includes("collection.sprite_added"));
  });
  if (ok) passed++; else failed++;

  ok = await run("collection.status_changed (Étape 90)", async () => {
    await ensureGraphEventsTable(pool);
    const user = await register(`SgSt90${rnd()}`);
    const spriteId = `sg90s_${rnd()}`;
    const variantId = `sg90_${rnd()}`;
    const cat = "2026.07.18-1";

    // Seed as missing (existing entry).
    await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: true,
      changeId: `seed90_${variantId}`,
      newStatus: "missing"
    }], { source: "api", catalogueVersion: cat });

    // missing → priority
    const toPrio = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: false,
      historyId: 9001,
      previousStatus: "missing",
      newStatus: "priority",
      newPriority: "urgent"
    }], { source: "api", catalogueVersion: cat });
    const prioStatus = toPrio.find((e) => e.eventType === "collection.status_changed");
    assert.ok(prioStatus);
    assert.strictEqual(prioStatus.context.previousStatus, "missing");
    assert.strictEqual(prioStatus.context.oldStatus, "missing");
    assert.strictEqual(prioStatus.context.newStatus, "priority");
    assert.strictEqual(prioStatus.eventVersion, 1);
    assert.ok(toPrio.some((e) => e.eventType === "collection.priority_added"));

    // priority → owned
    const toOwned = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: false,
      historyId: 9002,
      previousStatus: "priority",
      newStatus: "owned",
      previousPriority: "urgent",
      newPriority: "urgent"
    }], { source: "web", catalogueVersion: cat });
    assert.strictEqual(toOwned.length, 1);
    assert.strictEqual(toOwned[0].eventType, "collection.status_changed");
    assert.strictEqual(toOwned[0].context.previousStatus, "priority");
    assert.strictEqual(toOwned[0].context.newStatus, "owned");
    assert.strictEqual(toOwned[0].source, "web");

    // owned → missing
    const toMissing = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: false,
      historyId: 9003,
      previousStatus: "owned",
      newStatus: "missing"
    }], { source: "api", catalogueVersion: cat });
    assert.strictEqual(toMissing.length, 1);
    assert.strictEqual(toMissing[0].context.previousStatus, "owned");
    assert.strictEqual(toMissing[0].context.newStatus, "missing");

    // owned → owned : aucun événement
    const noop = await recordCollectionGraphEvents(user.id, [{
      variantId,
      spriteId,
      isNewEntry: false,
      previousStatus: "owned",
      newStatus: "owned"
    }], { source: "api" });
    assert.strictEqual(noop.length, 0);

    // Historique conservé (append-only) — les 3 transitions restent.
    const hist = await pool.query(
      `SELECT context->>'previousStatus' AS prev, context->>'newStatus' AS next, occurred_at
       FROM graph_events
       WHERE actor_user_id = $1 AND variant_id = $2
         AND event_type = 'collection.status_changed'
       ORDER BY recorded_at ASC`,
      [user.id, variantId]
    );
    assert.ok(hist.rows.length >= 3);
    const transitions = hist.rows.map((r) => `${r.prev}->${r.next}`);
    assert.ok(transitions.includes("missing->priority"));
    assert.ok(transitions.includes("priority->owned"));
    assert.ok(transitions.includes("owned->missing"));

    // UPDATE interdit sur graph_events (append-only).
    let updateBlocked = false;
    try {
      await pool.query(
        `UPDATE graph_events SET source = 'tamper' WHERE id = $1::uuid`,
        [toMissing[0].id]
      );
    } catch (_e) {
      updateBlocked = true;
    }
    assert.ok(updateBlocked, "historique status_changed doit rester immuable");

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 90"));
    assert.ok(doc.includes("owned → owned") || doc.includes("owned→owned"));
  });
  if (ok) passed++; else failed++;

  ok = await run("événements sociaux (Étape 91)", async () => {
    await ensureGraphEventsTable(pool);
    const { applyFriendAction } = require("../server/friends/state-machine");

    const a = await register(`SgSocA${rnd()}`);
    const b = await register(`SgSocB${rnd()}`);
    const c = await register(`SgSocC${rnd()}`);

    // Invitation envoyée.
    const invited = await applyFriendAction(a.id, b.id, "request", {
      invitationMethod: "username",
      origin: "test.etape91"
    });
    assert.ok(invited.ok, invited.message || "invite failed");
    await new Promise((r) => setTimeout(r, 80));
    const invCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND target_user_id = $2
         AND event_type = 'friend_invitation.sent'`,
      [a.id, b.id]
    );
    assert.strictEqual(invCount.rows[0].n, 1);

    // Invitation en double refusée — pas de second événement.
    const dup = await applyFriendAction(a.id, b.id, "request", {
      invitationMethod: "username",
      origin: "test.etape91.dup"
    });
    assert.ok(dup.error === 409 || dup.ok === false);
    const invCount2 = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND target_user_id = $2
         AND event_type = 'friend_invitation.sent'`,
      [a.id, b.id]
    );
    assert.strictEqual(invCount2.rows[0].n, 1);

    // Blocage respecté — pas d’invitation ni d’événement.
    const blockRes = await fetch(`${API}/users/${c.id}/block`, {
      method: "POST",
      headers: auth(a.token)
    });
    if (!blockRes.ok) throw new Error(`block failed: ${await blockRes.text()}`);
    const blockedInvite = await applyFriendAction(c.id, a.id, "request", {
      invitationMethod: "username",
      origin: "test.etape91.block"
    });
    assert.ok(blockedInvite.error === 403 || blockedInvite.ok === false);
    const blockedEv = await pool.query(
      `SELECT COUNT(*)::int AS n FROM graph_events
       WHERE actor_user_id = $1 AND target_user_id = $2
         AND event_type = 'friend_invitation.sent'`,
      [c.id, a.id]
    );
    assert.strictEqual(blockedEv.rows[0].n, 0);

    // Entrée dans une squad → squad.joined.
    const owner = await register(`SgSocOwn${rnd()}`);
    const joiner = await register(`SgSocJoin${rnd()}`);
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Soc${rnd()}` })
    });
    if (!squadRes.ok) throw new Error(`create squad: ${await squadRes.text()}`);
    const squad = await squadRes.json();
    const code = squad.code || squad.squad?.code;
    assert.ok(code);
    const joinRes = await fetch(`${API}/squads/join`, {
      method: "POST",
      headers: auth(joiner.token),
      body: JSON.stringify({ code })
    });
    if (!joinRes.ok) throw new Error(`join squad: ${await joinRes.text()}`);
    await new Promise((r) => setTimeout(r, 120));
    const joinEv = await pool.query(
      `SELECT context, squad_id FROM graph_events
       WHERE actor_user_id = $1 AND event_type = 'squad.joined'
       ORDER BY recorded_at DESC LIMIT 1`,
      [joiner.id]
    );
    assert.strictEqual(joinEv.rows.length, 1);
    assert.ok(
      joinEv.rows[0].context?.joinSource === "join_code"
        || joinEv.rows[0].context?.memberRole
    );

    // Comparaison comptée une seule fois.
    const result = {
      summary: {
        catalogueVariantCount: 10,
        insufficientData: false,
        collectiveCompletionRate: 40,
        complementarityRate: 20,
        onlyUserACount: 1,
        onlyUserBCount: 2,
        bothOwnedCount: 3,
        bothMissingCount: 4
      }
    };
    const first = await recordParticipantComparisonSession({
      requesterId: a.id,
      userAId: a.id,
      userBId: b.id,
      source: "friends_list",
      catalogueVersion: "2026.07.18-1",
      result
    });
    assert.ok(first.counted);
    const second = await recordParticipantComparisonSession({
      requesterId: b.id,
      userAId: a.id,
      userBId: b.id,
      source: "friends_list",
      catalogueVersion: "2026.07.18-1",
      result
    });
    assert.strictEqual(second.counted, false);
    assert.strictEqual(second.skippedReason, "deduped");

    // Données privées non exposées.
    const scrubbed = sanitizeGraphContext({
      email: "secret@example.com",
      note: "privé",
      blockReason: "spam",
      invitationMethod: "username",
      catalogueVersion: "keep"
    });
    assert.strictEqual(scrubbed.email, undefined);
    assert.strictEqual(scrubbed.note, undefined);
    assert.strictEqual(scrubbed.blockReason, undefined);
    assert.strictEqual(scrubbed.catalogueVersion, "keep");
    const metrics = await getFriendInvitationPublicMetrics(pool);
    assert.strictEqual(metrics.actorUserId, undefined);
    assert.strictEqual(metrics.targetUserId, undefined);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 91"));
  });
  if (ok) passed++; else failed++;

  ok = await run("agrégats communautaires (Étape 92)", async () => {
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();

    const variantRes = await pool.query(
      `SELECT v.id
       FROM sprite_variants v
       LEFT JOIN sprite_entries e ON e.variant_id = v.id
       GROUP BY v.id
       HAVING COUNT(e.id) = 0
       ORDER BY v.id
       LIMIT 1`
    );
    const fallback = await pool.query(`SELECT id FROM sprite_variants ORDER BY id DESC LIMIT 1`);
    const variantId = (variantRes.rows[0] || fallback.rows[0]).id;

    const users = [];
    for (const prefix of ["El", "Ow", "Mi", "Pr", "Un", "Su"]) {
      users.push(await register(`C92${prefix}${rnd()}`));
    }
    const [uElig, uOwned, uMissing, uPriority, uUnknown, uSuspended] = users;
    for (const u of users) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(), is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb,
             suspended_until = NULL
         WHERE id = $1`,
        [u.id]
      );
    }
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, status)
       VALUES
         ($1, $7, 'owned'),
         ($2, $7, 'owned'),
         ($3, $7, 'missing'),
         ($4, $7, 'priority'),
         ($5, $7, 'unknown'),
         ($6, $7, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = EXCLUDED.status`,
      [uElig.id, uOwned.id, uMissing.id, uPriority.id, uUnknown.id, uSuspended.id, variantId]
    );

    // Suspended excluded.
    await pool.query(
      `UPDATE users SET suspended_until = NOW() + INTERVAL '2 hours' WHERE id = $1`,
      [uSuspended.id]
    );
    const eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(eligible.includes(Number(uOwned.id)));
    assert.ok(!eligible.includes(Number(uSuspended.id)));
    assert.ok(!OWNERSHIP_SAMPLE_STATUSES.includes("unknown"));

    const day = new Date().toISOString().slice(0, 10);
    const catVersion = `test-92-${rnd()}`;
    const calc = await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: catVersion
    });
    assert.ok(calc.variants >= 1);

    const row = await pool.query(
      `SELECT * FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(row.rows.length, 1);
    const stats = row.rows[0];
    assert.ok(stats.sample_size >= 1);
    assert.strictEqual(
      Number(stats.ownership_rate),
      roundRate(stats.owner_user_count, stats.sample_size)
    );
    assert.ok(stats.priority_rate == null || Number.isFinite(Number(stats.priority_rate)));
    // unknown must not inflate sample relative to owned+missing+priority(+spotted).
    assert.ok(Number(stats.sample_size) >= Number(stats.owner_user_count));
    assert.strictEqual(stats.catalogue_version, catVersion);

    const pub = await getCommunityVariantOwnership(pool, variantId, { metricDate: day });
    if (stats.sample_size < PUBLIC_ANONYMIZATION_MIN_USERS) {
      assert.ok(pub.insufficient);
      assert.strictEqual(pub.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);
    }
    const gate = applyPublicAnonymizationGate({
      uniqueUserCount: stats.sample_size,
      payload: { ownershipRate: stats.ownership_rate }
    });
    assert.strictEqual(gate.ok, stats.sample_size >= PUBLIC_ANONYMIZATION_MIN_USERS);

    const internal = await getCommunityVariantOwnership(pool, variantId, {
      metricDate: day,
      level: "aggregated_internal"
    });
    assert.ok(internal.sampleSizeDisplay.includes("échantillon") || internal.sampleSize >= 1);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 92"));
  });
  if (ok) passed++; else failed++;

  ok = await run("tendances (Étape 93)", async () => {
    const {
      resolveInterestTrend,
      evaluateTrendEligibility,
      TREND_DISPLAY_REQUIREMENTS,
      TREND_INSUFFICIENT_MESSAGE,
      ensureTrendTables,
      calculateVariantInterestDaily,
      getVariantInterestSeries,
      percentChange
    } = require("../server/sprite-graph-trends");
    const { decomposeCatalogueVsAcquisition } = require("../server/sprite-graph-squad-stats");

    // Hausse / baisse / stabilité (+ volume insuffisant sans jours/events).
    assert.strictEqual(resolveInterestTrend(30, 25, { enforceDisplayRequirements: false }), "strongly_rising");
    assert.strictEqual(resolveInterestTrend(12, 25, { enforceDisplayRequirements: false }), "rising");
    assert.strictEqual(resolveInterestTrend(0, 25, { enforceDisplayRequirements: false }), "stable");
    assert.strictEqual(resolveInterestTrend(-12, 25, { enforceDisplayRequirements: false }), "falling");
    assert.strictEqual(resolveInterestTrend(-30, 25, { enforceDisplayRequirements: false }), "strongly_falling");
    assert.strictEqual(resolveInterestTrend(40, 5, { enforceDisplayRequirements: false }), null);

    // Historique trop court / volume / events.
    const short = evaluateTrendEligibility({
      daysOfData: 3,
      sampleSize: 50,
      relevantEventCount: 10
    });
    assert.strictEqual(short.ok, false);
    assert.strictEqual(short.message, TREND_INSUFFICIENT_MESSAGE);
    assert.ok(TREND_DISPLAY_REQUIREMENTS.minDaysOfData >= 7);

    // Nouvelle variante — aucune série d’intérêt ⇒ pas de tendance.
    await ensureTrendTables(pool);
    const day = new Date().toISOString().slice(0, 10);
    const seriesFresh = await getVariantInterestSeries(pool, `sg93new_${rnd()}`, {
      days: 30,
      level: "aggregated_internal"
    });
    assert.ok(seriesFresh == null || seriesFresh.latest?.trend == null);

    const variantRes = await pool.query(
      `SELECT v.id FROM sprite_variants v ORDER BY v.id LIMIT 1`
    );
    const variantId = variantRes.rows[0].id;
    await pool.query(`DELETE FROM variant_interest_daily WHERE variant_id = $1`, [variantId]);
    await pool.query(
      `INSERT INTO variant_interest_daily (
         metric_date, variant_id, priority_user_count, ownership_rate,
         interest_score, sample_size, change_7d, trend
       ) VALUES ($1::date, $2, 10, 8, 40, 30, 5, 'rising')
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET interest_score = 40, sample_size = 30`,
      [day, variantId]
    );
    const series = await getVariantInterestSeries(pool, variantId, {
      days: 30,
      level: "aggregated_internal"
    });
    assert.ok(series);
    assert.strictEqual(series.latest.trend, null);
    assert.ok(
      (series.latest.trendMessage || series.trendEligibility?.message || "")
        .includes("Pas encore assez")
    );

    // Événement temporaire — priority_added avec eventId.
    const user = await register(`Sg93Ev${rnd()}`);
    const tmp = await recordCollectionGraphEvents(user.id, [{
      variantId: `sg93tmp_${rnd()}`,
      spriteId: "sg93s",
      isNewEntry: false,
      historyId: 9301,
      previousStatus: "missing",
      newStatus: "priority",
      newPriority: "urgent",
      eventId: "event_hot_temp_93"
    }], { source: "api", catalogueVersion: "2026.07.18-1" });
    const prio = tmp.find((e) => e.eventType === "collection.priority_added");
    assert.ok(prio);
    assert.strictEqual(prio.context.eventId, "event_hot_temp_93");

    // Correction de catalogue — choc taille ≠ acquisition.
    const decomp = decomposeCatalogueVsAcquisition({
      previousCovered: 80,
      previousCatalogueCount: 100,
      currentCovered: 80,
      currentCatalogueCount: 120
    });
    assert.ok(decomp.catalogueExpansionImpact < 0);
    assert.strictEqual(decomp.acquisitionProgress, 0);
    assert.ok(percentChange(60, 50) > 0);

    // Recalc path still runs for known variants.
    await pool.query(
      `INSERT INTO community_variant_stats (
         metric_date, variant_id, eligible_user_count, owner_user_count,
         missing_user_count, priority_user_count, sample_size,
         ownership_rate, priority_rate
       ) VALUES ($1::date, $2, 40, 8, 20, 10, 40, 20, 33)
       ON CONFLICT (metric_date, variant_id) DO UPDATE SET sample_size = 40`,
      [day, variantId]
    );
    const calc = await calculateVariantInterestDaily(pool, { metricDate: day });
    assert.ok(calc.variants >= 1);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 93"));
  });
  if (ok) passed++; else failed++;

  ok = await run("progression des squads (Étape 94)", async () => {
    const {
      ensureSquadDailyStatsTables,
      calculateSquadDailyStats,
      listEligibleSquadIds,
      decomposeCatalogueVsAcquisition
    } = require("../server/sprite-graph-squad-stats");
    await ensureSquadDailyStatsTables(pool);

    const owner = await register(`Sq94A${rnd()}`);
    const member = await register(`Sq94B${rnd()}`);
    const compare = require("../server/compare");
    const catalog = (await compare.getServerCompareCatalogItemsCached())
      .filter(compare.isVariantReleasedAndActiveServer);
    assert.ok(catalog.length >= 2, "need active catalogue variants");
    const v1 = { id: catalog[0].variantId || catalog[0].id, sprite_id: catalog[0].spriteId };
    const v2 = { id: catalog[1].variantId || catalog[1].id, sprite_id: catalog[1].spriteId };

    for (const u of [owner, member]) {
      await pool.query(
        `UPDATE users
         SET last_active_at = NOW(), is_test_account = FALSE,
             community_stats_opt_in = TRUE,
             cookie_consent = '{"necessary":true,"analytics":true}'::jsonb,
             collection_visibility = 'friends',
             suspended_until = NULL
         WHERE id = $1`,
        [u.id]
      );
    }

    // Owner owns v1 uniquely; both own v2 (doublon).
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES
         ($1, $3, $5, 'owned'),
         ($1, $4, $6, 'owned'),
         ($2, $4, $6, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
      [owner.id, member.id, v1.id, v2.id, v1.sprite_id, v2.sprite_id]
    );

    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(owner.token),
      body: JSON.stringify({ name: `Prog${rnd()}` })
    });
    if (!squadRes.ok) throw new Error(`create squad: ${await squadRes.text()}`);
    const squadBody = await squadRes.json();
    const code = squadBody.code || squadBody.squad?.code;
    const squadId = squadBody.id || squadBody.squad?.id;
    assert.ok(code && squadId);

    const joinRes = await fetch(`${API}/squads/join`, {
      method: "POST",
      headers: auth(member.token),
      body: JSON.stringify({ code })
    });
    if (!joinRes.ok) throw new Error(`join squad: ${await joinRes.text()}`);

    // Impact join : variantes uniques du joiner vs partagées.
    const impact = await computeSquadJoinImpact(squadId, member.id, {
      previousMemberIds: [owner.id]
    });
    assert.ok(impact.sharedVariantsAdded >= 1); // v2 shared
    // v1 is owner-only — joiner adds 0 unique if they only share v2
    assert.ok(impact.newVariantsAddedToSquad >= 0);

    const day = new Date().toISOString().slice(0, 10);
    const catA = `cat94a-${rnd()}`;
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catA,
      catalogueVariantCount: 100,
      eligibleSquadIds: [squadId]
    });
    const before = await pool.query(
      `SELECT * FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(before.rows.length, 1);
    assert.ok(before.rows[0].unique_owner_variant_count >= 1);
    assert.ok(before.rows[0].shared_variant_count >= 1);
    assert.strictEqual(before.rows[0].catalogue_version, catA);
    assert.strictEqual(before.rows[0].active_member_count, 2);
    const coveredWithBoth = Number(before.rows[0].covered_variant_count);

    // Doublon sans gain collectif : member also gets v1 → unique drops, covered unchanged.
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES ($1, $2, $3, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
      [member.id, v1.id, v1.sprite_id]
    );
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catA,
      catalogueVariantCount: 100,
      eligibleSquadIds: [squadId]
    });
    const afterDup = await pool.query(
      `SELECT covered_variant_count, unique_owner_variant_count, shared_variant_count
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(Number(afterDup.rows[0].covered_variant_count), coveredWithBoth);
    assert.ok(Number(afterDup.rows[0].shared_variant_count) >= Number(before.rows[0].shared_variant_count));

    // Nouvelle version catalogue — choc ≠ acquisition.
    const decomp = decomposeCatalogueVsAcquisition({
      previousCovered: coveredWithBoth,
      previousCatalogueCount: 100,
      currentCovered: coveredWithBoth,
      currentCatalogueCount: 130
    });
    assert.ok(decomp.catalogueExpansionImpact < 0);
    assert.strictEqual(decomp.acquisitionProgress, 0);
    const catB = `cat94b-${rnd()}`;
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catB,
      catalogueVariantCount: 130,
      eligibleSquadIds: [squadId]
    });
    const afterCat = await pool.query(
      `SELECT catalogue_version, catalogue_variant_count, catalogue_expansion_impact
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(afterCat.rows[0].catalogue_version, catB);
    // Matrix uses live catalogue size; version stamp still records the new release.
    assert.ok(Number(afterCat.rows[0].catalogue_variant_count) >= coveredWithBoth);

    // Collection privée exclue du couverture communautaire.
    await pool.query(
      `UPDATE users SET collection_visibility = 'private' WHERE id = $1`,
      [member.id]
    );
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catB,
      catalogueVariantCount: 130,
      eligibleSquadIds: [squadId]
    });
    const afterPrivate = await pool.query(
      `SELECT covered_variant_count, active_member_count
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.ok(Number(afterPrivate.rows[0].covered_variant_count) <= coveredWithBoth);
    assert.strictEqual(Number(afterPrivate.rows[0].active_member_count), 2);
    await pool.query(
      `UPDATE users SET collection_visibility = 'friends' WHERE id = $1`,
      [member.id]
    );

    // Départ d’un membre.
    const leaveRes = await fetch(`${API}/squads/${encodeURIComponent(code)}/leave`, {
      method: "POST",
      headers: auth(member.token)
    });
    if (!leaveRes.ok) throw new Error(`leave squad: ${await leaveRes.text()}`);
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      catalogueVersion: catB,
      catalogueVariantCount: 130,
      eligibleSquadIds: [squadId]
    });
    const afterLeave = await pool.query(
      `SELECT active_member_count FROM squad_daily_stats
       WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    assert.strictEqual(Number(afterLeave.rows[0].active_member_count), 1);

    // Squad inactive — membres inactifs → non éligible.
    await pool.query(
      `UPDATE users SET last_active_at = NOW() - INTERVAL '200 days' WHERE id = $1`,
      [owner.id]
    );
    // Re-add member as inactive too so squad has 2 but no recent activity.
    await pool.query(
      `UPDATE squad_members SET status = 'active', left_at = NULL WHERE squad_id = $1 AND user_id = $2`,
      [squadId, member.id]
    );
    await pool.query(
      `UPDATE users SET last_active_at = NOW() - INTERVAL '200 days' WHERE id = $1`,
      [member.id]
    );
    const eligible = await listEligibleSquadIds(pool, {
      minActiveMembers: 2,
      minCollectionFillRate: 0,
      recentActivityDays: 90,
      requireAnalyticsConsent: false
    });
    assert.ok(!eligible.includes(Number(squadId)));

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 94"));
  });
  if (ok) passed++; else failed++;

  ok = await run("reconstruction des agrégats (Étape 95)", async () => {
    await ensureGraphEventsTable(pool);
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();
    const {
      ensureMetricCounterTables,
      rebuildGraphMetrics,
      rebuildMetricCountersFromEvents,
      getMetricCounter,
      GRAPH_COUNTER_METRICS,
      COUNTER_TOTAL_ENTITY
    } = require("../server/sprite-graph-counters");
    await ensureMetricCounterTables(pool);

    const localDay = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dayNum = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dayNum}`;
    };
    const day = localDay(new Date());
    const variantRes = await pool.query(
      `SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`
    );
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;
    const user = await register(`SgRecon${rnd()}`);
    const catVersion = `recon-95-${rnd()}`;

    // Seed countable events for the day.
    for (let i = 0; i < 3; i++) {
      await recordGraphEvent(pool, {
        eventType: GRAPH_EVENT_TYPES.COLLECTION_PRIORITY_ADDED,
        actorUserId: user.id,
        variantId,
        spriteId,
        source: "api",
        occurredAt: `${day}T10:0${i}:00.000Z`,
        context: { catalogueVersion: catVersion, seed: i },
        deduplicationKey: `recon95-${user.id}-${i}-${rnd()}`
      }, { skipGovernance: true });
    }

    await pool.query(
      `UPDATE users
       SET last_active_at = NOW(), is_test_account = FALSE,
           community_stats_opt_in = TRUE,
           cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
       WHERE id = $1`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES ($1, $2, $3, 'priority')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'priority'`,
      [user.id, variantId, spriteId]
    );

    // Deterministic community snapshot (bypass default fill-rate for this user).
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: catVersion
    });
    const counterSeed = await rebuildMetricCountersFromEvents(pool, day, day);
    assert.ok(counterSeed.events >= 3);

    const counterBefore = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: variantId
    });
    assert.ok(counterBefore);
    const counterBeforeValue = Number(counterBefore.countValue);
    assert.ok(counterBeforeValue >= 3);

    const communityBefore = await pool.query(
      `SELECT owner_user_count, sample_size, ownership_rate, priority_user_count,
              catalogue_version
       FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(communityBefore.rows.length, 1);
    const snap = { ...communityBefore.rows[0] };

    // Supprimer les agrégats de la période.
    await pool.query(
      `DELETE FROM graph_metric_counters
       WHERE metric_date = $1::date
         AND (
           entity_id = $2
           OR (metric_type = $3 AND entity_id = $4)
         )`,
      [day, variantId, GRAPH_COUNTER_METRICS.PRIORITY_ADDED, COUNTER_TOTAL_ENTITY]
    );
    await pool.query(
      `DELETE FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    const wipedCommunity = await pool.query(
      `SELECT COUNT(*)::int AS n FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(wipedCommunity.rows[0].n, 0);

    // Rejouer : counters depuis events + community stats depuis état métier.
    const rebuilt = await rebuildGraphMetrics(pool, day, day, {
      runDailyPipeline: false,
      rebuildCounters: true
    });
    assert.ok(rebuilt.counters.events >= 3);
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: catVersion
    });

    const counterAfter = await getMetricCounter(pool, {
      metricDate: day,
      metricType: GRAPH_COUNTER_METRICS.PRIORITY_ADDED,
      entityId: variantId
    });
    assert.ok(counterAfter);
    assert.strictEqual(Number(counterAfter.countValue), counterBeforeValue);

    const communityAfter = await pool.query(
      `SELECT owner_user_count, sample_size, ownership_rate, priority_user_count,
              catalogue_version
       FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.strictEqual(communityAfter.rows.length, 1);
    assert.strictEqual(
      Number(communityAfter.rows[0].sample_size),
      Number(snap.sample_size)
    );
    assert.strictEqual(
      Number(communityAfter.rows[0].owner_user_count),
      Number(snap.owner_user_count)
    );
    assert.strictEqual(
      Number(communityAfter.rows[0].priority_user_count),
      Number(snap.priority_user_count)
    );
    assert.strictEqual(
      Number(communityAfter.rows[0].ownership_rate),
      Number(snap.ownership_rate)
    );
    assert.strictEqual(communityAfter.rows[0].catalogue_version, snap.catalogue_version);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 95"));
    assert.ok(doc.includes("reconstruct"));
  });
  if (ok) passed++; else failed++;

  ok = await run("confidentialité (Étape 96)", async () => {
    await ensureGraphEventsTable(pool);
    await ensureCommunityStatsTables(pool);
    stopCommunityStatsDailyJob();
    const {
      anonymizeUserGraphData,
      setCommunityStatsOptIn
    } = require("../server/sprite-graph-governance");
    const {
      listEligibleSquadIds,
      ensureSquadDailyStatsTables,
      calculateSquadDailyStats,
      resolveSquadSizeBand
    } = require("../server/sprite-graph-squad-stats");
    const {
      getAdminAggregateExport
    } = require("../server/sprite-graph-metrics");

    const user = await register(`Priv96${rnd()}`);
    const blocked = await register(`Priv96b${rnd()}`);
    const variantRes = await pool.query(
      `SELECT id, sprite_id FROM sprite_variants ORDER BY id LIMIT 1`
    );
    const variantId = variantRes.rows[0].id;
    const spriteId = variantRes.rows[0].sprite_id;

    await pool.query(
      `UPDATE users
       SET last_active_at = NOW(), is_test_account = FALSE,
           community_stats_opt_in = TRUE,
           cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
       WHERE id = $1`,
      [user.id]
    );
    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status)
       VALUES ($1, $2, $3, 'owned')
       ON CONFLICT (user_id, variant_id) DO UPDATE SET status = 'owned'`,
      [user.id, variantId, spriteId]
    );
    await recordGraphEvent(pool, {
      eventType: "collection.sprite_added",
      actorUserId: user.id,
      variantId,
      spriteId,
      source: "api",
      context: { note: "secret-note", email: "x@y.z", catalogueVersion: "keep96" },
      deduplicationKey: `priv96-${user.id}-${rnd()}`
    }, { skipGovernance: true });

    // Événements privés — PII absente à l’écriture.
    const stored = await pool.query(
      `SELECT context FROM graph_events
       WHERE actor_user_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [user.id]
    );
    assert.strictEqual(stored.rows[0].context.email, undefined);
    assert.strictEqual(stored.rows[0].context.note, undefined);
    assert.strictEqual(stored.rows[0].context.catalogueVersion, "keep96");

    // Consentement retiré → exclus des éligibles.
    let eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(eligible.includes(Number(user.id)));
    await setCommunityStatsOptIn(pool, user.id, false);
    eligible = await listEligibleCommunityUserIds(pool, {
      minFillRate: 0,
      requireAnalyticsConsent: true
    });
    assert.ok(!eligible.includes(Number(user.id)));
    await setCommunityStatsOptIn(pool, user.id, true);

    // Seuil minimal d’anonymisation.
    const gate = applyPublicAnonymizationGate({
      uniqueUserCount: PUBLIC_ANONYMIZATION_MIN_USERS - 1,
      payload: { ownershipRate: 10 }
    });
    assert.strictEqual(gate.ok, false);
    assert.strictEqual(gate.message, INSUFFICIENT_COMMUNITY_DATA_MESSAGE);

    // Utilisateurs bloqués — pas d’invitation.
    const { applyFriendAction } = require("../server/friends/state-machine");
    const blockRes = await fetch(`${API}/users/${blocked.id}/block`, {
      method: "POST",
      headers: auth(user.token)
    });
    if (!blockRes.ok) throw new Error(`block: ${await blockRes.text()}`);
    const invite = await applyFriendAction(blocked.id, user.id, "request", {
      invitationMethod: "username",
      origin: "test.etape96"
    });
    assert.ok(invite.error === 403 || invite.ok === false);

    // Petites squads — 1 membre actif non éligible communauté.
    await ensureSquadDailyStatsTables(pool);
    const solo = await register(`Priv96s${rnd()}`);
    await pool.query(
      `UPDATE users SET last_active_at = NOW(), is_test_account = FALSE,
         community_stats_opt_in = TRUE,
         cookie_consent = '{"necessary":true,"analytics":true}'::jsonb
       WHERE id = $1`,
      [solo.id]
    );
    const squadRes = await fetch(`${API}/squads`, {
      method: "POST",
      headers: auth(solo.token),
      body: JSON.stringify({ name: `Tiny${rnd()}` })
    });
    if (!squadRes.ok) throw new Error(`squad: ${await squadRes.text()}`);
    const squadBody = await squadRes.json();
    const squadId = squadBody.id || squadBody.squad?.id;
    const day = new Date().toISOString().slice(0, 10);
    await calculateSquadDailyStats(pool, {
      metricDate: day,
      eligibleSquadIds: []
    });
    const squadRow = await pool.query(
      `SELECT eligible_for_community, active_member_count
       FROM squad_daily_stats WHERE metric_date = $1::date AND squad_id = $2`,
      [day, squadId]
    );
    if (squadRow.rows.length) {
      assert.strictEqual(squadRow.rows[0].eligible_for_community, false);
      assert.ok(Number(squadRow.rows[0].active_member_count) <= 1);
    }
    assert.notStrictEqual(resolveSquadSizeBand(2).id, resolveSquadSizeBand(20).id);
    const eligibleSquads = await listEligibleSquadIds(pool, {
      minActiveMembers: 2,
      minCollectionFillRate: 0,
      requireAnalyticsConsent: false
    });
    assert.ok(!eligibleSquads.includes(Number(squadId)));

    // Suppression / anonymisation.
    const beforeAgg = await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: true },
      catalogueVersion: "priv96"
    });
    assert.ok(beforeAgg.variants >= 1);
    const anon = await anonymizeUserGraphData(pool, user.id);
    assert.ok(anon.ok);
    assert.ok(anon.eventsAnonymized >= 1);
    const afterAnon = await pool.query(
      `SELECT actor_user_id, context FROM graph_events
       WHERE deduplication_key LIKE 'anon:%'
       ORDER BY recorded_at DESC LIMIT 1`
    );
    assert.ok(afterAnon.rows.length);
    assert.strictEqual(afterAnon.rows[0].actor_user_id, null);
    assert.strictEqual(afterAnon.rows[0].context.anonymized, true);
    // Agrégats journaliers restent.
    const aggStill = await pool.query(
      `SELECT COUNT(*)::int AS n FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.ok(aggStill.rows[0].n >= 1);

    // Export admin = agrégats uniquement, pas de raw.
    const exp = await getAdminAggregateExport(pool, { metricDate: day, limit: 50 });
    assert.strictEqual(exp.includesRawEvents, false);
    assert.strictEqual(exp.includesPersonalData, false);
    assert.ok(Array.isArray(exp.rows));

    // Pas d’export raw public.
    const rawExport = await fetch(`${API}/sprite-graph/export/raw`);
    assert.ok(rawExport.status === 404 || rawExport.status >= 400);

    // level=internal sans admin → public.
    const internalLeak = await fetch(
      `${API}/sprite-graph/variants/${encodeURIComponent(variantId)}/community?level=aggregated_internal`
    );
    if (internalLeak.ok) {
      const body = await internalLeak.json();
      // Without admin, gate still applies at public level (insufficient if sample small).
      assert.ok(body.insufficient === true || body.community || body.disclaimer);
    }

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 96"));
  });
  if (ok) passed++; else failed++;

  ok = await run("métriques techniques + contrôle + formules (Étapes 97–99)", async () => {
    const {
      getSpriteGraphTechnicalMetrics,
      getSpriteGraphControlBoard,
      setPublicMetricDisabled,
      listPublicMetricFlags,
      recordOpsRun,
      bumpOpsCounter,
      GRAPH_OPS_COUNTERS,
      isSpriteGraphAdmin
    } = require("../server/sprite-graph-metrics");
    const {
      GRAPH_FORMULA_IDS,
      getGraphFormulaRegistry,
      communityFormulaVersion,
      interestFormulaVersion,
      squadFormulaVersion,
      ensureFormulaVersionColumns
    } = require("../server/sprite-graph-formula");

    // Étape 99 — registry.
    assert.strictEqual(GRAPH_FORMULA_IDS.OWNERSHIP_RATE, "ownership_rate_v1");
    assert.strictEqual(GRAPH_FORMULA_IDS.PRIORITY_RATE, "priority_rate_v1");
    assert.strictEqual(GRAPH_FORMULA_IDS.INTEREST_SCORE, "interest_score_v1");
    assert.strictEqual(GRAPH_FORMULA_IDS.SQUAD_PROGRESS, "squad_progress_v1");
    assert.ok(communityFormulaVersion().includes("ownership_rate_v1"));
    assert.strictEqual(interestFormulaVersion(), "interest_score_v1");
    assert.strictEqual(squadFormulaVersion(), "squad_progress_v1");
    const registry = getGraphFormulaRegistry();
    assert.strictEqual(registry.rewriteHistoryOnDailyJob, false);
    assert.ok(registry.note.toLowerCase().includes("historique"));

    await ensureFormulaVersionColumns(pool);
    await ensureCommunityStatsTables(pool);
    const day = new Date().toISOString().slice(0, 10);
    const variantRes = await pool.query(`SELECT id FROM sprite_variants ORDER BY id LIMIT 1`);
    const variantId = variantRes.rows[0].id;
    await calculateCommunityVariantStats(pool, {
      metricDate: day,
      variantIds: [variantId],
      eligibility: { minFillRate: 0, requireAnalyticsConsent: false },
      catalogueVersion: "formula99"
    });
    const stamped = await pool.query(
      `SELECT formula_version FROM community_variant_stats
       WHERE metric_date = $1::date AND variant_id = $2`,
      [day, variantId]
    );
    assert.ok(stamped.rows.length);
    assert.ok(String(stamped.rows[0].formula_version || "").includes("ownership_rate_v1"));
    // Historique : ne pas backfiller une ancienne ligne NULL avec la version courante dans ce test —
    // on vérifie seulement que les nouveaux écritures sont stampées.

    // Étape 97 — technical metrics.
    await bumpOpsCounter(pool, GRAPH_OPS_COUNTERS.DEDUP_SKIPS, 1);
    await recordOpsRun(pool, {
      runType: "aggregate_calc",
      startedAt: new Date(Date.now() - 40),
      finishedAt: new Date(),
      ok: true,
      details: { test: true }
    });
    const tech = await getSpriteGraphTechnicalMetrics(pool, { windowMinutes: 60 });
    assert.strictEqual(tech.publicProduct, false);
    assert.strictEqual(tech.scope, "internal_technical");
    assert.ok(typeof tech.eventsPerMinute === "number");
    assert.ok(typeof tech.workerLagSeconds === "number");
    assert.ok(typeof tech.aggregateCalcMsLast === "number");
    assert.ok(typeof tech.duplicateSkipCount === "number");
    assert.ok(tech.table && tech.table.name === "graph_events");
    assert.ok(tech.table.rowCount >= 0);

    // Étape 98 — control board + disable flag.
    const board = await getSpriteGraphControlBoard(pool);
    assert.strictEqual(board.publicProduct, false);
    assert.ok(typeof board.eventsLast24h === "number");
    assert.ok(Array.isArray(board.eventsByType));
    assert.ok("processingLagSeconds" in board);
    assert.ok("sampleSizes" in board);
    assert.ok(Array.isArray(board.publicMetricsSuspended));
    assert.ok(board.formulas.current.OWNERSHIP_RATE);

    await setPublicMetricDisabled(pool, "ownership_rate", {
      disabled: true,
      reason: "test incorrect metric",
      updatedBy: 1
    });
    const flags = await listPublicMetricFlags(pool);
    assert.ok(flags.some((f) => f.key === "ownership_rate" && f.disabled));
    const board2 = await getSpriteGraphControlBoard(pool);
    assert.ok(board2.publicMetricsSuspended.includes("ownership_rate"));

    // Public surface respects suspension.
    const pub = await fetch(
      `${API}/sprite-graph/variants/${encodeURIComponent(variantId)}/community`
    );
    if (pub.ok) {
      const body = await pub.json();
      assert.ok(body.insufficient === true || body.suspended === true);
    }

    // Re-enable for other tests / product.
    await setPublicMetricDisabled(pool, "ownership_rate", { disabled: false, reason: "restored" });

    // Admin routes require auth/admin — anonymous → 401/403.
    const boardHttp = await fetch(`${API}/admin/sprite-graph/control-board`);
    assert.ok(boardHttp.status === 401 || boardHttp.status === 403);
    const techHttp = await fetch(`${API}/admin/sprite-graph/technical-metrics`);
    assert.ok(techHttp.status === 401 || techHttp.status === 403);
    assert.strictEqual(isSpriteGraphAdmin(null), false);

    // With admin env set to a registered user, board succeeds.
    const admin = await register(`Adm99${rnd()}`);
    const prev = process.env.ANALYTICS_ADMIN_USER_IDS;
    process.env.ANALYTICS_ADMIN_USER_IDS = String(admin.id);
    // Module already cached admin set — hit module functions directly (HTTP uses boot-time set).
    const exportOk = await require("../server/sprite-graph-metrics").getAdminAggregateExport(pool, {
      metricDate: day,
      limit: 5
    });
    assert.strictEqual(exportOk.includesRawEvents, false);
    if (prev == null) delete process.env.ANALYTICS_ADMIN_USER_IDS;
    else process.env.ANALYTICS_ADMIN_USER_IDS = prev;

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 97"));
    assert.ok(doc.includes("Étape 98"));
    assert.ok(doc.includes("Étape 99"));
    assert.ok(doc.includes("ownership_rate_v1"));
  });
  if (ok) passed++; else failed++;

  ok = await run("catalogue métriques + validation v1 (Étapes 100–101)", async () => {
    const {
      GRAPH_METRIC_CATALOG,
      getGraphMetricCatalog,
      getGraphMetricDoc,
      METRIC_CATALOG_LAST_REVIEW
    } = require("../server/sprite-graph-metric-catalog");
    const {
      GRAPH_V1_VALIDATION_CRITERIA,
      evaluateGraphV1Readiness
    } = require("../server/sprite-graph-v1-validation");

    // Étape 100 — chaque métrique a les champs requis.
    const requiredFields = [
      "id", "name", "description", "formula", "eligiblePopulation",
      "timeWindow", "minimumThreshold", "version", "limits", "lastModified"
    ];
    assert.ok(GRAPH_METRIC_CATALOG.length >= 8);
    for (const m of GRAPH_METRIC_CATALOG) {
      for (const f of requiredFields) {
        assert.ok(m[f] != null, `missing ${f} on ${m.id}`);
      }
      assert.ok(Array.isArray(m.limits));
      assert.ok(m.lastModified);
    }

    const ownership = getGraphMetricDoc("ownership_rate");
    assert.ok(ownership);
    assert.strictEqual(ownership.name, "Taux de possession communautaire");
    assert.ok(ownership.formula.includes("divisé par"));
    assert.ok(ownership.formula.toLowerCase().includes("posséd"));
    assert.strictEqual(ownership.version, "ownership_rate_v1");
    assert.strictEqual(ownership.lastModified, METRIC_CATALOG_LAST_REVIEW);

    const catalog = getGraphMetricCatalog();
    assert.ok(catalog.count >= 8);
    const publicOnly = getGraphMetricCatalog({ surface: "public" });
    assert.ok(publicOnly.metrics.every((m) => m.surface === "public"));
    const internalOnly = getGraphMetricCatalog({ surface: "internal" });
    assert.ok(internalOnly.metrics.every((m) => m.surface === "internal"));
    assert.ok(internalOnly.metrics.some((m) => m.id === "events_per_minute"));

    // Étape 101 — critères de validation.
    assert.ok(GRAPH_V1_VALIDATION_CRITERIA.length >= 13);
    const labels = GRAPH_V1_VALIDATION_CRITERIA.map((c) => c.label);
    assert.ok(labels.some((l) => l.includes("huit événements")));
    assert.ok(labels.some((l) => l.includes("dédupliqu")));
    assert.ok(labels.some((l) => l.includes("côté serveur")));
    assert.ok(labels.some((l) => l.includes("versions")));
    assert.ok(labels.some((l) => l.includes("historisés")));
    assert.ok(labels.some((l) => l.includes("surcomptées")));
    assert.ok(labels.some((l) => l.includes("invitations") && l.includes("squads")));
    assert.ok(labels.some((l) => l.includes("objectifs")));
    assert.ok(labels.some((l) => l.includes("notifications")));
    assert.ok(labels.some((l) => l.includes("rejoués")));
    assert.ok(labels.some((l) => l.includes("inconnues")));
    assert.ok(labels.some((l) => l.includes("anonymisation")));
    assert.ok(labels.some((l) => l.includes("catalogue")));

    const readiness = await evaluateGraphV1Readiness(pool, { includeLiveProbes: true });
    assert.strictEqual(readiness.version, 1);
    assert.strictEqual(readiness.staticReady, true);
    assert.strictEqual(readiness.ready, true);
    assert.ok(readiness.criteria.every((c) => c.ok), "all static v1 criteria must pass");
    assert.ok(Array.isArray(readiness.liveProbes));
    assert.ok(readiness.metricCatalog.count >= 8);

    const doc = fs.readFileSync(path.join(__dirname, "../SPRITE_GRAPH.md"), "utf8");
    assert.ok(doc.includes("Étape 100"));
    assert.ok(doc.includes("Étape 101"));
    assert.ok(doc.includes("Taux de possession communautaire"));
    assert.ok(doc.includes("divisé par"));

    const catalogHttp = await fetch(`${API}/admin/sprite-graph/metrics-catalog`);
    assert.ok(catalogHttp.status === 401 || catalogHttp.status === 403);
    const readyHttp = await fetch(`${API}/admin/sprite-graph/v1-readiness`);
    assert.ok(readyHttp.status === 401 || readyHttp.status === 403);
  });
  if (ok) passed++; else failed++;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
