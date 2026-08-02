const OAUTH_EXCHANGE_VERIFIER_KEY = "sprite-index_oauth_exchange_verifier";
window.OAUTH_EXCHANGE_VERIFIER_KEY = OAUTH_EXCHANGE_VERIFIER_KEY;
const PENDING_VERIFY_KEY = "sprite-index_pending_email_verify";
const PENDING_VERIFY_EMAIL_KEY = "sprite-index_pending_email_address";
const VERIFY_RESEND_COOLDOWN_MS = 45_000;

function showApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").style.display = "";
}

function showLoginScreen() {
  const shell = document.getElementById("appShell");
  if (shell) shell.style.display = "none";
  document.getElementById("loginScreen")?.classList.remove("hidden");
}

function goToStep(stepId) {
  document.querySelectorAll(".onboarding-step").forEach(s => s.classList.remove("active"));
  document.getElementById(stepId).classList.add("active");
  document.getElementById("loginHint").textContent = "";
  if (stepId !== "onboardingStepVerifyEmail") {
    setVerifyStatus("");
  }
}

function clearAuthSessionLocal() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("sprite-index_email_verified");
  localStorage.removeItem(PENDING_VERIFY_KEY);
  localStorage.removeItem(PENDING_VERIFY_EMAIL_KEY);
  state.userId = null;
  state.username = null;
}

function setVerifyStatus(message, tone = "") {
  const el = document.getElementById("verifyEmailStatus");
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    el.className = "verify-panel__status";
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.className = `verify-panel__status${tone ? ` verify-panel__status--${tone}` : ""}`;
}

function renderPendingVerifyEmail(email) {
  const el = document.getElementById("verifyEmailAddress");
  if (!el) return;
  const value = String(email || localStorage.getItem(PENDING_VERIFY_EMAIL_KEY) || "").trim();
  if (!value) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  localStorage.setItem(PENDING_VERIFY_EMAIL_KEY, value);
  el.hidden = false;
  el.textContent = t("login.verifySentTo", { email: value });
}

/** Keep the session for resend/check, but block the app until /auth/me says verified. */
function enterEmailVerificationGate(user = {}) {
  if (user.id) {
    state.userId = user.id;
    state.username = user.username || state.username;
    localStorage.setItem(USER_KEY, JSON.stringify({
      id: user.id,
      username: user.username || "",
      created_at: user.created_at || null
    }));
  }
  if (user.token) localStorage.setItem(TOKEN_KEY, user.token);
  localStorage.setItem("sprite-index_email_verified", "false");
  localStorage.setItem(PENDING_VERIFY_KEY, "1");
  if (user.email) localStorage.setItem(PENDING_VERIFY_EMAIL_KEY, String(user.email).trim());
  showLoginScreen();
  goToStep("onboardingStepVerifyEmail");
  renderPendingVerifyEmail(user.email);
  setVerifyStatus(t("login.verifyWaiting"), "wait");
  if (typeof window.startEmailVerificationPolling === "function") {
    window.startEmailVerificationPolling();
  }
}

window.enterEmailVerificationGate = enterEmailVerificationGate;
window.showLoginScreen = showLoginScreen;

