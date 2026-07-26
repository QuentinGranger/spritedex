// ─────────────────────────────────────────────────────────────────
// SPRITNEX — Étape 66 priority_variant_available integration tests
// Needs a live server + DATABASE_URL (same DB as the API).
// ─────────────────────────────────────────────────────────────────
require("dotenv").config();

const assert = require("node:assert");
const { pool } = require("../server/db");
const variantAvail = require("../server/notification-variant-available");

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

async function setEntry(user, variantId, status) {
  const res = await fetch(`${API}/collection/${user.id}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(user.token),
    body: JSON.stringify({ status })
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
          variantName: variant.name || variant.id,
          variantType: variant.variantType || variant.type || null
        };
      }
    }
    if (sprite.variantIds?.[0]) {
      return {
        variantId: sprite.variantIds[0],
        spriteId: sprite.id,
        variantName: sprite.name || sprite.variantIds[0],
        variantType: null
      };
    }
  }
  assert.fail("no catalog variant available");
}

async function upsertPeriod({ id, spriteId, startDate, endDate, status, confidence }) {
  await pool.query(
    `INSERT INTO availability_periods
       (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, 'complete', '[]'::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       status = EXCLUDED.status,
       confidence = EXCLUDED.confidence,
       data_status = 'complete',
       updated_at = NOW()`,
    [id, spriteId, startDate, endDate, status, null, confidence]
  );
}

async function deletePeriods(ids) {
  if (!ids.length) return;
  await pool.query(`DELETE FROM availability_periods WHERE id = ANY($1::text[])`, [ids]);
}

function makeEvent({ variantId, variantName, previousStatus, newStatus, confidence, periodId }) {
  return {
    eventId: `e66_${rnd()}`,
    eventType: "catalogue.variant_available",
    entityType: "sprite_variant",
    entityId: variantId,
    occurredAt: new Date().toISOString(),
    context: {
      previousStatus,
      newStatus,
      confidence,
      availabilityPeriodId: periodId,
      availableFrom: "2026-07-01T00:00:00.000Z",
      availableUntil: "2099-12-31T23:59:59.000Z",
      variantId,
      variantName
    }
  };
}

async function run() {
  console.log(`\nRunning SPRITNEX priority availability tests against ${BASE}\n`);

  const probe = await fetch(`${API}/sprites`).catch(() => null);
  if (!probe || !probe.ok) {
    console.error("Server not reachable — start with: node server.js");
    process.exit(1);
  }

  await test("priority_variant_available notification (Étape 66)", async () => {
    const priorityUser = await register(`PvE66Prio${rnd()}`);
    const missingUser = await register(`PvE66Miss${rnd()}`);
    const ownedUser = await register(`PvE66Own${rnd()}`);
    const periodIds = [];

    try {
      const { variantId, spriteId, variantName } = await pickVariant(priorityUser.token);

      await setEntry(priorityUser, variantId, "priority");
      await setEntry(missingUser, variantId, "missing");
      await setEntry(ownedUser, variantId, "owned");

      const periodA = `test_e66_a_${rnd()}`;
      const periodB = `test_e66_b_${rnd()}`;
      periodIds.push(periodA, periodB);

      await upsertPeriod({
        id: periodA,
        spriteId,
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2099-12-31T23:59:59.000Z",
        status: "available",
        confidence: "official"
      });
      await upsertPeriod({
        id: periodB,
        spriteId,
        startDate: "2027-01-01T00:00:00.000Z",
        endDate: "2099-12-31T23:59:59.000Z",
        status: "available",
        confidence: "confirmed"
      });

      // Untrusted confidence → no automatic alert.
      await variantAvail.handleCatalogueVariantAvailable(makeEvent({
        variantId,
        variantName,
        previousStatus: "upcoming",
        newStatus: "available_now",
        confidence: "estimated",
        periodId: periodA
      }));
      let notifs = await listNotifications(priorityUser);
      assert.ok(
        !notifs.notifications.some((n) => n.type === "priority_variant_available"),
        "untrusted confidence must not notify"
      );

      // Invalid transition (already available) → no alert.
      await variantAvail.handleCatalogueVariantAvailable(makeEvent({
        variantId,
        variantName,
        previousStatus: "available_now",
        newStatus: "available_now",
        confidence: "official",
        periodId: periodA
      }));
      notifs = await listNotifications(priorityUser);
      assert.ok(
        !notifs.notifications.some((n) => n.type === "priority_variant_available"),
        "non-transition must not notify"
      );

      // Trusted upcoming → available_now: only priority recipients.
      await variantAvail.handleCatalogueVariantAvailable(makeEvent({
        variantId,
        variantName,
        previousStatus: "upcoming",
        newStatus: "available_now",
        confidence: "official",
        periodId: periodA
      }));

      notifs = await listNotifications(priorityUser);
      const hits = notifs.notifications.filter((n) => n.type === "priority_variant_available");
      assert.strictEqual(hits.length, 1, "priority user should get exactly one alert");
      assert.strictEqual(String(hits[0].entity_id || hits[0].entity?.id), String(variantId));
      assert.strictEqual(hits[0].data?.confidence, "official");
      assert.strictEqual(String(hits[0].data?.availabilityPeriodId), periodA);

      notifs = await listNotifications(missingUser);
      assert.ok(
        !notifs.notifications.some((n) => n.type === "priority_variant_available"),
        "missing (non-priority) users must be excluded"
      );

      notifs = await listNotifications(ownedUser);
      assert.ok(
        !notifs.notifications.some((n) => n.type === "priority_variant_available"),
        "users who already own the variant must be excluded"
      );

      // Same period again → still one notification (Étape 33 dedupe).
      await variantAvail.handleCatalogueVariantAvailable(makeEvent({
        variantId,
        variantName,
        previousStatus: "ended",
        newStatus: "available_now",
        confidence: "observed",
        periodId: periodA
      }));
      notifs = await listNotifications(priorityUser);
      assert.strictEqual(
        notifs.notifications.filter((n) => n.type === "priority_variant_available").length,
        1,
        "same availability period must not re-notify"
      );

      // New return period → a fresh notification is allowed.
      await variantAvail.handleCatalogueVariantAvailable(makeEvent({
        variantId,
        variantName,
        previousStatus: "ended",
        newStatus: "available_now",
        confidence: "confirmed",
        periodId: periodB
      }));
      notifs = await listNotifications(priorityUser);
      const all = notifs.notifications.filter((n) => n.type === "priority_variant_available");
      assert.strictEqual(all.length, 2, "new return period should trigger a new notification");
      assert.ok(
        all.some((n) => String(n.data?.availabilityPeriodId) === periodB),
        "second notification must reference the new period"
      );
    } finally {
      await deletePeriods(periodIds).catch(() => {});
      await cleanup(priorityUser);
      await cleanup(missingUser);
      await cleanup(ownedUser);
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
