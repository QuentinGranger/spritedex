function setupOfflineIndicator() {
  const indicator = document.createElement("div");
  indicator.className = "offline-indicator";
  indicator.id = "offlineIndicator";
  indicator.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg> Hors ligne`;
  document.body.appendChild(indicator);

  function update() {
    indicator.classList.toggle("visible", !navigator.onLine);
  }
  window.addEventListener("online", () => {
    update();
    toast("Connexion rétablie — synchronisation...");
    if (state.userId) {
      fullSync().then(() => toast("Synchronisation terminée"));
    }
  });
  window.addEventListener("offline", update);
  update();
}

function handleJoinLink() {
  const params = new URLSearchParams(location.search);
  const code = params.get("joinSquad");
  if (!code) return;
  history.replaceState(null, "", location.pathname);
  if (state.activeSquad) {
    toast("Tu es déjà dans une escouade. Quitte-la d'abord.");
    return;
  }
  els.squadCodeInput.value = code;
  joinSquad();
}

// If opened with a "?share=<token>" link, render a standalone read-only view
// of the shared collection and stop the normal app boot. Works whether or not
// the visitor is logged in.
async function handleShareLink() {
  const params = new URLSearchParams(location.search);
  const token = params.get("share");
  if (!token) return false;
  try {
    const res = await fetch(`${API_BASE}/shared/${encodeURIComponent(token)}`);
    if (res.ok) {
      renderSharedProfile(await res.json());
    } else {
      renderSharedError();
    }
  } catch {
    renderSharedError();
  }
  return true;
}

// Completes an OAuth login from a set of URL params. Shared by the web return
// flow (query string) and the native deep-link flow (js/mobile.js). Returns
// true when a session was established.
async function applyAuthParams(params) {
  const authToken = params.get("authToken");
  const authUserStr = params.get("authUser");
  const authError = params.get("authError");

  if (authError) {
    const messages = {
      invalid_state: "Session expirée (cookie bloqué). Réessaie.",
      token_failed: "Clé/secret OAuth invalide côté serveur.",
      no_email: "Aucune adresse email fournie par le provider.",
      server_error: "Erreur serveur OAuth. Réessaie."
    };
    toast(messages[authError] || `Erreur OAuth : ${authError}`);
    return false;
  }

  if (authToken && authUserStr) {
    try {
      const user = JSON.parse(authUserStr);
      localStorage.setItem(TOKEN_KEY, authToken);
      localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, username: user.username, created_at: user.created_at }));
      if (user.avatar_url) localStorage.setItem("spritedex_avatar", user.avatar_url);
      localStorage.setItem("spritedex_email_verified", "true");
      state.userId = user.id;
      state.username = user.username;
      await load();
      localStorage.setItem("spritedex_last_sync", new Date().toISOString());
      showApp();
      setupEvents();
      setupAccountPanel();
      buildDeck();
      renderAll();
      await restoreSquad();
      handleJoinLink();
      setupNotifBell();
      checkNewsNotifications();
      toast(`Bienvenue ${user.username} !`);
      return true;
    } catch (e) {
      console.error("OAuth return parse error:", e);
    }
  }
  return false;
}

// Web OAuth return: reads the query string, handles email verification, then
// delegates the session setup to applyAuthParams().
async function handleOAuthReturn() {
  const params = new URLSearchParams(location.search);
  const emailVerified = params.get("emailVerified");

  if (emailVerified) {
    history.replaceState(null, "", location.pathname);
    if (emailVerified === "true") {
      localStorage.setItem("spritedex_email_verified", "true");
      setTimeout(() => toast("Email vérifié avec succès !"), 500);
    } else {
      setTimeout(() => toast("Lien de vérification invalide ou expiré."), 500);
    }
  }

  if (params.get("authError") || (params.get("authToken") && params.get("authUser"))) {
    history.replaceState(null, "", location.pathname);
    return applyAuthParams(params);
  }
  return false;
}

async function init() {
  const theme = localStorage.getItem(THEME_KEY);
  if (theme === "light") document.body.classList.add("light");

  initCguListeners();
  showCookieBanner();
  setupOfflineIndicator();

  await loadSpritesFromAPI();

  // Read-only shared profile link takes over the whole page.
  if (await handleShareLink()) return;

  // Handle OAuth callback redirect
  if (await handleOAuthReturn()) return;

  const savedUser = localStorage.getItem(USER_KEY);
  const savedToken = localStorage.getItem(TOKEN_KEY);
  if (savedUser && savedToken) {
    try {
      const verifyRes = await fetch(`${API_BASE}/auth/me`, { headers: authHeadersOnly() });
      if (verifyRes.ok) {
        const user = await verifyRes.json();
        state.userId = user.id;
        state.username = user.username;
        localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, username: user.username, created_at: user.created_at }));
        if (user.avatar_url) localStorage.setItem("spritedex_avatar", user.avatar_url);
        if (user.privacy) localStorage.setItem("spritedex_privacy", user.privacy);
        localStorage.setItem("spritedex_email_verified", user.email_verified ? "true" : "false");
        await load();
        showApp();
        setupEvents();
        setupAccountPanel();
        buildDeck();
        renderAll();
        await restoreSquad();
        handleJoinLink();
        setupNotifBell();
        checkNewsNotifications();
        if (window.PushClient) window.PushClient.register();
        return;
      } else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    } catch {
      const user = JSON.parse(savedUser);
      state.userId = user.id;
      state.username = user.username;
      await load();
      showApp();
      setupEvents();
      setupAccountPanel();
      buildDeck();
      renderAll();
      await restoreSquad();
      handleJoinLink();
      setupNotifBell();
      checkNewsNotifications();
      if (window.PushClient) window.PushClient.register();
      return;
    }
  }

  setupLogin();
}

init();
