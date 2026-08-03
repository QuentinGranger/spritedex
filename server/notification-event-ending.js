// ── Wanted event ending soon (Étape 34+) ──────────────────────────────────
// Finds users concerned by catalogue.event_ending_soon → wanted_event_ending_soon.
//
// Étape 34 — a user is concerned when the event contains at least one variant
// that is: status=`priority` (v1), not owned, and still available.
// Optional `missing` interest can be enabled later via includeMissing.
// Étape 37 — one notification per event×user, grouping all remaining priority
// variants (never one alert per variant).
// Étape 38 — persist as queued, revalidate before send; cancel if no priority
// remains, event inactive, end date changed, or prefs disabled.

const { pool } = require("./db");
const catalog = require("./notification-catalog");
const notifPrefs = require("./notification-preferences");
const pushService = require("../push-service");
const { claimNotification, claimDedupeKey } = require("./event-idempotency");
const grouping = require("./notification-grouping");
const {
  classifyAvailabilityStatus,
  evaluateVariantStillAvailable,
  resolveWantedEventInterestStatuses,
  isStrongWantedPriority,
  isWantedEventThresholdAllowed,
  normalizeWantedEventThresholdId,
  classifyWantedEventThreshold,
  evaluateWantedEventEndDateReliability,
  evaluateWantedEventPreSend,
  normalizeEndDateKey,
  buildWantedEventEndingDedupeKey,
  WANTED_EVENT_DEFAULT_THRESHOLD_ID
} = require("./notification-gates");

const TYPE = catalog.NOTIFICATION_TYPES.WANTED_EVENT_ENDING_SOON;
const CATEGORY = catalog.NOTIFICATION_CATEGORIES.ALERTS;

/**
 * Keeps only variants that are still available now for the given event
 * (status available_now, start reached, end not passed).
 */
async function filterStillAvailableVariantIds(variantIds, eventId, now = new Date()) {
  if (!Array.isArray(variantIds) || !variantIds.length) return [];

  const res = await pool.query(
    `SELECT v.id AS variant_id,
            v.availability AS variant_availability,
            s.availability AS sprite_availability,
            ap.status AS period_status,
            ap.start_date AS period_start,
            ap.end_date AS period_end,
            ap.data_status AS period_data_status
     FROM sprite_variants v
     JOIN sprites s ON s.id = v.sprite_id
     LEFT JOIN LATERAL (
       SELECT status, start_date, end_date, data_status
       FROM availability_periods
       WHERE sprite_id = s.id
         AND ($2::text IS NULL OR event_id = $2 OR event_id IS NULL)
       ORDER BY
         CASE WHEN $2::text IS NOT NULL AND event_id = $2 THEN 0 ELSE 1 END,
         start_date DESC NULLS LAST
       LIMIT 1
     ) ap ON TRUE
     WHERE v.id = ANY($1::text[])`,
    [variantIds, eventId || null]
  );

  const available = [];
  for (const row of res.rows) {
    if (String(row.period_data_status || "").toLowerCase() === "invalid") continue;

    const variantAvail = row.variant_availability || {};
    const spriteAvail = row.sprite_availability || {};
    const status = classifyAvailabilityStatus(row.period_status || variantAvail.status || spriteAvail.status);
    const availableFrom = row.period_start || variantAvail.startDate || spriteAvail.startDate || null;
    const availableUntil = row.period_end || variantAvail.endDate || spriteAvail.endDate || null;

    const gate = evaluateVariantStillAvailable({
      status,
      availableFrom,
      availableUntil,
      now
    });
    if (gate.ok) available.push(row.variant_id);
  }
  return available;
}

/**
 * Étape 34 — users who want at least one still-available event variant.
 * v1: status=`priority` only. Pass includeMissing=true to also count `missing`
 * (future preference). Already-owned entries never qualify.
 *
 * @returns {Promise<Array<{ userId, wantedCount, variantIds, hasStrongPriority }>>}
 */
