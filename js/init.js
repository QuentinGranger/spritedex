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
    toast(t("init.inviteLoginRequired"));
    return;
  }
  fetch(`${API_BASE}/friends/invite-links/${encodeURIComponent(token)}/use`, {
    method: "POST",
    headers: authHeaders()
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      toast(t("init.friendRequestSent"));
      if (typeof loadFriendsData === "function") loadFriendsData();
    } else {
      toastError(data, "init.inviteLinkInvalid");
    }
  }).catch(() => toast(t("init.inviteNetworkError")));
}

function handleJoinLink() {
  const params = new URLSearchParams(location.search);
  const code = params.get("joinSquad");
  if (!code) return;
  history.replaceState(null, "", location.pathname);
  if (state.activeSquad) {
    toast(t("init.alreadyInSquad"));
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
    sessionStorage.removeItem(window.OAUTH_EXCHANGE_VERIFIER_KEY || "sprite-index_oauth_exchange_verifier");
    const messages = {
      invalid_state: t("login.oauth.invalid_state"),
      token_failed: t("login.oauth.token_failed"),
      no_email: t("login.oauth.no_email"),
      unverified_email: t("login.oauth.unverified_email"),
      invalid_exchange: t("login.oauth.invalid_exchange"),
      server_error: t("login.oauth.server_error")
    };
    toast(messages[authError] || t("login.oauthUnknown", { error: authError }));
    return false;
  }

  if (authCode) {
    const verifierKey = window.OAUTH_EXCHANGE_VERIFIER_KEY || "sprite-index_oauth_exchange_verifier";
    const verifier = sessionStorage.getItem(verifierKey);
    if (!verifier) {
      toast(t("login.oauthExpired"));
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
        throw new Error(user.error || t("login.oauthExchangeExpired"));
      }
      sessionStorage.removeItem(verifierKey);
      localStorage.setItem(TOKEN_KEY, user.token);
      localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, username: user.username, created_at: user.created_at }));
      if (user.avatar_url) localStorage.setItem("sprite-index_avatar", user.avatar_url);
      localStorage.setItem("sprite-index_email_verified", "true");
      state.userId = user.id;
      state.username = user.username;
      await load();
      localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
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
      toast(t("login.welcomeUser", { name: user.username }));
      return true;
    } catch (e) {
      console.error("OAuth return parse error:", e);
      toast(e.message ? t(e.message) : t("login.oauthFailed"));
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
      localStorage.setItem("sprite-index_email_verified", "true");
      setTimeout(() => toast(t("login.emailVerified")), 500);
    } else {
      setTimeout(() => toast(t("login.emailVerifyInvalid")), 500);
    }
  }

  if (params.get("authError") || params.get("authCode")) {
    history.replaceState(null, "", location.pathname);
    return applyAuthParams(params);
  }
  return false;
}

// Étape 67 — public passport URL /u/:username
async function handlePassportPublicUrl() {
  const match = location.pathname.match(/^\/u\/([^/]+)\/?$/i);
  const boot = window.__SPRITE_INDEX_PASSPORT_USER__;
  const username = match
    ? decodeURIComponent(match[1])
    : (boot && boot.username ? boot.username : null);
  if (!username) return false;

  if (state.userId && typeof openCollectorPassportByUsername === "function") {
    await openCollectorPassportByUsername(username, boot && boot.displayName);
    return false;
  }

  // Anonymous visitor: standalone public passport page (like ?share=).
  try {
    const res = await fetch(`${API_BASE}/u/${encodeURIComponent(username)}/passport`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (typeof renderPublicPassportError === "function") {
        renderPublicPassportError(data.error || t("init.passportNotAccessible"));
      } else {
        toastError(data, "init.passportNotAccessible");
      }
      return true;
    }
    if (typeof renderPublicPassportOverlay === "function") {
      renderPublicPassportOverlay(data);
    } else if (typeof openCollectorPassportByUsername === "function") {
      await openCollectorPassportByUsername(username);
    }
  } catch {
    if (typeof renderPublicPassportError === "function") {
      renderPublicPassportError(t("init.passportLoadFailed"));
    }
  }
  return true;
}

async function init() {
  const theme = localStorage.getItem(THEME_KEY);
  if (theme === "light") document.body.classList.add("light");

  initCguListeners();
  showCookieBanner();
  setupOfflineIndicator();

  // Attach the login/navigation controls before waiting for the catalogue.
  // A slow or unreachable API used to leave Google, Discord and Email buttons
  // inert because setupLogin() only ran after this request completed.
  setupLogin();
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
        if (user.avatar_url) localStorage.setItem("sprite-index_avatar", user.avatar_url);
        if (user.privacy) localStorage.setItem("sprite-index_privacy", user.privacy);
        localStorage.setItem("sprite-index_email_verified", user.email_verified ? "true" : "false");
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
        await handlePassportPublicUrl();
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
      await handlePassportPublicUrl();
      setupNotifBell();
      checkNewsNotifications();
      if (window.PushClient) {
        window.PushClient.register();
        if (window.PushClient.checkReactivation) window.PushClient.checkReactivation();
      }
      return;
    }
  }

  // Anonymous public passport URL.
  if (await handlePassportPublicUrl()) return;
}

init();
