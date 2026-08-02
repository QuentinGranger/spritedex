"use strict";

async function register(ctx) {
  const { assert, catalog, prefs, channels, bus, asyncTest, sampleContext, EXPECTED_CONTEXTUAL_IDS, EXPECTED_NOTIFICATION_TYPES, EXPECTED_DOMAIN_EVENTS } = ctx;

  await asyncTest("block cleanup targets social pending and private pairwise types (Étape 57)", () => {
    const blocks = require("../../server/notification-blocks");
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
    const presend = require("../../server/notification-presend");
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
    const grouping = require("../../server/notification-grouping");
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
    const { evaluateFriendshipAcceptedConditions } = require("../../server/notification-gates");
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
    const { buildNotificationInboxFilters } = require("../../push-service");
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
    const channels = require("../../server/notification-channels");
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
}

module.exports = { register };
