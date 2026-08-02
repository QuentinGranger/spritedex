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
    players: { page: 1, selected: null, focusReportId: null, reportPriority: "all" },
    reportDecision: null,
    catalog: { page: 1, selected: null, bulkIds: new Set(), bulkItems: new Map(), visibleItems: [] },
    events: { newsStatus: "all", bulkIds: new Set(), bulkItems: new Map(), visibleItems: [] },
    notifications: { bulkIds: new Set(), bulkItems: new Map(), visibleItems: [] },
    collections: { bulkIds: new Set(), bulkItems: new Map(), visibleItems: [] },
    social: { page: 1, selected: null, q: "", join: "all" },
    privacy: { deletionStatus: "all" },
    audit: { page: 1, pageSize: 25, q: "", action: "", targetType: "", from: "", to: "", range: "all", data: null, searchTimer: null },
    suspension: null,
    graph: {},
    session: null,
    reasonResolver: null,
    adminOperator: null,
    bulkAction: null,
    bulkData: { failedNotifications: 0, repairableReferences: 0 },
    universalSearch: { timer: null, request: 0, results: [], groups: [], activeGroup: "all", activeIndex: -1, loading: false }
  };

  const copy = english ? {
    session: "Secure terminal session", logout: "End session", navigation: "NAVIGATION", advanced: "ADVANCED", refresh: "Refresh", search: "Search", create: "Create", repair: "Repair references", process: "Process queue",
    navOverview: "Overview", navPlayers: "Players & moderation", navCatalog: "Catalog", navEvents: "Events & news", navCollections: "Collections & integrity", navSocial: "Social & squads", navNotifications: "Notifications", navIntelligence: "Intelligence & Graph", navPassports: "Passports & badges", navPrivacy: "Privacy & audit",
    overviewActionTitle: "Operational priorities", overviewRealtime: "Live connections", overviewInfrastructure: "API & database", playersTitle: "Players", reportsTitle: "Open reports", playerPick: "Select a player or report to open the moderation dossier.", catalogTitle: "Sprites & variants", catalogPick: "Select a sprite to review its data, variants, availability and change history.", eventsTitle: "Events", newsTitle: "News", repairTitle: "Sprite references", repairLead: "The repair never changes player statuses, priorities or notes.", migrationTitle: "Migration errors", integrityQueueTitle: "Recalculation queue", squadsTitle: "Squad health", squadPick: "Select a squad to review members, invitations, wishes and activity.", pendingInvitesTitle: "Pending invitations", pendingFriendsTitle: "Friend requests", recentBlocksTitle: "Recent blocks", squadSearch: "Squad name or code", deliveriesTitle: "Delivery channels", failedJobsTitle: "Jobs to retry", graphActivityTitle: "Sprite Graph flow", graphHealthTitle: "Pipeline", graphReadinessTitle: "Readiness", graphMetricsTitle: "Public metrics", graphMetricsLead: "Temporarily suspend a metric when in doubt. A reason is required.", graphFormulasTitle: "Formula versions", export: "Export aggregates", passportRecalcTitle: "Passport recalculation", passportRecalcLead: "Recalculations are queued and never notify players.", recalcStale: "Recalculate stale", recalcAll: "Queue all", passportVisibilityTitle: "Passport sharing", passportBadgesTitle: "Most unlocked badges", consentTitle: "Accepted versions", sharingTitle: "Active capabilities", sessionsTitle: "Active sessions", sessionsLead: "Revoke a concurrent session or every other one if a link leaked.", revokeOthers: "Revoke others", deletionQueueTitle: "Deletion queue", deletionQueueLead: "Soft-deleted accounts remain recoverable until retention ends, then can be purged permanently.", exportData: "Export data", purgeReady: "Purge ready accounts", revokeShareLinks: "Revoke active links", privacyExportSearch: "Export: username or #id", revokeSession: "Revoke", thisSession: "This session", auditTitle: "Administrative actions", rolesNote: "Current access: a protected terminal session. Named roles can be added without exposing player accounts.",
    playerSearch: "Search a username", catalogSearch: "Sprite or identifier", updated: "Updated {time}", loadFailed: "This backoffice section could not be loaded. Refresh to try again.", saveFailed: "The action could not be saved.", noData: "No data to display.", reasonPrompt: "Why are you performing this action?", reasonRequired: "A justification is required.", reasonDialogEyebrow: "AUDITED ACTION", reasonDialogTitle: "Confirm action", reasonDialogLabel: "Justification", confirm: "Confirm", cancel: "Cancel", view: "View", edit: "Edit", publish: "Publish", archive: "Archive", retry: "Retry", suspend: "Suspend", unsuspend: "Reactivate", resolve: "Resolve", dismiss: "Dismiss", close: "Close access", open: "Open access", active: "Active", pending: "Pending", failed: "Failed", draft: "Draft", published: "Published", archived: "Archived", unavailable: "Unavailable", unknown: "Unknown", noReports: "No open reports.", noFailures: "No failed job.", noErrors: "No migration error.", noCatalog: "No sprite found.", noNews: "No news item.", noEvents: "No event.", queued: "Queued", updatedCollection: "collection changes", ago: "ago", openTab: "Open", sessionExpires: "expires in {time}", sessionExpired: "Session expired"
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
    privacy: ["DATA GOVERNANCE", "Privacy & audit", "Export personal data, manage the deletion queue, restore soft-deletes and revoke share links."]
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
    privacy: ["GOUVERNANCE DES DONNÉES", "Confidentialité & audit", "Exportez des données, gérez la file de purge, restaurez un soft-delete et révoquez les liens de partage."]
  };

  function tr(key, fallback = key) { return copy[key] || fallback; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function adminImageUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https:\/\//i.test(raw)) return raw;
    if (/^(?:Sprite|images|assets)\/[a-zA-Z0-9._/-]+$/.test(raw)) return `/${raw}`;
    if (/^\/(?:Sprite|images|assets)\/[a-zA-Z0-9._/-]+$/.test(raw)) return raw;
    return "";
  }
  function adminCatalogImage(value) { const src = adminImageUrl(value); return src ? `<img class="admin-sprite-image" src="${escapeHtml(src)}" alt="" loading="lazy" />` : "✦"; }
  function formatNumber(value) { return number.format(Number(value) || 0); }
  function formatDate(value, withTime = true) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : (withTime ? dateTime : dateOnly).format(date); }
  function formatPercent(value) { return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value) || 0)}%`; }
  function formatDuration(seconds) { const value = Math.max(0, Number(seconds) || 0); if (value < 60) return `${formatNumber(Math.round(value))} ${english ? "sec" : "s"}`; if (value < 3600) return `${formatNumber(Math.round(value / 60))} min`; return `${formatNumber(Math.round(value / 3600))} h`; }

  function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  function label(value) { return String(value || tr("unknown")).replace(/_/g, " "); }
  function reportPriorityTone(priority) { return priority === "urgent" ? "danger" : priority === "high" ? "warning" : priority === "low" ? "good" : ""; }
  function reportPriorityLabel(priority) {
    const labels = english
      ? { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" }
      : { urgent: "Urgente", high: "Haute", normal: "Normale", low: "Basse" };
    return labels[priority] || labels.normal;
  }
  function reportContextMarkup(context) {
    if (!context || typeof context !== "object" || !Object.keys(context).length) return "";
    const names = english
      ? { source: "Source", page: "Page", spriteId: "Sprite", variantId: "Variant", eventId: "Event" }
      : { source: "Source", page: "Page", spriteId: "Sprite", variantId: "Variante", eventId: "Événement" };
    const entries = Object.entries(context).filter(([key, value]) => names[key] && value != null && String(value).trim());
    if (!entries.length) return "";
    return `<div class="admin-report__context-chips">${entries.map(([key, value]) => `<span><b>${escapeHtml(names[key])}</b>${escapeHtml(String(value))}</span>`).join("")}</div>`;
  }
  function sessionRemainingMs() {
    if (!state.session?.expiresAt) return 0;
    const soft = new Date(state.session.expiresAt).getTime();
    const hard = state.session.maxExpiresAt ? new Date(state.session.maxExpiresAt).getTime() : soft;
    return Math.max(0, Math.min(soft, hard) - Date.now());
  }
  function can(capability) {
    const caps = state.session?.capabilities;
    if (!Array.isArray(caps)) return false;
    return caps.includes(capability);
  }
  function needsStepUp() {
    return !!(state.session?.stepUpRequired || state.session?.mfaConfigured);
  }
  function readStepUpCode(inputId) {
    if (!needsStepUp()) return null;
    const node = $(inputId);
    return node ? String(node.value || "").replace(/\s+/g, "") : "";
  }
  function stepUpHeaders(code) {
    if (!needsStepUp()) return {};
    const digits = String(code || "").replace(/\s+/g, "");
    return digits ? { "X-Admin-Mfa": digits } : {};
  }
  function assertStepUp(code, errorNode) {
    if (!needsStepUp()) return true;
    if (!/^\d{6}$/.test(String(code || ""))) {
      if (errorNode) {
        errorNode.hidden = false;
        errorNode.textContent = english
          ? "Enter the current 6-digit MFA code to confirm this action."
          : "Saisissez le code MFA à 6 chiffres pour confirmer cette action.";
      }
      return false;
    }
    return true;
  }
  function firstAllowedTab() {
    const tabs = state.session?.tabs || {};
    const order = ["overview", "players", "catalog", "events", "collections", "social", "notifications", "intelligence", "passports", "privacy"];
    return order.find((tab) => tabs[tab] === true && headings[tab]) || order.find((tab) => headings[tab]) || "overview";
  }
  function applyAuthz() {
    const tabs = state.session?.tabs || {};
    $$("[data-admin-tab]").forEach((node) => {
      const allowed = tabs[node.dataset.adminTab] === true;
      node.hidden = !allowed;
      if (!allowed) node.classList.remove("is-active");
    });
    $$("[data-requires-cap]").forEach((node) => {
      const needed = node.dataset.requiresCap;
      const allowed = !needed || can(needed);
      node.hidden = !allowed;
      if ("disabled" in node) node.disabled = !allowed;
    });
    $$("[data-stepup-field]").forEach((node) => {
      node.hidden = !needsStepUp();
      if (!needsStepUp()) {
        const input = node.querySelector("input, textarea");
        if (input) input.value = "";
      }
    });
    const rolesNote = $("#adminRolesNote");
    if (rolesNote && state.session) {
      const role = state.session.role || "owner";
      const mfa = state.session.mfaConfigured
        ? (english ? "MFA on · step-up for privacy writes" : "MFA actif · step-up sur privacy")
        : (english ? "MFA off" : "MFA off");
      const identity = state.session.authMode === "legacy_global"
        ? (english ? "global transition secret still active" : "secret global de transition encore actif")
        : (english ? `named account @${state.session.operatorLabel || "admin"}` : `compte nominatif @${state.session.operatorLabel || "admin"}`);
      rolesNote.textContent = english
        ? `Role ${role} · ${identity} · server-enforced capabilities · ${mfa}.`
        : `Rôle ${role} · ${identity} · capacités imposées serveur · ${mfa}.`;
    }
    const capsNode = $("#adminCapabilityList");
    if (capsNode && state.session) {
      const caps = state.session.capabilities || [];
      capsNode.innerHTML = caps.length
        ? caps.map((cap) => `<span class="admin-cap">${escapeHtml(cap)}</span>`).join("")
        : `<span class="admin-cap admin-cap--empty">${escapeHtml(english ? "No capabilities" : "Aucune capacité")}</span>`;
    }
    if (state.session?.tabs && state.session.tabs[state.tab] !== true) {
      setTab(firstAllowedTab());
    }
  }
  function renderSessionBadge() {
    const badge = $("#adminSessionBadge");
    const labelNode = $("#adminSessionLabel");
    if (!badge || !labelNode || !state.session) return;
    const remaining = sessionRemainingMs();
    const role = state.session.role ? ` · ${state.session.role}` : "";
    const actor = `${state.session.actor || tr("session", "Session terminal sécurisée")}${role}`;
    const timeLabel = remaining <= 0
      ? tr("sessionExpired", "Session expirée")
      : (english ? `expires in ${formatDuration(remaining / 1000)}` : `expire dans ${formatDuration(remaining / 1000)}`);
    labelNode.textContent = `${actor} · ${timeLabel}`;
    badge.title = state.session.maxExpiresAt
      ? `${actor} · max ${formatDate(state.session.maxExpiresAt)}`
      : actor;
    badge.classList.toggle("is-warning", remaining > 0 && remaining < 15 * 60 * 1000);
    badge.classList.toggle("is-expired", remaining <= 0);
    if (remaining <= 0) location.replace(`/admin/access${location.search}`);
  }
  async function bootstrapSession() {
    try {
      state.session = await adminFetch("/api/admin/session");
      renderSessionBadge();
      applyAuthz();
    } catch (_) {
      location.replace(`/admin/access${location.search}`);
    }
  }
  function setAlert(message = "") { const node = $("#adminAlert"); node.hidden = !message; node.textContent = message; }
  function setNotice(message = "") { const node = $("#adminNotice"); node.hidden = !message; node.textContent = message; }
  function setLoading(key, loading) { if (loading) state.loading.add(key); else state.loading.delete(key); $("#adminRefresh").disabled = state.loading.size > 0; }
  function closeReasonDialog(value = null) {
    const dialog = $("#adminReasonDialog");
    const resolve = state.reasonResolver;
    state.reasonResolver = null;
    if (dialog?.open) dialog.close();
    if (resolve) resolve(value);
  }
  function requestReason(message = tr("reasonPrompt")) {
    const dialog = $("#adminReasonDialog");
    const input = $("#adminReasonInput");
    const error = $("#adminReasonError");
    if (!dialog || !input) { setAlert(tr("reasonRequired")); return Promise.resolve(null); }
    if (state.reasonResolver) closeReasonDialog(null);
    input.value = "";
    error.hidden = true;
    $("#adminReasonMessage").textContent = message;
    dialog.showModal();
    requestAnimationFrame(() => input.focus());
    return new Promise((resolve) => { state.reasonResolver = resolve; });
  }

  async function adminFetch(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json", ...(options.headers || {}) }, ...options });
    if (response.status === 401) { location.replace(`/admin/access${location.search}`); throw new Error("unauthorized"); }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || "request_failed");
      error.status = response.status;
      error.payload = payload;
      if (response.status === 403) {
        error.message = english
          ? (payload.error || "Insufficient privilege for this action")
          : (payload.error || "Privilège insuffisant pour cette action");
      }
      throw error;
    }
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
    const newsFilterLabels = { all: "All news", draft: "Drafts", published: "Published", archived: "Archived" };
    $$("#newsStatusFilter option").forEach(option => {
      if (newsFilterLabels[option.value]) option.textContent = newsFilterLabels[option.value];
    });
    const newsStatusLabels = { draft: "Draft", published: "Published", archived: "Archived" };
    $$("#newsEditorStatus option").forEach(option => {
      if (newsStatusLabels[option.value]) option.textContent = newsStatusLabels[option.value];
    });
    const squadJoinLabels = { all: "All access states", open: "Open joining", closed: "Closed joining" };
    $$("#squadJoinFilter option").forEach(option => {
      if (squadJoinLabels[option.value]) option.textContent = squadJoinLabels[option.value];
    });
    const deletionFilterLabels = { all: "Entire queue", ready: "Ready to purge", pending: "In retention" };
    $$("#privacyDeletionFilter option").forEach(option => {
      if (deletionFilterLabels[option.value]) option.textContent = deletionFilterLabels[option.value];
    });
    document.documentElement.lang = "en";
    document.title = "SPRITE-INDEX — Backoffice";
  }

  function setTab(tab) {
    if (!headings[tab]) return;
    if (state.session?.tabs && state.session.tabs[tab] !== true) {
      setAlert(english ? "This section is outside your role." : "Cette section n’est pas dans votre rôle.");
      return;
    }
    state.tab = tab;
    $$('[data-admin-tab]').forEach(node => {
      const active = node.dataset.adminTab === tab;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-current", active ? "page" : "false");
    });
    $$('[data-admin-panel]').forEach(node => { const active = node.dataset.adminPanel === tab; node.hidden = !active; node.classList.toggle("is-active", active); });
    const [eyebrow, title, lead] = headings[tab];
    $("#adminEyebrow").textContent = eyebrow; $("#adminTitle").textContent = title; $("#adminLead").textContent = lead;
    setAlert();
    loadTab(tab);
  }

  function openUniversalSearch() {
    const dialog = $("#adminSearchDialog");
    if (!dialog?.open) dialog?.showModal();
    state.universalSearch = { ...state.universalSearch, request: state.universalSearch.request + 1, results: [], groups: [], activeGroup: "all", activeIndex: -1, loading: false };
    $("#adminSearchInput").value = "";
    $("#adminSearchInput").setAttribute("aria-expanded", "false");
    $("#adminSearchHint").textContent = english ? "Type at least 2 characters. Results only include areas you can access." : "Saisissez au moins 2 caractères. Les résultats respectent vos droits d’accès.";
    renderUniversalQuickActions();
    $("#adminSearchState").classList.remove("is-loading");
    requestAnimationFrame(() => $("#adminSearchInput").focus());
  }

  function closeUniversalSearch() {
    clearTimeout(state.universalSearch.timer);
    state.universalSearch.request += 1;
    state.universalSearch.loading = false;
    if ($("#adminSearchDialog")?.open) $("#adminSearchDialog").close();
  }

  function universalQuickActions() {
    const commands = [
      { id: "players", title: english ? "Find or moderate a player" : "Rechercher ou modérer un joueur", subtitle: english ? "Open player operations" : "Ouvrir les opérations joueurs", icon: "♙", capability: "players.read" },
      { id: "catalog", title: english ? "Review the catalog" : "Réviser le catalogue", subtitle: english ? "Sprites, variants and editorial workflow" : "Sprites, variantes et workflow éditorial", icon: "✦", capability: "catalog.read" },
      { id: "event-create", title: english ? "Create an event" : "Créer un événement", subtitle: english ? "Open the audited event form" : "Ouvrir le formulaire d’événement audité", icon: "＋", capability: "events.write" },
      { id: "notifications", title: english ? "Review notification deliveries" : "Vérifier les livraisons de notifications", subtitle: english ? "Failed jobs and retry queue" : "Jobs en échec et file de relance", icon: "◉", capability: "notifications.read" },
      { id: "collections", title: english ? "Check collection consistency" : "Vérifier la cohérence des collections", subtitle: english ? "Inspect safe repair candidates" : "Inspecter les corrections sûres", icon: "▦", capability: "collections.read" },
      { id: "audit", title: english ? "Open the audit trail" : "Ouvrir le journal d’audit", subtitle: english ? "Review recent administrative actions" : "Consulter les dernières actions administratives", icon: "◌", capability: "audit.read" }
    ];
    return commands.filter((command) => can(command.capability)).map((command) => ({ ...command, action: "command" }));
  }

  function renderUniversalQuickActions() {
    const items = universalQuickActions();
    state.universalSearch.groups = items.length ? [{ key: "commands", label: english ? "Quick actions" : "Actions rapides", items }] : [];
    state.universalSearch.activeGroup = "all";
    state.universalSearch.activeIndex = items.length ? 0 : -1;
    state.universalSearch.query = "";
    $("#adminSearchHint").textContent = english ? "Start from a safe shortcut, or search across the backoffice." : "Démarrez par un raccourci sûr, ou recherchez dans tout le backoffice.";
    renderUniversalSearch();
  }

  function highlightUniversalText(value, query = state.universalSearch.query) {
    const escaped = escapeHtml(value || "");
    const term = escapeHtml((query || "").trim());
    if (!term) return escaped;
    const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(new RegExp(`(${pattern})`, "ig"), "<mark>$1</mark>");
  }

  function renderUniversalSearch(groups = state.universalSearch.groups) {
    const filter = state.universalSearch.activeGroup;
    const visibleGroups = filter === "all" ? groups : groups.filter((group) => group.key === filter);
    const filters = $("#adminSearchFilters");
    filters.hidden = !groups.length;
    filters.innerHTML = groups.length ? `<button class="${filter === "all" ? "is-active" : ""}" type="button" data-universal-filter="all">${english ? "All" : "Tout"}<b>${formatNumber(groups.reduce((count, group) => count + group.items.length, 0))}</b></button>${groups.map((group) => `<button type="button" class="${filter === group.key ? "is-active" : ""}" data-universal-filter="${escapeHtml(group.key)}">${escapeHtml(group.label)}<b>${formatNumber(group.items.length)}</b></button>`).join("")}` : "";
    filters.querySelector(`[data-universal-filter="${CSS.escape(filter)}"]`)?.classList.add("is-active");
    state.universalSearch.results = visibleGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.key })));
    if (state.universalSearch.activeIndex >= state.universalSearch.results.length) state.universalSearch.activeIndex = state.universalSearch.results.length - 1;
    const icons = { player: "♙", catalog: "✦", event: "◷", squad: "⌘", invitation: "✉", friendInvite: "↗", notification: "◉", audit: "◌", command: "⌁" };
    $("#adminSearchInput").setAttribute("aria-expanded", state.universalSearch.results.length ? "true" : "false");
    $("#adminSearchResults").innerHTML = visibleGroups.length ? visibleGroups.map((group) => `<section class="admin-search-group"><h3>${escapeHtml(group.label)}<span>${formatNumber(group.items.length)}</span></h3>${group.items.map((item) => {
      const index = state.universalSearch.results.findIndex((result) => result.group === group.key && result.id === item.id && result.action === item.action);
      return `<button class="admin-search-result ${index === state.universalSearch.activeIndex ? "is-active" : ""}" type="button" role="option" aria-selected="${index === state.universalSearch.activeIndex}" data-universal-index="${index}" data-universal-result="${escapeHtml(item.action)}" data-universal-id="${escapeHtml(item.id)}" data-universal-parent="${escapeHtml(item.parentId || "")}"><span class="admin-search-result__icon" aria-hidden="true">${item.icon || icons[item.action] || "◈"}</span><span><strong>${highlightUniversalText(item.title)}</strong><small>${highlightUniversalText(item.subtitle || "")}</small></span><b aria-hidden="true">›</b></button>`;
    }).join("")}</section>`).join("") : empty(english ? "No accessible result." : "Aucun résultat accessible.");
  }

  function moveUniversalSelection(step) {
    const results = state.universalSearch.results;
    if (!results.length) return;
    state.universalSearch.activeIndex = (state.universalSearch.activeIndex + step + results.length) % results.length;
    $$(".admin-search-result").forEach((node, index) => { const active = index === state.universalSearch.activeIndex; node.classList.toggle("is-active", active); node.setAttribute("aria-selected", String(active)); if (active) node.scrollIntoView({ block: "nearest" }); });
  }

  async function searchUniversally(query) {
    const request = ++state.universalSearch.request;
    const clean = query.trim();
    if (clean.length < 2) { renderUniversalQuickActions(); return; }
    state.universalSearch.loading = true;
    $("#adminSearchState").classList.add("is-loading");
    $("#adminSearchHint").textContent = english ? "Searching across the backoffice…" : "Recherche dans le backoffice…";
    try {
      const data = await adminFetch(`/api/admin/search?q=${encodeURIComponent(clean)}`);
      if (request !== state.universalSearch.request) return;
      state.universalSearch.loading = false;
      $("#adminSearchState").classList.remove("is-loading");
      state.universalSearch.groups = data.groups || [];
      state.universalSearch.query = clean;
      state.universalSearch.activeGroup = "all";
      state.universalSearch.activeIndex = state.universalSearch.groups.length ? 0 : -1;
      $("#adminSearchHint").textContent = data.groups?.length ? (english ? "Use ↑ ↓ to browse, Enter to open." : "Utilisez ↑ ↓ pour parcourir, Entrée pour ouvrir.") : (english ? "No accessible result." : "Aucun résultat accessible.");
      renderUniversalSearch();
    } catch (error) {
      if (request !== state.universalSearch.request) return;
      state.universalSearch.loading = false;
      $("#adminSearchState").classList.remove("is-loading");
      $("#adminSearchHint").textContent = error.message || tr("loadFailed");
      $("#adminSearchResults").innerHTML = "";
    }
  }

  async function openUniversalResult(button) {
    const action = button.dataset.universalResult, id = button.dataset.universalId, parent = button.dataset.universalParent;
    closeUniversalSearch();
    try {
      if (action === "player") { setTab("players"); await selectPlayer(id); }
      else if (action === "catalog") { setTab("catalog"); await selectCatalog(parent || id); }
      else if (action === "event") { setTab("events"); if (can("events.write")) await editEvent({ dataset: { editEvent: id } }); }
      else if (action === "squad") { setTab("social"); await selectSquad(id); }
      else if (action === "invitation") { setTab("social"); await selectSquad(parent); }
      else if (action === "friendInvite") { setTab("social"); }
      else if (action === "notification") { setTab("notifications"); requestAnimationFrame(() => document.querySelector(`[data-retry-job="${CSS.escape(id)}"]`)?.closest("article")?.scrollIntoView({ block: "center", behavior: "smooth" })); }
      else if (action === "audit") { state.audit = { ...state.audit, page: 1, q: button.querySelector("strong")?.textContent || "" }; setTab("privacy"); }
      else if (action === "command") {
        if (id === "event-create") { setTab("events"); openEventEditor("create"); }
        else setTab(id);
      }
    } catch (error) { setAlert(error.message || tr("loadFailed")); }
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
    $("#overviewInfrastructure").innerHTML = healthRows([[english ? "Database latency" : "Latence base", `${formatNumber(d.latencyMs)} ms`], [english ? "Pool connections" : "Connexions pool", formatNumber(d.total)], [english ? "Waiting requests" : "Requêtes en attente", formatNumber(d.waiting)]]);
    const h = data.health || {}, fresh = h.freshness || {}, jobs = h.jobs || {}, ws = h.websocket || {}, migrations = h.migrations || {};
    const blockedJobs = Number(jobs.notifications_stuck) + Number(jobs.passports_stuck);
    const migrationIssue = Number(migrations.missing) + Number(migrations.errors);
    const catalogTone = freshnessTone(fresh.catalog_synced_at, 6);
    const passportTone = freshnessTone(fresh.passport_synced_at, 24);
    const wsTone = Number(ws.errors) || Number(ws.authFailures) ? "warning" : "good";
    const apiTone = Number(h.api?.latencyMs) > 750 ? "warning" : "good";
    const problems = [blockedJobs > 0, migrationIssue > 0, catalogTone !== "good", passportTone !== "good", wsTone !== "good", apiTone !== "good"].filter(Boolean).length;
    const overallTone = blockedJobs > 0 || migrationIssue > 0 ? "danger" : problems ? "warning" : "good";
    $("#overviewHealthSummary").innerHTML = `<div class="admin-health-summary__signal admin-health-summary__signal--${overallTone}"><span class="admin-health-summary__orb" aria-hidden="true"></span><div><small>${english ? "Current posture" : "État actuel"}</small><strong>${overallTone === "good" ? (english ? "All monitored services are healthy" : "Tous les services surveillés sont stables") : overallTone === "warning" ? (english ? "Attention recommended" : "Attention recommandée") : (english ? "Action required" : "Action requise")}</strong><p>${problems ? (english ? `${formatNumber(problems)} signal(s) require review.` : `${formatNumber(problems)} signal(aux) demandent une vérification.`) : (english ? "No delayed job, migration gap or freshness alert detected." : "Aucun job retardé, écart de migration ou alerte de fraîcheur détecté.")}</p></div></div><div class="admin-health-summary__legend"><span><i class="is-good"></i>${english ? "Healthy" : "Stable"}</span><span><i class="is-warning"></i>${english ? "Review" : "À vérifier"}</span><span><i class="is-danger"></i>${english ? "Action" : "Action"}</span></div>`;
    const healthCards = [
      overviewHealthCard(english ? "Catalog sync" : "Synchronisation catalogue", freshnessLabel(fresh.catalog_synced_at), catalogTone, english ? "Latest source verification" : "Dernière vérification d’une source", "catalog", fresh.catalog_synced_at ? formatDate(fresh.catalog_synced_at) : ""),
      overviewHealthCard(english ? "Admin API" : "API admin", `${formatNumber(h.api?.latencyMs)} ms`, apiTone, english ? "Measured on this request" : "Mesuré sur cette requête", null, d.checkedAt ? formatDate(d.checkedAt) : ""),
      overviewHealthCard("WebSocket", `${formatNumber(ws.connectedClients)} ${english ? "connected" : "connecté(s)"}`, wsTone, `${formatNumber(ws.errors)} ${english ? "error(s)" : "erreur(s)"} · ${formatNumber(ws.authFailures)} ${english ? "auth failure(s)" : "échec(s) d’auth."}`, "social", ws.lastErrorAt ? `${english ? "Latest error" : "Dernière erreur"} ${formatDate(ws.lastErrorAt)}` : ""),
      overviewHealthCard(english ? "Blocked jobs" : "Jobs bloqués", formatNumber(blockedJobs), blockedJobs ? "danger" : "good", `${formatNumber(jobs.notifications_stuck)} ${english ? "notification(s)" : "notification(s)"} · ${formatNumber(jobs.passports_stuck)} ${english ? "passport(s)" : "passeport(s)"}`, "notifications", jobs.oldest_notification_at || jobs.oldest_passport_job_at ? `${english ? "Oldest queued" : "Plus ancien en attente"} ${formatDate(jobs.oldest_notification_at || jobs.oldest_passport_job_at)}` : ""),
      overviewHealthCard(english ? "Schema migrations" : "Migrations schéma", Number(migrations.missing) ? `${formatNumber(migrations.missing)} ${english ? "missing" : "manquante(s)"}` : (english ? "Up to date" : "À jour"), migrationIssue ? "danger" : "good", `${formatNumber(migrations.applied)} ${english ? "applied" : "appliquée(s)"} · ${formatNumber(migrations.errors)} ${english ? "error(s)" : "erreur(s)"}`, "collections"),
      overviewHealthCard(english ? "Passport freshness" : "Fraîcheur passeports", freshnessLabel(fresh.passport_synced_at), passportTone, english ? "Latest completed recalculation" : "Dernier recalcul terminé", "passports", fresh.passport_synced_at ? formatDate(fresh.passport_synced_at) : "")
    ];
    $("#overviewHealthCards").innerHTML = healthCards.join("");
    $("#overviewHealthStamp").textContent = english ? `Checked ${formatDate(data.asOf)}` : `Relevé ${formatDate(data.asOf)}`;
    const badge = $("#adminReportsBadge"); badge.hidden = !(Number(m.open) > 0); badge.textContent = Number(m.open) > 99 ? "99+" : formatNumber(m.open);
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
    return tab ? `<button class="admin-health-card admin-health-card--${tone}" type="button" data-go-tab="${tab}">${content}</button>` : `<article class="admin-health-card admin-health-card--${tone}">${content}</article>`;
  }

  function healthRows(rows) { return rows.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join(""); }

  async function loadPlayers() {
    const q = $("#playerSearch").value.trim(), stateFilter = $("#playerState").value;
    const params = new URLSearchParams({ page: String(state.players.page), pageSize: "20", state: stateFilter }); if (q) params.set("q", q);
    const reportParams = new URLSearchParams({ status: "open", pageSize: "12" });
    if (state.players.reportPriority !== "all") reportParams.set("priority", state.players.reportPriority);
    const [data, reports] = await Promise.all([adminFetch(`/api/admin/players?${params}`), adminFetch(`/api/admin/reports?${reportParams}`)]);
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
      const selected = String(state.players.selected) === String(player.id) ? " is-selected" : "";
      return `<tr class="admin-player-row${selected}" data-player-id="${player.id}"><td><strong>${escapeHtml(player.displayName || player.username)}</strong><small>@${escapeHtml(player.username)} · ${english ? "joined" : "inscrit"} ${formatDate(player.createdAt, false)}</small></td><td><strong>${formatPercent(player.collection.completionRate)}</strong><small>${formatNumber(player.collection.ownedVariants)} / ${formatNumber(player.collection.releasedVariants)} ${english ? "variants" : "variantes"}</small></td><td>${formatDate(player.lastActiveAt)}</td><td>${status(stateLabel, reportTone)}${suspended ? `<small>${english ? "until" : "jusqu’au"} ${formatDate(player.suspendedUntil)}</small>` : ""}</td><td><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-player="${player.id}">${english ? "Open" : "Ouvrir"}</button>${can("players.moderate") ? `<button class="admin-row-button ${suspended ? "" : "admin-row-button--danger"}" type="button" data-player-action="${suspended ? "unsuspend" : "suspend"}" data-player-id="${player.id}" data-player-name="${escapeHtml(player.username)}">${suspended ? tr("unsuspend", "Réactiver") : tr("suspend", "Suspendre")}</button>` : ""}</div></td></tr>`;
    }).join("") : `<tr><td colspan="5">${empty(english ? "No account found." : "Aucun compte trouvé.")}</td></tr>`;
    renderPagination("#playersPagination", data, "players");
    const counts = reports.facets?.priorityCounts || {};
    $("#reportTriage").innerHTML = ["urgent", "high", "normal", "low"].map(priority => `<button class="admin-triage-chip ${state.players.reportPriority === priority ? "is-active" : ""} admin-triage-chip--${priority}" type="button" data-report-priority-filter="${priority}" aria-pressed="${state.players.reportPriority === priority}"><span>${escapeHtml(reportPriorityLabel(priority))}</span><strong>${formatNumber(counts[priority] || 0)}</strong></button>`).join("");
    $("#reportPriorityFilter").value = state.players.reportPriority;
    $("#reportsList").innerHTML = reports.items.length ? reports.items.map(report => {
      const reporter = report.reporter || {};
      const reported = report.reported || {};
      const suspended = reported.suspendedUntil && new Date(reported.suspendedUntil) > new Date();
      const risky = Number(reporter.reportsFiledLast7d || 0) >= 5;
      const selected = String(state.players.focusReportId) === String(report.id) ? " is-selected" : "";
      const priority = report.priority || "normal";
      return `<article class="admin-report${selected}" data-report-id="${escapeHtml(report.id)}">
        <div class="admin-report__top"><div class="admin-report__identity"><strong>@${escapeHtml(reported.username || "—")}</strong><small>${escapeHtml(reported.displayName || "")}</small></div><span>${status(reportPriorityLabel(priority), reportPriorityTone(priority))}<time>${formatDate(report.createdAt, false)}</time></span></div>
        <p>${escapeHtml(report.reason || "—")}</p>
        ${reportContextMarkup(report.context)}
        <span class="admin-report__context">${english ? "Reported by" : "Signalé par"}
          <button type="button" data-open-player="${escapeHtml(reporter.id)}">@${escapeHtml(reporter.username || "—")}</button>
          · ${formatNumber(reporter.totalReportsFiled || 0)} ${english ? "report(s) filed" : "signalement(s) déposés"}
          ${reporter.openReportsFiled ? ` · ${formatNumber(reporter.openReportsFiled)} ${english ? "open" : "ouverts"}` : ""}
          ${reporter.reportsFiledLast7d ? ` · ${formatNumber(reporter.reportsFiledLast7d)} ${english ? "in 7 days" : "sur 7 jours"}` : ""}
        </span>
        ${risky ? `<span class="admin-report__risk">${english ? "High reporting volume" : "Volume de signalements élevé"}</span>` : ""}
        <small>${suspended ? (english ? "Account currently suspended" : "Compte actuellement suspendu") : (english ? "Account active" : "Compte actif")}
          · ${formatNumber(reported.openReports || 0)} ${english ? "open report(s) on this account" : "signalement(s) ouverts sur ce compte"}</small>
        <div class="admin-report__actions">
          <button class="admin-row-button" type="button" data-open-player="${escapeHtml(reported.id)}" data-focus-report="${escapeHtml(report.id)}">${english ? "Review dossier" : "Voir le dossier"}</button>
          ${can("players.moderate") ? `<button class="admin-row-button" type="button" data-report-action="resolved" data-report-id="${report.id}" data-reported-id="${escapeHtml(reported.id)}" data-reported-name="${escapeHtml(reported.username || "")}" data-open-reports="${escapeHtml(reported.openReports || 0)}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("resolve", "Résoudre")}</button>
          <button class="admin-row-button admin-row-button--danger" type="button" data-report-action="resolved" data-report-suspend="true" data-report-id="${report.id}" data-reported-id="${escapeHtml(reported.id)}" data-reported-name="${escapeHtml(reported.username || "")}" data-open-reports="${escapeHtml(reported.openReports || 0)}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${english ? "Resolve + suspend" : "Résoudre + suspendre"}</button>
          <button class="admin-row-button" type="button" data-report-action="dismissed" data-report-id="${report.id}" data-reported-id="${escapeHtml(reported.id)}" data-reported-name="${escapeHtml(reported.username || "")}" data-open-reports="${escapeHtml(reported.openReports || 0)}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("dismiss", "Classer")}</button>` : ""}
        </div>
      </article>`;
    }).join("") : empty(tr("noReports", "Aucun signalement ouvert."));
    if (state.players.selected) {
      try { await selectPlayer(state.players.selected, { silent: true }); }
      catch (_) { state.players.selected = null; renderPlayerDossierEmpty(); }
    }
  }

  function renderPlayerDossierEmpty() {
    $("#playerDossier").innerHTML = `<p class="admin-empty">${escapeHtml(tr("playerPick", "Sélectionnez un joueur ou un signalement pour ouvrir la fiche de modération."))}</p>`;
  }

  async function selectPlayer(playerId, { silent = false, focusReportId = null } = {}) {
    state.players.selected = playerId;
    if (focusReportId != null) state.players.focusReportId = focusReportId;
    $("#playersList")?.querySelectorAll("[data-player-id]").forEach((node) => {
      node.classList.toggle("is-selected", String(node.dataset.playerId) === String(playerId));
    });
    if (!silent) $("#playerDossier").innerHTML = empty(english ? "Loading player dossier…" : "Chargement de la fiche joueur…");
    const data = await adminFetch(`/api/admin/players/${encodeURIComponent(playerId)}`);
    renderPlayerDossier(data);
    if (state.players.focusReportId) {
      const focused = $("#playerDossier")?.querySelector(`[data-dossier-report="${CSS.escape(String(state.players.focusReportId))}"]`);
      focused?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function closePlayerDossier() {
    state.players.selected = null;
    state.players.focusReportId = null;
    $("#playersList")?.querySelectorAll("[data-player-id]").forEach((node) => node.classList.remove("is-selected"));
    renderPlayerDossierEmpty();
  }

  function renderPlayerDossier(data) {
    const player = data.player || {};
    const moderation = data.moderation || {};
    const social = data.social || {};
    const sessions = data.sessions || {};
    const history = data.history || {};
    const suspended = player.suspendedUntil && new Date(player.suspendedUntil) > new Date();
    const suspensionLabel = suspended
      ? (player.suspensionSource === "admin"
        ? (english ? "Admin suspension" : "Suspension admin")
        : (english ? "Voluntary pause" : "Pause volontaire"))
      : (english ? "Active" : "Actif");
    const received = moderation.reportsReceived || [];
    const filed = moderation.reportsFiled || [];
    const suspensions = history.suspensions || [];
    const actions = history.adminActions || [];
    const squads = social.squads || [];
    const openReceived = received.filter((item) => item.status === "open").length;

    $("#playerDossier").innerHTML = `
      <div class="admin-dossier__toolbar">
        <p class="admin-eyebrow">${english ? "PLAYER DOSSIER" : "FICHE JOUEUR"}</p>
        <button class="admin-button admin-button--quiet" type="button" data-close-dossier>${english ? "Close" : "Fermer"}</button>
      </div>
      <div class="admin-editor__header">
        <div>
          <h2>${escapeHtml(player.displayName || player.username || "—")}</h2>
          <p class="admin-editor__id">@${escapeHtml(player.username || "—")} · #${escapeHtml(player.id)}</p>
        </div>
        ${status(suspensionLabel, suspended ? "danger" : moderation.openReports ? "warning" : "good")}
      </div>
      <div class="admin-dossier__meta">
        <div class="admin-dossier__chip"><span>${english ? "Joined" : "Inscription"}</span><strong>${formatDate(player.createdAt, false)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Last active" : "Dernière activité"}</span><strong>${formatDate(player.lastActiveAt)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Collection" : "Collection"}</span><strong>${formatPercent(player.collection?.completionRate)} · ${formatNumber(player.collection?.ownedVariants || 0)}/${formatNumber(player.collection?.releasedVariants || 0)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Open reports" : "Signalements ouverts"}</span><strong>${formatNumber(moderation.openReports || 0)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Friends / sessions" : "Amis / sessions"}</span><strong>${formatNumber(social.friends || 0)} · ${formatNumber(sessions.active || 0)}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Blocks" : "Blocages"}</span><strong>${formatNumber(moderation.blockedBy || 0)} ${english ? "against" : "reçus"} · ${formatNumber(moderation.blocking || 0)} ${english ? "issued" : "émis"}</strong></div>
      </div>
      ${suspended ? `<div class="admin-dialog__warning">${english ? "Suspended until" : "Suspendu jusqu’au"} ${formatDate(player.suspendedUntil)}${player.suspensionReason ? ` — ${escapeHtml(player.suspensionReason)}` : ""}</div>` : ""}
      <div class="admin-editor__footer">
        ${can("privacy.export") ? `<button class="admin-button admin-button--quiet" type="button" data-privacy-export="${escapeHtml(player.id)}" data-privacy-label="@${escapeHtml(player.username || player.id)}">${english ? "Export data" : "Exporter les données"}</button>` : ""}
        <button class="admin-button ${suspended ? "" : "admin-button--danger"}" type="button" data-player-action="${suspended ? "unsuspend" : "suspend"}" data-player-id="${player.id}" data-player-name="${escapeHtml(player.username || "")}">${suspended ? tr("unsuspend", "Réactiver") : tr("suspend", "Suspendre")}</button>
      </div>
      <section class="admin-editor__section">
        <h3>${english ? "Reports against this player" : "Signalements reçus"} (${received.length})</h3>
        <div>${received.length ? received.map((report) => {
          const reporter = report.reporter || {};
          const focused = String(state.players.focusReportId) === String(report.id);
          const risky = Number(reporter.reportsFiledLast7d || 0) >= 5;
          return `<article class="admin-dossier-report${focused ? " is-focused" : ""}" data-dossier-report="${escapeHtml(report.id)}">
            <div class="admin-dossier-report__top">
              <strong>${status(label(report.status), report.status === "open" ? "warning" : "good")} ${status(reportPriorityLabel(report.priority || "normal"), reportPriorityTone(report.priority || "normal"))}</strong>
              <time>${formatDate(report.createdAt)}</time>
            </div>
            <p>${escapeHtml(report.reason || "—")}</p>
            <small>${english ? "Reporter" : "Reporteur"}:
              <button class="admin-row-button" type="button" data-open-player="${escapeHtml(reporter.id)}">@${escapeHtml(reporter.username || "—")}</button>
              · ${formatNumber(reporter.totalReportsFiled || 0)} ${english ? "filed" : "déposés"}
              ${reporter.reportsFiledLast7d ? ` · ${formatNumber(reporter.reportsFiledLast7d)} ${english ? "in 7 days" : "sur 7 jours"}` : ""}
              ${reporter.openReportsFiled ? ` · ${formatNumber(reporter.openReportsFiled)} ${english ? "still open" : "encore ouverts"}` : ""}
            </small>
            ${risky ? `<span class="admin-report__risk">${english ? "High reporting volume" : "Volume de signalements élevé"}</span>` : ""}
            ${reportContextMarkup(report.context)}
            ${report.resolution ? `<small>${english ? "Resolution" : "Résolution"}: ${escapeHtml(report.resolution)}</small>` : ""}
            ${report.adminNotes ? `<div class="admin-report__internal"><strong>${english ? "Internal note" : "Note interne"}</strong><span>${escapeHtml(report.adminNotes)}</span></div>` : ""}
            ${report.appeal?.status && report.appeal.status !== "none" ? `<div class="admin-report__appeal"><strong>${english ? "Appeal" : "Recours"} · ${escapeHtml(label(report.appeal.status))}</strong>${report.appeal.message ? `<span>${escapeHtml(report.appeal.message)}</span>` : ""}${report.appeal.resolution ? `<small>${english ? "Decision" : "Décision"}: ${escapeHtml(report.appeal.resolution)}</small>` : ""}</div>` : ""}
            ${report.status === "open" ? `<div class="admin-report__actions">
              ${can("players.moderate") ? `<button class="admin-row-button" type="button" data-report-action="resolved" data-report-id="${report.id}" data-reported-id="${player.id}" data-reported-name="${escapeHtml(player.username || "")}" data-open-reports="${openReceived}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("resolve", "Résoudre")}</button>
              <button class="admin-row-button admin-row-button--danger" type="button" data-report-action="resolved" data-report-suspend="true" data-report-id="${report.id}" data-reported-id="${player.id}" data-reported-name="${escapeHtml(player.username || "")}" data-open-reports="${openReceived}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${english ? "Resolve + suspend" : "Résoudre + suspendre"}</button>
              <button class="admin-row-button" type="button" data-report-action="dismissed" data-report-id="${report.id}" data-reported-id="${player.id}" data-reported-name="${escapeHtml(player.username || "")}" data-open-reports="${openReceived}" data-report-priority="${escapeHtml(report.priority || "normal")}" data-report-admin-notes="${escapeHtml(report.adminNotes || "")}">${tr("dismiss", "Classer")}</button>` : ""}
            </div>` : ""}
            ${can("players.moderate") && (!report.appeal?.status || report.appeal.status === "none" || report.appeal.status === "received") ? `<div class="admin-report__actions">${!report.appeal?.status || report.appeal.status === "none" ? `<button class="admin-row-button" type="button" data-report-appeal="received" data-report-id="${report.id}">${english ? "Record appeal" : "Enregistrer un recours"}</button>` : ""}${report.appeal?.status === "received" ? `<button class="admin-row-button" type="button" data-report-appeal="accepted" data-report-id="${report.id}">${english ? "Accept appeal" : "Accepter le recours"}</button><button class="admin-row-button admin-row-button--danger" type="button" data-report-appeal="rejected" data-report-id="${report.id}">${english ? "Reject appeal" : "Rejeter le recours"}</button>` : ""}</div>` : ""}
          </article>`;
        }).join("") : empty(english ? "No report against this account." : "Aucun signalement contre ce compte.")}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Reports filed by this player" : "Signalements déposés"} (${filed.length})</h3>
        <div>${filed.length ? filed.map((report) => {
          const reported = report.reported || {};
          return `<article class="admin-dossier-report">
            <div class="admin-dossier-report__top"><strong>${status(label(report.status), report.status === "open" ? "warning" : "")}</strong><time>${formatDate(report.createdAt)}</time></div>
            <p>${escapeHtml(report.reason || "—")}</p>
            <small>${english ? "Target" : "Cible"}:
              <button class="admin-row-button" type="button" data-open-player="${escapeHtml(reported.id)}" data-focus-report="${escapeHtml(report.id)}">@${escapeHtml(reported.username || "—")}</button>
            </small>
          </article>`;
        }).join("") : empty(english ? "This player has not filed reports." : "Ce joueur n’a déposé aucun signalement.")}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Suspension history" : "Historique des suspensions"}</h3>
        <div class="admin-status-list">${suspensions.length ? suspensions.map((item) => {
          const applied = item.action === "player.suspended";
          return `<div class="admin-status-row"><span><strong>${applied ? (english ? "Suspended" : "Suspension") : (english ? "Reactivated" : "Réactivation")}</strong><small>${escapeHtml(item.actor || "—")} · ${escapeHtml(item.justification || "—")}</small></span><strong>${formatDate(item.created_at)}</strong></div>`;
        }).join("") : empty(english ? "No administrative suspension yet." : "Aucune suspension administrative.")}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Squads" : "Squads"}</h3>
        <div class="admin-status-list">${squads.length ? squads.map((squad) => `<div class="admin-status-row"><span>${escapeHtml(squad.name)} <small>${escapeHtml(squad.code)} · ${escapeHtml(label(squad.role))}</small></span><strong>${escapeHtml(label(squad.status))}</strong></div>`).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Recent admin actions" : "Actions admin récentes"}</h3>
        <div class="admin-status-list">${actions.length ? actions.map((item) => `<div class="admin-status-row"><span><code>${escapeHtml(item.action)}</code><small>${escapeHtml(item.actor || "—")} · ${escapeHtml(item.justification || "—")}</small></span><strong>${formatDate(item.created_at)}</strong></div>`).join("") : empty()}</div>
      </section>`;
  }

  function renderPagination(selector, data, kind) { const node = $(selector); if (!node) return; node.innerHTML = `<span>${english ? "Page" : "Page"} ${data.page} / ${Math.max(1, Math.ceil(data.total / data.pageSize))}</span><button type="button" data-page-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>‹</button><button type="button" data-page-kind="${kind}" data-page="${data.page + 1}" ${data.hasMore ? "" : "disabled"}>›</button>`; }

  async function loadCatalog() {
    const q = $("#catalogSearch").value.trim(), filter = $("#catalogState").value;
    if (!$("#catalogState option[value='data_issues']")) {
      $("#catalogState").insertAdjacentHTML("beforeend", `<option value="data_issues">${english ? "Data issues" : "Données à corriger"}</option>`);
    }
    const params = new URLSearchParams({ page: String(state.catalog.page), pageSize: "20", status: filter }); if (q) params.set("q", q);
    const data = await adminFetch(`/api/admin/catalog?${params}`);
    state.catalog.visibleItems = data.items;
    data.items.forEach((item) => state.catalog.bulkItems.set(item.id, item));
    $("#catalogCount").textContent = `${formatNumber(data.total)} ${english ? "sprite(s)" : "sprite(s)"}`;
    $("#catalogList").innerHTML = data.items.length ? data.items.map(sprite => {
      const variants = Number(sprite.variantCount) || 0;
      const diagnostics = [variants ? `${variants} ${english ? "variants" : "variantes"}` : (english ? "Variant link missing" : "Variantes à rattacher"), Number(sprite.sameNameRecords) > 1 ? (english ? `Potential duplicate ×${sprite.sameNameRecords}` : `Doublon potentiel ×${sprite.sameNameRecords}`) : ""].filter(Boolean);
      const tone = variants ? "" : " is-attention";
      return `<div class="admin-catalog-select${tone}"><label><input type="checkbox" data-bulk-catalog-toggle="${escapeHtml(sprite.id)}" ${state.catalog.bulkIds.has(sprite.id) ? "checked" : ""} aria-label="${english ? "Select" : "Sélectionner"} ${escapeHtml(sprite.name)}" /></label><button class="admin-catalog-card ${state.catalog.selected === sprite.id ? "is-selected" : ""}" type="button" data-catalog-id="${escapeHtml(sprite.id)}"><span class="admin-catalog-card__image">${adminCatalogImage(sprite.image)}</span><span><strong>${escapeHtml(sprite.name)}</strong><small>${escapeHtml(sprite.id)} · ${escapeHtml(label(sprite.rarity))}</small></span><span class="admin-catalog-card__meta ${variants ? "" : "is-attention"}">${diagnostics.map((diagnostic) => `<small>${escapeHtml(diagnostic)}</small>`).join("")}</span></button></div>`;
    }).join("") : empty(tr("noCatalog", "Aucun sprite trouvé."));
    renderBulkBar("catalog");
    renderPagination("#catalogPagination", data, "catalog");
    if (state.catalog.selected && !data.items.some(item => item.id === state.catalog.selected)) state.catalog.selected = null;
    if (!state.catalog.selected) renderCatalogEmptyState(data);
  }

  function renderCatalogEmptyState(data) {
    const items = data.items || [];
    const withoutVariants = items.filter((item) => !(Number(item.variantCount) || 0)).length;
    const duplicateCandidates = items.filter((item) => Number(item.sameNameRecords) > 1).length;
    $("#catalogEditor").innerHTML = `<div class="admin-catalog-empty"><span class="admin-catalog-empty__icon" aria-hidden="true">✦</span><p class="admin-eyebrow">INSPECTEUR CATALOGUE</p><h2>${english ? "Choose a sprite to inspect" : "Choisissez un sprite à inspecter"}</h2><p>${english ? "Its visual, variants, availability and change history will appear here." : "Son visuel, ses variantes, disponibilités et son historique apparaîtront ici."}</p><div class="admin-catalog-empty__signals"><span><b>${formatNumber(withoutVariants)}</b>${english ? " without variant links on this page" : " sans variantes rattachées sur cette page"}</span><span><b>${formatNumber(duplicateCandidates)}</b>${english ? " potential duplicate(s)" : " doublon(s) potentiel(s)"}</span></div><button class="admin-button admin-button--quiet" type="button" data-catalog-show-issues>${english ? "Review data issues" : "Voir les données à corriger"}</button></div>`;
  }

  async function selectCatalog(spriteId) {
    state.catalog.selected = spriteId;
    $("#catalogList").querySelectorAll("[data-catalog-id]").forEach(node => node.classList.toggle("is-selected", node.dataset.catalogId === spriteId));
    $("#catalogEditor").innerHTML = empty(english ? "Loading sprite details…" : "Chargement des détails du sprite…");
    try { renderCatalogEditor(await adminFetch(`/api/admin/catalog/${encodeURIComponent(spriteId)}`)); } catch (error) { setAlert(error.message || tr("loadFailed")); }
  }

  function renderBulkBar(kind) {
    const config = kind === "catalog"
      ? { state: state.catalog, ids: state.catalog.bulkIds, bar: "#catalogBulkBar", count: "#catalogBulkCount", hint: "#catalogBulkHint" }
      : { state: state.events, ids: state.events.bulkIds, bar: "#eventsBulkBar", count: "#eventsBulkCount", hint: "#eventsBulkHint", pageToggle: "#eventsBulkSelectPage" };
    const size = config.ids.size;
    $(config.bar).hidden = !size;
    $(config.count).textContent = english ? `${formatNumber(size)} selected` : `${formatNumber(size)} sélectionné(s)`;
    const visible = config.state.visibleItems || [];
    const visibleSelected = visible.filter((item) => config.ids.has(item.id)).length;
    if ($(config.hint)) $(config.hint).textContent = english
      ? `${formatNumber(visibleSelected)} on this page · selection is retained between pages.`
      : `${formatNumber(visibleSelected)} sur cette page · la sélection est conservée entre les pages.`;
    if (config.pageToggle) {
      const toggle = $(config.pageToggle);
      toggle.checked = Boolean(visible.length) && visibleSelected === visible.length;
      toggle.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    }
  }

  function toggleBulkPage(kind, checked) {
    const bucket = kind === "catalog" ? state.catalog : state.events;
    (bucket.visibleItems || []).forEach((item) => {
      bucket.bulkItems.set(item.id, item);
      if (checked) bucket.bulkIds.add(item.id); else bucket.bulkIds.delete(item.id);
    });
    $$(`[data-bulk-${kind === "catalog" ? "catalog" : "event"}-toggle]`).forEach((input) => { input.checked = checked; });
    renderBulkBar(kind);
  }

  function bulkPreviewItems(action) {
    const bucket = action.kind === "catalog" ? state.catalog : state.events;
    const key = action.kind === "catalog" ? "editorialStatus" : "data_status";
    return action.ids.map((id) => {
      const item = bucket.bulkItems.get(id) || { id, name: id };
      return { id, name: item.name || id, before: item[key] || (action.kind === "catalog" ? "published" : "unknown") };
    });
  }

  function openBulkAction(kind) {
    const ids = kind === "catalog" ? [...state.catalog.bulkIds] : kind === "events" ? [...state.events.bulkIds] : kind === "notifications" ? [...state.notifications.bulkIds] : kind === "collections" ? [...state.collections.bulkIds] : [];
    const count = kind === "notifications" ? (ids.length || state.bulkData.failedNotifications) : kind === "collections" ? (ids.length || state.bulkData.repairableReferences) : ids.length;
    if (!count) return;
    const statusValue = kind === "catalog" ? $("#catalogBulkStatus").value : kind === "events" ? $("#eventsBulkStatus").value : null;
    const statusName = label(statusValue);
    state.bulkAction = { kind, ids, status: statusValue };
    const preview = (kind === "catalog" || kind === "events") ? bulkPreviewItems(state.bulkAction) : kind === "notifications" && ids.length ? ids.map((id) => ({ id, name: `#${id}`, before: "failed" })) : kind === "collections" && ids.length ? ids.map((id) => ({ id, name: `#${id}`, before: "mismatch" })) : [];
    const affected = preview.filter((item) => item.before !== statusValue).length || (kind === "notifications" ? Math.min(50, count) : kind === "collections" ? count : 0);
    state.bulkAction.affected = affected;
    const copy = kind === "catalog" ? [(english ? "Apply catalog workflow" : "Appliquer le workflow catalogue"), english ? `${formatNumber(affected)} of ${formatNumber(count)} selected sprite(s) need this transition.` : `${formatNumber(affected)} sprite(s) sur ${formatNumber(count)} doivent réellement changer d’état.`, english ? "Each changed sprite receives its own history entry, so it can be restored individually from its catalog record." : "Chaque sprite modifié reçoit son propre historique : il peut être restauré individuellement depuis sa fiche catalogue."] : kind === "events" ? [(english ? "Update event data status" : "Mettre à jour l’état des événements"), english ? `${formatNumber(affected)} of ${formatNumber(count)} selected event(s) need this update.` : `${formatNumber(affected)} événement(s) sur ${formatNumber(count)} doivent réellement être mis à jour.`, english ? "Only the data-status field changes. Dates, availability and published news remain untouched." : "Seul l’état des données change. Les dates, disponibilités et actualités publiées restent intactes."] : kind === "notifications" ? [(english ? "Retry failed deliveries" : "Relancer les livraisons en échec"), english ? `Up to ${formatNumber(Math.min(50, count))} failed delivery job(s) will be requeued.` : `Jusqu’à ${formatNumber(Math.min(50, count))} job(s) en échec seront replacés dans la file.`, english ? "Only failed or cancelled deliveries are retried; successful deliveries are never touched." : "Seules les livraisons en échec ou annulées sont relancées ; les livraisons réussies ne sont jamais modifiées."] : [(english ? "Repair collection references" : "Réparer les références de collection"), english ? `${formatNumber(count)} inconsistent reference(s) will be safely aligned.` : `${formatNumber(count)} référence(s) incohérente(s) seront réalignées de manière sûre.`, english ? "Statuses, priorities and player notes are preserved. The repair is logged for audit." : "Les statuts, priorités et notes des joueurs sont préservés. La réparation est journalisée."];
    $("#bulkActionTitle").textContent = copy[0]; $("#bulkActionSummary").textContent = copy[1]; $("#bulkActionImpact").textContent = copy[2];
    $("#bulkActionPlan").innerHTML = `<span><b>${formatNumber(count)}</b><small>${english ? "selected" : "sélectionnés"}</small></span><span><b>${formatNumber(affected)}</b><small>${english ? "will change" : "vont changer"}</small></span><span><b>${escapeHtml(kind === "catalog" || kind === "events" ? statusName : (english ? "safe" : "sûr"))}</b><small>${english ? "target" : "cible"}</small></span>`;
    const itemsNode = $("#bulkActionItems");
    itemsNode.hidden = !preview.length;
    itemsNode.innerHTML = preview.length ? `<p>${english ? "Selection preview" : "Aperçu de la sélection"}</p><ul>${preview.slice(0, 6).map((item) => `<li><span>${escapeHtml(item.name)}</span><small>${kind === "notifications" ? (english ? "retry delivery" : "relancer la livraison") : kind === "collections" ? (english ? "realign sprite reference" : "réaligner la référence sprite") : `${escapeHtml(label(item.before))} → ${escapeHtml(statusName)}`}</small></li>`).join("")}${preview.length > 6 ? `<li class="admin-bulk-preview__more">+ ${formatNumber(preview.length - 6)} ${english ? "more" : "autre(s)"}</li>` : ""}</ul>` : "";
    const acknowledgement = $("#bulkActionAcknowledgeWrap");
    acknowledgement.hidden = kind === "collections";
    $("#bulkActionAcknowledge").checked = false;
    $("#bulkActionAcknowledgeTitle").textContent = english ? "I reviewed the exact impact." : "J’ai vérifié l’impact exact.";
    $("#bulkActionAcknowledgeHint").textContent = kind === "catalog" ? (english ? "Changed sprites remain individually restorable from their history." : "Les sprites modifiés restent restaurables individuellement via leur historique.") : (english ? "The operation is applied immediately and recorded in the audit log." : "L’opération est appliquée immédiatement et inscrite au journal d’audit.");
    $("#bulkActionReason").value = "";
    $("#bulkActionError").hidden = true;
    $("#bulkActionProgress").hidden = true;
    $("#bulkActionSubmit").disabled = !affected;
    $("#bulkActionDialog").showModal();
    requestAnimationFrame(() => $("#bulkActionReason").focus());
  }

  function closeBulkAction(force = false) { if (!force && $("#bulkActionSubmit")?.dataset.running === "true") return; if ($("#bulkActionDialog")?.open) $("#bulkActionDialog").close(); state.bulkAction = null; }

  async function submitBulkAction(event) {
    event.preventDefault();
    const action = state.bulkAction;
    if (!action) return;
    const reason = $("#bulkActionReason").value.trim(), errorNode = $("#bulkActionError");
    if (!reason) { errorNode.textContent = tr("reasonRequired"); errorNode.hidden = false; return; }
    if (action.kind !== "collections" && !$("#bulkActionAcknowledge").checked) { errorNode.textContent = english ? "Confirm that you reviewed the impact before applying it." : "Confirmez avoir vérifié l’impact avant de l’appliquer."; errorNode.hidden = false; return; }
    const submit = $("#bulkActionSubmit"); submit.disabled = true;
    submit.dataset.running = "true";
    $("#bulkActionCancel").disabled = true; $("#bulkActionClose").disabled = true;
    $("#bulkActionProgress").hidden = false; $("#bulkActionProgressLabel").textContent = english ? "Atomic update in progress — keep this window open." : "Mise à jour atomique en cours — gardez cette fenêtre ouverte.";
    try {
      const path = action.kind === "catalog" ? "/api/admin/catalog/bulk-workflow" : action.kind === "events" ? "/api/admin/events/bulk-status" : action.kind === "notifications" ? "/api/admin/notifications/retry-failed" : "/api/admin/collections/integrity/repair";
      const body = action.kind === "catalog" ? { spriteIds: action.ids, status: action.status, reason } : action.kind === "events" ? { eventIds: action.ids, dataStatus: action.status, reason } : action.kind === "notifications" ? { reason, limit: 50, jobIds: action.ids } : { action: "backfill-sprite-references", reason, entryIds: action.ids };
      const result = await adminFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const changed = Number(result.updated ?? result.retried ?? result.repaired ?? 0);
      if (action.kind === "catalog") state.catalog.bulkIds.clear(); else if (action.kind === "events") state.events.bulkIds.clear(); else if (action.kind === "notifications") state.notifications.bulkIds.clear(); else if (action.kind === "collections") state.collections.bulkIds.clear();
      closeBulkAction(true);
      setNotice(english ? `${formatNumber(changed)} item(s) updated.` : `${formatNumber(changed)} élément(s) mis à jour.`);
      await loadTab(action.kind === "catalog" ? "catalog" : action.kind === "events" ? "events" : action.kind === "notifications" ? "notifications" : "collections", true);
    } catch (error) { errorNode.textContent = error.message || tr("saveFailed"); errorNode.hidden = false; }
    finally { submit.disabled = false; delete submit.dataset.running; $("#bulkActionCancel").disabled = false; $("#bulkActionClose").disabled = false; $("#bulkActionProgress").hidden = true; }
  }

  function renderCatalogEditor(data) {
    const sprite = data.sprite, variants = data.variants || [], availability = data.availabilityPeriods || [], history = data.history || [];
    const editorialStatus = sprite.editorial_status || (sprite.is_released === false ? "draft" : "published");
    const dataStatuses = ["complete", "verified", "incomplete", "unknown"];
    const statusOptions = (selected) => dataStatuses.map(option => `<option value="${option}" ${selected === option ? "selected" : ""}>${escapeHtml(label(option))}</option>`).join("");
    const jsonField = (value) => escapeHtml(value == null ? "" : JSON.stringify(value, null, 2));
    $("#catalogEditor").innerHTML = `<div class="admin-editor__header"><div><p class="admin-eyebrow">SPRITE</p><h2>${escapeHtml(sprite.name)}</h2><p class="admin-editor__id">${escapeHtml(sprite.id)}</p></div>${status(sprite.data_status || tr("unknown"), sprite.data_status === "complete" || sprite.data_status === "verified" ? "good" : "warning")}</div>
      <section class="admin-workflow"><div><p class="admin-eyebrow">WORKFLOW ÉDITORIAL</p><strong>${escapeHtml(label(editorialStatus))}</strong><small>${sprite.editorial_updated_at ? formatDate(sprite.editorial_updated_at) : (english ? "Legacy state" : "État existant")}</small></div>${can("catalog.write") ? `<div class="admin-workflow__actions"><button class="admin-row-button" type="button" data-catalog-workflow="draft" data-sprite-id="${escapeHtml(sprite.id)}" ${editorialStatus === "draft" ? "disabled" : ""}>${english ? "Draft" : "Brouillon"}</button><button class="admin-row-button" type="button" data-catalog-workflow="review" data-sprite-id="${escapeHtml(sprite.id)}" ${editorialStatus === "review" ? "disabled" : ""}>${english ? "Review" : "Relecture"}</button><button class="admin-row-button" type="button" data-catalog-workflow="published" data-sprite-id="${escapeHtml(sprite.id)}" ${editorialStatus === "published" ? "disabled" : ""}>${english ? "Publish" : "Publier"}</button></div>` : ""}</section>
      <section class="admin-catalog-preview"><div class="admin-catalog-preview__media">${adminCatalogImage(sprite.image)}</div><div><span>${english ? "Public preview" : "Prévisualisation publique"}</span><strong>${escapeHtml(sprite.name)}</strong><small>${escapeHtml(sprite.rarity || "—")} · ${escapeHtml(label(editorialStatus))}</small></div></section>
      ${can("catalog.write") ? `<form id="catalogEditForm">
        <div class="admin-editor__grid">
          <div class="admin-field"><label>${english ? "Name" : "Nom"}</label><input name="name" value="${escapeHtml(sprite.name)}" maxlength="100" required /></div>
          <div class="admin-field"><label>${english ? "Rarity" : "Rareté"}</label><input name="rarity" value="${escapeHtml(sprite.rarity || "")}" maxlength="30" /></div>
          <div class="admin-field"><label>${english ? "Color" : "Couleur"}</label><input name="color" value="${escapeHtml(sprite.color || "")}" maxlength="60" /></div>
          <div class="admin-field"><label>${english ? "Availability label" : "Libellé disponibilité"}</label><input name="available" value="${escapeHtml(sprite.available || "")}" maxlength="20" /></div>
          <div class="admin-field"><label>${english ? "Event id" : "Événement lié"}</label><input name="eventId" value="${escapeHtml(sprite.event_id || "")}" maxlength="100" /></div>
          <div class="admin-field"><label>${english ? "Season id" : "Saison"}</label><input name="seasonId" value="${escapeHtml(sprite.season_id || "")}" maxlength="50" /></div>
          <div class="admin-field"><label>${english ? "Data status" : "État des données"}</label><select name="dataStatus">${statusOptions(sprite.data_status)}</select></div>
          <div class="admin-field"><label>${english ? "Released" : "Publié"}</label><select name="isReleased"><option value="true" ${sprite.is_released !== false ? "selected" : ""}>${english ? "Yes" : "Oui"}</option><option value="false" ${sprite.is_released === false ? "selected" : ""}>${english ? "No" : "Non"}</option></select></div>
          <div class="admin-field"><label>${english ? "Last verified" : "Dernière vérif."}</label><input name="lastVerifiedAt" type="datetime-local" value="${toLocalInput(sprite.last_verified_at)}" /></div>
          <div class="admin-field admin-field--wide"><label>${english ? "Image URL" : "URL de l’image"}</label><input name="image" value="${escapeHtml(sprite.image || "")}" maxlength="2000" /></div>
          <div class="admin-field admin-field--wide"><label>${english ? "Effect / notes" : "Effet / notes"}</label><textarea name="effect" maxlength="2000" rows="3">${escapeHtml(sprite.effect || "")}</textarea></div>
          <details class="admin-editor__advanced admin-field--wide"><summary>${english ? "Identity, dates & collection" : "Identité, dates & collection"}</summary><div class="admin-editor__grid"><div class="admin-field"><label>Catalog ID</label><input name="catalogId" value="${escapeHtml(sprite.catalog_id || "")}" maxlength="50" /></div><div class="admin-field"><label>Slug</label><input name="slug" value="${escapeHtml(sprite.slug || "")}" maxlength="50" /></div><div class="admin-field"><label>${english ? "Official name" : "Nom officiel"}</label><input name="officialName" value="${escapeHtml(sprite.official_name || "")}" maxlength="100" /></div><div class="admin-field"><label>${english ? "Update introduced" : "Mise à jour d’introduction"}</label><input name="introducedInUpdate" value="${escapeHtml(sprite.introduced_in_update || "")}" maxlength="20" /></div><div class="admin-field"><label>${english ? "First observed" : "Première observation"}</label><input name="firstObservedAt" type="datetime-local" value="${toLocalInput(sprite.first_observed_at)}" /></div><div class="admin-field"><label>${english ? "Officially announced" : "Annonce officielle"}</label><input name="officiallyAnnouncedAt" type="datetime-local" value="${toLocalInput(sprite.officially_announced_at)}" /></div><div class="admin-field"><label>${english ? "Base summon cost" : "Coût d’invocation"}</label><input name="baseSummonCost" type="number" min="0" value="${escapeHtml(sprite.base_summon_cost ?? "")}" /></div><div class="admin-field"><label>${english ? "Catalog version" : "Version catalogue"}</label><input name="catalogVersion" value="${escapeHtml(sprite.catalog_version || "")}" maxlength="32" /></div></div></details>
          <details class="admin-editor__advanced admin-field--wide"><summary>${english ? "Structured data (JSON)" : "Données structurées (JSON)"}</summary><p>${english ? "Use valid JSON only. Empty values clear the corresponding optional field." : "Utilisez uniquement du JSON valide. Une valeur vide efface le champ optionnel correspondant."}</p><div class="admin-editor__grid"><div class="admin-field"><label>Variants (JSON array)</label><textarea name="variants" rows="5">${jsonField(sprite.variants)}</textarea></div><div class="admin-field"><label>Ability</label><textarea name="ability" rows="5">${jsonField(sprite.ability)}</textarea></div><div class="admin-field"><label>Acquisition</label><textarea name="acquisition" rows="5">${jsonField(sprite.acquisition)}</textarea></div><div class="admin-field"><label>Availability</label><textarea name="availability" rows="5">${jsonField(sprite.availability)}</textarea></div><div class="admin-field"><label>Recurrence</label><textarea name="recurrence" rows="5">${jsonField(sprite.recurrence)}</textarea></div><div class="admin-field"><label>Dates</label><textarea name="dates" rows="5">${jsonField(sprite.dates)}</textarea></div><div class="admin-field"><label>Missing fields</label><textarea name="missingFields" rows="5">${jsonField(sprite.missing_fields)}</textarea></div><div class="admin-field"><label>Notes</label><textarea name="notes" rows="5">${jsonField(sprite.notes)}</textarea></div><div class="admin-field"><label>Sources</label><textarea name="sources" rows="5">${jsonField(sprite.sources)}</textarea></div></div></details>
          <div class="admin-field admin-field--wide"><label>${english ? "Reason" : "Justification"}</label><input class="admin-editor__reason" name="reason" placeholder="${english ? "Required for traceability" : "Requise pour la traçabilité"}" maxlength="1000" required /></div>
        </div>
        <div class="admin-editor__footer"><button class="admin-button" type="submit">${english ? "Save changes" : "Enregistrer"}</button></div>
      </form>` : `<p class="admin-note">${english ? "Read-only catalog view for your role." : "Catalogue en lecture seule pour votre rôle."}</p>`}
      <section class="admin-editor__section"><h3>${english ? "Variants" : "Variantes"} (${variants.length})</h3><div class="admin-variant-list">${variants.length ? variants.map(variant => { const variantWorkflow = variant.editorial_status || "published"; const visual = variant.image_path || variant.suggested_image_path; const compatibility = variant.is_compatibility_variant === true; return `<div class="admin-variant ${compatibility ? "is-compatibility" : ""}"><span class="admin-variant__thumb">${adminCatalogImage(visual)}</span><span><strong>${escapeHtml(variant.name)}</strong><small>${escapeHtml(variant.variant_type)} · ${escapeHtml(label(variant.data_status || "unknown"))}${compatibility ? ` · ${english ? "seed reference" : "référence seed"}` : ` · ${escapeHtml(label(variantWorkflow))}`}${!adminImageUrl(visual) ? ` · ${english ? "image missing" : "image absente"}` : ""}</small></span>${can("catalog.write") && !compatibility ? `<div class="admin-row-actions"><button class="admin-row-button" type="button" data-variant-workflow="${variantWorkflow === "draft" ? "review" : variantWorkflow === "review" ? "published" : "draft"}" data-variant-id="${escapeHtml(variant.id)}">${variantWorkflow === "draft" ? (english ? "Send to review" : "Envoyer en relecture") : variantWorkflow === "review" ? (english ? "Publish" : "Publier") : (english ? "Return to draft" : "Repasser en brouillon")}</button><button class="admin-row-button" type="button" data-edit-variant="${escapeHtml(variant.id)}" data-variant-name="${escapeHtml(variant.name)}" data-variant-rarity="${escapeHtml(variant.rarity || "")}" data-variant-image="${escapeHtml(variant.image_path || "")}" data-variant-release="${escapeHtml(variant.release_status || "")}" data-variant-status="${escapeHtml(variant.data_status || "unknown")}" data-variant-json="${escapeHtml(JSON.stringify(variant))}">${tr("edit", "Modifier")}</button></div>` : ""}</div>`; }).join("") : empty()}</div></section>
      <section class="admin-editor__section"><h3>${english ? "Availability" : "Disponibilités"} (${availability.length})</h3><div class="admin-status-list">${availability.slice(0, 6).map(period => `<div class="admin-status-row"><span>${escapeHtml(label(period.status))} · ${formatDate(period.start_date, false)} → ${formatDate(period.end_date, false)}${period.event_id ? ` · ${escapeHtml(period.event_id)}` : ""}</span><strong>${escapeHtml(label(period.confidence))}</strong></div>`).join("") || empty()}</div>${can("catalog.write") ? `<div class="admin-editor__footer"><button class="admin-button admin-button--quiet" type="button" id="addAvailability" data-sprite-id="${escapeHtml(sprite.id)}" data-sprite-name="${escapeHtml(sprite.name)}">${english ? "Add availability" : "Ajouter une disponibilité"}</button></div>` : ""}</section>
      <section class="admin-editor__section"><h3>${english ? "Recent change history" : "Historique récent"}</h3><div class="admin-status-list">${history.slice(0, 5).map(item => `<div class="admin-status-row"><span><strong>${escapeHtml(item.field)}</strong><small>${escapeHtml(item.reason || "—")} · ${formatDate(item.changed_at)}</small></span>${can("catalog.write") && spriteEditableField(item.field) ? `<button class="admin-row-button" type="button" data-catalog-rollback="${escapeHtml(item.id)}" data-sprite-id="${escapeHtml(sprite.id)}">${english ? "Restore" : "Restaurer"}</button>` : ""}</div>`).join("") || empty()}</div></section>`;
  }

  function spriteEditableField(field) { return ["name", "rarity", "color", "effect", "available", "image", "eventId", "seasonId", "dataStatus", "lastVerifiedAt", "isReleased", "editorialStatus"].includes(field); }

  async function loadEvents() {
    const newsStatus = state.events?.newsStatus || $("#newsStatusFilter")?.value || "all";
    if ($("#newsStatusFilter")) $("#newsStatusFilter").value = newsStatus;
    const newsQuery = new URLSearchParams({ pageSize: "20" });
    if (newsStatus !== "all") newsQuery.set("status", newsStatus);
    const [events, news] = await Promise.all([
      adminFetch("/api/admin/events?pageSize=20"),
      adminFetch(`/api/admin/news?${newsQuery}`)
    ]);
    state.events.visibleItems = events.items;
    events.items.forEach((item) => state.events.bulkItems.set(item.id, item));
    $("#eventsNewsMeta").textContent = english
      ? `${formatNumber(events.total)} event(s) · ${formatNumber(news.total)} news`
      : `${formatNumber(events.total)} événement(s) · ${formatNumber(news.total)} actualité(s)`;
    $("#eventsList").innerHTML = events.items.length
      ? events.items.map(item => `<tr>
          <td><input type="checkbox" data-bulk-event-toggle="${escapeHtml(item.id)}" ${state.events.bulkIds.has(item.id) ? "checked" : ""} aria-label="${english ? "Select" : "Sélectionner"} ${escapeHtml(item.name || item.id)}" /></td>
          <td><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.type || "—")} · ${formatNumber(item.availability_count)} ${english ? "availability periods" : "périodes"}</small></td>
          <td>${formatDate(item.start_date, false)}</td>
          <td>${formatDate(item.end_date, false)}</td>
          <td>${status(item.data_status || tr("unknown"), item.data_status === "complete" || item.data_status === "verified" ? "good" : "warning")}</td>
          <td>${can("events.write") ? `<button class="admin-row-button" type="button" data-edit-event="${escapeHtml(item.id)}">${tr("edit", "Modifier")}</button>` : ""}</td>
        </tr>`).join("")
      : `<tr><td colspan="6">${empty(tr("noEvents", "Aucun événement."))}</td></tr>`;
    renderBulkBar("events");
    $("#newsList").innerHTML = news.items.length
      ? news.items.map(item => {
        const thumb = item.image
          ? `<span class="admin-news__thumb"><img src="${escapeHtml(item.image)}" alt="" loading="lazy" /></span>`
          : `<span class="admin-news__thumb" aria-hidden="true">✦</span>`;
        const canPublish = item.status !== "published";
        const canArchive = item.status === "published";
        return `<article class="admin-news">
          ${thumb}
          <div class="admin-news__body">
            <div class="admin-news__top">
              <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)} · ${formatDate(item.news_date, false)}${item.editor_note ? ` · ${english ? "note" : "note"}` : ""}</small></span>
              ${status(label(item.status), item.status === "published" ? "good" : item.status === "draft" ? "warning" : "")}
            </div>
            <p>${escapeHtml(item.description || "")}</p>
            <div class="admin-news__actions">
              ${can("events.write") ? `<button class="admin-row-button" type="button" data-edit-news="${item.id}">${tr("edit", "Modifier")}</button>
              ${canPublish ? `<button class="admin-row-button" type="button" data-news-action="publish" data-news-id="${item.id}">${tr("publish", "Publier")}</button>` : ""}
              ${canArchive ? `<button class="admin-row-button" type="button" data-news-action="archive" data-news-id="${item.id}">${tr("archive", "Archiver")}</button>` : ""}` : ""}
            </div>
          </div>
        </article>`;
      }).join("")
      : empty(tr("noNews", "Aucune actualité."));
  }

  async function loadCollections() {
    const data = await adminFetch("/api/admin/collections/integrity"), c = data.checks || {};
    state.bulkData.repairableReferences = Number(c.mismatchedSpriteReferences) || 0;
    state.collections.visibleItems = data.mismatchedEntries || [];
    state.collections.visibleItems.forEach((entry) => state.collections.bulkItems.set(String(entry.id), entry));
    $("#integrityKpis").innerHTML = [kpi(english ? "Orphaned entries" : "Entrées orphelines", formatNumber(c.orphanedEntries), english ? "unknown variant reference" : "référence de variante inconnue", Number(c.orphanedEntries) ? "danger" : ""), kpi(english ? "Mismatched references" : "Références incohérentes", formatNumber(c.mismatchedSpriteReferences), english ? "safe repair available" : "correction sûre disponible", Number(c.mismatchedSpriteReferences) ? "warning" : ""), kpi(english ? "Invalid statuses" : "Statuts invalides", formatNumber(c.invalidStatuses), english ? "requires manual review" : "révision manuelle requise", Number(c.invalidStatuses) ? "danger" : ""), kpi(english ? "Migration errors" : "Erreurs de migration", formatNumber(c.migrationErrors), english ? "historical imports" : "imports historiques", Number(c.migrationErrors) ? "warning" : "")].join("");
    $("#migrationErrors").innerHTML = data.latestMigrationErrors.length ? data.latestMigrationErrors.map(error => `<article class="admin-error"><strong>${escapeHtml(error.table_name)} · ${escapeHtml(error.original_key)}</strong><small>${escapeHtml(error.error || "—")} · ${formatDate(error.created_at)}</small></article>`).join("") : empty(tr("noErrors", "Aucune erreur de migration."));
    $("#integrityPassportQueue").innerHTML = data.passportQueue.length ? data.passportQueue.map(row => `<div class="admin-status-row"><span>${escapeHtml(label(row.status))}</span><strong>${formatNumber(row.count)}</strong></div>`).join("") : empty();
    const repairButton = $("#repairSpriteReferences");
    $("#integrityMismatchPreview")?.remove();
    if (repairButton && state.collections.visibleItems.length) {
      const selected = state.collections.bulkIds.size;
      const rows = state.collections.visibleItems.map((entry) => `<label class="admin-integrity-entry"><input type="checkbox" data-bulk-collection-toggle="${entry.id}" ${state.collections.bulkIds.has(String(entry.id)) ? "checked" : ""} /><span><strong>#${entry.id} · ${escapeHtml(entry.variant_id)}</strong><small>${entry.username ? `@${escapeHtml(entry.username)} · ` : ""}${escapeHtml(entry.current_sprite_id || "—")} → ${escapeHtml(entry.expected_sprite_id || "—")}</small></span></label>`).join("");
      repairButton.insertAdjacentHTML("afterend", `<div class="admin-integrity-preview" id="integrityMismatchPreview"><header><div><strong>${english ? "Repair a precise selection" : "Réparer une sélection précise"}</strong><small>${english ? "Choose individual entries, or repair every detected mismatch." : "Choisissez les entrées, ou corrigez toutes les incohérences détectées."}</small></div><div class="admin-inline-actions"><button class="admin-row-button" type="button" data-collection-select-page>${selected === state.collections.visibleItems.length ? (english ? "Clear shown" : "Effacer l’affichage") : (english ? "Select shown" : "Sélectionner l’affichage")}</button>${selected ? `<button class="admin-row-button" type="button" data-collection-bulk-apply>${english ? `Review ${formatNumber(selected)}` : `Vérifier ${formatNumber(selected)}`}</button>` : ""}</div></header><div class="admin-integrity-preview__list">${rows}</div></div>`);
    }
  }

  async function loadSocial() {
    const q = ($("#squadSearch")?.value || state.social.q || "").trim();
    const join = $("#squadJoinFilter")?.value || state.social.join || "all";
    state.social.q = q;
    state.social.join = join;
    if ($("#squadSearch")) $("#squadSearch").value = q;
    if ($("#squadJoinFilter")) $("#squadJoinFilter").value = join;
    const params = new URLSearchParams({ page: String(state.social.page || 1), pageSize: "20", join });
    if (q) params.set("q", q);
    const data = await adminFetch(`/api/admin/social?${params}`);
    const s = data.summary || {};
    $("#socialKpis").innerHTML = [
      kpi(english ? "Squads" : "Squads", formatNumber(s.squads), `${formatNumber(s.open_join_squads)} ${english ? "open join" : "accès ouvert"} · ${formatNumber(s.active_members)} ${english ? "members" : "membres"}`),
      kpi(english ? "Activity · 24h" : "Activité · 24 h", formatNumber(s.activity24h), english ? "squad events" : "événements de squad"),
      kpi(english ? "Friendships" : "Amitiés", formatNumber(s.friendships), `${formatNumber(s.pending_friendships)} ${english ? "pending" : "en attente"}`, Number(s.pending_friendships) ? "warning" : ""),
      kpi(english ? "Squad invites" : "Invitations", formatNumber(s.pending_squad_invitations), english ? "pending" : "en attente", Number(s.pending_squad_invitations) ? "warning" : ""),
      kpi(english ? "Wishes / blocks" : "Souhaits / blocages", `${formatNumber(s.wanted_items)} / ${formatNumber(s.blocks)}`, english ? "wanted · safety" : "à trouver · sûreté", Number(s.blocks) ? "warning" : "")
    ].join("");
    const squads = data.squads || { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
    $("#squadsCount").textContent = `${formatNumber(squads.total)} ${english ? "squad(s)" : "squad(s)"}`;
    $("#squadsList").innerHTML = squads.items.length
      ? squads.items.map(squad => {
        const selected = String(state.social.selected) === String(squad.id) ? " is-selected" : "";
        const stale = !squad.last_activity_at || (Date.now() - new Date(squad.last_activity_at).getTime() > 30 * 24 * 60 * 60 * 1000);
        const riskyOpen = squad.join_open && Number(squad.member_count) >= 8;
        return `<tr class="admin-player-row${selected}" data-squad-id="${escapeHtml(squad.id)}">
          <td><strong>${escapeHtml(squad.name)}</strong><small>${escapeHtml(squad.code)} · ${escapeHtml(label(squad.visibility))}${squad.join_open ? ` · ${english ? "open" : "ouvert"}` : ` · ${english ? "closed" : "fermé"}`}${riskyOpen ? ` · ${english ? "review join" : "accès à surveiller"}` : ""}${stale ? ` · ${english ? "stale" : "inactive"}` : ""}</small></td>
          <td>${formatNumber(squad.member_count)}</td>
          <td>${formatNumber(squad.wanted_count)}</td>
          <td>${formatNumber(squad.pending_invite_count)}</td>
          <td>${formatDate(squad.last_activity_at)}${Number(squad.activity7d) ? `<small>${formatNumber(squad.activity7d)} / 7d</small>` : ""}</td>
          <td><div class="admin-row-actions">
            <button class="admin-row-button" type="button" data-open-squad="${escapeHtml(squad.id)}">${english ? "Open" : "Ouvrir"}</button>
            ${can("social.write") ? `<button class="admin-row-button ${squad.join_open ? "admin-row-button--danger" : ""}" type="button" data-squad-toggle="${escapeHtml(squad.id)}" data-squad-open="${squad.join_open ? "true" : "false"}" data-squad-name="${escapeHtml(squad.name || squad.code)}">${squad.join_open ? tr("close", "Fermer l’accès") : tr("open", "Ouvrir l’accès")}</button>` : ""}
          </div></td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="6">${empty(english ? "No squad found." : "Aucune squad trouvée.")}</td></tr>`;
    renderPagination("#squadsPagination", squads, "social");
    $("#socialActivity").innerHTML = (data.activity24h || []).map(row => `<span class="admin-activity-chip">${escapeHtml(label(row.type))} · ${formatNumber(row.count)}</span>`).join("") || empty(english ? "No squad activity in 24h." : "Aucune activité squad sur 24 h.");
    $("#socialPendingInvites").innerHTML = (data.pendingInvites || []).length
      ? data.pendingInvites.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.invitee_username)}</strong> → ${escapeHtml(item.squad_name)} <small>@${escapeHtml(item.inviter_username)} · ${formatDate(item.created_at)}</small></span><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-squad="${escapeHtml(item.squad_id)}">${english ? "Squad" : "Squad"}</button>${can("social.write") ? `<button class="admin-row-button admin-row-button--danger" type="button" data-cancel-invite="${escapeHtml(item.id)}" data-invite-label="@${escapeHtml(item.invitee_username)} → ${escapeHtml(item.squad_name)}">${english ? "Cancel" : "Annuler"}</button>` : ""}</div></div>`).join("")
      : empty(english ? "No pending invitations." : "Aucune invitation en attente.");
    $("#socialPendingFriends").innerHTML = (data.pendingFriendships || []).length
      ? data.pendingFriendships.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.requester_username)}</strong> → @${escapeHtml(item.addressee_username)}<small>${formatDate(item.created_at)}</small></span><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.requester_id)}">${english ? "From" : "De"}</button><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.addressee_id)}">${english ? "To" : "Vers"}</button></div></div>`).join("")
      : empty(english ? "No pending friend requests." : "Aucune demande d’ami en attente.");
    $("#socialRecentBlocks").innerHTML = (data.recentBlocks || []).length
      ? data.recentBlocks.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.blocker_username)}</strong> → @${escapeHtml(item.blocked_username)}<small>${escapeHtml(item.reason || "—")} · ${formatDate(item.created_at)}</small></span><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.blocker_id)}">${english ? "Blocker" : "Bloqueur"}</button><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.blocked_id)}">${english ? "Blocked" : "Bloqué"}</button></div></div>`).join("")
      : empty(english ? "No recent blocks." : "Aucun blocage récent.");
    if (state.social.selected) {
      try { await selectSquad(state.social.selected, { silent: true }); }
      catch (_) { state.social.selected = null; renderSquadDossierEmpty(); }
    } else {
      renderSquadDossierEmpty();
    }
  }

  function renderSquadDossierEmpty() {
    $("#squadDossier").innerHTML = `<p class="admin-empty">${escapeHtml(tr("squadPick", "Sélectionnez une squad pour voir membres, invitations, souhaits et activité."))}</p>`;
  }

  async function selectSquad(squadId, { silent = false } = {}) {
    state.social.selected = squadId;
    $("#squadsList")?.querySelectorAll("tr[data-squad-id]").forEach(node => {
      node.classList.toggle("is-selected", String(node.dataset.squadId) === String(squadId));
    });
    if (!silent) $("#squadDossier").innerHTML = empty(english ? "Loading squad details…" : "Chargement de la squad…");
    try {
      renderSquadDossier(await adminFetch(`/api/admin/social/squads/${encodeURIComponent(squadId)}`));
    } catch (error) {
      if (!silent) setAlert(error.message || tr("loadFailed"));
      throw error;
    }
  }

  function renderSquadDossier(data) {
    const squad = data.squad || {};
    const owner = data.owner;
    const members = data.members || [];
    const invitations = data.invitations || [];
    const wishlist = data.wishlist || [];
    const activity = data.activity || [];
    const openTone = squad.join_open ? "warning" : "good";
    const stale = !squad.last_activity_at || (Date.now() - new Date(squad.last_activity_at).getTime() > 30 * 24 * 60 * 60 * 1000);
    const riskyOpen = squad.join_open && Number(squad.member_count) >= 8;
    const signals = [];
    if (riskyOpen) signals.push(english ? "Public join is open on a large squad — review before leaving it open." : "L’accès public est ouvert sur une grande squad — à vérifier avant de le laisser ouvert.");
    if (stale) signals.push(english ? "No activity for more than 30 days." : "Aucune activité depuis plus de 30 jours.");
    if (Number(squad.pending_invite_count) > 0) signals.push(english ? `${formatNumber(squad.pending_invite_count)} pending invitation(s).` : `${formatNumber(squad.pending_invite_count)} invitation(s) en attente.`);
    $("#squadDossier").innerHTML = `
      <div class="admin-dossier__toolbar">
        <p class="admin-eyebrow">${english ? "SQUAD DOSSIER" : "FICHE SQUAD"}</p>
        <button class="admin-button admin-button--quiet" type="button" data-close-squad>${english ? "Close" : "Fermer"}</button>
      </div>
      <div class="admin-editor__header">
        <div>
          <h2>${escapeHtml(squad.name || "—")}</h2>
          <p class="admin-editor__id">${escapeHtml(squad.code || "")} · #${escapeHtml(squad.id)}</p>
        </div>
        ${status(squad.join_open ? (english ? "Join open" : "Accès ouvert") : (english ? "Join closed" : "Accès fermé"), openTone)}
      </div>
      <div class="admin-dossier__meta">
        <div class="admin-dossier__chip"><span>${english ? "Visibility" : "Visibilité"}</span><strong>${escapeHtml(label(squad.visibility))}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Owner" : "Créateur"}</span><strong>${owner ? `@${escapeHtml(owner.username)}` : "—"}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Members" : "Membres"}</span><strong>${formatNumber(squad.member_count)} ${english ? "active" : "actifs"}${Number(squad.inactive_member_count) ? ` · ${formatNumber(squad.inactive_member_count)} ${english ? "left" : "partis"}` : ""}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Wishes" : "Souhaits"}</span><strong>${formatNumber(squad.wanted_count)} ${english ? "wanted" : "à trouver"} · ${formatNumber(squad.found_count)} ${english ? "found" : "trouvés"}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Activity" : "Activité"}</span><strong>${formatNumber(squad.activity24h)} / 24h · ${formatNumber(squad.activity7d)} / 7d</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Created" : "Créée"}</span><strong>${formatDate(squad.created_at, false)}</strong></div>
      </div>
      ${signals.map(signal => `<div class="admin-squad-signal">${escapeHtml(signal)}</div>`).join("")}
      <div class="admin-editor__footer">
        ${owner ? `<button class="admin-button admin-button--quiet" type="button" data-open-player="${escapeHtml(owner.id)}">${english ? "Open owner" : "Voir le créateur"}</button>` : ""}
        <button class="admin-button ${squad.join_open ? "admin-button--danger" : ""}" type="button" data-squad-toggle="${escapeHtml(squad.id)}" data-squad-open="${squad.join_open ? "true" : "false"}" data-squad-name="${escapeHtml(squad.name || squad.code)}">${squad.join_open ? tr("close", "Fermer l’accès") : tr("open", "Ouvrir l’accès")}</button>
      </div>
      <section class="admin-editor__section">
        <h3>${english ? "Members" : "Membres"} (${members.length})</h3>
        <div class="admin-status-list">${members.length ? members.map(member => {
          const suspended = member.suspended_until && new Date(member.suspended_until) > new Date();
          const deleted = !!member.deleted_at;
          return `<div class="admin-status-row"><span><strong>@${escapeHtml(member.username)}</strong><small>${escapeHtml(label(member.role))} · ${escapeHtml(label(member.status))}${suspended ? ` · ${english ? "suspended" : "suspendu"}` : ""}${deleted ? ` · ${english ? "deleted" : "supprimé"}` : ""} · ${english ? "active" : "actif"} ${formatDate(member.last_active_at)} · ${english ? "joined" : "depuis"} ${formatDate(member.joined_at, false)}</small></span><button class="admin-row-button" type="button" data-open-player="${escapeHtml(member.user_id)}">${english ? "Player" : "Joueur"}</button></div>`;
        }).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Invitations" : "Invitations"} (${invitations.length})</h3>
        <div class="admin-status-list">${invitations.length ? invitations.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.invitee_username)}</strong><small>@${escapeHtml(item.inviter_username)} · ${escapeHtml(label(item.status))} · ${formatDate(item.created_at)}</small></span>${item.status === "pending" ? (can("social.write") ? `<button class="admin-row-button admin-row-button--danger" type="button" data-cancel-invite="${escapeHtml(item.id)}" data-invite-label="@${escapeHtml(item.invitee_username)}">${english ? "Cancel" : "Annuler"}</button>` : "") : `<button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.invitee_id)}">${english ? "Player" : "Joueur"}</button>`}</div>`).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Wishlist" : "Souhaits"} (${wishlist.length})</h3>
        <div class="admin-status-list">${wishlist.length ? wishlist.map(item => `<div class="admin-status-row"><span><strong>${escapeHtml(item.variant_id)}</strong><small>${escapeHtml(label(item.status))} · @${escapeHtml(item.created_by_username)}${item.assigned_to_username ? ` → @${escapeHtml(item.assigned_to_username)}` : ""}${item.found_by_username ? ` · ${english ? "found by" : "trouvé par"} @${escapeHtml(item.found_by_username)}` : ""}</small></span><strong>${formatDate(item.updated_at)}</strong></div>`).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Recent activity" : "Activité récente"} (${activity.length})</h3>
        <div class="admin-status-list">${activity.length ? activity.map(item => `<div class="admin-status-row"><span><strong>${escapeHtml(label(item.type || item.action))}</strong><small>${item.username ? `@${escapeHtml(item.username)} · ` : ""}${item.action && item.action !== item.type ? `${escapeHtml(label(item.action))} · ` : ""}${item.sprite_id ? `${escapeHtml(item.sprite_id)} · ` : ""}${formatDate(item.created_at)}</small></span><strong></strong></div>`).join("") : empty()}</div>
      </section>`;
  }

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
    $("#adminMetrics").innerHTML = (catalog.metrics || []).map(metric => { const flag = flags.get(metric.id), disabled = flag?.disabled === true; return `<article class="admin-metric"><div class="admin-metric__copy"><strong>${escapeHtml(metric.name || metric.id)}</strong><small>${escapeHtml(disabled ? (english ? "Public display suspended" : "Affichage public suspendu") : (english ? "Public display active" : "Affichage public actif"))}</small>${disabled && flag.reason ? `<small class="admin-metric__reason">${escapeHtml(flag.reason)}</small>` : ""}</div>${can("intelligence.write") ? `<label><input type="checkbox" data-metric-flag="${escapeHtml(metric.id)}" ${disabled ? "checked" : ""}><span></span></label>` : `<em class="admin-metric__ro">${escapeHtml(disabled ? (english ? "Suspended" : "Suspendu") : (english ? "Active" : "Actif"))}</em>`}</article>`; }).join("") || empty();
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
    const deletionStatus = $("#privacyDeletionFilter")?.value || state.privacy?.deletionStatus || "all";
    state.privacy = { ...(state.privacy || {}), deletionStatus };
    if ($("#privacyDeletionFilter")) $("#privacyDeletionFilter").value = deletionStatus;
    const params = new URLSearchParams({ deletionStatus });
    const [data, accessSecurity] = await Promise.all([
      adminFetch(`/api/admin/privacy?${params}`),
      can("admins.manage") ? adminFetch("/api/admin/operators") : Promise.resolve({ operators: [], alerts: [] })
    ]);
    const p = data.privacy || {};
    const s = data.sharing || {};
    const deletions = data.deletions || { items: [], retentionDays: 30, summary: {} };
    const summary = deletions.summary || {};
    $("#privacyKpis").innerHTML = [
      kpi(english ? "Deletion queue" : "File de suppression", formatNumber(p.deletion_requests), `${formatNumber(summary.ready ?? p.ready_for_purge)} ${english ? "ready" : "prêtes"} · ${formatNumber(summary.pending || 0)} ${english ? "in retention" : "en rétention"}`, Number(p.ready_for_purge) ? "warning" : ""),
      kpi(english ? "Retention" : "Rétention", `${formatNumber(p.retentionDays || deletions.retentionDays || 30)} ${english ? "days" : "j"}`, english ? "before permanent purge" : "avant purge définitive"),
      kpi(english ? "Active share links" : "Liens actifs", formatNumber((Number(s.passport_links) || 0) + (Number(s.compare_links) || 0) + (Number(s.friend_invite_links) || 0)), `${formatNumber(s.passport_links)} / ${formatNumber(s.compare_links)} / ${formatNumber(s.friend_invite_links)}`, ((Number(s.passport_links) || 0) + (Number(s.compare_links) || 0) + (Number(s.friend_invite_links) || 0)) ? "" : "good"),
      kpi(english ? "Admin sessions" : "Sessions admin", formatNumber((data.sessions || []).length), `${data.roles?.role || "—"} · ${data.roles?.actor || "—"}`)
    ].join("");
    $("#privacyDeletionMeta").textContent = english
      ? `${formatNumber(summary.total || 0)} total · ${formatNumber((deletions.items || []).length)} shown`
      : `${formatNumber(summary.total || 0)} au total · ${formatNumber((deletions.items || []).length)} affichée(s)`;
    const purgeReadyBtn = $("#privacyPurgeReadyButton");
    if (purgeReadyBtn) purgeReadyBtn.disabled = !(Number(summary.ready ?? p.ready_for_purge) > 0);
    $("#privacyDeletionQueue").innerHTML = (deletions.items || []).length
      ? deletions.items.map((item) => {
        const ready = item.readyForPurge;
        return `<tr>
          <td><strong>@${escapeHtml(item.username || "—")}</strong><small>#${escapeHtml(item.id)} · ${escapeHtml(item.email || "—")}</small></td>
          <td>${formatDate(item.deletedAt)}</td>
          <td><strong>${formatNumber(item.collectionEntries)}</strong><small>${formatNumber(item.activeSquads)} ${english ? "squad(s)" : "squad(s)"}</small></td>
          <td>${ready
            ? status(english ? "Ready" : "Prêt", "warning")
            : status(english ? `${formatNumber(item.daysUntilPurge)}d left` : `${formatNumber(item.daysUntilPurge)} j restants`, "")}</td>
          <td><div class="admin-row-actions">
            ${can("privacy.export") ? `<button class="admin-row-button" type="button" data-privacy-export="${escapeHtml(item.id)}" data-privacy-label="@${escapeHtml(item.username || item.id)}">${english ? "Export" : "Exporter"}</button>` : ""}
            ${can("privacy.restore") ? `<button class="admin-row-button" type="button" data-privacy-restore="${escapeHtml(item.id)}" data-privacy-label="@${escapeHtml(item.username || item.id)}">${english ? "Restore" : "Restaurer"}</button>` : ""}
            ${can("privacy.purge") ? `<button class="admin-row-button ${ready ? "admin-row-button--danger" : ""}" type="button" data-privacy-purge="${escapeHtml(item.id)}" data-privacy-label="@${escapeHtml(item.username || item.id)}" data-privacy-username="${escapeHtml(item.username || "")}" data-privacy-ready="${ready ? "true" : "false"}" data-privacy-volume="${escapeHtml(item.collectionEntries || 0)}">${english ? "Purge" : "Purger"}</button>` : ""}
          </div></td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="5">${empty(english ? "No deletion requests in this filter." : "Aucune demande de suppression pour ce filtre.")}</td></tr>`;
    $("#privacyConsent").innerHTML = (data.consentVersions || []).map(item => `<div class="admin-status-row"><span>${escapeHtml(item.version)}</span><strong>${formatNumber(item.count)}</strong></div>`).join("") || empty();
    $("#privacySharing").innerHTML = [[english ? "Passport links" : "Liens passeport", s.passport_links], [english ? "Comparison links" : "Liens de comparaison", s.compare_links], [english ? "Friend invitation links" : "Liens d’invitation", s.friend_invite_links]].map(([name, value]) => `<div class="admin-status-row"><span>${escapeHtml(name)}</span><strong>${formatNumber(value)}</strong></div>`).join("");
    $("#privacySessions").innerHTML = (data.sessions || []).length
      ? data.sessions.map((item) => {
        const current = item.current || item.publicId === data.roles?.actor?.split(":")[1];
        const meta = [
          item.lastIp || item.createdIp || "—",
          formatDate(item.lastSeenAt || item.createdAt)
        ].join(" · ");
        return `<div class="admin-status-row admin-status-row--session"><div><strong>${escapeHtml(item.actor)}</strong><small>${escapeHtml(meta)}</small></div>${current ? `<em>${escapeHtml(tr("thisSession", "Cette session"))}</em>` : `<button class="admin-button admin-button--quiet" type="button" data-revoke-session="${escapeHtml(item.publicId)}">${escapeHtml(tr("revokeSession", "Révoquer"))}</button>`}</div>`;
      }).join("")
      : empty();
    const operatorsNode = $("#adminOperators");
    const postureNode = $("#adminAccessPosture");
    if (postureNode) {
      const namedCount = (accessSecurity.operators || []).filter((item) => item.active).length;
      const legacy = state.session?.authMode === "legacy_global";
      postureNode.innerHTML = `<div class="admin-access-posture__state ${legacy ? "is-warning" : "is-good"}"><span class="admin-access-posture__icon" aria-hidden="true">${legacy ? "!" : "✓"}</span><div><strong>${legacy ? (english ? "Transition still in progress" : "Transition encore en cours") : (english ? "Named access in use" : "Accès nominatif en service")}</strong><small>${legacy ? (english ? "Create and test a named account before removing the global secret." : "Créez et testez un compte nominatif avant de retirer le secret global.") : (english ? "Each admin session is attributable to a named operator." : "Chaque session admin est attribuable à un opérateur identifié.")}</small></div></div><div class="admin-access-posture__metrics"><span><b>${formatNumber(namedCount)}</b>${english ? " active account(s)" : " compte(s) actif(s)"}</span><span class="${state.session?.mfaConfigured ? "is-good" : "is-warning"}">${state.session?.mfaConfigured ? (english ? "MFA enabled" : "MFA actif") : (english ? "MFA to configure" : "MFA à configurer")}</span></div>`;
    }
    if (operatorsNode) {
      operatorsNode.innerHTML = (accessSecurity.operators || []).length ? accessSecurity.operators.map((item) => {
        const current = item.id === state.session?.operatorId;
        const initials = String(item.displayName || item.username || "A").trim().slice(0, 2).toUpperCase();
        const lastLogin = item.lastLoginAt ? `${english ? "Last sign-in" : "Dernière connexion"} ${formatDate(item.lastLoginAt)}` : (english ? "Never signed in" : "Jamais connecté");
        return `<div class="admin-operator-card ${item.active ? "" : "is-disabled"}"><div class="admin-operator-card__identity"><span class="admin-operator-card__avatar" aria-hidden="true">${escapeHtml(initials)}</span><div><strong>${escapeHtml(item.displayName)}</strong><small>@${escapeHtml(item.username)} · ${escapeHtml(item.role)}</small></div></div><div class="admin-operator-card__meta"><span>${current ? (english ? "Current session" : "Session actuelle") : (item.active ? (english ? "Active" : "Actif") : (english ? "Disabled" : "Désactivé"))}</span><small>${lastLogin}</small><small>${english ? "Secret rotated" : "Secret renouvelé"} ${formatDate(item.secretRotatedAt, false)}</small></div><div class="admin-operator-card__actions"><button class="admin-row-button" type="button" data-operator-rotate="${escapeHtml(item.id)}" data-operator-name="${escapeHtml(item.displayName)}">${english ? "Rotate secret" : "Tourner le secret"}</button><button class="admin-row-button ${item.active ? "admin-row-button--danger" : ""}" type="button" data-operator-toggle="${escapeHtml(item.id)}" data-operator-active="${item.active ? "true" : "false"}" data-operator-name="${escapeHtml(item.displayName)}" ${current && item.active ? "disabled title=\"Close this session first\"" : ""}>${item.active ? (english ? "Disable" : "Désactiver") : (english ? "Enable" : "Réactiver")}</button></div></div>`;
      }).join("") : empty(english ? "No named administrator yet. Create one before retiring the global secret." : "Aucun administrateur nominatif. Créez-en un avant de retirer le secret global.");
    }
    const alertsNode = $("#adminSecurityAlerts");
    if (alertsNode) {
      alertsNode.innerHTML = (accessSecurity.alerts || []).length ? accessSecurity.alerts.map((alert) => `<div class="admin-status-row admin-status-row--alert"><div><strong>${escapeHtml(alert.kind === "unusual_login" ? (english ? "Unusual connection" : "Connexion inhabituelle") : label(alert.kind))} <small>${escapeHtml(alert.username ? `@${alert.username}` : "—")}</small></strong><small>${formatDate(alert.created_at)}${alert.details?.ip ? ` · ${escapeHtml(alert.details.ip)}` : ""}${alert.acknowledged_at ? ` · ${english ? "reviewed" : "traitée"}` : ""}</small></div>${alert.acknowledged_at ? status(english ? "Reviewed" : "Traitée", "good") : `<button class="admin-row-button" type="button" data-security-alert-ack="${escapeHtml(alert.id)}">${english ? "Acknowledge" : "Traiter"}</button>`}</div>`).join("") : empty(english ? "No unusual connection alert." : "Aucune alerte de connexion inhabituelle.");
    }
    const auditPanel = $(".admin-audit-panel");
    if (auditPanel) auditPanel.hidden = !can("audit.read");
    if (can("audit.read")) await loadAudit();
  }

  function openAdminOperatorDialog({ operatorId = null, name = "" } = {}) {
    state.adminOperator = { operatorId, name };
    const rotating = !!operatorId;
    $("#adminOperatorTitle").textContent = rotating ? (english ? "Rotate an admin secret" : "Tourner un secret administrateur") : (english ? "Create an admin account" : "Créer un compte administrateur");
    $("#adminOperatorSummary").textContent = rotating ? (english ? `Every active session for ${name} will be revoked.` : `Toutes les sessions actives de ${name} seront révoquées.`) : (english ? "Use a unique identifier and a secret known only by this operator." : "Utilisez un identifiant unique et un secret connu uniquement de cet administrateur.");
    ["#adminOperatorUsernameField", "#adminOperatorDisplayNameField", "#adminOperatorRoleField"].forEach((selector) => { $(selector).hidden = rotating; });
    $("#adminOperatorUsername").value = "";
    $("#adminOperatorDisplayName").value = "";
    $("#adminOperatorRole").value = "owner";
    $("#adminOperatorPassword").value = "";
    $("#adminOperatorPasswordConfirm").value = "";
    $("#adminOperatorReason").value = "";
    $("#adminOperatorMfa").value = "";
    $("#adminOperatorPasswordLabel").textContent = rotating ? (english ? "Replacement secret" : "Secret de remplacement") : (english ? "Initial secret" : "Secret initial");
    $("#adminOperatorSubmit").textContent = rotating ? (english ? "Rotate and revoke sessions" : "Tourner et révoquer les sessions") : (english ? "Create account" : "Créer le compte");
    $("#adminOperatorError").hidden = true;
    $("#adminOperatorDialog").showModal();
    requestAnimationFrame(() => $(rotating ? "#adminOperatorPassword" : "#adminOperatorUsername").focus());
  }

  function closeAdminOperatorDialog() {
    if ($("#adminOperatorDialog")?.open) $("#adminOperatorDialog").close();
    state.adminOperator = null;
  }

  async function submitAdminOperatorDialog(event) {
    event.preventDefault();
    const operation = state.adminOperator;
    if (!operation) return;
    const errorNode = $("#adminOperatorError");
    const password = $("#adminOperatorPassword").value;
    const reason = $("#adminOperatorReason").value.trim();
    const mfaCode = readStepUpCode("#adminOperatorMfa");
    if (password.length < 12 || password !== $("#adminOperatorPasswordConfirm").value || !reason || !assertStepUp(mfaCode, errorNode)) {
      if (!errorNode.textContent) errorNode.textContent = password !== $("#adminOperatorPasswordConfirm").value ? (english ? "The two secrets do not match." : "Les deux secrets ne correspondent pas.") : (english ? "A secret of at least 12 characters and a justification are required." : "Un secret d’au moins 12 caractères et une justification sont requis.");
      errorNode.hidden = false;
      return;
    }
    const creating = !operation.operatorId;
    const payload = creating
      ? { username: $("#adminOperatorUsername").value.trim(), displayName: $("#adminOperatorDisplayName").value.trim(), role: $("#adminOperatorRole").value, password, reason, totp: mfaCode || undefined }
      : { password, reason, totp: mfaCode || undefined };
    const submit = $("#adminOperatorSubmit");
    submit.disabled = true;
    try {
      await adminFetch(creating ? "/api/admin/operators" : `/api/admin/operators/${encodeURIComponent(operation.operatorId)}/rotate-secret`, { method: "POST", headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) }, body: JSON.stringify(payload) });
      closeAdminOperatorDialog();
      setNotice(creating ? (english ? "Named admin account created." : "Compte administrateur nominatif créé.") : (english ? "Secret rotated and sessions revoked." : "Secret renouvelé et sessions révoquées."));
      await loadTab("privacy", true);
    } catch (error) { errorNode.textContent = error.message || tr("saveFailed"); errorNode.hidden = false; }
    finally { submit.disabled = false; }
  }

  async function toggleAdminOperator(button) {
    const active = button.dataset.operatorActive !== "true";
    const reason = await requestReason(active ? (english ? "Why reactivate this account?" : "Pourquoi réactiver ce compte ?") : (english ? "Why disable this account?" : "Pourquoi désactiver ce compte ?"));
    if (!reason) return;
    try {
      await adminFetch(`/api/admin/operators/${encodeURIComponent(button.dataset.operatorToggle)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active, reason }) });
      setNotice(active ? (english ? "Admin account reactivated." : "Compte administrateur réactivé.") : (english ? "Admin account disabled and sessions revoked." : "Compte administrateur désactivé et sessions révoquées."));
      await loadTab("privacy", true);
    } catch (error) { setAlert(error.message || tr("saveFailed")); }
  }

  async function acknowledgeSecurityAlert(button) {
    try {
      await adminFetch(`/api/admin/security-alerts/${encodeURIComponent(button.dataset.securityAlertAck)}/acknowledge`, { method: "POST" });
      setNotice(english ? "Security alert acknowledged." : "Alerte de sécurité traitée.");
      await loadTab("privacy", true);
    } catch (error) { setAlert(error.message || tr("saveFailed")); }
  }

  function friendlyAuditAction(action) {
    const labels = {
      "privacy.export_generated": english ? "Data export" : "Export de données",
      "privacy.accounts_purged": english ? "Accounts purged" : "Comptes purgés",
      "privacy.account_purged": english ? "Account purged" : "Compte purgé",
      "privacy.account_force_purged": english ? "Account force-purged" : "Compte purgé (forcé)",
      "privacy.account_restored": english ? "Account restored" : "Compte restauré",
      "privacy.share_links_revoked": english ? "Share links revoked" : "Liens de partage révoqués",
      "graph.metric_suspended": english ? "Metric suspended" : "Métrique suspendue",
      "graph.metric_restored": english ? "Metric restored" : "Métrique rétablie",
      "notification.queue_process_requested": english ? "Queue processing requested" : "Traitement de file demandé",
      "notification.queue_processed": english ? "Queue processed" : "File traitée",
      "catalog.updated": english ? "Catalog updated" : "Catalogue modifié",
      "event.updated": english ? "Event updated" : "Événement modifié",
      "news.updated": english ? "News updated" : "Actualité modifiée",
      "player.suspended": english ? "Player suspended" : "Joueur suspendu",
      "player.unsuspended": english ? "Player reactivated" : "Joueur réactivé"
    };
    return labels[action] || String(action || "—").replace(/[._]/g, " ");
  }

  function auditValue(value) {
    if (value == null || value === "") return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function auditQuery() {
    const audit = state.audit;
    const params = new URLSearchParams({ page: String(audit.page), pageSize: String(audit.pageSize) });
    [["q", audit.q], ["action", audit.action], ["targetType", audit.targetType], ["from", audit.from], ["to", audit.to]].forEach(([key, value]) => { if (value) params.set(key, value); });
    return params;
  }

  function auditChangeSummary(item) {
    const changes = item?.details?.changes;
    const fields = changes && typeof changes === "object" ? Object.keys(changes) : (Array.isArray(item?.details?.fields) ? item.details.fields : []);
    return fields.length ? fields.slice(0, 2).join(", ") + (fields.length > 2 ? ` +${fields.length - 2}` : "") : "—";
  }

  function renderAuditRange() {
    $$('[data-audit-range]').forEach((button) => button.classList.toggle("is-active", button.dataset.auditRange === state.audit.range));
  }

  function isoDateOffset(days) {
    const value = new Date();
    value.setDate(value.getDate() + days);
    return value.toISOString().slice(0, 10);
  }

  function setAuditRange(range) {
    const today = isoDateOffset(0);
    const starts = { today, "7d": isoDateOffset(-6), "30d": isoDateOffset(-29) };
    state.audit.range = range;
    state.audit.from = starts[range] || "";
    state.audit.to = starts[range] ? today : "";
    state.audit.page = 1;
    if ($("#auditFrom")) $("#auditFrom").value = state.audit.from;
    if ($("#auditTo")) $("#auditTo").value = state.audit.to;
    renderAuditRange();
    loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
  }

  function renderAuditFacets(facets = {}) {
    const select = $("#auditActionFilter"), target = $("#auditTargetFilter");
    if (select) {
      const value = state.audit.action;
      select.innerHTML = `<option value="">${english ? "All actions" : "Toutes les actions"}</option>${(facets.actions || []).map((item) => `<option value="${escapeHtml(item.action)}">${escapeHtml(friendlyAuditAction(item.action))} · ${formatNumber(item.count)}</option>`).join("")}`;
      select.value = value;
    }
    if (target) {
      const value = state.audit.targetType;
      target.innerHTML = `<option value="">${english ? "All targets" : "Toutes les cibles"}</option>${(facets.targetTypes || []).map((item) => `<option value="${escapeHtml(item.target_type)}">${escapeHtml(label(item.target_type))} · ${formatNumber(item.count)}</option>`).join("")}`;
      target.value = value;
    }
  }

  async function loadAudit() {
    const data = await adminFetch(`/api/admin/audit?${auditQuery()}`);
    state.audit.data = data;
    renderAuditFacets(data.facets);
    const total = Number(data.total) || 0;
    const shown = (data.items || []).length;
    const changes = (data.items || []).filter((item) => auditChangeSummary(item) !== "—").length;
    const actions = new Set((data.items || []).map((item) => item.action)).size;
    $("#auditMeta").textContent = english
      ? `${formatNumber(total)} recorded action(s) · ${formatNumber(shown)} displayed`
      : `${formatNumber(total)} action(s) enregistrée(s) · ${formatNumber(shown)} affichée(s)`;
    $("#auditPulse").textContent = english
      ? `${formatNumber(changes)} change(s) visible · ${formatNumber(actions)} action type(s)`
      : `${formatNumber(changes)} modification(s) visible(s) · ${formatNumber(actions)} type(s) d’action`;
    renderAuditRange();
    $("#auditList").innerHTML = shown
      ? data.items.map((item) => {
        const change = auditChangeSummary(item);
        return `<tr><td><code>${escapeHtml(item.actor || "—")}</code></td><td><strong>${escapeHtml(friendlyAuditAction(item.action))}</strong><small>${escapeHtml(item.action || "")}</small></td><td><strong>${escapeHtml(label(item.target_type))}</strong><small>${escapeHtml(item.target_id || "—")}</small></td><td>${escapeHtml(item.justification || "—")}</td><td><span class="admin-audit-change ${change === "—" ? "admin-audit-change--none" : ""}">${escapeHtml(change)}</span></td><td>${formatDate(item.created_at)}</td><td><button class="admin-audit-detail-button" type="button" data-audit-detail="${escapeHtml(item.id)}">${english ? "Inspect" : "Détail"}</button></td></tr>`;
      }).join("")
      : `<tr><td colspan="7">${empty(english ? "No audit action matches these filters." : "Aucune action ne correspond à ces filtres.")}</td></tr>`;
    const previousDisabled = Number(data.page) <= 1;
    const nextDisabled = !data.hasMore;
    $("#auditPagination").innerHTML = `<span>${english ? `Page ${formatNumber(data.page)} of ${formatNumber(Math.max(1, Math.ceil(total / Math.max(1, data.pageSize))))}` : `Page ${formatNumber(data.page)} sur ${formatNumber(Math.max(1, Math.ceil(total / Math.max(1, data.pageSize))))}`}</span><button class="admin-button admin-button--quiet" type="button" data-audit-page="previous" ${previousDisabled ? "disabled" : ""}>${english ? "Previous" : "Précédent"}</button><button class="admin-button admin-button--quiet" type="button" data-audit-page="next" ${nextDisabled ? "disabled" : ""}>${english ? "Next" : "Suivant"}</button>`;
  }

  function openAuditDetail(id) {
    const item = (state.audit.data?.items || []).find((entry) => String(entry.id) === String(id));
    if (!item) return;
    const details = item.details && typeof item.details === "object" ? item.details : {};
    const changes = details.changes && typeof details.changes === "object" ? details.changes : null;
    const metadata = [[english ? "Actor" : "Acteur", item.actor], [english ? "Action" : "Action", friendlyAuditAction(item.action)], [english ? "Target" : "Cible", `${label(item.target_type)} · ${item.target_id || "—"}`], [english ? "Reason" : "Justification", item.justification], [english ? "Date" : "Date", formatDate(item.created_at)]];
    const metadataBlock = `<section class="admin-audit-detail__block"><h3>${english ? "Trace" : "Trace"}</h3><dl>${metadata.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(auditValue(value))}</dd>`).join("")}</dl></section>`;
    const changesBlock = changes && Object.keys(changes).length ? `<section class="admin-audit-detail__block"><h3>${english ? "Before / after" : "Avant / après"}</h3><div class="admin-audit-diff"><div class="admin-audit-diff__header">${english ? "Field" : "Champ"}</div><div class="admin-audit-diff__header admin-audit-diff__header--before">${english ? "Before" : "Avant"}</div><div class="admin-audit-diff__header admin-audit-diff__header--after">${english ? "After" : "Après"}</div>${Object.entries(changes).map(([field, change]) => `<div class="admin-audit-diff__field">${escapeHtml(field)}</div><div class="admin-audit-diff__before">${escapeHtml(auditValue(change?.before))}</div><div class="admin-audit-diff__after">${escapeHtml(auditValue(change?.after))}</div>`).join("")}</div></section>` : "";
    const operational = Object.fromEntries(Object.entries(details).filter(([key]) => key !== "changes"));
    const operationalBlock = Object.keys(operational).length ? `<section class="admin-audit-detail__block"><h3>${english ? "Operational details" : "Détails opérationnels"}</h3><dl>${Object.entries(operational).map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(auditValue(value))}</dd>`).join("")}</dl></section>` : "";
    $("#auditDetailTitle").textContent = friendlyAuditAction(item.action);
    $("#auditDetailMeta").textContent = `${item.actor || "—"} · ${formatDate(item.created_at)}`;
    $("#auditDetailBody").innerHTML = metadataBlock + changesBlock + operationalBlock;
    $("#auditDetailDialog")?.showModal();
  }

  function closeAuditDetail() { $("#auditDetailDialog")?.close(); }

  async function exportAudit() {
    try {
      const response = await fetch(`/api/admin/audit/export?${auditQuery()}`, { credentials: "same-origin", headers: { Accept: "text/csv" } });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || tr("saveFailed"));
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = "sprite-index-audit.csv"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(english ? "Audit export downloaded." : "Export du journal téléchargé.");
    } catch (error) { setAlert(error.message || tr("saveFailed")); }
  }

  function openPrivacyPurgeDialog({ userId = null, label = "", username = "", ready = true, batch = false, volume = 0 } = {}) {
    state.privacyPurge = { userId, label, username: username || String(label || "").replace(/^@/, ""), ready, batch, volume };
    $("#privacyPurgeTitle").textContent = batch
      ? (english ? "Purge ready accounts" : "Purger les comptes prêts")
      : (english ? "Purge account permanently" : "Purger définitivement le compte");
    $("#privacyPurgeSummary").textContent = batch
      ? (english ? "Every account past the retention window will be deleted permanently." : "Tous les comptes hors délai de rétention seront définitivement supprimés.")
      : `${label || `#${userId}`}${volume ? ` · ${formatNumber(volume)} ${english ? "collection entries" : "entrées collection"}` : ""}`;
    $("#privacyPurgeImpact").textContent = english
      ? "This cannot be undone. Export the account first if you still need a GDPR archive."
      : "Cette action est irréversible. Exportez d’abord le compte si une archive RGPD est encore nécessaire.";
    $("#privacyPurgeForceField").hidden = batch || ready;
    $("#privacyPurgeForce").checked = false;
    $("#privacyPurgeForceLabel").textContent = english
      ? "Force purge before the retention window ends"
      : "Forcer la purge avant la fin du délai de rétention";
    const confirmField = $("#privacyPurgeConfirmField");
    confirmField.hidden = batch;
    $("#privacyPurgeConfirm").value = "";
    $("#privacyPurgeConfirmLabel").textContent = english
      ? `Type ${state.privacyPurge.username || "username"} to confirm`
      : `Tapez ${state.privacyPurge.username || "le username"} pour confirmer`;
    $("#privacyPurgeReason").value = "";
    if ($("#privacyPurgeMfa")) $("#privacyPurgeMfa").value = "";
    $("#privacyPurgeError").hidden = true;
    applyAuthz();
    $("#privacyPurgeDialog").showModal();
    $("#privacyPurgeReason").focus();
  }

  function closePrivacyPurgeDialog() {
    const dialog = $("#privacyPurgeDialog");
    if (dialog?.open) dialog.close();
    state.privacyPurge = null;
  }

  async function submitPrivacyPurge(event) {
    event.preventDefault();
    const operation = state.privacyPurge;
    if (!operation) return;
    const errorNode = $("#privacyPurgeError");
    const reasonValue = $("#privacyPurgeReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    if (!operation.batch) {
      const expected = String(operation.username || "").trim().toLowerCase();
      const typed = $("#privacyPurgeConfirm").value.trim().toLowerCase();
      if (!expected || typed !== expected) {
        errorNode.textContent = english ? "Confirmation username does not match." : "Le username de confirmation ne correspond pas.";
        errorNode.hidden = false;
        return;
      }
    }
    const force = !operation.batch && !operation.ready && $("#privacyPurgeForce").checked;
    if (!operation.batch && !operation.ready && !force) {
      errorNode.textContent = english
        ? "This account is still inside the retention window. Enable force purge or wait."
        : "Ce compte est encore dans le délai de rétention. Cochez la purge forcée ou attendez.";
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyPurgeMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyPurgeSubmit");
    submit.disabled = true;
    try {
      const payload = { reason: reasonValue, force, totp: mfaCode || undefined };
      if (operation.userId) payload.userId = Number(operation.userId);
      else payload.limit = 25;
      const result = await adminFetch("/api/admin/privacy/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) },
        body: JSON.stringify(payload)
      });
      closePrivacyPurgeDialog();
      setNotice(english
        ? `${formatNumber(result.count || 0)} account(s) purged.`
        : `${formatNumber(result.count || 0)} compte(s) purgé(s).`);
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openPrivacyExportDialog({ userId = null, label = "" } = {}) {
    state.privacyExport = { userId, preview: null };
    $("#privacyExportTarget").value = userId ? String(userId) : ($("#privacyExportSearch")?.value || "");
    $("#privacyExportReason").value = "";
    if ($("#privacyExportMfa")) $("#privacyExportMfa").value = "";
    $("#privacyExportSummary").textContent = label
      ? (english ? `Export personal data for ${label}.` : `Exporter les données personnelles de ${label}.`)
      : (english ? "Generate an administrative JSON export for a GDPR request or internal review." : "Génère un JSON administratif pour une demande RGPD ou un contrôle interne.");
    $("#privacyExportPreview").hidden = true;
    $("#privacyExportPreview").textContent = "";
    $("#privacyExportError").hidden = true;
    applyAuthz();
    $("#privacyExportDialog").showModal();
    (userId ? $("#privacyExportReason") : $("#privacyExportTarget")).focus();
    if (userId) previewPrivacyExportTarget().catch(() => {});
  }

  function closePrivacyExportDialog() {
    const dialog = $("#privacyExportDialog");
    if (dialog?.open) dialog.close();
    state.privacyExport = null;
  }

  async function resolvePrivacyExportUserId(raw) {
    const value = String(raw || "").trim().replace(/^#/, "");
    if (!value) throw new Error(english ? "Account is required." : "Le compte est requis.");
    const data = await adminFetch(`/api/admin/privacy/lookup?q=${encodeURIComponent(value)}`);
    const items = data.items || [];
    if (!items.length) throw new Error(english ? "No account found." : "Aucun compte trouvé.");
    if (items.length === 1 || /^\d+$/.test(value)) return items[0];
    const exact = items.find((item) => String(item.username || "").toLowerCase() === value.toLowerCase());
    if (exact) return exact;
    throw new Error(english ? "Multiple accounts match. Use the numeric id." : "Plusieurs comptes correspondent. Utilisez l’identifiant numérique.");
  }

  async function previewPrivacyExportTarget() {
    const preview = $("#privacyExportPreview");
    const account = await resolvePrivacyExportUserId($("#privacyExportTarget").value);
    state.privacyExport = { ...(state.privacyExport || {}), userId: account.id, preview: account };
    preview.hidden = false;
    preview.textContent = english
      ? `@${account.username} · #${account.id}${account.deletedAt ? " · deleted" : ""} · ${formatNumber(account.collectionEntries)} entries · ${formatNumber(account.activeSquads)} squad(s)`
      : `@${account.username} · #${account.id}${account.deletedAt ? " · supprimé" : ""} · ${formatNumber(account.collectionEntries)} entrées · ${formatNumber(account.activeSquads)} squad(s)`;
    return account;
  }

  async function submitPrivacyExport(event) {
    event.preventDefault();
    const errorNode = $("#privacyExportError");
    const reasonValue = $("#privacyExportReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyExportMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyExportSubmit");
    submit.disabled = true;
    try {
      const account = state.privacyExport?.preview?.id
        ? state.privacyExport.preview
        : await previewPrivacyExportTarget();
      const params = new URLSearchParams({ reason: reasonValue });
      const payload = await adminFetch(`/api/admin/privacy/export/${encodeURIComponent(account.id)}?${params}`, {
        headers: { ...stepUpHeaders(mfaCode) }
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `sprite-index_admin_export_${account.id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      closePrivacyExportDialog();
      setNotice(english ? `Export downloaded for @${account.username}.` : `Export téléchargé pour @${account.username}.`);
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openPrivacyRestoreDialog(button) {
    state.privacyRestore = { id: button.dataset.privacyRestore, label: button.dataset.privacyLabel || "" };
    $("#privacyRestoreSummary").textContent = state.privacyRestore.label;
    $("#privacyRestoreReason").value = "";
    if ($("#privacyRestoreMfa")) $("#privacyRestoreMfa").value = "";
    $("#privacyRestoreError").hidden = true;
    applyAuthz();
    $("#privacyRestoreDialog").showModal();
    $("#privacyRestoreReason").focus();
  }

  function closePrivacyRestoreDialog() {
    const dialog = $("#privacyRestoreDialog");
    if (dialog?.open) dialog.close();
    state.privacyRestore = null;
  }

  async function submitPrivacyRestore(event) {
    event.preventDefault();
    const operation = state.privacyRestore;
    if (!operation) return;
    const errorNode = $("#privacyRestoreError");
    const reasonValue = $("#privacyRestoreReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyRestoreMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyRestoreSubmit");
    submit.disabled = true;
    try {
      const result = await adminFetch("/api/admin/privacy/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) },
        body: JSON.stringify({ userId: Number(operation.id), reason: reasonValue, totp: mfaCode || undefined })
      });
      closePrivacyRestoreDialog();
      setNotice(english
        ? `Account @${result.user?.username || operation.label} restored.`
        : `Compte @${result.user?.username || operation.label} restauré.`);
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openPrivacyRevokeLinksDialog() {
    $("#privacyRevokeLinksReason").value = "";
    if ($("#privacyRevokeLinksMfa")) $("#privacyRevokeLinksMfa").value = "";
    $("#privacyRevokeLinksError").hidden = true;
    applyAuthz();
    $("#privacyRevokeLinksDialog").showModal();
    $("#privacyRevokeLinksReason").focus();
  }

  function closePrivacyRevokeLinksDialog() {
    const dialog = $("#privacyRevokeLinksDialog");
    if (dialog?.open) dialog.close();
  }

  async function submitPrivacyRevokeLinks(event) {
    event.preventDefault();
    const errorNode = $("#privacyRevokeLinksError");
    const reasonValue = $("#privacyRevokeLinksReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const mfaCode = readStepUpCode("#privacyRevokeLinksMfa");
    if (!assertStepUp(mfaCode, errorNode)) return;
    errorNode.hidden = true;
    const submit = $("#privacyRevokeLinksSubmit");
    submit.disabled = true;
    try {
      const result = await adminFetch("/api/admin/privacy/revoke-share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...stepUpHeaders(mfaCode) },
        body: JSON.stringify({ reason: reasonValue, totp: mfaCode || undefined })
      });
      closePrivacyRevokeLinksDialog();
      const revoked = result.revoked || {};
      setNotice(english
        ? `Revoked ${formatNumber(revoked.passportLinks)} passport, ${formatNumber(revoked.compareLinks)} compare, ${formatNumber(revoked.friendInviteLinks)} invite link(s).`
        : `Révoqué ${formatNumber(revoked.passportLinks)} passeport(s), ${formatNumber(revoked.compareLinks)} comparaison(s), ${formatNumber(revoked.friendInviteLinks)} invitation(s).`);
      await loadTab("privacy", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
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

  async function handleReportAction(button) {
    const action = button.dataset.reportAction;
    const suspend = button.dataset.reportSuspend === "true";
    const openReports = Math.max(1, Number(button.dataset.openReports) || 1);
    state.reportDecision = {
      id: button.dataset.reportId,
      action,
      suspend,
      reportedId: button.dataset.reportedId,
      reportedName: button.dataset.reportedName || "player",
      openReports
    };
    $("#reportDecisionPriority").value = button.dataset.reportPriority || "normal";
    $("#reportDecisionInternalNote").value = button.dataset.reportAdminNotes || "";
    const dismissing = action === "dismissed";
    $("#reportDecisionTitle").textContent = suspend
      ? (english ? "Resolve and suspend" : "Résoudre et suspendre")
      : dismissing
        ? (english ? "Dismiss report" : "Classer le signalement")
        : (english ? "Resolve report" : "Résoudre le signalement");
    $("#reportDecisionSummary").textContent = suspend
      ? (english
        ? `Close the report on @${state.reportDecision.reportedName} and apply an administrative suspension.`
        : `Clôturez le signalement sur @${state.reportDecision.reportedName} et appliquez une suspension administrative.`)
        : (english
        ? `Record the moderation decision for @${state.reportDecision.reportedName}.`
        : `Documentez la décision de modération pour @${state.reportDecision.reportedName}.`);
    $("#reportDecisionImpact").hidden = !suspend;
    $("#reportDecisionImpact").textContent = english
      ? "Active sessions will be revoked immediately. Related open reports can be closed in the same decision."
      : "Les sessions actives seront immédiatement révoquées. Les autres signalements ouverts peuvent être clôturés dans la même décision.";
    $("#reportDecisionDurationField").hidden = !suspend;
    $("#reportDecisionCustomField").hidden = true;
    $("#reportDecisionDuration").value = "24";
    $("#reportDecisionUntil").value = "";
    $("#reportDecisionRelatedField").hidden = openReports <= 1;
    $("#reportDecisionCloseRelated").checked = openReports > 1;
    $("#reportDecisionCloseRelatedLabel").textContent = english
      ? `Also close the other ${Math.max(0, openReports - 1)} open report(s) on this account`
      : `Classer aussi les ${Math.max(0, openReports - 1)} autre(s) signalement(s) ouvert(s) sur ce compte`;
    $("#reportDecisionReason").value = "";
    $("#reportDecisionReasonLabel").textContent = suspend
      ? (english ? "Resolution / suspension reason" : "Motif de résolution / suspension")
      : (english ? "Decision note" : "Note de décision");
    $("#reportDecisionSubmit").textContent = suspend
      ? (english ? "Confirm resolve + suspend" : "Confirmer résoudre + suspendre")
      : dismissing
        ? (english ? "Confirm dismissal" : "Confirmer le classement")
        : (english ? "Confirm resolution" : "Confirmer la résolution");
    $("#reportDecisionSubmit").classList.toggle("admin-button--danger", suspend || dismissing);
    $("#reportDecisionError").hidden = true;
    $("#reportDecisionDialog").showModal();
    $("#reportDecisionReason").focus();
  }

  function closeReportDecisionDialog() {
    const dialog = $("#reportDecisionDialog");
    if (dialog?.open) dialog.close();
    state.reportDecision = null;
  }

  async function submitReportDecision(event) {
    event.preventDefault();
    if (!state.reportDecision) return;
    const operation = { ...state.reportDecision };
    const resolution = $("#reportDecisionReason").value.trim();
    const errorNode = $("#reportDecisionError");
    if (!resolution) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      $("#reportDecisionReason").focus();
      return;
    }
    const payload = {
      status: operation.action,
      resolution,
      priority: $("#reportDecisionPriority").value,
      adminNotes: $("#reportDecisionInternalNote").value.trim(),
      closeRelatedOpenReports: !$("#reportDecisionRelatedField").hidden && $("#reportDecisionCloseRelated").checked
    };
    if (operation.suspend) {
      payload.suspend = true;
      const duration = $("#reportDecisionDuration").value;
      if (duration === "custom") {
        const custom = new Date($("#reportDecisionUntil").value);
        if (Number.isNaN(custom.getTime()) || custom <= new Date()) {
          errorNode.textContent = english ? "Choose a future end date." : "Choisissez une date de fin future.";
          errorNode.hidden = false;
          $("#reportDecisionUntil").focus();
          return;
        }
        payload.until = custom.toISOString();
      } else {
        payload.until = new Date(Date.now() + Number(duration) * 60 * 60 * 1000).toISOString();
      }
    }
    const submit = $("#reportDecisionSubmit");
    submit.disabled = true;
    try {
      const result = await adminFetch(`/api/admin/reports/${encodeURIComponent(operation.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      closeReportDecisionDialog();
      const closed = Number(result?.closedRelatedReports || 0);
      if (operation.suspend) {
        setNotice(english
          ? `Report resolved and @${operation.reportedName} suspended.${closed ? ` ${formatNumber(closed)} related report(s) closed.` : ""}`
          : `Signalement résolu et @${operation.reportedName} suspendu.${closed ? ` ${formatNumber(closed)} signalement(s) lié(s) classé(s).` : ""}`);
      } else if (closed) {
        setNotice(english
          ? `Decision recorded. ${formatNumber(closed)} related report(s) closed.`
          : `Décision enregistrée. ${formatNumber(closed)} signalement(s) lié(s) classé(s).`);
      } else {
        setNotice(english ? "Decision recorded." : "Décision enregistrée.");
      }
      await loadTab("players", true);
      if (state.players.selected || operation.reportedId) {
        await selectPlayer(state.players.selected || operation.reportedId, { silent: true });
      }
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  async function handleReportAppeal(button) {
    const appealStatus = button.dataset.reportAppeal;
    const prompt = appealStatus === "received"
      ? (english ? "Appeal details" : "Détails du recours")
      : (english ? "Decision reason" : "Motif de la décision");
    const reason = await requestReason(prompt);
    if (!reason) return;
    try {
      await adminFetch(`/api/admin/reports/${encodeURIComponent(button.dataset.reportId)}/appeal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appealStatus,
          appealMessage: appealStatus === "received" ? reason.trim() : undefined,
          resolution: appealStatus === "received" ? undefined : reason.trim(),
          reason: reason.trim()
        })
      });
      setNotice(english ? "Appeal history updated." : "Historique de recours mis à jour.");
      await loadTab("players", true);
      if (state.players.selected) await selectPlayer(state.players.selected, { silent: true });
    } catch (error) { setAlert(error.message || tr("saveFailed")); }
  }
  async function saveCatalogForm(form) {
    const data = Object.fromEntries(new FormData(form));
    data.isReleased = data.isReleased === "true";
    if (!data.lastVerifiedAt) data.lastVerifiedAt = "";
    const id = state.catalog.selected;
    if (!id) return;
    await request(`/api/admin/catalog/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: data, reason: data.reason })
    }, { refresh: "catalog" });
    await selectCatalog(id);
  }

  async function setCatalogWorkflow(button) {
    const reason = await requestReason(english ? "Why change this editorial status?" : "Pourquoi changer ce statut éditorial ?");
    if (!reason) return;
    const result = await request(`/api/admin/catalog/${encodeURIComponent(button.dataset.spriteId)}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editorialStatus: button.dataset.catalogWorkflow, reason }) }, { refresh: "catalog" });
    if (result) await selectCatalog(button.dataset.spriteId);
  }

  async function rollbackCatalogHistory(button) {
    const reason = await requestReason(english ? "Why restore this previous catalog value?" : "Pourquoi restaurer cette valeur précédente ?");
    if (!reason) return;
    const result = await request(`/api/admin/catalog/${encodeURIComponent(button.dataset.spriteId)}/history/${encodeURIComponent(button.dataset.catalogRollback)}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }, { refresh: "catalog" });
    if (result) await selectCatalog(button.dataset.spriteId);
  }

  async function setVariantWorkflow(button) {
    const reason = await requestReason(english ? "Why change this variant editorial status?" : "Pourquoi changer ce statut éditorial de variante ?");
    if (!reason) return;
    const result = await request(`/api/admin/catalog/variants/${encodeURIComponent(button.dataset.variantId)}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editorialStatus: button.dataset.variantWorkflow, reason }) }, { refresh: "catalog" });
    if (result && state.catalog.selected) await selectCatalog(state.catalog.selected);
  }
  function closeEditorialDialog(id) {
    const dialog = $(id);
    if (dialog?.open) dialog.close();
  }

  function openEventEditor(mode, eventData = null) {
    state.eventEditor = { mode, id: eventData?.id || null };
    $("#eventEditorTitle").textContent = mode === "create"
      ? (english ? "Create event" : "Créer un événement")
      : (english ? "Edit event" : "Modifier l’événement");
    $("#eventEditorSummary").textContent = english
      ? "Calendar changes stay auditable and feed availability linking."
      : "Les changements de calendrier restent audités et alimentent les liaisons de disponibilité.";
    $("#eventEditorIdField").hidden = mode !== "create";
    $("#eventEditorId").required = mode === "create";
    $("#eventEditorId").value = eventData?.id || "";
    $("#eventEditorId").readOnly = mode !== "create";
    $("#eventEditorName").value = eventData?.name || "";
    $("#eventEditorType").value = eventData?.type || "";
    $("#eventEditorSeasonId").value = eventData?.season_id || "";
    $("#eventEditorStartDate").value = toLocalInput(eventData?.start_date);
    $("#eventEditorEndDate").value = toLocalInput(eventData?.end_date);
    $("#eventEditorDataStatus").value = eventData?.data_status || "incomplete";
    $("#eventEditorReason").value = "";
    $("#eventEditorError").hidden = true;
    $("#eventEditorSubmit").textContent = english ? "Save" : "Enregistrer";
    $("#eventEditorDialog").showModal();
    (mode === "create" ? $("#eventEditorId") : $("#eventEditorName")).focus();
  }

  async function editEvent(button) {
    try {
      const data = await adminFetch(`/api/admin/events/${encodeURIComponent(button.dataset.editEvent)}`);
      openEventEditor("edit", data.event);
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  function createEvent() { openEventEditor("create"); }

  async function submitEventEditor(event) {
    event.preventDefault();
    const operation = state.eventEditor;
    if (!operation) return;
    const errorNode = $("#eventEditorError");
    errorNode.hidden = true;
    const payload = {
      name: $("#eventEditorName").value.trim(),
      type: $("#eventEditorType").value.trim() || null,
      seasonId: $("#eventEditorSeasonId").value.trim() || null,
      startDate: $("#eventEditorStartDate").value || "",
      endDate: $("#eventEditorEndDate").value || "",
      dataStatus: $("#eventEditorDataStatus").value,
      reason: $("#eventEditorReason").value.trim()
    };
    if (!payload.reason) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const submit = $("#eventEditorSubmit");
    submit.disabled = true;
    try {
      if (operation.mode === "create") {
        payload.id = $("#eventEditorId").value.trim();
        await adminFetch("/api/admin/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        setNotice(english ? "Event created." : "Événement créé.");
      } else {
        await adminFetch(`/api/admin/events/${encodeURIComponent(operation.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        setNotice(english ? "Event updated." : "Événement mis à jour.");
      }
      closeEditorialDialog("#eventEditorDialog");
      await loadTab("events", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function willFanoutNews(status = $("#newsEditorStatus")?.value) {
    const previous = state.newsEditor?.previousStatus || "draft";
    return status === "published" && previous !== "published";
  }

  function refreshNewsPreview() {
    const title = $("#newsEditorTitleInput")?.value.trim() || (english ? "Untitled" : "Sans titre");
    const body = $("#newsEditorDescription")?.value.trim() || (english ? "The description will appear here." : "La description apparaîtra ici.");
    const image = $("#newsEditorImage")?.value.trim();
    const link = $("#newsEditorLink")?.value.trim();
    const dateValue = $("#newsEditorNewsDate")?.value;
    $("#newsEditorPreviewTitle").textContent = title;
    $("#newsEditorPreviewBody").textContent = body;
    const meta = ["backoffice", dateValue ? formatDate(dateValue, false) : null, link ? (english ? "has link" : "lien défini") : null].filter(Boolean).join(" · ");
    $("#newsEditorPreviewMeta").textContent = meta;
    const media = $("#newsEditorPreviewMedia");
    if (!media) return;
    if (image) {
      media.hidden = false;
      media.innerHTML = `<img src="${escapeHtml(image)}" alt="" />`;
    } else {
      media.hidden = true;
      media.innerHTML = "";
    }
  }

  function syncNewsEditorChrome() {
    const warning = $("#newsEditorFanoutWarning");
    const submit = $("#newsEditorSubmit");
    const fanout = willFanoutNews();
    if (warning) {
      warning.hidden = !fanout;
      warning.textContent = english
        ? "Publishing will fan this story out to every player (inbox, push and live)."
        : "La publication enverra cette actualité à tous les joueurs (inbox, push et live).";
    }
    if (submit) {
      submit.textContent = fanout
        ? (english ? "Publish & fan out" : "Publier & diffuser")
        : (english ? "Save" : "Enregistrer");
    }
    refreshNewsPreview();
  }

  function openNewsEditor(mode, news = null, options = {}) {
    const previousStatus = options.previousStatus ?? news?.status ?? "draft";
    const statusValue = options.forceStatus || news?.status || "draft";
    state.newsEditor = { mode, id: news?.id || null, previousStatus };
    $("#newsEditorTitle").textContent = mode === "create"
      ? (english ? "Create news" : "Créer une actualité")
      : (english ? "Edit news" : "Modifier l’actualité");
    $("#newsEditorSummary").textContent = english
      ? "Draft freely. First publish fans out inbox, push and live updates."
      : "Travaillez en brouillon. La première publication déclenche le fan-out.";
    $("#newsEditorTitleInput").value = news?.title || "";
    $("#newsEditorDescription").value = news?.description || "";
    $("#newsEditorImage").value = news?.image || "";
    $("#newsEditorLink").value = news?.link || "";
    $("#newsEditorNewsDate").value = toLocalInput(news?.news_date) || (mode === "create" ? toLocalInput(new Date()) : "");
    $("#newsEditorStatus").value = statusValue;
    $("#newsEditorNote").value = news?.editor_note || "";
    $("#newsEditorReason").value = "";
    $("#newsEditorReason").placeholder = options.reasonHint || "";
    $("#newsEditorError").hidden = true;
    syncNewsEditorChrome();
    $("#newsEditorDialog").showModal();
    (options.focusReason ? $("#newsEditorReason") : $("#newsEditorTitleInput")).focus();
  }

  function createNews() { openNewsEditor("create"); }

  async function editNews(button) {
    try {
      const data = await adminFetch(`/api/admin/news/${encodeURIComponent(button.dataset.editNews)}`);
      openNewsEditor("edit", data.news);
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  async function updateNewsStatus(button) {
    const next = button.dataset.newsAction === "publish" ? "published" : "archived";
    try {
      const data = await adminFetch(`/api/admin/news/${encodeURIComponent(button.dataset.newsId)}`);
      openNewsEditor("edit", data.news, {
        previousStatus: data.news.status,
        forceStatus: next,
        focusReason: true,
        reasonHint: next === "published"
          ? (english ? "Why publish this item?" : "Pourquoi publier cette actualité ?")
          : (english ? "Why archive this item?" : "Pourquoi archiver cette actualité ?")
      });
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  async function submitNewsEditor(event) {
    event.preventDefault();
    const operation = state.newsEditor;
    if (!operation) return;
    const errorNode = $("#newsEditorError");
    errorNode.hidden = true;
    const payload = {
      title: $("#newsEditorTitleInput").value.trim(),
      description: $("#newsEditorDescription").value.trim(),
      image: $("#newsEditorImage").value.trim(),
      link: $("#newsEditorLink").value.trim(),
      newsDate: $("#newsEditorNewsDate").value || "",
      status: $("#newsEditorStatus").value,
      editorNote: $("#newsEditorNote").value.trim(),
      reason: $("#newsEditorReason").value.trim()
    };
    if (!payload.title || !payload.reason) {
      errorNode.textContent = !payload.title
        ? (english ? "Title is required." : "Le titre est requis.")
        : tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const submit = $("#newsEditorSubmit");
    submit.disabled = true;
    try {
      let result;
      if (operation.mode === "create") {
        result = await adminFetch("/api/admin/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        result = await adminFetch(`/api/admin/news/${encodeURIComponent(operation.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      closeEditorialDialog("#newsEditorDialog");
      if (result?.fanout) {
        setNotice(english
          ? `Published with fan-out (${formatNumber(result.fanout.inboxNotifications || 0)} inbox notification(s)).`
          : `Publiée avec fan-out (${formatNumber(result.fanout.inboxNotifications || 0)} notification(s) inbox).`);
      } else {
        setNotice(english ? "News saved." : "Actualité enregistrée.");
      }
      await loadTab("events", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openVariantEditor(button) {
    let variant = {};
    try { variant = JSON.parse(button.dataset.variantJson || "{}"); } catch (_) { /* legacy buttons remain editable */ }
    state.variantEditor = { id: button.dataset.editVariant, variant };
    $("#variantEditorTitle").textContent = english ? "Edit variant" : "Modifier la variante";
    $("#variantEditorSummary").textContent = button.dataset.variantName || button.dataset.editVariant;
    $("#variantEditorName").value = button.dataset.variantName || "";
    $("#variantEditorRarity").value = button.dataset.variantRarity || "";
    $("#variantEditorReleaseStatus").value = button.dataset.variantRelease || "";
    $("#variantEditorDataStatus").value = button.dataset.variantStatus || "unknown";
    $("#variantEditorImagePath").value = button.dataset.variantImage || "";
    $("#variantEditorOfficialName").value = variant.official_name || "";
    $("#variantEditorSlug").value = variant.slug || "";
    $("#variantEditorSuggestedImagePath").value = variant.suggested_image_path || "";
    $("#variantEditorFirstObservedAt").value = toLocalInput(variant.first_observed_at);
    $("#variantEditorSummonCost").value = variant.summon_cost ?? "";
    $("#variantEditorDropChance").value = variant.sprite_chest_drop_chance_pct ?? "";
    $("#variantEditorExtraEffectRef").value = variant.extra_effect_ref || "";
    [["#variantEditorEffect", variant.effect], ["#variantEditorAcquisition", variant.acquisition], ["#variantEditorAvailability", variant.availability], ["#variantEditorRecurrence", variant.recurrence], ["#variantEditorDates", variant.dates], ["#variantEditorMissingFields", variant.missing_fields], ["#variantEditorSources", variant.sources]].forEach(([id, value]) => { $(id).value = value == null ? "" : JSON.stringify(value, null, 2); });
    $("#variantEditorReason").value = "";
    $("#variantEditorError").hidden = true;
    $("#variantEditorDialog").showModal();
    $("#variantEditorName").focus();
  }

  async function submitVariantEditor(event) {
    event.preventDefault();
    const operation = state.variantEditor;
    if (!operation?.id) return;
    const errorNode = $("#variantEditorError");
    const reasonValue = $("#variantEditorReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#variantEditorSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/catalog/variants/${encodeURIComponent(operation.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: Object.fromEntries(new FormData($("#variantEditorForm"))), reason: reasonValue })
      });
      closeEditorialDialog("#variantEditorDialog");
      setNotice(english ? "Variant updated." : "Variante mise à jour.");
      if (state.catalog.selected) await selectCatalog(state.catalog.selected);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openAvailabilityEditor(button) {
    state.availabilityEditor = { spriteId: button.dataset.spriteId };
    $("#availabilityEditorTitle").textContent = english ? "Add availability" : "Ajouter une disponibilité";
    $("#availabilityEditorSummary").textContent = button.dataset.spriteName || button.dataset.spriteId || "";
    $("#availabilityEditorStatus").value = "available";
    $("#availabilityEditorConfidence").value = "medium";
    $("#availabilityEditorStartDate").value = "";
    $("#availabilityEditorEndDate").value = "";
    $("#availabilityEditorEventId").value = "";
    $("#availabilityEditorDataStatus").value = "incomplete";
    $("#availabilityEditorReason").value = "";
    $("#availabilityEditorError").hidden = true;
    $("#availabilityEditorDialog").showModal();
    $("#availabilityEditorStatus").focus();
  }

  async function submitAvailabilityEditor(event) {
    event.preventDefault();
    const operation = state.availabilityEditor;
    if (!operation?.spriteId) return;
    const errorNode = $("#availabilityEditorError");
    const reasonValue = $("#availabilityEditorReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#availabilityEditorSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/catalog/${encodeURIComponent(operation.spriteId)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: $("#availabilityEditorStatus").value,
          confidence: $("#availabilityEditorConfidence").value,
          startDate: $("#availabilityEditorStartDate").value || "",
          endDate: $("#availabilityEditorEndDate").value || "",
          eventId: $("#availabilityEditorEventId").value.trim() || null,
          dataStatus: $("#availabilityEditorDataStatus").value,
          reason: reasonValue
        })
      });
      closeEditorialDialog("#availabilityEditorDialog");
      setNotice(english ? "Availability period added." : "Période de disponibilité ajoutée.");
      await selectCatalog(operation.spriteId);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  async function repairReferences() { const why = await requestReason(english ? "Why run the safe sprite-reference repair?" : "Pourquoi exécuter la correction sûre des références Sprite ?"); if (!why) return; await request("/api/admin/collections/integrity/repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "backfill-sprite-references", reason: why }) }, { refresh: "collections" }); }
  function openSquadAccessDialog(button) {
    state.squadAccess = {
      id: button.dataset.squadToggle,
      open: button.dataset.squadOpen !== "true",
      name: button.dataset.squadName || button.dataset.squadToggle
    };
    const opening = state.squadAccess.open;
    $("#squadAccessTitle").textContent = opening
      ? (english ? "Reopen public joining" : "Rouvrir l’accès public")
      : (english ? "Close public joining" : "Fermer l’accès public");
    $("#squadAccessSummary").textContent = `${state.squadAccess.name}`;
    $("#squadAccessImpact").textContent = opening
      ? (english ? "Anyone with the code will be able to join this squad again." : "Toute personne disposant du code pourra rejoindre cette squad.")
      : (english ? "New joins via code will be blocked until the access is reopened." : "Les nouvelles inscriptions via code seront bloquées jusqu’à réouverture.");
    $("#squadAccessReason").value = "";
    $("#squadAccessError").hidden = true;
    $("#squadAccessSubmit").textContent = opening
      ? (english ? "Confirm reopen" : "Confirmer la réouverture")
      : (english ? "Confirm close" : "Confirmer la fermeture");
    $("#squadAccessDialog").showModal();
    $("#squadAccessReason").focus();
  }

  function closeSquadAccessDialog() {
    const dialog = $("#squadAccessDialog");
    if (dialog?.open) dialog.close();
    state.squadAccess = null;
  }

  async function submitSquadAccess(event) {
    event.preventDefault();
    const operation = state.squadAccess;
    if (!operation) return;
    const errorNode = $("#squadAccessError");
    const reasonValue = $("#squadAccessReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#squadAccessSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/social/squads/${encodeURIComponent(operation.id)}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinOpen: operation.open, reason: reasonValue })
      });
      closeSquadAccessDialog();
      setNotice(operation.open
        ? (english ? "Public joining reopened." : "Accès public rouvert.")
        : (english ? "Public joining closed." : "Accès public fermé."));
      await loadTab("social", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function openSquadInviteCancelDialog(button) {
    state.squadInviteCancel = {
      id: button.dataset.cancelInvite,
      label: button.dataset.inviteLabel || button.dataset.cancelInvite
    };
    $("#squadInviteCancelSummary").textContent = state.squadInviteCancel.label;
    $("#squadInviteCancelReason").value = "";
    $("#squadInviteCancelError").hidden = true;
    $("#squadInviteCancelDialog").showModal();
    $("#squadInviteCancelReason").focus();
  }

  function closeSquadInviteCancelDialog() {
    const dialog = $("#squadInviteCancelDialog");
    if (dialog?.open) dialog.close();
    state.squadInviteCancel = null;
  }

  async function submitSquadInviteCancel(event) {
    event.preventDefault();
    const operation = state.squadInviteCancel;
    if (!operation) return;
    const errorNode = $("#squadInviteCancelError");
    const reasonValue = $("#squadInviteCancelReason").value.trim();
    if (!reasonValue) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    errorNode.hidden = true;
    const submit = $("#squadInviteCancelSubmit");
    submit.disabled = true;
    try {
      await adminFetch(`/api/admin/social/invitations/${encodeURIComponent(operation.id)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reasonValue })
      });
      closeSquadInviteCancelDialog();
      setNotice(english ? "Invitation cancelled." : "Invitation annulée.");
      await loadTab("social", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }


  async function retryNotification(button) { const why = await requestReason(english ? "Why retry this delivery?" : "Pourquoi relancer cette livraison ?"); if (!why) return; await request(`/api/admin/notifications/queue/${button.dataset.retryJob}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) }, { refresh: "notifications" }); }
  async function processNotifications() { const why = await requestReason(english ? "Why process the queue now?" : "Pourquoi traiter la file maintenant ?"); if (!why) return; await request("/api/admin/notifications/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: why }) }, { refresh: "notifications" }); }
  async function queuePassports(scope) { const why = await requestReason(scope === "all" ? (english ? "Why queue all passports?" : "Pourquoi planifier tous les passeports ?") : (english ? "Why queue stale passports?" : "Pourquoi planifier les passeports obsolètes ?")); if (!why) return; await request("/api/admin/passports/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, reason: why }) }, { refresh: "passports" }); }
  async function setMetricFlag(input) {
    const disabled = input.checked;
    const key = input.dataset.metricFlag;
    const why = await requestReason(disabled
      ? (english ? `Why suspend ${key}?` : `Pourquoi suspendre ${key} ?`)
      : (english ? `Why restore ${key}?` : `Pourquoi rétablir ${key} ?`));
    if (!why) { input.checked = !disabled; return; }
    try {
      await adminFetch("/api/admin/sprite-graph/flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metricKey: key, disabled, reason: why })
      });
      await loadTab("intelligence", true);
    } catch (error) {
      input.checked = !disabled;
      setAlert(error.message || tr("saveFailed"));
    }
  }
  async function exportAggregates() { try { const payload = await adminFetch("/api/admin/sprite-graph/export/aggregates?limit=2000"); const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = english ? "sprite-index-aggregates.json" : "sprite-index-agregats.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); } catch (error) { setAlert(error.message || tr("saveFailed")); } }

  document.addEventListener("click", (event) => {
    if (event.target.closest("#adminUniversalSearch")) { openUniversalSearch(); return; }
    const universalFilter = event.target.closest("[data-universal-filter]");
    if (universalFilter) { state.universalSearch.activeGroup = universalFilter.dataset.universalFilter; state.universalSearch.activeIndex = 0; renderUniversalSearch(); return; }
    const universalResult = event.target.closest("[data-universal-result]"); if (universalResult) { openUniversalResult(universalResult); return; }
    const tab = event.target.closest("[data-admin-tab]"); if (tab) { setTab(tab.dataset.adminTab); return; }
    const go = event.target.closest("[data-go-tab]"); if (go) { setTab(go.dataset.goTab); return; }
    const openPlayer = event.target.closest("[data-open-player]");
    if (openPlayer) {
      const open = () => selectPlayer(openPlayer.dataset.openPlayer, {
        focusReportId: openPlayer.dataset.focusReport || null
      }).catch((error) => setAlert(error.message || tr("loadFailed")));
      if (state.tab !== "players") setTab("players");
      open();
      return;
    }
    if (event.target.closest("[data-close-dossier]")) {
      closePlayerDossier();
      return;
    }
    const playerRow = event.target.closest("tr[data-player-id]");
    if (playerRow && !event.target.closest("button")) {
      state.players.focusReportId = null;
      selectPlayer(playerRow.dataset.playerId).catch((error) => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const player = event.target.closest("[data-player-action]"); if (player) { handlePlayerAction(player); return; }
    const report = event.target.closest("[data-report-action]"); if (report) { handleReportAction(report); return; }
    const reportAppeal = event.target.closest("[data-report-appeal]"); if (reportAppeal) { handleReportAppeal(reportAppeal); return; }
    const reportPriority = event.target.closest("[data-report-priority-filter]");
    if (reportPriority) {
      state.players.reportPriority = state.players.reportPriority === reportPriority.dataset.reportPriorityFilter ? "all" : reportPriority.dataset.reportPriorityFilter;
      loadTab("players", true);
      return;
    }
    const catalog = event.target.closest("[data-catalog-id]"); if (catalog) { selectCatalog(catalog.dataset.catalogId); return; }
    if (event.target.closest("#eventsBulkSelectPage")) { toggleBulkPage("events", event.target.checked); return; }
    if (event.target.closest("[data-notification-select-page]")) {
      const allSelected = state.notifications.visibleItems.length && state.notifications.visibleItems.every((job) => state.notifications.bulkIds.has(String(job.id)));
      state.notifications.visibleItems.forEach((job) => { if (allSelected) state.notifications.bulkIds.delete(String(job.id)); else state.notifications.bulkIds.add(String(job.id)); });
      loadTab("notifications", true); return;
    }
    if (event.target.closest("[data-notification-bulk-apply]")) { openBulkAction("notifications"); return; }
    const notificationToggle = event.target.closest("[data-bulk-notification-toggle]"); if (notificationToggle) { notificationToggle.checked ? state.notifications.bulkIds.add(notificationToggle.dataset.bulkNotificationToggle) : state.notifications.bulkIds.delete(notificationToggle.dataset.bulkNotificationToggle); loadTab("notifications", true); return; }
    if (event.target.closest("[data-collection-select-page]")) {
      const allSelected = state.collections.visibleItems.length && state.collections.visibleItems.every((entry) => state.collections.bulkIds.has(String(entry.id)));
      state.collections.visibleItems.forEach((entry) => { if (allSelected) state.collections.bulkIds.delete(String(entry.id)); else state.collections.bulkIds.add(String(entry.id)); });
      loadTab("collections", true); return;
    }
    if (event.target.closest("[data-collection-bulk-apply]")) { openBulkAction("collections"); return; }
    const collectionToggle = event.target.closest("[data-bulk-collection-toggle]"); if (collectionToggle) { collectionToggle.checked ? state.collections.bulkIds.add(collectionToggle.dataset.bulkCollectionToggle) : state.collections.bulkIds.delete(collectionToggle.dataset.bulkCollectionToggle); loadTab("collections", true); return; }
    const catalogToggle = event.target.closest("[data-bulk-catalog-toggle]"); if (catalogToggle) { catalogToggle.checked ? state.catalog.bulkIds.add(catalogToggle.dataset.bulkCatalogToggle) : state.catalog.bulkIds.delete(catalogToggle.dataset.bulkCatalogToggle); renderBulkBar("catalog"); return; }
    const eventToggle = event.target.closest("[data-bulk-event-toggle]"); if (eventToggle) { eventToggle.checked ? state.events.bulkIds.add(eventToggle.dataset.bulkEventToggle) : state.events.bulkIds.delete(eventToggle.dataset.bulkEventToggle); renderBulkBar("events"); return; }
    if (event.target.closest("#catalogBulkApply")) { openBulkAction("catalog"); return; }
    if (event.target.closest("#eventsBulkApply")) { openBulkAction("events"); return; }
    if (event.target.closest("[data-catalog-show-issues]")) { $("#catalogState").value = "data_issues"; state.catalog.page = 1; loadTab("catalog", true); return; }
    if (event.target.closest("#catalogBulkClear")) { state.catalog.bulkIds.clear(); loadTab("catalog", true); return; }
    if (event.target.closest("#eventsBulkClear")) { state.events.bulkIds.clear(); loadTab("events", true); return; }
    const workflow = event.target.closest("[data-catalog-workflow]"); if (workflow) { setCatalogWorkflow(workflow); return; }
    const variantWorkflow = event.target.closest("[data-variant-workflow]"); if (variantWorkflow) { setVariantWorkflow(variantWorkflow); return; }
    const rollback = event.target.closest("[data-catalog-rollback]"); if (rollback) { rollbackCatalogHistory(rollback); return; }
    const variant = event.target.closest("[data-edit-variant]"); if (variant) { openVariantEditor(variant); return; }
    const availability = event.target.closest("#addAvailability"); if (availability) { openAvailabilityEditor(availability); return; }
    const eventEdit = event.target.closest("[data-edit-event]"); if (eventEdit) { editEvent(eventEdit); return; }
    const newsEdit = event.target.closest("[data-edit-news]"); if (newsEdit) { editNews(newsEdit); return; }
    const news = event.target.closest("[data-news-action]"); if (news) { updateNewsStatus(news); return; }
    const openSquad = event.target.closest("[data-open-squad]");
    if (openSquad) {
      selectSquad(openSquad.dataset.openSquad).catch((error) => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const squadRow = event.target.closest("tr[data-squad-id]");
    if (squadRow && !event.target.closest("button")) {
      selectSquad(squadRow.dataset.squadId).catch((error) => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const cancelInvite = event.target.closest("[data-cancel-invite]");
    if (cancelInvite) { openSquadInviteCancelDialog(cancelInvite); return; }
    if (event.target.closest("[data-close-squad]")) { state.social.selected = null; renderSquadDossierEmpty(); $("#squadsList")?.querySelectorAll("tr[data-squad-id]").forEach(node => node.classList.remove("is-selected")); return; }
    const squad = event.target.closest("[data-squad-toggle]"); if (squad) { openSquadAccessDialog(squad); return; }
    const retry = event.target.closest("[data-retry-job]"); if (retry) { retryNotification(retry); return; }
    const scope = event.target.closest("[data-passport-scope]"); if (scope) { queuePassports(scope.dataset.passportScope); return; }
    const page = event.target.closest("[data-page-kind]"); if (page && !page.disabled) { state[page.dataset.pageKind].page = Number(page.dataset.page); loadTab(page.dataset.pageKind, true); return; }
    const privacyExport = event.target.closest("[data-privacy-export]");
    if (privacyExport) {
      openPrivacyExportDialog({ userId: privacyExport.dataset.privacyExport, label: privacyExport.dataset.privacyLabel || "" });
      return;
    }
    const privacyPurge = event.target.closest("[data-privacy-purge]");
    if (privacyPurge) {
      openPrivacyPurgeDialog({
        userId: privacyPurge.dataset.privacyPurge,
        label: privacyPurge.dataset.privacyLabel || "",
        username: privacyPurge.dataset.privacyUsername || "",
        ready: privacyPurge.dataset.privacyReady === "true",
        volume: Number(privacyPurge.dataset.privacyVolume) || 0
      });
      return;
    }
    const privacyRestore = event.target.closest("[data-privacy-restore]");
    if (privacyRestore) { openPrivacyRestoreDialog(privacyRestore); return; }
    if (event.target.closest("#privacyExportButton")) {
      openPrivacyExportDialog({ label: $("#privacyExportSearch")?.value || "" });
      return;
    }
    if (event.target.closest("#privacyPurgeReadyButton")) {
      openPrivacyPurgeDialog({ batch: true, ready: true });
      return;
    }
    if (event.target.closest("#privacyRevokeLinksButton")) {
      openPrivacyRevokeLinksDialog();
      return;
    }
    if (event.target.closest("#createAdminOperator")) { openAdminOperatorDialog(); return; }
    const operatorRotate = event.target.closest("[data-operator-rotate]"); if (operatorRotate) { openAdminOperatorDialog({ operatorId: operatorRotate.dataset.operatorRotate, name: operatorRotate.dataset.operatorName || "" }); return; }
    const operatorToggle = event.target.closest("[data-operator-toggle]"); if (operatorToggle) { toggleAdminOperator(operatorToggle); return; }
    const securityAlert = event.target.closest("[data-security-alert-ack]"); if (securityAlert) { acknowledgeSecurityAlert(securityAlert); return; }
    if (event.target.closest("#retryFailedNotifications")) { retryFailedNotifications(); return; }
    const auditDetail = event.target.closest("[data-audit-detail]");
    if (auditDetail) { openAuditDetail(auditDetail.dataset.auditDetail); return; }
    const auditRange = event.target.closest("[data-audit-range]");
    if (auditRange) { setAuditRange(auditRange.dataset.auditRange); return; }
    const auditPage = event.target.closest("[data-audit-page]");
    if (auditPage) {
      state.audit.page += auditPage.dataset.auditPage === "next" ? 1 : -1;
      state.audit.page = Math.max(1, state.audit.page);
      loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
      return;
    }
    if (event.target.closest("#auditExportButton")) { exportAudit(); return; }
    if (event.target.closest("#auditResetButton")) {
      state.audit = { ...state.audit, page: 1, q: "", action: "", targetType: "", from: "", to: "", range: "all" };
      ["#auditSearch", "#auditFrom", "#auditTo"].forEach(id => { if ($(id)) $(id).value = ""; });
      ["#auditActionFilter", "#auditTargetFilter"].forEach(id => { if ($(id)) $(id).value = ""; });
      loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
      return;
    }
    const revoke = event.target.closest("[data-revoke-session]"); if (revoke) { request(`/api/admin/sessions/${encodeURIComponent(revoke.dataset.revokeSession)}`, { method: "DELETE" }, { refresh: "privacy" }); return; }
    if (event.target.closest("#createEvent")) { createEvent(); return; } if (event.target.closest("#createNews")) { createNews(); return; } if (event.target.closest("#repairSpriteReferences")) { openBulkAction("collections"); return; } if (event.target.closest("#processNotifications")) { processNotifications(); return; } if (event.target.closest("#adminExport")) { exportAggregates(); return; }
  });
  document.addEventListener("error", event => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("admin-sprite-image")) return;
    const holder = image.parentElement;
    if (!holder) return;
    holder.classList.add("is-image-missing");
    holder.textContent = "✦";
  }, true);
  document.addEventListener("change", event => {
    const metric = event.target.closest("[data-metric-flag]");
    if (metric) { setMetricFlag(metric); return; }
    if (event.target.id === "newsStatusFilter") {
      state.events.newsStatus = event.target.value;
      loadTab("events", true);
      return;
    }
    if (event.target.id === "auditActionFilter" || event.target.id === "auditTargetFilter" || event.target.id === "auditFrom" || event.target.id === "auditTo") {
      state.audit.action = $("#auditActionFilter")?.value || "";
      state.audit.targetType = $("#auditTargetFilter")?.value || "";
      state.audit.from = $("#auditFrom")?.value || "";
      state.audit.to = $("#auditTo")?.value || "";
      state.audit.range = "custom";
      state.audit.page = 1;
      loadAudit().catch(error => setAlert(error.message || tr("loadFailed")));
      return;
    }
    if (event.target.closest("#newsEditorForm")) syncNewsEditorChrome();
  });
  document.addEventListener("input", event => {
    if (event.target.id === "adminSearchInput") {
      clearTimeout(state.universalSearch.timer);
      state.universalSearch.timer = setTimeout(() => searchUniversally(event.target.value), 180);
      return;
    }
    if (event.target.id === "auditSearch") {
      state.audit.q = event.target.value || "";
      state.audit.page = 1;
      clearTimeout(state.audit.searchTimer);
      state.audit.searchTimer = setTimeout(() => loadAudit().catch(error => setAlert(error.message || tr("loadFailed"))), 220);
      return;
    }
    if (event.target.closest("#newsEditorForm")) refreshNewsPreview();
  });
  document.addEventListener("submit", event => {
    if (event.target.id === "catalogEditForm") { event.preventDefault(); saveCatalogForm(event.target); }
    if (event.target.id === "playerSuspensionForm") submitPlayerSuspension(event);
    if (event.target.id === "reportDecisionForm") submitReportDecision(event);
    if (event.target.id === "eventEditorForm") submitEventEditor(event);
    if (event.target.id === "newsEditorForm") submitNewsEditor(event);
    if (event.target.id === "variantEditorForm") submitVariantEditor(event);
    if (event.target.id === "availabilityEditorForm") submitAvailabilityEditor(event);
    if (event.target.id === "squadAccessForm") submitSquadAccess(event);
    if (event.target.id === "squadInviteCancelForm") submitSquadInviteCancel(event);
    if (event.target.id === "privacyPurgeForm") submitPrivacyPurge(event);
    if (event.target.id === "adminOperatorForm") submitAdminOperatorDialog(event);
    if (event.target.id === "bulkActionForm") submitBulkAction(event);
    if (event.target.id === "privacyExportForm") submitPrivacyExport(event);
    if (event.target.id === "privacyRestoreForm") submitPrivacyRestore(event);
    if (event.target.id === "privacyRevokeLinksForm") submitPrivacyRevokeLinks(event);
  });
  $("#adminRefresh").addEventListener("click", () => loadTab(state.tab, true));
  $("#adminSearchClose")?.addEventListener("click", closeUniversalSearch);
  $("#adminSearchDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeUniversalSearch(); });
  $("#adminSearchInput")?.addEventListener("keydown", event => {
    if (event.key === "ArrowDown") { event.preventDefault(); moveUniversalSelection(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveUniversalSelection(-1); }
    else if (event.key === "Enter") {
      const active = document.querySelector(`.admin-search-result[data-universal-index="${state.universalSearch.activeIndex}"]`);
      if (active) { event.preventDefault(); openUniversalResult(active); }
    }
  });
  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openUniversalSearch(); }
  });
  $("#playerSearchButton").addEventListener("click", () => { state.players.page = 1; loadTab("players", true); });
  $("#reportPriorityFilter").addEventListener("change", event => { state.players.reportPriority = event.target.value; loadTab("players", true); });
  $("#privacyExportSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") openPrivacyExportDialog({ label: event.target.value || "" });
  });
  $("#privacyDeletionFilter")?.addEventListener("change", () => loadTab("privacy", true));
  $("#privacyExportLookup")?.addEventListener("click", async () => {
    try {
      $("#privacyExportError").hidden = true;
      await previewPrivacyExportTarget();
    } catch (error) {
      $("#privacyExportError").textContent = error.message || tr("loadFailed");
      $("#privacyExportError").hidden = false;
    }
  });
  [
    ["#privacyPurgeClose", closePrivacyPurgeDialog],
    ["#privacyPurgeCancel", closePrivacyPurgeDialog],
    ["#privacyExportClose", closePrivacyExportDialog],
    ["#privacyExportCancel", closePrivacyExportDialog],
    ["#privacyRestoreClose", closePrivacyRestoreDialog],
    ["#privacyRestoreCancel", closePrivacyRestoreDialog],
    ["#privacyRevokeLinksClose", closePrivacyRevokeLinksDialog],
    ["#privacyRevokeLinksCancel", closePrivacyRevokeLinksDialog]
  ].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#privacyPurgeDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyPurgeDialog(); });
  [["#adminOperatorClose", closeAdminOperatorDialog], ["#adminOperatorCancel", closeAdminOperatorDialog]].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#adminOperatorDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeAdminOperatorDialog(); });
  [["#bulkActionClose", closeBulkAction], ["#bulkActionCancel", closeBulkAction]].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#bulkActionDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeBulkAction(); });
  $("#privacyExportDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyExportDialog(); });
  $("#privacyRestoreDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyRestoreDialog(); });
  $("#privacyRevokeLinksDialog")?.addEventListener("cancel", event => { event.preventDefault(); closePrivacyRevokeLinksDialog(); });
  $("#adminReasonClose")?.addEventListener("click", () => closeReasonDialog(null));
  $("#adminReasonCancel")?.addEventListener("click", () => closeReasonDialog(null));
  $("#adminReasonDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeReasonDialog(null); });
  $("#adminReasonForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const input = $("#adminReasonInput");
    const error = $("#adminReasonError");
    const value = String(input?.value || "").trim();
    if (!value) {
      error.textContent = tr("reasonRequired");
      error.hidden = false;
      input?.focus();
      return;
    }
    closeReasonDialog(value);
  });
  [["#auditDetailClose", closeAuditDetail], ["#auditDetailDone", closeAuditDetail]].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#auditDetailDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeAuditDetail(); });
  $("#squadSearchButton")?.addEventListener("click", () => { state.social.page = 1; loadTab("social", true); });
  $("#squadSearch")?.addEventListener("keydown", event => { if (event.key === "Enter") { state.social.page = 1; loadTab("social", true); } });
  $("#squadJoinFilter")?.addEventListener("change", () => { state.social.page = 1; loadTab("social", true); });
  [
    ["#squadAccessClose", closeSquadAccessDialog],
    ["#squadAccessCancel", closeSquadAccessDialog],
    ["#squadInviteCancelClose", closeSquadInviteCancelDialog],
    ["#squadInviteCancelCancel", closeSquadInviteCancelDialog]
  ].forEach(([id, handler]) => $(id)?.addEventListener("click", handler));
  $("#squadAccessDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeSquadAccessDialog(); });
  $("#squadInviteCancelDialog")?.addEventListener("cancel", event => { event.preventDefault(); closeSquadInviteCancelDialog(); });
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
  $("#reportDecisionClose").addEventListener("click", closeReportDecisionDialog);
  $("#reportDecisionCancel").addEventListener("click", closeReportDecisionDialog);
  $("#reportDecisionDialog").addEventListener("cancel", event => { event.preventDefault(); closeReportDecisionDialog(); });
  $("#reportDecisionDuration").addEventListener("change", event => {
    const custom = event.target.value === "custom";
    $("#reportDecisionCustomField").hidden = !custom;
    if (custom && !$("#reportDecisionUntil").value) {
      const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      $("#reportDecisionUntil").value = date.toISOString().slice(0, 16);
    }
  });
  [
    ["#eventEditorClose", "#eventEditorCancel", "#eventEditorDialog"],
    ["#newsEditorClose", "#newsEditorCancel", "#newsEditorDialog"],
    ["#variantEditorClose", "#variantEditorCancel", "#variantEditorDialog"],
    ["#availabilityEditorClose", "#availabilityEditorCancel", "#availabilityEditorDialog"]
  ].forEach(([closeId, cancelId, dialogId]) => {
    $(closeId)?.addEventListener("click", () => closeEditorialDialog(dialogId));
    $(cancelId)?.addEventListener("click", () => closeEditorialDialog(dialogId));
    $(dialogId)?.addEventListener("cancel", (event) => { event.preventDefault(); closeEditorialDialog(dialogId); });
  });
  $("#adminLogout").addEventListener("click", async () => { try { await adminFetch("/api/admin/logout", { method: "POST" }); } catch (_) {} location.replace(`/admin/access${location.search}`); });
  $("#revokeOtherSessions")?.addEventListener("click", async () => {
    const result = await request("/api/admin/sessions/revoke-others", { method: "POST" }, { refresh: "privacy" });
    if (result) setNotice(english ? `${formatNumber(result.revoked)} other session(s) revoked.` : `${formatNumber(result.revoked)} autre(s) session(s) révoquée(s).`);
  });

  applyStaticCopy();
  bootstrapSession().then(() => {
    const tab = state.session?.tabs?.[state.tab] === true ? state.tab : firstAllowedTab();
    setTab(tab);
  });
  setInterval(() => {
    renderSessionBadge();
    if (document.visibilityState === "visible") {
      bootstrapSession().then(() => loadTab(state.tab, true));
    }
  }, 30_000);
  setInterval(renderSessionBadge, 15_000);
})();
