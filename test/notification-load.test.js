// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Étape 69 notification load / scale tests
//
// Pure (no live server) scale checks for hot notification paths.
// Defaults stay CI-friendly; raise via env for heavier runs:
//   LOAD_FRIENDS, LOAD_SQUAD_ITEMS, LOAD_VARIANTS, LOAD_EVENT_USERS,
//   LOAD_ACQUISITIONS, LOAD_BUDGET_MS
// ─────────────────────────────────────────────────────────────────
const assert = require("node:assert");

const gates = require("../server/notification-gates");
const grouping = require("../server/notification-grouping");
const dedupe = require("../server/notification-dedupe");
const catalog = require("../server/notification-catalog");
const pushSubscriptions = require("../server/push-subscriptions");
const deliveryQueue = require("../server/notification-delivery-queue");
const { claimDedupeKey } = require("../server/event-idempotency");

const FRIENDS = Math.max(50, Number(process.env.LOAD_FRIENDS) || 250);
const SQUAD_ITEMS = Math.max(20, Number(process.env.LOAD_SQUAD_ITEMS) || 120);
const VARIANTS = Math.max(10, Number(process.env.LOAD_VARIANTS) || 40);
const EVENT_USERS = Math.max(500, Number(process.env.LOAD_EVENT_USERS) || 2500);
const ACQUISITIONS = Math.max(20, Number(process.env.LOAD_ACQUISITIONS) || 80);
const BUDGET_MS = Math.max(200, Number(process.env.LOAD_BUDGET_MS) || 2500);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name} (${Date.now() - started}ms)\n      ${err.message}`);
  }
}

function assertUnderBudget(started, label) {
  const elapsed = Date.now() - started;
  assert.ok(elapsed <= BUDGET_MS, `${label} took ${elapsed}ms (budget ${BUDGET_MS}ms)`);
  return elapsed;
}

/** In-memory stand-in for notification_event_processing uniqueness. */
function memoryClaimPool() {
  const claimed = new Set();
  return {
    async query(sql, params) {
      if (/INSERT INTO notification_event_processing/i.test(sql)) {
        const key = `${params[0]}|${params[1]}|${params[2]}`;
        if (claimed.has(key)) return { rows: [] };
        claimed.add(key);
        return { rows: [{ event_id: params[0] }] };
      }
      return { rows: [] };
    },
    _size: () => claimed.size
  };
}

async function run() {
  console.log("\nRunning SPRITE-INDEX notification load tests (Étape 69)\n");
  console.log(
    `  scale: friends=${FRIENDS} squadItems=${SQUAD_ITEMS} variants=${VARIANTS}` +
      ` eventUsers=${EVENT_USERS} acquisitions=${ACQUISITIONS} budget=${BUDGET_MS}ms\n`
  );

  await test("many-friends acquisition fan-out stays bounded (Étape 69)", async () => {
    const started = Date.now();
    const actorId = 1;
    const variantId = "sprite_load_variant";
    const collectionVersion = "2026-07-26T10:00:00.000Z";

    // Simulate a dense friend graph: mix of priority / missing / owned / unknown.
    const friends = Array.from({ length: FRIENDS }, (_, i) => {
      const mod = i % 7;
      const status = mod === 0 ? "priority" : mod === 1 || mod === 2 ? "missing" : mod === 3 ? "owned" : "unknown";
      return { friendId: 1000 + i, status };
    });

    const eligible = [];
    for (const f of friends) {
      const level = gates.resolveAcquisitionPriority(f.status);
      if (!level) continue;
      eligible.push({ ...f, priorityLevel: level });
    }
    assert.ok(eligible.length > 0, "expected some eligible friends");
    assert.ok(eligible.length < friends.length, "owned/unknown friends must be filtered out");

    const pool = memoryClaimPool();
    let created = 0;
    for (const f of eligible) {
      const key = gates.buildFriendAcquiredDedupeKey(actorId, f.friendId, variantId, collectionVersion);
      assert.ok(key, "dedupe key required");
      if (await claimDedupeKey(pool, key, catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT, f.friendId)) {
        created++;
      }
      // Re-claim must collapse.
      assert.strictEqual(
        await claimDedupeKey(pool, key, catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT, f.friendId),
        false
      );
    }
    assert.strictEqual(created, eligible.length);
    assertUnderBudget(started, "many-friends fan-out");
  });

  await test("very active squad progress grouping stays O(n) (Étape 69)", async () => {
    const started = Date.now();
    const squadId = "squad_load_bravo";
    let rate = 10;
    const items = [];
    for (let i = 0; i < SQUAD_ITEMS; i++) {
      const previousRate = rate;
      rate = Math.min(100, rate + 0.7);
      const milestone = gates.crossedSquadMilestone(previousRate, rate);
      items.push({
        eventId: `s${i}`,
        occurredAt: new Date(Date.UTC(2026, 6, 26, 8, 0, i)).toISOString(),
        previousRate,
        newRate: rate,
        newCoveredCount: 20 + i,
        milestone,
        newVariantIds: [`v_${i}`],
        actorName: `Member${i % 17}`,
        variantName: `Variant ${i}`
      });
    }

    const group = grouping.buildSquadProgressGroup({
      squadId,
      items,
      destination: "/squad/BRAVO/engine"
    });
    assert.strictEqual(group.groupKey, `squad_progress:${squadId}`);
    assert.strictEqual(group.eventCount, SQUAD_ITEMS);
    assert.strictEqual(group.firstEvent.id, "s0");
    assert.strictEqual(group.mostRecent.id, `s${SQUAD_ITEMS - 1}`);
    assert.ok(group.principalElements.length >= 1);

    // Immediate flush rule must stay cheap to evaluate across the batch.
    let immediate = 0;
    for (const it of items) {
      if (gates.isSquadImmediatePush({ milestone: it.milestone })) immediate++;
    }
    assert.ok(immediate >= 0);
    assertUnderBudget(started, "active squad grouping");
  });

  await test("catalogue update fans out across many variants without duplicate claims (Étape 69)", async () => {
    const started = Date.now();
    const priorityRecipients = Array.from({ length: 60 }, (_, i) => 5000 + i);
    const pool = memoryClaimPool();
    let creates = 0;
    let skippedUntrusted = 0;
    let skippedBadTransition = 0;

    for (let v = 0; v < VARIANTS; v++) {
      const variantId = `sprite_catalog_${v}`;
      const periodId = `period_wave_${Math.floor(v / 5)}`; // shared periods across small batches
      const confidence = v % 11 === 0 ? "estimated" : "official";
      const previousStatus = v % 13 === 0 ? "available_now" : "upcoming";

      if (!gates.isTrustedAvailabilityConfidence(confidence)) {
        skippedUntrusted++;
        continue;
      }
      if (!gates.isVariantAvailableTransition(previousStatus, "available_now")) {
        skippedBadTransition++;
        continue;
      }

      for (const recipientId of priorityRecipients) {
        const key = gates.buildPriorityVariantAvailableDedupeKey(recipientId, variantId, periodId);
        if (await claimDedupeKey(pool, key, catalog.NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE, recipientId)) {
          creates++;
        }
      }
    }

    assert.ok(creates > 0, "trusted available transitions should create alerts");
    assert.ok(skippedUntrusted > 0, "untrusted confidences must be skipped");
    assert.ok(skippedBadTransition > 0, "non-transitions must be skipped");
    // Same period + recipient + variant never double-creates.
    assert.strictEqual(pool._size(), creates);
    assertUnderBudget(started, "catalogue multi-variant fan-out");
  });

  await test("event ending for thousands of users stays single-notif per user (Étape 69)", async () => {
    const started = Date.now();
    const eventId = "event_load_finale";
    const threshold = "3d";
    const endingAt = "2026-08-01T12:00:00.000Z";
    const remainingVariants = ["v_a", "v_b", "v_c", "v_d", "v_e"];
    const pool = memoryClaimPool();

    let notified = 0;
    for (let u = 0; u < EVENT_USERS; u++) {
      const recipientId = 900000 + u;
      const hasStrong = u % 20 === 0;
      const gate = gates.isWantedEventThresholdAllowed({
        thresholdId: threshold,
        hasStrongPriority: hasStrong
      });
      // Default 3d is allowed for everyone.
      assert.ok(gate.ok);

      const dedupeKey = gates.buildWantedEventEndingDedupeKey(recipientId, eventId, threshold);
      assert.ok(dedupeKey);

      if (!(await claimDedupeKey(pool, dedupeKey, catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON, recipientId))) {
        continue;
      }

      const group = grouping.buildEventDeadlineGroup({
        eventId,
        recipientId,
        threshold,
        endingAt,
        domainEventId: `catalogue.event_ending_soon:${eventId}:${threshold}:2026-08-01`,
        variantIds: remainingVariants,
        destination: `/events/${eventId}?filter=priority`
      });
      assert.strictEqual(group.eventCount, 1);
      assert.strictEqual(group.principalElements.length, remainingVariants.length);

      // Re-tick must not notify again.
      assert.strictEqual(
        await claimDedupeKey(pool, dedupeKey, catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON, recipientId),
        false
      );
      notified++;
    }

    assert.strictEqual(notified, EVENT_USERS);
    assert.strictEqual(pool._size(), EVENT_USERS);
    assertUnderBudget(started, "event-ending thousand-user fan-out");
  });

  await test("many acquisitions collapse into one grouped notification (Étape 69)", async () => {
    const started = Date.now();
    const actorId = 42;
    const recipientId = 99;
    const variants = Array.from({ length: ACQUISITIONS }, (_, i) => ({
      eventId: `acq_${i}`,
      variantId: `sprite_batch_${i}`,
      variantName: `Batch ${i}`,
      acquiredAt: new Date(Date.UTC(2026, 6, 26, 9, 0, i)).toISOString(),
      priorityLevel: i % 9 === 0 ? "strong" : "normal",
      recipientStatus: i % 9 === 0 ? "priority" : "missing"
    }));

    const group = grouping.buildFriendAcquisitionsGroup({
      actorId,
      recipientId,
      variants,
      destination: `/compare/${actorId}?variantId=${variants[variants.length - 1].variantId}`
    });
    assert.strictEqual(group.groupKey, `friend_acquisitions:${actorId}:${recipientId}`);
    assert.strictEqual(group.eventCount, ACQUISITIONS);
    assert.strictEqual(group.principalElements.length, ACQUISITIONS);
    assert.strictEqual(group.firstEvent.id, "acq_0");
    assert.strictEqual(group.mostRecent.id, `acq_${ACQUISITIONS - 1}`);

    const rendered = catalog.renderNotification(
      catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
      grouping.attachGroup(
        {
          actorName: "LoadActor",
          friendId: String(actorId),
          variantId: variants[0].variantId,
          variantName: variants[0].variantName,
          highlightName: variants.find((v) => v.priorityLevel === "strong")?.variantName,
          count: ACQUISITIONS,
          variantIds: variants.map((v) => v.variantId),
          priorityLevel: "strong",
          recipientCollectionStatus: "priority"
        },
        group
      ),
      "fr"
    );
    assert.ok(String(rendered.body).includes(String(ACQUISITIONS)));
    assert.strictEqual(rendered.data.group.eventCount, ACQUISITIONS);
    assert.strictEqual(rendered.data.count, ACQUISITIONS);
    assertUnderBudget(started, "acquisition regrouping");
  });

  await test("push provider failure retries then recovers; permanent errors stop retries (Étape 69)", async () => {
    const started = Date.now();

    // Transient vs permanent classification.
    assert.ok(!pushSubscriptions.isPermanentProviderFailure({ statusCode: 500 }));
    assert.ok(!pushSubscriptions.isPermanentProviderFailure({ statusCode: 503, error: "timeout" }));
    assert.ok(pushSubscriptions.isPermanentProviderFailure({ statusCode: 410, expired: true }));
    assert.ok(pushSubscriptions.isPermanentProviderFailure({ statusCode: 404 }));
    assert.ok(pushSubscriptions.isPermanentProviderFailure({ error: "NotRegistered" }));

    // Retry ledger with exponential backoff, then success after recovery.
    const updates = [];
    const pool = {
      async query(sql, params) {
        updates.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
        return { rows: [], rowCount: 1 };
      }
    };

    const job = {
      id: 77,
      attempts: 1,
      max_attempts: deliveryQueue.DEFAULT_MAX_ATTEMPTS
    };

    let outcome = await deliveryQueue.markJobRetryOrFail(pool, job, "provider_503");
    assert.strictEqual(outcome, "retry");
    assert.ok(
      updates.some((u) => /available_at/i.test(u.sql)),
      "retry must reschedule available_at"
    );

    // Exhaust attempts → failed (no infinite loop under load).
    updates.length = 0;
    outcome = await deliveryQueue.markJobRetryOrFail(
      pool,
      {
        id: 78,
        attempts: deliveryQueue.DEFAULT_MAX_ATTEMPTS,
        max_attempts: deliveryQueue.DEFAULT_MAX_ATTEMPTS
      },
      "still_down"
    );
    assert.strictEqual(outcome, "failed");

    // After a transient outage, a fresh delivery job can complete (recovery).
    updates.length = 0;
    await deliveryQueue.markJobDone(pool, 79);
    assert.ok(updates.some((u) => /status = \$2/i.test(u.sql) || u.params.includes(deliveryQueue.QUEUE_STATUSES.DONE)));

    // Permanent failure path: deactivate subscription + cancel push-only jobs (SQL shape).
    updates.length = 0;
    const deactivatePool = {
      async query(sql, params) {
        updates.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
        if (/UPDATE push_subscriptions/i.test(sql) && /is_active = FALSE/i.test(sql)) {
          return {
            rows: [{ id: "11111111-1111-1111-1111-111111111111", user_id: 9, endpoint: "https://push/x" }],
            rowCount: 1
          };
        }
        if (/SELECT COUNT/i.test(sql)) return { rows: [{ c: 0 }], rowCount: 1 };
        if (/UPDATE users/i.test(sql)) return { rows: [], rowCount: 1 };
        if (/notification_delivery_queue/i.test(sql)) return { rows: [], rowCount: 2 };
        // ensurePushSubscriptionsTable DDL
        return { rows: [], rowCount: 0 };
      }
    };
    const deactivated = await pushSubscriptions.deactivateInvalidSubscription(deactivatePool, {
      endpoint: "https://push/x",
      reason: "gone"
    });
    assert.strictEqual(deactivated.deactivated, true);
    assert.ok(
      updates.some((u) => /notification_delivery_queue/i.test(u.sql) && /subscription_invalid/i.test(u.sql)),
      "dead token must cancel pending push jobs"
    );

    assertUnderBudget(started, "push failure recovery");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
