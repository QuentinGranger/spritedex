(() => {
  "use strict";

  "use strict";

  const queryLanguage = new URLSearchParams(location.search).get("lang");
  const francophoneRegions = new Set([
    "BJ",
    "BI",
    "CM",
    "KM",
    "CI",
    "DJ",
    "GA",
    "GN",
    "GQ",
    "MG",
    "CF",
    "CD",
    "CG",
    "RW",
    "SN",
    "SC",
    "TD",
    "TG",
    "DZ",
    "BF",
    "ML",
    "MA",
    "MU",
    "MR",
    "NE",
    "TN",
    "BE",
    "FR",
    "LU",
    "MC",
    "CH",
    "AD",
    "CA",
    "HT",
    "LB",
    "VU"
  ]);
  const locales =
    Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"];
  const french =
    queryLanguage === "fr" ||
    (queryLanguage !== "en" &&
      locales.some((locale) => {
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
    audit: {
      page: 1,
      pageSize: 25,
      q: "",
      action: "",
      targetType: "",
      from: "",
      to: "",
      range: "all",
      data: null,
      searchTimer: null
    },
    suspension: null,
    graph: {},
    session: null,
    reasonResolver: null,
    adminOperator: null,
    bulkAction: null,
    bulkData: { failedNotifications: 0, repairableReferences: 0 },
    universalSearch: {
      timer: null,
      request: 0,
      results: [],
      groups: [],
      activeGroup: "all",
      activeIndex: -1,
      loading: false
    }
  };

  const copy = english
    ? {
        session: "Secure terminal session",
        logout: "End session",
        navigation: "NAVIGATION",
        advanced: "ADVANCED",
        refresh: "Refresh",
        search: "Search",
        create: "Create",
        repair: "Repair references",
        process: "Process queue",
        navOverview: "Overview",
        navPlayers: "Players & moderation",
        navCatalog: "Catalog",
        navEvents: "Events & news",
        navCollections: "Collections & integrity",
        navSocial: "Social & squads",
        navNotifications: "Notifications",
        navIntelligence: "Intelligence & Graph",
        navPassports: "Passports & badges",
        navPrivacy: "Privacy & audit",
        overviewActionTitle: "Operational priorities",
        overviewRealtime: "Live connections",
        overviewInfrastructure: "API & database",
        playersTitle: "Players",
        reportsTitle: "Open reports",
        playerPick: "Select a player or report to open the moderation dossier.",
        catalogTitle: "Sprites & variants",
        catalogPick: "Select a sprite to review its data, variants, availability and change history.",
        eventsTitle: "Events",
        newsTitle: "News",
        repairTitle: "Sprite references",
        repairLead: "The repair never changes player statuses, priorities or notes.",
        migrationTitle: "Migration errors",
        integrityQueueTitle: "Recalculation queue",
        squadsTitle: "Squad health",
        squadPick: "Select a squad to review members, invitations, wishes and activity.",
        pendingInvitesTitle: "Pending invitations",
        pendingFriendsTitle: "Friend requests",
        recentBlocksTitle: "Recent blocks",
        squadSearch: "Squad name or code",
        deliveriesTitle: "Delivery channels",
        failedJobsTitle: "Jobs to retry",
        graphActivityTitle: "Sprite Graph flow",
        graphHealthTitle: "Pipeline",
        graphReadinessTitle: "Readiness",
        graphMetricsTitle: "Public metrics",
        graphMetricsLead: "Temporarily suspend a metric when in doubt. A reason is required.",
        graphFormulasTitle: "Formula versions",
        export: "Export aggregates",
        passportRecalcTitle: "Passport recalculation",
        passportRecalcLead: "Recalculations are queued and never notify players.",
        recalcStale: "Recalculate stale",
        recalcAll: "Queue all",
        passportVisibilityTitle: "Passport sharing",
        passportBadgesTitle: "Most unlocked badges",
        consentTitle: "Accepted versions",
        sharingTitle: "Active capabilities",
        sessionsTitle: "Active sessions",
        sessionsLead: "Revoke a concurrent session or every other one if a link leaked.",
        revokeOthers: "Revoke others",
        deletionQueueTitle: "Deletion queue",
        deletionQueueLead:
          "Soft-deleted accounts remain recoverable until retention ends, then can be purged permanently.",
        exportData: "Export data",
        purgeReady: "Purge ready accounts",
        revokeShareLinks: "Revoke active links",
        privacyExportSearch: "Export: username or #id",
        revokeSession: "Revoke",
        thisSession: "This session",
        auditTitle: "Administrative actions",
        rolesNote:
          "Current access: a protected terminal session. Named roles can be added without exposing player accounts.",
        playerSearch: "Search a username",
        catalogSearch: "Sprite or identifier",
        updated: "Updated {time}",
        loadFailed: "This backoffice section could not be loaded. Refresh to try again.",
        saveFailed: "The action could not be saved.",
        noData: "No data to display.",
        reasonPrompt: "Why are you performing this action?",
        reasonRequired: "A justification is required.",
        reasonDialogEyebrow: "AUDITED ACTION",
        reasonDialogTitle: "Confirm action",
        reasonDialogLabel: "Justification",
        confirm: "Confirm",
        cancel: "Cancel",
        view: "View",
        edit: "Edit",
        publish: "Publish",
        archive: "Archive",
        retry: "Retry",
        suspend: "Suspend",
        unsuspend: "Reactivate",
        resolve: "Resolve",
        dismiss: "Dismiss",
        close: "Close access",
        open: "Open access",
        active: "Active",
        pending: "Pending",
        failed: "Failed",
        draft: "Draft",
        published: "Published",
        archived: "Archived",
        unavailable: "Unavailable",
        unknown: "Unknown",
        noReports: "No open reports.",
        noFailures: "No failed job.",
        noErrors: "No migration error.",
        noCatalog: "No sprite found.",
        noNews: "No news item.",
        noEvents: "No event.",
        queued: "Queued",
        updatedCollection: "collection changes",
        ago: "ago",
        openTab: "Open",
        sessionExpires: "expires in {time}",
        sessionExpired: "Session expired"
      }
    : {};

  const headings = english
    ? {
        overview: ["OPERATIONAL CONTROL", "Overview", "Sprite-Index health, alerts and next useful actions."],
        players: [
          "PLAYER SAFETY",
          "Players & moderation",
          "Find an account, handle reports and apply proportionate, recorded actions."
        ],
        catalog: [
          "EDITORIAL REFERENCE",
          "Catalog",
          "Control sprites, variants, availability and the history of every catalog correction."
        ],
        events: ["CALENDAR & EDITORIAL", "Events & news", "Keep event dates, confidence and public news accurate."],
        collections: [
          "DATA QUALITY",
          "Collections & integrity",
          "Spot safe-to-fix reference inconsistencies without reading players’ private notes."
        ],
        social: [
          "COMMUNITY",
          "Social & squads",
          "Monitor social activity, squads and collaborative wishlists through operational summaries."
        ],
        notifications: [
          "DELIVERY",
          "Notifications",
          "Track the queue, provider health, digests and recoverable failures."
        ],
        intelligence: [
          "SPRITE GRAPH",
          "Intelligence & Graph",
          "Monitor ingestion, public metrics, scoring formulas and readiness."
        ],
        passports: [
          "COLLECTOR EXPERIENCE",
          "Passports & badges",
          "Monitor derived summaries, badge unlocks and the controlled recalculation queue."
        ],
        privacy: [
          "DATA GOVERNANCE",
          "Privacy & audit",
          "Export personal data, manage the deletion queue, restore soft-deletes and revoke share links."
        ]
      }
    : {
        overview: [
          "CONTRÔLE OPÉRATIONNEL",
          "Vue d’ensemble",
          "La santé de Sprite-Index, les alertes et les prochaines actions utiles."
        ],
        players: [
          "SÛRETÉ JOUEUR",
          "Joueurs & modération",
          "Retrouvez un compte, traitez les signalements et appliquez des actions proportionnées et tracées."
        ],
        catalog: [
          "RÉFÉRENTIEL ÉDITORIAL",
          "Catalogue",
          "Contrôlez sprites, variantes, disponibilités et l’historique de chaque correction."
        ],
        events: [
          "CALENDRIER & ÉDITORIAL",
          "Événements & actualités",
          "Gardez les dates, la confiance des événements et les actualités publiques exactes."
        ],
        collections: [
          "QUALITÉ DES DONNÉES",
          "Collections & cohérence",
          "Détectez les incohérences réparables sans lire les notes privées des joueurs."
        ],
        social: [
          "COMMUNAUTÉ",
          "Social & squads",
          "Supervisez l’activité sociale, les squads et les souhaits collaboratifs via des résumés opérationnels."
        ],
        notifications: [
          "DISTRIBUTION",
          "Notifications",
          "Suivez la file, la santé des fournisseurs, les digests et les échecs récupérables."
        ],
        intelligence: [
          "SPRITE GRAPH",
          "Intelligence & Graph",
          "Surveillez l’ingestion, les métriques publiques, les formules et la qualité des signaux."
        ],
        passports: [
          "EXPÉRIENCE COLLECTEUR",
          "Passeports & badges",
          "Contrôlez les résumés dérivés, les badges et la file de recalcul maîtrisée."
        ],
        privacy: [
          "GOUVERNANCE DES DONNÉES",
          "Confidentialité & audit",
          "Exportez des données, gérez la file de purge, restaurez un soft-delete et révoquez les liens de partage."
        ]
      };

  function tr(key, fallback = key) {
    return copy[key] || fallback;
  }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  function adminImageUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^https:\/\//i.test(raw)) return raw;
    if (/^(?:Sprite|images|assets)\/[a-zA-Z0-9._/-]+$/.test(raw)) return `/${raw}`;
    if (/^\/(?:Sprite|images|assets)\/[a-zA-Z0-9._/-]+$/.test(raw)) return raw;
    return "";
  }
  function adminCatalogImage(value) {
    const src = adminImageUrl(value);
    return src ? `<img class="admin-sprite-image" src="${escapeHtml(src)}" alt="" loading="lazy" />` : "✦";
  }
  function formatNumber(value) {
    return number.format(Number(value) || 0);
  }
  function formatDate(value, withTime = true) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : (withTime ? dateTime : dateOnly).format(date);
  }
  function formatPercent(value) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(value) || 0)}%`;
  }
  function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return `${formatNumber(Math.round(value))} ${english ? "sec" : "s"}`;
    if (value < 3600) return `${formatNumber(Math.round(value / 60))} min`;
    return `${formatNumber(Math.round(value / 3600))} h`;
  }

  function toLocalInput(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  function label(value) {
    return String(value || tr("unknown")).replace(/_/g, " ");
  }
  function reportPriorityTone(priority) {
    return priority === "urgent" ? "danger" : priority === "high" ? "warning" : priority === "low" ? "good" : "";
  }
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
    const entries = Object.entries(context).filter(
      ([key, value]) => names[key] && value != null && String(value).trim()
    );
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
    const order = [
      "overview",
      "players",
      "catalog",
      "events",
      "collections",
      "social",
      "notifications",
      "intelligence",
      "passports",
      "privacy"
    ];
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
        ? english
          ? "MFA on · step-up for privacy writes"
          : "MFA actif · step-up sur privacy"
        : english
          ? "MFA off"
          : "MFA off";
      const identity =
        state.session.authMode === "legacy_global"
          ? english
            ? "global transition secret still active"
            : "secret global de transition encore actif"
          : english
            ? `named account @${state.session.operatorLabel || "admin"}`
            : `compte nominatif @${state.session.operatorLabel || "admin"}`;
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
    const timeLabel =
      remaining <= 0
        ? tr("sessionExpired", "Session expirée")
        : english
          ? `expires in ${formatDuration(remaining / 1000)}`
          : `expire dans ${formatDuration(remaining / 1000)}`;
    labelNode.textContent = `${actor} · ${timeLabel}`;
    badge.title = state.session.maxExpiresAt ? `${actor} · max ${formatDate(state.session.maxExpiresAt)}` : actor;
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
  function setAlert(message = "") {
    const node = $("#adminAlert");
    node.hidden = !message;
    node.textContent = message;
  }
  function setNotice(message = "") {
    const node = $("#adminNotice");
    node.hidden = !message;
    node.textContent = message;
  }
  function setLoading(key, loading) {
    if (loading) state.loading.add(key);
    else state.loading.delete(key);
    $("#adminRefresh").disabled = state.loading.size > 0;
  }
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
    if (!dialog || !input) {
      setAlert(tr("reasonRequired"));
      return Promise.resolve(null);
    }
    if (state.reasonResolver) closeReasonDialog(null);
    input.value = "";
    error.hidden = true;
    $("#adminReasonMessage").textContent = message;
    dialog.showModal();
    requestAnimationFrame(() => input.focus());
    return new Promise((resolve) => {
      state.reasonResolver = resolve;
    });
  }

  async function adminFetch(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options
    });
    if (response.status === 401) {
      location.replace(`/admin/access${location.search}`);
      throw new Error("unauthorized");
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload.error || "request_failed");
      error.status = response.status;
      error.payload = payload;
      if (response.status === 403) {
        error.message = english
          ? payload.error || "Insufficient privilege for this action"
          : payload.error || "Privilège insuffisant pour cette action";
      }
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  async function request(path, options, { refresh = state.tab } = {}) {
    try {
      const result = await adminFetch(path, options);
      if (refresh) await loadTab(refresh, true);
      return result;
    } catch (error) {
      if (error.message !== "unauthorized") setAlert(error.message || tr("saveFailed"));
      return null;
    }
  }

  function kpi(labelText, value, hint = "", tone = "") {
    return `<article class="admin-kpi admin-kpi--compact ${tone ? `admin-kpi--${tone}` : ""}"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(value)}</strong><small class="admin-kpi__trend">${escapeHtml(hint)}</small></article>`;
  }
  // Named stateBadge: window.status is a read-only browser property and cannot hold a function.
  function stateBadge(textValue, tone = "") {
    return `<span class="admin-state ${tone ? `admin-state--${tone}` : ""}">${escapeHtml(textValue)}</span>`;
  }
  function empty(message = tr("noData")) {
    return `<p class="admin-empty">${escapeHtml(message)}</p>`;
  }

  Object.assign(window, {
    queryLanguage,
    francophoneRegions,
    locales,
    french,
    english,
    locale,
    number,
    dateTime,
    dateOnly,
    $,
    $$,
    state,
    copy,
    headings,
    tr,
    escapeHtml,
    adminImageUrl,
    adminCatalogImage,
    formatNumber,
    formatDate,
    formatPercent,
    formatDuration,
    toLocalInput,
    label,
    reportPriorityTone,
    reportPriorityLabel,
    reportContextMarkup,
    sessionRemainingMs,
    can,
    needsStepUp,
    readStepUpCode,
    stepUpHeaders,
    assertStepUp,
    firstAllowedTab,
    applyAuthz,
    renderSessionBadge,
    bootstrapSession,
    setAlert,
    setNotice,
    setLoading,
    closeReasonDialog,
    requestReason,
    adminFetch,
    request,
    kpi,
    stateBadge,
    empty
  });
})();
