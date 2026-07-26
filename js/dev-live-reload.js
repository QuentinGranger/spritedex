(() => {
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHostnames.has(window.location.hostname)) return;

  let currentVersion = null;
  let checking = false;
  let intervalId = null;

  async function checkForChanges() {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const response = await fetch("/__dev/reload-version", { cache: "no-store" });
      if (!response.ok) {
        // `npm start` deliberately does not expose this development endpoint.
        window.clearInterval(intervalId);
        return;
      }
      const { version } = await response.json();
      if (currentVersion && version !== currentVersion) window.location.reload();
      currentVersion = version;
    } catch {
      // The server may be restarting because `node --watch` detected a change.
      // The following poll will reload the page once it is ready again.
    } finally {
      checking = false;
    }
  }

  checkForChanges();
  intervalId = window.setInterval(checkForChanges, 1000);
})();
