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
  try {
    const res = await fetch(`${API_BASE}/news?limit=20`);
    if (!res.ok) return;
    const data = await res.json();
    const news = data.news || [];
    const seen = getSeenNewsIds();
    const unseen = news.filter(n => !seen.includes(n.id));
    updateNotifBadge(unseen.length);
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

function renderNotifItem(item, seen) {
  const isUnread = !seen.includes(item.id);
  const date = item.news_date
    ? new Date(item.news_date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : "";
  const sourceLabel = item.source.includes("fortnite.gg") ? "fortnite.gg" : item.source.includes("en") ? "EN" : "FR";
  const img = item.image
    ? `<img class="notif-item__img" src="${item.image}" alt="" loading="lazy"/>`
    : "";
  const link = item.link || null;
  const tag = link ? "a" : "div";
  const href = link ? ` href="${link}" target="_blank" rel="noopener"` : "";
  return `
    <${tag} class="notif-item${isUnread ? " notif-item--unread" : ""}"${href}>
      ${img}
      <div class="notif-item__body">
        <p class="notif-item__title">${item.title}</p>
        <p class="notif-item__desc">${(item.description || "").slice(0, 120)}</p>
        <div class="notif-item__meta">
          <span class="notif-item__source">${sourceLabel}</span>
          <span class="notif-item__date">${date}</span>
        </div>
      </div>
    </${tag}>`;
}

async function loadMoreNews() {
  if (notifLoading || !notifHasMore) return;
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
    const res = await fetch(`${API_BASE}/news?limit=15&offset=${notifOffset}`);
    const loaderEl = document.getElementById("notifLoader");
    if (loaderEl) loaderEl.remove();

    if (!res.ok) {
      if (notifOffset === 0) list.innerHTML = `<p class="notif-dropdown__empty">Erreur.</p>`;
      notifLoading = false;
      return;
    }

    const data = await res.json();
    const news = data.news || [];
    notifHasMore = data.hasMore;

    if (news.length === 0 && notifOffset === 0) {
      list.innerHTML = `<p class="notif-dropdown__empty">Aucune actu récente.</p>`;
      notifLoading = false;
      return;
    }

    const seen = getSeenNewsIds();
    const html = news.map(item => renderNotifItem(item, seen)).join("");
    list.insertAdjacentHTML("beforeend", html);

    notifOffset += news.length;
    markNewsSeen(news.map(n => n.id));

    if (!notifHasMore) {
      list.insertAdjacentHTML("beforeend", `<p class="notif-dropdown__end">Fin des actus</p>`);
    }
  } catch (e) {
    if (notifOffset === 0) list.innerHTML = `<p class="notif-dropdown__empty">Erreur réseau.</p>`;
  }
  notifLoading = false;
}

function setupNotifBell() {
  const bell = document.getElementById("notifBell");
  const close = document.getElementById("notifClose");

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

  setInterval(checkNewsNotifications, 5 * 60 * 1000);
}
