/* ── Legal UI helpers: viewer, cookie consent, CGU acceptance ────────────────
 * Depends on js/legal-content.js (loaded before this file).
 */

// Backward-compatible alias map used by older openLegal() calls.
const LEGAL_CONTENT = {
  mentionsLegales: LEGAL_DOCUMENTS["mentions-legales"].content,
  privacyPolicy: LEGAL_DOCUMENTS["politique-confidentialite"].content
};

const LEGAL_SUPPORT_EMAIL = "quentin@tuatha-app.com";

function openLegal(docIdOrAlias) {
  const aliasMap = {
    mentionsLegales: "mentions-legales",
    privacyPolicy: "politique-confidentialite"
  };
  const docId = aliasMap[docIdOrAlias] || docIdOrAlias;
  const doc = LEGAL_DOCUMENTS[docId];
  if (!doc) return;

  const dialog = document.getElementById("legalDialog");
  const container = document.getElementById("legalContent");
  if (!dialog || !container) return;

  container.innerHTML = `
    <div class="legal-header">
      <h3>${doc.title}</h3>
      <span class="legal-version">v${LEGAL_VERSION}</span>
    </div>
    ${doc.content}
  `;
  dialog.showModal();
}

// ── Cookie / tracker consent ───────────────────────────────────────────────
const CONSENT_KEY = "spritedex_consent_v1";
const CONSENT_DATE_KEY = "spritedex_consent_date";

function getConsent() {
  try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || "null"); }
  catch { return null; }
}

function saveConsent(choices) {
  localStorage.setItem(CONSENT_KEY, JSON.stringify(choices));
  localStorage.setItem(CONSENT_DATE_KEY, new Date().toISOString());
}

function hasConsented() {
  return localStorage.getItem(CONSENT_KEY) !== null;
}

function showCookieBanner() {
  if (hasConsented()) return;
  const existing = document.getElementById("cookieBanner");
  if (existing) { existing.style.display = ""; return; }

  const banner = document.createElement("div");
  banner.id = "cookieBanner";
  banner.className = "cookie-banner";
  banner.innerHTML = `
    <div class="cookie-banner__text">
      <strong>Confidentialité et traceurs</strong>
      <p>SpriteDex utilise des traceurs strictement nécessaires au fonctionnement. Les traceurs de mesure d'audience sont désactivés par défaut.</p>
    </div>
    <div class="cookie-banner__actions">
      <button class="cookie-banner__btn cookie-banner__btn--secondary" id="cookieCustomize">Personnaliser</button>
      <button class="cookie-banner__btn cookie-banner__btn--secondary" id="cookieReject">Tout refuser</button>
      <button class="cookie-banner__btn cookie-banner__btn--primary" id="cookieAccept">Tout accepter</button>
    </div>
  `;
  document.body.appendChild(banner);

  banner.querySelector("#cookieAccept").addEventListener("click", () => {
    saveConsent({ necessary: true, analytics: true, version: LEGAL_VERSION });
    banner.remove();
  });
  banner.querySelector("#cookieReject").addEventListener("click", () => {
    saveConsent({ necessary: true, analytics: false, version: LEGAL_VERSION });
    banner.remove();
  });
  banner.querySelector("#cookieCustomize").addEventListener("click", () => {
    openCookiePreferences();
  });
}

function openCookiePreferences() {
  const current = getConsent() || { necessary: true, analytics: false };
  const dialog = document.createElement("dialog");
  dialog.className = "cookie-dialog";
  dialog.innerHTML = `
    <div class="cookie-dialog__card">
      <h3>Gérer mes choix</h3>
      <div class="cookie-option">
        <div>
          <strong>Strictement nécessaires</strong>
          <p>Session, authentification, sauvegarde locale. Toujours actifs.</p>
        </div>
        <label class="toggle"><input type="checkbox" checked disabled /><span class="toggle__slider"></span></label>
      </div>
      <div class="cookie-option">
        <div>
          <strong>Mesure d'audience anonymisée</strong>
          <p>Comprendre comment l'application est utilisée, sans identifier les personnes.</p>
        </div>
        <label class="toggle"><input type="checkbox" id="cookiePrefAnalytics" ${current.analytics ? "checked" : ""} /><span class="toggle__slider"></span></label>
      </div>
      <div class="cookie-dialog__actions">
        <button class="cookie-banner__btn cookie-banner__btn--secondary" id="cookiePrefSave">Enregistrer</button>
        <button class="cookie-banner__btn cookie-banner__btn--primary" id="cookiePrefAcceptAll">Tout accepter</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.showModal();

  dialog.querySelector("#cookiePrefSave").addEventListener("click", () => {
    const analytics = dialog.querySelector("#cookiePrefAnalytics").checked;
    saveConsent({ necessary: true, analytics, version: LEGAL_VERSION });
    const banner = document.getElementById("cookieBanner");
    if (banner) banner.remove();
    dialog.close();
    dialog.remove();
  });
  dialog.querySelector("#cookiePrefAcceptAll").addEventListener("click", () => {
    saveConsent({ necessary: true, analytics: true, version: LEGAL_VERSION });
    const banner = document.getElementById("cookieBanner");
    if (banner) banner.remove();
    dialog.close();
    dialog.remove();
  });

  dialog.addEventListener("close", () => dialog.remove());
}

// ── CGU acceptance helpers ──────────────────────────────────────────────────
const CGU_ACCEPTED_KEY = "spritedex_cgu_accepted";
const CGU_VERSION_KEY = "spritedex_cgu_version";

function hasAcceptedCgu(version) {
  return localStorage.getItem(CGU_VERSION_KEY) === (version || LEGAL_VERSION) &&
         localStorage.getItem(CGU_ACCEPTED_KEY) === "true";
}

function acceptCgu(version) {
  localStorage.setItem(CGU_ACCEPTED_KEY, "true");
  localStorage.setItem(CGU_VERSION_KEY, version || LEGAL_VERSION);
}

function updateRegisterButtonState() {
  const cguCheck = document.getElementById("registerCgu");
  const ageCheck = document.getElementById("registerAge");
  const registerBtn = document.getElementById("registerEmailBtn");
  if (registerBtn) {
    const enabled = (cguCheck?.checked === true) && (ageCheck?.checked === true);
    registerBtn.disabled = !enabled;
    registerBtn.classList.toggle("login-btn--disabled", !enabled);
  }
}

function initCguListeners() {
  const cguCheck = document.getElementById("registerCgu");
  const ageCheck = document.getElementById("registerAge");
  if (cguCheck) cguCheck.addEventListener("change", updateRegisterButtonState);
  if (ageCheck) ageCheck.addEventListener("change", updateRegisterButtonState);
  updateRegisterButtonState();
}

// Called by auth.js to block registration if CGU or age not accepted.
function requireCguAccepted() {
  const cguCheck = document.getElementById("registerCgu");
  if (!cguCheck || !cguCheck.checked) {
    toast("Tu dois accepter les Conditions générales d'utilisation pour t'inscrire.");
    return false;
  }
  const ageCheck = document.getElementById("registerAge");
  if (!ageCheck || !ageCheck.checked) {
    toast("Tu dois avoir au moins 15 ans pour créer un compte.");
    return false;
  }
  acceptCgu();
  return true;
}
