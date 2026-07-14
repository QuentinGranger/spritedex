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
  const { App, Browser } = plugins;
  if (!App || typeof App.addListener !== "function") return;

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
})();
