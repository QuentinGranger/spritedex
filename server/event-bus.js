// ── SPRITNEX domain event bus (Étape 8) ───────────────────────────────────
// Central engine so controllers never create notifications directly. They emit
// a domain event describing *what happened*; downstream services (e.g. the
// notification service) subscribe and decide *what to do* (recipients, type,
// preferences, content, channels, anti-spam).
//
//   emitDomainEvent("friendship.accepted", { requesterId, accepterId })
//
// emitDomainEvent returns a promise resolving once all handlers settle, so a
// caller MAY await it when it needs the side effects to be done before
// responding (handlers are otherwise isolated: one throwing never affects the
// caller or the other handlers).

const crypto = require("crypto");

const DOMAIN_EVENTS = Object.freeze({
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
});

// ── Canonical domain-event envelope (Étape 9) ──
// Every event carries a unique `eventId` (idempotency key used to avoid
// duplicate notifications), the `eventType`, when it `occurredAt`, the acting
// user, the target entity, and a free-form `context` for domain specifics.
//   {
//     eventId, eventType, occurredAt,
//     actorId, entityType, entityId, context
//   }
function createDomainEvent(eventType, data = {}) {
  const d = data && typeof data === "object" ? data : {};
  return {
    eventId: d.eventId || crypto.randomUUID(),
    eventType,
    occurredAt: d.occurredAt || new Date().toISOString(),
    actorId: d.actorId ?? null,
    entityType: d.entityType ?? null,
    entityId: d.entityId != null ? String(d.entityId) : null,
    context: d.context && typeof d.context === "object" ? d.context : {}
  };
}

function isEnvelope(value) {
  return value && typeof value === "object" && typeof value.eventId === "string" && typeof value.eventType === "string";
}

// eventType -> array of handler functions
const handlers = new Map();

function onDomainEvent(eventType, handler) {
  if (typeof handler !== "function") return () => {};
  if (!handlers.has(eventType)) handlers.set(eventType, []);
  handlers.get(eventType).push(handler);
  // Return an unsubscribe function.
  return () => {
    const list = handlers.get(eventType);
    if (!list) return;
    const idx = list.indexOf(handler);
    if (idx >= 0) list.splice(idx, 1);
  };
}

async function emitDomainEvent(eventType, data = {}) {
  // Normalize into the canonical envelope (unless already one). Handlers always
  // receive a full event with a unique eventId.
  const event = isEnvelope(data) ? data : createDomainEvent(eventType, data);
  const list = handlers.get(eventType);
  if (!list || !list.length) return event;
  await Promise.all(
    list.map(handler =>
      Promise.resolve()
        .then(() => handler(event))
        .catch(err => console.error(`[event-bus] handler for '${eventType}' failed:`, err))
    )
  );
  return event;
}

// Test/introspection helpers.
function listenerCount(eventType) {
  return (handlers.get(eventType) || []).length;
}

function removeAllDomainListeners(eventType) {
  if (eventType) handlers.delete(eventType);
  else handlers.clear();
}

module.exports = {
  DOMAIN_EVENTS,
  createDomainEvent,
  emitDomainEvent,
  onDomainEvent,
  listenerCount,
  removeAllDomainListeners
};
