"use strict";

const { sendNotificationToUser } = require("./notify");

// Detached external delivery for a stored notification (Étape 7). Attempts push
// then email on the resolved channels and flips the row to 'delivered'/'failed'.
// Only a genuine send counts as an attempt: an empty push token set or an email
// skipped for lack of configuration leaves the row as-is (in-app only).
async function deliverExternalChannels(pool, { notificationId, recipientId, user = {}, targetChannels = [], title, body, url, lang = null }) {
  let externalAttempted = false;
  let externalDelivered = false;
  const deliveries = require("../../../../../server/notification-deliveries");
  let emailLang = lang;
  if (!emailLang) {
    try {
      const { resolveNotificationLanguage } = require("../../../../../server/i18n");
      emailLang = resolveNotificationLanguage(user.preferred_language, null);
    } catch (_err) {
      emailLang = "fr";
    }
  }

  if (targetChannels.includes("push")) {
    await deliveries.markDeliveryAttempt(pool, notificationId, "push", { provider: "web_push" }).catch(() => {});
    const results = await sendNotificationToUser(pool, recipientId, { title, body, url });
    if (Array.isArray(results) && results.length) {
      externalAttempted = true;
      const ok = results.filter(r => r.ok);
      if (ok.length) {
        externalDelivered = true;
        await deliveries.markDeliveryDelivered(pool, notificationId, "push", {
          provider: "web_push",
          providerMessageId: ok[0].messageId || ok[0].id || null
        }).catch(() => {});
      } else {
        const err = results.find(r => !r.ok);
        const permanent = results.some(r => r.permanent);
        await deliveries.markDeliveryFailed(pool, notificationId, "push", {
          provider: "web_push",
          errorCode: permanent ? "subscription_invalid" : (err?.statusCode ? String(err.statusCode) : "push_failed"),
          errorMessage: err?.error || "push delivery failed"
        }).catch(() => {});
      }
    } else {
      // No active tokens — permanent for this attempt; inbox notification stays.
      await deliveries.markDeliveryFailed(pool, notificationId, "push", {
        provider: "web_push",
        errorCode: "no_tokens",
        errorMessage: "No enabled push tokens"
      }).catch(() => {});
    }
  }

  if (targetChannels.includes("email") && user.email) {
    try {
      await deliveries.markDeliveryAttempt(pool, notificationId, "email", { provider: "resend" }).catch(() => {});
      // Lazy require avoids a require cycle with core at load time.
      const { sendNotificationEmail } = require("../../../../../server/core");
      const emailResult = await sendNotificationEmail(user.email, {
        title,
        body,
        url,
        lang: emailLang,
        // The delivery worker can retry the same notification. Keep Resend
        // idempotent for that one notification, without suppressing a later
        // notification that happens to have identical text.
        idempotencyKey: notificationId
      });
      if (emailResult && emailResult.ok) {
        externalAttempted = true;
        externalDelivered = true;
        await deliveries.markDeliveryDelivered(pool, notificationId, "email", {
          provider: "resend",
          providerMessageId: emailResult.id || emailResult.messageId || null
        }).catch(() => {});
      } else if (emailResult && emailResult.skipped) {
        await deliveries.markDeliveryCancelled(pool, notificationId, "email", {
          errorCode: "skipped",
          errorMessage: emailResult.reason || "email skipped"
        }).catch(() => {});
      } else if (emailResult && !emailResult.skipped) {
        externalAttempted = true; // genuine email failure
        await deliveries.markDeliveryFailed(pool, notificationId, "email", {
          provider: "resend",
          errorCode: "email_failed",
          errorMessage: emailResult.error || "email delivery failed"
        }).catch(() => {});
      }
    } catch (e) {
      externalAttempted = true;
      console.warn("[deliverExternalChannels] email channel failed:", e.message);
      await deliveries.markDeliveryFailed(pool, notificationId, "email", {
        provider: "resend",
        errorCode: "email_exception",
        errorMessage: e.message
      }).catch(() => {});
    }
  }

  if (externalAttempted) {
    if (externalDelivered) {
      await pool.query(
        `UPDATE notifications
         SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW())
         WHERE id = $1 AND status IN ('created', 'queued', 'failed')`,
        [notificationId]
      ).catch(err => console.error("[deliverExternalChannels] status update failed:", err.message));
    } else {
      // Étape 45 — push/token failure must not hide the in-app notification.
      await pool.query(
        `UPDATE notifications SET status = 'created'
         WHERE id = $1 AND status IN ('queued', 'failed')`,
        [notificationId]
      ).catch(err => console.error("[deliverExternalChannels] status update failed:", err.message));
    }
  }
}

module.exports = { deliverExternalChannels };
