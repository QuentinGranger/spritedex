// Unit tests for the contextual notification catalog (Étape 1).
// Pure unit test: no server or database required.
// A few late assertions import the WebSocket module, which builds the shared
// Express app and validates its public URL. Keep this unit test runnable from
// a clean checkout without requiring a developer .env file.
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;
const assert = require("node:assert");
const catalog = require("../server/notification-catalog");
const prefs = require("../server/notification-preferences");
const channels = require("../server/notification-channels");
const bus = require("../server/event-bus");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

console.log("\nRunning SPRITNEX notification catalog tests\n");

// ── Stable technical identifiers ──
const EXPECTED_IDS = {
  FRIEND_REQUEST_ACCEPTED: "friend_request_accepted",
  FRIEND_ACQUIRED_MISSING_VARIANT: "friend_acquired_missing_variant",
  SQUAD_COMPLETION_INCREASED: "squad_completion_increased",
  PRIORITY_VARIANT_AVAILABLE: "priority_variant_available",
  WANTED_EVENT_ENDING_SOON: "wanted_event_ending_soon"
};

test("exposes exactly the five stable type ids", () => {
  assert.deepStrictEqual(catalog.NOTIFICATION_TYPES, EXPECTED_IDS);
  assert.strictEqual(catalog.CONTEXTUAL_NOTIFICATION_TYPES.length, 5);
  for (const id of Object.values(EXPECTED_IDS)) {
    assert.ok(catalog.CONTEXTUAL_NOTIFICATION_TYPES.includes(id), `missing ${id}`);
    assert.ok(catalog.isKnownType(id), `isKnownType false for ${id}`);
  }
});

test("type ids do not depend on displayed text or language", () => {
  // Same id yields different wording per language, proving the id is stable
  // and language-independent.
  for (const id of Object.values(EXPECTED_IDS)) {
    const fr = catalog.renderNotification(id, sampleContext(id), "fr");
    const en = catalog.renderNotification(id, sampleContext(id), "en");
    assert.ok(fr && en, `render null for ${id}`);
    assert.notStrictEqual(fr.body, en.body, `fr/en body identical for ${id}`);
    assert.notStrictEqual(fr.title, en.title, `fr/en title identical for ${id}`);
  }
});

test("French and English are generated separately for every type", () => {
  for (const id of Object.values(EXPECTED_IDS)) {
    const both = catalog.renderAllLocales(id, sampleContext(id));
    assert.ok(both.fr && both.en, `renderAllLocales missing locale for ${id}`);
    for (const loc of ["fr", "en"]) {
      assert.ok(both[loc].title && both[loc].title.length > 0, `${id}.${loc} empty title`);
      assert.ok(both[loc].body && both[loc].body.length > 0, `${id}.${loc} empty body`);
    }
  }
});

test("context values are interpolated into the wording", () => {
  const fr = catalog.renderNotification(
    catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
    { actorName: "Ash", variantName: "Pikachu Shiny", spriteName: "Pikachu" },
    "fr"
  );
  assert.ok(fr.body.includes("Ash"), "actorName not interpolated");
  assert.ok(fr.body.includes("Pikachu Shiny"), "variantName not interpolated");

  const en = catalog.renderNotification(
    catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED,
    { squadName: "Team Rocket", completionRate: 42.5, newRate: 42.5, delta: 5, count: 1, kind: "progress" },
    "en"
  );
  assert.ok(en.title.includes("Team Rocket"), "squadName not interpolated");
  assert.ok(en.body.includes("42.5"), "completionRate not interpolated");
});

test("unknown language falls back to French default", () => {
  const def = catalog.renderNotification(
    catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
    { actorName: "Misty" },
    "de"
  );
  const fr = catalog.renderNotification(
    catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
    { actorName: "Misty" },
    "fr"
  );
  assert.deepStrictEqual(def, fr);
});

test("unknown type returns null and is not considered known", () => {
  assert.strictEqual(catalog.isKnownType("totally_made_up"), false);
  assert.strictEqual(catalog.renderNotification("totally_made_up", {}), null);
  assert.strictEqual(catalog.renderAllLocales("totally_made_up", {}), null);
});

test("missing context degrades gracefully with fallbacks", () => {
  for (const id of Object.values(EXPECTED_IDS)) {
    const fr = catalog.renderNotification(id, {}, "fr");
    const en = catalog.renderNotification(id, {}, "en");
    assert.ok(fr.body.length > 0 && en.body.length > 0, `empty body without context for ${id}`);
  }
});

test("event notification handles singular vs plural counts", () => {
  const one = catalog.renderNotification(
    catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON,
    { eventName: "Halloween", remainingCount: 1, threshold: "3d", eventId: "e1" },
    "en"
  );
  const many = catalog.renderNotification(
    catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON,
    { eventName: "Halloween", remainingCount: 3, threshold: "3d", eventId: "e1" },
    "en"
  );
  assert.ok(/1 priority variant\b/.test(one.body), `singular form wrong: ${one.body}`);
  assert.ok(/3 priority variants\b/.test(many.body), `plural form wrong: ${many.body}`);
});

test("url deep-links are language-agnostic and id-based", () => {
  const url = catalog.getNotificationUrl(
    catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
    { actorId: 42, friendId: 42, variantId: "v9" }
  );
  assert.strictEqual(url, "/compare/42?variantId=v9");
  assert.strictEqual(
    catalog.getNotificationUrl(catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED, {}),
    "/friends"
  );
});

// ── Categories (Étape 2) ──
const EXPECTED_CATEGORIES = {
  friend_request_accepted: "social",
  friend_acquired_missing_variant: "collection",
  squad_completion_increased: "collection",
  priority_variant_available: "alerts",
  wanted_event_ending_soon: "alerts"
};

test("exposes exactly the three stable category ids", () => {
  assert.deepStrictEqual(catalog.NOTIFICATION_CATEGORIES, {
    SOCIAL: "social",
    COLLECTION: "collection",
    ALERTS: "alerts"
  });
  assert.deepStrictEqual([...catalog.NOTIFICATION_CATEGORY_LIST], ["social", "collection", "alerts"]);
});

test("each type maps to its expected category", () => {
  for (const [type, category] of Object.entries(EXPECTED_CATEGORIES)) {
    assert.strictEqual(catalog.getCategory(type), category, `wrong category for ${type}`);
    assert.ok(catalog.isKnownCategory(category), `unknown category ${category}`);
  }
  assert.strictEqual(catalog.getCategory("totally_made_up"), null);
});

test("getTypesByCategory returns the right members", () => {
  assert.deepStrictEqual(catalog.getTypesByCategory("social"), ["friend_request_accepted"]);
  assert.deepStrictEqual(catalog.getTypesByCategory("collection"), [
    "friend_acquired_missing_variant",
    "squad_completion_increased"
  ]);
  assert.deepStrictEqual(catalog.getTypesByCategory("alerts"), [
    "priority_variant_available",
    "wanted_event_ending_soon"
  ]);
});

test("every contextual type belongs to a known category", () => {
  for (const type of catalog.CONTEXTUAL_NOTIFICATION_TYPES) {
    const cat = catalog.getCategory(type);
    assert.ok(catalog.isKnownCategory(cat), `${type} has no known category`);
  }
});

test("category labels are generated separately in French and English", () => {
  for (const category of catalog.NOTIFICATION_CATEGORY_LIST) {
    const fr = catalog.getCategoryLabel(category, "fr");
    const en = catalog.getCategoryLabel(category, "en");
    assert.ok(fr && fr.label && fr.description, `fr label missing for ${category}`);
    assert.ok(en && en.label && en.description, `en label missing for ${category}`);
    // Descriptions must differ across languages (proof of separate wording).
    assert.notStrictEqual(fr.description, en.description, `fr/en description identical for ${category}`);
  }
  assert.strictEqual(catalog.getCategoryLabel("totally_made_up"), null);
});

// ── Statuses (Étape 4) ──
test("exposes exactly the seven stable status ids", () => {
  assert.deepStrictEqual(catalog.NOTIFICATION_STATUSES, {
    CREATED: "created",
    QUEUED: "queued",
    DELIVERED: "delivered",
    FAILED: "failed",
    READ: "read",
    ARCHIVED: "archived",
    CANCELLED: "cancelled"
  });
  assert.deepStrictEqual([...catalog.NOTIFICATION_STATUS_LIST], [
    "created", "queued", "delivered", "failed", "read", "archived", "cancelled"
  ]);
});

test("status labels are generated separately in French and English", () => {
  for (const status of catalog.NOTIFICATION_STATUS_LIST) {
    const fr = catalog.getStatusLabel(status, "fr");
    const en = catalog.getStatusLabel(status, "en");
    assert.ok(fr && fr.label && fr.description, `fr status label missing for ${status}`);
    assert.ok(en && en.label && en.description, `en status label missing for ${status}`);
    assert.notStrictEqual(fr.description, en.description, `fr/en description identical for ${status}`);
  }
  assert.strictEqual(catalog.getStatusLabel("totally_made_up"), null);
  assert.strictEqual(catalog.isKnownStatus("totally_made_up"), false);
  assert.strictEqual(catalog.isKnownStatus("delivered"), true);
});

test("status transitions enforce a sane lifecycle", () => {
  assert.ok(catalog.canTransitionStatus("created", "delivered"));
  assert.ok(catalog.canTransitionStatus("created", "queued"));
  assert.ok(catalog.canTransitionStatus("queued", "failed"));
  assert.ok(catalog.canTransitionStatus("delivered", "read"));
  assert.ok(catalog.canTransitionStatus("read", "archived"));
  // Terminal / illegal transitions
  assert.ok(!catalog.canTransitionStatus("archived", "read"));
  assert.ok(!catalog.canTransitionStatus("cancelled", "delivered"));
  assert.ok(!catalog.canTransitionStatus("delivered", "created"));
  assert.ok(!catalog.canTransitionStatus("read", "delivered"));
  // Unknown statuses never transition
  assert.ok(!catalog.canTransitionStatus("created", "totally_made_up"));
});

// ── Delivery precedence: general → category → type (Étape 6) ──
test("delivery is allowed only when all three levels are enabled", () => {
  assert.strictEqual(prefs.evaluateDelivery({ pushEnabled: true, categoryEnabled: true, typeEnabled: true }), true);
  // General channel off blocks everything.
  assert.strictEqual(prefs.evaluateDelivery({ pushEnabled: false, categoryEnabled: true, typeEnabled: true }), false);
  // Category off blocks even if type is on.
  assert.strictEqual(prefs.evaluateDelivery({ pushEnabled: true, categoryEnabled: false, typeEnabled: true }), false);
  // Type off blocks even if category is on (the spec's example).
  assert.strictEqual(prefs.evaluateDelivery({ pushEnabled: true, categoryEnabled: true, typeEnabled: false }), false);
});

test("absent (undefined) preferences default to enabled (opt-out)", () => {
  // Nothing specified → allowed.
  assert.strictEqual(prefs.evaluateDelivery({}), true);
  // Only the disabled level matters; undefined ones are treated as enabled.
  assert.strictEqual(prefs.evaluateDelivery({ typeEnabled: false }), false);
  assert.strictEqual(prefs.evaluateDelivery({ categoryEnabled: false }), false);
  assert.strictEqual(prefs.evaluateDelivery({ pushEnabled: false }), false);
});

test("spec example: collection on but friend_acquired_missing_variant off → blocked", () => {
  // push_enabled = true, collection_enabled = true, type off
  const allowed = prefs.evaluateDelivery({ pushEnabled: true, categoryEnabled: true, typeEnabled: false });
  assert.strictEqual(allowed, false);
  // The type indeed belongs to the collection category.
  assert.strictEqual(catalog.getCategory("friend_acquired_missing_variant"), "collection");
});

// ── Channels (Étape 7) ──
test("exposes exactly the three stable channel ids", () => {
  assert.deepStrictEqual(catalog.NOTIFICATION_CHANNELS, {
    IN_APP: "in_app",
    PUSH: "push",
    EMAIL: "email"
  });
  assert.deepStrictEqual([...catalog.NOTIFICATION_CHANNEL_LIST], ["in_app", "push", "email"]);
});

test("channel labels are generated separately in French and English", () => {
  for (const ch of catalog.NOTIFICATION_CHANNEL_LIST) {
    const fr = catalog.getChannelLabel(ch, "fr");
    const en = catalog.getChannelLabel(ch, "en");
    assert.ok(fr && fr.label && fr.description, `fr channel label missing for ${ch}`);
    assert.ok(en && en.label && en.description, `en channel label missing for ${ch}`);
    assert.notStrictEqual(fr.description, en.description, `fr/en description identical for ${ch}`);
  }
  assert.strictEqual(catalog.getChannelLabel("totally_made_up"), null);
  assert.strictEqual(catalog.isKnownChannel("email"), true);
  assert.strictEqual(catalog.isKnownChannel("totally_made_up"), false);
});

test("every type targets in_app; email is reserved for alerts", () => {
  for (const type of catalog.CONTEXTUAL_NOTIFICATION_TYPES) {
    const chans = catalog.getTypeChannels(type);
    assert.ok(chans.includes("in_app"), `${type} should target in_app`);
  }
  // email only on the two important alert types
  assert.ok(catalog.getTypeChannels("priority_variant_available").includes("email"));
  assert.ok(catalog.getTypeChannels("wanted_event_ending_soon").includes("email"));
  assert.ok(!catalog.getTypeChannels("friend_request_accepted").includes("email"));
  assert.ok(!catalog.getTypeChannels("squad_completion_increased").includes("email"));
  // unknown type defaults to in_app only
  assert.deepStrictEqual(catalog.getTypeChannels("totally_made_up"), ["in_app"]);
});

