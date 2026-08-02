(() => {
  "use strict";

  async function loadNotifications() {
    const data = await adminFetch("/api/admin/notifications/operations");
    const queue = new Map((data.queue || []).map(row => [row.status, row.count])), push = data.push || {}, digests = data.digests || {}, health = data.health || {};
    $("#notificationKpis").innerHTML = [kpi(english ? "Queued deliveries" : "Livraisons en attente", formatNumber((Number(queue.get("pending")) || 0) + (Number(queue.get("processing")) || 0)), english ? "push and email" : "push et e-mail"), kpi(english ? "Failed deliveries" : "Livraisons en échec", formatNumber(queue.get("failed")), english ? "recoverable jobs" : "jobs récupérables", Number(queue.get("failed")) ? "danger" : ""), kpi(english ? "Active push devices" : "Appareils push actifs", formatNumber(push.active), `${formatNumber(push.invalid)} ${english ? "invalid" : "invalides"}`), kpi(english ? "Digest queue" : "File des digests", formatNumber(digests.count), digests.next_flush_at ? `${english ? "next" : "prochain"} ${formatDate(digests.next_flush_at)}` : "—")].join("");
    $("#notificationDeliveries").innerHTML = (data.deliveries || []).length ? data.deliveries.map(row => `<div class="admin-status-row"><span>${escapeHtml(label(row.channel))} · ${escapeHtml(label(row.status))}</span><strong>${formatNumber(row.count)}</strong></div>`).join("") : empty();
    $("#notificationHealth").innerHTML = [[english ? "Oldest queued" : "Plus ancienne en attente", health.oldest_pending_at ? formatDate(health.oldest_pending_at) : "—"], [english ? "Latest failure" : "Dernier échec", health.latest_failure_at ? formatDate(health.latest_failure_at) : "—"], [english ? "Cancelled" : "Annulées", formatNumber(health.cancelled)]].map(([key, value]) => `<div class="admin-status-row"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    const retryAll = $("#retryFailedNotifications");
    state.bulkData.failedNotifications = (Number(queue.get("failed")) || 0) + (Number(queue.get("cancelled")) || 0);
    if (retryAll) retryAll.disabled = !(Number(queue.get("failed")) || Number(queue.get("cancelled")));
    state.notifications.visibleItems = data.failedJobs || [];
    state.notifications.visibleItems.forEach((job) => state.notifications.bulkItems.set(String(job.id), job));
    const selected = state.notifications.bulkIds.size;
    const visibleSelected = state.notifications.visibleItems.filter((job) => state.notifications.bulkIds.has(String(job.id))).length;
    const toolbar = state.notifications.visibleItems.length && can("notifications.write") ? `<div class="admin-bulk-bar admin-bulk-bar--embedded"><div class="admin-bulk-bar__selection"><strong>${selected ? (english ? `${formatNumber(selected)} selected` : `${formatNumber(selected)} sélectionné(s)`) : (english ? "Select deliveries" : "Sélectionner des livraisons")}</strong><small>${english ? `${formatNumber(visibleSelected)} shown · only failed or cancelled jobs` : `${formatNumber(visibleSelected)} affiché(s) · uniquement les jobs en échec ou annulés`}</small></div><button class="admin-button admin-button--quiet" type="button" data-notification-select-page>${visibleSelected === state.notifications.visibleItems.length ? (english ? "Clear shown" : "Effacer l’affichage") : (english ? "Select shown" : "Sélectionner l’affichage")}</button>${selected ? `<button class="admin-button" type="button" data-notification-bulk-apply>${english ? "Review impact" : "Vérifier l’impact"}</button>` : ""}</div>` : "";
    $("#failedNotificationJobs").innerHTML = toolbar + (state.notifications.visibleItems.length ? state.notifications.visibleItems.map(job => `<article class="admin-failure admin-failure--selectable"><label class="admin-failure__select"><input type="checkbox" data-bulk-notification-toggle="${job.id}" ${state.notifications.bulkIds.has(String(job.id)) ? "checked" : ""} aria-label="${english ? "Select delivery" : "Sélectionner la livraison"} #${job.id}" /></label><div class="admin-failure__top"><code>#${job.id} · ${escapeHtml((job.channels || []).join(", "))}</code><small>${escapeHtml(label(job.status || "failed"))} · ${formatNumber(job.attempts)} / ${formatNumber(job.max_attempts)}</small></div><p>${escapeHtml(job.last_error || "—")}</p><small>${english ? "Updated" : "Mis à jour"} · ${formatDate(job.updated_at)}</small>${can("notifications.write") ? `<button class="admin-row-button" type="button" data-retry-job="${job.id}">${tr("retry", "Relancer")}</button>` : ""}</article>`).join("") : empty(tr("noFailures", "Aucun job en échec.")));
  }

  async function retryFailedNotifications() {
    openBulkAction("notifications");
  }

  Object.assign(window, { loadNotifications, retryFailedNotifications });
})();
