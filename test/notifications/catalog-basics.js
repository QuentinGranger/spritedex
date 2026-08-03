"use strict";

function register(ctx) {
  const {
    assert,
    catalog,
    prefs,
    channels,
    bus,
    test,
    sampleContext,
    EXPECTED_CONTEXTUAL_IDS,
    EXPECTED_NOTIFICATION_TYPES,
    EXPECTED_DOMAIN_EVENTS
  } = ctx;

  test("exposes stable notification type ids and the five contextual types", () => {
    assert.deepStrictEqual(catalog.NOTIFICATION_TYPES, EXPECTED_NOTIFICATION_TYPES);
    assert.strictEqual(catalog.CONTEXTUAL_NOTIFICATION_TYPES.length, 5);
    assert.deepStrictEqual(catalog.CONTEXTUAL_NOTIFICATION_TYPES, Object.values(EXPECTED_CONTEXTUAL_IDS));
    for (const id of Object.values(EXPECTED_NOTIFICATION_TYPES)) {
      assert.ok(catalog.isKnownType(id), `isKnownType false for ${id}`);
    }
    for (const id of Object.values(EXPECTED_CONTEXTUAL_IDS)) {
      assert.ok(catalog.CONTEXTUAL_NOTIFICATION_TYPES.includes(id), `missing ${id}`);
    }
  });

  test("type ids do not depend on displayed text or language", () => {
    // Same id yields different wording per language, proving the id is stable
    // and language-independent.
    for (const id of Object.values(EXPECTED_CONTEXTUAL_IDS)) {
      const fr = catalog.renderNotification(id, sampleContext(id), "fr");
      const en = catalog.renderNotification(id, sampleContext(id), "en");
      assert.ok(fr && en, `render null for ${id}`);
      assert.notStrictEqual(fr.body, en.body, `fr/en body identical for ${id}`);
      assert.notStrictEqual(fr.title, en.title, `fr/en title identical for ${id}`);
    }
  });

  test("French and English are generated separately for every type", () => {
    for (const id of Object.values(EXPECTED_CONTEXTUAL_IDS)) {
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
    for (const id of Object.values(EXPECTED_CONTEXTUAL_IDS)) {
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
    const url = catalog.getNotificationUrl(catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT, {
      actorId: 42,
      friendId: 42,
      variantId: "v9"
    });
    assert.strictEqual(url, "/compare/42?variantId=v9");
    assert.strictEqual(catalog.getNotificationUrl(catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED, {}), "/friends");
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
    assert.deepStrictEqual(
      [...catalog.NOTIFICATION_STATUS_LIST],
      ["created", "queued", "delivered", "failed", "read", "archived", "cancelled"]
    );
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
    assert.deepStrictEqual(channels.resolvePermittedChannels({ typeChannels, categoryEnabled: false }), []);
    // type off → nothing
    assert.deepStrictEqual(channels.resolvePermittedChannels({ typeChannels, typeEnabled: false }), []);
    // push channel muted → in_app + email only
    assert.deepStrictEqual(channels.resolvePermittedChannels({ typeChannels, channelPrefs: { push: false } }), [
      "in_app",
      "email"
    ]);
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
    const queue = require("../../server/notification-delivery-queue");
    assert.deepStrictEqual(queue.externalChannelsOnly(["in_app", "push", "email"]), ["push", "email"]);
    assert.deepStrictEqual(queue.externalChannelsOnly(["in_app"]), []);
    assert.ok(queue.QUEUE_STATUSES.PENDING === "pending");
    assert.ok(queue.QUEUE_POLL_MS === 0 || queue.QUEUE_POLL_MS === 5000);
  });

  test("notification_deliveries covers in_app, push, email (Étape 43)", () => {
    const deliveries = require("../../server/notification-deliveries");
    assert.deepStrictEqual(deliveries.DELIVERY_CHANNELS, ["in_app", "push", "email"]);
    assert.strictEqual(deliveries.DELIVERY_STATUSES.QUEUED, "queued");
    assert.strictEqual(deliveries.DELIVERY_STATUSES.DELIVERED, "delivered");
    assert.strictEqual(deliveries.DELIVERY_STATUSES.FAILED, "failed");
    const id = deliveries.newDeliveryId();
    assert.ok(typeof id === "string" && id.length >= 32);
  });

  test("push_subscriptions platforms and web parsing (Étape 44)", () => {
    const subs = require("../../server/push-subscriptions");
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
      subs.toDispatchTarget({ id: "2", platform: "android", token: nativeToken, endpoint: `android:${nativeToken}` })
        .token,
      nativeToken
    );
  });

  test("invalid push tokens are permanent failures (Étape 45)", () => {
    const subs = require("../../server/push-subscriptions");
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
    const quiet = require("../../server/notification-quiet-hours");
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
    const tz = require("../../server/timezone");
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
      catalog.formatEventEndingWhen(
        {
          endingAt,
          timeZone: "UTC",
          now: nowParis.toISOString(),
          threshold: "24h"
        },
        "fr"
      ),
      "aujourd'hui"
    );
  });
}

module.exports = { register };
