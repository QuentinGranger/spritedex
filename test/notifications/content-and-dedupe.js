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

  await asyncTest("priority_variant_available content (Étape 32)", () => {
    const type = catalog.NOTIFICATION_TYPES.PRIORITY_VARIANT_AVAILABLE;
    const withEnd = catalog.renderNotification(
      type,
      {
        variantName: "Batman Holofoil",
        variantId: "sprite_batman_holofoil",
        spriteId: "sprite_batman",
        variantType: "Holofoil",
        availableUntil: "2026-08-20T23:59:59Z",
        availableFrom: "2026-07-18T00:00:00Z",
        confidence: "official",
        eventId: "event_hot_bat_summer"
      },
      "fr"
    );
    assert.strictEqual(withEnd.title, "Batman Holofoil est disponible");
    assert.ok(withEnd.body.includes("Batman Holofoil"));
    assert.ok(withEnd.body.toLowerCase().includes("août") || withEnd.body.includes("20"));
    assert.strictEqual(withEnd.data.actionUrl, "/sprites/sprite_batman?variant=Holofoil");
    assert.strictEqual(withEnd.data.spriteId, "sprite_batman");
    assert.strictEqual(withEnd.data.variantType, "Holofoil");
    assert.strictEqual(withEnd.data.confidence, "official");

    const noEnd = catalog.renderNotification(
      type,
      {
        variantName: "Water Gold",
        variantId: "sprite_water_gold",
        spriteId: "sprite_water",
        variantType: "Gold"
      },
      "fr"
    );
    assert.strictEqual(noEnd.body, "Une variante que vous recherchez en priorité est maintenant disponible.");
  });

  await asyncTest("squad_completion_increased content (Étape 26) progress vs milestone vs batch", () => {
    const type = catalog.NOTIFICATION_TYPES.SQUAD_COMPLETION_INCREASED;
    const progress = catalog.renderNotification(
      type,
      {
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
      },
      "fr"
    );
    assert.strictEqual(progress.title, "Bravo Six progresse");
    assert.ok(progress.body.includes("Lucy"));
    assert.ok(progress.body.includes("Batman Holofoil"));
    assert.ok(progress.body.includes("82.9"));
    assert.strictEqual(progress.data.actionUrl, "/squad/BRAVO6/engine");
    assert.strictEqual(progress.actions.primary.url, "/squad/BRAVO6/engine");
    assert.deepStrictEqual(progress.data.newVariantIds, ["sprite_batman_holofoil"]);

    const milestone = catalog.renderNotification(
      type,
      {
        squadName: "Bravo Six",
        squadCode: "BRAVO6",
        milestone: 90,
        kind: "milestone",
        coveredCount: 74,
        newCoveredCount: 74,
        totalVariants: 82,
        newRate: 90.2
      },
      "fr"
    );
    assert.strictEqual(milestone.title, "Bravo Six atteint 90 %");
    assert.ok(milestone.body.includes("74"));
    assert.ok(milestone.body.includes("82"));

    const batch = catalog.renderNotification(
      type,
      {
        squadName: "Bravo Six",
        squadCode: "BRAVO6",
        kind: "batch",
        count: 4,
        newRate: 85.4,
        newVariantIds: ["a", "b", "c", "d"]
      },
      "fr"
    );
    assert.ok(batch.body.includes("4 nouvelles variantes"));
    assert.ok(batch.body.includes("85.4"));
  });

  await asyncTest("friend_acquired_missing_variant content (Étape 19) priority vs missing vs batch", () => {
    const type = catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT;
    const priority = catalog.renderNotification(
      type,
      {
        actorName: "Lucy",
        friendId: "user_lucy",
        variantId: "sprite_batman_holofoil",
        variantName: "Batman Holofoil",
        recipientCollectionStatus: "priority",
        priorityLevel: "strong",
        count: 1
      },
      "fr"
    );
    assert.strictEqual(priority.title, "Lucy possède une variante prioritaire");
    assert.ok(priority.body.includes("Batman Holofoil"));
    assert.ok(priority.body.includes("priorité"));
    assert.strictEqual(priority.data.actionUrl, "/compare/user_lucy?variantId=sprite_batman_holofoil");

    const missing = catalog.renderNotification(
      type,
      {
        actorName: "Lucy",
        friendId: "user_lucy",
        variantId: "sprite_water_gold",
        variantName: "Water Gold",
        recipientCollectionStatus: "missing",
        priorityLevel: "normal",
        count: 1
      },
      "fr"
    );
    assert.strictEqual(missing.title, "Une nouvelle correspondance avec Lucy");
    assert.ok(missing.body.includes("Water Gold"));

    const batch = catalog.renderNotification(
      type,
      {
        actorName: "Lucy",
        friendId: "user_lucy",
        variantId: "sprite_batman_holofoil",
        variantName: "Batman Holofoil",
        highlightName: "Batman Holofoil",
        recipientCollectionStatus: "missing",
        count: 3,
        variantIds: ["a", "b", "c"]
      },
      "fr"
    );
    assert.ok(batch.body.includes("3 variantes"));
    assert.ok(batch.body.includes("Batman Holofoil"));
    assert.strictEqual(batch.data.count, 3);
  });

  // Étape 14/54 — dedupe key for friend accept
  await asyncTest("friend_accept dedupe key is stable (Étape 14/54)", () => {
    const { buildFriendRequestAcceptedDedupeKey } = require("../../server/notification-gates");
    assert.strictEqual(
      buildFriendRequestAcceptedDedupeKey("friendship_123", "user_quentin"),
      "friend_accept:friendship_123:user_quentin"
    );
    assert.strictEqual(buildFriendRequestAcceptedDedupeKey(null, "1"), null);
    assert.strictEqual(buildFriendRequestAcceptedDedupeKey("f1", null), null);
    // Same friendship + recipient → identical key (duplicate claim must collapse).
    assert.strictEqual(buildFriendRequestAcceptedDedupeKey("f1", 42), buildFriendRequestAcceptedDedupeKey("f1", 42));
  });

  await asyncTest("notification dedupe key formats (Étape 54)", () => {
    const dedupe = require("../../server/notification-dedupe");
    assert.strictEqual(dedupe.buildFriendAcceptDedupeKey("friendship_123", 7), "friend_accept:friendship_123:7");
    assert.strictEqual(
      dedupe.buildFriendVariantDedupeKey(1, 2, "var_holo", "2026-07-26T08:00:00.000Z"),
      "friend_variant:1:2:var_holo:2026-07-26T08:00:00.000Z"
    );
    assert.strictEqual(dedupe.buildFriendVariantDedupeKey(1, 2, "var_holo", null), null);
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
    const i18n = require("../../server/notification-i18n");
    assert.strictEqual(
      i18n.getTranslations("fr")["notifications.friend_request_accepted.title"],
      "{friendName} a accepté votre invitation"
    );
    assert.strictEqual(
      i18n.getTranslations("en")["notifications.friend_request_accepted.title"],
      "{friendName} accepted your friend request"
    );
    assert.strictEqual(i18n.pickLocalizedName("fr", { name: "Eau", officialName: "Water" }), "Eau");
    assert.strictEqual(i18n.pickLocalizedName("en", { name: "Eau", officialName: "Water" }), "Water");

    const appI18n = require("../../server/i18n");
    assert.strictEqual(appI18n.resolveNotificationLanguage("en", null), "en");
    assert.strictEqual(appI18n.resolveNotificationLanguage("fr", null), "fr");
    assert.strictEqual(appI18n.resolveNotificationLanguage("en", "fr"), "fr", "explicit lang wins");
    assert.strictEqual(appI18n.resolveNotificationLanguage(null, null), "fr");
    assert.strictEqual(appI18n.resolveLocale("en-US,en;q=0.9"), "en");
    assert.strictEqual(appI18n.resolveLocale("fr-FR"), "fr");
    assert.strictEqual(appI18n.resolveLocale("nl-NL"), "nl");
    assert.strictEqual(appI18n.resolveLocale("nl-BE"), "nl");
    assert.strictEqual(appI18n.resolveLocale("en-NL"), "nl");
    assert.strictEqual(appI18n.resolveLocale("en-SR"), "nl");
    assert.strictEqual(appI18n.resolveLocale("fr-BE"), "fr");

    const catalog = require("../../server/notification-catalog");
    const enAccept = catalog.renderNotification(
      catalog.NOTIFICATION_TYPES.FRIEND_REQUEST_ACCEPTED,
      { friendId: "7", friendName: "Lucy" },
      appI18n.resolveNotificationLanguage("en", null)
    );
    assert.match(enAccept.title, /accepted your friend request/i);

    const fr = i18n.renderTranslatedMessage("friend_request_accepted", { friendName: "Lucy" }, "fr");
    assert.strictEqual(fr.title, "Lucy a accepté votre invitation");
    assert.strictEqual(fr.body, "Vous pouvez maintenant comparer vos collections.");

    const en = i18n.renderTranslatedMessage("friend_request_accepted", { friendName: "Lucy" }, "en");
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
    assert.strictEqual(acquired.data.translationKey, "notifications.friend_acquired_missing_variant");
  });

  await asyncTest("translation payload is structured for re-render (Étape 61)", () => {
    const payload = catalog.buildTranslationPayload(catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT, {
      actorName: "Lucy",
      friendId: "user_lucy",
      variantName: "Water Gold",
      variantId: "sprite_water_gold",
      count: 1,
      recipientCollectionStatus: "missing",
      priorityLevel: "normal"
    });
    assert.strictEqual(payload.translationKey, "notifications.friend_acquired_missing_variant");
    assert.strictEqual(payload.translationParams.friendName, "Lucy");
    assert.strictEqual(payload.translationParams.variantName, "Water Gold");
    assert.strictEqual(payload.translationParams.friendId, "user_lucy");
    assert.strictEqual(payload.translationParams.variantId, "sprite_water_gold");
    assert.strictEqual(payload.translationParams.template, "default");

    const batch = catalog.buildTranslationPayload(catalog.NOTIFICATION_TYPES.FRIEND_ACQUIRED_MISSING_VARIANT, {
      actorName: "Lucy",
      friendId: "7",
      highlightName: "Batman Holofoil",
      count: 3,
      variantIds: ["a", "b", "c"]
    });
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
    const serialize = require("../../server/notification-serialize");
    assert.strictEqual(serialize.toPublicNotificationId(123), "notification_123");
    assert.strictEqual(serialize.fromPublicNotificationId("notification_123"), 123);
    assert.strictEqual(serialize.fromPublicNotificationId("123"), 123);
    assert.strictEqual(serialize.normalizeEntityType("variant"), "sprite_variant");

    const normalized = serialize.normalizeNotification(
      {
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
      },
      {
        id: 7,
        username: "lucy",
        display_name: "Lucy",
        avatar_url: "/avatars/lucy.webp"
      }
    );

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
      imageUrl: "/avatars/lucy.webp",
      isRead: false,
      createdAt: "2026-07-18T20:00:00.000Z"
    });

    const newsNormalized = serialize.normalizeNotification(
      {
        id: 9,
        type: "news_article",
        category: "news",
        title: "Collecte effrénée",
        body: "Nouveaux esprits disponibles.",
        entity_type: "news",
        entity_id: "news:42",
        created_at: "2026-07-26T18:00:00.000Z",
        read_at: null,
        data: {
          newsId: 42,
          newsUrl: "https://fortnite.com/news?lang=fr",
          image: "https://cdn.fortnite-api.com/news/tile.jpeg"
        }
      },
      null
    );
    assert.strictEqual(
      newsNormalized.imageUrl,
      "https://cdn.fortnite-api.com/news/tile.jpeg",
      "news notifications expose scraped imageUrl"
    );
  });

  await asyncTest("notification API cursor helpers (Étape 59)", () => {
    const {
      encodeNotificationCursor,
      decodeNotificationCursor,
      buildNotificationInboxFilters
    } = require("../../push-service");
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
    const squad = require("../../server/notification-squad-completion");
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
}

module.exports = { register };
