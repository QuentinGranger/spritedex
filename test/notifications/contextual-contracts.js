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

  await asyncTest("wanted_event_ending_soon thresholds, TZ, cancel rules (Étape 67)", () => {
    const gates = require("../../server/notification-gates");
    const tz = require("../../server/timezone");
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
    const frUtc = catalog.formatEventEndingWhen(
      {
        endingAt,
        timeZone: "UTC",
        now: nowParis.toISOString(),
        threshold: "24h"
      },
      "fr"
    );
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
    assert.strictEqual(gates.normalizeEndDateKey(pgDate), gates.normalizeEndDateKey("2026-08-20T12:00:00.000Z"));

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
    const gates = require("../../server/notification-gates");
    const dedupe = require("../../server/notification-dedupe");

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
    const rendered = catalog.renderNotification(
      type,
      {
        variantName: "Batman Holofoil",
        variantId: "sprite_batman_holofoil",
        spriteId: "sprite_batman",
        variantType: "Holofoil",
        confidence: "official",
        availabilityPeriodId: "period_a",
        availableUntil: "2026-08-20T23:59:59Z"
      },
      "fr"
    );
    assert.ok(/disponible/i.test(rendered.title));
    assert.strictEqual(rendered.data.confidence, "official");
    assert.strictEqual(rendered.data.availabilityPeriodId, "period_a");
  });

  // Étape 65 — squad progression contract (unit-level)
  await asyncTest("squad_completion_increased rates, paliers and grouping (Étape 65)", () => {
    const gates = require("../../server/notification-gates");
    const grouping = require("../../server/notification-grouping");

    assert.deepStrictEqual(gates.SQUAD_MILESTONES, [25, 50, 75, 80, 90, 95, 100]);
    assert.strictEqual(gates.crossedSquadMilestone(14.29, 28.57), 25);
    assert.strictEqual(gates.crossedSquadMilestone(42.86, 57.14), 50);
    assert.strictEqual(gates.crossedSquadMilestone(28.57, 42.86), null);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: 25 }), true);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: null }), false);

    const type = catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED;
    const progress = catalog.renderNotification(
      type,
      {
        squadName: "Alpha",
        squadCode: "ALPHA1",
        previousRate: 14.29,
        newRate: 28.57,
        previousCoveredCount: 1,
        newCoveredCount: 2,
        totalVariants: 7,
        kind: "progress",
        count: 1
      },
      "fr"
    );
    assert.ok(progress.body.includes("28.6") || progress.body.includes("28.57"));
    assert.strictEqual(progress.data.previousRate, 14.29);
    assert.strictEqual(progress.data.newRate, 28.57);

    const milestone = catalog.renderNotification(
      type,
      {
        squadName: "Alpha",
        squadCode: "ALPHA1",
        milestone: 25,
        kind: "milestone",
        previousRate: 14.29,
        newRate: 28.57,
        coveredCount: 2,
        newCoveredCount: 2,
        totalVariants: 7
      },
      "fr"
    );
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
    const gates = require("../../server/notification-gates");
    const grouping = require("../../server/notification-grouping");

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
    const strong = catalog.renderNotification(
      type,
      {
        actorName: "Lucy",
        friendId: "7",
        variantId: "v1",
        variantName: "Alpha",
        recipientCollectionStatus: "priority",
        priorityLevel: "strong",
        count: 1
      },
      "fr"
    );
    const normal = catalog.renderNotification(
      type,
      {
        actorName: "Lucy",
        friendId: "7",
        variantId: "v1",
        variantName: "Alpha",
        recipientCollectionStatus: "missing",
        priorityLevel: "normal",
        count: 1
      },
      "fr"
    );
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
      grouping.attachGroup(
        {
          actorName: "Lucy",
          friendId: "7",
          variantId: "v2",
          variantName: "B",
          count: 2,
          variantIds: ["v1", "v2"]
        },
        group
      ),
      "fr"
    );
    assert.ok(batched.body.includes("2"));
    assert.strictEqual(batched.data.group.eventCount, 2);
  });

  // Étape 63 — friend_request_accepted contract (unit-level)
  await asyncTest("friend_request_accepted opens compare and dedupes once (Étape 63)", async () => {
    const serialize = require("../../server/notification-serialize");
    const { evaluateFriendshipAcceptedConditions } = require("../../server/notification-gates");
    const { claimDedupeKey } = require("../../server/event-idempotency");
    const blocks = require("../../server/notification-blocks");

    const rendered = catalog.renderNotification(
      catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
      { actorName: "Lucy", friendId: "42", friendshipId: "99" },
      "fr"
    );
    assert.strictEqual(rendered.url, "/compare/42");
    assert.strictEqual(rendered.actions.primary.url, "/compare/42");

    const normalized = serialize.normalizeNotification(
      {
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
      },
      {
        id: 42,
        username: "lucy",
        display_name: "Lucy",
        avatar_url: null
      }
    );
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
    assert.strictEqual(await claimDedupeKey(pool, key, "friend_request_accepted", 1), true);
    assert.strictEqual(
      await claimDedupeKey(pool, key, "friend_request_accepted", 1),
      false,
      "second claim must not create another notification"
    );

    assert.ok(blocks.isPendingSocialType("friend_request_accepted"));
    assert.ok(blocks.isBlockedPairwiseType("friend_request_accepted"));
  });
}

module.exports = { register };