test("resolvePermittedChannels applies subject gates and channel toggles", () => {
  const typeChannels = ["in_app", "push", "email"];
  // all on
  assert.deepStrictEqual(
    channels.resolvePermittedChannels({ typeChannels, channelPrefs: {}, categoryEnabled: true, typeEnabled: true }),
    ["in_app", "push", "email"]
  );
  // category off → nothing
  assert.deepStrictEqual(
    channels.resolvePermittedChannels({ typeChannels, categoryEnabled: false }),
    []
  );
  // type off → nothing
  assert.deepStrictEqual(
    channels.resolvePermittedChannels({ typeChannels, typeEnabled: false }),
    []
  );
  // push channel muted → in_app + email only
  assert.deepStrictEqual(
    channels.resolvePermittedChannels({ typeChannels, channelPrefs: { push: false } }),
    ["in_app", "email"]
  );
});

test("quiet hours handles normal and midnight-wrapping ranges", () => {
  const tz = "Europe/Paris";
  // Winter CET = UTC+1: local hour = UTC hour + 1
  // no window
  assert.strictEqual(channels.isInQuietHours(null, null, new Date("2026-01-01T03:00:00Z"), tz), false);
  // normal 9→17 — 12:00 Paris = 11:00 UTC
  assert.strictEqual(channels.isInQuietHours(9, 17, new Date("2026-01-01T11:00:00Z"), tz), true);
  assert.strictEqual(channels.isInQuietHours(9, 17, new Date("2026-01-01T07:00:00Z"), tz), false);
  assert.strictEqual(channels.isInQuietHours(9, 17, new Date("2026-01-01T16:00:00Z"), tz), false);
  // wraps midnight 22→7 — 23:00 Paris = 22:00 UTC; 03:00 Paris = 02:00 UTC
  assert.strictEqual(channels.isInQuietHours(22, 7, new Date("2026-01-01T22:00:00Z"), tz), true);
  assert.strictEqual(channels.isInQuietHours(22, 7, new Date("2026-01-01T02:00:00Z"), tz), true);
  assert.strictEqual(channels.isInQuietHours(22, 7, new Date("2026-01-01T11:00:00Z"), tz), false);
  // zero-length window disabled
  assert.strictEqual(channels.isInQuietHours(5, 5, new Date("2026-01-01T04:00:00Z"), tz), false);
});

test("delivery queue only carries external channels (Étape 42)", () => {
  const queue = require("../server/notification-delivery-queue");
  assert.deepStrictEqual(
    queue.externalChannelsOnly(["in_app", "push", "email"]),
    ["push", "email"]
  );
  assert.deepStrictEqual(queue.externalChannelsOnly(["in_app"]), []);
  assert.ok(queue.QUEUE_STATUSES.PENDING === "pending");
  assert.ok(queue.QUEUE_POLL_MS === 0 || queue.QUEUE_POLL_MS === 5000);
});

test("notification_deliveries covers in_app, push, email (Étape 43)", () => {
  const deliveries = require("../server/notification-deliveries");
  assert.deepStrictEqual(deliveries.DELIVERY_CHANNELS, ["in_app", "push", "email"]);
  assert.strictEqual(deliveries.DELIVERY_STATUSES.QUEUED, "queued");
  assert.strictEqual(deliveries.DELIVERY_STATUSES.DELIVERED, "delivered");
  assert.strictEqual(deliveries.DELIVERY_STATUSES.FAILED, "failed");
  const id = deliveries.newDeliveryId();
  assert.ok(typeof id === "string" && id.length >= 32);
});

test("push_subscriptions platforms and web parsing (Étape 44)", () => {
  const subs = require("../server/push-subscriptions");
  assert.deepStrictEqual(subs.PLATFORMS, ["web", "ios", "android"]);
  assert.strictEqual(subs.normalizePlatform("fcm"), "android");
  assert.strictEqual(subs.normalizePlatform("apns"), "ios");
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
  const publicKey = "A".repeat(48);
  const authSecret = "B".repeat(24);
  const web = subs.parseWebSubscription({
    endpoint,
    keys: { p256dh: publicKey, auth: authSecret }
  });
  assert.strictEqual(web.endpoint, endpoint);
  assert.strictEqual(web.publicKey, publicKey);
  assert.strictEqual(web.authSecret, authSecret);
  const target = subs.toDispatchTarget({
    id: "1",
    platform: "web",
    endpoint,
    public_key: publicKey,
    auth_secret: authSecret
  });
  assert.strictEqual(target.subscription.keys.p256dh, publicKey);
  const nativeToken = `fcm-${"A".repeat(32)}`;
  assert.strictEqual(
    subs.toDispatchTarget({ id: "2", platform: "android", token: nativeToken, endpoint: `android:${nativeToken}` }).token,
    nativeToken
  );
});

test("invalid push tokens are permanent failures (Étape 45)", () => {
  const subs = require("../server/push-subscriptions");
  assert.ok(subs.isPermanentProviderFailure({ statusCode: 410, error: "Gone" }));
  assert.ok(subs.isPermanentProviderFailure({ statusCode: 404 }));
  assert.ok(subs.isPermanentProviderFailure({ error: "NotRegistered" }));
  assert.ok(subs.isPermanentProviderFailure({ error: "InvalidRegistration" }));
  assert.ok(subs.isPermanentProviderFailure({ error: "BadDeviceToken" }));
  assert.ok(subs.isPermanentProviderFailure({ expired: true }));
  assert.ok(!subs.isPermanentProviderFailure({ error: "Unavailable" }));
  assert.ok(!subs.isPermanentProviderFailure({ statusCode: 500, error: "Internal" }));
});

test("quiet hours defer non-urgent push until window ends (Étape 41)", () => {
  const quiet = require("../server/notification-quiet-hours");
  const tz = "Europe/Paris";
  // 23:30 Paris (22:30 UTC in winter) inside 22→08
  const now = new Date("2026-01-01T22:30:00Z");
  const endAt = quiet.computeQuietHoursEnd(22, 8, now, tz);
  assert.ok(endAt);
  // Quiet ends at 08:00 Paris = 07:00 UTC
  assert.strictEqual(endAt.toISOString(), "2026-01-02T07:00:00.000Z");

  const deferred = quiet.resolveQuietHoursDeferral({
    start: 22,
    end: 8,
    timeZone: tz,
    now,
    urgent: false,
    deadline: "2026-01-10T00:00:00Z"
  });
  assert.strictEqual(deferred.defer, true);
  assert.strictEqual(deferred.deliverAt, "2026-01-02T07:00:00.000Z");

  // Must not schedule push after the event ends.
  const pastDeadline = quiet.resolveQuietHoursDeferral({
    start: 22,
    end: 8,
    timeZone: tz,
    now,
    urgent: false,
    deadline: "2026-01-02T06:00:00Z"
  });
  assert.strictEqual(pastDeadline.drop, true);
  assert.strictEqual(pastDeadline.reason, "quiet_hours_past_deadline");

  // 24h event alerts bypass quiet hours.
  const urgent = quiet.resolveQuietHoursDeferral({
    start: 22,
    end: 8,
    timeZone: tz,
    now,
    urgent: true
  });
  assert.strictEqual(urgent.defer, false);
  assert.strictEqual(urgent.bypass, true);
  assert.ok(quiet.isPushUrgent("wanted_event_ending_soon", { threshold: "24h" }));
  assert.ok(!quiet.isPushUrgent("wanted_event_ending_soon", { threshold: "3d" }));
});

test("user timezone drives quiet hours and demain label (Étape 40)", () => {
  const tz = require("../server/timezone");
  assert.strictEqual(tz.DEFAULT_TIMEZONE, "Europe/Paris");
  assert.ok(tz.isValidTimeZone("Europe/Paris"));
  assert.ok(!tz.isValidTimeZone("Not/AZone"));
  assert.strictEqual(tz.toUtcIso("2026-08-20T23:59:59+02:00"), "2026-08-20T21:59:59.000Z");

  // Same UTC instant: 21:30 UTC on Jul 20 → 23:30 Paris, 14:30 LA
  const instant = new Date("2026-07-20T21:30:00Z");
  assert.strictEqual(tz.getLocalHour(instant, "Europe/Paris"), 23);
  assert.strictEqual(tz.getLocalHour(instant, "America/Los_Angeles"), 14);
  assert.ok(channels.isInQuietHours(22, 7, instant, "Europe/Paris"));
  assert.ok(!channels.isInQuietHours(22, 7, instant, "America/Los_Angeles"));

  // Ends 2026-07-21T22:00:00Z → 2026-07-22 00:00 in Paris → "demain" on Jul 21 Paris
  const endingAt = "2026-07-21T22:00:00Z";
  const nowParis = new Date("2026-07-21T10:00:00Z"); // 12:00 Paris
  assert.strictEqual(tz.calendarDaysUntil(endingAt, nowParis, "Europe/Paris"), 1);
  assert.strictEqual(tz.calendarDaysUntil(endingAt, nowParis, "UTC"), 0);

  const fr = catalog.renderNotification(
    catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON,
    {
      eventName: "Hot Bat Summer",
      eventId: "event_hot_bat_summer",
      endingAt,
      remainingCount: 3,
      threshold: "24h",
      timeZone: "Europe/Paris",
      now: nowParis.toISOString()
    },
    "fr"
  );
  assert.strictEqual(fr.title, "Hot Bat Summer se termine demain");
  assert.strictEqual(fr.data.timeZone, "Europe/Paris");
  assert.strictEqual(
    catalog.formatEventEndingWhen({
      endingAt,
      timeZone: "UTC",
      now: nowParis.toISOString(),
      threshold: "24h"
    }, "fr"),
    "aujourd'hui"
  );
});

function sampleContext(id) {
  switch (id) {
    case catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED:
      return { actorName: "Ash", actorId: 1, friendId: 1, friendshipId: "friendship_1" };
    case catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT:
      return {
        actorName: "Ash",
        actorId: 1,
        friendId: 1,
        variantName: "Pikachu Shiny",
        spriteName: "Pikachu",
        variantId: "v1",
        recipientCollectionStatus: "missing",
        priorityLevel: "normal",
        count: 1
      };
    case catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED:
      return {
        squadName: "Bravo Six",
        squadCode: "BRAVO6",
        squadId: "1",
        actorName: "Lucy",
        variantName: "Batman Holofoil",
        newVariantIds: ["sprite_batman_holofoil"],
        previousRate: 81.71,
        newRate: 82.93,
        completionRate: 82.93,
        previousCoveredCount: 67,
        newCoveredCount: 68,
        coveredCount: 68,
        totalVariants: 82,
        count: 1,
        kind: "progress",
        delta: 1.22
      };
    case catalog.NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE:
      return {
        variantName: "Batman Holofoil",
        spriteName: "Batman",
        variantId: "sprite_batman_holofoil",
        spriteId: "sprite_batman",
        variantType: "Holofoil",
        availableFrom: "2026-07-18T00:00:00Z",
        availableUntil: "2026-08-20T23:59:59Z",
        confidence: "official",
        eventId: "event_hot_bat_summer",
        availabilityPeriodId: "period_1"
      };
    case catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON:
      return {
        eventName: "Halloween",
        eventId: "e7",
        remainingCount: 3,
        remainingPriorityVariantIds: ["v1", "v2", "v3"],
        threshold: "3d",
        endingAt: "2026-08-20T23:59:59Z"
      };
    default:
      return {};
  }
}

// ── Event bus (Étape 8) — async tests ──
async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

