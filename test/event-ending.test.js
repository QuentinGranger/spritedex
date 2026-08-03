// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Étape 67 wanted_event_ending_soon integration tests
// Needs a live server + DATABASE_URL (same DB as the API).
// ─────────────────────────────────────────────────────────────────
require("dotenv").config();

const assert = require("node:assert");
const { pool } = require("../server/db");
const ending = require("../server/notification-event-ending");
const scheduler = require("../server/notification-event-ending-scheduler");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

function rnd() {
  return Math.random().toString(36).slice(2, 10);
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
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, email, username };
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, {
    method: "DELETE",
    headers: auth(user.token)
  }).catch(() => {});
}

async function setEntry(user, variantId, status, priority) {
  const body = { status };
  if (priority) body.priority = priority;
  const res = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(user.token),
    body: JSON.stringify(body)
  });
  assert.ok(res.ok, `setEntry failed: ${await res.text()}`);
}

async function listNotifications(user) {
  const res = await fetch(`${API}/notifications`, { headers: auth(user.token) });
  assert.strictEqual(res.status, 200, `notifications failed: ${res.status}`);
  return res.json();
}

async function pickVariant(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  assert.strictEqual(res.status, 200, `sprites failed: ${res.status}`);
  const { sprites } = await res.json();
  for (const sprite of sprites || []) {
    for (const variant of Object.values(sprite.variantDetails || {})) {
      if (variant?.id && (variant.spriteId || sprite.id)) {
        return {
          variantId: variant.id,
          spriteId: variant.spriteId || sprite.id,
          variantName: variant.name || variant.id
        };
      }
    }
  }
  assert.fail("no catalog variant available");
}

async function upsertEvent({ id, name, endDate }) {
  await pool.query(
    `INSERT INTO events (id, name, end_date, data_status)
     VALUES ($1, $2, $3::date, 'complete')
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       end_date = EXCLUDED.end_date,
       data_status = 'complete',
       updated_at = NOW()`,
    [id, name, endDate]
  );
}

async function upsertPeriod({ id, spriteId, eventId, endDate, confidence, status = "available" }) {
  await pool.query(
    `INSERT INTO availability_periods
       (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, 'complete', '[]'::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       end_date = EXCLUDED.end_date,
       status = EXCLUDED.status,
       event_id = EXCLUDED.event_id,
       confidence = EXCLUDED.confidence,
       data_status = 'complete',
       updated_at = NOW()`,
    [id, spriteId, "2026-07-01T00:00:00.000Z", endDate, status, eventId, confidence]
  );
}

async function deleteFixtures({ eventIds = [], periodIds = [] }) {
  if (periodIds.length) {
    await pool.query(`DELETE FROM availability_periods WHERE id = ANY($1::text[])`, [periodIds]);
  }
  if (eventIds.length) {
    await pool.query(`DELETE FROM events WHERE id = ANY($1::text[])`, [eventIds]);
  }
}

