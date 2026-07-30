// Browser-console entrypoint for the terminal backoffice. The password is
// deliberately requested in a native prompt rather than accepted as a command
// argument, so it does not end up in the DevTools command history.
(() => {
  async function openSpriteIndexBackoffice() {
    const password = window.prompt(typeof t === "function" ? t("admin.consolePrompt") : "Admin password");
    if (password == null) return false;
    if (!password) {
      if (typeof toast === "function") toast(typeof t === "function" ? t("admin.consoleUnavailable") : "Password required");
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/admin/terminal/ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.accessUrl) throw new Error("admin_access_denied");
      // The access token is a URL fragment: it is never sent as an HTTP path
      // or query parameter and is consumed once by the transition page.
      location.assign(payload.accessUrl);
      return true;
    } catch (_) {
      if (typeof toast === "function") toast(typeof t === "function" ? t("admin.consoleError") : "Admin access denied");
      return false;
    }
  }

  window.openSpriteIndexBackoffice = openSpriteIndexBackoffice;
})();