async function findWantedEventRecipients(
  variantIds,
  { eventId = null, includeMissing = false, now = new Date() } = {}
) {
  const availableIds = await filterStillAvailableVariantIds(variantIds, eventId, now);
  if (!availableIds.length) return [];

  const statuses = resolveWantedEventInterestStatuses({ includeMissing });
  const res = await pool.query(
    `SELECT se.user_id,
            COUNT(DISTINCT se.variant_id)::int AS wanted_count,
            ARRAY_AGG(DISTINCT se.variant_id) AS variant_ids,
            ARRAY_AGG(DISTINCT se.priority) AS priorities
     FROM sprite_entries se
     JOIN users u ON u.id = se.user_id
     WHERE se.variant_id = ANY($1::text[])
       AND se.status = ANY($2::text[])
       AND se.status <> 'owned'
       AND u.deleted_at IS NULL
     GROUP BY se.user_id
     HAVING COUNT(DISTINCT se.variant_id) > 0`,
    [availableIds, statuses]
  );

  return res.rows.map((row) => {
    const priorities = row.priorities || [];
    return {
      userId: row.user_id,
      wantedCount: row.wanted_count,
      variantIds: row.variant_ids || [],
      hasStrongPriority: priorities.some(isStrongWantedPriority)
    };
  });
}

/**
 * Étape 35 — resolve which threshold this domain event represents.
 * Prefer an explicit context.threshold; otherwise classify from endDate.
 * Falls back to the default 3-day threshold when neither is usable.
 */
function resolveEventThreshold(ctx = {}, now = new Date()) {
  const explicit = normalizeWantedEventThresholdId(ctx.threshold || ctx.thresholdId);
  if (explicit) return explicit;
  if (ctx.endDate || ctx.endsAt) {
    return classifyWantedEventThreshold(ctx.endDate || ctx.endsAt, now) || WANTED_EVENT_DEFAULT_THRESHOLD_ID;
  }
  return WANTED_EVENT_DEFAULT_THRESHOLD_ID;
}

/**
 * Étape 36 — resolve end-date confidence for the event.
 * Prefers explicit context, then the event row / linked availability periods.
 */
async function resolveEndDateReliability(eventId, ctx = {}) {
  let endDate = ctx.endDate || ctx.endsAt || null;
  let confidence = ctx.endDateConfidence || ctx.confidence || null;

  if (!endDate || !confidence) {
    const eventRes = await pool.query(
      `SELECT e.end_date,
              (
                SELECT ap.confidence
                FROM availability_periods ap
                WHERE ap.event_id = e.id AND ap.end_date IS NOT NULL
                ORDER BY ap.updated_at DESC NULLS LAST
                LIMIT 1
              ) AS period_confidence
       FROM events e
       WHERE e.id = $1`,
      [eventId]
    );
    const row = eventRes.rows[0];
    if (row) {
      if (!endDate) endDate = row.end_date;
      if (!confidence) confidence = row.period_confidence || null;
    }
  }

  // No linked period confidence → treat as unknown (do not affirm).
  if (!confidence) confidence = "unknown";

  return {
    endDate,
    confidence: String(confidence).toLowerCase(),
    ...evaluateWantedEventEndDateReliability({ endDate, confidence })
  };
}

/**
 * Étape 38 — live checks just before send.
 * Returns { ok, reason?, cancel?, remainingPriorityVariantIds, remainingCount, endDate, eventActive }.
 */
async function revalidateWantedEventBeforeSend({
  recipientId,
  eventId,
  scheduledEndingAt = null,
  candidateVariantIds = [],
  includeMissing = false
} = {}) {
  const eventRes = await pool.query(`SELECT id, end_date, data_status FROM events WHERE id = $1`, [eventId]);
  const eventRow = eventRes.rows[0];
  if (!eventRow) {
    return { ok: false, reason: "event_missing", cancel: true, remainingCount: 0, remainingPriorityVariantIds: [] };
  }

  const currentEnd = eventRow.end_date;
  const now = new Date();
  const endMs = currentEnd ? new Date(currentEnd).getTime() : NaN;
  const eventActive =
    String(eventRow.data_status || "").toLowerCase() !== "invalid" && !Number.isNaN(endMs) && endMs > now.getTime();

  const endDateUnchanged =
    scheduledEndingAt == null ? true : normalizeEndDateKey(scheduledEndingAt) === normalizeEndDateKey(currentEnd);

  const resolvedPrefs = await notifPrefs.resolveChannelPreferences(pool, recipientId, TYPE, { category: CATEGORY });
  const prefsAccepted = resolvedPrefs.categoryEnabled !== false && notifPrefs.evaluateTypeActive(resolvedPrefs);

  const statuses = resolveWantedEventInterestStatuses({ includeMissing });
  const availableIds = await filterStillAvailableVariantIds(candidateVariantIds, eventId, now);
  let remainingPriorityVariantIds = [];
  if (availableIds.length) {
    const rem = await pool.query(
      `SELECT se.variant_id
       FROM sprite_entries se
       WHERE se.user_id = $1
         AND se.variant_id = ANY($2::text[])
         AND se.status = ANY($3::text[])
         AND se.status <> 'owned'`,
      [recipientId, availableIds, statuses]
    );
    remainingPriorityVariantIds = rem.rows.map((r) => String(r.variant_id)).sort();
  }

  const gate = evaluateWantedEventPreSend({
    remainingCount: remainingPriorityVariantIds.length,
    eventActive,
    endDateUnchanged,
    prefsAccepted
  });

  return {
    ...gate,
    remainingPriorityVariantIds,
    remainingCount: remainingPriorityVariantIds.length,
    endDate: currentEnd,
    eventActive,
    endDateUnchanged,
    prefsAccepted
  };
}

