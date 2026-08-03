// ── Native (Capacitor) integration ──────────────────────────────────────────
// Loaded on every page but only does anything inside the native app shell.
// Responsibilities:
//   1. Capture the OAuth deep link (sprite-index://auth?authToken=…) that the
//      backend redirects to after a system-browser OAuth flow, and complete
//      the login using the same applyAuthParams() path as the web flow.
//   2. Close the in-app system browser once auth returns.
(function () {
  if (!isNativePlatform()) return;

  const plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
  const { App, Browser, StatusBar } = plugins;
  if (!App || typeof App.addListener !== "function") return;

  // Keep the status bar visible with a dark solid background; do not let the
  // web view render underneath it, so app headers are never hidden by the
  // clock/notch area.
  if (StatusBar && typeof StatusBar.setStyle === "function") {
    void (async () => {
      try {
        await StatusBar.setStyle({ style: StatusBar.Style && StatusBar.Style.Dark ? StatusBar.Style.Dark : "DARK" });
        // Capacitor intentionally leaves these StatusBar APIs unimplemented
        // on iOS. The app uses safe-area CSS there instead.
        if (window.Capacitor.getPlatform?.() !== "ios") {
          if (typeof StatusBar.setOverlaysWebView === "function") {
            await StatusBar.setOverlaysWebView({ overlay: false });
          }
          if (typeof StatusBar.setBackgroundColor === "function") {
            await StatusBar.setBackgroundColor({ color: "#0a0e1a" });
          }
        }
      } catch (e) {
        console.warn("StatusBar config failed:", e);
      }
    })();
  }

  App.addListener("appUrlOpen", async (data) => {
    if (!data || !data.url) return;
    let url;
    try {
      url = new URL(data.url);
    } catch (e) {
      return;
    }
    // Match our custom scheme deep link. It carries only a short-lived OAuth
    // code; redemption additionally requires the verifier held in this app.
    const isAuthLink =
      url.protocol.replace(":", "") === "sprite-index" &&
      (url.host === "auth" || url.pathname.replace(/\//g, "") === "auth");
    if (!isAuthLink) return;
    const verifierKey = window.OAUTH_EXCHANGE_VERIFIER_KEY || "sprite-index_oauth_exchange_verifier";
    if (!sessionStorage.getItem(verifierKey)) return;
    if (!url.searchParams.get("authCode") && !url.searchParams.get("authError")) return;

    try {
      await applyAuthParams(url.searchParams);
      if (Browser && typeof Browser.close === "function") {
        try {
          await Browser.close();
        } catch (e) {
          /* browser may already be closed */
        }
      }
    } catch (e) {
      console.error("Native OAuth deep-link handling failed:", e);
    }
  });
})();