function setupLogin() {
  const loginHint = document.getElementById("loginHint");
  const loginEmailBtn = document.getElementById("loginEmailBtn");
  const registerEmailBtn = document.getElementById("registerEmailBtn");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const registerEmail = document.getElementById("registerEmail");
  const registerPassword = document.getElementById("registerPassword");
  const registerUsername = document.getElementById("registerUsername");
  const oauthButtons = [
    document.getElementById("authGoogle"),
    document.getElementById("authDiscord"),
    document.getElementById("authGoogleLogin"),
    document.getElementById("authDiscordLogin")
  ].filter(Boolean);
  let oauthInProgress = false;
  let pendingUser = null;
  let pendingAfterVerify = null; // "profile" | "app"
  let verifyPollTimer = null;
  let verifyResendUntil = 0;
  let verifyResendTick = null;
  let verifyUnlocking = false;

  function setOAuthInProgress(inProgress) {
    oauthInProgress = inProgress;
    oauthButtons.forEach((button) => { button.disabled = inProgress; });
  }

  function stopEmailVerificationPolling() {
    if (verifyPollTimer) {
      clearInterval(verifyPollTimer);
      verifyPollTimer = null;
    }
  }

  function startEmailVerificationPolling() {
    stopEmailVerificationPolling();
    verifyPollTimer = setInterval(() => {
      const step = document.getElementById("onboardingStepVerifyEmail");
      if (!step?.classList.contains("active") || document.hidden) return;
      void tryUnlockAfterVerification({ silent: true });
    }, 4000);
  }

  window.startEmailVerificationPolling = startEmailVerificationPolling;

  function updateResendCooldownLabel() {
    const btn = document.getElementById("verifyEmailResendBtn");
    if (!btn) return;
    const remaining = Math.max(0, Math.ceil((verifyResendUntil - Date.now()) / 1000));
    if (remaining <= 0) {
      btn.disabled = false;
      btn.textContent = t("login.verifyResend");
      if (verifyResendTick) {
        clearInterval(verifyResendTick);
        verifyResendTick = null;
      }
      return;
    }
    btn.disabled = true;
    btn.textContent = t("login.verifyResendIn", { seconds: remaining });
  }

  function startResendCooldown(ms = VERIFY_RESEND_COOLDOWN_MS) {
    verifyResendUntil = Date.now() + ms;
    updateResendCooldownLabel();
    if (verifyResendTick) clearInterval(verifyResendTick);
    verifyResendTick = setInterval(updateResendCooldownLabel, 250);
  }

  // Navigation between steps
  document.getElementById("authEmailChoice").addEventListener("click", () => goToStep("onboardingStepRegister"));
  document.getElementById("goToLogin").addEventListener("click", () => goToStep("onboardingStepLogin"));
  document.getElementById("goToRegister").addEventListener("click", () => goToStep("onboardingStepRegister"));
  document.getElementById("backFromLogin").addEventListener("click", () => goToStep("onboardingStep1"));
  document.getElementById("backFromRegister").addEventListener("click", () => goToStep("onboardingStep1"));
  document.getElementById("backFromVerifyEmail")?.addEventListener("click", async () => {
    stopEmailVerificationPolling();
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeadersOnly() });
    } catch { /* ignore */ }
    clearAuthSessionLocal();
    pendingUser = null;
    pendingAfterVerify = null;
    setVerifyStatus("");
    goToStep("onboardingStep1");
  });
  document.getElementById("loginInviteCreate")?.addEventListener("click", () => {
    goToStep("onboardingStepRegister");
    document.getElementById("registerUsername")?.focus();
  });
  document.getElementById("loginInviteSignIn")?.addEventListener("click", () => {
    goToStep("onboardingStepLogin");
    document.getElementById("loginEmail")?.focus();
  });

  async function finishLogin(user) {
    state.userId = user.id;
    state.username = user.username;
    if (user.token) localStorage.setItem(TOKEN_KEY, user.token);
    localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, username: user.username, created_at: user.created_at }));
    if (user.avatar_url) localStorage.setItem("sprite-index_avatar", user.avatar_url);
    if (user.privacy) localStorage.setItem("sprite-index_privacy", user.privacy);
    if (user.emailVerified !== true) {
      enterEmailVerificationGate(user);
      return;
    }
    stopEmailVerificationPolling();
    localStorage.setItem("sprite-index_email_verified", "true");
    localStorage.removeItem(PENDING_VERIFY_KEY);
    localStorage.removeItem(PENDING_VERIFY_EMAIL_KEY);
    await load();
    localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
    showApp();
    setupEvents();
    setupAccountPanel();
    buildDeck();
    renderAll();
    await restoreSquad();
    // Keep invitations opened before authentication actionable after email login
    // or registration, just like the OAuth return flow does.
    if (typeof handleJoinLink === "function") handleJoinLink();
    if (typeof handleInviteLink === "function") handleInviteLink();
    setupNotifBell();
    checkNewsNotifications();
    if (window.PushClient) {
      window.PushClient.register();
      if (window.PushClient.checkReactivation) window.PushClient.checkReactivation();
    }
    toast(t("login.welcomeUser", { name: user.username }));
  }

  async function continueAfterEmailVerified(user) {
    stopEmailVerificationPolling();
    localStorage.setItem("sprite-index_email_verified", "true");
    localStorage.removeItem(PENDING_VERIFY_KEY);
    localStorage.removeItem(PENDING_VERIFY_EMAIL_KEY);
    const nextMode = pendingAfterVerify
      || sessionStorage.getItem("sprite-index_after_verify")
      || "app";
    pendingAfterVerify = null;
    sessionStorage.removeItem("sprite-index_after_verify");
    if (nextMode === "profile" && (pendingUser || user)) {
      const base = pendingUser || user;
      pendingUser = { ...base, emailVerified: true };
      document.getElementById("profileUsername").value = base.username || "";
      goToStep("onboardingStepProfile");
      return;
    }
    await finishLogin(user || pendingUser || {
      id: state.userId,
      username: state.username,
      token: localStorage.getItem(TOKEN_KEY),
      emailVerified: true
    });
    pendingUser = null;
  }

  window.continueAfterEmailVerified = continueAfterEmailVerified;

  async function refreshEmailVerificationStatus() {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeadersOnly() });
    if (!res.ok) return { ok: false };
    const user = await res.json();
    return {
      ok: true,
      verified: !!(user.email_verified || user.emailVerified),
      user: {
        id: user.id,
        username: user.username,
        created_at: user.created_at,
        avatar_url: user.avatar_url,
        privacy: user.privacy,
        email: user.email || localStorage.getItem(PENDING_VERIFY_EMAIL_KEY) || "",
        emailVerified: !!(user.email_verified || user.emailVerified),
        token: localStorage.getItem(TOKEN_KEY)
      }
    };
  }

  async function tryUnlockAfterVerification({ silent = false } = {}) {
    if (verifyUnlocking) return false;
    verifyUnlocking = true;
    const checkBtn = document.getElementById("verifyEmailCheckBtn");
    const previous = checkBtn?.textContent;
    if (!silent && checkBtn) {
      checkBtn.disabled = true;
      checkBtn.textContent = t("login.verifyChecking");
    }
    try {
      const status = await refreshEmailVerificationStatus();
      if (!status.ok) {
        if (!silent) setVerifyStatus(t("login.serverUnreachable"), "warn");
        return false;
      }
      if (status.user.email) renderPendingVerifyEmail(status.user.email);
      if (!status.verified) {
        if (!silent) setVerifyStatus(t("login.verifyStillPending"), "warn");
        else setVerifyStatus(t("login.verifyWaiting"), "wait");
        return false;
      }
      setVerifyStatus(t("login.verifySuccess"), "ok");
      await new Promise((resolve) => setTimeout(resolve, 550));
      await continueAfterEmailVerified(status.user);
      return true;
    } catch {
      if (!silent) setVerifyStatus(t("login.serverUnreachable"), "warn");
      return false;
    } finally {
      verifyUnlocking = false;
      if (!silent && checkBtn && document.getElementById("onboardingStepVerifyEmail")?.classList.contains("active")) {
        checkBtn.disabled = false;
        checkBtn.textContent = previous || t("login.verifyCheck");
      }
    }
  }

  const doEmailLogin = async () => {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
      loginHint.textContent = t("login.emailPasswordRequired");
      return;
    }
    loginHint.textContent = "";
    loginEmailBtn.disabled = true;
    loginEmailBtn.textContent = t("login.signingIn");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("login.badCredentials"));
      if (data.emailVerified === false) {
        pendingUser = { ...data, email };
        pendingAfterVerify = "app";
        sessionStorage.setItem("sprite-index_after_verify", "app");
        enterEmailVerificationGate({ ...data, email });
        startResendCooldown(12_000);
        return;
      }
      await finishLogin(data);
    } catch (e) {
      loginHint.textContent = e.message === "Failed to fetch" ? t("login.serverUnreachable") : t(e.message);
      loginEmailBtn.disabled = false;
      loginEmailBtn.textContent = t("login.signIn");
    }
  };

  const doEmailRegister = async () => {
    const email = registerEmail.value.trim();
    const password = registerPassword.value;
    const username = registerUsername.value.trim();
    if (!username || username.length < 2) {
      loginHint.textContent = t("login.usernameRequired");
      return;
    }
    if (!email || !password) {
      loginHint.textContent = t("login.emailPasswordRequired");
      return;
    }
    if (password.length < 8) {
      loginHint.textContent = t("login.passwordTooShort");
      return;
    }
    if (!requireCguAccepted()) return;

    loginHint.textContent = "";
    registerEmailBtn.disabled = true;
    registerEmailBtn.textContent = t("login.creating");
    try {
      const cguVersion = localStorage.getItem(CGU_VERSION_KEY) || LEGAL_VERSION;
      const cookieConsent = getConsent() || { necessary: true, analytics: false, version: LEGAL_VERSION };
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password, username, cguAccepted: true, cguVersion, ageConfirmed: true, cookieConsent })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t("login.registerFailed"));
      pendingUser = { ...data, email };
      if (data.emailVerified === false) {
        pendingAfterVerify = "profile";
        sessionStorage.setItem("sprite-index_after_verify", "profile");
        enterEmailVerificationGate({ ...data, email });
        startResendCooldown(12_000);
        return;
      }
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      document.getElementById("profileUsername").value = username;
      goToStep("onboardingStepProfile");
    } catch (e) {
      loginHint.textContent = e.message === "Failed to fetch" ? t("login.serverUnreachable") : t(e.message);
      registerEmailBtn.disabled = false;
      registerEmailBtn.textContent = t("login.createMyAccount");
    }
  };

  loginEmailBtn.addEventListener("click", doEmailLogin);
  loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") doEmailLogin(); });
  registerEmailBtn.addEventListener("click", doEmailRegister);
  registerPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") doEmailRegister(); });

  document.getElementById("verifyEmailResendBtn")?.addEventListener("click", async () => {
    if (Date.now() < verifyResendUntil) return;
    const btn = document.getElementById("verifyEmailResendBtn");
    const previous = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("login.verifySending");
    try {
      const res = await fetch(`${API_BASE}/auth/resend-verification`, {
        method: "POST",
        headers: authHeadersOnly()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("login.forgotError"));
      setVerifyStatus(t("login.verifyResent"), "ok");
      startResendCooldown();
    } catch (e) {
      setVerifyStatus(
        e.message === "Failed to fetch" ? t("login.serverUnreachable") : t(e.message),
        "warn"
      );
      btn.disabled = false;
      btn.textContent = previous;
    }
  });

  document.getElementById("verifyEmailCheckBtn")?.addEventListener("click", async () => {
    loginHint.textContent = "";
    await tryUnlockAfterVerification({ silent: false });
  });

  document.getElementById("verifyEmailLogout")?.addEventListener("click", async () => {
    stopEmailVerificationPolling();
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeadersOnly() });
    } catch { /* ignore */ }
    clearAuthSessionLocal();
    pendingUser = null;
    pendingAfterVerify = null;
    setVerifyStatus("");
    goToStep("onboardingStep1");
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && document.getElementById("onboardingStepVerifyEmail")?.classList.contains("active")) {
      void tryUnlockAfterVerification({ silent: true });
    }
  });
  window.addEventListener("focus", () => {
    if (document.getElementById("onboardingStepVerifyEmail")?.classList.contains("active")) {
      void tryUnlockAfterVerification({ silent: true });
    }
  });

  // Forgot password
  const forgotBtn = document.getElementById("forgotPassword");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      const email = loginEmail.value.trim();
      if (!email) {
        loginHint.textContent = t("login.forgotEmailHint");
        loginEmail.focus();
        return;
      }
      forgotBtn.disabled = true;
      try {
        await fetch(`${API_BASE}/auth/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        loginHint.textContent = t("login.forgotEmailSent");
      } catch {
        loginHint.textContent = t("login.forgotError");
      }
      forgotBtn.disabled = false;
    });
  }

  document.getElementById("loginSkip").addEventListener("click", async () => {
    // The login controls are available before the catalogue finishes loading.
    // Do not let a fast "continue as guest" action initialise an empty deck
    // while that request is still in flight.
    if (!SPRITES.length) await loadSpritesFromAPI();
    state.userId = null;
    state.username = "Local";
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { state.collection = sanitizeCollection(JSON.parse(saved)); } catch { state.collection = createSafeRecord(); }
    }
    showApp();
    setupEvents();
    setupAccountPanel();
    buildDeck();
    renderAll();
    updateSyncStatus();
    setupNotifBell();
    checkNewsNotifications();
  });

  // Avatar picker
  const avatarPicker = document.getElementById("avatarPicker");
  let selectedAvatar = "";
  avatarPicker.addEventListener("click", (e) => {
    const item = e.target.closest(".avatar-picker__item");
    if (!item) return;
    avatarPicker.querySelectorAll(".avatar-picker__item").forEach(i => i.classList.remove("selected"));
    item.classList.add("selected");
    selectedAvatar = item.dataset.avatar || "";
  });

  // Local collection count
  function getLocalCollectionCount() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      const coll = JSON.parse(raw);
      return Object.keys(coll).filter(k => !k.startsWith("fav_")).length;
    } catch { return 0; }
  }

  // Profile submit
  document.getElementById("profileSubmitBtn").addEventListener("click", async () => {
    const username = document.getElementById("profileUsername").value.trim();
    if (!username || username.length < 2) {
      loginHint.textContent = t("login.usernameRequired");
      return;
    }
    const privacy = document.querySelector('input[name="privacy"]:checked')?.value || "squad_only";
    loginHint.textContent = "";

    if (pendingUser) {
      try {
        await fetch(`${API_BASE}/profile/${pendingUser.id}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ username, avatarUrl: selectedAvatar, privacy })
        });
      } catch {}
      pendingUser.username = username;
      if (selectedAvatar) localStorage.setItem("sprite-index_avatar", selectedAvatar);
      localStorage.setItem("sprite-index_privacy", privacy);

      // Check if local collection exists → show transfer step
      const localCount = getLocalCollectionCount();
      if (localCount > 0) {
        document.getElementById("transferCount").textContent = localCount;
        goToStep("onboardingStepTransfer");
      } else {
        await finishLogin(pendingUser);
      }
    }
  });

  // Transfer actions
  document.getElementById("transferYes").addEventListener("click", async () => {
    if (!pendingUser) return;
    await finishLogin(pendingUser);
    toast(t("login.collectionTransferred"));
  });

  document.getElementById("transferNo").addEventListener("click", async () => {
    if (!pendingUser) return;
    localStorage.removeItem(STORAGE_KEY);
    state.collection = createSafeRecord();
    await finishLogin(pendingUser);
    toast(t("login.newCollectionCreated"));
  });

  document.getElementById("transferLater").addEventListener("click", async () => {
    if (!pendingUser) return;
    // Keep local data but don't sync now — user can sync later from settings
    state.collection = createSafeRecord();
    await finishLogin(pendingUser);
  });

  // OAuth — use a local high-entropy verifier. The server only receives its
  // SHA-256 challenge and returns a one-time code, never a bearer token in a
  // URL or deep link. This also prevents a different mobile app that captures
  // the custom scheme from redeeming the login result.
  function toBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  async function createOAuthVerifier() {
    if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
      throw new Error(t("login.secureLoginUnsupported"));
    }
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const verifier = toBase64Url(bytes);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    return { verifier, challenge };
  }

  async function startOAuth(provider) {
    // SFSafariViewController can present only one browser at a time. Without
    // this guard, a second tap races the first one and Capacitor rejects it as
    // "Unable to display URL" even though the OAuth URL itself is valid.
    if (oauthInProgress) return;
    setOAuthInProgress(true);
    try {
      const { verifier, challenge } = await createOAuthVerifier();
      sessionStorage.setItem(OAUTH_EXCHANGE_VERIFIER_KEY, verifier);
      const params = new URLSearchParams({ exchange_challenge: challenge });
      if (isNativePlatform() && window.Capacitor?.Plugins?.Browser) {
        params.set("return", "app");
        await window.Capacitor.Plugins.Browser.open({ url: `${API_BASE}/auth/oauth/${provider}?${params}` });
      } else {
        window.location.href = `${API_BASE}/auth/oauth/${provider}?${params}`;
      }
      // Browser.open resolves once the native controller has been presented.
      // Keep only the short opening lock; Safari is then in front of the app,
      // and a permanent lock can get stuck on simulator lifecycle events.
      setOAuthInProgress(false);
    } catch (err) {
      console.error("OAuth initialisation failed:", err);
      loginHint.textContent = err.message ? t(err.message) : t("login.oauthStartFailed");
      setOAuthInProgress(false);
    }
  }
  document.getElementById("authGoogle").addEventListener("click", () => startOAuth("google"));
  document.getElementById("authDiscord").addEventListener("click", () => startOAuth("discord"));
  document.getElementById("authGoogleLogin").addEventListener("click", () => startOAuth("google"));
  document.getElementById("authDiscordLogin").addEventListener("click", () => startOAuth("discord"));

}
