// Unit tests for the contextual notification catalog (Étape 1).
// Pure unit test: no server or database required.
// A few late assertions import the WebSocket module, which builds the shared
// Express app and validates its public URL. Keep this unit test runnable from
// a clean checkout without requiring a developer .env file.
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;
const assert = require("node:assert");
const catalog = require("../../server/notification-catalog");
const prefs = require("../../server/notification-preferences");
const channels = require("../../server/notification-channels");
const bus = require("../../server/event-bus");

let passed = 0;

const result = { passed: 0, failed: 0 };

function test(name, fn) {
  try {
    fn();
    result.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    result.failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    result.passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    result.failed++;
    console.log(`  ✗ ${name}\n    ${err.message}`);
  }
}

// ── Stable technical identifiers ──
const EXPECTED_CONTEXTUAL_IDS = {
  FRIEND_REQUEST_ACCEPTED: "friend_request_accepted",
  FRIEND_ACQUIRED_MISSING_VARIANT: "friend_acquired_missing_variant",
  SQUAD_COMPLETION_INCREASED: "squad_completion_increased",
  PRIORITY_VARIANT_AVAILABLE: "priority_variant_available",
  WANTED_EVENT_ENDING_SOON: "wanted_event_ending_soon"
};

const EXPECTED_NOTIFICATION_TYPES = {
  ...EXPECTED_CONTEXTUAL_IDS,
  FRIEND_REQUEST_RECEIVED: "friend_request_received",
  FRIEND_REMOVED: "friend_removed",
  FRIEND_COLLECTION_UPDATED: "friend_collection_updated",
  SQUAD_MEMBER_JOINED: "squad_member_joined",
  GOAL_COMPLETED: "goal_completed",
  BADGE_UNLOCKED: "badge_unlocked",
  PASSPORT_CATALOGUE_UPDATED: "passport_catalogue_updated",
  NEWS_ARTICLE: "news_article",
  SQUAD_ACTIVITY: "squad_activity"
};

const EXPECTED_DOMAIN_EVENTS = {
  FRIENDSHIP_ACCEPTED: "friendship.accepted",
  COLLECTION_VARIANT_ACQUIRED: "collection.variant_acquired",
  COLLECTION_UPDATED: "collection.updated",
  SQUAD_COMPLETION_CHANGED: "squad.completion_changed",
  CATALOGUE_VARIANT_AVAILABLE: "catalogue.variant_available",
  CATALOGUE_EVENT_ENDING_SOON: "catalogue.event_ending_soon",
  CATALOGUE_PUBLISHED: "catalogue.published",
  COMPARISON_GENERATED: "comparison.generated",
  SQUAD_MEMBER_JOINED: "squad.member_joined",
  SQUAD_CREATED: "squad.created"
};

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

module.exports = {
  assert,
  catalog,
  prefs,
  channels,
  bus,
  test,
  asyncTest,
  sampleContext,
  EXPECTED_CONTEXTUAL_IDS,
  EXPECTED_NOTIFICATION_TYPES,
  EXPECTED_DOMAIN_EVENTS,
  get result() {
    return result;
  }
};
