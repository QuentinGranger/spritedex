// ── Notification center (panel) ──
const NOTIF_SEEN_KEY = "spritedex_news_seen";
let notifDropdownOpen = false;
let notifOffset = 0;
let notifLoading = false;
let notifHasMore = true;
let notifFilter = "all";
const notifItemsById = new Map();

const NOTIF_FILTER_LABELS = {
  all: "Toutes",
  social: "Social",
  collection: "Collections",
  squads: "Squads",
  alerts: "Alertes",
  unread: "Non lues"
};

const NOTIF_CATEGORY_LABELS = {
  social: "Social",
  collection: "Collections",
  alerts: "Alertes",
  squads: "Squads"
};

const NOTIF_ICONS = {
  social: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  collection: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  squads: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  alerts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
};

function getSeenNewsIds() {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_SEEN_KEY) || "[]");
  } catch { return []; }
}

function markNewsSeen(ids) {
  const seen = getSeenNewsIds();
  const updated = [...new Set([...seen, ...ids])].slice(-100);
  localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify(updated));
  updateNotifBadge(0);
}

function updateNotifBadge(count) {
  const badge = document.getElementById("notifBadge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : count;
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
}

async function checkNewsNotifications() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/notifications?unread=true&limit=1`, { headers: authHeadersOnly() });
    if (!res.ok) return;
    const data = await res.json();
    updateNotifBadge(data.unreadCount || 0);
  } catch { /* silent */ }
}

function toggleNotifDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (!dropdown) return;
  notifDropdownOpen = !notifDropdownOpen;
  dropdown.style.display = notifDropdownOpen ? "flex" : "none";
  if (notifDropdownOpen) {
    resetAndLoadNotifications();
  }
}

function closeNotifDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (dropdown) dropdown.style.display = "none";
  notifDropdownOpen = false;
}

function resetAndLoadNotifications() {
  notifOffset = 0;
  notifHasMore = true;
  notifItemsById.clear();
  const list = document.getElementById("notifList");
  if (list) list.innerHTML = "";
  loadMoreNews();
}

function setNotifFilter(filter) {
  const next = NOTIF_FILTER_LABELS[filter] ? filter : "all";
  if (next === notifFilter && notifDropdownOpen) {
    resetAndLoadNotifications();
    return;
  }
  notifFilter = next;
  document.querySelectorAll(".notif-filter").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.notifFilter === notifFilter);
  });
  if (notifDropdownOpen) resetAndLoadNotifications();
}

function notifDisplayCategory(item) {
  const type = String(item.type || "");
  if (type === "squad_completion_increased" || type.startsWith("squad_")) return "squads";
  if (item.category === "social" || item.category === "alerts" || item.category === "collection") {
    return item.category;
  }
  return "collection";
}

function notifCategoryLabel(key) {
  return NOTIF_CATEGORY_LABELS[key] || NOTIF_CATEGORY_LABELS.collection;
}

function formatNotifDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "À l'instant";
  if (mins < 60) return `Il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Il y a ${days} j`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
}

/** Étape 48 — stable deep-link for each contextual notification type (never "/"). */
function getNotificationUrl(item) {
  const data = item.data || item.context || {};
  if (data.actions && data.actions.primary && data.actions.primary.url) {
    return data.actions.primary.url;
  }
  if (data.actionUrl) return data.actionUrl;
  switch (item.type) {
    case "friend_request_accepted": {
      const friendId = data.friendId || item.actor_id;
      return friendId ? `/compare/${encodeURIComponent(friendId)}` : null;
    }
    case "friend_acquired_missing_variant": {
      const friendId = data.friendId || item.actor_id;
      const variantId = data.variantId || item.entity_id;
      if (!friendId) return null;
      return variantId
        ? `/compare/${encodeURIComponent(friendId)}?variantId=${encodeURIComponent(variantId)}`
        : `/compare/${encodeURIComponent(friendId)}`;
    }
    case "squad_completion_increased": {
      if (data.squadCode) return `/squad/${encodeURIComponent(data.squadCode)}/engine`;
      const squadRef = data.squadId || item.entity_id;
      return squadRef ? `/squads/${encodeURIComponent(squadRef)}/completion` : null;
    }
    case "priority_variant_available": {
      if (data.spriteId && data.variantType) {
        return `/sprites/${encodeURIComponent(data.spriteId)}?variant=${encodeURIComponent(data.variantType)}`;
      }
      const variantId = data.variantId || item.entity_id;
      if (variantId) return `/variant/${encodeURIComponent(variantId)}`;
      if (data.spriteId) return `/sprites/${encodeURIComponent(data.spriteId)}`;
      return null;
    }
    case "wanted_event_ending_soon": {
      const eventId = data.eventId || item.entity_id;
      return eventId ? `/events/${encodeURIComponent(eventId)}?filter=priority` : null;
    }
    case "friend_request_received":
    case "friend_removed":
    case "squad_invitation_from_friend":
      return data.actionUrl || null;
    default:
      return null;
  }
}

function getNotifPrimaryAction(item) {
  // Étape 60 — prefer normalized action.
  if (item.action && (item.action.label || item.action.url)) {
    return {
      label: item.action.label || "Ouvrir",
      url: item.action.url || getNotificationUrl(item)
    };
  }
  const data = item.data || {};
  const primary = data.actions && data.actions.primary;
  const url = (primary && primary.url) || getNotificationUrl(item);
  if (primary && primary.label) {
    return { label: primary.label, url };
  }
  const defaults = {
    friend_request_accepted: "Comparer avec l'ami",
    friend_acquired_missing_variant: "Comparer la variante",
    squad_completion_increased: "Squad Completion Engine",
    priority_variant_available: "Voir la variante",
    wanted_event_ending_soon: "Priorités de l'événement"
  };
  return {
    label: defaults[item.type] || "Ouvrir",
    url
  };
}

function renderNotifItem(item) {
  const isUnread = item.isRead === false || (item.isRead == null && !item.read_at);
  const date = formatNotifDate(item.createdAt || item.created_at);
  const catKey = notifDisplayCategory(item);
  const catLabel = notifCategoryLabel(catKey);
  const icon = NOTIF_ICONS[catKey] || NOTIF_ICONS.collection;
  const title = item.title || item.message || "";
  const body = item.body || (item.title && item.message && item.message !== item.title ? item.message : "");
  const action = getNotifPrimaryAction(item);
  // Notification metadata is persisted server-side and can contain legacy
  // action URLs.  Do not let a stored `javascript:`/external URL become a
  // clickable anchor (middle click and keyboard activation bypass our normal
  // delegated click handler).
  const url = safeAppPath(action.url, `#notif-${encodeURIComponent(String(item.id || ""))}`);
  const readLabel = isUnread ? "Non lu" : "Lu";

  return `
    <a class="notif-item${isUnread ? " notif-item--unread" : ""}" href="${escapeHtml(url)}" data-notif-id="${escapeHtml(String(item.id))}" data-notif-type="${escapeHtml(String(item.type || ""))}" data-unread="${isUnread ? "1" : "0"}">
      <div class="notif-item__icon notif-item__icon--${catKey}" aria-hidden="true">${icon}</div>
      <div class="notif-item__body">
        <div class="notif-item__top">
          <p class="notif-item__title">${escapeHtml(title)}</p>
          <span class="notif-item__state${isUnread ? " notif-item__state--unread" : ""}">${readLabel}</span>
        </div>
        ${body ? `<p class="notif-item__desc">${escapeHtml(body)}</p>` : ""}
        <div class="notif-item__meta">
          <span class="notif-item__category">${escapeHtml(catLabel)}</span>
          <span class="notif-item__date">${escapeHtml(date)}</span>
        </div>
        <div class="notif-item__actions">
          <span class="notif-item__action">${escapeHtml(action.label)}</span>
        </div>
      </div>
    </a>`;
}

