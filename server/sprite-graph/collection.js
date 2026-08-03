"use strict";

const { pool } = require("../db");
const { GRAPH_EVENT_TYPES, GRAPH_EVENT_VERSIONS } = require("./constants");
const { normalizeIntId, normalizeGraphSource } = require("./normalization");
const { recordGraphEvent } = require("./events");
const { buildDeduplicationKey, resolvePriorityLevel, recordPriorityAddedEvent } = require("./priority");

/**
 * Map collection mutations → graph events (Étapes 12–16).
 *
 * - collection.sprite_added : first creation of a collection row only
 * - collection.status_changed : subsequent real status changes only
 * - collection.priority_added : status becomes `priority` (may accompany status_changed)
 * - no event when previous === new (Étape 15)
 */
async function recordCollectionGraphEvents(
  userId,
  changes,
  {
    source = "api",
    origin = null,
    occurredAt = null,
    catalogueVersion = null,
    updateMethod = null,
    previousCollectionCount = null,
    db = pool,
    throwOnError = false
  } = {}
) {
  const actor = normalizeIntId(userId);
  if (!actor || !Array.isArray(changes) || !changes.length) return [];
  const when = occurredAt || new Date().toISOString();
  const client = db && typeof db.query === "function" ? db : pool;
  const canonicalSource = normalizeGraphSource(source, {
    defaultSource: String(source).toLowerCase().includes("import") ? "import" : "api"
  });
  const gov = require("../sprite-graph-governance");
  const resolvedMethod = gov.resolveUpdateMethod({
    source: canonicalSource,
    origin,
    updateMethod,
    previousCollectionCount,
    changeCount: changes.length
  });
  // One gate for the whole batch so legitimate imports are not rate-limited per row.
  const acceptance = await gov.evaluateGraphEventAcceptance(client, {
    actorUserId: actor,
    source: canonicalSource,
    origin,
    updateMethod: resolvedMethod,
    changeCount: changes.length,
    previousCollectionCount
  });
  if (!acceptance.accept) {
    const hardBlock = acceptance.reason === "account_deleted" || acceptance.reason === "user_missing";
    if (hardBlock || !gov.isImportUpdateMethod(resolvedMethod)) return [];
  }
  if (gov.isImportUpdateMethod(resolvedMethod)) {
    acceptance.accept = true;
    // Étape 70 — imports count via unique users, not as abuse.
    if (acceptance.reason === "rate_limited" || acceptance.reason === "mass_changes" || acceptance.reason === "ok") {
      if (acceptance.reason !== "test_account" && acceptance.reason !== "suspended") {
        acceptance.countTowardCommunity = true;
        acceptance.reason = "ok_import";
      }
    }
    acceptance.updateMethod = resolvedMethod;
  }
  const inserted = [];

  for (const change of changes) {
    if (!change || !change.variantId) continue;
    const variantId = String(change.variantId);
    const spriteId = change.spriteId ? String(change.spriteId) : null;
    const created = change.isNewEntry === true || change.created === true || change.hadEntry === false;

    const previousStatus = created
      ? null
      : String(
          change.previousStatus != null ? change.previousStatus : change.oldStatus != null ? change.oldStatus : "new"
        );
    const newStatus = String(
      change.newStatus != null ? change.newStatus : previousStatus != null ? previousStatus : "new"
    );
    const previousPriority = String(
      change.previousPriority != null
        ? change.previousPriority
        : change.oldPriority != null
          ? change.oldPriority
          : "none"
    );
    const newPriority = String(change.newPriority != null ? change.newPriority : previousPriority);

    const statusChanged = !created && previousStatus !== newStatus;
    const becamePriority = newStatus === "priority" && (created || previousStatus !== "priority");
    // Étape 15 — skip no-op updates entirely.
    if (!created && !statusChanged && !becamePriority) continue;

    const catVersion = change.catalogueVersion || catalogueVersion || null;
    const entryId = change.entryId != null ? String(change.entryId) : null;
    const changeId = change.changeId != null ? String(change.changeId) : entryId || (created ? "create" : null);
    const fortniteEventId = change.eventId || change.fortniteEventId || null;

    if (created) {
      const row = await recordGraphEvent(
        client,
        {
          eventType: GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED,
          eventVersion: GRAPH_EVENT_VERSIONS[GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED],
          actorUserId: actor,
          spriteId,
          variantId,
          source: canonicalSource,
          origin: origin || source,
          occurredAt: when,
          context: {
            newStatus,
            newPriority,
            catalogueVersion: catVersion,
            updateMethod: resolvedMethod
          },
          deduplicationKey: buildDeduplicationKey(
            GRAPH_EVENT_TYPES.COLLECTION_SPRITE_ADDED,
            actor,
            variantId,
            changeId || "create"
          )
        },
        { throwOnError, governanceAcceptance: acceptance }
      );
      if (row) inserted.push(row);

      // Étape 16 — first row created directly as priority.
      if (becamePriority) {
        const pr = await recordPriorityAddedEvent(actor, {
          spriteId,
          variantId,
          previousStatus: "absent",
          newPriority,
          priorityLevel: resolvePriorityLevel(change, newPriority),
          eventId: fortniteEventId,
          catalogueVersion: catVersion,
          changeId: `${changeId || "create"}:absent->priority`,
          source: canonicalSource,
          origin: origin || source,
          occurredAt: when,
          updateMethod: resolvedMethod,
          db: client,
          throwOnError,
          governanceAcceptance: acceptance
        });
        if (pr) inserted.push(pr);
      }
      continue;
    }

    if (statusChanged) {
      const statusChangeId =
        change.historyId != null
          ? `history_${change.historyId}`
          : changeId
            ? `${changeId}:${previousStatus}->${newStatus}`
            : `${previousStatus}->${newStatus}:${when}`;
      const row = await recordGraphEvent(
        client,
        {
          eventType: GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED,
          eventVersion: GRAPH_EVENT_VERSIONS[GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED],
          actorUserId: actor,
          spriteId,
          variantId,
          source: canonicalSource,
          origin: origin || source,
          occurredAt: when,
          context: {
            previousStatus,
            newStatus,
            catalogueVersion: catVersion,
            oldStatus: previousStatus,
            updateMethod: resolvedMethod
          },
          deduplicationKey: buildDeduplicationKey(
            GRAPH_EVENT_TYPES.COLLECTION_STATUS_CHANGED,
            actor,
            variantId,
            statusChangeId
          )
        },
        { throwOnError, governanceAcceptance: acceptance }
      );
      if (row) inserted.push(row);
    }

    // Étape 16 — intentional "priority" status (in addition to status_changed).
    if (becamePriority) {
      const pr = await recordPriorityAddedEvent(actor, {
        spriteId,
        variantId,
        previousStatus,
        newPriority,
        priorityLevel: resolvePriorityLevel(change, newPriority),
        eventId: fortniteEventId,
        catalogueVersion: catVersion,
        changeId:
          change.historyId != null
            ? `history_${change.historyId}:priority`
            : changeId
              ? `${changeId}:${previousStatus}->priority`
              : null,
        source: canonicalSource,
        origin: origin || source,
        occurredAt: when,
        updateMethod: resolvedMethod,
        db: client,
        throwOnError,
        governanceAcceptance: acceptance
      });
      if (pr) inserted.push(pr);
    }
  }

  return inserted;
}

module.exports = { recordCollectionGraphEvents };
