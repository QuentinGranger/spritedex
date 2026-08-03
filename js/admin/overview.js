(() => {
  "use strict";

  async function loadOverview() {
    const data = await adminFetch("/api/admin/overview");
    const u = data.users || {},
      c = data.collection || {},
      n = data.notifications || {},
      m = data.moderation || {},
      cat = data.catalog || {};
    $("#overviewKpis").innerHTML = [
      kpi(
        english ? "Active users" : "Joueurs actifs",
        formatNumber(u.active15m),
        `${formatNumber(u.registrations24h)} ${english ? "registrations · 24h" : "inscriptions · 24 h"}`
      ),
      kpi(
        english ? "Collection changes" : "Collections modifiées",
        formatNumber(c.changes24h),
        english ? "last 24 hours" : "dernières 24 h"
      ),
      kpi(
        english ? "Open reports" : "Signalements ouverts",
        formatNumber(m.open),
        english ? "requires review" : "à traiter",
        Number(m.open) ? "warning" : ""
      ),
      kpi(
        english ? "Failed deliveries" : "Livraisons en échec",
        formatNumber(n.failed),
        english ? "notification queue" : "file de notifications",
        Number(n.failed) ? "danger" : ""
      ),
      kpi(
        english ? "Catalog to review" : "Catalogue à vérifier",
        formatNumber(cat.needsReview),
        `${formatNumber(cat.variants)} ${english ? "variants" : "variantes"}`,
        Number(cat.needsReview) ? "warning" : ""
      )
    ].join("");
    const actions = [
      {
        tab: "players",
        icon: "!",
        tone: Number(m.open) ? "warning" : "",
        title: english ? "Review open reports" : "Traiter les signalements",
        detail: `${formatNumber(m.open)} ${english ? "report(s) awaiting a decision" : "signalement(s) attendent une décision"}`,
        count: formatNumber(m.open)
      },
      {
        tab: "notifications",
        icon: "↻",
        tone: Number(n.failed) ? "danger" : "",
        title: english ? "Recover failed deliveries" : "Relancer les livraisons en échec",
        detail: `${formatNumber(n.failed)} ${english ? "job(s) can be retried" : "job(s) peuvent être relancés"}`,
        count: formatNumber(n.failed)
      },
      {
        tab: "collections",
        icon: "◇",
        tone: "",
        title: english ? "Check collection integrity" : "Vérifier la cohérence des collections",
        detail: english
          ? "Reference checks and safe corrective action."
          : "Contrôles de références et correction sûre.",
        count: tr("openTab", "Ouvrir")
      },
      {
        tab: "catalog",
        icon: "✦",
        tone: Number(cat.needsReview) ? "warning" : "",
        title: english ? "Review catalog confidence" : "Réviser la confiance du catalogue",
        detail: `${formatNumber(cat.needsReview)} ${english ? "variant(s) incomplete or unknown" : "variante(s) incomplète(s) ou inconnue(s)"}`,
        count: formatNumber(cat.needsReview)
      }
    ];
    $("#overviewActions").innerHTML = actions
      .map(
        (item) =>
          `<button class="admin-action ${item.tone ? `admin-action--${item.tone}` : ""}" type="button" data-go-tab="${item.tab}"><span class="admin-action__icon">${item.icon}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><span class="admin-action__cta">${escapeHtml(item.count)} ›</span></button>`
      )
      .join("");
    const r = data.realtime || {},
      d = data.database || {};
    $("#overviewRealtime").innerHTML = healthRows([
      [english ? "Connected players" : "Joueurs connectés", formatNumber(r.connectedUsers)],
      [english ? "Connected clients" : "Clients connectés", formatNumber(r.connectedClients)],
      [
        english ? "Pending squad invites" : "Invitations de squad en attente",
        formatNumber(data.social?.squad_invitations)
      ]
    ]);
    $("#overviewInfrastructure").innerHTML = healthRows([
      [english ? "Database latency" : "Latence base", `${formatNumber(d.latencyMs)} ms`],
      [english ? "Pool connections" : "Connexions pool", formatNumber(d.total)],
      [english ? "Waiting requests" : "Requêtes en attente", formatNumber(d.waiting)]
    ]);
    const h = data.health || {},
      fresh = h.freshness || {},
      jobs = h.jobs || {},
      ws = h.websocket || {},
      migrations = h.migrations || {};
    const blockedJobs = Number(jobs.notifications_stuck) + Number(jobs.passports_stuck);
    const migrationIssue = Number(migrations.missing) + Number(migrations.errors);
    const catalogTone = freshnessTone(fresh.catalog_synced_at, 6);
    const passportTone = freshnessTone(fresh.passport_synced_at, 24);
    const wsTone = Number(ws.errors) || Number(ws.authFailures) ? "warning" : "good";
    const apiTone = Number(h.api?.latencyMs) > 750 ? "warning" : "good";
    const problems = [
      blockedJobs > 0,
      migrationIssue > 0,
      catalogTone !== "good",
      passportTone !== "good",
      wsTone !== "good",
      apiTone !== "good"
    ].filter(Boolean).length;
    const overallTone = blockedJobs > 0 || migrationIssue > 0 ? "danger" : problems ? "warning" : "good";
    $("#overviewHealthSummary").innerHTML =
      `<div class="admin-health-summary__signal admin-health-summary__signal--${overallTone}"><span class="admin-health-summary__orb" aria-hidden="true"></span><div><small>${english ? "Current posture" : "État actuel"}</small><strong>${overallTone === "good" ? (english ? "All monitored services are healthy" : "Tous les services surveillés sont stables") : overallTone === "warning" ? (english ? "Attention recommended" : "Attention recommandée") : english ? "Action required" : "Action requise"}</strong><p>${problems ? (english ? `${formatNumber(problems)} signal(s) require review.` : `${formatNumber(problems)} signal(aux) demandent une vérification.`) : english ? "No delayed job, migration gap or freshness alert detected." : "Aucun job retardé, écart de migration ou alerte de fraîcheur détecté."}</p></div></div><div class="admin-health-summary__legend"><span><i class="is-good"></i>${english ? "Healthy" : "Stable"}</span><span><i class="is-warning"></i>${english ? "Review" : "À vérifier"}</span><span><i class="is-danger"></i>${english ? "Action" : "Action"}</span></div>`;
    const healthCards = [
      overviewHealthCard(
        english ? "Catalog sync" : "Synchronisation catalogue",
        freshnessLabel(fresh.catalog_synced_at),
        catalogTone,
        english ? "Latest source verification" : "Dernière vérification d’une source",
        "catalog",
        fresh.catalog_synced_at ? formatDate(fresh.catalog_synced_at) : ""
      ),
      overviewHealthCard(
        english ? "Admin API" : "API admin",
        `${formatNumber(h.api?.latencyMs)} ms`,
        apiTone,
        english ? "Measured on this request" : "Mesuré sur cette requête",
        null,
        d.checkedAt ? formatDate(d.checkedAt) : ""
      ),
      overviewHealthCard(
        "WebSocket",
        `${formatNumber(ws.connectedClients)} ${english ? "connected" : "connecté(s)"}`,
        wsTone,
        `${formatNumber(ws.errors)} ${english ? "error(s)" : "erreur(s)"} · ${formatNumber(ws.authFailures)} ${english ? "auth failure(s)" : "échec(s) d’auth."}`,
        "social",
        ws.lastErrorAt ? `${english ? "Latest error" : "Dernière erreur"} ${formatDate(ws.lastErrorAt)}` : ""
      ),
      overviewHealthCard(
        english ? "Blocked jobs" : "Jobs bloqués",
        formatNumber(blockedJobs),
        blockedJobs ? "danger" : "good",
        `${formatNumber(jobs.notifications_stuck)} ${english ? "notification(s)" : "notification(s)"} · ${formatNumber(jobs.passports_stuck)} ${english ? "passport(s)" : "passeport(s)"}`,
        "notifications",
        jobs.oldest_notification_at || jobs.oldest_passport_job_at
          ? `${english ? "Oldest queued" : "Plus ancien en attente"} ${formatDate(jobs.oldest_notification_at || jobs.oldest_passport_job_at)}`
          : ""
      ),
      overviewHealthCard(
        english ? "Schema migrations" : "Migrations schéma",
        Number(migrations.missing)
          ? `${formatNumber(migrations.missing)} ${english ? "missing" : "manquante(s)"}`
          : english
            ? "Up to date"
            : "À jour",
        migrationIssue ? "danger" : "good",
        `${formatNumber(migrations.applied)} ${english ? "applied" : "appliquée(s)"} · ${formatNumber(migrations.errors)} ${english ? "error(s)" : "erreur(s)"}`,
        "collections"
      ),
      overviewHealthCard(
        english ? "Passport freshness" : "Fraîcheur passeports",
        freshnessLabel(fresh.passport_synced_at),
        passportTone,
        english ? "Latest completed recalculation" : "Dernier recalcul terminé",
        "passports",
        fresh.passport_synced_at ? formatDate(fresh.passport_synced_at) : ""
      )
    ];
    $("#overviewHealthCards").innerHTML = healthCards.join("");
    $("#overviewHealthStamp").textContent = english
      ? `Checked ${formatDate(data.asOf)}`
      : `Relevé ${formatDate(data.asOf)}`;
    const badge = $("#adminReportsBadge");
    badge.hidden = !(Number(m.open) > 0);
    badge.textContent = Number(m.open) > 99 ? "99+" : formatNumber(m.open);
  }

  function freshnessLabel(value) {
    if (!value) return english ? "No signal" : "Aucun signal";
    const delta = Math.max(0, Date.now() - new Date(value).getTime());
    if (!Number.isFinite(delta)) return "—";
    const minutes = Math.round(delta / 60000);
    if (minutes < 1) return english ? "Just now" : "À l’instant";
    if (minutes < 60) return `${formatNumber(minutes)} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${formatNumber(hours)} h`;
    return `${formatNumber(Math.round(hours / 24))} ${english ? "days" : "j"}`;
  }
  function freshnessTone(value, thresholdHours) {
    if (!value || Number.isNaN(new Date(value).getTime())) return "warning";
    return Date.now() - new Date(value).getTime() > thresholdHours * 60 * 60 * 1000 ? "warning" : "good";
  }
  function overviewHealthCard(title, value, tone, detail, tab = null, stamp = "") {
    const content = `<span class="admin-health-card__dot" aria-hidden="true"></span><div><small>${escapeHtml(title)}</small><strong>${escapeHtml(value)}</strong><p>${escapeHtml(detail)}</p>${stamp ? `<time>${escapeHtml(stamp)}</time>` : ""}</div>${tab ? `<span class="admin-health-card__go" aria-hidden="true">›</span>` : ""}`;
    return tab
      ? `<button class="admin-health-card admin-health-card--${tone}" type="button" data-go-tab="${tab}">${content}</button>`
      : `<article class="admin-health-card admin-health-card--${tone}">${content}</article>`;
  }

  function healthRows(rows) {
    return rows.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  }

  Object.assign(window, { loadOverview, freshnessLabel, freshnessTone, overviewHealthCard, healthRows });
})();
