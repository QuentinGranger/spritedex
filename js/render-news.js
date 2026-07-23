// ── News : Notification dropdown ──
const NOTIF_SEEN_KEY = "spritedex_news_seen";
let notifDropdownOpen = false;
let notifOffset = 0;
let notifLoading = false;
let notifHasMore = true;

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
    const res = await fetch(`${API_BASE}/notifications?unread=true&limit=50`, { headers: authHeadersOnly() });
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
    notifOffset = 0;
    notifHasMore = true;
    const list = document.getElementById("notifList");
    if (list) list.innerHTML = "";
    loadMoreNews();
  }
}

function closeNotifDropdown() {
  const dropdown = document.getElementById("notifDropdown");
  if (dropdown) dropdown.style.display = "none";
  notifDropdownOpen = false;
}

function getNotificationUrl(item) {
  switch (item.type) {
    case "friend_request_received":
    case "friend_request_accepted":
    case "friend_removed":
      return "/friends";
    case "squad_invitation_from_friend":
      return item.entity_id ? `/squad/${encodeURIComponent(item.entity_id)}` : "/squad";
    case "friend_collection_updated":
    case "friend_priority_match":
      return item.actor_id ? `/collection/${encodeURIComponent(item.actor_id)}` : "/";
    default:
      return "/";
  }
}

function renderNotifItem(item) {
  const isUnread = !item.read_at;
  const date = item.created_at
    ? new Date(item.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : "";
  const url = getNotificationUrl(item);
  const tag = url ? "a" : "div";
  const href = url ? ` href="${url}"` : "";
  return `
    <${tag} class="notif-item${isUnread ? " notif-item--unread" : ""}"${href}>
      <div class="notif-item__body">
        <p class="notif-item__title">${escapeHtml(item.message || "")}</p>
        <div class="notif-item__meta">
          <span class="notif-item__date">${date}</span>
        </div>
      </div>
    </${tag}>`;
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
    const res = await fetch(`${API_BASE}/notifications?limit=20&offset=${notifOffset}`, { headers: authHeadersOnly() });
    const loaderEl = document.getElementById("notifLoader");
    if (loaderEl) loaderEl.remove();

    if (!res.ok) {
      if (notifOffset === 0) list.innerHTML = `<p class="notif-dropdown__empty">Erreur.</p>`;
      notifLoading = false;
      return;
    }

    const data = await res.json();
    const notifications = data.notifications || [];
    notifHasMore = notifications.length === 20;

    if (notifications.length === 0 && notifOffset === 0) {
      list.innerHTML = `<p class="notif-dropdown__empty">Aucune notification.</p>`;
      notifLoading = false;
      return;
    }

    const html = notifications.map(item => renderNotifItem(item)).join("");
    list.insertAdjacentHTML("beforeend", html);

    notifOffset += notifications.length;

    if (notifOffset === notifications.length) {
      fetch(`${API_BASE}/notifications/read-all`, { method: "POST", headers: authHeadersOnly() }).catch(() => {});
      updateNotifBadge(0);
    }

    if (!notifHasMore && notifications.length > 0) {
      list.insertAdjacentHTML("beforeend", `<p class="notif-dropdown__end">Fin</p>`);
    }
  } catch (e) {
    if (notifOffset === 0) list.innerHTML = `<p class="notif-dropdown__empty">Erreur réseau.</p>`;
  }
  notifLoading = false;
}

function setupNotifBell() {
  const bell = document.getElementById("notifBell");
  const close = document.getElementById("notifClose");
  const title = document.querySelector(".notif-dropdown__title");
  if (title) title.textContent = "Notifications";

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
  }

  setInterval(checkNewsNotifications, 30 * 1000);
}
