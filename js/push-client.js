// ── SpriteDex push notification client ───────────────────────────────────────
// Registers the device for push notifications on web (Push API + service worker)
// and native (Capacitor Push Notifications plugin). Tokens are sent to the
// backend at /api/push/register.
//
// Web Push needs a VAPID public key exposed by the server.
// Native needs the Capacitor Push Notifications plugin + FCM/APNS setup.

(function () {
  "use strict";

  const PREF_KEY = "spritedex_notifications";

  function getHeaders() {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  async function registerServerToken(token, platform) {
    try {
      await fetch(`${API_BASE}/push/register`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ token, platform })
      });
    } catch (err) {
      console.error("[PUSH] Failed to register token:", err);
    }
  }

  async function unregisterServerToken(token) {
    try {
      await fetch(`${API_BASE}/push/register`, {
        method: "DELETE",
        headers: getHeaders(),
        body: JSON.stringify({ token })
      });
    } catch (err) {
      console.error("[PUSH] Failed to unregister token:", err);
    }
  }

  async function updateServerPreferences(prefs) {
    try {
      await fetch(`${API_BASE}/push/preferences`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({
          enabled: prefs.enabled !== false,
          newSprites: prefs.newSprites !== false,
          newVariants: prefs.newVariants !== false,
          squadActivity: prefs.squadActivity !== false,
          sessionSummary: prefs.sessionSummary === true,
          goals: prefs.goals === true,
          sync: prefs.sync === true,
          news: prefs.news !== false
        })
      });
    } catch (err) {
      console.error("[PUSH] Failed to sync preferences:", err);
    }
  }

  // ── Web Push (PWA) ──
  async function registerWebPush() {
    if (!("serviceWorker" in navigator)) return;
    if (!("PushManager" in window)) return;

    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    let publicKey;
    try {
      const res = await fetch(`${API_BASE}/push/vapid-key`);
      const data = await res.json();
      publicKey = data.publicKey;
    } catch {
      return;
    }
    if (!publicKey) return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await registerServerToken(JSON.stringify(sub), "web");
  }

  async function unregisterWebPush() {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await unregisterServerToken(JSON.stringify(sub));
      await sub.unsubscribe();
    }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
    return output;
  }

  // ── Native Capacitor Push ──
  function registerNativePush() {
    const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
    const { PushNotifications } = plugins;
    if (!PushNotifications || typeof PushNotifications.register !== "function") return;

    PushNotifications.requestPermissions().then((result) => {
      if (result.receive === "granted") PushNotifications.register();
    });

    PushNotifications.addListener("registration", (token) => {
      const platform = window.Capacitor.getPlatform() === "ios" ? "apns" : "fcm";
      registerServerToken(token.value, platform);
    });

    PushNotifications.addListener("registrationError", (err) => {
      console.error("[PUSH] Native registration error:", err);
    });
  }

  // ── Public API ──
  window.PushClient = {
    register: async () => {
      if (isNativePlatform() && window.Capacitor?.Plugins?.PushNotifications) {
        registerNativePush();
      } else {
        await registerWebPush();
      }
    },
    registerServerToken,
    unregister: async () => {
      if (isNativePlatform()) return; // no simple unregister for native in this version
      await unregisterWebPush();
    },
    syncPreferences: updateServerPreferences
  };

  // Sync local notification preferences to server whenever they change.
  const origSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (key, value) {
    origSetItem(key, value);
    if (key === PREF_KEY && state?.userId) {
      try {
        const prefs = JSON.parse(value || "{}");
        updateServerPreferences(prefs);
      } catch {}
    }
  };
})();
