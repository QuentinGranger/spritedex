"use strict";

async function register(ctx) {
  const { assert, catalog, prefs, channels, bus, asyncTest, sampleContext, EXPECTED_CONTEXTUAL_IDS, EXPECTED_NOTIFICATION_TYPES, EXPECTED_DOMAIN_EVENTS } = ctx;

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

  await asyncTest("domain event ids are stable", () => {
    assert.deepStrictEqual(bus.DOMAIN_EVENTS, EXPECTED_DOMAIN_EVENTS);
  });

  // Étapes 15–21 — acquisition gates / content
  await asyncTest("acquisition trigger and priority gates (Étapes 15–17)", () => {
    const gates = require("../../server/notification-gates");
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
    const gates = require("../../server/notification-gates");
    assert.deepStrictEqual(gates.SQUAD_MILESTONES, [25, 50, 75, 80, 90, 95, 100]);
    assert.strictEqual(gates.crossedSquadMilestone(81.71, 82.93), null);
    assert.strictEqual(gates.crossedSquadMilestone(89.5, 90.1), 90);
    assert.strictEqual(gates.crossedSquadMilestone(94, 100), 100);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: 90 }), true);
    assert.strictEqual(gates.isSquadImmediatePush({ milestone: null }), false);
    assert.ok(gates.SQUAD_BATCH_WINDOW_MS === 0 || gates.SQUAD_BATCH_WINDOW_MS === 20 * 60 * 1000);
  });

  await asyncTest("priority variant availability gates (Étapes 28–29, 31, 33)", () => {
    const gates = require("../../server/notification-gates");
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
    const gates = require("../../server/notification-gates");
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
    const gates = require("../../server/notification-gates");
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
    const gates = require("../../server/notification-gates");
    const scheduler = require("../../server/notification-event-ending-scheduler");
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
    const gates = require("../../server/notification-gates");
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
    const gates = require("../../server/notification-gates");
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

}

module.exports = { register };