function daysFromNow(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function dateOnly(iso) {
  return String(iso).slice(0, 10);
}

async function emitEnding({ eventId, eventName, variantId, endDate, confidence, threshold }) {
  await ending.handleCatalogueEventEndingSoon({
    eventId: `catalogue.event_ending_soon:${eventId}:${threshold}:${dateOnly(endDate)}:${rnd()}`,
    entityType: "event",
    entityId: eventId,
    occurredAt: new Date().toISOString(),
    context: {
      eventId,
      eventName,
      variantIds: [variantId],
      endDate,
      endingAt: endDate,
      endDateConfidence: confidence,
      confidence,
      threshold
    }
  });
}

async function run() {
  console.log(`\nRunning SPRITE-INDEX event-ending tests against ${BASE}\n`);

  const probe = await fetch(`${API}/sprites`).catch(() => null);
  if (!probe || !probe.ok) {
    console.error("Server not reachable — start with: node server.js");
    process.exit(1);
  }

  await test("wanted_event_ending_soon notification (Étape 67)", async () => {
    const user = await register(`EvE67${rnd()}`);
    const eventIds = [];
    const periodIds = [];

    try {
      const { variantId, spriteId } = await pickVariant(user.token);
      const eventId = `test_e67_${rnd()}`;
      const periodId = `test_e67_p_${rnd()}`;
      eventIds.push(eventId);
      periodIds.push(periodId);

      // Noon UTC keeps the civil date stable across Paris/UTC for DATE columns.
      const endDay = dateOnly(daysFromNow(2.5));
      const endIn3d = `${endDay}T12:00:00.000Z`;
      await upsertEvent({ id: eventId, name: "Étape 67 Event", endDate: endDay });
      await upsertPeriod({
        id: periodId,
        spriteId,
        eventId,
        endDate: endIn3d,
        confidence: "official",
        status: "available"
      });

      await setEntry(user, variantId, "priority", "urgent");

      // Unconfirmed end date → scheduler / handler must not affirm.
      const untrusted = await scheduler.processEventEndingAlert(
        {
          id: eventId,
          name: "Étape 67 Event",
          endDate: endIn3d,
          confidence: "estimated"
        },
        new Date()
      );
      assert.strictEqual(untrusted.emitted, false);
      assert.strictEqual(untrusted.skippedReason, "end_date_untrusted");

      await emitEnding({
        eventId,
        eventName: "Étape 67 Event",
        variantId,
        endDate: endIn3d,
        confidence: "estimated",
        threshold: "3d"
      });
      let notifs = await listNotifications(user);
      assert.ok(
        !notifs.notifications.some((n) => n.type === "wanted_event_ending_soon"),
        "unconfirmed end date must not create an alert"
      );

      // Trusted 3d threshold → alert for remaining priority.
      await emitEnding({
        eventId,
        eventName: "Étape 67 Event",
        variantId,
        endDate: endIn3d,
        confidence: "official",
        threshold: "3d"
      });
      notifs = await listNotifications(user);
      const hits = notifs.notifications.filter((n) => n.type === "wanted_event_ending_soon");
      assert.strictEqual(hits.length, 1, "trusted 3d threshold should notify once");
      assert.strictEqual(String(hits[0].entity_id || hits[0].entity?.id), eventId);
      assert.ok(Number(hits[0].data?.remainingCount) >= 1, "payload should list remaining priorities");
      assert.ok(hits[0].data?.timeZone || hits[0].data?.timezone, "timezone should be attached");

      // Priority already obtained → excluded from recipients / cancel path.
      await setEntry(user, variantId, "owned");
      const checkOwned = await ending.revalidateWantedEventBeforeSend({
        recipientId: user.id,
        eventId,
        scheduledEndingAt: endIn3d,
        candidateVariantIds: [variantId]
      });
      assert.strictEqual(checkOwned.ok, false);
      assert.strictEqual(checkOwned.reason, "no_remaining_priority");
      assert.strictEqual(checkOwned.cancel, true);

      const cancelled = await scheduler.cancelStaleWantedEventNotifications();
      assert.ok(cancelled >= 0, "cancel sweep should run");
      notifs = await listNotifications(user);
      assert.ok(
        !notifs.notifications.some((n) => n.type === "wanted_event_ending_soon"),
        "alert must disappear once nothing priority remains"
      );

      // Fresh alert, then event prolonged (end date moved) → cancel.
      await setEntry(user, variantId, "priority", "urgent");
      // New event id so dedupe does not block the second create.
      const eventId2 = `test_e67b_${rnd()}`;
      const periodId2 = `test_e67b_p_${rnd()}`;
      eventIds.push(eventId2);
      periodIds.push(periodId2);
      const endSoonDay = dateOnly(daysFromNow(2.2));
      const endSoon = `${endSoonDay}T12:00:00.000Z`;
      await upsertEvent({ id: eventId2, name: "Étape 67 Extended", endDate: endSoonDay });
      await upsertPeriod({
        id: periodId2,
        spriteId,
        eventId: eventId2,
        endDate: endSoon,
        confidence: "confirmed",
        status: "available"
      });
      await emitEnding({
        eventId: eventId2,
        eventName: "Étape 67 Extended",
        variantId,
        endDate: endSoon,
        confidence: "confirmed",
        threshold: "3d"
      });
      notifs = await listNotifications(user);
      assert.ok(
        notifs.notifications.some(
          (n) => n.type === "wanted_event_ending_soon" && String(n.entity_id || n.entity?.id) === eventId2
        ),
        "second event should notify"
      );

      const prolongedDay = dateOnly(daysFromNow(20));
      const prolonged = `${prolongedDay}T12:00:00.000Z`;
      await upsertEvent({ id: eventId2, name: "Étape 67 Extended", endDate: prolongedDay });
      await upsertPeriod({
        id: periodId2,
        spriteId,
        eventId: eventId2,
        endDate: prolonged,
        confidence: "confirmed",
        status: "available"
      });
      const checkExtended = await ending.revalidateWantedEventBeforeSend({
        recipientId: user.id,
        eventId: eventId2,
        scheduledEndingAt: endSoon,
        candidateVariantIds: [variantId]
      });
      assert.strictEqual(checkExtended.ok, false);
      assert.strictEqual(checkExtended.reason, "end_date_changed");

      await scheduler.cancelStaleWantedEventNotifications();
      notifs = await listNotifications(user);
      assert.ok(
        !notifs.notifications.some(
          (n) => n.type === "wanted_event_ending_soon" && String(n.entity_id || n.entity?.id) === eventId2
        ),
        "prolonged event must cancel the scheduled ending alert"
      );

      // Scheduler classifies thresholds for trusted rows (smoke).
      const in24h = daysFromNow(0.5);
      const classified = await scheduler.processEventEndingAlert(
        {
          id: eventId,
          name: "Étape 67 Event",
          endDate: in24h,
          confidence: "official"
        },
        new Date()
      );
      assert.strictEqual(classified.thresholdId, "24h");
      assert.strictEqual(classified.emitted, true);
    } finally {
      await deleteFixtures({ eventIds, periodIds }).catch(() => {});
      await cleanup(user);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