async function finalizeQueuedWantedEventNotification(
  created,
  {
    recipientId,
    eventId,
    eventName,
    thresholdId,
    hasStrongPriority,
    scheduledEndingAt,
    candidateVariantIds,
    endDateConfidence
  }
) {
  if (!created?.id) return { status: "missing" };

  const check = await revalidateWantedEventBeforeSend({
    recipientId,
    eventId,
    scheduledEndingAt,
    candidateVariantIds,
    includeMissing: false
  });

  if (!check.ok) {
    // Étape 38 — if nothing priority remains (or other checks fail), cancel.
    await pushService.cancelNotification(pool, created.id);
    return { status: "cancelled", reason: check.reason };
  }

  const { normalizeTimeZone, toUtcIso } = require("./timezone");
  const timeZone = normalizeTimeZone(created.data?.timeZone || created.data?.timezone || created.user?.timezone);
  const endingAtUtc = toUtcIso(check.endDate);
  const context = {
    eventName,
    eventId,
    endingAt: endingAtUtc,
    endDate: endingAtUtc,
    endDateConfidence,
    remainingPriorityVariantIds: check.remainingPriorityVariantIds,
    remainingCount: check.remainingCount,
    wantedCount: check.remainingCount,
    variantIds: check.remainingPriorityVariantIds,
    threshold: thresholdId,
    hasStrongPriority,
    timeZone,
    timezone: timeZone
  };
  const rendered = catalog.renderNotification(TYPE, context, created.data?.lang || catalog.DEFAULT_LANGUAGE);
  const nextData = {
    ...(created.data || {}),
    ...(rendered?.data || {}),
    deferred: false,
    pushSent: false,
    remainingPriorityVariantIds: check.remainingPriorityVariantIds,
    remainingCount: check.remainingCount,
    endingAt: endingAtUtc,
    timeZone
  };

  await pool.query(
    `UPDATE notifications
     SET title = $1, body = $2, data = $3::jsonb, status = 'queued'
     WHERE id = $4 AND status IN ('created', 'queued')`,
    [rendered?.title || created.title, rendered?.body || created.body, JSON.stringify(nextData), created.id]
  );

  // Étape 42 — enqueue external delivery (never send in this request path).
  // Quiet-hours push uses not_before = pushDeliverAt (Étape 41).
  const deliveryQueue = require("./notification-delivery-queue");
  const title = rendered?.title || created.title;
  const body = rendered?.body || created.body;
  const url = rendered?.url || created.url;
  const data = nextData;
  const dataHasDeferredPush = !!data.pushDeferred;

  const immediateChannels = (created.targetChannels || []).filter((c) => {
    if (c !== "push" && c !== "email") return false;
    if (c === "push" && dataHasDeferredPush) return false;
    return true;
  });
  if (immediateChannels.length) {
    await deliveryQueue
      .enqueueDelivery(pool, {
        notificationId: created.id,
        recipientId,
        channels: immediateChannels,
        notBefore: new Date(),
        title,
        body,
        url
      })
      .catch((err) => console.error("[wanted_event_ending_soon] enqueue failed:", err.message));
  }
  if (dataHasDeferredPush) {
    await deliveryQueue
      .enqueueDelivery(pool, {
        notificationId: created.id,
        recipientId,
        channels: ["push"],
        notBefore: data.pushDeliverAt || new Date(),
        deadline: data.pushDeadline || endingAtUtc,
        title,
        body,
        url
      })
      .catch((err) => console.error("[wanted_event_ending_soon] quiet-hours enqueue failed:", err.message));
  }

  return { status: "queued", remainingCount: check.remainingCount };
}

