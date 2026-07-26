function setupOfflineIndicator() {
  // No visible indicator by design; safe-area padding in CSS keeps the UI clear of
  // the status bar. The sync bar already reports offline state when relevant.
}

function handleInviteLink() {
  const params = new URLSearchParams(location.search);
  const token = params.get("invite");
  if (!token) return;
  history.replaceState(null, "", location.pathname);
  const socialTab = document.querySelector('.tab[data-view="social"]');
  if (socialTab) { socialTab.click(); if (typeof setSocialTab === "function") setSocialTab("friends"); }
  if (!state.userId) {
    toast("Connecte-toi pour accepter l'invitation.");
    return;
  }
  fetch(`${API_BASE}/friends/invite-links/${encodeURIComponent(token)}/use`, {
    method: "POST",
    headers: authHeaders()
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      toast("Demande d'ami envoyée !");
      if (typeof loadFriendsData === "function") loadFriendsData();
    } else {
      toast(data.error || "Lien d'invitation invalide.");
    }
  }).catch(() => toast("Erreur réseau lors de l'invitation."));
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
  const socialTab = document.querySelector('.tab[data-view="social"]');
  if (socialTab) { socialTab.click(); if (typeof setSocialTab === "function") setSocialTab("squad"); }
  if (typeof setCompareMode === "function") setCompareMode("squad");
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

// Completes an OAuth login from a one-time code. Shared by the web return flow
// (query string) and the native deep-link flow (js/mobile.js). The code only
// works with the verifier generated before the OAuth redirect.
async function applyAuthParams(params) {
  const authCode = params.get("authCode");
  const authError = params.get("authError");

  if (authError) {
    sessionStorage.removeItem(window.OAUTH_EXCHANGE_VERIFIER_KEY || "spritedex_oauth_exchange_verifier");
    const messages = {
      invalid_state: "Session expirée (cookie bloqué). Réessaie.",
      token_failed: "Clé/secret OAuth invalide côté serveur.",
      no_email: "Aucune adresse email fournie par le provider.",
      unverified_email: "L'adresse email fournie par le provider n'est pas vérifiée.",
      invalid_exchange: "La connexion sécurisée a expiré. Réessaie.",
      server_error: "Erreur serveur OAuth. Réessaie."
    };
    toast(messages[authError] || `Erreur OAuth : ${authError}`);
    return false;
  }

  if (authCode) {
    const verifierKey = window.OAUTH_EXCHANGE_VERIFIER_KEY || "spritedex_oauth_exchange_verifier";
    const verifier = sessionStorage.getItem(verifierKey);
    if (!verifier) {
      toast("Connexion sécurisée expirée. Réessaie.");
      return false;
    }
    try {
      const response = await fetch(`${API_BASE}/auth/oauth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: authCode, verifier })
      });
      const user = await response.json().catch(() => ({}));
      if (!response.ok || !user.token) {
        throw new Error(user.error || "Connexion OAuth expirée. Réessaie.");
      }
      sessionStorage.removeItem(verifierKey);
      localStorage.setItem(TOKEN_KEY, user.token);
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
      handleInviteLink();
      setupNotifBell();
      checkNewsNotifications();
      toast(`Bienvenue ${user.username} !`);
      return true;
    } catch (e) {
      console.error("OAuth return parse error:", e);
      toast(e.message || "Connexion OAuth impossible. Réessaie.");
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

  if (params.get("authError") || params.get("authCode")) {
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
        await handleCompareParams();
        await handleCompareShareParams();
        await handleCompareUserParams();
        await restoreSquad();
        handleJoinLink();
        handleInviteLink();
        setupNotifBell();
        checkNewsNotifications();
        if (window.PushClient) {
          window.PushClient.register();
          if (window.PushClient.checkReactivation) window.PushClient.checkReactivation();
        }
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
      await handleCompareParams();
      await handleCompareShareParams();
      await handleCompareUserParams();
      await restoreSquad();
      handleJoinLink();
      handleInviteLink();
      setupNotifBell();
      checkNewsNotifications();
      if (window.PushClient) {
        window.PushClient.register();
        if (window.PushClient.checkReactivation) window.PushClient.checkReactivation();
      }
      return;
    }
  }

  setupLogin();
}

init();