(async () => {
  await asyncTest("emitDomainEvent awaits handlers and passes the envelope", async () => {
    const EV = "test.event_a";
    bus.removeAllDomainListeners(EV);
    let seen = null;
    bus.onDomainEvent(EV, async (event) => {
      await new Promise(r => setTimeout(r, 5));
      seen = event;
    });
    const emitted = await bus.emitDomainEvent(EV, { actorId: "u1", entityType: "user", entityId: "u2", context: { hello: "world" } });
    assert.ok(seen, "handler did not run before emit resolved");
    assert.strictEqual(seen.eventId, emitted.eventId, "handler should receive the same envelope");
    assert.strictEqual(seen.eventType, EV);
    assert.strictEqual(seen.actorId, "u1");
    assert.strictEqual(seen.entityId, "u2");
    assert.deepStrictEqual(seen.context, { hello: "world" });
    bus.removeAllDomainListeners(EV);
  });

  await asyncTest("createDomainEvent builds a unique, well-formed envelope (Étape 9)", () => {
    const e1 = bus.createDomainEvent("collection.variant_acquired", {
      actorId: "user_lucy",
      entityType: "sprite_variant",
      entityId: "sprite_water_gold",
      context: { previousStatus: "missing", newStatus: "owned" }
    });
    assert.ok(typeof e1.eventId === "string" && e1.eventId.length > 0, "eventId missing");
    assert.strictEqual(e1.eventType, "collection.variant_acquired");
    assert.ok(!Number.isNaN(Date.parse(e1.occurredAt)), "occurredAt not a valid date");
    assert.strictEqual(e1.actorId, "user_lucy");
    assert.strictEqual(e1.entityType, "sprite_variant");
    assert.strictEqual(e1.entityId, "sprite_water_gold");
    assert.deepStrictEqual(e1.context, { previousStatus: "missing", newStatus: "owned" });
    // Two events of the same kind get different ids (dedupe key).
    const e2 = bus.createDomainEvent("collection.variant_acquired", { actorId: "user_lucy" });
    assert.notStrictEqual(e1.eventId, e2.eventId, "eventIds should be unique");
    // A caller-supplied eventId is preserved (deterministic idempotency).
    const e3 = bus.createDomainEvent("x", { eventId: "fixed-123" });
    assert.strictEqual(e3.eventId, "fixed-123");
    // Defaults
    const e4 = bus.createDomainEvent("x");
    assert.strictEqual(e4.actorId, null);
    assert.deepStrictEqual(e4.context, {});
  });

  await asyncTest("all handlers for an event are invoked", async () => {
    const EV = "test.event_b";
    bus.removeAllDomainListeners(EV);
    let count = 0;
    bus.onDomainEvent(EV, () => { count++; });
    bus.onDomainEvent(EV, () => { count++; });
    await bus.emitDomainEvent(EV, {});
    assert.strictEqual(count, 2);
    bus.removeAllDomainListeners(EV);
  });

  await asyncTest("a throwing handler is isolated and never rejects emit", async () => {
    const EV = "test.event_c";
    bus.removeAllDomainListeners(EV);
    let otherRan = false;
    bus.onDomainEvent(EV, () => { throw new Error("boom"); });
    bus.onDomainEvent(EV, () => { otherRan = true; });
    await bus.emitDomainEvent(EV, {}); // must not throw
    assert.strictEqual(otherRan, true, "sibling handler should still run");
    bus.removeAllDomainListeners(EV);
  });

  await asyncTest("unsubscribe stops a handler from firing", async () => {
    const EV = "test.event_d";
    bus.removeAllDomainListeners(EV);
    let ran = 0;
    const off = bus.onDomainEvent(EV, () => { ran++; });
    off();
    await bus.emitDomainEvent(EV, {});
    assert.strictEqual(ran, 0);
    bus.removeAllDomainListeners(EV);
  });

  await asyncTest("the five domain event ids are stable", () => {
    assert.deepStrictEqual(bus.DOMAIN_EVENTS, {
      FRIENDSHIP_ACCEPTED: "friendship.accepted",
      COLLECTION_VARIANT_ACQUIRED: "collection.variant_acquired",
      SQUAD_COMPLETION_CHANGED: "squad.completion_changed",
      CATALOGUE_VARIANT_AVAILABLE: "catalogue.variant_available",
      CATALOGUE_EVENT_ENDING_SOON: "catalogue.event_ending_soon"
    });
  });

  // Étapes 15–21 — acquisition gates / content
  await asyncTest("acquisition trigger and priority gates (Étapes 15–17)", () => {
    const gates = require("../server/notification-gates");
    assert.ok(gates.isAcquiredFromStatus("missing"));
    assert.ok(gates.isAcquiredFromStatus("priority"));
    assert.ok(gates.isAcquiredFromStatus("spotted"));
    assert.ok(!gates.isAcquiredFromStatus("new"));
    assert.ok(!gates.isAcquiredFromStatus("owned"));
    assert.strictEqual(gates.resolveAcquisitionPriority("priority"), "strong");
    assert.strictEqual(gates.resolveAcquisitionPriority("missing"), "normal");
    assert.strictEqual(gates.resolveAcquisitionPriority("unknown"), null);
    assert.strictEqual(gates.MAX_PUSH_PER_FRIEND_PER_DAY, 3);
    assert.ok(gates.BATCH_WINDOW_MS === 0 || gates.BATCH_WINDOW_MS === 10 * 60 * 1000);
  });

  await asyncTest("squad milestones and immediate-push rule (Étapes 25–27)", () => {
    const gates = require("../server/notification-gates");
    assert.deepStrictEqual(gates.SQUAD_MILESTONES, [25, 50, 75, 80, 90, 95, 100]);
    assert.strictEqual(gates.crossedSquadMilestone(81.71, 82.93), null);
    assert.strictEqual(gates.crossedSquadMilestone(89.5, 90.1), 90);
    assert.strictEqual(gates.crossedSquadMilestone(94, 100), 100);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: 90 }), true);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: null }), false);
    assert.ok(gates.SQUAD_BATCH_WINDOW_MS === 0 || gates.SQUAD_BATCH_WINDOW_MS === 20 * 60 * 1000);
  });

  await asyncTest("priority variant availability gates (Étapes 28–29, 31, 33)", () => {
    const gates = require("../server/notification-gates");
    assert.strictEqual(gates.classifyAvailabilityStatus("available"), "available_now");
    assert.strictEqual(gates.classifyAvailabilityStatus("coming_soon"), "upcoming");
    assert.ok(gates.isVariantAvailableTransition("upcoming", "available"));
    assert.ok(gates.isVariantAvailableTransition("not_observed", "available_now"));
    assert.ok(!gates.isVariantAvailableTransition("available", "available"));
    assert.ok(gates.isTrustedAvailabilityConfidence("official"));
    assert.ok(gates.isTrustedAvailabilityConfidence("observed"));
    assert.ok(gates.isTrustedAvailabilityConfidence("confirmed"));
    assert.ok(!gates.isTrustedAvailabilityConfidence("estimated"));
    assert.ok(!gates.isTrustedAvailabilityConfidence("unverified"));
    assert.ok(!gates.isTrustedAvailabilityConfidence("unknown"));
    assert.strictEqual(
      gates.buildPriorityVariantAvailableDedupeKey(42, "v1", "period_a"),
      "priority_available:42:v1:period_a"
    );
    assert.deepStrictEqual(
      gates.evaluateVariantStillAvailable({
        status: "available_now",
        availableFrom: "2026-01-01T00:00:00Z",
        availableUntil: "2099-12-31T23:59:59Z",
        now: new Date("2026-07-18T12:00:00Z")
      }),
      { ok: true }
    );
    assert.strictEqual(
      gates.evaluateVariantStillAvailable({
        status: "available_now",
        availableUntil: "2020-01-01T00:00:00Z",
        now: new Date("2026-07-18T12:00:00Z")
      }).reason,
      "ended"
    );
  });

  await asyncTest("wanted event recipient gates (Étape 34)", () => {
    const gates = require("../server/notification-gates");
    assert.deepStrictEqual(gates.resolveWantedEventInterestStatuses(), ["priority"]);
    assert.deepStrictEqual(
      gates.resolveWantedEventInterestStatuses({ includeMissing: true }),
      ["priority", "missing"]
    );
    assert.deepStrictEqual(
      gates.evaluateWantedEventVariantInterest({
        status: "priority",
        owned: false,
        stillAvailable: true
      }),
      { ok: true }
    );
    assert.strictEqual(
      gates.evaluateWantedEventVariantInterest({
        status: "missing",
        owned: false,
        stillAvailable: true
      }).reason,
      "status_not_wanted"
    );
    assert.ok(
      gates.evaluateWantedEventVariantInterest({
        status: "missing",
        owned: false,
        stillAvailable: true,
        includeMissing: true
      }).ok
    );
    assert.strictEqual(
      gates.evaluateWantedEventVariantInterest({
        status: "priority",
        owned: true,
        stillAvailable: true
      }).reason,
      "already_owned"
    );
    assert.strictEqual(
      gates.evaluateWantedEventVariantInterest({
        status: "priority",
        owned: false,
        stillAvailable: false
      }).reason,
      "not_available"
    );
  });

  await asyncTest("wanted event temporal thresholds (Étape 35)", () => {
    const gates = require("../server/notification-gates");
    assert.strictEqual(gates.WANTED_EVENT_DEFAULT_THRESHOLD_ID, "3d");
    assert.strictEqual(gates.WANTED_EVENT_STRONG_THRESHOLD_ID, "24h");
    assert.deepStrictEqual(
      gates.WANTED_EVENT_THRESHOLD_LIST.map(t => t.id),
      ["7d", "3d", "24h"]
    );

    // Default anti-spam: 3d only; 24h added for strong priorities; 7d off.
    assert.deepStrictEqual(
      gates.resolveWantedEventActiveThresholds().map(t => t.id),
      ["3d"]
    );
    assert.deepStrictEqual(
      gates.resolveWantedEventActiveThresholds({ hasStrongPriority: true }).map(t => t.id),
      ["3d", "24h"]
    );

    assert.ok(gates.isWantedEventThresholdAllowed({ thresholdId: "3d" }).ok);
    assert.strictEqual(
      gates.isWantedEventThresholdAllowed({ thresholdId: "24h" }).reason,
      "strong_priority_required"
    );
    assert.ok(
      gates.isWantedEventThresholdAllowed({
        thresholdId: "24h",
        hasStrongPriority: true
      }).ok
    );
    assert.strictEqual(
      gates.isWantedEventThresholdAllowed({ thresholdId: "7d" }).reason,
      "threshold_disabled"
    );
    assert.ok(
      gates.isWantedEventThresholdAllowed({
        thresholdId: "7d",
        enabledThresholdIds: ["7d", "3d"]
      }).ok
    );

    const now = new Date("2026-07-20T12:00:00Z");
    assert.strictEqual(
      gates.classifyWantedEventThreshold("2026-07-20T20:00:00Z", now),
      "24h"
    );
    assert.strictEqual(
      gates.classifyWantedEventThreshold("2026-07-22T12:00:00Z", now),
      "3d"
    );
    assert.strictEqual(
      gates.classifyWantedEventThreshold("2026-07-26T12:00:00Z", now),
      "7d"
    );
    assert.strictEqual(
      gates.classifyWantedEventThreshold("2026-08-20T12:00:00Z", now),
      null
    );
    assert.ok(gates.isStrongWantedPriority("urgent"));
    assert.ok(gates.isStrongWantedPriority("important"));
    assert.ok(!gates.isStrongWantedPriority("medium"));
  });

  await asyncTest("wanted event ending scheduler keys (Étape 39)", () => {
    const gates = require("../server/notification-gates");
    const scheduler = require("../server/notification-event-ending-scheduler");
    assert.ok(scheduler.CRON_MS === 0 || scheduler.CRON_MS === 60 * 60 * 1000);
    assert.strictEqual(
      gates.buildWantedEventEndingDedupeKey(
        42,
        "event_hot_bat_summer",
        "3d"
      ),
      "event_ending:42:event_hot_bat_summer:3d"
    );
    assert.strictEqual(
      gates.buildWantedEventEndingDomainEventId(
        "event_hot_bat_summer",
        "24h",
        "2026-08-20T23:59:59Z"
      ),
      "catalogue.event_ending_soon:event_hot_bat_summer:24h:2026-08-20"
    );
    assert.strictEqual(
      gates.classifyWantedEventThreshold(
        "2026-07-23T12:00:00Z",
        new Date("2026-07-20T12:00:00Z")
      ),
      "3d"
    );
  });

  await asyncTest("wanted event pre-send cancel gate (Étape 38)", () => {
    const gates = require("../server/notification-gates");
    assert.deepStrictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 3,
        eventActive: true,
        endDateUnchanged: true,
        prefsAccepted: true
      }),
      { ok: true }
    );
    assert.deepStrictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 0,
        eventActive: true,
        endDateUnchanged: true,
        prefsAccepted: true
      }),
      { ok: false, reason: "no_remaining_priority", cancel: true }
    );
    assert.strictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 2,
        eventActive: false,
        endDateUnchanged: true,
        prefsAccepted: true
      }).reason,
      "event_inactive"
    );
    assert.strictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 2,
        eventActive: true,
        endDateUnchanged: false,
        prefsAccepted: true
      }).reason,
      "end_date_changed"
    );
    assert.strictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 2,
        eventActive: true,
        endDateUnchanged: true,
        prefsAccepted: false
      }).reason,
      "prefs_disabled"
    );
    assert.strictEqual(
      gates.normalizeEndDateKey("2026-08-20T23:59:59.000Z"),
      gates.normalizeEndDateKey("2026-08-20")
    );
  });

  await asyncTest("wanted_event_ending_soon groups variants (Étape 37)", () => {
    const type = catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON;
    // Same UTC calendar day span → "dans 3 jours" (Étape 40 relative wording).
    const fr = catalog.renderNotification(type, {
      eventName: "Hot Bat Summer",
      eventId: "event_hot_bat_summer",
      endingAt: "2026-08-20T12:00:00Z",
      remainingPriorityVariantIds: [
        "sprite_batman_gold",
        "sprite_batman_galaxy",
        "sprite_batman_holofoil"
      ],
      remainingCount: 3,
      threshold: "3d",
      timeZone: "UTC",
      now: "2026-08-17T12:00:00Z"
    }, "fr");
    assert.strictEqual(fr.title, "Hot Bat Summer se termine dans 3 jours");
    assert.strictEqual(fr.body, "Il vous manque encore 3 variantes prioritaires.");
    assert.strictEqual(fr.data.eventId, "event_hot_bat_summer");
    assert.strictEqual(fr.data.endingAt, "2026-08-20T12:00:00Z");
    assert.strictEqual(fr.data.remainingCount, 3);
    assert.deepStrictEqual(fr.data.remainingPriorityVariantIds, [
      "sprite_batman_gold",
      "sprite_batman_galaxy",
      "sprite_batman_holofoil"
    ]);
    assert.strictEqual(fr.data.actionUrl, "/events/event_hot_bat_summer?filter=priority");
    assert.strictEqual(fr.url, "/events/event_hot_bat_summer?filter=priority");
  });

  await asyncTest("wanted event end-date confidence gate (Étape 36)", () => {
    const gates = require("../server/notification-gates");
    assert.deepStrictEqual(gates.TRUSTED_END_DATE_CONFIDENCE, ["official", "confirmed"]);
    assert.ok(gates.isTrustedEndDateConfidence("official"));
    assert.ok(gates.isTrustedEndDateConfidence("confirmed"));
    assert.ok(!gates.isTrustedEndDateConfidence("estimated"));
    assert.ok(!gates.isTrustedEndDateConfidence("observed"));
    assert.ok(!gates.isTrustedEndDateConfidence("unverified"));
    assert.ok(!gates.isTrustedEndDateConfidence("unknown"));
    assert.ok(
      gates.evaluateWantedEventEndDateReliability({
        endDate: "2026-08-20T23:59:59Z",
        confidence: "official"
      }).ok
    );
    assert.ok(
      gates.evaluateWantedEventEndDateReliability({
        endDate: "2026-08-20T23:59:59Z",
        confidence: "confirmed"
      }).ok
    );
    assert.strictEqual(
      gates.evaluateWantedEventEndDateReliability({
        endDate: "2026-08-20T23:59:59Z",
        confidence: "estimated"
      }).reason,
      "end_date_untrusted"
    );
    assert.strictEqual(
      gates.evaluateWantedEventEndDateReliability({
        endDate: null,
        confidence: "official"
      }).reason,
      "missing_end_date"
    );
  });

  await asyncTest("priority_variant_available content (Étape 32)", () => {
    const type = catalog.NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE;
    const withEnd = catalog.renderNotification(type, {
      variantName: "Batman Holofoil",
      variantId: "sprite_batman_holofoil",
      spriteId: "sprite_batman",
      variantType: "Holofoil",
      availableUntil: "2026-08-20T23:59:59Z",
      availableFrom: "2026-07-18T00:00:00Z",
      confidence: "official",
      eventId: "event_hot_bat_summer"
    }, "fr");
    assert.strictEqual(withEnd.title, "Batman Holofoil est disponible");
    assert.ok(withEnd.body.includes("Batman Holofoil"));
    assert.ok(withEnd.body.toLowerCase().includes("août") || withEnd.body.includes("20"));
    assert.strictEqual(withEnd.data.actionUrl, "/sprites/sprite_batman?variant=Holofoil");
    assert.strictEqual(withEnd.data.spriteId, "sprite_batman");
    assert.strictEqual(withEnd.data.variantType, "Holofoil");
    assert.strictEqual(withEnd.data.confidence, "official");

    const noEnd = catalog.renderNotification(type, {
      variantName: "Water Gold",
      variantId: "sprite_water_gold",
      spriteId: "sprite_water",
      variantType: "Gold"
    }, "fr");
    assert.strictEqual(noEnd.body, "Une variante que vous recherchez en priorité est maintenant disponible.");
  });

  await asyncTest("squad_completion_increased content (Étape 26) progress vs milestone vs batch", () => {
    const type = catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED;
    const progress = catalog.renderNotification(type, {
      squadName: "Bravo Six",
      squadCode: "BRAVO6",
      squadId: "squad_bravo_six",
      actorName: "Lucy",
      variantName: "Batman Holofoil",
      newVariantIds: ["sprite_batman_holofoil"],
      previousRate: 81.71,
      newRate: 82.93,
      count: 1,
      kind: "progress"
    }, "fr");
    assert.strictEqual(progress.title, "Bravo Six progresse");
    assert.ok(progress.body.includes("Lucy"));
    assert.ok(progress.body.includes("Batman Holofoil"));
    assert.ok(progress.body.includes("82.9"));
    assert.strictEqual(progress.data.actionUrl, "/squad/BRAVO6/engine");
    assert.strictEqual(progress.actions.primary.url, "/squad/BRAVO6/engine");
    assert.deepStrictEqual(progress.data.newVariantIds, ["sprite_batman_holofoil"]);

    const milestone = catalog.renderNotification(type, {
      squadName: "Bravo Six",
      squadCode: "BRAVO6",
      milestone: 90,
      kind: "milestone",
      coveredCount: 74,
      newCoveredCount: 74,
      totalVariants: 82,
      newRate: 90.2
    }, "fr");
    assert.strictEqual(milestone.title, "Bravo Six atteint 90 %");
    assert.ok(milestone.body.includes("74"));
    assert.ok(milestone.body.includes("82"));

    const batch = catalog.renderNotification(type, {
      squadName: "Bravo Six",
      squadCode: "BRAVO6",
      kind: "batch",
      count: 4,
      newRate: 85.4,
      newVariantIds: ["a", "b", "c", "d"]
    }, "fr");
    assert.ok(batch.body.includes("4 nouvelles variantes"));
    assert.ok(batch.body.includes("85.4"));
  });

  await asyncTest("friend_acquired_missing_variant content (Étape 19) priority vs missing vs batch", () => {
    const type = catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT;
    const priority = catalog.renderNotification(type, {
      actorName: "Lucy",
      friendId: "user_lucy",
      variantId: "sprite_batman_holofoil",
      variantName: "Batman Holofoil",
      recipientCollectionStatus: "priority",
      priorityLevel: "strong",
      count: 1
    }, "fr");
    assert.strictEqual(priority.title, "Lucy possède une variante prioritaire");
    assert.ok(priority.body.includes("Batman Holofoil"));
    assert.ok(priority.body.includes("priorité"));
    assert.strictEqual(priority.data.actionUrl, "/compare/user_lucy?variantId=sprite_batman_holofoil");

    const missing = catalog.renderNotification(type, {
      actorName: "Lucy",
      friendId: "user_lucy",
      variantId: "sprite_water_gold",
      variantName: "Water Gold",
      recipientCollectionStatus: "missing",
      priorityLevel: "normal",
      count: 1
    }, "fr");
    assert.strictEqual(missing.title, "Une nouvelle correspondance avec Lucy");
    assert.ok(missing.body.includes("Water Gold"));

    const batch = catalog.renderNotification(type, {
      actorName: "Lucy",
      friendId: "user_lucy",
      variantId: "sprite_batman_holofoil",
      variantName: "Batman Holofoil",
      highlightName: "Batman Holofoil",
      recipientCollectionStatus: "missing",
      count: 3,
      variantIds: ["a", "b", "c"]
    }, "fr");
    assert.ok(batch.body.includes("3 variantes"));
    assert.ok(batch.body.includes("Batman Holofoil"));
    assert.strictEqual(batch.data.count, 3);
  });

  // Étape 14/54 — dedupe key for friend accept
  await asyncTest("friend_accept dedupe key is stable (Étape 14/54)", () => {
    const { buildFriendRequestAcceptedDedupeKey } = require("../server/notification-gates");
    assert.strictEqual(
      buildFriendRequestAcceptedDedupeKey("friendship_123", "user_quentin"),
      "friend_accept:friendship_123:user_quentin"
    );
    assert.strictEqual(buildFriendRequestAcceptedDedupeKey(null, "1"), null);
    assert.strictEqual(buildFriendRequestAcceptedDedupeKey("f1", null), null);
    // Same friendship + recipient → identical key (duplicate claim must collapse).
    assert.strictEqual(
      buildFriendRequestAcceptedDedupeKey("f1", 42),
      buildFriendRequestAcceptedDedupeKey("f1", 42)
    );
  });

  await asyncTest("notification dedupe key formats (Étape 54)", () => {
    const dedupe = require("../server/notification-dedupe");
    assert.strictEqual(
      dedupe.buildFriendAcceptDedupeKey("friendship_123", 7),
      "friend_accept:friendship_123:7"
    );
    assert.strictEqual(
      dedupe.buildFriendVariantDedupeKey(1, 2, "var_holo", "2026-07-26T08:00:00.000Z"),
      "friend_variant:1:2:var_holo:2026-07-26T08:00:00.000Z"
    );
    assert.strictEqual(
      dedupe.buildFriendVariantDedupeKey(1, 2, "var_holo", null),
      null
    );
    assert.strictEqual(
      dedupe.buildSquadCompletionDedupeKey("squad_bravo_six", 68),
      "squad_completion:squad_bravo_six:68"
    );
    assert.strictEqual(
      dedupe.buildPriorityAvailableDedupeKey(42, "v1", "period_a"),
      "priority_available:42:v1:period_a"
    );
    assert.strictEqual(
      dedupe.buildEventEndingDedupeKey(42, "event_hot_bat_summer", "24h"),
      "event_ending:42:event_hot_bat_summer:24h"
    );
  });

  await asyncTest("i18n translation catalogs interpolate FR/EN (Étape 62)", () => {
    const i18n = require("../server/notification-i18n");
    assert.strictEqual(
      i18n.getTranslations("fr")["notifications.friend_request_accepted.title"],
      "{friendName} a accepté votre invitation"
    );
    assert.strictEqual(
      i18n.getTranslations("en")["notifications.friend_request_accepted.title"],
      "{friendName} accepted your friend request"
    );
    assert.strictEqual(
      i18n.pickLocalizedName("fr", { name: "Eau", officialName: "Water" }),
      "Eau"
    );
    assert.strictEqual(
      i18n.pickLocalizedName("en", { name: "Eau", officialName: "Water" }),
      "Water"
    );

    const fr = i18n.renderTranslatedMessage(
      "friend_request_accepted",
      { friendName: "Lucy" },
      "fr"
    );
    assert.strictEqual(fr.title, "Lucy a accepté votre invitation");
    assert.strictEqual(fr.body, "Vous pouvez maintenant comparer vos collections.");

    const en = i18n.renderTranslatedMessage(
      "friend_request_accepted",
      { friendName: "Lucy" },
      "en"
    );
    assert.strictEqual(en.title, "Lucy accepted your friend request");

    const acquired = catalog.renderNotification(
      catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
      {
        actorName: "Lucy",
        friendId: "7",
        variantName: "Water Gold",
        variantId: "sprite_water_gold",
        count: 1
      },
      "en"
    );
    assert.ok(acquired.body.includes("Water Gold"));
    assert.strictEqual(
      acquired.data.translationKey,
      "notifications.friend_acquired_missing_variant"
    );
  });

  await asyncTest("translation payload is structured for re-render (Étape 61)", () => {
    const payload = catalog.buildTranslationPayload(
      catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
      {
        actorName: "Lucy",
        friendId: "user_lucy",
        variantName: "Water Gold",
        variantId: "sprite_water_gold",
        count: 1,
        recipientCollectionStatus: "missing",
        priorityLevel: "normal"
      }
    );
    assert.strictEqual(
      payload.translationKey,
      "notifications.friend_acquired_missing_variant"
    );
    assert.strictEqual(payload.translationParams.friendName, "Lucy");
    assert.strictEqual(payload.translationParams.variantName, "Water Gold");
    assert.strictEqual(payload.translationParams.friendId, "user_lucy");
    assert.strictEqual(payload.translationParams.variantId, "sprite_water_gold");
    assert.strictEqual(payload.translationParams.template, "default");

    const batch = catalog.buildTranslationPayload(
      catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
      {
        actorName: "Lucy",
        friendId: "7",
        highlightName: "Batman Holofoil",
        count: 3,
        variantIds: ["a", "b", "c"]
      }
    );
    assert.strictEqual(batch.translationParams.template, "batch");
    assert.strictEqual(batch.translationParams.count, 3);

    const regenerated = catalog.renderFromTranslation(
      catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
      payload.translationParams,
      "fr"
    );
    assert.ok(regenerated.body.includes("Water Gold"));
    assert.ok(regenerated.body.includes("Lucy"));
  });

  await asyncTest("normalized notification response shape (Étape 60)", () => {
    const serialize = require("../server/notification-serialize");
    assert.strictEqual(serialize.toPublicNotificationId(123), "notification_123");
    assert.strictEqual(serialize.fromPublicNotificationId("notification_123"), 123);
    assert.strictEqual(serialize.fromPublicNotificationId("123"), 123);
    assert.strictEqual(serialize.normalizeEntityType("variant"), "sprite_variant");

    const normalized = serialize.normalizeNotification({
      id: 123,
      type: "friend_acquired_missing_variant",
      category: "collection",
      title: "Lucy possède une variante qui vous manque",
      body: "Lucy possède désormais Water Gold.",
      actor_id: 7,
      entity_type: "variant",
      entity_id: "sprite_water_gold",
      read_at: null,
      created_at: "2026-07-18T20:00:00.000Z",
      data: {
        actionUrl: "/compare/7?variantId=sprite_water_gold",
        actions: {
          primary: { id: "compare", label: "Comparer", url: "/compare/7?variantId=sprite_water_gold" }
        }
      }
    }, {
      id: 7,
      username: "lucy",
      display_name: "Lucy",
      avatar_url: "/avatars/lucy.webp"
    });

    assert.deepStrictEqual(normalized, {
      id: "notification_123",
      type: "friend_acquired_missing_variant",
      category: "collection",
      title: "Lucy possède une variante qui vous manque",
      body: "Lucy possède désormais Water Gold.",
      actor: {
        id: "7",
        displayName: "Lucy",
        avatarUrl: "/avatars/lucy.webp"
      },
      entity: {
        type: "sprite_variant",
        id: "sprite_water_gold"
      },
      action: {
        label: "Comparer",
        url: "/compare/7?variantId=sprite_water_gold"
      },
      isRead: false,
      createdAt: "2026-07-18T20:00:00.000Z"
    });
  });

  await asyncTest("notification API cursor helpers (Étape 59)", () => {
    const {
      encodeNotificationCursor,
      decodeNotificationCursor,
      buildNotificationInboxFilters
    } = require("../push-service");
    const cursor = encodeNotificationCursor({
      id: 42,
      created_at: "2026-07-26T08:00:00.000Z"
    });
    assert.ok(typeof cursor === "string" && cursor.length > 0);
    const decoded = decodeNotificationCursor(cursor);
    assert.deepStrictEqual(decoded, {
      createdAt: "2026-07-26T08:00:00.000Z",
      id: 42
    });
    assert.strictEqual(decodeNotificationCursor("not-a-cursor"), null);
    assert.strictEqual(decodeNotificationCursor(null), null);

    const unread = buildNotificationInboxFilters(7, { unreadOnly: true, category: "social" });
    assert.ok(unread.conditions.includes("read_at IS NULL"));
    assert.ok(unread.conditions.includes("category = 'social'"));
  });

  await asyncTest("squad leave revokes private destinations (Étape 58)", () => {
    const squad = require("../server/notification-squad-completion");
    const revoked = squad.revokeSquadPrivateDestination({
      squadId: "12",
      squadCode: "BRAVO",
      actionUrl: "/squad/BRAVO/engine",
      group: { groupKey: "squad_progress:12", destination: "/squad/BRAVO/engine" },
      actions: {
        primary: { id: "open_squad_engine", label: "Open", url: "/squad/BRAVO/engine" }
      }
    });
    assert.strictEqual(revoked.accessRevoked, true);
    assert.strictEqual(revoked.accessRevokedReason, "squad_left");
    assert.strictEqual(revoked.actionUrl, undefined);
    assert.strictEqual(revoked.group.destination, null);
    assert.strictEqual(revoked.actions.primary.url, null);
    assert.strictEqual(revoked.squadCode, "BRAVO");
  });

  await asyncTest("block cleanup targets social pending and private pairwise types (Étape 57)", () => {
    const blocks = require("../server/notification-blocks");
    assert.ok(blocks.isPendingSocialType("friend_request_accepted"));
    assert.ok(blocks.isPendingSocialType("friend_request_received"));
    assert.ok(blocks.isPrivatePairwiseType("friend_acquired_missing_variant"));
    assert.ok(blocks.isBlockedPairwiseType("friend_acquired_missing_variant"));
    assert.ok(blocks.isBlockedPairwiseType("friend_request_accepted"));
    assert.ok(!blocks.isBlockedPairwiseType("priority_variant_available"));
    assert.ok(!blocks.isPrivatePairwiseType("squad_completion_increased"));
    const stub = blocks.technicalStubData({
      type: "friend_acquired_missing_variant",
      category: "collection",
      entity_type: "variant",
      entity_id: "v1",
      actor_id: 1,
      recipient_id: 2
    });
    assert.strictEqual(stub.hiddenDueToBlock, true);
    assert.strictEqual(stub.technical.type, "friend_acquired_missing_variant");
    assert.strictEqual(stub.technical.actorId, "1");
    assert.ok(!stub.variantId);
    assert.ok(!stub.variantName);
  });

  await asyncTest("presend revalidation cancels obsolete scheduled pushes (Étape 56)", () => {
    const presend = require("../server/notification-presend");
    assert.deepStrictEqual(
      presend.evaluateFriendshipStillRelevant({ friendshipAccepted: true, blocked: false }),
      { ok: true }
    );
    assert.strictEqual(
      presend.evaluateFriendshipStillRelevant({ friendshipAccepted: false }).reason,
      "friendship_gone"
    );
    assert.strictEqual(
      presend.evaluateFriendAcquisitionStillRelevant({
        friendshipAccepted: true,
        collectionVisible: false,
        remainingVariantCount: 2
      }).reason,
      "collection_private"
    );
    assert.strictEqual(
      presend.evaluateFriendAcquisitionStillRelevant({
        friendshipAccepted: true,
        collectionVisible: true,
        remainingVariantCount: 0
      }).reason,
      "already_owned"
    );
    assert.strictEqual(
      presend.evaluateSquadMembershipStillRelevant({ isActiveMember: false }).reason,
      "squad_left"
    );
    assert.strictEqual(
      presend.evaluatePriorityVariantStillRelevant({
        stillAvailable: false,
        alreadyOwned: false
      }).reason,
      "variant_unavailable"
    );
    assert.strictEqual(
      presend.evaluatePriorityVariantStillRelevant({
        stillAvailable: true,
        alreadyOwned: true
      }).reason,
      "already_owned"
    );
    assert.deepStrictEqual(
      presend.evaluateFriendAcquisitionStillRelevant({
        friendshipAccepted: true,
        collectionVisible: true,
        remainingVariantCount: 1
      }),
      { ok: true }
    );
  });

  await asyncTest("notification grouping preserves count, principals, first/latest, destination (Étape 55)", () => {
    const grouping = require("../server/notification-grouping");
    assert.strictEqual(
      grouping.buildFriendAcquisitionsGroupKey(1, 2),
      "friend_acquisitions:1:2"
    );
    assert.strictEqual(
      grouping.buildSquadProgressGroupKey("squad_bravo_six"),
      "squad_progress:squad_bravo_six"
    );
    assert.strictEqual(
      grouping.buildEventDeadlineGroupKey("event_hot", 42),
      "event_deadline:event_hot:42"
    );

    const friendGroup = grouping.buildFriendAcquisitionsGroup({
      actorId: 1,
      recipientId: 2,
      destination: "/compare/1?variantId=v2",
      variants: [
        {
          eventId: "e1",
          variantId: "v1",
          variantName: "Alpha",
          acquiredAt: "2026-07-26T08:00:00.000Z",
          priorityLevel: "normal"
        },
        {
          eventId: "e2",
          variantId: "v2",
          variantName: "Beta",
          acquiredAt: "2026-07-26T08:05:00.000Z",
          priorityLevel: "strong"
        }
      ]
    });
    assert.strictEqual(friendGroup.groupKey, "friend_acquisitions:1:2");
    assert.strictEqual(friendGroup.eventCount, 2);
    assert.strictEqual(friendGroup.principalElements.length, 2);
    assert.strictEqual(friendGroup.firstEvent.id, "e1");
    assert.strictEqual(friendGroup.mostRecent.id, "e2");
    assert.strictEqual(friendGroup.destination, "/compare/1?variantId=v2");

    const squadGroup = grouping.buildSquadProgressGroup({
      squadId: "squad_bravo_six",
      destination: "/squad/BRAVO/engine",
      items: [
        {
          eventId: "s1",
          occurredAt: "2026-07-26T09:00:00.000Z",
          newCoveredCount: 67,
          newVariantIds: ["a"],
          actorName: "Lucy",
          variantName: "A"
        },
        {
          eventId: "s2",
          occurredAt: "2026-07-26T09:10:00.000Z",
          newCoveredCount: 68,
          milestone: 90,
          newVariantIds: ["b"],
          actorName: "Quentin",
          variantName: "B"
        }
      ]
    });
    assert.strictEqual(squadGroup.groupKey, "squad_progress:squad_bravo_six");
    assert.strictEqual(squadGroup.eventCount, 2);
    assert.strictEqual(squadGroup.firstEvent.id, "s1");
    assert.strictEqual(squadGroup.mostRecent.id, "s2");
    assert.ok(squadGroup.principalElements.some((el) => el.milestone === 90));
    assert.strictEqual(squadGroup.destination, "/squad/BRAVO/engine");

    const deadlineGroup = grouping.buildEventDeadlineGroup({
      eventId: "event_hot",
      recipientId: 42,
      threshold: "24h",
      endingAt: "2026-08-20T23:59:59.000Z",
      domainEventId: "catalogue.event_ending_soon:event_hot:24h",
      variantIds: ["v1", "v2"],
      destination: "/events/event_hot?filter=priority"
    });
    assert.strictEqual(deadlineGroup.groupKey, "event_deadline:event_hot:42");
    assert.strictEqual(deadlineGroup.eventCount, 1);
    assert.strictEqual(deadlineGroup.principalElements.length, 2);
    assert.strictEqual(deadlineGroup.mostRecent.threshold, "24h");
    assert.strictEqual(deadlineGroup.destination, "/events/event_hot?filter=priority");

    const rendered = catalog.renderNotification(
      catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
      grouping.attachGroup({
        actorName: "Lucy",
        friendId: "1",
        variantId: "v2",
        variantName: "Beta",
        count: 2,
        variantIds: ["v1", "v2"]
      }, friendGroup),
      "fr"
    );
    assert.strictEqual(rendered.data.groupKey, "friend_acquisitions:1:2");
    assert.strictEqual(rendered.data.group.eventCount, 2);
    assert.strictEqual(rendered.data.group.destination, "/compare/1?variantId=v2");
  });

  // Étape 13 — friend_request_accepted content (title, body, data, actions)
  await asyncTest("friend_request_accepted content matches Étape 13 (FR/EN, data, actions)", () => {
    const type = catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED;
    const ctx = {
      actorName: "LucySprite",
      friendId: "user_lucy",
      friendshipId: "friendship_123"
    };
    const fr = catalog.renderNotification(type, ctx, "fr");
    assert.strictEqual(fr.title, "LucySprite a accepté votre invitation");
    assert.strictEqual(fr.body, "Vous pouvez maintenant comparer vos collections.");
    assert.strictEqual(fr.data.friendId, "user_lucy");
    assert.strictEqual(fr.data.friendshipId, "friendship_123");
    assert.strictEqual(fr.data.actionUrl, "/compare/user_lucy");
    assert.strictEqual(fr.data.translationKey, "notifications.friend_request_accepted");
    assert.strictEqual(fr.data.translationParams.friendName, "LucySprite");
    assert.strictEqual(fr.url, "/compare/user_lucy");
    assert.strictEqual(fr.actions.primary.label, "Comparer nos collections");
    assert.strictEqual(fr.actions.primary.url, "/compare/user_lucy");
    assert.strictEqual(fr.actions.secondary.label, "Voir le profil");
    assert.strictEqual(fr.actions.secondary.url, "/profile/user_lucy");

    const en = catalog.renderNotification(type, ctx, "en");
    assert.strictEqual(en.title, "LucySprite accepted your friend request");
    assert.strictEqual(en.body, "You can now compare your collections.");
    assert.strictEqual(en.actions.primary.label, "Compare our collections");
    assert.strictEqual(en.actions.secondary.label, "View profile");
    assert.deepStrictEqual(en.data, fr.data);
  });

  // Étape 12 — conditions before creating friend_request_accepted
  await asyncTest("friendship.accepted conditions gate rejects invalid cases (Étape 12)", () => {
    const { evaluateFriendshipAcceptedConditions } = require("../server/notification-gates");
    const base = {
      requesterId: "1",
      accepterId: "2",
      previousStatus: "pending",
      friendshipExists: true,
      friendshipStatus: "accepted",
      blocked: false,
      socialEnabled: true,
      typeEnabled: true
    };
    assert.deepStrictEqual(evaluateFriendshipAcceptedConditions(base), { ok: true });
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, friendshipExists: false }).reason, "invitation_missing");
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, previousStatus: "accepted" }).reason, "previous_not_pending");
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, friendshipStatus: "pending" }).reason, "friendship_not_active");
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, blocked: true }).reason, "blocked");
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, socialEnabled: false }).reason, "social_disabled");
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, typeEnabled: false }).reason, "type_disabled");
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, accepterId: "1" }).reason, "self_action");
    assert.strictEqual(evaluateFriendshipAcceptedConditions({ ...base, requesterId: null }).reason, "missing_parties");
  });

  // Étape 46 — notification center inbox filters
  await asyncTest("notification center filters map to inbox query conditions", () => {
    const { buildNotificationInboxFilters } = require("../push-service");
    const base = buildNotificationInboxFilters(7, { filter: "all" });
    assert.ok(base.conditions.includes("status <> 'cancelled'"));
    assert.ok(base.conditions.includes("hidden_at IS NULL"));
    assert.ok(!base.conditions.some(c => c.includes("read_at IS NULL")));

    const unread = buildNotificationInboxFilters(7, { filter: "unread" });
    assert.ok(unread.conditions.includes("read_at IS NULL"));

    const social = buildNotificationInboxFilters(7, { filter: "social" });
    assert.ok(social.conditions.includes("category = 'social'"));

    const alerts = buildNotificationInboxFilters(7, { filter: "alerts" });
    assert.ok(alerts.conditions.includes("category = 'alerts'"));

    const squads = buildNotificationInboxFilters(7, { filter: "squads" });
    assert.ok(squads.conditions.some(c => c.includes("squad_completion_increased")));

    const collections = buildNotificationInboxFilters(7, { filter: "collection" });
    assert.ok(collections.conditions.includes("category = 'collection'"));
    assert.ok(collections.conditions.some(c => c.includes("NOT LIKE 'squad_%'")));
  });

  // Étape 53 — send priority scores
  await asyncTest("send priority scores gate push when daily limit is hit (Étape 53)", async () => {
    const channels = require("../server/notification-channels");
    const {
      NOTIFICATION_TYPES,
      SEND_PRIORITY_LEVELS,
      resolveSendPriority,
      classifySendPriority,
      PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE
    } = catalog;

    assert.deepStrictEqual(SEND_PRIORITY_LEVELS, {
      CRITICAL: 100,
      HIGH: 75,
      NORMAL: 50,
      LOW: 25
    });
    assert.strictEqual(PUSH_DAILY_LIMIT_BYPASS_MIN_SCORE, 90);

    assert.strictEqual(resolveSendPriority(NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE), 90);
    assert.strictEqual(
      resolveSendPriority(NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON, { threshold: "24h" }),
      90
    );
    assert.strictEqual(
      resolveSendPriority(NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON, { threshold: "3d" }),
      75
    );
    assert.strictEqual(resolveSendPriority(NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED), 70);
    assert.strictEqual(
      resolveSendPriority(NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED, { milestone: 90, kind: "milestone" }),
      65
    );
    assert.strictEqual(
      resolveSendPriority(NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED, { kind: "progress" }),
      35
    );
    assert.strictEqual(resolveSendPriority(NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT), 50);

    assert.strictEqual(classifySendPriority(100), "critical");
    assert.strictEqual(classifySendPriority(90), "high");
    assert.strictEqual(classifySendPriority(50), "normal");
    assert.strictEqual(classifySendPriority(35), "low");

    const poolAtCap = {
      async query(sql) {
        if (/notification_deliveries/i.test(sql)) return { rows: [{ c: 8 }] };
        return { rows: [{ c: 8 }] };
      }
    };

    // Lower priority → no push when the daily cap is reached (in-app still created elsewhere).
    assert.strictEqual(
      await channels.isPushFrequencyExceeded(poolAtCap, 1, 8, {
        type: NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT,
        timeZone: "UTC"
      }),
      true
    );
    assert.strictEqual(
      await channels.isPushFrequencyExceeded(poolAtCap, 1, 8, {
        type: NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED,
        context: { kind: "progress" },
        timeZone: "UTC"
      }),
      true
    );

    // Score ≥ 90 still allowed to push despite the cap.
    assert.strictEqual(
      await channels.isPushFrequencyExceeded(poolAtCap, 1, 8, {
        type: NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE,
        timeZone: "UTC"
      }),
      false
    );
    assert.strictEqual(
      await channels.isPushFrequencyExceeded(poolAtCap, 1, 8, {
        type: NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON,
        context: { threshold: "24h" },
        timeZone: "UTC"
      }),
      false
    );
  });

  // Étape 52 — global push daily safety limit
  await asyncTest("global push daily limit is 8 with critical exceptions (Étape 52)", async () => {
    const channels = require("../server/notification-channels");
    assert.strictEqual(catalog.DEFAULT_PUSH_MAX_PER_DAY, 8);
    assert.strictEqual(catalog.resolvePushDailyLimit(undefined), 8);
    assert.strictEqual(catalog.resolvePushDailyLimit(null), 8);
    assert.strictEqual(catalog.resolvePushDailyLimit(0), 0);
    assert.strictEqual(catalog.resolvePushDailyLimit(12), 12);

    assert.ok(catalog.isExemptFromPushDailyLimit("account_security"));
    assert.ok(catalog.isExemptFromPushDailyLimit("legal_notice"));
    assert.ok(catalog.isExemptFromPushDailyLimit("service_critical"));
    assert.ok(catalog.isExemptFromPushDailyLimit("custom", { critical: true }));
    // Ordinary / mid scores stay under the cap; score ≥ 90 bypasses (Étape 53).
    assert.ok(!catalog.isExemptFromPushDailyLimit("friend_request_accepted"));
    assert.ok(catalog.isExemptFromPushDailyLimit("priority_variant_available"));
    assert.ok(!catalog.isExemptFromPushDailyLimit("wanted_event_ending_soon"));
    assert.ok(
      catalog.isExemptFromPushDailyLimit("wanted_event_ending_soon", { threshold: "24h" })
    );

    const queries = [];
    const pool = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (/notification_deliveries/i.test(sql)) {
          return { rows: [{ c: 8 }] };
        }
        return { rows: [{ c: 0 }] };
      }
    };

    // Ordinary SpriteDex notification blocked at the cap.
    assert.strictEqual(
      await channels.isPushFrequencyExceeded(pool, 1, 8, {
        type: catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
        timeZone: "UTC",
        now: new Date("2026-07-26T12:00:00Z")
      }),
      true
    );

    // Critical exception bypasses the cap even when count >= limit.
    assert.strictEqual(
      await channels.isPushFrequencyExceeded(pool, 1, 8, {
        type: "account_security",
        timeZone: "UTC",
        now: new Date("2026-07-26T12:00:00Z")
      }),
      false
    );

    // Unlimited (0) never exceeds.
    assert.strictEqual(
      await channels.isPushFrequencyExceeded(pool, 1, 0, {
        type: catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED
      }),
      false
    );

    const dayStart = channels.startOfLocalDay(new Date("2026-07-26T15:30:00Z"), "UTC");
    assert.strictEqual(dayStart.toISOString(), "2026-07-26T00:00:00.000Z");
  });

  // Étape 51 — recommended default delivery matrix
  await asyncTest("default delivery matrix matches recommended settings (Étape 51)", () => {
    const {
      NOTIFICATION_TYPES,
      PUSH_MODES,
      DEFAULT_TYPE_DELIVERY,
      shouldAllowPushForDelivery,
      getDefaultTypeDelivery,
      getNotificationSettingsScreen
    } = catalog;

    assert.deepStrictEqual(DEFAULT_TYPE_DELIVERY[NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED], {
      inApp: true,
      push: PUSH_MODES.ENABLED
    });
    assert.deepStrictEqual(DEFAULT_TYPE_DELIVERY[NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT], {
      inApp: true,
      push: PUSH_MODES.PRIORITIES_ONLY
    });
    assert.deepStrictEqual(DEFAULT_TYPE_DELIVERY[NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED], {
      inApp: true,
      push: PUSH_MODES.MILESTONES_ONLY
    });
    assert.deepStrictEqual(DEFAULT_TYPE_DELIVERY[NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE], {
      inApp: true,
      push: PUSH_MODES.ENABLED
    });
    assert.deepStrictEqual(DEFAULT_TYPE_DELIVERY[NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON], {
      inApp: true,
      push: PUSH_MODES.ENABLED
    });

    assert.strictEqual(
      shouldAllowPushForDelivery("priorities_only", { priorityLevel: "strong" }),
      true
    );
    assert.strictEqual(
      shouldAllowPushForDelivery("priorities_only", { priorityLevel: "normal" }),
      false
    );
    assert.strictEqual(
      shouldAllowPushForDelivery("milestones_only", { milestone: 50, kind: "milestone" }),
      true
    );
    assert.strictEqual(
      shouldAllowPushForDelivery("milestones_only", { kind: "progress", milestone: null }),
      false
    );
    assert.strictEqual(shouldAllowPushForDelivery("enabled", {}), true);
    assert.strictEqual(shouldAllowPushForDelivery("disabled", { milestone: 100 }), false);

    const screen = getNotificationSettingsScreen("fr");
    const acquired = screen.groups.flatMap((g) => g.types)
      .find((t) => t.id === NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT);
    assert.strictEqual(acquired.defaultPush, "priorities_only");
    assert.strictEqual(acquired.defaultInApp, true);
    assert.ok(acquired.pushModes.some((m) => m.id === "priorities_only"));

    const defaults = prefs.defaultTypeDelivery();
    assert.strictEqual(defaults[NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED].push, "milestones_only");
    assert.strictEqual(
      getDefaultTypeDelivery(NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED).push,
      "enabled"
    );
  });

  // Étape 50 — configurable frequencies
  await asyncTest("notification frequencies default alerts to immediate (Étape 50)", () => {
    const {
      NOTIFICATION_FREQUENCIES,
      NOTIFICATION_TYPES,
      FREQUENCY_CONFIGURABLE_TYPES,
      getDefaultFrequency,
      normalizeFrequency,
      isFrequencyConfigurable,
      getFrequencyLabel,
      getNotificationSettingsScreen
    } = catalog;
    const { nextDailyDigestAt } = require("../server/timezone");

    assert.deepStrictEqual(
      [...catalog.NOTIFICATION_FREQUENCY_LIST],
      ["immediate", "daily_digest", "disabled"]
    );
    assert.ok(FREQUENCY_CONFIGURABLE_TYPES.includes(NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT));
    assert.ok(FREQUENCY_CONFIGURABLE_TYPES.includes(NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE));
    assert.ok(FREQUENCY_CONFIGURABLE_TYPES.includes(NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON));
    assert.ok(!isFrequencyConfigurable(NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED));

    assert.strictEqual(
      getDefaultFrequency(NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE),
      NOTIFICATION_FREQUENCIES.IMMEDIATE
    );
    assert.strictEqual(
      getDefaultFrequency(NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON),
      NOTIFICATION_FREQUENCIES.IMMEDIATE
    );
    assert.strictEqual(
      getDefaultFrequency(NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT),
      NOTIFICATION_FREQUENCIES.IMMEDIATE
    );
    assert.strictEqual(normalizeFrequency("daily_digest"), "daily_digest");
    assert.strictEqual(normalizeFrequency("nope", NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE), "immediate");
    assert.strictEqual(getFrequencyLabel("daily_digest", "fr"), "Résumé quotidien");
    assert.strictEqual(getFrequencyLabel("immediate", "fr"), "Immédiatement");
    assert.strictEqual(getFrequencyLabel("disabled", "fr"), "Désactivé");

    assert.strictEqual(prefs.evaluateTypeActive({ typeEnabled: true, frequency: "immediate" }), true);
    assert.strictEqual(prefs.evaluateTypeActive({ typeEnabled: true, frequency: "daily_digest" }), true);
    assert.strictEqual(prefs.evaluateTypeActive({ typeEnabled: true, frequency: "disabled" }), false);

    const screen = getNotificationSettingsScreen("fr");
    assert.ok(screen.frequencies.some((f) => f.id === "daily_digest"));
    const acquired = screen.groups
      .flatMap((g) => g.types)
      .find((t) => t.id === NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT);
    assert.ok(acquired.frequencyConfigurable);
    assert.strictEqual(acquired.defaultFrequency, "immediate");

    const digestAt = nextDailyDigestAt(new Date("2026-07-26T07:00:00Z"), "UTC", 9);
    assert.ok(digestAt instanceof Date);
    assert.strictEqual(digestAt.toISOString(), "2026-07-26T09:00:00.000Z");
    const after = nextDailyDigestAt(new Date("2026-07-26T10:00:00Z"), "UTC", 9);
    assert.strictEqual(after.toISOString(), "2026-07-27T09:00:00.000Z");
  });

  // Étape 49 — settings screen organization
  await asyncTest("notification settings screen covers channels, types and comfort (Étape 49)", () => {
    const screen = catalog.getNotificationSettingsScreen("fr");
    assert.strictEqual(screen.title, "Notifications");
    assert.deepStrictEqual(screen.channels.map((c) => c.id), ["in_app", "push", "email"]);
    assert.strictEqual(screen.channels[0].label, "Dans l'application");
    assert.strictEqual(screen.channels[1].label, "Notifications push");
    assert.strictEqual(screen.channels[2].label, "E-mails");

    assert.deepStrictEqual(screen.groups.map((g) => g.id), ["social", "collection", "alerts"]);
    assert.strictEqual(screen.groups[0].label, "Social");
    assert.strictEqual(screen.groups[0].types[0].id, "friend_request_accepted");
    assert.strictEqual(screen.groups[0].types[0].label, "Invitations d'amis acceptées");
    assert.strictEqual(screen.groups[1].label, "Collections et squads");
    assert.deepStrictEqual(
      screen.groups[1].types.map((t) => t.id),
      ["friend_acquired_missing_variant", "squad_completion_increased"]
    );
    assert.strictEqual(screen.groups[2].label, "Priorités et événements");
    assert.deepStrictEqual(
      screen.groups[2].types.map((t) => t.id),
      ["priority_variant_available", "wanted_event_ending_soon"]
    );
    assert.deepStrictEqual(screen.comfort.map((c) => c.id), ["quiet_hours", "timezone"]);
    assert.strictEqual(screen.comfort[0].label, "Heures silencieuses");
    assert.strictEqual(screen.comfort[1].label, "Fuseau horaire");

    // Every contextual type appears exactly once in the settings tree.
    const typeIds = screen.groups.flatMap((g) => g.types.map((t) => t.id));
    assert.deepStrictEqual([...typeIds].sort(), [...catalog.CONTEXTUAL_NOTIFICATION_TYPES].sort());
  });

  // Étape 48 — contextual destinations never resolve to home
  await asyncTest("contextual destinations are type-specific and never home (Étape 48)", () => {
    const {
      buildFriendCompareActionUrl,
      buildSquadEngineActionUrl,
      buildPriorityVariantActionUrl,
      buildWantedEventActionUrl,
      NOTIFICATION_TYPES
    } = catalog;

    assert.strictEqual(
      buildFriendCompareActionUrl({ friendId: "u1" }),
      "/compare/u1"
    );
    assert.strictEqual(
      buildFriendCompareActionUrl({ friendId: "u1", variantId: "v1" }, { withVariant: true }),
      "/compare/u1?variantId=v1"
    );
    assert.strictEqual(buildSquadEngineActionUrl({ squadCode: "ALPHA" }), "/squad/ALPHA/engine");
    assert.strictEqual(
      buildPriorityVariantActionUrl({ spriteId: "s1", variantType: "Gold" }),
      "/sprites/s1?variant=Gold"
    );
    assert.strictEqual(
      buildWantedEventActionUrl({ eventId: "e1" }),
      "/events/e1?filter=priority"
    );

    // Incomplete context must not collapse to "/".
    assert.strictEqual(buildFriendCompareActionUrl({}), null);
    assert.strictEqual(buildSquadEngineActionUrl({}), null);
    assert.strictEqual(buildPriorityVariantActionUrl({}), null);
    assert.strictEqual(buildWantedEventActionUrl({}), null);

    const accepted = catalog.renderNotification(NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED, {
      friendId: "friend_9", actorName: "Ada"
    }, "fr");
    assert.strictEqual(accepted.url, "/compare/friend_9");
    assert.notStrictEqual(accepted.url, "/");

    const squad = catalog.renderNotification(NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED, {
      squadCode: "ZULU", squadName: "Zulu", kind: "progress", newRate: 10
    }, "fr");
    assert.strictEqual(squad.url, "/squad/ZULU/engine");
  });

  // Étape 47 — read / click actions
  await asyncTest("markNotificationRead sets read_at and optional clicked_at (Étape 47)", async () => {
    const { markNotificationRead, markAllNotificationsRead } = require("../push-service");
    const calls = [];
    const pool = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/UPDATE notifications SET[\s\S]*read_at = COALESCE/i.test(sql)) {
          return {
            rows: [{
              id: params[0],
              read_at: new Date("2026-07-26T08:00:00Z"),
              clicked_at: params[2] ? new Date("2026-07-26T08:00:00Z") : null,
              status: "read"
            }]
          };
        }
        if (/UPDATE notifications SET read_at = NOW\(\),\s*status = 'read'/i.test(sql)) {
          return { rowCount: 3, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }
    };

    const clicked = await markNotificationRead(pool, 42, 99, { clicked: true });
    assert.ok(clicked);
    assert.strictEqual(clicked.status, "read");
    assert.ok(clicked.clicked_at);
    assert.strictEqual(calls[0].params[2], true);

    const readOnly = await markNotificationRead(pool, 42, 100, { clicked: false });
    assert.ok(readOnly);
    assert.strictEqual(calls[1].params[2], false);

    const missing = await markNotificationRead(pool, 42, "nope");
    assert.strictEqual(missing, null);

    const updated = await markAllNotificationsRead(pool, 42);
    assert.strictEqual(updated, 3);
  });

  // Étape 11 — friendship.accepted trigger envelope
  await asyncTest("friendship.accepted envelope targets the original requester only", async () => {
    const EV = bus.DOMAIN_EVENTS.FRIENDSHIP_ACCEPTED;
    bus.removeAllDomainListeners(EV);
    let seen = null;
    bus.onDomainEvent(EV, (event) => { seen = event; });
    const emitted = await bus.emitDomainEvent(EV, {
      actorId: "user_lucy",          // accepter
      entityType: "user",
      entityId: "user_quentin",      // original requester = notification recipient
      context: {
        previousStatus: "pending",
        newStatus: "accepted",
        requesterId: "user_quentin",
        accepterId: "user_lucy"
      }
    });
    assert.ok(seen);
    assert.strictEqual(seen.eventType, "friendship.accepted");
    assert.strictEqual(seen.eventId, emitted.eventId);
    assert.strictEqual(seen.actorId, "user_lucy");
    assert.strictEqual(seen.entityId, "user_quentin");
    assert.strictEqual(seen.context.previousStatus, "pending");
    assert.strictEqual(seen.context.newStatus, "accepted");
    // Recipient rule: requester ≠ accepter
    assert.notStrictEqual(seen.entityId, seen.actorId);
    bus.removeAllDomainListeners(EV);
  });

  // Étape 72 — readiness criteria (see NOTIFICATIONS_VALIDATION.md)
  await asyncTest("notification system readiness criteria (Étape 72)", async () => {
    const bus = require("../server/event-bus");
    const gates = require("../server/notification-gates");
    const prefs = require("../server/notification-preferences");
    const channels = require("../server/notification-channels");
    const quiet = require("../server/notification-quiet-hours");
    const dedupe = require("../server/notification-dedupe");
    const grouping = require("../server/notification-grouping");
    const presend = require("../server/notification-presend");
    const blocks = require("../server/notification-blocks");
    const squad = require("../server/notification-squad-completion");
    const deliveryQueue = require("../server/notification-delivery-queue");
    const pushSubscriptions = require("../server/push-subscriptions");

    // 1) Five notifications can be generated
    assert.strictEqual(catalog.CONTEXTUAL_NOTIFICATION_TYPES.length, 5);
    for (const type of catalog.CONTEXTUAL_NOTIFICATION_TYPES) {
      const rendered = catalog.renderNotification(type, {
        actorName: "Lucy",
        friendId: "7",
        variantId: "v1",
        variantName: "Alpha",
        spriteId: "s1",
        variantType: "Gold",
        squadName: "Bravo",
        squadCode: "BRAVO",
        squadId: "12",
        eventName: "Summer",
        eventId: "event_summer",
        endingAt: "2026-08-20T12:00:00Z",
        remainingCount: 2,
        remainingPriorityVariantIds: ["v1", "v2"],
        threshold: "3d",
        newRate: 42,
        previousRate: 40,
        count: 1,
        kind: "progress",
        recipientCollectionStatus: "missing",
        priorityLevel: "normal",
        timeZone: "UTC",
        now: "2026-08-17T12:00:00Z"
      }, "fr");
      assert.ok(rendered && rendered.title && rendered.body, `render failed for ${type}`);
      assert.ok(rendered.url && rendered.url !== "/", `${type} must not open home`);
    }

    // 2) Precise triggers (stable domain event ids)
    assert.deepStrictEqual(bus.DOMAIN_EVENTS, {
      FRIENDSHIP_ACCEPTED: "friendship.accepted",
      COLLECTION_VARIANT_ACQUIRED: "collection.variant_acquired",
      SQUAD_COMPLETION_CHANGED: "squad.completion_changed",
      CATALOGUE_VARIANT_AVAILABLE: "catalogue.variant_available",
      CATALOGUE_EVENT_ENDING_SOON: "catalogue.event_ending_soon"
    });

    // 3–4) Preferences + separate categories
    assert.strictEqual(
      prefs.evaluateDelivery({ pushEnabled: true, categoryEnabled: false, typeEnabled: true }),
      false
    );
    assert.strictEqual(prefs.evaluateTypeActive({ typeEnabled: false }), false);
    const cats = catalog.NOTIFICATION_SETTINGS_SCREEN.groups.map((g) => g.category);
    assert.deepStrictEqual(cats, ["social", "collection", "alerts"]);

    // 5) Push requires consent
    const noConsent = await channels.evaluatePushConstraints(
      { async query() { return { rows: [{ c: 0 }] }; } },
      1,
      { push_enabled: false, push_quiet_start: null, push_quiet_end: null, push_max_per_day: 8, timezone: "UTC" }
    );
    assert.deepStrictEqual(noConsent, { allowed: false, reason: "no_consent" });

    // 6) Quiet hours
    assert.ok(channels.isInQuietHours(22, 7, new Date("2026-07-20T21:30:00Z"), "Europe/Paris"));
    const deferred = quiet.resolveQuietHoursDeferral({
      start: 22,
      end: 8,
      now: new Date("2026-07-20T21:30:00Z"),
      timeZone: "Europe/Paris",
      urgent: false
    });
    assert.ok(deferred.defer, "non-urgent push must defer during quiet hours");

    // 7) Dedupe keys exist for all five families
    assert.ok(dedupe.buildFriendAcceptDedupeKey("f1", 1));
    assert.ok(dedupe.buildFriendVariantDedupeKey(1, 2, "v", "2026-07-26T00:00:00.000Z"));
    assert.ok(dedupe.buildSquadCompletionDedupeKey("s1", 10));
    assert.ok(dedupe.buildPriorityAvailableDedupeKey(1, "v", "p1"));
    assert.ok(dedupe.buildEventEndingDedupeKey(1, "e1", "3d"));

    // 8) Grouping
    assert.strictEqual(
      grouping.buildFriendAcquisitionsGroup({
        actorId: 1,
        recipientId: 2,
        variants: [
          { eventId: "a", variantId: "v1", acquiredAt: "2026-07-26T08:00:00.000Z" },
          { eventId: "b", variantId: "v2", acquiredAt: "2026-07-26T08:01:00.000Z" }
        ],
        destination: "/compare/1"
      }).eventCount,
      2
    );

    // 9) Private collections never revealed
    assert.strictEqual(
      presend.evaluateFriendAcquisitionStillRelevant({
        friendshipAccepted: true,
        collectionVisible: false,
        remainingVariantCount: 1
      }).reason,
      "collection_private"
    );

    // 10) Blocks + squad leave
    assert.ok(blocks.isBlockedPairwiseType("friend_request_accepted"));
    assert.ok(blocks.isBlockedPairwiseType("friend_acquired_missing_variant"));
    const revoked = squad.revokeSquadPrivateDestination({
      actionUrl: "/squad/X/engine",
      actions: { primary: { url: "/squad/X/engine" } }
    });
    assert.strictEqual(revoked.accessRevoked, true);

    // 11) Correct screens (already checked !== "/" above) + typed builders
    assert.ok(String(catalog.buildFriendCompareActionUrl({ friendId: "7" })).startsWith("/compare/"));
    assert.ok(String(catalog.buildSquadEngineActionUrl({ squadCode: "BRAVO" })).includes("/squad/"));
    assert.ok(String(catalog.buildWantedEventActionUrl({ eventId: "e1" })).startsWith("/events/"));

    // 12) Obsolete can be cancelled
    assert.deepStrictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 0,
        eventActive: true,
        endDateUnchanged: true,
        prefsAccepted: true
      }),
      { ok: false, reason: "no_remaining_priority", cancel: true }
    );
    assert.strictEqual(
      presend.evaluateFriendshipStillRelevant({ friendshipAccepted: false }).cancel,
      true
    );

    // 13) Failed sends do not block core paths (queue + permanent token handling)
    assert.ok(deliveryQueue.QUEUE_STATUSES.FAILED);
    assert.ok(deliveryQueue.DEFAULT_MAX_ATTEMPTS >= 3);
    assert.ok(pushSubscriptions.isPermanentProviderFailure({ statusCode: 410 }));
    assert.ok(!pushSubscriptions.isPermanentProviderFailure({ statusCode: 503 }));
  });

  // Étape 69 — load suite smoke (full scale lives in test/notification-load.test.js)
  await asyncTest("notification load helpers stay consistent at small scale (Étape 69)", () => {
    const grouping = require("../server/notification-grouping");
    const pushSubscriptions = require("../server/push-subscriptions");
    const deliveryQueue = require("../server/notification-delivery-queue");

    const variants = Array.from({ length: 12 }, (_, i) => ({
      eventId: `e${i}`,
      variantId: `v${i}`,
      acquiredAt: `2026-07-26T09:00:${String(i).padStart(2, "0")}.000Z`
    }));
    const group = grouping.buildFriendAcquisitionsGroup({
      actorId: 1,
      recipientId: 2,
      variants,
      destination: "/compare/1"
    });
    assert.strictEqual(group.eventCount, 12);
    assert.ok(pushSubscriptions.isPermanentProviderFailure({ statusCode: 410 }));
    assert.ok(!pushSubscriptions.isPermanentProviderFailure({ statusCode: 503 }));
    assert.ok(deliveryQueue.DEFAULT_MAX_ATTEMPTS >= 3);
  });

  // Étape 68 — notification security contract (unit-level)
  await asyncTest("notification security: revoked action and public vapid only (Étape 68)", () => {
    const serialize = require("../server/notification-serialize");
    const squad = require("../server/notification-squad-completion");
    const pushService = require("../push-service");

    const revoked = squad.revokeSquadPrivateDestination({
      actionUrl: "/squad/BRAVO/engine",
      actions: { primary: { label: "Ouvrir", url: "/squad/BRAVO/engine" } },
      group: { destination: "/squad/BRAVO/engine" }
    });
    assert.strictEqual(revoked.accessRevoked, true);
    const normalized = serialize.normalizeNotification({
      id: 55,
      type: "squad_completion_increased",
      category: "collection",
      title: "Squad progresse",
      body: "…",
      entity_type: "squad",
      entity_id: "12",
      created_at: "2026-07-26T10:00:00.000Z",
      read_at: null,
      data: revoked
    }, null);
    assert.strictEqual(normalized.action, null, "revoked destinations must not expose action.url");

    const publicKey = pushService.getVapidPublicKey();
    assert.ok(publicKey && publicKey.length > 20);
    // Module must not export a getter for the private key.
    assert.strictEqual(typeof pushService.getVapidPrivateKey, "undefined");
    assert.ok(!("vapidPrivateKey" in pushService));
  });

  // Étape 67 — wanted event ending-soon contract (unit-level)
  await asyncTest("wanted_event_ending_soon thresholds, TZ, cancel rules (Étape 67)", () => {
    const gates = require("../server/notification-gates");
    const tz = require("../server/timezone");
    const now = new Date("2026-07-20T12:00:00Z");

    // Thresholds: 7d / 3d / 24h (tightest wins).
    assert.strictEqual(gates.classifyWantedEventThreshold("2026-07-20T20:00:00Z", now), "24h");
    assert.strictEqual(gates.classifyWantedEventThreshold("2026-07-22T12:00:00Z", now), "3d");
    assert.strictEqual(gates.classifyWantedEventThreshold("2026-07-26T12:00:00Z", now), "7d");
    assert.strictEqual(gates.classifyWantedEventThreshold("2026-08-20T12:00:00Z", now), null);
    assert.ok(gates.isWantedEventThresholdAllowed({ thresholdId: "3d" }).ok);
    assert.ok(
      gates.isWantedEventThresholdAllowed({
        thresholdId: "24h",
        hasStrongPriority: true
      }).ok
    );
    assert.ok(
      gates.isWantedEventThresholdAllowed({
        thresholdId: "7d",
        enabledThresholdIds: ["7d", "3d"]
      }).ok
    );

    // Timezones: same UTC end looks like "demain" in Paris, "aujourd'hui" in UTC.
    const endingAt = "2026-07-21T22:00:00Z";
    const nowParis = new Date("2026-07-21T10:00:00Z");
    assert.strictEqual(tz.calendarDaysUntil(endingAt, nowParis, "Europe/Paris"), 1);
    assert.strictEqual(tz.calendarDaysUntil(endingAt, nowParis, "UTC"), 0);
    const frParis = catalog.renderNotification(
      catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON,
      {
        eventName: "Hot Bat Summer",
        eventId: "event_hot",
        endingAt,
        remainingCount: 2,
        threshold: "24h",
        timeZone: "Europe/Paris",
        now: nowParis.toISOString()
      },
      "fr"
    );
    assert.strictEqual(frParis.title, "Hot Bat Summer se termine demain");
    assert.strictEqual(frParis.data.timeZone, "Europe/Paris");
    const frUtc = catalog.formatEventEndingWhen({
      endingAt,
      timeZone: "UTC",
      now: nowParis.toISOString(),
      threshold: "24h"
    }, "fr");
    assert.strictEqual(frUtc, "aujourd'hui");

    // Modified / extended end dates → cancel before send.
    assert.strictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 2,
        eventActive: true,
        endDateUnchanged: false,
        prefsAccepted: true
      }).reason,
      "end_date_changed"
    );
    assert.notStrictEqual(
      gates.normalizeEndDateKey("2026-08-20T23:59:59.000Z"),
      gates.normalizeEndDateKey("2026-08-27T23:59:59.000Z")
    );
    // pg DATE → local midnight must keep the civil calendar day.
    const pgDate = new Date(2026, 7, 20, 0, 0, 0, 0); // 20 Aug local
    assert.strictEqual(gates.normalizeEndDateKey(pgDate), "2026-08-20");
    assert.strictEqual(
      gates.normalizeEndDateKey(pgDate),
      gates.normalizeEndDateKey("2026-08-20T12:00:00.000Z")
    );

    // Priorities already obtained / nothing left → cancel.
    assert.strictEqual(
      gates.evaluateWantedEventVariantInterest({
        status: "priority",
        owned: true,
        stillAvailable: true
      }).reason,
      "already_owned"
    );
    assert.deepStrictEqual(
      gates.evaluateWantedEventPreSend({
        remainingCount: 0,
        eventActive: true,
        endDateUnchanged: true,
        prefsAccepted: true
      }),
      { ok: false, reason: "no_remaining_priority", cancel: true }
    );

    // Unconfirmed end date → no affirmative alert.
    assert.strictEqual(
      gates.evaluateWantedEventEndDateReliability({
        endDate: "2026-08-20T23:59:59Z",
        confidence: "estimated"
      }).reason,
      "end_date_untrusted"
    );
    assert.strictEqual(
      gates.evaluateWantedEventEndDateReliability({
        endDate: "2026-08-20T23:59:59Z",
        confidence: "observed"
      }).reason,
      "end_date_untrusted"
    );
    assert.ok(
      gates.evaluateWantedEventEndDateReliability({
        endDate: "2026-08-20T23:59:59Z",
        confidence: "official"
      }).ok
    );
  });

  // Étape 66 — priority variant availability contract (unit-level)
  await asyncTest("priority_variant_available gates and period dedupe (Étape 66)", () => {
    const gates = require("../server/notification-gates");
    const dedupe = require("../server/notification-dedupe");

    // Must become available_now from a non-available status.
    assert.strictEqual(gates.classifyAvailabilityStatus("available"), "available_now");
    assert.ok(gates.isVariantAvailableTransition("upcoming", "available_now"));
    assert.ok(gates.isVariantAvailableTransition("ended", "available"));
    assert.ok(gates.isVariantAvailableTransition("not_observed", "available_now"));
    assert.ok(!gates.isVariantAvailableTransition("available_now", "available_now"));
    assert.ok(!gates.isVariantAvailableTransition("available", "available"));

    // Confidence must be trusted.
    assert.ok(gates.isTrustedAvailabilityConfidence("official"));
    assert.ok(gates.isTrustedAvailabilityConfidence("observed"));
    assert.ok(gates.isTrustedAvailabilityConfidence("confirmed"));
    assert.ok(!gates.isTrustedAvailabilityConfidence("estimated"));
    assert.ok(!gates.isTrustedAvailabilityConfidence("unverified"));
    assert.ok(!gates.isTrustedAvailabilityConfidence("unknown"));

    // Same period → same key; new period → new key (return can re-alert).
    assert.strictEqual(
      gates.buildPriorityVariantAvailableDedupeKey(7, "v1", "period_a"),
      "priority_available:7:v1:period_a"
    );
    assert.strictEqual(
      dedupe.buildPriorityAvailableDedupeKey(7, "v1", "period_a"),
      dedupe.buildPriorityAvailableDedupeKey(7, "v1", "period_a")
    );
    assert.notStrictEqual(
      dedupe.buildPriorityAvailableDedupeKey(7, "v1", "period_a"),
      dedupe.buildPriorityAvailableDedupeKey(7, "v1", "period_b")
    );

    const type = catalog.NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE;
    const rendered = catalog.renderNotification(type, {
      variantName: "Batman Holofoil",
      variantId: "sprite_batman_holofoil",
      spriteId: "sprite_batman",
      variantType: "Holofoil",
      confidence: "official",
      availabilityPeriodId: "period_a",
      availableUntil: "2026-08-20T23:59:59Z"
    }, "fr");
    assert.ok(/disponible/i.test(rendered.title));
    assert.strictEqual(rendered.data.confidence, "official");
    assert.strictEqual(rendered.data.availabilityPeriodId, "period_a");
  });

  // Étape 65 — squad progression contract (unit-level)
  await asyncTest("squad_completion_increased rates, paliers and grouping (Étape 65)", () => {
    const gates = require("../server/notification-gates");
    const grouping = require("../server/notification-grouping");

    assert.deepStrictEqual(gates.SQUAD_MILESTONES, [25, 50, 75, 80, 90, 95, 100]);
    assert.strictEqual(gates.crossedSquadMilestone(14.29, 28.57), 25);
    assert.strictEqual(gates.crossedSquadMilestone(42.86, 57.14), 50);
    assert.strictEqual(gates.crossedSquadMilestone(28.57, 42.86), null);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: 25 }), true);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: null }), false);

    const type = catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED;
    const progress = catalog.renderNotification(type, {
      squadName: "Alpha",
      squadCode: "ALPHA1",
      previousRate: 14.29,
      newRate: 28.57,
      previousCoveredCount: 1,
      newCoveredCount: 2,
      totalVariants: 7,
      kind: "progress",
      count: 1
    }, "fr");
    assert.ok(progress.body.includes("28.6") || progress.body.includes("28.57"));
    assert.strictEqual(progress.data.previousRate, 14.29);
    assert.strictEqual(progress.data.newRate, 28.57);

    const milestone = catalog.renderNotification(type, {
      squadName: "Alpha",
      squadCode: "ALPHA1",
      milestone: 25,
      kind: "milestone",
      previousRate: 14.29,
      newRate: 28.57,
      coveredCount: 2,
      newCoveredCount: 2,
      totalVariants: 7
    }, "fr");
    assert.ok(milestone.title.includes("25"));

    const group = grouping.buildSquadProgressGroup({
      squadId: "12",
      destination: "/squad/ALPHA1/engine",
      items: [
        {
          eventId: "s1",
          occurredAt: "2026-07-26T10:00:00.000Z",
          previousRate: 28.57,
          newRate: 42.86,
          newCoveredCount: 3,
          newVariantIds: ["v2"],
          actorName: "Mate"
        },
        {
          eventId: "s2",
          occurredAt: "2026-07-26T10:00:01.000Z",
          previousRate: 42.86,
          newRate: 57.14,
          newCoveredCount: 4,
          milestone: 50,
          newVariantIds: ["v3"],
          actorName: "Mate"
        }
      ]
    });
    assert.strictEqual(group.eventCount, 2);
    assert.strictEqual(group.firstEvent.id, "s1");
    assert.strictEqual(group.mostRecent.id, "s2");
    assert.ok(group.principalElements.some((el) => el.milestone === 50));
  });

  // Étape 64 — collection acquisition contract (unit-level)
  await asyncTest("friend_acquired_missing_variant selection and grouping (Étape 64)", () => {
    const gates = require("../server/notification-gates");
    const grouping = require("../server/notification-grouping");

    // Owned transition analysis only from allowed previous statuses.
    assert.ok(gates.isAcquiredFromStatus("missing"));
    assert.ok(gates.isAcquiredFromStatus("priority"));
    assert.ok(gates.isAcquiredFromStatus("unknown"));
    assert.ok(!gates.isAcquiredFromStatus("owned"));
    assert.ok(!gates.isAcquiredFromStatus("new"));

    // Only missing/priority recipients; unknown never alerts.
    assert.deepStrictEqual(gates.RECIPIENT_INTEREST_STATUSES, ["missing", "priority"]);
    assert.strictEqual(gates.resolveAcquisitionPriority("priority"), "strong");
    assert.strictEqual(gates.resolveAcquisitionPriority("missing"), "normal");
    assert.strictEqual(gates.resolveAcquisitionPriority("unknown"), null);
    assert.strictEqual(gates.resolveAcquisitionPriority("owned"), null);

    const type = catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT;
    const strong = catalog.renderNotification(type, {
      actorName: "Lucy",
      friendId: "7",
      variantId: "v1",
      variantName: "Alpha",
      recipientCollectionStatus: "priority",
      priorityLevel: "strong",
      count: 1
    }, "fr");
    const normal = catalog.renderNotification(type, {
      actorName: "Lucy",
      friendId: "7",
      variantId: "v1",
      variantName: "Alpha",
      recipientCollectionStatus: "missing",
      priorityLevel: "normal",
      count: 1
    }, "fr");
    assert.notStrictEqual(strong.title, normal.title);
    assert.ok(/priorit/i.test(strong.title));

    const group = grouping.buildFriendAcquisitionsGroup({
      actorId: 7,
      recipientId: 3,
      destination: "/compare/7?variantId=v2",
      variants: [
        { eventId: "e1", variantId: "v1", variantName: "A", acquiredAt: "2026-07-26T08:00:00.000Z" },
        { eventId: "e2", variantId: "v2", variantName: "B", acquiredAt: "2026-07-26T08:01:00.000Z" }
      ]
    });
    assert.strictEqual(group.eventCount, 2);
    assert.strictEqual(group.groupKey, "friend_acquisitions:7:3");
    const batched = catalog.renderNotification(
      type,
      grouping.attachGroup({
        actorName: "Lucy",
        friendId: "7",
        variantId: "v2",
        variantName: "B",
        count: 2,
        variantIds: ["v1", "v2"]
      }, group),
      "fr"
    );
    assert.ok(batched.body.includes("2"));
    assert.strictEqual(batched.data.group.eventCount, 2);
  });

  // Étape 63 — friend_request_accepted contract (unit-level)
  await asyncTest("friend_request_accepted opens compare and dedupes once (Étape 63)", async () => {
    const serialize = require("../server/notification-serialize");
    const { evaluateFriendshipAcceptedConditions } = require("../server/notification-gates");
    const { claimDedupeKey } = require("../server/event-idempotency");
    const blocks = require("../server/notification-blocks");

    const rendered = catalog.renderNotification(
      catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
      { actorName: "Lucy", friendId: "42", friendshipId: "99" },
      "fr"
    );
    assert.strictEqual(rendered.url, "/compare/42");
    assert.strictEqual(rendered.actions.primary.url, "/compare/42");

    const normalized = serialize.normalizeNotification({
      id: 7,
      type: "friend_request_accepted",
      category: "social",
      title: rendered.title,
      body: rendered.body,
      entity_type: "user",
      entity_id: "42",
      actor_id: 42,
      created_at: new Date("2026-07-26T08:00:00.000Z"),
      read_at: null,
      data: rendered.data
    }, {
      id: 42,
      username: "lucy",
      display_name: "Lucy",
      avatar_url: null
    });
    assert.strictEqual(normalized.action.url, "/compare/42");
    assert.ok(normalized.action.label);

    // Preferences gate
    assert.strictEqual(
      evaluateFriendshipAcceptedConditions({
        requesterId: "1",
        accepterId: "2",
        previousStatus: "pending",
        friendshipExists: true,
        friendshipStatus: "accepted",
        blocked: false,
        socialEnabled: false,
        typeEnabled: true
      }).reason,
      "social_disabled"
    );
    assert.strictEqual(
      evaluateFriendshipAcceptedConditions({
        requesterId: "1",
        accepterId: "2",
        previousStatus: "pending",
        friendshipExists: true,
        friendshipStatus: "accepted",
        blocked: false,
        socialEnabled: true,
        typeEnabled: false
      }).reason,
      "type_disabled"
    );

    // Dedupe: second claim with the same friend_accept key is rejected
    const claimed = new Set();
    const pool = {
      async query(sql, params) {
        if (/INSERT INTO notification_event_processing/i.test(sql)) {
          const key = `${params[0]}|${params[1]}|${params[2]}`;
          if (claimed.has(key)) return { rows: [] };
          claimed.add(key);
          return { rows: [{ event_id: params[0] }] };
        }
        return { rows: [] };
      }
    };
    const key = `friend_accept:99:1`;
    assert.strictEqual(
      await claimDedupeKey(pool, key, "friend_request_accepted", 1),
      true
    );
    assert.strictEqual(
      await claimDedupeKey(pool, key, "friend_request_accepted", 1),
      false,
      "second claim must not create another notification"
    );

    assert.ok(blocks.isPendingSocialType("friend_request_accepted"));
    assert.ok(blocks.isBlockedPairwiseType("friend_request_accepted"));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