async function handleCatalogueEventEndingSoon(event) {
  const ctx = event.context || {};
  const eventId = event.entityId || ctx.eventId;
  const { eventName, variantIds } = ctx;
  if (!eventId || !Array.isArray(variantIds) || !variantIds.length) return;

  // Étape 36 — no affirmative ending-soon push from estimated / unconfirmed dates.
  const endDateGate = await resolveEndDateReliability(eventId, ctx);
  if (!endDateGate.ok) return;

  const thresholdId = resolveEventThreshold({
    ...ctx,
    endDate: endDateGate.endDate
  });

  // Étape 34 — v1: priority variants only (includeMissing left false until prefs exist).
  const recipients = await findWantedEventRecipients(variantIds, {
    eventId,
    includeMissing: false
  });

  for (const row of recipients) {
    const recipientId = row.userId;

    // Étape 35 — default 3d; 24h only for strong priorities; 7d off by default.
    const thresholdGate = isWantedEventThresholdAllowed({
      thresholdId,
      hasStrongPriority: row.hasStrongPriority
    });
    if (!thresholdGate.ok) continue;

    const resolved = await notifPrefs.resolveChannelPreferences(pool, recipientId, TYPE, { category: CATEGORY });
    if (resolved.categoryEnabled === false || !notifPrefs.evaluateTypeActive(resolved)) continue;

    // Étape 39 — stable dedupe across hourly scheduler ticks.
    const dedupeKey = buildWantedEventEndingDedupeKey(recipientId, eventId, thresholdGate.thresholdId);
    if (!dedupeKey) continue;
    if (!(await claimDedupeKey(pool, dedupeKey, TYPE, recipientId))) continue;
    if (!(await claimNotification(pool, event.eventId, TYPE, recipientId))) continue;

    // Étape 37 — one notification per event for this user, listing all remaining
    // priority variants together (never one push per variant).
    const remainingPriorityVariantIds = [...(row.variantIds || [])].map(String).sort();
    const remainingCount = remainingPriorityVariantIds.length || row.wantedCount;

    const contextBase = {
      eventName,
      eventId,
      endingAt: endDateGate.endDate,
      endDate: endDateGate.endDate,
      endDateConfidence: endDateGate.confidence,
      remainingPriorityVariantIds,
      remainingCount,
      wantedCount: remainingCount,
      variantIds: remainingPriorityVariantIds,
      threshold: thresholdGate.thresholdId,
      hasStrongPriority: row.hasStrongPriority,
      dedupeKey
    };
    const destination = catalog.buildWantedEventActionUrl(contextBase);
    // Étape 55 — group remaining priorities under event_deadline:{eventId}:{recipientId}.
    const context = grouping.attachGroup(
      contextBase,
      grouping.buildEventDeadlineGroup({
        eventId,
        recipientId,
        threshold: thresholdGate.thresholdId,
        endingAt: endDateGate.endDate,
        domainEventId: event.eventId,
        variantIds: remainingPriorityVariantIds,
        destination
      })
    );

    const createArgs = {
      recipientId,
      type: TYPE,
      entityType: "event",
      entityId: eventId,
      status: "queued",
      deferDelivery: true,
      context
    };
    const finalizeArgs = {
      recipientId,
      eventId,
      eventName,
      thresholdId: thresholdGate.thresholdId,
      hasStrongPriority: row.hasStrongPriority,
      scheduledEndingAt: endDateGate.endDate,
      candidateVariantIds: variantIds,
      endDateConfidence: endDateGate.confidence
    };

    // Étape 50 — alerts default to immediate; daily_digest defers create+finalize.
    const freq = resolved.frequency || catalog.getDefaultFrequency(TYPE);
    if (freq === catalog.NOTIFICATION_FREQUENCIES.DAILY_DIGEST) {
      const digest = require("./notification-digest");
      await digest.enqueueDigestItem(pool, {
        recipientId,
        type: TYPE,
        payload: { createArgs, finalizeArgs, kind: "wanted_event_ending_soon" }
      });
      continue;
    }

    // Étape 38 — schedule as queued, revalidate, then send or cancel.
    const created = await pushService.createNotification(pool, createArgs);
    await finalizeQueuedWantedEventNotification(created, finalizeArgs);
  }
}

module.exports = {
  handleCatalogueEventEndingSoon,
  findWantedEventRecipients,
  filterStillAvailableVariantIds,
  resolveEventThreshold,
  resolveEndDateReliability,
  revalidateWantedEventBeforeSend,
  finalizeQueuedWantedEventNotification
};
