function setupServiceWorker() {
  // Register the service worker for the web PWA only. In the native (Capacitor)
  // shell it would try to intercept capacitor:// requests and conflicts with the
  // native asset loader, so we skip it there.
  if ("serviceWorker" in navigator && !isNativePlatform()) {
    // An absolute URL matters on public routes such as /u/:username: a relative
    // "sw.js" would otherwise resolve to /u/sw.js and silently leave that
    // session on an old cache. updateViaCache:none pairs with the server's
    // no-cache worker response, so every app return can discover a deploy.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        const checkForUpdate = () => registration.update().catch(() => {});
        window.addEventListener("focus", checkForUpdate, { passive: true });
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
      })
      .catch(() => {});
  }
}
