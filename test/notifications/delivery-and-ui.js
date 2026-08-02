"use strict";

async function register(ctx) {
  const { assert, catalog, prefs, channels, bus, asyncTest, sampleContext, EXPECTED_CONTEXTUAL_IDS, EXPECTED_NOTIFICATION_TYPES, EXPECTED_DOMAIN_EVENTS } = ctx;

  await asyncTest("global push daily limit is 8 with critical exceptions (Étape 52)", async () => {
    const channels = require("../../server/notification-channels");
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

    // Ordinary sprite-index notification blocked at the cap.
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
    const { nextDailyDigestAt } = require("../../server/timezone");

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
    const { markNotificationRead, markAllNotificationsRead } = require("../../push-service");
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(sql.trim())) return { rows: [] };
        if (/SELECT id, type, category, data, status, created_at, delivered_at, clicked_at, read_at/i.test(sql)) {
          // A previous click avoids exercising graph persistence here; this test
          // is scoped to the read/click update transaction itself.
          return { rows: [{ id: params[0], clicked_at: new Date("2026-07-25T08:00:00Z") }] };
        }
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
      },
      release() {}
    };
    const pool = {
      connect: async () => client,
      async query(sql, params) {
        return client.query(sql, params);
      }
    };

    const clicked = await markNotificationRead(pool, 42, 99, { clicked: true });
    assert.ok(clicked);
    assert.strictEqual(clicked.status, "read");
    assert.ok(clicked.clicked_at);
    assert.strictEqual(
      calls.find(({ sql }) => /UPDATE notifications SET[\s\S]*read_at = COALESCE/i.test(sql)).params[2],
      true
    );

    const readOnly = await markNotificationRead(pool, 42, 100, { clicked: false });
    assert.ok(readOnly);
    const notificationUpdates = calls.filter(({ sql }) => /UPDATE notifications SET[\s\S]*read_at = COALESCE/i.test(sql));
    assert.strictEqual(notificationUpdates[1].params[2], false);

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
}

module.exports = { register };