function notifQueryParams() {
  const params = new URLSearchParams();
  params.set("limit", "20");
  params.set("offset", String(notifOffset));
  if (notifFilter && notifFilter !== "all") {
    params.set("filter", notifFilter);
  }
  return params.toString();
}

async function loadMoreNews() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || notifLoading || !notifHasMore) return;
  notifLoading = true;

  const list = document.getElementById("notifList");
  if (!list) { notifLoading = false; return; }

  const loader = document.getElementById("notifLoader");
  if (!loader && notifOffset === 0) {
    list.innerHTML = `<p class="notif-dropdown__empty" id="notifLoader">Chargement…</p>`;
  } else if (!loader) {
    list.insertAdjacentHTML("beforeend", `<p class="notif-dropdown__empty" id="notifLoader">Chargement…</p>`);
  }

  try {
    const res = await fetch(`${API_BASE}/notifications?${notifQueryParams()}`, { headers: authHeadersOnly() });
    const loaderEl = document.getElementById("notifLoader");
    if (loaderEl) loaderEl.remove();

    if (!res.ok) {
      if (notifOffset === 0) list.innerHTML = `<p class="notif-dropdown__empty">Erreur.</p>`;
      notifLoading = false;
      return;
    }

    const data = await res.json();
    if (typeof data.unreadCount === "number") updateNotifBadge(data.unreadCount);

    const notifications = data.notifications || [];
    notifHasMore = notifications.length === 20;

    if (notifications.length === 0 && notifOffset === 0) {
      const emptyLabel = notifFilter === "unread"
        ? "Aucune notification non lue."
        : notifFilter === "all"
          ? "Aucune notification."
          : `Aucune notification · ${NOTIF_FILTER_LABELS[notifFilter] || ""}.`;
      list.innerHTML = `<p class="notif-dropdown__empty">${emptyLabel}</p>`;
      notifLoading = false;
      return;
    }

    for (const item of notifications) notifItemsById.set(String(item.id), item);
    list.insertAdjacentHTML("beforeend", notifications.map(item => renderNotifItem(item)).join(""));
    notifOffset += notifications.length;

    if (!notifHasMore && notifications.length > 0) {
      list.insertAdjacentHTML("beforeend", `<p class="notif-dropdown__end">Fin</p>`);
    }
  } catch (e) {
    if (notifOffset === 0) list.innerHTML = `<p class="notif-dropdown__empty">Erreur réseau.</p>`;
  }
  notifLoading = false;
}

