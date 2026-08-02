"use strict";

const notificationCatalog = require("../../../../../server/notification-catalog");
const notificationChannels = require("../../../../../server/notification-channels");

// ── Notification status lifecycle ──
// Moves a notification to a new status and stamps the matching timestamp
// column. Timestamps are only set the first time (COALESCE) so we keep the
// original moment of delivery/read/etc.
const STATUS_TIMESTAMP = {
  delivered: "delivered_at",
  read: "read_at",
  archived: "archived_at"
};

async function setNotificationStatus(pool, notificationId, status, { recipientId } = {}) {
  if (!notificationId || !notificationCatalog.isKnownStatus(status)) return false;
  const tsCol = STATUS_TIMESTAMP[status];
  const stampClause = tsCol ? `, ${tsCol} = COALESCE(${tsCol}, NOW())` : "";
  const args = [notificationId, status];
  let where = "id = $1";
  if (recipientId) {
    where += " AND recipient_id = $3";
    args.push(recipientId);
  }
  const result = await pool.query(
    `UPDATE notifications SET status = $2${stampClause} WHERE ${where} RETURNING id`,
    args
  );
  return result.rows.length > 0;
}

// ── Inbox notifications ──
// Persists a notification for the recipient and dispatches a push when allowed.
async function createNotification(
  pool,
  {
    recipientId,
    actorId,
    type,
    category,
    entityType,
    entityId,
    context = {},
    data,
    title,
    body,
    message,
    url,
    status = "created",
    // null/undefined → resolve from recipient.preferred_language (client Accept-Language).
    // Pass an explicit lang only when a caller must force wording.
    lang = null,
    allowPush = true,
    // When true, persist the row (typically status='queued') but do not push/email
    // yet — callers revalidate then deliver or cancel (Étape 38).
    deferDelivery = false
  }
) {
  if (!recipientId) return null;
  if (actorId && String(actorId) === String(recipientId)) return null;

  const finalCategory = category || notificationCatalog.getCategory(type) || "general";

  try {
    // Étape 57 — never create pairwise social/collection notifs across a block.
    if (actorId) {
      const blocks = require("../../../../../server/notification-blocks");
      if (blocks.isBlockedPairwiseType(type)) {
        const { isBlocked } = require("../../../../../server/auth");
        if (await isBlocked(recipientId, actorId)) return null;
      }
    }

    const userRes = await pool.query(
      `SELECT email, push_enabled, push_pref_friend_collection_updates, push_pref_friend_priority_matches,
              push_quiet_start, push_quiet_end, push_max_per_day, timezone, preferred_language
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [recipientId]
    );
    if (!userRes.rows.length) return null;
    const user = userRes.rows[0];

    if (type === "friend_collection_updated" && user.push_pref_friend_collection_updates === false) return null;
    if (type === "friend_priority_match" && user.push_pref_friend_priority_matches === false) return null;

    const { resolveNotificationLanguage } = require("../../../../../server/i18n");
    const resolvedLang = resolveNotificationLanguage(user.preferred_language, lang);

    // Étape 40 — render with the user's timezone; keep instants as UTC ISO in data.
    const { normalizeTimeZone, toUtcIso } = require("../../../../../server/timezone");
    const timeZone = normalizeTimeZone(user.timezone);
    user.timezone = timeZone;
    const baseContext = context && typeof context === "object" ? { ...context } : {};
    for (const key of ["endingAt", "endDate", "availableFrom", "availableUntil"]) {
      if (baseContext[key] != null) {
        const iso = toUtcIso(baseContext[key]);
        if (iso) baseContext[key] = iso;
      }
    }
    baseContext.timeZone = baseContext.timeZone || baseContext.timezone || timeZone;
    baseContext.timezone = baseContext.timeZone;

    // Enrich actor display name for localized templates when missing.
    if (
      actorId &&
      !baseContext.actorName &&
      !baseContext.friendName &&
      !baseContext.ownerName &&
      !baseContext.joinerName
    ) {
      const actorRes = await pool.query(
        "SELECT username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL",
        [actorId]
      );
      const actorRow = actorRes.rows[0];
      if (actorRow) {
        baseContext.actorName = actorRow.display_name || actorRow.username || null;
        if (!baseContext.friendName) baseContext.friendName = baseContext.actorName;
      }
    }
    if (actorId && baseContext.actorId == null) baseContext.actorId = String(actorId);

    // Localize badge labels for the recipient language.
    if (type === "badge_unlocked") {
      try {
        const badges = require("../../../../../server/passport-badges");
        const codes = Array.isArray(baseContext.badgeCodes) ? baseContext.badgeCodes : [];
        if (codes.length) {
          baseContext.badgeLabels = codes.map((code) => badges.labelForBadgeCode(code, resolvedLang) || code);
          baseContext.count = baseContext.badgeLabels.length;
        }
      } catch (_err) {
        /* keep provided labels */
      }
    }

    // Étape 40/62 — render with timezone-aware context and localized catalog names.
    const rendered = notificationCatalog.isKnownType(type)
      ? await notificationCatalog.renderNotificationLocalized(pool, type, baseContext, resolvedLang)
      : null;
    // Prefer catalog copy for known types so callers cannot freeze French strings.
    const finalTitle = (rendered && rendered.title) || title || "SPRITE-INDEX";
    const finalBody = (rendered && rendered.body) || body || message || "";
    const finalUrl = url || (rendered ? rendered.url : "/");

    // `data` holds everything needed to render/navigate later: caller context,
    // then the catalog payload (friendId, actionUrl, actions…) so structured
    // fields stay canonical, plus related ids.
    const catalogData = rendered && rendered.data && typeof rendered.data === "object" ? rendered.data : {};
    const baseData = data && typeof data === "object" ? data : baseContext;
    // Étape 53 — send-priority score (used when the daily push cap is hit).
    const sendPriority = notificationCatalog.resolveSendPriority(type, baseContext);
    const sendPriorityLevel = notificationCatalog.classifySendPriority(sendPriority);

    // Étape 61 — persist translation key + structured params for re-render.
    const translation = notificationCatalog.isKnownType(type)
      ? notificationCatalog.buildTranslationPayload(type, baseContext)
      : null;

    const storedData = {
      ...baseData,
      ...catalogData,
      timeZone,
      lang: resolvedLang,
      sendPriority,
      sendPriorityLevel,
      ...(actorId ? { actorId: String(actorId) } : {}),
      ...(recipientId ? { recipientId: String(recipientId) } : {}),
      ...(entityId ? { entityId: String(entityId) } : {}),
      ...(rendered && rendered.actions ? { actions: rendered.actions } : {}),
      ...(translation
        ? {
            translationKey: translation.translationKey,
            translationParams: translation.translationParams
          }
        : {})
    };

    // Étape 3: persist the notification FIRST (in-app is served by this row),
    // before any push/email work. The row is immediately visible in the inbox.
    const inserted = await pool.query(
      `INSERT INTO notifications
         (recipient_id, actor_id, type, category, title, body, entity_type, entity_id, data, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING id`,
      [
        recipientId,
        actorId || null,
        type,
        finalCategory,
        finalTitle,
        finalBody,
        entityType || null,
        entityId || null,
        JSON.stringify(storedData),
        status
      ]
    );
    const notificationId = inserted.rows[0]?.id;

    // Étape 43 — in_app delivery is recorded as soon as the inbox row exists.
    if (notificationId) {
      const deliveries = require("../../../../../server/notification-deliveries");
      await deliveries
        .recordInAppDelivery(pool, notificationId)
        .catch((err) => console.error("[createNotification] in_app delivery row failed:", err.message));
    }

    // Resolve delivery channels (Étape 7): combines the type's target channels,
    // the étape 6 subject gates (category+type) and per-channel toggles, plus the
    // push runtime constraints (consent, quiet hours, frequency, token state).
    // Étape 41 — quiet hours defer non-urgent push instead of dropping it.
    const resolved = await notificationChannels.resolveDeliveryChannels(pool, recipientId, type, {
      category: finalCategory,
      user,
      context: baseContext
    });
    let targetChannels = resolved.channels;
    const dropped = { ...resolved.dropped };
    let pushDeferral = resolved.deferral || null;
    // Étape 21 — callers may suppress push (e.g. per-friend daily push cap).
    if (allowPush === false) {
      if (targetChannels.includes("push")) {
        targetChannels = targetChannels.filter((c) => c !== "push");
        dropped.push = "friend_daily_limit";
      }
      pushDeferral = null;
    }

    // Persist the resolved channels into data so the inbox row is complete.
    const finalData = {
      ...storedData,
      channels: targetChannels,
      pushSent: false,
      ...(Object.keys(dropped).length ? { channelsDropped: dropped } : {}),
      ...(deferDelivery ? { deferred: true } : {}),
      // Étape 41 — schedule push for after the quiet window (in-app already stored).
      ...(pushDeferral
        ? {
            pushDeferred: true,
            pushDeliverAt: pushDeferral.deliverAt,
            ...(pushDeferral.deadline ? { pushDeadline: pushDeferral.deadline } : {})
          }
        : {})
    };
    if (notificationId) {
      await pool
        .query(`UPDATE notifications SET data = $1::jsonb WHERE id = $2`, [JSON.stringify(finalData), notificationId])
        .catch((err) => console.error("[createNotification] data update failed:", err.message));

      // Étape 42 — never send push/email in the request path. Enqueue jobs; a
      // background worker performs deliverExternalChannels and updates status.
      // Étape 38: deferDelivery waits for pre-send revalidation before enqueue.
      // Étape 43 — each external channel also gets a notification_deliveries row.
      if (!deferDelivery) {
        const deliveryQueue = require("../../../../../server/notification-delivery-queue");
        const deliveries = require("../../../../../server/notification-deliveries");
        const immediate = targetChannels.filter((c) => c === "email" || c === "push");
        if (immediate.length) {
          for (const ch of immediate) {
            await deliveries
              .ensureDelivery(pool, {
                notificationId,
                channel: ch,
                status: "queued",
                provider: ch === "push" ? "web_push" : "email",
                scheduledAt: new Date()
              })
              .catch(() => {});
          }
          await deliveryQueue
            .enqueueDelivery(pool, {
              notificationId,
              recipientId,
              channels: immediate,
              notBefore: new Date(),
              title: finalTitle,
              body: finalBody,
              url: finalUrl
            })
            .catch((err) => console.error("[createNotification] enqueue failed:", err.message));
        }
        if (pushDeferral) {
          await deliveries
            .ensureDelivery(pool, {
              notificationId,
              channel: "push",
              status: "queued",
              provider: "web_push",
              scheduledAt: pushDeferral.deliverAt
            })
            .catch(() => {});
          await deliveryQueue
            .enqueueDelivery(pool, {
              notificationId,
              recipientId,
              channels: ["push"],
              notBefore: pushDeferral.deliverAt,
              deadline: pushDeferral.deadline,
              title: finalTitle,
              body: finalBody,
              url: finalUrl
            })
            .catch((err) => console.error("[createNotification] quiet-hours enqueue failed:", err.message));
        }
      }
    }

    return {
      id: notificationId,
      title: finalTitle,
      body: finalBody,
      url: finalUrl,
      targetChannels,
      user,
      data: finalData
    };
  } catch (err) {
    console.error("[createNotification]", err);
    return null;
  }
}

module.exports = { setNotificationStatus, createNotification };
