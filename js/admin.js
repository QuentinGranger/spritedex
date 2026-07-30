(() => {
  "use strict";

  const queryLanguage = new URLSearchParams(location.search).get("lang");
  const francophoneRegions = new Set(["BJ", "BI", "CM", "KM", "CI", "DJ", "GA", "GN", "GQ", "MG", "CF", "CD", "CG", "RW", "SN", "SC", "TD", "TG", "DZ", "BF", "ML", "MA", "MU", "MR", "NE", "TN", "BE", "FR", "LU", "MC", "CH", "AD", "CA", "HT", "LB", "VU"]);
  const locales = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
  const french = queryLanguage === "fr" || (queryLanguage !== "en" && locales.some((locale) => {
    const [language, region] = String(locale).replace(/_/g, "-").split("-");
    return language.toLowerCase() === "fr" || francophoneRegions.has(String(region || "").toUpperCase());
  }));
  const english = !french;
  const locale = english ? "en-US" : "fr-FR";
  const number = new Intl.NumberFormat(locale);
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const dateOnly = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const state = {
    tab: "overview",
    loading: new Set(),
    players: { page: 1 },
    catalog: { page: 1, selected: null },
    suspension: null,
    graph: {}
  };

  const copy = english ? {
    session: "Secure terminal session", logout: "End session", navigation: "NAVIGATION", advanced: "ADVANCED", refresh: "Refresh", search: "Search", create: "Create", repair: "Repair references", process: "Process queue",
    navOverview: "Overview", navPlayers: "Players & moderation", navCatalog: "Catalog", navEvents: "Events & news", navCollections: "Collections & integrity", navSocial: "Social & squads", navNotifications: "Notifications", navIntelligence: "Intelligence & Graph", navPassports: "Passports & badges", navPrivacy: "Privacy & audit",
    overviewActionTitle: "Operational priorities", overviewRealtime: "Live connections", overviewInfrastructure: "API & database", playersTitle: "Players", reportsTitle: "Open reports", catalogTitle: "Sprites & variants", catalogPick: "Select a sprite to review its data, variants, availability and change history.", eventsTitle: "Events", newsTitle: "News", repairTitle: "Sprite references", repairLead: "The repair never changes player statuses, priorities or notes.", migrationTitle: "Migration errors", integrityQueueTitle: "Recalculation queue", squadsTitle: "Squad health", deliveriesTitle: "Delivery channels", failedJobsTitle: "Jobs to retry", graphActivityTitle: "Sprite Graph flow", graphHealthTitle: "Pipeline", graphReadinessTitle: "Readiness", graphMetricsTitle: "Public metrics", graphMetricsLead: "Temporarily suspend a metric when in doubt. A reason is required.", graphFormulasTitle: "Formula versions", export: "Export aggregates", passportRecalcTitle: "Passport recalculation", passportRecalcLead: "Recalculations are queued and never notify players.", recalcStale: "Recalculate stale", recalcAll: "Queue all", passportVisibilityTitle: "Passport sharing", passportBadgesTitle: "Most unlocked badges", consentTitle: "Accepted versions", sharingTitle: "Active capabilities", auditTitle: "Administrative actions", rolesNote: "Current access: a protected terminal session. Named roles can be added without exposing player accounts.",
    playerSearch: "Search a username", catalogSearch: "Sprite or identifier", updated: "Updated {time}", loadFailed: "This backoffice section could not be loaded. Refresh to try again.", saveFailed: "The action could not be saved.", noData: "No data to display.", reasonPrompt: "Why are you performing this action?", reasonRequired: "A justification is required.", confirm: "Confirm", cancel: "Cancel", view: "View", edit: "Edit", publish: "Publish", archive: "Archive", retry: "Retry", suspend: "Suspend", unsuspend: "Reactivate", resolve: "Resolve", dismiss: "Dismiss", close: "Close access", open: "Open access", active: "Active", pending: "Pending", failed: "Failed", draft: "Draft", published: "Published", archived: "Archived", unavailable: "Unavailable", unknown: "Unknown", noReports: "No open reports.", noFailures: "No failed job.", noErrors: "No migration error.", noCatalog: "No sprite found.", noNews: "No news item.", noEvents: "No event.", queued: "Queued", updatedCollection: "collection changes", ago: "ago", openTab: "Open"
  } : {};

  const headings = english ? {
    overview: ["OPERATIONAL CONTROL", "Overview", "Sprite-Index health, alerts and next useful actions."],
    players: ["PLAYER SAFETY", "Players & moderation", "Find an account, handle reports and apply proportionate, recorded actions."],
    catalog: ["EDITORIAL REFERENCE", "Catalog", "Control sprites, variants, availability and the history of every catalog correction."],
    events: ["CALENDAR & EDITORIAL", "Events & news", "Keep event dates, confidence and public news accurate."],
    collections: ["DATA QUALITY", "Collections & integrity", "Spot safe-to-fix reference inconsistencies without reading players’ private notes."],
    social: ["COMMUNITY", "Social & squads", "Monitor social activity, squads and collaborative wishlists through operational summaries."],
    notifications: ["DELIVERY", "Notifications", "Track the queue, provider health, digests and recoverable failures."],
    intelligence: ["SPRITE GRAPH", "Intelligence & Graph", "Monitor ingestion, public metrics, scoring formulas and readiness."],
    passports: ["COLLECTOR EXPERIENCE", "Passports & badges", "Monitor derived summaries, badge unlocks and the controlled recalculation queue."],
    privacy: ["DATA GOVERNANCE", "Privacy & audit", "Review sharing capabilities, consent aggregates and every administrative mutation."]
  } : {
    overview: ["CONTRÔLE OPÉRATIONNEL", "Vue d’ensemble", "La santé de Sprite-Index, les alertes et les prochaines actions utiles."],
    players: ["SÛRETÉ JOUEUR", "Joueurs & modération", "Retrouvez un compte, traitez les signalements et appliquez des actions proportionnées et tracées."],
    catalog: ["RÉFÉRENTIEL ÉDITORIAL", "Catalogue", "Contrôlez sprites, variantes, disponibilités et l’historique de chaque correction."],
    events: ["CALENDRIER & ÉDITORIAL", "Événements & actualités", "Gardez les dates, la confiance des événements et les actualités publiques exactes."],
    collections: ["QUALITÉ DES DONNÉES", "Collections & cohérence", "Détectez les incohérences réparables sans lire les notes privées des joueurs."],
    social: ["COMMUNAUTÉ", "Social & squads", "Supervisez l’activité sociale, les squads et les souhaits collaboratifs via des résumés opérationnels."],
    notifications: ["DISTRIBUTION", "Notifications", "Suivez la file, la santé des fournisseurs, les digests et les échecs récupérables."],
    intelligence: ["SPRITE GRAPH", "Intelligence & Graph", "Surveillez l’ingestion, les métriques publiques, les formules et la qualité des signaux."],
    passports: ["EXPÉRIENCE COLLECTEUR", "Passeports & badges", "Contrôlez les résumés dérivés, les badges et la file de recalcul maîtrisée."],
    privacy: ["GOUVERNANCE DES DONNÉES", "Confidentialité & audit", "Consultez les capacités de partage, les consentements agrégés et toute mutation administrative."]
  };

  function tr(key, fallback = key) { return copy[key] || fallback; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function formatNumber(value) { return number.format(Number(value) || 0); }
  function formatDate(value, withTime = true) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : (withTime ? dateTime : dateOnly).format(date); }
  function formatPercent(value) { return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value) || 0)}%`; }
  function formatDuration(seconds) { const value = Math.max(0, Number(seconds) || 0); if (value < 60) return `${formatNumber(Math.round(value))} ${english ? "sec" : "s"}`; if (value < 3600) return `${formatNumber(Math.round(value / 60))} min`; return `${formatNumber(Math.round(value / 3600))} h`; }
  function label(value) { return String(value || tr("unknown")).replace(/_/g, " "); }
  function setAlert(message = "") { const node = $("#adminAlert"); node.hidden = !message; node.textContent = message; }
  function setNotice(message = "") { const node = $("#adminNotice"); node.hidden = !message; node.textContent = message; }
  function setLoading(key, loading) { if (loading) state.loading.add(key); else state.loading.delete(key); $("#adminRefresh").disabled = state.loading.size > 0; }
  function reason(message = tr("reasonPrompt")) { const value = window.prompt(message, ""); if (value == null) return null; const normalized = value.trim(); if (!normalized) { setAlert(tr("reasonRequired")); return null; } return normalized; }

  async function adminFetch(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json", ...(options.headers || {}) }, ...options });
    if (response.status === 401) { location.replace(`/admin/access${location.search}`); throw new Error("unauthorized"); }
    if (!response.ok) { const payload = await response.json().catch(() => ({})); const error = new Error(payload.error || "request_failed"); error.status = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  }

  async function request(path, options, { refresh = state.tab } = {}) {
    try { const result = await adminFetch(path, options); if (refresh) await loadTab(refresh, true); return result; }
    catch (error) { if (error.message !== "unauthorized") setAlert(error.message || tr("saveFailed")); return null; }
  }

  function kpi(labelText, value, hint = "", tone = "") { return `<article class="admin-kpi admin-kpi--compact ${tone ? `admin-kpi--${tone}` : ""}"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(value)}</strong><small class="admin-kpi__trend">${escapeHtml(hint)}</small></article>`; }
  function status(textValue, tone = "") { return `<span class="admin-state ${tone ? `admin-state--${tone}` : ""}">${escapeHtml(textValue)}</span>`; }
  function empty(message = tr("noData")) { return `<p class="admin-empty">${escapeHtml(message)}</p>`; }

  function applyStaticCopy() {
    if (!english) return;
    $$('[data-admin-copy]').forEach(node => { node.textContent = tr(node.dataset.adminCopy, node.textContent); });
    $$('[data-admin-placeholder]').forEach(node => { node.placeholder = tr(node.dataset.adminPlaceholder, node.placeholder); });
    document.documentElement.lang = "en";
    document.title = "SPRITE-INDEX — Backoffice";
  }

  function setTab(tab) {
    if (!headings[tab]) return;
    state.tab = tab;
    $$('[data-admin-tab]').forEach(node => node.classList.toggle("is-active", node.dataset.adminTab === tab));
    $$('[data-admin-panel]').forEach(node => { const active = node.dataset.adminPanel === tab; node.hidden = !active; node.classList.toggle("is-active", active); });
    const [eyebrow, title, lead] = headings[tab];
    $("#adminEyebrow").textContent = eyebrow; $("#adminTitle").textContent = title; $("#adminLead").textContent = lead;
    setAlert();
    loadTab(tab);
  }

  async function loadTab(tab, force = false) {
    if (state.loading.has(tab) && !force) return;
    setLoading(tab, true);
    try {
      const loaders = { overview: loadOverview, players: loadPlayers, catalog: loadCatalog, events: loadEvents, collections: loadCollections, social: loadSocial, notifications: loadNotifications, intelligence: loadIntelligence, passports: loadPassports, privacy: loadPrivacy };
      await (loaders[tab] || loadOverview)();
      $("#adminUpdated").textContent = tr("updated", "Actualisé {time}").replace("{time}", formatDate(new Date()));
    } catch (error) {
      if (error.message !== "unauthorized") setAlert(error.message || tr("loadFailed"));
    } finally { setLoading(tab, false); }
  }

  async function loadOverview() {
    const data = await adminFetch("/api/admin/overview");
    const u = data.users || {}, c = data.collection || {}, n = data.notifications || {}, m = data.moderation || {}, cat = data.catalog || {};
    $("#overviewKpis").innerHTML = [
      kpi(english ? "Active users" : "Joueurs actifs", formatNumber(u.active15m), `${formatNumber(u.registrations24h)} ${english ? "registrations · 24h" : "inscriptions · 24 h"}`),
      kpi(english ? "Collection changes" : "Collections modifiées", formatNumber(c.changes24h), english ? "last 24 hours" : "dernières 24 h"),
      kpi(english ? "Open reports" : "Signalements ouverts", formatNumber(m.open), english ? "requires review" : "à traiter", Number(m.open) ? "warning" : ""),
      kpi(english ? "Failed deliveries" : "Livraisons en échec", formatNumber(n.failed), english ? "notification queue" : "file de notifications", Number(n.failed) ? "danger" : ""),
      kpi(english ? "Catalog to review" : "Catalogue à vérifier", formatNumber(cat.needsReview), `${formatNumber(cat.variants)} ${english ? "variants" : "variantes"}`, Number(cat.needsReview) ? "warning" : "")
    ].join("");
    const actions = [
      { tab: "players", icon: "!", tone: Number(m.open) ? "warning" : "", title: english ? "Review open reports" : "Traiter les signalements", detail: `${formatNumber(m.open)} ${english ? "report(s) awaiting a decision" : "signalement(s) attendent une décision"}`, count: formatNumber(m.open) },
      { tab: "notifications", icon: "↻", tone: Number(n.failed) ? "danger" : "", title: english ? "Recover failed deliveries" : "Relancer les livraisons en échec", detail: `${formatNumber(n.failed)} ${english ? "job(s) can be retried" : "job(s) peuvent être relancés"}`, count: formatNumber(n.failed) },
      { tab: "collections", icon: "◇", tone: "", title: english ? "Check collection integrity" : "Vérifier la cohérence des collections", detail: english ? "Reference checks and safe corrective action." : "Contrôles de références et correction sûre.", count: tr("openTab", "Ouvrir") },
      { tab: "catalog", icon: "✦", tone: Number(cat.needsReview) ? "warning" : "", title: english ? "Review catalog confidence" : "Réviser la confiance du catalogue", detail: `${formatNumber(cat.needsReview)} ${english ? "variant(s) incomplete or unknown" : "variante(s) incomplète(s) ou inconnue(s)"}`, count: formatNumber(cat.needsReview) }
    ];
    $("#overviewActions").innerHTML = actions.map(item => `<button class="admin-action ${item.tone ? `admin-action--${item.tone}` : ""}" type="button" data-go-tab="${item.tab}"><span class="admin-action__icon">${item.icon}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span><span class="admin-action__cta">${escapeHtml(item.count)} ›</span></button>`).join("");
    const r = data.realtime || {}, d = data.database || {};
    $("#overviewRealtime").innerHTML = healthRows([[english ? "Connected players" : "Joueurs connectés", formatNumber(r.connectedUsers)], [english ? "Connected clients" : "Clients connectés", formatNumber(r.connectedClients)], [english ? "Pending squad invites" : "Invitations de squad en attente", formatNumber(data.social?.squad_invitations)]]);
    $("#overviewInfrastructure").innerHTML = healthRows([[english ? "Pool connections" : "Connexions pool", formatNumber(d.total)], [english ? "Idle connections" : "Connexions libres", formatNumber(d.idle)], [english ? "Waiting requests" : "Requêtes en attente", formatNumber(d.waiting)]]);
    const badge = $("#adminReportsBadge"); badge.hidden = !(Number(m.open) > 0); badge.textContent = Number(m.open) > 99 ? "99+" : formatNumber(m.open);
  }

  function healthRows(rows) { return rows.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join(""); }

  async function loadPlayers() {
    const q = $("#playerSearch").value.trim(), stateFilter = $("#playerState").value;
    const params = new URLSearchParams({ page: String(state.players.page), pageSize: "20", state: stateFilter }); if (q) params.set("q", q);
    const [data, reports] = await Promise.all([adminFetch(`/api/admin/players?${params}`), adminFetch("/api/admin/reports?status=open&pageSize=12")]);
    $("#playersCount").textContent = `${formatNumber(data.total)} ${english ? "account(s)" : "compte(s)"}`;
    $("#playersList").innerHTML = data.items.length ? data.items.map(player => {
      const suspended = player.suspendedUntil && new Date(player.suspendedUntil) > new Date();
      const reportTone = player.openReports ? "warning" : (suspended ? "danger" : "good");
      const stateLabel = suspended
        ? player.suspensionSource === "admin"
          ? (english ? "Admin suspension" : "Suspension admin")
          : (english ? "Voluntary pause" : "Pause volontaire")
        : player.openReports
          ? `${player.openReports} ${english ? "report(s)" : "signalement(s)"}`
          : (english ? "Active" : "Actif");
      return `<tr><td><strong>${escapeHtml(player.displayName || player.username)}</strong><small>@${escapeHtml(player.username)} · ${english ? "joined" : "inscrit"} ${formatDate(player.createdAt, false)}</small></td><td><strong>${formatPercent(player.collection.completionRate)}</strong><small>${formatNumber(player.collection.ownedVariants)} / ${formatNumber(player.collection.releasedVariants)} ${english ? "variants" : "variantes"}</small></td><td>${formatDate(player.lastActiveAt)}</td><td>${status(stateLabel, reportTone)}${suspended ? `<small>${english ? "until" : "jusqu’au"} ${formatDate(player.suspendedUntil)}</small>` : ""}</td><td><div class="admin-row-actions"><button class="admin-row-button ${suspended ? "" : "admin-row-button--danger"}" type="button" data-player-action="${suspended ? "unsuspend" : "suspend"}" data-player-id="${player.id}" data-player-name="${escapeHtml(player.username)}">${suspended ? tr("unsuspend", "Réactiver") : tr("suspend", "Suspendre")}</button></div></td></tr>`;
    }).join("") : `<tr><td colspan="5">${empty(english ? "No account found." : "Aucun compte trouvé.")}</td></tr>`;
    renderPagination("#playersPagination", data, "players");
    $("#reportsList").innerHTML = reports.items.length ? reports.items.map(report => `<article class="admin-report"><div class="admin-report__top"><strong>@${escapeHtml(report.reported.username)}</strong>${status(formatDate(report.createdAt, false), "warning")}</div><p>${escapeHtml(report.reason || "—")}</p><small>${report.reported.suspendedUntil && new Date(report.reported.suspendedUntil) > new Date() ? (english ? "Account currently suspended" : "Compte actuellement suspendu") : (english ? "Account active" : "Compte actif")}</small><div class="admin-report__actions"><button class="admin-row-button" type="button" data-report-action="resolved" data-report-id="${report.id}">${tr("resolve", "Résoudre")}</button><button class="admin-row-button admin-row-button--danger" type="button" data-report-action="dismissed" data-report-id="${report.id}">${tr("dismiss", "Classer")}</button></div></article>`).join("") : empty(tr("noReports", "Aucun signalement ouvert."));
  }

  function renderPagination(selector, data, kind) { const node = $(selector); if (!node) return; node.innerHTML = `<span>${english ? "Page" : "Page"} ${data.page} / ${Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button type="button" data-page-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>‹</button><button type="button" data-page-kind="${kind}" data-page="${data.page + 1}" ${data.hasMore ? "" : "disabled"}>›</button>`; }

  async function loadCatalog() {
    const q = $("#catalogSearch").value.trim(), filter = $("#catalogState").value;
    const params = new URLSearchParams({ page: String(state.catalog.page), pageSize: "20", status: filter }); if (q) params.set("q", q);
    const data = await adminFetch(`/api/admin/catalog?${params}`);
    $("#catalogCount").textContent = `${formatNumber(data.total)} ${english ? "sprite(s)" : "sprite(s)"}`;
    $("#catalogList").innerHTML = data.items.length ? data.items.map(sprite => `<button class="admin-catalog-card ${state.catalog.selected === sprite.id ? "is-selected" : ""}" type="button" data-catalog-id="${escapeHtml(sprite.id)}"><span class="admin-catalog-card__image">${sprite.image ? `<img src="${escapeHtml(sprite.image)}" alt="" />` : "✦"}</span><span><strong>${escapeHtml(sprite.name)}</strong><small>${escapeHtml(sprite.id)} · ${escapeHtml(label(sprite.rarity))}</small></span><span class="admin-catalog-card__meta">${sprite.variantsNeedingReview ? `${sprite.variantsNeedingReview} ${english ? "review" : "à vérifier"}` : `${sprite.variantCount} ${english ? "variants" : "variantes"}`}</span></button>`).join("") : empty(tr("noCatalog", "Aucun sprite trouvé."));
    renderPagination("#catalogPagination", data, "catalog");
    if (state.catalog.selected && !data.items.some(item => item.id === state.catalog.selected)) state.catalog.selected = null;
  }

  async function selectCatalog(spriteId) {
    state.catalog.selected = spriteId;
    $("#catalogList").querySelectorAll("[data-catalog-id]").forEach(node => node.classList.toggle("is-selected", node.dataset.catalogId === spriteId));
    $("#catalogEditor").innerHTML = empty(english ? "Loading sprite details…" : "Chargement des détails du sprite…");
    try { renderCatalogEditor(await adminFetch(`/api/admin/catalog/${encodeURIComponent(spriteId)}`)); } catch (error) { setAlert(error.message || tr("loadFailed")); }
  }

  function renderCatalogEditor(data) {
    const sprite = data.sprite, variants = data.variants || [], availability = data.availabilityPeriods || [], history = data.history || [];
    $("#catalogEditor").innerHTML = `<div class="admin-editor__header"><div><p class="admin-eyebrow">SPRITE</p><h2>${escapeHtml(sprite.name)}</h2><p class="admin-editor__id">${escapeHtml(sprite.id)}</p></div>${status(sprite.data_status || tr("unknown"), sprite.data_status === "complete" || sprite.data_status === "verified" ? "good" : "warning")}</div><form id="catalogEditForm"><div class="admin-editor__grid"><div class="admin-field"><label>${english ? "Name" : "Nom"}</label><input name="name" value="${escapeHtml(sprite.name)}" maxlength="100" required /></div><div class="admin-field"><label>${english ? "Rarity" : "Rareté"}</label><input name="rarity" value="${escapeHtml(sprite.rarity)}" maxlength="30" /></div><div class="admin-field"><label>${english ? "Data status" : "État des données"}</label><select name="dataStatus">${["complete", "verified", "incomplete", "unknown"].map(option => `<option value="${option}" ${sprite.data_status === option ? "selected" : ""}>${escapeHtml(label(option))}</option>`).join("")}</select></div><div class="admin-field"><label>${english ? "Released" : "Publié"}</label><select name="isReleased"><option value="true" ${sprite.is_released !== false ? "selected" : ""}>${english ? "Yes" : "Oui"}</option><option value="false" ${sprite.is_released === false ? "selected" : ""}>${english ? "No" : "Non"}</option></select></div><div class="admin-field admin-field--wide"><label>${english ? "Image URL" : "URL de l’image"}</label><input name="image" value="${escapeHtml(sprite.image || "")}" maxlength="2000" /></div><div class="admin-field admin-field--wide"><label>${english ? "Reason" : "Justification"}</label><input class="admin-editor__reason" name="reason" placeholder="${english ? "Required for traceability" : "Requise pour la traçabilité"}" maxlength="1000" required /></div></div><div class="admin-editor__footer"><button class="admin-button" type="submit">${english ? "Save changes" : "Enregistrer"}</button></div></form><section class="admin-editor__section"><h3>${english ? "Variants" : "Variantes"} (${variants.length})</h3><div class="admin-variant-list">${variants.length ? variants.map(variant => `<div class="admin-variant"><span><strong>${escapeHtml(variant.name)}</strong><small>${escapeHtml(variant.variant_type)} · ${escapeHtml(label(variant.data_status || "unknown"))}</small></span><button class="admin-row-button" type="button" data-edit-variant="${escapeHtml(variant.id)}" data-variant-name="${escapeHtml(variant.name)}">${tr("edit", "Modifier")}</button></div>`).join("") : empty()}</div></section><section class="admin-editor__section"><h3>${english ? "Availability" : "Disponibilités"} (${availability.length})</h3><div class="admin-status-list">${availability.slice(0, 4).map(period => `<div class="admin-status-row"><span>${escapeHtml(label(period.status))} · ${formatDate(period.end_date, false)}</span><strong>${escapeHtml(label(period.confidence))}</strong></div>`).join("") || empty()}</div><div class="admin-editor__footer"><button class="admin-button admin-button--quiet" type="button" id="addAvailability" data-sprite-id="${escapeHtml(sprite.id)}">${english ? "Add availability" : "Ajouter une disponibilité"}</button></div></section><section class="admin-editor__section"><h3>${english ? "Recent change history" : "Historique récent"}</h3><div class="admin-status-list">${history.slice(0, 5).map(item => `<div class="admin-status-row"><span>${escapeHtml(item.field)} · ${escapeHtml(item.reason || "—")}</span><strong>${formatDate(item.changed_at)}</strong></div>`).join("") || empty()}</div></section>`;
  }

  async function loadEvents() {
    const [events, news] = await Promise.all([adminFetch("/api/admin/events?pageSize=20"), adminFetch("/api/admin/news?pageSize=12")]);
    $("#eventsList").innerHTML = events.items.length ? events.items.map(item => `<tr><td><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.type || "—")} · ${formatNumber(item.availability_count)} ${english ? "availability periods" : "périodes"}</small></td><td>${formatDate(item.end_date, false)}</td><td>${status(item.data_status || tr("unknown"), item.data_status === "complete" ? "good" : "warning")}</td><td><button class="admin-row-button" type="button" data-edit-event="${escapeHtml(item.id)}" data-event-name="${escapeHtml(item.name || item.id)}" data-event-end="${escapeHtml(item.end_date || "")}" data-event-status="${escapeHtml(item.data_status || "incomplete")}">${tr("edit", "Modifier")}</button></td></tr>`).join("") : `<tr><td colspan="4">${empty(tr("noEvents", "Aucun événement."))}</td></tr>`;
    $("#newsList").innerHTML = news.items.length ? news.items.map(item => `<article class="admin-news"><div class="admin-news__top"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)} · ${formatDate(item.news_date, false)}</small></span>${status(label(item.status), item.status === "published" ? "good" : item.status === "draft" ? "warning" : "")}</div><p>${escapeHtml(item.description || "")}</p><div class="admin-news__actions"><button class="admin-row-button" type="button" data-news-action="${item.status === "published" ? "archive" : "publish"}" data-news-id="${item.id}">${item.status === "published" ? tr("archive", "Archiver") : tr("publish", "Publier")}</button></div></article>`).join("") : empty(tr("noNews", "Aucune actualité."));
  }

  async function loadCollections() {
    const data = await adminFetch("/api/admin/collections/integrity"), c = data.checks || {};
    $("#integrityKpis").innerHTML = [kpi(english ? "Orphaned entries" : "Entrées orphelines", formatNumber(c.orphanedEntries), english ? "unknown variant reference" : "référence de variante inconnue", Number(c.orphanedEntries) ? "danger" : ""), kpi(english ? "Mismatched references" : "Références incohérentes", formatNumber(c.mismatchedSpriteReferences), english ? "safe repair available" : "correction sûre disponible", Number(c.mismatchedSpriteReferences) ? "warning" : ""), kpi(english ? "Invalid statuses" : "Statuts invalides", formatNumber(c.invalidStatuses), english ? "requires manual review" : "révision manuelle requise", Number(c.invalidStatuses) ? "danger" : ""), kpi(english ? "Migration errors" : "Erreurs de migration", formatNumber(c.migrationErrors), english ? "historical imports" : "imports historiques", Number(c.migrationErrors) ? "warning" : "")].join("");
    $("#migrationErrors").innerHTML = data.latestMigrationErrors.length ? data.latestMigrationErrors.map(error => `<article class="admin-error"><strong>${escapeHtml(error.table_name)} · ${escapeHtml(error.original_key)}</strong><small>${escapeHtml(error.error || "—")} · ${formatDate(error.created_at)}</small></article>`).join("") : empty(tr("noErrors", "Aucune erreur de migration."));
    $("#integrityPassportQueue").innerHTML = data.passportQueue.length ? data.passportQueue.map(row => `<div class="admin-status-row"><span>${escapeHtml(label(row.status))}</span><strong>${formatNumber(row.count)}</strong></div>`).join("") : empty();
  }

  async function loadSocial() {
    const data = await adminFetch("/api/admin/social?pageSize=30"), s = data.summary || {};
    $("#socialKpis").innerHTML = [kpi(english ? "Friendships" : "Amitiés", formatNumber(s.friendships), `${formatNumber(s.pending_friendships)} ${english ? "pending" : "en attente"}`), kpi(english ? "Squad invites" : "Invitations de squad", formatNumber(s.pending_squad_invitations), english ? "pending" : "en attente", Number(s.pending_squad_invitations) ? "warning" : ""), kpi(english ? "Collaborative wishes" : "Souhaits collaboratifs", formatNumber(s.wanted_items), english ? "to find" : "à trouver"), kpi(english ? "Blocks" : "Blocages", formatNumber(s.blocks), english ? "user safety controls" : "contrôles de sûreté")].join("");
    const squads = data.squads || { items: [] };
    $("#squadsList").innerHTML = squads.items.length ? squads.items.map(squad => `<tr><td><strong>${escapeHtml(squad.name)}</strong><small>${escapeHtml(squad.code)} · ${escapeHtml(label(squad.visibility))}</small></td><td>${formatNumber(squad.member_count)}</td><td>${formatNumber(squad.wanted_count)}</td><td>${formatDate(squad.last_activity_at)}</td><td><button class="admin-row-button ${squad.join_open ? "admin-row-button--danger" : ""}" type="button" data-squad-toggle="${squad.id}" data-squad-open="${squad.join_open ? "true" : "false"}">${squad.join_open ? tr("close", "Fermer l’accès") : tr("open", "Ouvrir l’accès")}</button></td></tr>`).join("") : `<tr><td colspan="5">${empty()}</td></tr>`;
    $("#socialActivity").innerHTML = (data.activity24h || []).map(row => `<span class="admin-activity-chip">${escapeHtml(label(row.type))} · ${formatNumber(row.count)}</span>`).join("") || empty();
  }

  async function loadNotifications() {
    const data = await adminFetch("/api/admin/notifications/operations");
    const queue = new Map((data.queue || []).map(row => [row.status, row.count])), push = data.push || {}, digests = data.digests || {};
    $("#notificationKpis").innerHTML = [kpi(english ? "Queued deliveries" : "Livraisons en attente", formatNumber((Number(queue.get("pending")) || 0) + (Number(queue.get("processing")) || 0)), english ? "push and email" : "push et e-mail"), kpi(english ? "Failed deliveries" : "Livraisons en échec", formatNumber(queue.get("failed")), english ? "recoverable jobs" : "jobs récupérables", Number(queue.get("failed")) ? "danger" : ""), kpi(english ? "Active push devices" : "Appareils push actifs", formatNumber(push.active), `${formatNumber(push.invalid)} ${english ? "invalid" : "invalides"}`), kpi(english ? "Digest queue" : "File des digests", formatNumber(digests.count), digests.next_flush_at ? `${english ? "next" : "prochain"} ${formatDate(digests.next_flush_at)}` : "—")].join("");
    $("#notificationDeliveries").innerHTML = (data.deliveries || []).length ? data.deliveries.map(row => `<div class="admin-status-row"><span>${escapeHtml(label(row.channel))} · ${escapeHtml(label(row.status))}</span><strong>${formatNumber(row.count)}</strong></div>`).join("") : empty();
    $("#failedNotificationJobs").innerHTML = (data.failedJobs || []).length ? data.failedJobs.map(job => `<article class="admin-failure"><div class="admin-failure__top"><code>#${job.id} · ${escapeHtml((job.channels || []).join(", "))}</code><small>${formatNumber(job.attempts)} / ${formatNumber(job.max_attempts)}</small></div><p>${escapeHtml(job.last_error || "—")}</p><button class="admin-row-button" type="button" data-retry-job="${job.id}">${tr("retry", "Relancer")}</button></article>`).join("") : empty(tr("noFailures", "Aucun job en échec."));
  }

  async function loadIntelligence() {
    const [board, catalog, readiness, formulas] = await Promise.all([adminFetch("/api/admin/sprite-graph/control-board"), adminFetch("/api/admin/sprite-graph/metrics-catalog?surface=public"), adminFetch("/api/admin/sprite-graph/v1-readiness"), adminFetch("/api/admin/sprite-graph/formulas")]);
    state.graph = { board, catalog, readiness, formulas };
    const technical = board.technical || {};
    $("#graphKpis").innerHTML = [kpi(english ? "Events · 24h" : "Événements · 24 h", formatNumber(board.eventsLast24h), english ? "recorded graph events" : "événements Graph enregistrés"), kpi(english ? "Ingestion" : "Ingestion", `${formatNumber(technical.eventsPerMinute)}/min`, english ? "events per minute" : "événements par minute"), kpi(english ? "Worker lag" : "Retard du worker", formatDuration(technical.workerLagSeconds), english ? "oldest pending item" : "plus ancien élément en attente"), kpi(english ? "Rejected · 24h" : "Rejets · 24 h", formatNumber(board.rejectedEventsLast24h), english ? "errors and failed messages" : "erreurs et messages en échec", Number(board.rejectedEventsLast24h) ? "warning" : "")].join("");
    const consolidation = board.lastConsolidation?.publishedAt; $("#adminConsolidation").textContent = consolidation ? `${english ? "Last consolidation:" : "Dernière consolidation :"} ${formatDate(consolidation)}` : (english ? "No consolidation published yet" : "Aucune consolidation publiée");
    $("#adminEvents").innerHTML = (board.eventsByType || []).length ? board.eventsByType.map(event => `<div class="admin-event"><code>${escapeHtml(event.eventType)}</code><strong>${formatNumber(event.count)}</strong></div>`).join("") : empty();
    $("#adminHealth").innerHTML = healthRows([[english ? "Pending outbox" : "Outbox en attente", formatNumber(technical.pendingOutbox)], [english ? "Failed outbox" : "Outbox en échec", formatNumber(technical.failedOutbox)], [english ? "Graph rows" : "Lignes Graph", formatNumber(technical.table?.rowCount)], [english ? "Today's samples" : "Échantillons du jour", formatNumber(board.sampleSizes?.rows)]]);
    const isReady = readiness.ready === true; const readinessNode = $("#adminReadinessStatus"); readinessNode.textContent = isReady ? (english ? "Ready" : "Prêt") : (english ? "Needs attention" : "À surveiller"); readinessNode.className = `admin-readiness ${isReady ? "admin-readiness--ready" : "admin-readiness--blocked"}`;
    $("#adminReadiness").innerHTML = (readiness.criteria || []).map(item => `<li class="${item.ok ? "is-ok" : ""}">${escapeHtml(String(item.id || "").replace(/_/g, " "))}</li>`).join("");
    const flags = new Map((board.metricFlags || []).map(flag => [flag.key, flag]));
    $("#adminMetrics").innerHTML = (catalog.metrics || []).map(metric => { const flag = flags.get(metric.id), disabled = flag?.disabled === true; return `<article class="admin-metric"><div class="admin-metric__copy"><strong>${escapeHtml(metric.name || metric.id)}</strong><small>${escapeHtml(disabled ? (english ? "Public display suspended" : "Affichage public suspendu") : (english ? "Public display active" : "Affichage public actif"))}</small>${disabled && flag.reason ? `<small class="admin-metric__reason">${escapeHtml(flag.reason)}</small>` : ""}</div><label><input type="checkbox" data-metric-flag="${escapeHtml(metric.id)}" ${disabled ? "checked" : ""}><span></span></label></article>`; }).join("") || empty();
    const entries = Object.entries(formulas.current || {}); $("#adminFormulas").innerHTML = entries.length ? entries.map(([key, version]) => `<div class="admin-formula"><span>${escapeHtml(key)}</span><code>${escapeHtml(version)}</code></div>`).join("") : empty();
  }

  async function loadPassports() {
    const data = await adminFetch("/api/admin/passports"), s = data.summaries || {};
    const queue = new Map((data.queue || []).map(item => [item.status, item.count]));
    $("#passportKpis").innerHTML = [kpi(english ? "Passport summaries" : "Résumés passeport", formatNumber(s.total), s.last_recalculated ? `${english ? "last" : "dernier"} ${formatDate(s.last_recalculated)}` : "—"), kpi(english ? "Stale summaries" : "Résumés obsolètes", formatNumber(s.stale), english ? "older than 24 hours" : "plus de 24 heures", Number(s.stale) ? "warning" : ""), kpi(english ? "Queued recalculations" : "Recalculs en attente", formatNumber((Number(queue.get("pending")) || 0) + (Number(queue.get("processing")) || 0)), english ? "background worker" : "worker de fond"), kpi(english ? "Failed recalculations" : "Recalculs en échec", formatNumber(queue.get("failed")), english ? "requires review" : "à surveiller", Number(queue.get("failed")) ? "danger" : "")].join("");
    $("#passportVisibility").innerHTML = (data.visibility || []).map(item => `<div class="admin-status-row"><span>${escapeHtml(label(item.passport_visibility))}</span><strong>${formatNumber(item.count)}</strong></div>`).join("") || empty();
    $("#passportAchievements").innerHTML = (data.topAchievements || []).map(item => `<div class="admin-status-row"><span>${escapeHtml(item.achievement_id)}</span><strong>${formatNumber(item.unlocks)}</strong></div>`).join("") || empty();
  }

  async function loadPrivacy() {
    const data = await adminFetch("/api/admin/privacy"), p = data.privacy || {}, s = data.sharing || {};
    $("#privacyKpis").innerHTML = [kpi(english ? "Deletion requests" : "Demandes de suppression", formatNumber(p.deletion_requests), `${formatNumber(p.ready_for_purge)} ${english ? "ready for purge" : "prêtes à purger"}`, Number(p.deletion_requests) ? "warning" : ""), kpi(english ? "Public profiles" : "Profils publics", formatNumber(p.public_profiles), english ? "user-controlled visibility" : "visibilité choisie par les joueurs"), kpi(english ? "Public collections" : "Collections publiques", formatNumber(p.public_collections), english ? "user-controlled visibility" : "visibilité choisie par les joueurs"), kpi(english ? "Admin audit entries" : "Entrées du journal", formatNumber((data.audit || []).length), english ? "last 40 actions" : "40 dernières actions")].join("");
    $("#privacyConsent").innerHTML = (data.consentVersions || []).map(item => `<div class="admin-status-row"><span>${escapeHtml(item.version)}</span><strong>${formatNumber(item.count)}</strong></div>`).join("") || empty();
    $("#privacySharing").innerHTML = [[english ? "Passport links" : "Liens passeport", s.passport_links], [english ? "Comparison links" : "Liens de comparaison", s.compare_links], [english ? "Friend invitation links" : "Liens d’invitation", s.friend_invite_links]].map(([name, value]) => `<div class="admin-status-row"><span>${escapeHtml(name)}</span><strong>${formatNumber(value)}</strong></div>`).join("");
    $("#auditList").innerHTML = (data.audit || []).length ? data.audit.map(item => `<tr><td><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.target_type)}</small></td><td>${escapeHtml(item.target_id || "—")}</td><td>${escapeHtml(item.justification || "—")}</td><td>${formatDate(item.created_at)}</td></tr>`).join("") : `<tr><td colspan="4">${empty()}</td></tr>`;
  }

  function renderSuspensionHistory(items) {
    const node = $("#playerSuspensionHistory");
    node.innerHTML = items.length
      ? `<div class="admin-dialog__history-list">${items.map(item => {
        const suspended = item.action === "player.suspended";
        return `<article class="admin-dialog__history-item"><strong>${suspended ? (english ? "Suspended" : "Suspension appliquée") : (english ? "Reactivated" : "Compte réactivé")}</strong><time>${formatDate(item.created_at)}</time><p>${escapeHtml(item.justification || "—")}</p></article>`;
      }).join("")}</div>`
      : empty(english ? "No previous administrative decision." : "Aucune décision administrative antérieure.");
  }

  async function handlePlayerAction(button) {
    const action = button.dataset.playerAction;
    const player = button.dataset.playerName;
    state.suspension = { id: button.dataset.playerId, action, player };
    const suspending = action === "suspend";
    $("#playerSuspensionTitle").textContent = suspending
      ? (english ? "Suspend account" : "Suspendre le compte")
      : (english ? "Reactivate account" : "Réactiver le compte");
    $("#playerSuspensionSummary").textContent = suspending
      ? (english ? `Define the duration and document the decision for @${player}.` : `Définissez la durée et documentez la décision concernant @${player}.`)
      : (english ? `End the administrative suspension for @${player}.` : `Levez la suspension administrative de @${player}.`);
    $("#playerSuspensionImpact").textContent = suspending
      ? (english ? "Active sessions will be revoked immediately and new logins blocked until the suspension ends." : "Les sessions actives seront immédiatement révoquées et toute nouvelle connexion sera bloquée jusqu’à la fin de la suspension.")
      : (english ? "The player will be able to sign in and use protected features again immediately." : "Le joueur pourra immédiatement se reconnecter et utiliser les fonctionnalités protégées.");
    $("#playerSuspensionDurationField").hidden = !suspending;
    $("#playerSuspensionCustomField").hidden = true;
    $("#playerSuspensionDuration").value = "24";
    $("#playerSuspensionUntil").value = "";
    $("#playerSuspensionReason").value = "";
    $("#playerSuspensionReasonLabel").textContent = suspending
      ? (english ? "Mandatory suspension reason" : "Motif obligatoire de la suspension")
      : (english ? "Mandatory reactivation reason" : "Motif obligatoire de la réactivation");
    $("#playerSuspensionSubmit").textContent = suspending
      ? (english ? "Confirm suspension" : "Confirmer la suspension")
      : (english ? "Reactivate account" : "Réactiver le compte");
    $("#playerSuspensionSubmit").classList.toggle("admin-button--danger", suspending);
    $("#playerSuspensionError").hidden = true;
    $("#playerSuspensionHistory").innerHTML = empty(english ? "Loading history…" : "Chargement de l’historique…");
    const dialog = $("#playerSuspensionDialog");
    dialog.showModal();
    $("#playerSuspensionReason").focus();
    try {
      const data = await adminFetch(`/api/admin/players/${encodeURIComponent(state.suspension.id)}/suspension-history`);
      if (state.suspension?.id === button.dataset.playerId) renderSuspensionHistory(data.history || []);
    } catch (error) {
      $("#playerSuspensionHistory").innerHTML = empty(error.message || tr("loadFailed"));
    }
  }

  function closePlayerSuspensionDialog() {
    const dialog = $("#playerSuspensionDialog");
    if (dialog.open) dialog.close();
    state.suspension = null;
  }

  async function submitPlayerSuspension(event) {
    event.preventDefault();
    if (!state.suspension) return;
    const operation = { ...state.suspension };
    const reasonValue = $("#playerSuspensionReason").value.trim();
    const errorNode = $("#playerSuspensionError");
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      $("#playerSuspensionReason").focus();
      return;
    }
    const suspended = operation.action === "suspend";
    let until = null;
    if (suspended) {
      const duration = $("#playerSuspensionDuration").value;
      if (duration === "custom") {
        const custom = new Date($("#playerSuspensionUntil").value);
        if (Number.isNaN(custom.getTime()) || custom <= new Date()) {
          errorNode.textContent = english ? "Choose a future end date." : "Choisissez une date de fin future.";
          errorNode.hidden = false;
          $("#playerSuspensionUntil").focus();
          return;
        }
        until = custom.toISOString();
      } else {
        until = new Date(Date.now() + Number(duration) * 60 * 60 * 1000).toISOString();
      }
    }
    const submit = $("#playerSuspensionSubmit");
    submit.disabled = true;
    errorNode.hidden = true;
    try {
      const result = await adminFetch(`/api/admin/players/${encodeURIComponent(operation.id)}/suspension`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended, until, reason: reasonValue })
      });
      const player = operation.player;
      if (state.suspension?.id === operation.id) closePlayerSuspensionDialog();
      setAlert();
      setNotice(suspended
        ? (english ? `@${player} suspended. ${formatNumber(result.revokedSessions)} session(s) revoked.` : `@${player} suspendu. ${formatNumber(result.revokedSessions)} session(s) révoquée(s).`)
        : (english ? `@${player} reactivated.` : `@${player} réactivé.`));
      await loadTab("players", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  async function handleReportAction(button) { const resolution = reason(`${button.dataset.reportAction === "resolved" ? (english ? "Resolution note:" : "Note de résolution :") : (english ? "Reason for dismissal:" : "Motif de classement :")}`); if (!resolution) return; await request(`/api/admin/reports/${button.dataset.reportId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: button.dataset.reportAction, resolution }) }, { refresh: "players" }); }
  async function saveCatalogForm(form) { const data = Object.fromEntries(new FormData(form)); data.isReleased = data.isReleased === "true"; const id = state.catalog.selected; if (!id) return; await request(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: data, reason: data.reason }) }, { refresh: "catalog" }); await selectCatalog(id); }
  async function editVariant(button) { const name = window.prompt(english ? "Variant name:" : "Nom de la variante :", button.dataset.variantName || ""); if (name == null) return; const why = reason(); if (!why) return; await request(`/api/admin/catalog/variants/${encodeURIComponent(button.dataset.editVariant)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: { name }, reason: why }) }, { refresh: null }); if (state.catalog.selected) await selectCatalog(state.catalog.selected); }
  async function addAvailability(spriteId) { const statusValue = window.prompt(english ? "Availability (available, upcoming, ended, not_observed, unknown):" : "Disponibilité (available, upcoming, ended, not_observed, unknown) :", "available"); if (statusValue == null) return; const endDate = window.prompt(english ? "End date (ISO, optional):" : "Date de fin (ISO, facultative) :", ""); if (endDate == null) return; const why = reason(); if (!why) return; await request(`/api/admin/catalog/${encodeURIComponent(spriteId)}/availability`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: statusValue, endDate, confidence: "medium", reason: why }) }, { refresh: null }); await selectCatalog(spriteId); }
  async function editEvent(button) { const endDate = window.prompt(english ? "End date (ISO, blank to clear):" : "Date de fin (ISO, vide pour effacer) :", button.dataset.eventEnd || ""); if (endDate == null) return; const statusValue = window.prompt(english ? "Data status:" : "État des données :", button.dataset.eventStatus || "incomplete"); if (statusValue == null) return; const why = reason(); if (!why) return; await request(`/api/admin/events/${encodeURIComponent(button.dataset.editEvent)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endDate, dataStatus: statusValue, reason: why }) }, { refresh: "events" }); }
  async function createEvent() { const id = window.prompt(english ? "Event identifier (letters, numbers, _ or -):" : "Identifiant de l’événement (lettres, chiffres, _ ou -) :", ""); if (id == null) return; const name = window.prompt(english ? "Event name:" : "Nom de l’événement :", ""); if (name == null) return; const endDate = window.prompt(english ? "End date (ISO, optional):" : "Date de fin (ISO, facultative) :", ""); if (endDate == null) return; const why = reason(); if (!why) return; await request("/api/admin/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name, endDate, reason: why }) }, { refresh: "events" }); }
  async function createNews() { const title = window.prompt(english ? "Headline:" : "Titre :", ""); if (title == null) return; const description = window.prompt(english ? "Short description:" : "Description courte :", ""); if (description == null) return; const why = reason(); if (!why) return; await request("/api/admin/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description, status: "draft", reason: why }) }, { refresh: "events" }); }
  async function updateNewsStatus(button) { const next = button.dataset.newsAction === "publish" ? "published" : "archived"; const why = reason(`${next === "published" ? (english ? "Why publish this item?" : "Pourquoi publier cette actualité ?") : (english ? "Why archive this item?" : "Pourquoi archiver cette actualité ?")}`); if (!why) return; await request(`/api/admin/news/${button.dataset.newsId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next, reason: why }) }, { refresh: "events" }); }
  async function repairReferences() { const why = reason(english ? "Why run the safe sprite-reference repair?" : "Pourquoi exécuter la correction sûre des références Sprite ?"); if (!why) return; await request("/api/admin/collections/integrity/repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "backfill-sprite-references", reason: why }) }, { refresh: "collections" }); }
  async function toggleSquad(button) { const open = button.dataset.squadOpen !== "true"; const why = reason(open ? (english ? "Why reopen public joining?" : "Pourquoi rouvrir les inscriptions ?") : (english ? "Why close public joining?" : "Pourquoi fermer les inscriptions ?")); if (!why) return; await request(`/api/admin/social/squads/${button.dataset.squadToggle}/access`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ joinOpen: open, reason: why }) }, { refresh: "social" }); }
  async function retryNotification(button) { const why = reason(english ? "Why retry this delivery?" : "Pourquoi relancer cette livraison ?"); if (!why) return; await request(`/api/admin/notifications/queue/${button.dataset.retryJob}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) }, { refresh: "notifications" }); }
  async function processNotifications() { const why = reason(english ? "Why process the queue now?" : "Pourquoi traiter la file maintenant ?"); if (!why) return; await request("/api/admin/notifications/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) }, { refresh: "notifications" }); }
  async function queuePassports(scope) { const why = reason(scope === "all" ? (english ? "Why queue all passports (maximum 500)?" : "Pourquoi planifier tous les passeports (maximum 500) ?") : (english ? "Why queue stale passports?" : "Pourquoi planifier les passeports obsolètes ?")); if (!why) return; await request("/api/admin/passports/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, reason: why }) }, { refresh: "passports" }); }
  async function setMetricFlag(input) { const disabled = input.checked, key = input.dataset.metricFlag; let why = null; if (disabled) { why = reason(english ? `Why suspend ${key}?` : `Pourquoi suspendre ${key} ?`); if (!why) { input.checked = false; return; } } try { await adminFetch("/api/admin/sprite-graph/flags", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ metricKey: key, disabled, reason: why }) }); await loadTab("intelligence", true); } catch (error) { input.checked = !disabled; setAlert(error.message || tr("saveFailed")); } }
  async function exportAggregates() { try { const payload = await adminFetch("/api/admin/sprite-graph/export/aggregates?limit=2000"); const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = english ? "sprite-index-aggregates.json" : "sprite-index-agregats.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); } catch (error) { setAlert(error.message || tr("saveFailed")); } }

  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-admin-tab]"); if (tab) { setTab(tab.dataset.adminTab); return; }
    const go = event.target.closest("[data-go-tab]"); if (go) { setTab(go.dataset.goTab); return; }
    const player = event.target.closest("[data-player-action]"); if (player) { handlePlayerAction(player); return; }
    const report = event.target.closest("[data-report-action]"); if (report) { handleReportAction(report); return; }
    const catalog = event.target.closest("[data-catalog-id]"); if (catalog) { selectCatalog(catalog.dataset.catalogId); return; }
    const variant = event.target.closest("[data-edit-variant]"); if (variant) { editVariant(variant); return; }
    const availability = event.target.closest("#addAvailability"); if (availability) { addAvailability(availability.dataset.spriteId); return; }
    const eventEdit = event.target.closest("[data-edit-event]"); if (eventEdit) { editEvent(eventEdit); return; }
    const news = event.target.closest("[data-news-action]"); if (news) { updateNewsStatus(news); return; }
    const squad = event.target.closest("[data-squad-toggle]"); if (squad) { toggleSquad(squad); return; }
    const retry = event.target.closest("[data-retry-job]"); if (retry) { retryNotification(retry); return; }
    const scope = event.target.closest("[data-passport-scope]"); if (scope) { queuePassports(scope.dataset.passportScope); return; }
    const page = event.target.closest("[data-page-kind]"); if (page && !page.disabled) { state[page.dataset.pageKind].page = Number(page.dataset.page); loadTab(page.dataset.pageKind, true); return; }
    if (event.target.closest("#createEvent")) { createEvent(); return; } if (event.target.closest("#createNews")) { createNews(); return; } if (event.target.closest("#repairSpriteReferences")) { repairReferences(); return; } if (event.target.closest("#processNotifications")) { processNotifications(); return; } if (event.target.closest("#adminExport")) { exportAggregates(); return; }
  });
  document.addEventListener("change", event => { const metric = event.target.closest("[data-metric-flag]"); if (metric) setMetricFlag(metric); });
  document.addEventListener("submit", event => {
    if (event.target.id === "catalogEditForm") { event.preventDefault(); saveCatalogForm(event.target); }
    if (event.target.id === "playerSuspensionForm") submitPlayerSuspension(event);
  });
  $("#adminRefresh").addEventListener("click", () => loadTab(state.tab, true));
  $("#playerSearchButton").addEventListener("click", () => { state.players.page = 1; loadTab("players", true); });
  $("#catalogSearchButton").addEventListener("click", () => { state.catalog.page = 1; state.catalog.selected = null; $("#catalogEditor").innerHTML = empty(tr("catalogPick", "Sélectionnez un sprite.")); loadTab("catalog", true); });
  $("#playerSearch").addEventListener("keydown", event => { if (event.key === "Enter") { state.players.page = 1; loadTab("players", true); } });
  $("#catalogSearch").addEventListener("keydown", event => { if (event.key === "Enter") { state.catalog.page = 1; loadTab("catalog", true); } });
  $("#playerSuspensionClose").addEventListener("click", closePlayerSuspensionDialog);
  $("#playerSuspensionCancel").addEventListener("click", closePlayerSuspensionDialog);
  $("#playerSuspensionDialog").addEventListener("cancel", event => { event.preventDefault(); closePlayerSuspensionDialog(); });
  $("#playerSuspensionDuration").addEventListener("change", event => {
    const custom = event.target.value === "custom";
    $("#playerSuspensionCustomField").hidden = !custom;
    if (custom && !$("#playerSuspensionUntil").value) {
      const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      $("#playerSuspensionUntil").value = date.toISOString().slice(0, 16);
    }
  });
  $("#adminLogout").addEventListener("click", async () => { try { await adminFetch("/api/admin/logout", { method: "POST" }); } catch (_) {} location.replace(`/admin/access${location.search}`); });

  applyStaticCopy();
  loadTab("overview");
  setInterval(() => { if (document.visibilityState === "visible") loadTab(state.tab, true); }, 30_000);
})();