function paintNotifItemRead(itemEl) {
  if (!itemEl) return;
  itemEl.classList.remove("notif-item--unread");
  itemEl.dataset.unread = "0";
  const stateEl = itemEl.querySelector(".notif-item__state");
  if (stateEl) {
    stateEl.textContent = "Lu";
    stateEl.classList.remove("notif-item__state--unread");
  }
}

/** Étape 47 — mark read; pass clicked:true when the user opens the notification. */
async function markNotifRead(id, { clicked = false } = {}) {
  if (!id) return null;
  try {
    const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(id)}/read`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ clicked: !!clicked })
    });
    if (!res.ok) return null;
    return res.json().catch(() => ({ ok: true }));
  } catch {
    return null;
  }
}

async function markAllNotifsRead() {
  try {
    await fetch(`${API_BASE}/notifications/read-all`, {
      method: "POST",
      headers: authHeaders()
    });
    updateNotifBadge(0);
    document.querySelectorAll(".notif-item").forEach((el) => paintNotifItemRead(el));
  } catch { /* silent */ }
}

function switchAppView(view) {
  if (typeof activateMainView === "function" && activateMainView(view, { force: true })) return;
  const tab = document.querySelector(`.tab[data-view="${view}"]`);
  if (tab) tab.click();
}

async function openCompareDestination(friendId, { variantIds = null } = {}) {
  if (!friendId) {
    if (typeof toast === "function") toast("Ami introuvable pour la comparaison.");
    return false;
  }
  state.compareFocusVariantIds = Array.isArray(variantIds) && variantIds.length
    ? variantIds.map(String)
    : null;
  state.compareFilter = "all";
  if (typeof compareWithUser === "function") {
    await compareWithUser(friendId);
  } else if (typeof compareWithFriend === "function") {
    await compareWithFriend(friendId, friendId);
  } else {
    return false;
  }
  if (state.compareFocusVariantIds && state.compareFocusVariantIds.length) {
    requestAnimationFrame(() => {
      const id = state.compareFocusVariantIds[0];
      const row = document.querySelector(`.compare-table__row[data-variant-id="${CSS.escape(String(id))}"]`);
      if (row) {
        row.classList.add("compare-table__row--focus");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
  return true;
}

async function openSquadEngineDestination(squadRef) {
  if (!squadRef) {
    if (typeof toast === "function") toast("Escouade introuvable.");
    return false;
  }
  // Étape 58 — private squad destinations require active membership.
  switchAppView("social");
  if (typeof setSocialTab === "function") setSocialTab("squad");
  if (typeof setCompareMode === "function") setCompareMode("squad");
  if (typeof loadSquad === "function") await loadSquad(squadRef);
  if (!state.activeSquad) {
    if (typeof toast === "function") {
      toast("Vous n'avez plus accès à cette escouade.");
    }
    return false;
  }
  if (typeof showSquadEngine === "function") {
    showSquadEngine();
    return true;
  }
  return !!state.activeSquad;
}

function openVariantDestination({ variantId: targetVariantId = null, spriteId = null, variantType = null } = {}) {
  if (targetVariantId && typeof openDetail === "function") {
    const items = typeof getAllItems === "function" ? getAllItems() : [];
    const match = items.find((i) => String(i.id) === String(targetVariantId) || String(i.variantId) === String(targetVariantId));
    if (match) {
      openDetail(match.id);
      return true;
    }
    openDetail(String(targetVariantId));
    return true;
  }
  if (spriteId && variantType && typeof openDetail === "function") {
    openDetail(variantId(spriteId, variantType));
    return true;
  }
  if (spriteId && typeof openSpriteDetail === "function") {
    openSpriteDetail(spriteId);
    return true;
  }
  if (typeof toast === "function") toast("Variante introuvable.");
  return false;
}

function openEventPrioritiesDestination(eventId, variantIds = null) {
  if (!eventId && !(Array.isArray(variantIds) && variantIds.length)) {
    if (typeof toast === "function") toast("Événement introuvable.");
    return false;
  }
  state.missingEventFilter = {
    eventId: eventId ? String(eventId) : null,
    variantIds: Array.isArray(variantIds) ? variantIds.map(String) : null
  };
  switchAppView("missing");
  if (typeof renderMissing === "function") renderMissing();
  const eventName = eventId && typeof EVENTS !== "undefined"
    ? (EVENTS[eventId]?.name || eventId)
    : "événement";
  if (typeof toast === "function") toast(`Priorités manquantes · ${eventName}`);
  return true;
}

/**
 * Étape 48 — open the precise screen for a notification type.
 * Never falls back to the home page.
 */
async function openNotificationDestination(item) {
  if (!item) return false;
  const data = item.data || item.context || {};
  const type = item.type;
  const actorId = (item.actor && item.actor.id) || data.friendId || item.actor_id;
  const entityId = (item.entity && item.entity.id) || item.entity_id;

  // Étape 58 — destinations revoked after leaving a squad.
  if (data.accessRevoked && (type === "squad_completion_increased" || String(type || "").startsWith("squad_"))) {
    if (typeof toast === "function") toast("Vous n'avez plus accès à cette escouade.");
    return false;
  }

  if (type === "friend_request_accepted") {
    return openCompareDestination(actorId);
  }

  if (type === "friend_acquired_missing_variant") {
    const friendId = actorId;
    const ids = Array.isArray(data.variantIds) && data.variantIds.length
      ? data.variantIds
      : (data.variantId || entityId ? [data.variantId || entityId] : null);
    return openCompareDestination(friendId, { variantIds: ids });
  }

  if (type === "squad_completion_increased") {
    return openSquadEngineDestination(data.squadCode || data.squadId || entityId);
  }

  if (type === "priority_variant_available") {
    return openVariantDestination({
      variantId: data.variantId || entityId,
      spriteId: data.spriteId,
      variantType: data.variantType
    });
  }

  if (type === "wanted_event_ending_soon") {
    return openEventPrioritiesDestination(
      data.eventId || item.entity_id,
      data.remainingPriorityVariantIds || data.variantIds
    );
  }

  // Legacy / unknown types: resolve via deep link, but never "/".
  const url = getNotificationUrl(item);
  if (!url || url === "/" || url.startsWith("#")) {
    if (typeof toast === "function") toast("Destination indisponible pour cette notification.");
    return false;
  }
  return openNotificationTarget(url);
}

/** URL-based fallback for non-catalog deep links (never home). */
async function openNotificationTarget(url) {
  if (!url || url === "/" || url === "#" || String(url).startsWith("#")) return false;
  let parsed;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return false;
  }
  const current = new URL(window.location.href);
  if (parsed.protocol !== current.protocol || parsed.host !== current.host) return false;
  const path = parsed.pathname;
  const params = parsed.searchParams;

  const compareMatch = path.match(/^\/compare\/([^/]+)\/?$/);
  if (compareMatch) {
    const variantId = params.get("variantId");
    return openCompareDestination(decodeURIComponent(compareMatch[1]), {
      variantIds: variantId ? [variantId] : null
    });
  }

  const engineMatch = path.match(/^\/squad\/([^/]+)\/engine\/?$/);
  if (engineMatch) {
    return openSquadEngineDestination(decodeURIComponent(engineMatch[1]));
  }

  const squadMatch = path.match(/^\/squad\/([^/]+)\/?$/);
  if (squadMatch) {
    return openSquadEngineDestination(decodeURIComponent(squadMatch[1]));
  }

  const squadCompletionMatch = path.match(/^\/squads\/([^/]+)(?:\/completion)?\/?$/);
  if (squadCompletionMatch) {
    return openSquadEngineDestination(decodeURIComponent(squadCompletionMatch[1]));
  }

  const spriteMatch = path.match(/^\/sprites\/([^/]+)\/?$/);
  if (spriteMatch) {
    return openVariantDestination({
      spriteId: decodeURIComponent(spriteMatch[1]),
      variantType: params.get("variant")
    });
  }

  const variantMatch = path.match(/^\/variant\/([^/]+)\/?$/);
  if (variantMatch) {
    return openVariantDestination({ variantId: decodeURIComponent(variantMatch[1]) });
  }

  const eventMatch = path.match(/^\/events\/([^/]+)\/?$/);
  if (eventMatch) {
    return openEventPrioritiesDestination(decodeURIComponent(eventMatch[1]));
  }

  if (typeof toast === "function") toast("Destination indisponible pour cette notification.");
  return false;
}

function setupNotifBell() {
  const bell = document.getElementById("notifBell");
  const close = document.getElementById("notifClose");
  const markAll = document.getElementById("notifMarkAllRead");
  const filters = document.getElementById("notifFilters");

  if (bell) {
    bell.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNotifDropdown();
    });
  }
  if (close) {
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeNotifDropdown();
    });
  }
  if (markAll) {
    markAll.addEventListener("click", (e) => {
      e.stopPropagation();
      markAllNotifsRead();
    });
  }
  if (filters) {
    filters.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-notif-filter]");
      if (!btn) return;
      e.stopPropagation();
      setNotifFilter(btn.dataset.notifFilter);
    });
  }

  document.addEventListener("click", (e) => {
    if (!notifDropdownOpen) return;
    const wrap = document.getElementById("notifWrap");
    if (wrap && !wrap.contains(e.target)) {
      closeNotifDropdown();
    }
  });

  const dropdown = document.getElementById("notifDropdown");
  if (dropdown) {
    dropdown.addEventListener("click", (e) => e.stopPropagation());
  }

  const list = document.getElementById("notifList");
  if (list) {
    list.addEventListener("scroll", () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 40) {
        loadMoreNews();
      }
    });
    list.addEventListener("click", (e) => {
      const item = e.target.closest(".notif-item[data-notif-id]");
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      const id = item.dataset.notifId;
      paintNotifItemRead(item);
      closeNotifDropdown();
      // Étape 47/48 — mark read + clicked_at, then open the contextual destination.
      markNotifRead(id, { clicked: true }).then(() => checkNewsNotifications());
      const payload = notifItemsById.get(String(id)) || { id, type: item.dataset.notifType, data: {} };
      openNotificationDestination(payload).catch(() => {});
    });
  }

  setInterval(checkNewsNotifications, 30 * 1000);
}
