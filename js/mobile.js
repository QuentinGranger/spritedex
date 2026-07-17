// ── Native (Capacitor) integration ──────────────────────────────────────────
// Loaded on every page but only does anything inside the native app shell.
// Responsibilities:
//   1. Capture the OAuth deep link (spritedex://auth?authToken=…) that the
//      backend redirects to after a system-browser OAuth flow, and complete
//      the login using the same applyAuthParams() path as the web flow.
//   2. Close the in-app system browser once auth returns.
(function () {
  if (!isNativePlatform()) return;

  const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const { App, Browser, PushNotifications, StatusBar } = plugins;
  if (!App || typeof App.addListener !== "function") return;

  // Keep the status bar visible with a dark solid background; do not let the
  // web view render underneath it, so app headers are never hidden by the
  // clock/notch area.
  if (StatusBar && typeof StatusBar.setStyle === "function") {
    try {
      StatusBar.setStyle({ style: StatusBar.Style && StatusBar.Style.Dark ? StatusBar.Style.Dark : "DARK" });
      if (typeof StatusBar.setOverlaysWebView === "function") {
        StatusBar.setOverlaysWebView({ overlay: false });
      }
      if (typeof StatusBar.setBackgroundColor === "function") {
        StatusBar.setBackgroundColor({ color: "#0a0e1a" });
      }
    } catch (e) {
      console.warn("StatusBar config failed:", e);
    }
  }

  App.addListener("appUrlOpen", async (data) => {
    if (!data || !data.url) return;
    let url;
    try {
      url = new URL(data.url);
    } catch (e) {
      return;
    }
    // Match our custom scheme deep link: spritedex://auth?…
    const isAuthLink = url.protocol.replace(":", "") === "spritedex" &&
      (url.host === "auth" || url.pathname.replace(/\//g, "") === "auth");
    if (!isAuthLink) return;

    if (Browser && typeof Browser.close === "function") {
      try { await Browser.close(); } catch (e) { /* browser may already be closed */ }
    }

    try {
      await applyAuthParams(url.searchParams);
    } catch (e) {
      console.error("Native OAuth deep-link handling failed:", e);
    }
  });

  // Register native push notifications if the plugin is available.
  if (PushNotifications && typeof PushNotifications.register === "function" && window.PushClient) {
    PushNotifications.requestPermissions().then((result) => {
      if (result.receive === "granted") PushNotifications.register();
    });
    PushNotifications.addListener("registration", (token) => {
      const platform = window.Capacitor.getPlatform() === "ios" ? "apns" : "fcm";
      window.PushClient.registerServerToken(token.value, platform);
    });
  }
})();
