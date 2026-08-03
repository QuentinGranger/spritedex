"use strict";

async function register(ctx) {
  const {
    assert,
    catalog,
    prefs,
    channels,
    bus,
    asyncTest,
    sampleContext,
    EXPECTED_CONTEXTUAL_IDS,
    EXPECTED_NOTIFICATION_TYPES,
    EXPECTED_DOMAIN_EVENTS
  } = ctx;

  await asyncTest("notification system readiness criteria (Étape 72)", async () => {
    const bus = require("../../server/event-bus");
    const gates = require("../../server/notification-gates");
    const prefs = require("../../server/notification-preferences");
    const channels = require("../../server/notification-channels");
    const quiet = require("../../server/notification-quiet-hours");
    const dedupe = require("../../server/notification-dedupe");
    const grouping = require("../../server/notification-grouping");
    const presend = require("../../server/notification-presend");
    const blocks = require("../../server/notification-blocks");
    const squad = require("../../server/notification-squad-completion");
    const deliveryQueue = require("../../server/notification-delivery-queue");
    const pushSubscriptions = require("../../server/push-subscriptions");

    // 1) Five notifications can be generated
    assert.strictEqual(catalog.CONTEXTUAL_NOTIFICATION_TYPES.length, 5);
    for (const type of catalog.CONTEXTUAL_NOTIFICATION_TYPES) {
      const rendered = catalog.renderNotification(
        type,
        {
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
        },
        "fr"
      );
      assert.ok(rendered && rendered.title && rendered.body, `render failed for ${type}`);
      assert.ok(rendered.url && rendered.url !== "/", `${type} must not open home`);
    }

    // 2) Precise triggers (stable domain event ids)
    assert.deepStrictEqual(bus.DOMAIN_EVENTS, EXPECTED_DOMAIN_EVENTS);

    // 3–4) Preferences + separate categories
    assert.strictEqual(prefs.evaluateDelivery({ pushEnabled: true, categoryEnabled: false, typeEnabled: true }), false);
    assert.strictEqual(prefs.evaluateTypeActive({ typeEnabled: false }), false);
    const cats = catalog.NOTIFICATION_SETTINGS_SCREEN.groups.map((g) => g.category);
    assert.deepStrictEqual(cats, ["social", "collection", "alerts"]);

    // 5) Push requires consent
    const noConsent = await channels.evaluatePushConstraints(
      {
        async query() {
          return { rows: [{ c: 0 }] };
        }
      },
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
    assert.strictEqual(presend.evaluateFriendshipStillRelevant({ friendshipAccepted: false }).cancel, true);

    // 13) Failed sends do not block core paths (queue + permanent token handling)
    assert.ok(deliveryQueue.QUEUE_STATUSES.FAILED);
    assert.ok(deliveryQueue.DEFAULT_MAX_ATTEMPTS >= 3);
    assert.ok(pushSubscriptions.isPermanentProviderFailure({ statusCode: 410 }));
    assert.ok(!pushSubscriptions.isPermanentProviderFailure({ statusCode: 503 }));
  });

  // Étape 69 — load suite smoke (full scale lives in test/notification-load.test.js)
  await asyncTest("notification load helpers stay consistent at small scale (Étape 69)", () => {
    const grouping = require("../../server/notification-grouping");
    const pushSubscriptions = require("../../server/push-subscriptions");
    const deliveryQueue = require("../../server/notification-delivery-queue");

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
    const serialize = require("../../server/notification-serialize");
    const squad = require("../../server/notification-squad-completion");
    const pushService = require("../../push-service");

    const revoked = squad.revokeSquadPrivateDestination({
      actionUrl: "/squad/BRAVO/engine",
      actions: { primary: { label: "Ouvrir", url: "/squad/BRAVO/engine" } },
      group: { destination: "/squad/BRAVO/engine" }
    });
    assert.strictEqual(revoked.accessRevoked, true);
    const normalized = serialize.normalizeNotification(
      {
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
      },
      null
    );
    assert.strictEqual(normalized.action, null, "revoked destinations must not expose action.url");

    const publicKey = pushService.getVapidPublicKey();
    assert.ok(publicKey && publicKey.length > 20);
    // Module must not export a getter for the private key.
    assert.strictEqual(typeof pushService.getVapidPrivateKey, "undefined");
    assert.ok(!("vapidPrivateKey" in pushService));
  });

  // Étape 67 — wanted event ending-soon contract (unit-level)
}

module.exports = { register };
