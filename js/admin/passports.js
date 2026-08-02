(() => {
  "use strict";

  async function loadPassports() {
    const data = await adminFetch("/api/admin/passports"), s = data.summaries || {};
    const queue = new Map((data.queue || []).map(item => [item.status, item.count]));
    $("#passportKpis").innerHTML = [kpi(english ? "Passport summaries" : "Résumés passeport", formatNumber(s.total), s.last_recalculated ? `${english ? "last" : "dernier"} ${formatDate(s.last_recalculated)}` : "—"), kpi(english ? "Stale summaries" : "Résumés obsolètes", formatNumber(s.stale), english ? "older than 24 hours" : "plus de 24 heures", Number(s.stale) ? "warning" : ""), kpi(english ? "Queued recalculations" : "Recalculs en attente", formatNumber((Number(queue.get("pending")) || 0) + (Number(queue.get("processing")) || 0)), english ? "background worker" : "worker de fond"), kpi(english ? "Failed recalculations" : "Recalculs en échec", formatNumber(queue.get("failed")), english ? "requires review" : "à surveiller", Number(queue.get("failed")) ? "danger" : "")].join("");
    $("#passportVisibility").innerHTML = (data.visibility || []).map(item => `<div class="admin-status-row"><span>${escapeHtml(label(item.passport_visibility))}</span><strong>${formatNumber(item.count)}</strong></div>`).join("") || empty();
    $("#passportAchievements").innerHTML = (data.topAchievements || []).map(item => `<div class="admin-status-row"><span>${escapeHtml(item.achievement_id)}</span><strong>${formatNumber(item.unlocks)}</strong></div>`).join("") || empty();
  }

  Object.assign(window, { loadPassports });
})();
