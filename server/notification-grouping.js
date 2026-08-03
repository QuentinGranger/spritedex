// ── Étape 55 — Notification grouping ───────────────────────────────────────
// Several domain events can collapse into one delivered notification. Each
// group has a stable key and preserves: event count, principal elements,
// first event, most recent event, and the final destination URL.

function part(value) {
  if (value == null || value === "") return null;
  return String(value);
}

function toIso(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function eventTime(event) {
  if (!event) return 0;
  const iso = toIso(event.at);
  return iso ? new Date(iso).getTime() : 0;
}

function summarizeEvent(event) {
  if (!event) return null;
  const id = part(event.id);
  const at = toIso(event.at);
  if (!id && !at) return null;
  const out = {};
  if (id) out.id = id;
  if (at) out.at = at;
  if (event.variantId != null) out.variantId = String(event.variantId);
  if (event.variantName) out.variantName = String(event.variantName);
  if (event.threshold) out.threshold = String(event.threshold);
  if (event.newCoveredCount != null) out.newCoveredCount = Number(event.newCoveredCount);
  if (event.milestone != null) out.milestone = Number(event.milestone);
  return out;
}

// friend_acquisitions:{actorId}:{recipientId}
function buildFriendAcquisitionsGroupKey(actorId, recipientId) {
  const actor = part(actorId);
  const recipient = part(recipientId);
  if (!actor || !recipient) return null;
  return `friend_acquisitions:${actor}:${recipient}`;
}

// squad_progress:{squadId}
function buildSquadProgressGroupKey(squadId) {
  const squad = part(squadId);
  if (!squad) return null;
  return `squad_progress:${squad}`;
}

// event_deadline:{eventId}:{recipientId}
function buildEventDeadlineGroupKey(eventId, recipientId) {
  const event = part(eventId);
  const recipient = part(recipientId);
  if (!event || !recipient) return null;
  return `event_deadline:${event}:${recipient}`;
}

/**
 * Build the durable group summary attached to a notification.
 * `events` should be chronologically meaningful source events for the group.
 */
function buildGroupSummary({ groupKey, events = [], principalElements = [], destination = null } = {}) {
  if (!groupKey) return null;
  const ordered = (Array.isArray(events) ? events : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => eventTime(a) - eventTime(b));
  const principals = (Array.isArray(principalElements) ? principalElements : []).filter(Boolean).map((el) => {
    if (typeof el === "string" || typeof el === "number") {
      return { id: String(el) };
    }
    const out = {};
    if (el.id != null) out.id = String(el.id);
    if (el.variantId != null) out.variantId = String(el.variantId);
    if (el.variantName) out.variantName = String(el.variantName);
    if (el.priorityLevel) out.priorityLevel = String(el.priorityLevel);
    if (el.milestone != null) out.milestone = Number(el.milestone);
    if (el.actorName) out.actorName = String(el.actorName);
    return out;
  });

  return {
    groupKey: String(groupKey),
    eventCount: ordered.length,
    principalElements: principals,
    firstEvent: summarizeEvent(ordered[0] || null),
    mostRecent: summarizeEvent(ordered.length ? ordered[ordered.length - 1] : null),
    destination: destination ? String(destination) : null
  };
}

function attachGroup(context, group) {
  if (!group || !group.groupKey) return context || {};
  return {
    ...(context || {}),
    groupKey: group.groupKey,
    group
  };
}

function buildFriendAcquisitionsGroup({ actorId, recipientId, variants = [], destination = null } = {}) {
  const groupKey = buildFriendAcquisitionsGroupKey(actorId, recipientId);
  if (!groupKey) return null;
  const list = Array.isArray(variants) ? variants : [];
  const events = list.map((v) => ({
    id: v.eventId || v.variantId,
    at: v.acquiredAt || null,
    variantId: v.variantId,
    variantName: v.variantName
  }));
  const principalElements = list.map((v) => ({
    variantId: v.variantId,
    ...(v.variantName ? { variantName: v.variantName } : {}),
    ...(v.priorityLevel ? { priorityLevel: v.priorityLevel } : {})
  }));
  return buildGroupSummary({ groupKey, events, principalElements, destination });
}

function buildSquadProgressGroup({ squadId, items = [], destination = null } = {}) {
  const groupKey = buildSquadProgressGroupKey(squadId);
  if (!groupKey) return null;
  const list = Array.isArray(items) ? items : [];
  const events = list.map((it) => ({
    id: it.eventId || `${squadId}:${it.newCoveredCount}`,
    at: it.occurredAt || null,
    newCoveredCount: it.newCoveredCount,
    milestone: it.milestone
  }));

  const principalElements = [];
  const seen = new Set();
  for (const it of list) {
    for (const variantId of it.newVariantIds || []) {
      const id = String(variantId);
      if (seen.has(id)) continue;
      seen.add(id);
      principalElements.push({
        variantId: id,
        ...(it.variantName && String(it.newVariantIds?.[0]) === id ? { variantName: it.variantName } : {}),
        ...(it.actorName ? { actorName: it.actorName } : {})
      });
    }
  }
  const milestone = list.reduce((best, it) => {
    if (it.milestone == null) return best;
    return best == null || it.milestone > best ? it.milestone : best;
  }, null);
  if (milestone != null) {
    principalElements.unshift({ milestone });
  }

  return buildGroupSummary({ groupKey, events, principalElements, destination });
}

function buildEventDeadlineGroup({
  eventId,
  recipientId,
  threshold = null,
  endingAt = null,
  domainEventId = null,
  variantIds = [],
  destination = null
} = {}) {
  const groupKey = buildEventDeadlineGroupKey(eventId, recipientId);
  if (!groupKey) return null;
  const events = [
    {
      id: domainEventId || (threshold ? `${eventId}:${threshold}` : eventId),
      at: endingAt || new Date().toISOString(),
      threshold
    }
  ];
  const principalElements = (Array.isArray(variantIds) ? variantIds : []).map((id) => ({
    variantId: String(id)
  }));
  return buildGroupSummary({ groupKey, events, principalElements, destination });
}

module.exports = {
  buildFriendAcquisitionsGroupKey,
  buildSquadProgressGroupKey,
  buildEventDeadlineGroupKey,
  buildGroupSummary,
  attachGroup,
  buildFriendAcquisitionsGroup,
  buildSquadProgressGroup,
  buildEventDeadlineGroup
};
