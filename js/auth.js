function showApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appShell").style.display = "";
}

function goToStep(stepId) {
  document.querySelectorAll(".onboarding-step").forEach(s => s.classList.remove("active"));
  document.getElementById(stepId).classList.add("active");
  document.getElementById("loginHint").textContent = "";
}

function setupLogin() {
  const loginHint = document.getElementById("loginHint");
  const loginEmailBtn = document.getElementById("loginEmailBtn");
  const registerEmailBtn = document.getElementById("registerEmailBtn");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const registerEmail = document.getElementById("registerEmail");
  const registerPassword = document.getElementById("registerPassword");
  const registerUsername = document.getElementById("registerUsername");

  // Navigation between steps
  document.getElementById("authEmailChoice").addEventListener("click", () => goToStep("onboardingStepRegister"));
  document.getElementById("goToLogin").addEventListener("click", () => goToStep("onboardingStepLogin"));
  document.getElementById("goToRegister").addEventListener("click", () => goToStep("onboardingStepRegister"));
  document.getElementById("backFromLogin").addEventListener("click", () => goToStep("onboardingStep1"));
  document.getElementById("backFromRegister").addEventListener("click", () => goToStep("onboardingStep1"));

  async function finishLogin(user) {
    state.userId = user.id;
    state.username = user.username;
    if (user.token) localStorage.setItem(TOKEN_KEY, user.token);
    localStorage.setItem(USER_KEY, JSON.stringify({ id: user.id, username: user.username, created_at: user.created_at }));
    if (user.avatar_url) localStorage.setItem("spritedex_avatar", user.avatar_url);
    if (user.privacy) localStorage.setItem("spritedex_privacy", user.privacy);
    localStorage.setItem("spritedex_email_verified", user.emailVerified ? "true" : "false");
    await load();
    localStorage.setItem("spritedex_last_sync", new Date().toISOString());
    showApp();
    setupEvents();
    setupAccountPanel();
    buildDeck();
    renderAll();
    restoreSquad();
    setupNotifBell();
    checkNewsNotifications();
    toast(`Bienvenue ${user.username} !`);
  }

  const doEmailLogin = async () => {
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
      loginHint.textContent = "Email et mot de passe requis";
      return;
    }
    if (password.length < 6) {
      loginHint.textContent = "Mot de passe trop court (min 6)";
      return;
    }
    loginHint.textContent = "";
    loginEmailBtn.disabled = true;
    loginEmailBtn.textContent = "Connexion...";
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Identifiants incorrects");
      await finishLogin(data);
    } catch (e) {
      loginHint.textContent = e.message === "Failed to fetch" ? "Impossible de contacter le serveur. Vérifie ta connexion." : e.message;
      loginEmailBtn.disabled = false;
      loginEmailBtn.textContent = "Se connecter";
    }
  };

  let pendingUser = null;

  const doEmailRegister = async () => {
    const email = registerEmail.value.trim();
    const password = registerPassword.value;
    const username = registerUsername.value.trim();
    if (!username || username.length < 2) {
      loginHint.textContent = "Pseudo requis (min 2 caractères)";
      return;
    }
    if (!email || !password) {
      loginHint.textContent = "Email et mot de passe requis";
      return;
    }
    if (password.length < 6) {
      loginHint.textContent = "Mot de passe trop court (min 6)";
      return;
    }
    loginHint.textContent = "";
    registerEmailBtn.disabled = true;
    registerEmailBtn.textContent = "Création...";
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password, username })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inscription impossible");
      pendingUser = data;
      if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
      document.getElementById("profileUsername").value = username;
      goToStep("onboardingStepProfile");
    } catch (e) {
      loginHint.textContent = e.message === "Failed to fetch" ? "Impossible de contacter le serveur. Vérifie ta connexion." : e.message;
      registerEmailBtn.disabled = false;
      registerEmailBtn.textContent = "Créer mon compte";
    }
  };

  loginEmailBtn.addEventListener("click", doEmailLogin);
  loginPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") doEmailLogin(); });
  registerEmailBtn.addEventListener("click", doEmailRegister);
  registerPassword.addEventListener("keydown", (e) => { if (e.key === "Enter") doEmailRegister(); });

  // Forgot password
  const forgotBtn = document.getElementById("forgotPassword");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      const email = loginEmail.value.trim();
      if (!email) {
        loginHint.textContent = "Entre ton email pour réinitialiser";
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
        loginHint.textContent = "Si un compte existe, un email a été envoyé.";
      } catch {
        loginHint.textContent = "Erreur, réessaie plus tard.";
      }
      forgotBtn.disabled = false;
    });
  }

  document.getElementById("loginSkip").addEventListener("click", () => {
    state.userId = null;
    state.username = "Local";
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { state.collection = JSON.parse(saved); } catch {}
    }
    showApp();
    setupEvents();
    buildDeck();
    renderAll();
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
      loginHint.textContent = "Pseudo requis (min 2 caractères)";
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
      if (selectedAvatar) localStorage.setItem("spritedex_avatar", selectedAvatar);
      localStorage.setItem("spritedex_privacy", privacy);

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
    toast("Collection transférée !");
  });

  document.getElementById("transferNo").addEventListener("click", async () => {
    if (!pendingUser) return;
    localStorage.removeItem(STORAGE_KEY);
    state.collection = {};
    await finishLogin(pendingUser);
    toast("Nouvelle collection créée !");
  });

  document.getElementById("transferLater").addEventListener("click", async () => {
    if (!pendingUser) return;
    // Keep local data but don't sync now — user can sync later from settings
    state.collection = {};
    await finishLogin(pendingUser);
  });

  // OAuth — redirect to server-side flow
  function startOAuth(provider) {
    window.location.href = `${API_BASE}/auth/oauth/${provider}`;
  }
  document.getElementById("authGoogle").addEventListener("click", () => startOAuth("google"));
  document.getElementById("authDiscord").addEventListener("click", () => startOAuth("discord"));
  document.getElementById("authGoogleLogin").addEventListener("click", () => startOAuth("google"));
  document.getElementById("authDiscordLogin").addEventListener("click", () => startOAuth("discord"));

}
